import * as THREE from 'https://unpkg.com/three@0.161.0/build/three.module.js';

import {
  createViewerStore,
  createBackend,
  applySpecAction,
  applyGesture,
  readControlValue,
  mergeBackendSnapshot,
} from './src/viewer/state.mjs';

const CAMERA_PRESETS = ['Free', 'Tracking', 'Fixed 1', 'Fixed 2', 'Fixed 3'];

const leftPanel = document.querySelector('[data-testid="panel-left"]');
const rightPanel = document.querySelector('[data-testid="panel-right"]');
const canvas = document.querySelector('[data-testid="viewer-canvas"]');
const overlayHelp = document.querySelector('[data-testid="overlay-help"]');
const overlayInfo = document.querySelector('[data-testid="overlay-info"]');
const overlayProfiler = document.querySelector('[data-testid="overlay-profiler"]');
const overlaySensor = document.querySelector('[data-testid="overlay-sensor"]');
const toastEl = document.querySelector('[data-testid="toast"]');
const simTimeEl = document.querySelector('[data-testid="sim-time"]');
const simStatusEl = document.querySelector('[data-testid="sim-status"]');
const cameraSummaryEl = document.querySelector('[data-testid="camera-summary"]');
const gestureEl = document.querySelector('[data-testid="perturb-state"]');

const controlById = new Map();
const controlBindings = new Map();

let latestSnapshot = null;
let renderStats = { drawn: 0, hidden: 0 };

const searchParams = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : new URLSearchParams();
const debugMode = searchParams.get('debug') === '1';
const requestedMode = searchParams.get('mode');
const backendMode = requestedMode === 'worker' || requestedMode === 'direct' ? requestedMode : 'auto';
const requestedModel = searchParams.get('model');
const backend = await createBackend({ mode: backendMode, debug: debugMode, model: requestedModel });
const store = createViewerStore({});
if (typeof window !== 'undefined') {
  window.__viewerStore = store;
}
function applySnapshot(snapshot) {
  latestSnapshot = snapshot;
  store.update((draft) => {
    mergeBackendSnapshot(draft, snapshot);
  });
}

const initialSnapshot = await backend.snapshot();
applySnapshot(initialSnapshot);
backend.subscribe((snapshot) => {
  applySnapshot(snapshot);
});

function sanitiseName(name) {
  return String(name ?? '')
    .replace(/\s+/g, '_')
    .replace(/[^A-Za-z0-9._-]/g, '')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '') || 'item';
}

function normaliseOptions(options) {
  if (!options) return [];
  if (Array.isArray(options)) return options;
  return options
    .split(/[\n,]+/)
    .map((token) => token.trim())
    .filter(Boolean);
}

function createControlRow(control, options = {}) {
  const row = document.createElement('div');
  row.className = 'control-row';
  if (options.full) {
    row.classList.add('full');
  }
  if (options.half) {
    row.classList.add('half');
  }
  if (control?.item_id) {
    row.dataset.controlId = control.item_id;
  }
  return row;
}

function createNamedRow(labelText, options = {}) {
  const row = createControlRow(null, options);
  const label = document.createElement('label');
  label.className = 'control-label';
  label.textContent = labelText ?? '';
  const field = document.createElement('div');
  field.className = 'control-field';
  row.append(label, field);
  return { row, label, field };
}

function createFullRow(options = {}) {
  const row = createControlRow(null, { ...options, full: true });
  const field = document.createElement('div');
  field.className = 'control-field';
  row.append(field);
  return { row, field };
}

function createButtonElement(control, variant = 'secondary') {
  const button = document.createElement('button');
  button.type = 'button';
  const labelText = control.label ?? control.name ?? control.item_id;
  button.textContent = labelText;
  button.setAttribute('data-testid', control.item_id);
  button.classList.add(
    variant === 'primary' ? 'btn-primary' : variant === 'pill' ? 'btn-pill' : 'btn-secondary',
  );
  const binding = {
    skip: false,
    getValue: () => true,
    setValue: () => {},
  };
  registerControl(control, binding);
  button.addEventListener('click', async (event) => {
    await applySpecAction(store, backend, control, {
      trigger: 'click',
      shiftKey: !!event.shiftKey,
      ctrlKey: !!event.ctrlKey,
      altKey: !!event.altKey,
      metaKey: !!event.metaKey,
    });
  });
  return button;
}

function createPillToggle(control) {
  const wrapper = document.createElement('label');
  wrapper.className = 'compact-pill';
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.id = `${sanitiseName(control.item_id)}__pill`;
  input.setAttribute('data-testid', control.item_id);
  const text = document.createElement('span');
  text.textContent = control.label ?? control.name ?? control.item_id;
  wrapper.append(input, text);
  const binding = {
    skip: false,
    getValue: () => input.checked,
    setValue: (value) => {
      binding.skip = true;
      input.checked = !!value;
      wrapper.classList.toggle('is-active', !!value);
      binding.skip = false;
    },
  };
  registerControl(control, binding);
  input.addEventListener('change', async () => {
    if (binding.skip) return;
    await applySpecAction(store, backend, control, input.checked);
  });
  return wrapper;
}
function createLabeledRow(control) {
  const row = createControlRow(control);
  const label = document.createElement('label');
  label.className = 'control-label';
  label.textContent = control.label ?? control.name ?? control.item_id;
  const field = document.createElement('div');
  field.className = 'control-field';
  row.append(label, field);
  return { row, label, field };
}

function expandSection(section) {
  const out = { ...section, items: [] };
  for (const item of section.items ?? []) {
    out.items.push(item);
  }

  function appendGroupedEntries(group) {
    if (!group) return;
    const groupKey = group.group_id ?? group.label ?? section.section_id;
    if (group.label) {
      out.items.push({
        item_id: `${section.section_id}.${sanitiseName(groupKey)}._separator`,
        type: 'separator',
        label: group.label,
      });
    }
    const groupType = typeof group.type === 'string' ? group.type.toLowerCase() : '';
    const fallbackType = groupType.includes('radio')
      ? 'radio'
      : groupType.includes('select')
      ? 'select'
      : groupType.includes('slider')
      ? 'slider'
      : 'checkbox';
    for (const entry of group.entries ?? []) {
      const name = entry.name ?? entry.label ?? entry.binding ?? 'entry';
      const itemIdBase = group.group_id ? String(group.group_id) : `${section.section_id}`;
      const itemId = `${itemIdBase}.${sanitiseName(name)}`;
      out.items.push({
        item_id: itemId,
        type: entry.type ?? fallbackType,
        label: entry.name ?? entry.label ?? name,
        binding: entry.binding,
        name,
        options: entry.options,
        default: entry.default,
        shortcut: entry.shortcut,
      });
    }
  }

  for (const group of section.dynamic_groups ?? []) {
    appendGroupedEntries(group);
  }

  for (const post of section.post_groups ?? []) {
    out.items.push(post);
  }
  for (const trail of section.trail_groups ?? []) {
    appendGroupedEntries(trail);
  }
  return out;
}

async function loadUiSpec() {
  const specUrl = new URL('./spec/ui_spec.json', import.meta.url);
  const res = await fetch(specUrl, { cache: 'no-store' });
  if (!res.ok) {
    throw new Error(`Failed to load ui_spec.json (${res.status})`);
  }
  const json = await res.json();
  console.log('[ui] spec loaded', json.left_panel?.length ?? 0, json.right_panel?.length ?? 0);
  return {
    left: (json.left_panel ?? []).map(expandSection),
    right: (json.right_panel ?? []).map(expandSection),
  };
}

function registerControl(control, binding) {
  controlById.set(control.item_id, control);
  controlBindings.set(control.item_id, binding);
}

const renderCtx = {
  initialized: false,
  renderer: null,
  scene: null,
  camera: null,
  root: null,
  grid: null,
  light: null,
  meshes: [],
  defaultVopt: null,
  alignSeq: 0,
  copySeq: 0,
  cameraTarget: new THREE.Vector3(0, 0, 0),
  autoAligned: false,
  bounds: null,
};

const tempVecA = new THREE.Vector3();
const tempVecB = new THREE.Vector3();
const tempVecC = new THREE.Vector3();
const tempVecD = new THREE.Vector3();
const tempSpherical = new THREE.Spherical();
const tempVecE = new THREE.Vector3();
const GLOBAL_UP = new THREE.Vector3(0, 0, 1);

function mat3ToQuat(m) {
  const m00 = m[0] ?? 1;
  const m01 = m[1] ?? 0;
  const m02 = m[2] ?? 0;
  const m10 = m[3] ?? 0;
  const m11 = m[4] ?? 1;
  const m12 = m[5] ?? 0;
  const m20 = m[6] ?? 0;
  const m21 = m[7] ?? 0;
  const m22 = m[8] ?? 1;
  const t = m00 + m11 + m22;
  let w = 1;
  let x = 0;
  let y = 0;
  let z = 0;
  if (t > 0) {
    const s = Math.sqrt(t + 1.0) * 2;
    w = 0.25 * s;
    x = (m21 - m12) / s;
    y = (m02 - m20) / s;
    z = (m10 - m01) / s;
  } else if (m00 > m11 && m00 > m22) {
    const s = Math.sqrt(1.0 + m00 - m11 - m22) * 2;
    w = (m21 - m12) / s;
    x = 0.25 * s;
    y = (m01 + m10) / s;
    z = (m02 + m20) / s;
  } else if (m11 > m22) {
    const s = Math.sqrt(1.0 + m11 - m00 - m22) * 2;
    w = (m02 - m20) / s;
    x = (m01 + m10) / s;
    y = 0.25 * s;
    z = (m12 + m21) / s;
  } else {
    const s = Math.sqrt(1.0 + m22 - m00 - m11) * 2;
    w = (m10 - m01) / s;
    x = (m02 + m20) / s;
    y = (m12 + m21) / s;
    z = 0.25 * s;
  }
  return new THREE.Quaternion(x, y, z, w);
}

function initRenderer() {
  if (renderCtx.initialized) return renderCtx;
  if (!canvas) return renderCtx;

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;
  renderer.setClearColor(0x181d28, 1);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x151a26);
  scene.fog = new THREE.Fog(0x151a26, 12, 48);

  scene.add(new THREE.AmbientLight(0xdfe5ff, 1.05));
  const hemi = new THREE.HemisphereLight(0xcfd9ff, 0x10131c, 0.55);
  scene.add(hemi);
  const dir = new THREE.DirectionalLight(0xffffff, 1.35);
  dir.position.set(6, -8, 8);
  dir.color.setHSL(0.58, 0.32, 0.92);
  dir.castShadow = true;
  dir.shadow.mapSize.set(1024, 1024);
  dir.shadow.camera.near = 0.5;
  dir.shadow.camera.far = 40;
  const lightTarget = new THREE.Object3D();
  scene.add(lightTarget);
  dir.target = lightTarget;
  scene.add(dir);

  const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 100);
  camera.up.set(0, 0, 1);
  camera.position.set(3, -4, 2);
  camera.lookAt(new THREE.Vector3(0, 0, 0));

  const root = new THREE.Group();
  scene.add(root);

  const grid = new THREE.GridHelper(12, 24, 0x3b4456, 0x1e2332);
  grid.rotation.x = Math.PI / 2;
  scene.add(grid);
  const axes = new THREE.AxesHelper(0.4);
  axes.position.set(0, 0, 0.01);
  axes.material.depthTest = false;
  axes.renderOrder = 2;
  scene.add(axes);

  function resizeRenderer() {
    const rect = canvas.getBoundingClientRect();
    const width = Math.max(1, rect.width);
    const height = Math.max(1, rect.height);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }

  resizeRenderer();
  window.addEventListener('resize', resizeRenderer);

  function animate() {
    requestAnimationFrame(animate);
    if (!renderCtx.initialized) return;
    renderer.render(scene, camera);
  }
  animate();

  Object.assign(renderCtx, {
    initialized: true,
    renderer,
    scene,
    camera,
    root,
    grid,
    light: dir,
    lightTarget,
    hemi,
    meshes: [],
    defaultVopt: null,
    alignSeq: 0,
    copySeq: 0,
    autoAligned: false,
    bounds: null,
  });
  renderCtx.cameraTarget.set(0, 0, 0);
  return renderCtx;
}

function getDefaultVopt(state) {
  if (!state?.rendering?.voptFlags) return null;
  if (!renderCtx.defaultVopt) {
    renderCtx.defaultVopt = state.rendering.voptFlags.slice();
  }
  return renderCtx.defaultVopt;
}

function ensureGeomMesh(ctx, index, gtype) {
  if (ctx.meshes[index]) return ctx.meshes[index];
  let geometry;
  let materialOpts = {
    color: 0x6fa0ff,
    metalness: 0.05,
    roughness: 0.65,
  };
  let postCreate = null;
  switch (gtype) {
    case 2: // sphere
    case 4: // ellipsoid -> sphere fallback
      geometry = new THREE.SphereGeometry(1, 24, 16);
      break;
    case 3: // capsule
      geometry = new THREE.CapsuleGeometry(1, 1, 16, 12);
      break;
    case 5: // cylinder
      geometry = new THREE.CylinderGeometry(1, 1, 1, 24, 1);
      break;
    case 0: // plane
    case 1: // hfield -> plane
      geometry = new THREE.PlaneGeometry(1, 1, 1, 1);
      materialOpts = {
        color: 0x4a5661,
        metalness: 0.0,
        roughness: 0.95,
      };
      postCreate = (mesh) => {
        mesh.rotation.x = -Math.PI / 2;
        mesh.receiveShadow = true;
      };
      break;
    default:
      geometry = new THREE.BoxGeometry(1, 1, 1);
      break;
  }
  const material = new THREE.MeshStandardMaterial(materialOpts);
  material.side = THREE.DoubleSide;
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  if (typeof postCreate === 'function') {
    try {
      postCreate(mesh);
    } catch {}
  }
  ctx.root.add(mesh);
  ctx.meshes[index] = mesh;
  return mesh;
}

function applyMaterialFlags(mesh, index, state) {
  const sceneFlags = state.rendering?.sceneFlags || [];
  mesh.material.wireframe = !!sceneFlags[1];
  mesh.material.emissive = sceneFlags[0] ? new THREE.Color(0x1a1f2a) : new THREE.Color(0x000000);
}

function shouldHighlightFlag(index, value, defaults) {
  if (!defaults) return false;
  const def = defaults[index] ?? false;
  if (def === value) return false;
  return true;
}

function updateMeshFromSnapshot(mesh, i, snapshot, state) {
  const n = snapshot.ngeom | 0;
  if (i >= n) {
    mesh.visible = false;
    return;
  }
  const { xpos, xmat, gsize, gtype, gmatid, matrgba } = snapshot;
  const baseIndex = 3 * i;
  const pos = [
    xpos?.[baseIndex + 0] ?? 0,
    xpos?.[baseIndex + 1] ?? 0,
    xpos?.[baseIndex + 2] ?? 0,
  ];
  mesh.position.set(pos[0], pos[1], pos[2]);

  const matBase = 9 * i;
  const rot = [
    xmat?.[matBase + 0] ?? 1,
    xmat?.[matBase + 1] ?? 0,
    xmat?.[matBase + 2] ?? 0,
    xmat?.[matBase + 3] ?? 0,
    xmat?.[matBase + 4] ?? 1,
    xmat?.[matBase + 5] ?? 0,
    xmat?.[matBase + 6] ?? 0,
    xmat?.[matBase + 7] ?? 0,
    xmat?.[matBase + 8] ?? 1,
  ];
  mesh.quaternion.copy(mat3ToQuat(rot));

  const sizeBase = 3 * i;
  const sx = gsize?.[sizeBase + 0] ?? 0.1;
  const sy = gsize?.[sizeBase + 1] ?? sx;
  const sz = gsize?.[sizeBase + 2] ?? sx;
  const type = gtype?.[i] ?? 6;
  switch (type) {
    case 2:
    case 4:
      mesh.scale.set(Math.max(1e-6, sx * 2), Math.max(1e-6, sx * 2), Math.max(1e-6, sx * 2));
      break;
    case 3:
      mesh.scale.set(Math.max(1e-6, sx * 2), Math.max(1e-6, (sy * 2) + (sx * 2)), Math.max(1e-6, sx * 2));
      break;
    case 5:
      mesh.scale.set(Math.max(1e-6, sx * 2), Math.max(1e-6, sy * 2), Math.max(1e-6, sx * 2));
      break;
    case 0:
    case 1:
      mesh.scale.set(Math.max(1e-6, sx * 4), Math.max(1e-6, sy * 4), 1);
      break;
    default:
      mesh.scale.set(Math.max(1e-6, sx * 2), Math.max(1e-6, sy * 2), Math.max(1e-6, sz * 2));
      break;
  }

  if (Array.isArray(matrgba) || ArrayBuffer.isView(matrgba)) {
    const matIndex = gmatid?.[i] ?? -1;
    if (matIndex >= 0) {
      const rgbaBase = matIndex * 4;
      const r = matrgba?.[rgbaBase + 0] ?? 0.6;
      const g = matrgba?.[rgbaBase + 1] ?? 0.6;
      const b = matrgba?.[rgbaBase + 2] ?? 0.9;
      const a = matrgba?.[rgbaBase + 3] ?? 1;
      mesh.material.color.setRGB(r, g, b);
      mesh.material.opacity = a;
      mesh.material.transparent = a < 0.999;
    }
  }

  applyMaterialFlags(mesh, i, state);
  mesh.visible = true;
}

function computeGeomRadius(type, sx, sy, sz) {
  const s1 = Math.abs(sx) || 0;
  const s2 = Math.abs(sy) || 0;
  const s3 = Math.abs(sz) || 0;
  switch (type) {
    case 2: // sphere
    case 4: // ellipsoid approximated as sphere
      return Math.max(s1, 1e-3);
    case 3: // capsule radius s1, half-height s2
      return Math.max(s1 + s2, 1e-3);
    case 5: // cylinder radius s1, half-height s2
      return Math.max(Math.sqrt(s1 * s1 + s2 * s2), 1e-3);
    case 6: // box
      return Math.max(Math.sqrt(s1 * s1 + s2 * s2 + s3 * s3), 1e-3);
    case 0: // plane
    case 1: // hfield
      return Math.max(s1, s2, 5);
    default:
      return Math.max(Math.sqrt(s1 * s1 + s2 * s2 + s3 * s3), 0.15);
  }
}

function computeBoundsFromSnapshot(snapshot) {
  const n = snapshot?.ngeom | 0;
  const xpos = snapshot?.xpos;
  if (!xpos || !Number.isFinite(n) || n <= 0) {
    return null;
  }
  const gsize = snapshot?.gsize;
  const gtype = snapshot?.gtype;
  let minx = Number.POSITIVE_INFINITY;
  let miny = Number.POSITIVE_INFINITY;
  let minz = Number.POSITIVE_INFINITY;
  let maxx = Number.NEGATIVE_INFINITY;
  let maxy = Number.NEGATIVE_INFINITY;
  let maxz = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < n; i += 1) {
    const base = 3 * i;
    const x = Number(xpos[base + 0]) || 0;
    const y = Number(xpos[base + 1]) || 0;
    const z = Number(xpos[base + 2]) || 0;
    const sizeBase = 3 * i;
    const sx = gsize?.[sizeBase + 0] ?? 0.1;
    const sy = gsize?.[sizeBase + 1] ?? sx;
    const sz = gsize?.[sizeBase + 2] ?? sx;
    const type = gtype?.[i] ?? 6;
    const radius = computeGeomRadius(type, sx, sy, sz);
    const pxMin = x - radius;
    const pyMin = y - radius;
    const pzMin = z - radius;
    const pxMax = x + radius;
    const pyMax = y + radius;
    const pzMax = z + radius;
    if (pxMin < minx) minx = pxMin;
    if (pyMin < miny) miny = pyMin;
    if (pzMin < minz) minz = pzMin;
    if (pxMax > maxx) maxx = pxMax;
    if (pyMax > maxy) maxy = pyMax;
    if (pzMax > maxz) maxz = pzMax;
  }
  if (!Number.isFinite(minx) || !Number.isFinite(maxx)) {
    return null;
  }
  const cx = (minx + maxx) / 2;
  const cy = (miny + maxy) / 2;
  const cz = (minz + maxz) / 2;
  const dx = maxx - minx;
  const dy = maxy - miny;
  const dz = maxz - minz;
  const radius = Math.max(dx, dy, dz) / 2;
  const fallback = Math.max(Math.abs(cx), Math.abs(cy), Math.abs(cz), 0.6);
  return {
    center: [cx, cy, cz],
    radius: Number.isFinite(radius) && radius > 0 ? radius : fallback,
  };
}

function renderScene(snapshot, state) {
  if (!snapshot || !state) return;
  const ctx = initRenderer();
  const defaults = getDefaultVopt(state);
  const voptFlags = state.rendering?.voptFlags || [];
  const sceneFlags = state.rendering?.sceneFlags || [];
  if (ctx.renderer) {
    ctx.renderer.shadowMap.enabled = !!sceneFlags[0];
  }
  if (ctx.light) {
    const baseLight = sceneFlags[0] ? 1.45 : 1.05;
    ctx.light.intensity = baseLight;
  }
  if (ctx.hemi) {
    const fillLight = sceneFlags[0] ? 0.9 : 0.65;
    ctx.hemi.intensity = fillLight;
    ctx.hemi.groundColor.set(sceneFlags[0] ? 0x111622 : 0x161b29);
  }
  let hideAllGeometry = false;
  let highlightGeometry = false;
  if (defaults) {
    for (let idx = 0; idx < Math.min(defaults.length, voptFlags.length); idx += 1) {
      const def = defaults[idx];
      const val = voptFlags[idx];
      if (def && !val) {
        hideAllGeometry = true;
        break;
      }
      if (!def && val) {
        highlightGeometry = true;
      }
    }
  }
  const ngeom = snapshot.ngeom | 0;
  let drawn = 0;
  for (let i = 0; i < ngeom; i += 1) {
    const type = snapshot.gtype?.[i] ?? 6;
    const mesh = ensureGeomMesh(ctx, i, type);
    updateMeshFromSnapshot(mesh, i, snapshot, state);
    let visible = mesh.visible;
    if (hideAllGeometry) {
      visible = false;
    } else if (highlightGeometry) {
      mesh.material.emissive = new THREE.Color(0x2b3a7a);
    }
    mesh.visible = visible;
    if (visible) drawn += 1;
  }
  for (let i = ngeom; i < ctx.meshes.length; i += 1) {
    if (ctx.meshes[i]) {
      ctx.meshes[i].visible = false;
    }
  }

  renderStats = {
    drawn,
    hidden: Math.max(0, ngeom - drawn),
    contacts: snapshot.contacts?.n ?? 0,
    t: typeof snapshot.t === 'number' ? snapshot.t : null,
  };

  if (debugMode) {
    ctx.debugFrameCount = (ctx.debugFrameCount || 0) + 1;
    if (ctx.debugFrameCount <= 5 || ctx.debugFrameCount % 60 === 0) {
      console.log('[render] stats', {
        frame: ctx.debugFrameCount,
        drawn,
        ngeom,
        bounds: ctx.bounds
          ? {
              center: ctx.bounds.center.map((v) => Number(v.toFixed(3))),
              radius: Number((ctx.bounds.radius || 0).toFixed(3)),
            }
          : null,
        camera: ctx.camera
          ? {
              position: ctx.camera.position.toArray().map((v) => Number(v.toFixed(3))),
              target: ctx.cameraTarget?.toArray().map((v) => Number(v.toFixed(3))),
            }
          : null,
        contacts: snapshot.contacts?.n ?? 0,
        xpos0:
          snapshot.xpos && snapshot.xpos.length >= 3
            ? Array.from(snapshot.xpos.slice(0, 3)).map((v) => Number(v.toFixed(4)))
            : null,
      });
    }
  }

  if (ngeom > 0) {
    const bounds = computeBoundsFromSnapshot(snapshot);
    if (bounds) {
      ctx.bounds = bounds;
      if (!ctx.autoAligned && ctx.camera) {
        const radius = Math.max(bounds.radius || 0, 0.6);
        const focus = new THREE.Vector3(bounds.center[0], bounds.center[1], bounds.center[2]);
        const offset = new THREE.Vector3(radius * 2.6, -radius * 2.6, radius * 1.7);
        ctx.camera.position.copy(focus.clone().add(offset));
        ctx.camera.lookAt(focus);
        ctx.cameraTarget.copy(focus);
        ctx.autoAligned = true;
        if (debugMode) {
          console.log('[render] auto align', { radius, center: bounds.center });
        }
      }
      if (ctx.light) {
        const radius = Math.max(bounds.radius || 0, 0.6);
        const focus = new THREE.Vector3(bounds.center[0], bounds.center[1], bounds.center[2]);
        const lightOffset = new THREE.Vector3(radius * 2.4, -radius * 2.2, radius * 3.2);
        ctx.light.position.copy(focus.clone().add(lightOffset));
        if (ctx.lightTarget) {
          ctx.lightTarget.position.copy(focus);
          ctx.light.target.updateMatrixWorld();
        }
      }
      if (ctx.hemi) {
        const radius = Math.max(bounds.radius || 0, 0.6);
        ctx.hemi.position.set(bounds.center[0], bounds.center[1], bounds.center[2] + radius * 2.8);
      }
    }
  }

  const alignState = state.runtime?.lastAlign;
  if (alignState && alignState.seq > ctx.alignSeq) {
    ctx.alignSeq = alignState.seq;
    const center = alignState.center || [0, 0, 0];
    const radius = Math.max(
      alignState.radius || 0,
      ctx.bounds?.radius || 0,
      0.6,
    );
    const target = new THREE.Vector3(center[0], center[1], center[2]);
    ctx.camera.position.copy(target.clone().add(new THREE.Vector3(radius * 1.8, -radius * 1.8, radius * 1.2)));
    ctx.camera.lookAt(target);
    ctx.cameraTarget.copy(target);
    if (debugMode) {
      console.log('[render] align', { radius, center });
    }
  }

  const copyState = state.runtime?.lastCopy;
  if (copyState && copyState.seq > ctx.copySeq) {
    ctx.copySeq = copyState.seq;
  }
  const baseGrid = sceneFlags[2] !== false;
  const gridVisible =
    baseGrid && !(copyState && copyState.precision === 'full' && copyState.seq === ctx.copySeq);
  ctx.grid.visible = gridVisible;
}
function createLabel(text) {
  const label = document.createElement('label');
  label.textContent = text;
  return label;
}

function renderCheckbox(container, control) {
  const row = createControlRow(control, { full: true });
  row.classList.add('bool-row');
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'bool-button';
  button.textContent = control.label ?? control.name ?? control.item_id;
  button.setAttribute('data-testid', control.item_id);
  button.setAttribute('aria-pressed', 'false');
  row.append(button);
  container.append(row);

  const binding = {
    skip: false,
    getValue: () => button.classList.contains('is-active'),
    setValue: (value) => {
      binding.skip = true;
      const active = !!value;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
      binding.skip = false;
    },
  };
  registerControl(control, binding);

  button.addEventListener('click', async () => {
    if (binding.skip) return;
    const next = !binding.getValue();
    await applySpecAction(store, backend, control, next);
  });
}

function renderButton(container, control, variant = 'secondary') {
  const row = createControlRow(control, { full: true });
  row.classList.add('action-row');
  const button = document.createElement('button');
  button.type = 'button';
  const labelText = control.label ?? control.name ?? control.item_id;
  button.textContent = labelText;
  button.setAttribute('data-testid', control.item_id);

  let resolvedVariant = variant;
  if (control.item_id === 'simulation.run') {
    resolvedVariant = 'primary';
  } else if (control.item_id.startsWith('simulation.')) {
    resolvedVariant = 'pill';
  } else if (control.item_id.startsWith('file.')) {
    resolvedVariant = 'pill';
  }
  if (variant === 'pill') {
    resolvedVariant = 'pill';
  }

  if (resolvedVariant === 'pill') {
    button.classList.add('btn-pill');
    row.classList.add('pill-row');
  } else if (resolvedVariant === 'primary') {
    button.classList.add('btn-primary');
  } else {
    button.classList.add('btn-secondary');
  }

  row.append(button);
  container.append(row);

  registerControl(control, {
    skip: false,
    getValue: () => true,
    setValue: () => {},
  });

  button.addEventListener('click', async (event) => {
    await applySpecAction(store, backend, control, {
      trigger: 'click',
      shiftKey: !!event.shiftKey,
      ctrlKey: !!event.ctrlKey,
      altKey: !!event.altKey,
      metaKey: !!event.metaKey,
    });
  });
}

function renderSelect(container, control) {
  const { row, label, field } = createLabeledRow(control);
  const inputId = `${sanitiseName(control.item_id)}__select`;
  label.setAttribute('for', inputId);
  const select = document.createElement('select');
  select.setAttribute('data-testid', control.item_id);
  select.id = inputId;
  const options = normaliseOptions(control.options);
  options.forEach((opt, idx) => {
    const option = document.createElement('option');
    option.value = String(idx);
    option.textContent = opt;
    select.appendChild(option);
  });
  field.append(select);
  container.append(row);

  const binding = {
    skip: false,
    getValue: () => Number(select.value),
    setValue: (value) => {
      binding.skip = true;
      if (typeof value === 'number' && !Number.isNaN(value)) {
        select.value = String(value);
      }
      binding.skip = false;
    },
  };
  registerControl(control, binding);

  select.addEventListener('change', async () => {
    if (binding.skip) return;
    const value = Number(select.value);
    await applySpecAction(store, backend, control, value);
  });
}

function renderRadio(container, control) {
  const options = normaliseOptions(control.options);
  const { row, label, field } = createLabeledRow(control);
  const group = document.createElement('div');
  group.className = 'segmented';
  group.setAttribute('data-testid', control.item_id);

  const radios = [];
  options.forEach((opt, idx) => {
    const radioId = `${sanitiseName(control.item_id)}__${idx}`;
    const radioWrapper = document.createElement('label');
    radioWrapper.className = 'segmented-option';
    const input = document.createElement('input');
    input.type = 'radio';
    input.name = control.item_id;
    input.value = String(opt);
    input.id = radioId;
    const span = document.createElement('span');
    span.textContent = opt;
    radioWrapper.append(input, span);
    group.append(radioWrapper);
    radios.push(input);
  });

  field.append(group);
  container.append(row);

  const binding = {
    skip: false,
    getValue: () => radios.find((r) => r.checked)?.value ?? options[0],
    setValue: (value) => {
      binding.skip = true;
      radios.forEach((radio, idx) => {
        if (value === options[idx] || value === idx || value === radio.value) {
          radio.checked = true;
        }
      });
      binding.skip = false;
    },
  };
  registerControl(control, binding);

  radios.forEach((radio) => {
    radio.addEventListener('change', async () => {
      if (binding.skip || !radio.checked) return;
      await applySpecAction(store, backend, control, radio.value);
    });
  });
}

function renderSlider(container, control) {
  const { row, label, field } = createLabeledRow(control);
  const inputId = `${sanitiseName(control.item_id)}__slider`;
  label.setAttribute('for', inputId);
  const input = document.createElement('input');
  input.type = 'range';
  input.min = '0';
  input.max = '1';
  input.step = control.type === 'slider_int' ? '1' : '0.01';
  input.setAttribute('data-testid', control.item_id);
  input.id = inputId;

  const valueLabel = document.createElement('span');
  valueLabel.className = 'slider-value';

  field.append(input, valueLabel);
  container.append(row);

  const binding = {
    skip: false,
    getValue: () => Number(input.value),
    setValue: (value) => {
      binding.skip = true;
      input.value = String(value ?? 0);
      valueLabel.textContent = Number(input.value).toFixed(3);
      binding.skip = false;
    },
  };
  registerControl(control, binding);

  input.addEventListener('input', async () => {
    if (binding.skip) return;
    valueLabel.textContent = Number(input.value).toFixed(3);
    await applySpecAction(store, backend, control, Number(input.value));
  });
  valueLabel.textContent = Number(input.value).toFixed(3);
}

function renderEditInput(container, control, mode = 'text') {
  const { row, label, field } = createLabeledRow(control);
  const inputId = `${sanitiseName(control.item_id)}__edit`;
  label.setAttribute('for', inputId);
  const input = document.createElement('input');
  input.id = inputId;
  input.setAttribute('data-testid', control.item_id);
  input.autocomplete = 'off';
  input.spellcheck = false;
  if (mode === 'int') {
    input.type = 'number';
    input.step = '1';
    input.inputMode = 'numeric';
  } else if (mode === 'float') {
    input.type = 'number';
    input.step = '0.001';
    input.inputMode = 'decimal';
  } else {
    input.type = 'text';
  }
  field.append(input);
  container.append(row);

  const binding = {
    skip: false,
    getValue: () => {
      if (mode === 'text') return input.value;
      const value = Number(input.value);
      return Number.isFinite(value) ? value : 0;
    },
    setValue: (value) => {
      binding.skip = true;
      if (mode === 'text') {
        input.value = value == null ? '' : String(value);
      } else {
        const numeric = Number(value);
        input.value = Number.isFinite(numeric) ? String(numeric) : '';
      }
      binding.skip = false;
    },
  };
  registerControl(control, binding);

  async function commit() {
    if (binding.skip) return;
    let raw;
    if (mode === 'text') {
      raw = input.value;
    } else {
      const numeric = Number(input.value);
      raw = Number.isFinite(numeric) ? numeric : 0;
    }
    await applySpecAction(store, backend, control, raw);
  }

  input.addEventListener('change', commit);
  input.addEventListener('blur', commit);
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      commit();
      input.blur();
    }
  });
}

function renderStatic(container, control) {
  const row = createControlRow(control, { full: true });
  row.classList.add('control-static');
  row.textContent = control.label ?? control.name ?? '';
  row.setAttribute('data-testid', control.item_id);
  container.append(row);
}

function renderSeparator(container, control) {
  const row = createControlRow(control, { full: true });
  const sep = document.createElement('div');
  sep.className = 'control-separator';
  sep.textContent = control.label ?? '';
  sep.setAttribute('data-testid', control.item_id);
  row.append(sep);
  container.append(row);
}

function renderControl(container, control) {
  switch (control.type) {
    case 'checkbox':
      return renderCheckbox(container, control);
    case 'button':
      return renderButton(container, control);
    case 'button-secondary':
      return renderButton(container, control, 'secondary');
    case 'radio':
      return renderRadio(container, control);
    case 'select':
      return renderSelect(container, control);
    case 'slider_int':
    case 'slider_float':
    case 'slider':
    case 'slider_num':
    case 'slidernum':
      return renderSlider(container, control);
    case 'edit_int':
      return renderEditInput(container, control, 'int');
    case 'edit_float':
      return renderEditInput(container, control, 'float');
    case 'edit_text':
      return renderEditInput(container, control, 'text');
    case 'static':
      return renderStatic(container, control);
    case 'separator':
      return renderSeparator(container, control);
    default:
      return renderStatic(container, control);
  }
}

function renderSection(container, section) {
  const sectionEl = document.createElement('section');
  sectionEl.className = 'ui-section';
  sectionEl.dataset.sectionId = section.section_id;
  sectionEl.setAttribute('data-testid', `section-${section.section_id}`);

  const header = document.createElement('div');
  header.className = 'section-header';

  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'section-toggle';
  toggle.textContent = section.title ?? section.section_id;

  const actions = document.createElement('div');
  actions.className = 'section-actions';
  const reset = document.createElement('button');
  reset.type = 'button';
  reset.className = 'section-reset';
  reset.title = 'Reset to defaults';
  reset.textContent = '⟳';
  reset.disabled = true;
  const chevron = document.createElement('span');
  chevron.className = 'section-chevron';
  chevron.setAttribute('aria-hidden', 'true');

  actions.append(reset, chevron);
  header.append(toggle, actions);

  const body = document.createElement('div');
  body.className = 'section-body';

  toggle.addEventListener('click', () => {
    sectionEl.classList.toggle('is-collapsed');
  });
  header.addEventListener('click', (event) => {
    if (event.target === reset) return;
    if (event.target !== toggle) {
      sectionEl.classList.toggle('is-collapsed');
    }
  });

  sectionEl.append(header, body);

  for (const item of section.items ?? []) {
    renderControl(body, item);
  }
  container.append(sectionEl);
}

function renderPanels(spec) {
  console.log('[ui] render panels', spec.left.length, spec.right.length);
  leftPanel.innerHTML = '';
  rightPanel.innerHTML = '';
  for (const section of spec.left) {
    renderSection(leftPanel, section);
  }
  for (const section of spec.right) {
    renderSection(rightPanel, section);
  }
}

function updateOverlay(card, visible) {
  if (!card) return;
  card.classList.toggle('visible', !!visible);
}

function updateToast(state) {
  if (!toastEl) return;
  if (state.toast?.message) {
    toastEl.textContent = state.toast.message;
    toastEl.classList.add('visible');
    clearTimeout(updateToast._timer);
    updateToast._timer = setTimeout(() => {
      toastEl.classList.remove('visible');
    }, 1800);
  } else {
    toastEl.classList.remove('visible');
  }
}

function updateHud(state) {
  const displayTime = typeof state.hud?.time === 'number' ? state.hud.time : 0;
  if (simTimeEl) {
    simTimeEl.textContent = `t = ${displayTime.toFixed(3)}`;
  }
  if (simStatusEl) {
    const status = state.simulation.run ? 'running' : 'paused';
    const ngeom = state.hud.ngeom ?? 0;
    const rate = Number.isFinite(state.hud.rate) ? state.hud.rate : 1;
    const drawn = renderStats.drawn ?? 0;
    const pausedSource = state.hud.pausedSource ?? 'backend';
    const rateSource = state.hud.rateSource ?? 'backend';
    simStatusEl.textContent = `${status} | ngeom=${ngeom} (visible ${drawn}) | rate=${rate
      .toFixed(2)}x [${rateSource}] | pause:${pausedSource}`;
  }
  if (cameraSummaryEl) {
    cameraSummaryEl.textContent = `camera: ${state.runtime.cameraLabel}`;
  }
  if (gestureEl) {
    const action = state.runtime.lastAction || 'idle';
    gestureEl.textContent = `gesture: ${action}`;
  }
}

function updatePanels(state) {
  if (leftPanel) {
    leftPanel.classList.toggle('is-hidden', !state.panels.left);
  }
  if (rightPanel) {
    rightPanel.classList.toggle('is-hidden', !state.panels.right);
  }
  document.body.classList.toggle('fullscreen', !!state.overlays.fullscreen);
}

function updateControls(state) {
  for (const [id, binding] of controlBindings.entries()) {
    if (!binding || !binding.setValue) continue;
    const control = controlById.get(id);
    if (!control) continue;
    const value = readControlValue(state, control);
    binding.setValue?.(value);
  }
}

store.subscribe((state) => {
  if (latestSnapshot) {
    renderScene(latestSnapshot, state);
  }
  updateOverlay(overlayHelp, state.overlays.help);
  updateOverlay(overlayInfo, state.overlays.info);
  updateOverlay(overlayProfiler, state.overlays.profiler);
  updateOverlay(overlaySensor, state.overlays.sensor);
  updateHud(state);
  updatePanels(state);
  updateToast(state);
  updateControls(state);
});

const spec = await loadUiSpec();
renderPanels(spec);
updateControls(store.get());
if (typeof window !== 'undefined') {
  try {
    window.__viewerStore = store;
    window.__viewerControls = {
      getBinding: (id) => controlById.get(id)?.binding ?? null,
      listIds: (prefix) => {
        const ids = Array.from(controlById.keys()).sort();
        if (!prefix) return ids;
        return ids.filter((id) => id.startsWith(prefix));
      },
    };
    window.__viewerRenderer = {
      getStats: () => ({ ...renderStats }),
      getContext: () => renderCtx.initialized ? renderCtx : null,
    };
  } catch {}
}

function bool(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const v = value.toLowerCase();
    return v === '1' || v === 'true' || v === 'on';
  }
  return !!value;
}

async function toggleControl(id, overrideValue) {
  const control = controlById.get(id);
  if (!control) return;
  const current = readControlValue(store.get(), control);
  let next = overrideValue;

  if (next === undefined) {
    if (control.type === 'radio' && Array.isArray(control.options)) {
      const currentLabel = typeof current === 'string' ? current : '';
      const currentIndex = control.options.findIndex((opt) => opt === currentLabel);
      const nextIndex = currentIndex === 0 ? 1 : 0;
      next = control.options[nextIndex] ?? control.options[0];
    } else if (control.type === 'select') {
      const nextIndex = typeof current === 'number' ? (current + 1) % (normaliseOptions(control.options).length || 1) : 0;
      next = nextIndex;
    } else {
      next = !bool(current);
    }
  }

  await applySpecAction(store, backend, control, next);
}

async function cycleCamera(delta) {
  const control = controlById.get('rendering.camera_mode');
  if (!control) return;
  const current = store.get().runtime.cameraIndex | 0;
  const total = CAMERA_PRESETS.length || 1;
  const next = (current + delta + total) % total;
  await applySpecAction(store, backend, control, next);
}

function clampCameraIndex(index) {
  const total = CAMERA_PRESETS.length;
  if (index < 0) return total - 1;
  if (index >= total) return 0;
  return index;
}

window.addEventListener('keydown', async (event) => {
  switch (event.key) {
    case 'F1':
      event.preventDefault();
      await toggleControl('option.help');
      break;
    case 'F2':
      event.preventDefault();
      await toggleControl('option.info');
      break;
    case 'F3':
      event.preventDefault();
      await toggleControl('option.profiler');
      break;
    case 'F4':
      event.preventDefault();
      await toggleControl('option.sensor');
      break;
    case 'F5':
      event.preventDefault();
      await toggleControl('option.fullscreen');
      break;
    case ' ':
      event.preventDefault();
      await toggleControl('simulation.run');
      break;
    case 'ArrowRight':
      event.preventDefault();
      await backend.step?.(1);
      break;
    case 'ArrowLeft':
      event.preventDefault();
      await backend.step?.(-1);
      break;
    case 'Control':
      store.update((draft) => {
        draft.runtime.lastAction = 'rotate';
      });
      break;
  case 'Tab':
    event.preventDefault();
    store.update((draft) => {
      if (event.shiftKey) {
        draft.panels.right = !draft.panels.right;
      } else {
        draft.panels.left = !draft.panels.left;
      }
    });
    break;
    case ']':
      event.preventDefault();
      await cycleCamera(1);
      break;
    case '[':
      event.preventDefault();
      await cycleCamera(-1);
      break;
    default:
      break;
  }
});

const pointerState = {
  id: null,
  mode: 'idle',
  lastX: null,
  lastY: null,
  active: false,
};
const modifierState = {
  ctrl: false,
  shift: false,
  alt: false,
  meta: false,
};

if (typeof window !== 'undefined') {
  window.addEventListener(
    'keydown',
    (event) => {
      if (event.key === 'Control' || event.ctrlKey) modifierState.ctrl = true;
      if (event.key === 'Shift' || event.shiftKey) modifierState.shift = true;
      if (event.key === 'Alt' || event.altKey) modifierState.alt = true;
      if (event.key === 'Meta' || event.metaKey) modifierState.meta = true;
    },
    { capture: true }
  );
  window.addEventListener(
    'keyup',
    (event) => {
      if (!event.ctrlKey || event.key === 'Control') modifierState.ctrl = false;
      if (!event.shiftKey || event.key === 'Shift') modifierState.shift = false;
      if (!event.altKey || event.key === 'Alt') modifierState.alt = false;
      if (!event.metaKey || event.key === 'Meta') modifierState.meta = false;
    },
    { capture: true }
  );
  window.addEventListener(
    'blur',
    () => {
      modifierState.ctrl = false;
      modifierState.shift = false;
      modifierState.alt = false;
      modifierState.meta = false;
    },
    { capture: true }
  );
}

function currentCtrl(event) {
  return !!event?.ctrlKey || modifierState.ctrl;
}

function currentShift(event) {
  return !!event?.shiftKey || modifierState.shift;
}

function resolveGestureMode(event) {
  const btn = typeof event.button === 'number' ? event.button : 0;
  if (currentCtrl(event)) {
    return 'rotate';
  }
  if (currentShift(event)) {
    return 'translate';
  }
  if (btn === 2) {
    return 'translate';
  }
  if (btn === 1) {
    return 'zoom';
  }
  return 'orbit';
}

function pointerButtons(event) {
  if (event && typeof event.buttons === 'number') return event.buttons;
  if (event && typeof event.button === 'number') {
    switch (event.button) {
      case 0:
        return 1;
      case 1:
        return 4;
      case 2:
        return 2;
      default:
        return 1 << event.button;
    }
  }
  return 0;
}

function beginGesture(event) {
  pointerState.id = typeof event.pointerId === 'number' ? event.pointerId : null;
  pointerState.mode = resolveGestureMode(event);
  pointerState.lastX = event.clientX ?? 0;
  pointerState.lastY = event.clientY ?? 0;
  pointerState.active = true;
  if (typeof event.pointerId === 'number') {
    try {
      canvas.setPointerCapture(event.pointerId);
    } catch {}
  }
  applyGesture(store, backend, {
    mode: pointerState.mode,
    phase: 'start',
    pointer: {
      x: pointerState.lastX,
      y: pointerState.lastY,
      dx: 0,
      dy: 0,
      buttons: pointerButtons(event),
      pressure: Number(event.pressure ?? 0),
    },
  });
}

function moveGesture(event) {
  if (!pointerState.active) return;
  if (typeof event.pointerId === 'number' && pointerState.id !== null && event.pointerId !== pointerState.id) {
    return;
  }
  const currentX = event.clientX ?? pointerState.lastX ?? 0;
  const currentY = event.clientY ?? pointerState.lastY ?? 0;
  const prevX = pointerState.lastX ?? currentX;
  const prevY = pointerState.lastY ?? currentY;
  pointerState.lastX = currentX;
  pointerState.lastY = currentY;
  applyCameraGesture(pointerState.mode, currentX - prevX, currentY - prevY);
  applyGesture(store, backend, {
    mode: pointerState.mode,
    phase: 'move',
    pointer: {
      x: currentX,
      y: currentY,
      dx: currentX - prevX,
      dy: currentY - prevY,
      buttons: pointerButtons(event),
      pressure: Number(event.pressure ?? 0),
    },
  });
}

function endGesture(event, { releaseCapture = true } = {}) {
  if (!pointerState.active) return;
  const pointerId =
    typeof event?.pointerId === 'number'
      ? event.pointerId
      : pointerState.id !== null
      ? pointerState.id
      : undefined;
  if (
    typeof pointerId === 'number' &&
    pointerState.id !== null &&
    pointerId !== pointerState.id
  ) {
    return;
  }
  const currentX = typeof event?.clientX === 'number' ? event.clientX : pointerState.lastX ?? 0;
  const currentY = typeof event?.clientY === 'number' ? event.clientY : pointerState.lastY ?? 0;
  applyGesture(store, backend, {
    mode: pointerState.mode,
    phase: 'end',
    pointer: {
      x: currentX,
      y: currentY,
      dx: 0,
      dy: 0,
      buttons: pointerButtons(event),
      pressure: Number(event?.pressure ?? 0),
    },
  });
  if (releaseCapture && typeof pointerId === 'number') {
    try {
      canvas.releasePointerCapture(pointerId);
    } catch {}
  }
  pointerState.id = null;
  pointerState.mode = 'idle';
  pointerState.lastX = null;
  pointerState.lastY = null;
  pointerState.active = false;
}

function applyCameraGesture(mode, dx, dy) {
  const ctx = renderCtx;
  const camera = ctx.camera;
  if (!camera) return;
  if (!ctx.cameraTarget) {
    ctx.cameraTarget = new THREE.Vector3(0, 0, 0);
  }
  const target = ctx.cameraTarget;
  const distance = tempVecA.copy(camera.position).sub(target).length();
  const radius = Math.max(ctx.bounds?.radius || 0, 0.6);
  const offset = tempVecA.copy(camera.position).sub(target);
  const elementWidth = canvas?.clientWidth || window.innerWidth || 1;
  const elementHeight = canvas?.clientHeight || window.innerHeight || 1;
  const toRadians = THREE.MathUtils.degToRad(camera.fov || 45);

  switch (mode) {
    case 'translate': {
      const panScale = (distance * Math.tan(toRadians / 2));
      const moveX = (-2 * dx * panScale) / elementHeight;
      const moveY = (2 * dy * panScale) / elementHeight;
      const forward = tempVecB;
      camera.getWorldDirection(forward).normalize();
      const up = tempVecD.copy(GLOBAL_UP);
      const right = tempVecC.copy(forward).cross(up).normalize();
      const pan = right.multiplyScalar(moveX).add(up.multiplyScalar(moveY));
      camera.position.add(pan);
      target.add(pan);
      camera.up.copy(GLOBAL_UP);
      camera.lookAt(target);
      break;
    }
    case 'zoom': {
      const zoomSpeed = distance * 0.002;
      const delta = dy * zoomSpeed;
      const newLen = Math.max(radius * 0.25, distance + delta);
      offset.setLength(newLen);
      camera.position.copy(tempVecC.copy(target).add(offset));
      camera.up.copy(GLOBAL_UP);
      camera.lookAt(target);
      break;
    }
    case 'rotate':
    case 'orbit':
    default: {
      const yaw = (1.6 * Math.PI * dx) / elementWidth;
      const pitch = (1.6 * Math.PI * dy) / elementHeight;
      const orbitOffset = tempVecC.set(offset.x, offset.z, -offset.y);
      tempSpherical.setFromVector3(orbitOffset);
      tempSpherical.theta -= yaw;
      tempSpherical.phi = THREE.MathUtils.clamp(tempSpherical.phi - pitch, 0.05, Math.PI - 0.05);
      orbitOffset.setFromSpherical(tempSpherical);
      offset.set(orbitOffset.x, -orbitOffset.z, orbitOffset.y);
      camera.position.copy(tempVecD.copy(target).add(offset));
      camera.up.copy(GLOBAL_UP);
      camera.lookAt(target);
      break;
    }
  }

  if (debugMode) {
    console.log('[camera] gesture', {
      mode,
      dx,
      dy,
      position: camera.position.toArray().map((v) => Number(v.toFixed(3))),
      target: target.toArray().map((v) => Number(v.toFixed(3))),
    });
  }
}

canvas.addEventListener('pointerdown', (event) => {
  event.preventDefault();
  beginGesture(event);
});

canvas.addEventListener('pointermove', (event) => {
  if (!pointerState.active) return;
  event.preventDefault();
  moveGesture(event);
});

canvas.addEventListener('pointerup', (event) => {
  event.preventDefault();
  endGesture(event);
});

canvas.addEventListener('pointercancel', (event) => {
  endGesture(event);
});

canvas.addEventListener('lostpointercapture', () => {
  if (!pointerState.active) return;
  endGesture(undefined, { releaseCapture: false });
});

canvas.addEventListener('wheel', (event) => {
  if (!renderCtx.camera) return;
  event.preventDefault();
  const delta = event.deltaY;
  if (!Number.isFinite(delta) || delta === 0) return;
  const direction = delta > 0 ? 1 : -1;
  applyCameraGesture('zoom', 0, direction * Math.abs(delta) * 0.35);
});

canvas.addEventListener('contextmenu', (event) => {
  event.preventDefault();
});

canvas.addEventListener('mousedown', (event) => {
  if (pointerState.active) return;
  event.preventDefault();
  beginGesture(event);
});

canvas.addEventListener('mousemove', (event) => {
  if (!pointerState.active) return;
  event.preventDefault();
  moveGesture(event);
});

canvas.addEventListener('mouseup', (event) => {
  if (!pointerState.active) return;
  event.preventDefault();
  endGesture(event);
});

// Keep canvas resized to container.
function resizeCanvas() {
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width;
  canvas.height = rect.height;
}
resizeCanvas();
window.addEventListener('resize', resizeCanvas);

// Initialise control values after DOM render.
updateControls(store.get());

