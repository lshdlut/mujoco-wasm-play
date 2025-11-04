import * as THREE from 'https://unpkg.com/three@0.161.0/build/three.module.js';

import {
  createViewerStore,
  createBackend,
  applySpecAction,
  applyGesture,
  readControlValue,
  mergeBackendSnapshot,
} from './src/viewer/state.mjs';
import { createSceneSnap, diffSceneSnaps } from './local_tools/viewer_demo/snapshots.mjs';

const CAMERA_PRESETS = ['Free', 'Tracking', 'Fixed 1', 'Fixed 2', 'Fixed 3'];
const MJ_GEOM = {
  PLANE: 0,
  HFIELD: 1,
  SPHERE: 2,
  CAPSULE: 3,
  ELLIPSOID: 4,
  CYLINDER: 5,
  BOX: 6,
  MESH: 7,
};

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

const fallbackModeParam = (searchParams.get('fallback') || 'auto').toLowerCase();
const fallbackEnabledDefault = fallbackModeParam !== 'off';
const fallbackPresetParam = (searchParams.get('preset') || 'studio-neutral').toLowerCase();

const FALLBACK_PRESET_ALIASES = {
  'bright-outdoor': 'bright-outdoor',
  bright: 'bright-outdoor',
  outdoor: 'bright-outdoor',
  'studio-clean': 'studio-clean',
  clean: 'studio-clean',
  studio: 'studio-clean',
};

const FALLBACK_PRESETS = {
  // A: Outdoor-Crisp v2 — strong key, long shadows, cold sky reflections
  'bright-outdoor': {
    background: 0xe7edf5,
    exposure: 1.0,
    ambient: { color: 0xffffff, intensity: 0.0 },
    hemi: { sky: 0xe9f1ff, ground: 0xbfc2c5, intensity: 0.1 },
    dir: { color: 0xfff1d6, intensity: 3.0, position: [6, -8, 4] },
    fill: { color: 0xcfe3ff, intensity: 0.35, position: [-6, 6, 3] },
    shadowBias: -0.0001,
    envIntensity: 1.7,
    ground: { style: 'pbr', color: 0xd3d3d3, roughness: 0.6, metalness: 0.0 },
  },
  // B: Studio-Clean-HiKey v2 — bright, clean, no HDRI dependency
  'studio-clean': {
    background: 0xe0e6ef,
    exposure: 1.0,
    ambient: { color: 0xffffff, intensity: 0.0 },
    hemi: { sky: 0xeef5ff, ground: 0xb7bcc2, intensity: 0.8 },
    dir: { color: 0xffffff, intensity: 2.0, position: [5, -6, 4] },
    fill: { color: 0xcfe3ff, intensity: 0.5, position: [-5, 4, 3] },
    shadowBias: -0.0001,
    envIntensity: 1.0,
    ground: { style: 'shadow', opacity: 0.5 },
  },
};



const fallbackPresetKey = FALLBACK_PRESET_ALIASES[fallbackPresetParam] || 'bright-outdoor';
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

function formatNumber(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return '';
  const abs = Math.abs(num);
  if (abs !== 0 && (abs >= 1e6 || abs < 1e-4)) {
    return Number(num.toExponential(4)).toString();
  }
  return Number(num.toPrecision(6)).toString();
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
  assetSource: null,
  assetCache: null,
  meshes: [],
  defaultVopt: null,
  alignSeq: 0,
  copySeq: 0,
  cameraTarget: new THREE.Vector3(0, 0, 0),
  autoAligned: false,
  bounds: null,
  snapshotLogState: null,
};

const tempVecA = new THREE.Vector3();
const tempVecB = new THREE.Vector3();
const tempVecC = new THREE.Vector3();
const tempVecD = new THREE.Vector3();
const tempSpherical = new THREE.Spherical();
const tempVecE = new THREE.Vector3();
const GLOBAL_UP = new THREE.Vector3(0, 0, 1);
let fallbackGroundTexture = null;

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
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0; // 全局基线从 1.0 起
  if ('physicallyCorrectLights' in renderer) {
    renderer.physicallyCorrectLights = true;
  }
  renderer.setClearColor(0x181d28, 1);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x151a26);
  scene.fog = new THREE.Fog(0x151a26, 12, 48);

  const ambient = new THREE.AmbientLight(0xffffff, 0);
  scene.add(ambient);
  const hemi = new THREE.HemisphereLight(0xffffff, 0x10131c, 0);
  scene.add(hemi);
  const dir = new THREE.DirectionalLight(0xffffff, 0);
  dir.position.set(6, -8, 8);
  dir.color.setHSL(0.58, 0.32, 0.92);
  dir.castShadow = true;
  dir.shadow.mapSize.set(4096, 4096);
  dir.shadow.camera.near = 0.5;
  dir.shadow.camera.far = 40;
  dir.shadow.bias = -0.0001;
  if ('normalBias' in dir.shadow) {
    dir.shadow.normalBias = 0.001;
  }
  const lightTarget = new THREE.Object3D();
  scene.add(lightTarget);
  dir.target = lightTarget;
  scene.add(dir);
  const fill = new THREE.DirectionalLight(0xffffff, 0);
  fill.position.set(-6, 6, 3);
  fill.castShadow = false;
  scene.add(fill);

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
    fill,
    hemi,
    ambient,
    assetSource: null,
    assetCache: {
      meshGeometries: new Map(),
    },
    meshes: [],
    defaultVopt: null,
    alignSeq: 0,
    copySeq: 0,
    autoAligned: false,
    bounds: null,
    fallback: {
      enabled: fallbackEnabledDefault,
      preset: fallbackPresetKey,
      mode: fallbackModeParam,
    },
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

function disposeMeshObject(mesh) {
  try {
    if (mesh.userData && mesh.userData.fallbackBackface) {
      const back = mesh.userData.fallbackBackface;
      if (back.material && typeof back.material.dispose === 'function') {
        try { back.material.dispose(); } catch {}
      }
      if (typeof mesh.remove === 'function') {
        try { mesh.remove(back); } catch {}
      }
      mesh.userData.fallbackBackface = null;
    }
  } catch {}

  if (!mesh) return;
  const parent = mesh.parent;
  if (parent && typeof parent.remove === 'function') {
    parent.remove(mesh);
  }
  const ownGeometry = mesh.userData?.ownGeometry !== false;
  if (ownGeometry && mesh.geometry && typeof mesh.geometry.dispose === 'function') {
    try { mesh.geometry.dispose(); } catch {}
  }
  const material = mesh.material;
  if (Array.isArray(material)) {
    for (const mat of material) {
      if (mat && typeof mat.dispose === 'function') {
        try { mat.dispose(); } catch {}
      }
    }
  } else if (material && typeof material.dispose === 'function') {
    try { material.dispose(); } catch {}
  }
}

function syncRendererAssets(ctx, assets) {
  const source = assets || null;
  if (ctx.assetSource === source) return;
  ctx.assetSource = source;
  if (!ctx.meshes) {
    ctx.meshes = [];
    return;
  }
  for (let i = 0; i < ctx.meshes.length; i += 1) {
    if (ctx.meshes[i]) {
      disposeMeshObject(ctx.meshes[i]);
    }
  }
  ctx.meshes = [];
  if (ctx.assetCache && ctx.assetCache.meshGeometries instanceof Map) {
    for (const geometry of ctx.assetCache.meshGeometries.values()) {
      if (geometry && typeof geometry.dispose === 'function') {
        try { geometry.dispose(); } catch {}
      }
    }
    ctx.assetCache.meshGeometries.clear();
  }
  ctx.assetCache = {
    meshGeometries: new Map(),
  };
}

function isSnapshotDebugEnabled() {
  if (typeof window === 'undefined') return false;
  return !!window.PLAY_SNAPSHOT_DEBUG;
}

function getFallbackGroundTexture() {
  if (fallbackGroundTexture) return fallbackGroundTexture;
  if (typeof document === 'undefined') return null;
  const size = 256;
  const step = 32;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx2d = canvas.getContext('2d');
  if (ctx2d) {
    const colors = ['#2a2f38', '#252a34'];
    for (let y = 0; y < size; y += step) {
      for (let x = 0; x < size; x += step) {
        const idx = ((x + y) / step) & 1;
        ctx2d.fillStyle = colors[idx];
        ctx2d.fillRect(x, y, step, step);
      }
    }
    ctx2d.strokeStyle = '#1d212c';
    ctx2d.lineWidth = 1;
    for (let y = 0; y <= size; y += step) {
      ctx2d.beginPath();
      ctx2d.moveTo(0, y + 0.5);
      ctx2d.lineTo(size, y + 0.5);
      ctx2d.stroke();
    }
    for (let x = 0; x <= size; x += step) {
      ctx2d.beginPath();
      ctx2d.moveTo(x + 0.5, 0);
      ctx2d.lineTo(x + 0.5, size);
      ctx2d.stroke();
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(10, 10);
  texture.anisotropy = 8;
  texture.encoding = THREE.sRGBEncoding;
  fallbackGroundTexture = texture;
  return texture;
}

function buildAdapterMeshSnapshot(ctx, assets) {
  if (assets?.meshes) {
    return {
      count: assets.meshes.count ?? 0,
      vertadr: assets.meshes.vertadr ?? null,
      vertnum: assets.meshes.vertnum ?? null,
      faceadr: assets.meshes.faceadr ?? null,
      facenum: assets.meshes.facenum ?? null,
      texcoordadr: assets.meshes.texcoordadr ?? null,
      texcoordnum: assets.meshes.texcoordnum ?? null,
      vert: assets.meshes.vert ?? null,
      face: assets.meshes.face ?? null,
      normal: assets.meshes.normal ?? null,
      texcoord: assets.meshes.texcoord ?? null,
    };
  }

  const cache = ctx?.assetCache?.meshGeometries;
  const entries = cache ? Array.from(cache.entries()).filter(([id, geometry]) => {
    return Number.isInteger(id)
      && id >= 0
      && geometry
      && typeof geometry.getAttribute === 'function';
  }) : [];
  if (!entries.length) {
    return null;
  }
  entries.sort((a, b) => (a[0] | 0) - (b[0] | 0));
  const maxId = entries[entries.length - 1][0] | 0;
  const vertadr = new Int32Array(maxId + 1);
  const vertnum = new Int32Array(maxId + 1);
  const faceadr = new Int32Array(maxId + 1);
  const facenum = new Int32Array(maxId + 1);
  const texcoordadr = new Int32Array(maxId + 1);
  const texcoordnum = new Int32Array(maxId + 1);
  const vertData = [];
  const faceData = [];
  const normalData = [];
  const texcoordData = [];
  let vertCursor = 0;
  let faceCursor = 0;
  let texCursor = 0;
  for (const [meshId, geometry] of entries) {
    const positionAttr = geometry.getAttribute('position');
    const normalAttr = geometry.getAttribute('normal');
    const uvAttr = geometry.getAttribute('uv');
    const indexAttr = geometry.getIndex ? geometry.getIndex() : null;

    const positionArray = positionAttr?.array;
    const vertexCount = positionArray ? Math.floor(positionArray.length / 3) : 0;
    vertadr[meshId] = vertCursor;
    vertnum[meshId] = vertexCount;
    if (vertexCount > 0 && positionArray) {
      for (let i = 0; i < positionArray.length; i += 1) {
        vertData.push(Number(positionArray[i]) || 0);
      }
      vertCursor += vertexCount;
    }

    if (indexAttr && indexAttr.array) {
      const indexArray = indexAttr.array;
      const triCount = Math.floor(indexArray.length / 3);
      faceadr[meshId] = faceCursor;
      facenum[meshId] = triCount;
      for (let i = 0; i < indexArray.length; i += 1) {
        faceData.push(Number(indexArray[i]) || 0);
      }
      faceCursor += triCount;
    } else {
      faceadr[meshId] = faceCursor;
      facenum[meshId] = 0;
    }

    if (normalAttr && normalAttr.array) {
      const normalArray = normalAttr.array;
      for (let i = 0; i < normalArray.length; i += 1) {
        normalData.push(Number(normalArray[i]) || 0);
      }
    }

    if (uvAttr && uvAttr.array) {
      const uvArray = uvAttr.array;
      const uvCount = Math.floor(uvArray.length / 2);
      texcoordadr[meshId] = texCursor;
      texcoordnum[meshId] = uvCount;
      for (let i = 0; i < uvArray.length; i += 1) {
        texcoordData.push(Number(uvArray[i]) || 0);
      }
      texCursor += uvCount;
    } else {
      texcoordadr[meshId] = texCursor;
      texcoordnum[meshId] = 0;
    }
  }

  return {
    count: maxId + 1,
    vertadr,
    vertnum,
    faceadr,
    facenum,
    texcoordadr,
    texcoordnum,
    vert: vertData.length ? new Float32Array(vertData) : new Float32Array(0),
    face: faceData.length ? new Int32Array(faceData) : new Int32Array(0),
    normal: normalData.length ? new Float32Array(normalData) : null,
    texcoord: texcoordData.length ? new Float32Array(texcoordData) : null,
  };
}

function hasModelEnvironment(state) {
  const env = state?.rendering?.environment;
  if (!env) return false;
  if (env.hdr || env.texture || env.color) return true;
  if (Array.isArray(env.sources) && env.sources.length > 0) return true;
  return false;
}

function hasModelLights(state) {
  const lights = state?.rendering?.lights;
  return Array.isArray(lights) && lights.length > 0;
}

function hasModelBackground(state) {
  const bg = state?.rendering?.background;
  if (!bg) return false;
  return bg.color != null || !!bg.texture;
}

function applyFallbackAppearance(ctx, state) {
  const fallback = ctx.fallback || { enabled: fallbackEnabledDefault, preset: fallbackPresetKey };
  const preset = FALLBACK_PRESETS[fallback.preset] || FALLBACK_PRESETS[fallbackPresetKey];
  const renderer = ctx.renderer;
  if (renderer) {
    renderer.toneMappingExposure = preset.exposure ?? 1.0;
  }

  if (!fallback.enabled) {
    if (!hasModelLights(state)) {
      if (ctx.ambient) ctx.ambient.intensity = 0;
      if (ctx.hemi) ctx.hemi.intensity = 0;
      if (ctx.light) ctx.light.intensity = 0;
    }
    return;
  }

  if (!hasModelBackground(state) && ctx.scene) {
    // Background: Outdoor uses sky (set in ensureOutdoorSkyEnv); Studio uses gradient
    if (fallback.preset === 'studio-clean') {
      if (!ctx.studioBgTex) {
        ctx.studioBgTex = createVerticalGradientTexture(0xeef5ff, 0xd2dae6, 256);
      }
      ctx.scene.background = ctx.studioBgTex;
      if (ctx.scene.environment) {
        // No HDRI in studio preset by default
        ctx.scene.environment = null;
      }
    } else {
      ctx.scene.background = new THREE.Color(preset.background ?? 0xe7edf5);
    }
  }

  if (!hasModelLights(state)) {
    if (ctx.ambient) {
      const ambientCfg = preset.ambient || {};
      ctx.ambient.color.setHex(ambientCfg.color ?? 0xffffff);
      ctx.ambient.intensity = ambientCfg.intensity ?? 0.2;
    }
    if (ctx.hemi) {
      const hemiCfg = preset.hemi || {};
      ctx.hemi.color.setHex(hemiCfg.sky ?? 0xffffff);
      ctx.hemi.groundColor.setHex(hemiCfg.ground ?? 0x20242f);
      ctx.hemi.intensity = hemiCfg.intensity ?? 0.6;
    }
    if (ctx.light) {
      const dirCfg = preset.dir || {};
      ctx.light.color.setHex(dirCfg.color ?? 0xffffff);
      ctx.light.intensity = dirCfg.intensity ?? 1.8;
      if (Array.isArray(dirCfg.position) && dirCfg.position.length === 3) {
        ctx.light.position.set(dirCfg.position[0], dirCfg.position[1], dirCfg.position[2]);
      }
      if (ctx.lightTarget && Array.isArray(dirCfg.target) && dirCfg.target.length === 3) {
        ctx.lightTarget.position.set(dirCfg.target[0], dirCfg.target[1], dirCfg.target[2]);
      }
      if (ctx.light.shadow) {
        ctx.light.shadow.bias = dirCfg.shadowBias ?? preset.shadowBias ?? ctx.light.shadow.bias;
      }
    }
    if (ctx.fill) {
      const fillCfg = preset.fill || {};
      ctx.fill.color.setHex(fillCfg.color ?? 0xcfe3ff);
      ctx.fill.intensity = fillCfg.intensity ?? 0.3;
      if (Array.isArray(fillCfg.position) && fillCfg.position.length === 3) {
        ctx.fill.position.set(fillCfg.position[0], fillCfg.position[1], fillCfg.position[2]);
      }
    }
  }

  // Environment handling: prefer model; otherwise Outdoor builds Sky+PMREM; Studio uses no HDRI
  const hasEnv = hasModelEnvironment(state);
  if (!hasEnv && fallback.enabled) {
    if (fallback.preset === 'bright-outdoor') {
      ensureOutdoorSkyEnv(ctx, preset);
    } else {
      // Clear any previous env
      if (ctx.scene && ctx.scene.environment) ctx.scene.environment = null;
    }
  }
}

// Build a small vertical gradient texture for background
function createVerticalGradientTexture(topHex, bottomHex, height = 256) {
  const width = 2;
  const h = Math.max(8, height | 0);
  const data = new Uint8Array(width * h * 4);
  const top = new THREE.Color(topHex);
  const bot = new THREE.Color(bottomHex);
  for (let y = 0; y < h; y += 1) {
    const t = y / (h - 1);
    const r = bot.r * t + top.r * (1 - t);
    const g = bot.g * t + top.g * (1 - t);
    const b = bot.b * t + top.b * (1 - t);
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      data[i + 0] = Math.round(r * 255);
      data[i + 1] = Math.round(g * 255);
      data[i + 2] = Math.round(b * 255);
      data[i + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, width, h);
  tex.needsUpdate = true;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Ensure Outdoor-Crisp sky + PMREM environment
function ensureOutdoorSkyEnv(ctx, preset) {
  if (!ctx || !ctx.renderer || !ctx.scene) return;
  if (!ctx.pmrem) {
    ctx.pmrem = new THREE.PMREMGenerator(ctx.renderer);
  }
  // Try HDRI first if provided via query (?hdri=url) or known local candidates
  if (!ctx.envFromHDRI && !hasModelEnvironment(store.get())) {
    const hdriParam = searchParams.get('hdri');
    const candidates = [];
    if (hdriParam) candidates.push(hdriParam);
    candidates.push('local_tools/assets/env/sky_clear_4k.hdr');
    candidates.push('dist/assets/env/sky_clear_4k.hdr');
    const tryLoadHDRI = async (url) => {
      try {
        const mod = await import('https://unpkg.com/three@0.161.0/examples/jsm/loaders/RGBELoader.js?module');
        if (!mod || !mod.RGBELoader) return false;
        const loader = new mod.RGBELoader();
        const hdr = await new Promise((resolve, reject) => loader.load(url, resolve, undefined, reject));
        const envRT = ctx.pmrem.fromEquirectangular(hdr);
        hdr.dispose?.();
        if (ctx.scene) ctx.scene.environment = envRT.texture;
        ctx.envRT = envRT;
        ctx.envFromHDRI = true;
        const intensity = preset?.envIntensity ?? 1.7;
        if (Array.isArray(ctx.meshes)) {
          for (const m of ctx.meshes) {
            if (m && m.material && 'envMapIntensity' in m.material) {
              m.material.envMapIntensity = intensity;
            }
          }
        }
        return true;
      } catch (e) {
        if (typeof console !== 'undefined') console.warn('[env] HDRI load failed', { url, error: String(e) });
        return false;
      }
    };
    (async () => {
      for (const url of candidates) {
        // eslint-disable-next-line no-await-in-loop
        if (await tryLoadHDRI(url)) { ctx.envDirty = false; return; }
      }
    })();
  }
  if (!ctx.skyInit) {
    ctx.skyInit = true;
    try {
      import('https://unpkg.com/three@0.161.0/examples/jsm/objects/Sky.js?module').then((mod) => {
        if (!mod || !mod.Sky) return;
        const sky = new mod.Sky();
        sky.scale.setScalar(450000);
        ctx.scene.add(sky);
        ctx.sky = sky;
        ctx.sunVec = new THREE.Vector3();
      }).catch(() => {});
    } catch {}
  }
  if (!ctx.envFromHDRI && ctx.sky && ctx.pmrem) {
    const sky = ctx.sky;
    const uniforms = sky.material.uniforms;
    const cfg = preset || {};
    uniforms['turbidity'].value = 5.0;
    uniforms['rayleigh'].value = 2.5;
    uniforms['mieCoefficient'].value = 0.004;
    uniforms['mieDirectionalG'].value = 0.8;
    // Link sun to key light direction
    if (ctx.light) {
      const L = ctx.light.position.clone().normalize();
      ctx.sunVec.copy(L);
      uniforms['sunPosition'].value.copy(ctx.sunVec);
    }
    // Bake environment
    if (!ctx.envRT || ctx.envDirty) {
      if (ctx.envRT) { ctx.envRT.dispose(); }
      ctx.envRT = ctx.pmrem.fromScene(sky);
      if (ctx.scene) ctx.scene.environment = ctx.envRT.texture;
      ctx.envDirty = false;
      // apply env intensity to materials
      const intensity = cfg.envIntensity ?? 1.3;
      if (Array.isArray(ctx.meshes)) {
        for (const m of ctx.meshes) {
          if (m && m.material && 'envMapIntensity' in m.material) {
            m.material.envMapIntensity = intensity;
          }
        }
      }
    }
    // Prefer visible procedural sky as background
    if (ctx.scene) {
      ctx.scene.background = null;
    }
  }
}

function emitAdapterSceneSnapshot(ctx, snapshot, state) {
  if (!isSnapshotDebugEnabled()) return;
  if (!ctx || !snapshot || typeof window === 'undefined') return;
  try {
    const assets = state?.rendering?.assets || null;
    ctx.snapshotFrameCounter = (ctx.snapshotFrameCounter || 0) + 1;
    const frameIndex = ctx.snapshotFrameCounter;
    const shouldSample = frameIndex === 1 || (frameIndex % 60) === 0;
    const geomTypes = assets?.geoms?.type ?? snapshot.gtype;
    if (!shouldSample || !geomTypes || !geomTypes.length) {
      return;
    }
    const geomSizes = assets?.geoms?.size ?? snapshot.gsize;
    const geomMatIds = assets?.geoms?.matid ?? snapshot.gmatid;
    const geomDataIds = assets?.geoms?.dataid ?? snapshot.gdataid;
    const materialRgba = assets?.materials?.rgba ?? snapshot.matrgba;
    const meshData = buildAdapterMeshSnapshot(ctx, assets);
    const sceneSnap = createSceneSnap({
      frame: frameIndex,
      ngeom: snapshot.ngeom,
      gtype: geomTypes,
      gsize: geomSizes,
      gmatid: geomMatIds,
      matrgba: materialRgba,
      gdataid: geomDataIds,
      xpos: snapshot.xpos,
      xmat: snapshot.xmat,
      mesh: meshData,
    });
    window.__sceneSnaps = window.__sceneSnaps || {};
    window.__sceneSnaps.adapter = sceneSnap;
    const simSnap = window.__sceneSnaps.sim;
    if (simSnap) {
      const diff = diffSceneSnaps(simSnap, sceneSnap);
      const now = Date.now();
      const stateRef = ctx.snapshotLogState || { lastOkTs: 0, lastFailTs: 0 };
      if (diff.ok) {
        if (!stateRef.lastOkTs || (now - stateRef.lastOkTs) > 3000) {
          console.log('[snapshot] adapter OK', { frame: sceneSnap.frame, ngeom: sceneSnap.geoms.length });
          stateRef.lastOkTs = now;
        }
      } else {
        if (!stateRef.lastFailTs || (now - stateRef.lastFailTs) > 1500) {
          console.warn('[snapshot] adapter mismatch', diff.differences.slice(0, 4));
          stateRef.lastFailTs = now;
        }
      }
      ctx.snapshotLogState = stateRef;
    }
  } catch (err) {
    if (debugMode) {
      console.warn('[snapshot] adapter capture failed', err);
    }
  }
}

function createPrimitiveGeometry(gtype, sizeVec, options = {}) {
  const fallbackEnabled = options.fallbackEnabled !== false;
  const preset = options.preset || 'bright-outdoor';
  let geometry;
  let materialOpts = {
    color: 0x6fa0ff,
    metalness: 0.05,
    roughness: 0.65,
  };
  let postCreate = null;
  switch (gtype) {
    case MJ_GEOM.SPHERE:
    case MJ_GEOM.ELLIPSOID:
      geometry = new THREE.SphereGeometry(1, 24, 16);
      if (Array.isArray(sizeVec)) {
        const ax = Math.max(1e-6, sizeVec[0] || 0);
        const ay = Math.max(1e-6, (sizeVec[1] ?? sizeVec[0]) || 0);
        const az = Math.max(1e-6, (sizeVec[2] ?? sizeVec[0]) || 0);
        geometry.scale(ax, ay, az);
      }
      break;
    case MJ_GEOM.CAPSULE:
      {
        const radius = Math.max(1e-6, sizeVec?.[0] || 0.05);
        const halfLength = Math.max(0, sizeVec?.[1] || 0);
        geometry = new THREE.CapsuleGeometry(radius, Math.max(0, 2 * halfLength), 16, 12);
      }
      break;
    case MJ_GEOM.CYLINDER:
      {
        const radius = Math.max(1e-6, sizeVec?.[0] || 0.05);
        const halfLength = Math.max(0, sizeVec?.[1] || 0.05);
        geometry = new THREE.CylinderGeometry(radius, radius, Math.max(1e-6, 2 * halfLength), 24, 1);
      }
      break;
    case MJ_GEOM.PLANE:
    case MJ_GEOM.HFIELD:
      {
        const width = Math.max(1, Math.abs(sizeVec?.[0] || 0) > 1e-6 ? (sizeVec[0] * 2) : 20);
        const height = Math.max(1, Math.abs(sizeVec?.[1] || 0) > 1e-6 ? (sizeVec[1] * 2) : 20);
        geometry = new THREE.PlaneGeometry(width, height, 1, 1);
      }
      if (fallbackEnabled && preset === 'studio-clean') {
        materialOpts = { shadow: true, shadowOpacity: options.groundBackfaceOpacity ?? 0.45 };
      } else {
        materialOpts = { color: 0xdcdcdc, metalness: 0.0, roughness: 0.8, map: null };
      }
      postCreate = (mesh) => {
        mesh.rotation.x = -Math.PI / 2;
        mesh.receiveShadow = true;
        try {
          const backMat = mesh.material.clone();
          backMat.side = THREE.BackSide;
          backMat.transparent = true;
          backMat.opacity = 0.35;
          backMat.depthWrite = false;
          backMat.polygonOffset = true;
          backMat.polygonOffsetFactor = -1;
          const backMesh = new THREE.Mesh(mesh.geometry, backMat);
          backMesh.receiveShadow = false;
          backMesh.castShadow = false;
          backMesh.renderOrder = (mesh.renderOrder || 0) + 0.01;
          mesh.add(backMesh);
          mesh.userData = mesh.userData || {};
          mesh.userData.fallbackBackface = backMesh;
        } catch {}
      };
      break;
    default:
      {
        const sx = Math.max(1e-6, sizeVec?.[0] || 0.1);
        const sy = Math.max(1e-6, sizeVec?.[1] || sx);
        const sz = Math.max(1e-6, sizeVec?.[2] || sx);
        geometry = new THREE.BoxGeometry(2 * sx, 2 * sy, 2 * sz);
      }
      break;
  }
  if (geometry && typeof geometry.computeBoundingBox === 'function') {
    geometry.computeBoundingBox();
  }
  if (geometry && typeof geometry.computeBoundingSphere === 'function') {
    geometry.computeBoundingSphere();
  }
  return { geometry, materialOpts, postCreate };
}

function createMeshGeometryFromAssets(assets, meshId) {
  if (!assets || !assets.meshes || !(meshId >= 0)) return null;
  const { vert, vertadr, vertnum, face, faceadr, facenum, normal, texcoord, texcoordadr, texcoordnum } = assets.meshes;
  if (!vert || !vertadr || !vertnum) return null;
  const count = vertnum[meshId] | 0;
  if (!(count > 0)) return null;
  const start = (vertadr[meshId] | 0) * 3;
  const end = start + (count * 3);
  if (start < 0 || end > vert.length) return null;
  const positions = vert.slice(start, end);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

  if (normal && normal.length >= end) {
    const normalSlice = normal.slice(start, end);
    geometry.setAttribute('normal', new THREE.BufferAttribute(normalSlice, 3));
  }

  if (face && faceadr && facenum) {
    const triCount = facenum[meshId] | 0;
    if (triCount > 0) {
      const faceStart = (faceadr[meshId] | 0) * 3;
      const faceEnd = faceStart + (triCount * 3);
      if (faceStart >= 0 && faceEnd <= face.length) {
        const rawFaces = face.slice(faceStart, faceEnd);
        let needsUint32 = count > 65535;
        if (!needsUint32) {
          for (let i = 0; i < rawFaces.length; i += 1) {
            if (rawFaces[i] > 65535) {
              needsUint32 = true;
              break;
            }
          }
        }
        const IndexCtor = needsUint32 ? Uint32Array : Uint16Array;
        const indices = new IndexCtor(rawFaces);
        geometry.setIndex(new THREE.BufferAttribute(indices, 1));
      }
    }
  }

  if (texcoord && texcoordadr && texcoordnum) {
    const tcCount = texcoordnum[meshId] | 0;
    if (tcCount > 0) {
      const tcStart = (texcoordadr[meshId] | 0) * 2;
      const tcEnd = tcStart + (tcCount * 2);
      if (tcStart >= 0 && tcEnd <= texcoord.length) {
        const uvSlice = texcoord.slice(tcStart, tcEnd);
        geometry.setAttribute('uv', new THREE.BufferAttribute(uvSlice, 2));
      }
    }
  }

  if (!geometry.getAttribute('normal')) {
    geometry.computeVertexNormals();
  }
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

function getSharedMeshGeometry(ctx, assets, dataId) {
  if (!ctx.assetCache || !(ctx.assetCache.meshGeometries instanceof Map)) {
    ctx.assetCache = {
      meshGeometries: new Map(),
    };
  }
  const cache = ctx.assetCache.meshGeometries;
  if (cache.has(dataId)) {
    return cache.get(dataId);
  }
  const geometry = createMeshGeometryFromAssets(assets, dataId);
  if (geometry) {
    cache.set(dataId, geometry);
  }
  return geometry;
}

function ensureGeomMesh(ctx, index, gtype, assets, dataId, sizeVec) {
  if (!ctx.meshes) ctx.meshes = [];
  let mesh = ctx.meshes[index];
  const sizeKey = Array.isArray(sizeVec)
    ? sizeVec.map((v) => (Number.isFinite(v) ? v.toFixed(6) : '0')).join(',')
    : 'null';
  const needsRebuild =
    !mesh ||
    mesh.userData?.geomType !== gtype ||
    (gtype === MJ_GEOM.MESH && mesh.userData?.geomDataId !== dataId) ||
    (gtype !== MJ_GEOM.MESH && mesh.userData?.geomSizeKey !== sizeKey);

  if (needsRebuild) {
    if (mesh) {
      disposeMeshObject(mesh);
    }

    let geometryInfo = null;
    if (gtype === MJ_GEOM.MESH && assets && dataId >= 0) {
      const meshGeometry = getSharedMeshGeometry(ctx, assets, dataId);
      if (!ctx.meshAssetDebugLogged) {
        const meshData = assets.meshes || {};
        console.log('[render] mesh asset', {
          dataId,
          vertnum: meshData.vertnum?.[dataId] ?? null,
          facecount: meshData.facenum?.[dataId] ?? null,
          vertLength: meshData.vert?.length ?? 0,
          faceLength: meshData.face?.length ?? 0,
        });
        ctx.meshAssetDebugLogged = true;
      }
      if (meshGeometry) {
        geometryInfo = {
          geometry: meshGeometry,
          materialOpts: {
            color: 0xffffff,
            metalness: 0.05,
            roughness: 0.55,
          },
          postCreate: null,
          ownGeometry: false,
        };
      } else if (!ctx.meshAssetMissingLogged) {
        console.warn('[render] mesh geometry missing', { dataId });
        ctx.meshAssetMissingLogged = true;
      }
    }
    if (!geometryInfo) {
      geometryInfo = createPrimitiveGeometry(gtype, sizeVec, (function(){ const fb = (renderCtx && renderCtx.fallback) ? renderCtx.fallback : {}; return { fallbackEnabled: (fb.enabled!==false), preset: (fb.preset || 'bright-outdoor') }; })());
      geometryInfo.ownGeometry = true;
    }

    let material;
    if (geometryInfo.materialOpts && geometryInfo.materialOpts.shadow) {
      const op = Number.isFinite(geometryInfo.materialOpts.shadowOpacity)
        ? geometryInfo.materialOpts.shadowOpacity
        : 0.5;
      material = new THREE.ShadowMaterial({ opacity: op });
    } else {
      material = new THREE.MeshStandardMaterial(geometryInfo.materialOpts);
    }
    material.side = THREE.FrontSide;
    mesh = new THREE.Mesh(geometryInfo.geometry, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    if (typeof geometryInfo.postCreate === 'function') {
      try { geometryInfo.postCreate(mesh); } catch {}
    }
    mesh.userData = mesh.userData || {};
    mesh.userData.geomType = gtype;
    mesh.userData.geomDataId = gtype === MJ_GEOM.MESH ? dataId : -1;
    mesh.userData.geomSizeKey = gtype === MJ_GEOM.MESH ? null : sizeKey;
    mesh.userData.ownGeometry = geometryInfo.ownGeometry !== false;
    ctx.root.add(mesh);
    ctx.meshes[index] = mesh;
  }

  return mesh;
}

function applyMaterialFlags(mesh, index, state) {
  if (!mesh || !mesh.material) return;
  const sceneFlags = state.rendering?.sceneFlags || [];
  mesh.material.wireframe = !!sceneFlags[1];
  if (mesh.material.emissive && typeof mesh.material.emissive.set === 'function') {
    mesh.material.emissive.set(sceneFlags[0] ? 0x1a1f2a : 0x000000);
  } else {
    mesh.material.emissive = new THREE.Color(sceneFlags[0] ? 0x1a1f2a : 0x000000);
  }
}

function shouldHighlightFlag(index, value, defaults) {
  if (!defaults) return false;
  const def = defaults[index] ?? false;
  if (def === value) return false;
  return true;
}

function updateMeshFromSnapshot(mesh, i, snapshot, state, assets) {
  const n = snapshot.ngeom | 0;
  if (i >= n) {
    mesh.visible = false;
    return;
  }
  const xpos = snapshot.xpos;
  const xmat = snapshot.xmat;
  const sizeView = snapshot.gsize || assets?.geoms?.size || null;
  const typeView = snapshot.gtype || assets?.geoms?.type || null;
  const matIdView = snapshot.gmatid || assets?.geoms?.matid || null;
  const matRgbaView = assets?.materials?.rgba || snapshot.matrgba || null;
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
  const sx = sizeView?.[sizeBase + 0] ?? 0.1;
  const sy = sizeView?.[sizeBase + 1] ?? sx;
  const sz = sizeView?.[sizeBase + 2] ?? sx;
  const type = typeView?.[i] ?? MJ_GEOM.BOX;
  switch (type) {
    case MJ_GEOM.SPHERE:
    case MJ_GEOM.ELLIPSOID:
      mesh.scale.set(1, 1, 1);
      break;
    case MJ_GEOM.CAPSULE:
      mesh.scale.set(1, 1, 1);
      break;
    case MJ_GEOM.CYLINDER:
      mesh.scale.set(1, 1, 1);
      break;
    case MJ_GEOM.PLANE:
    case MJ_GEOM.HFIELD:
      mesh.scale.set(1, 1, 1);
      break;
    case MJ_GEOM.MESH:
      mesh.scale.set(1, 1, 1);
      break;
    default:
      mesh.scale.set(1, 1, 1);
      break;
  }

  if (Array.isArray(matRgbaView) || ArrayBuffer.isView(matRgbaView)) {
    const matIndex = matIdView?.[i] ?? -1;
    if (matIndex >= 0) {
      const rgbaBase = matIndex * 4;
      const r = matRgbaView?.[rgbaBase + 0] ?? 0.6;
      const g = matRgbaView?.[rgbaBase + 1] ?? 0.6;
      const b = matRgbaView?.[rgbaBase + 2] ?? 0.9;
      const a = matRgbaView?.[rgbaBase + 3] ?? 1;
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
  const assets = state.rendering?.assets || null;
  syncRendererAssets(ctx, assets);
  applyFallbackAppearance(ctx, state);
  if (assets && !ctx.assetSummaryLogged) {
    const summary = {
      geoms: assets.geoms?.count ?? 0,
      meshes: assets.meshes?.count ?? 0,
      vert: assets.meshes?.vert?.length ?? 0,
      face: assets.meshes?.face?.length ?? 0,
      normal: assets.meshes?.normal?.length ?? 0,
      texcoord: assets.meshes?.texcoord?.length ?? 0,
    };
    console.log('[render] assets summary', summary);
    ctx.assetSummaryLogged = true;
  }
  const typeSource = snapshot.gtype || assets?.geoms?.type || null;
  if (!ctx.gtypeLogged && typeSource) {
    const counts = Object.create(null);
    for (let i = 0; i < typeSource.length; i += 1) {
      const type = typeSource[i] | 0;
      counts[type] = (counts[type] || 0) + 1;
    }
    console.log('[render] gtype histogram', counts);
    ctx.gtypeLogged = true;
  }
  const dataIdSource = snapshot.gdataid || assets?.geoms?.dataid || null;
  if (!ctx.dataIdLogged && dataIdSource) {
    const sample = Array.from(dataIdSource.slice(0, 16));
    let meshRefs = 0;
    for (let i = 0; i < dataIdSource.length; i += 1) {
      if ((dataIdSource[i] | 0) >= 0) meshRefs += 1;
    }
    console.log('[render] gdataid sample', { sample, meshRefs });
    ctx.dataIdLogged = true;
  }
  const defaults = getDefaultVopt(state);
  const voptFlags = state.rendering?.voptFlags || [];
  const sceneFlags = state.rendering?.sceneFlags || [];
  if (ctx.renderer) {
    // Always keep shadow map enabled; presets control intensities, not the global switch
    ctx.renderer.shadowMap.enabled = true;
    if (ctx.renderer.shadowMap && typeof THREE !== 'undefined') {
      ctx.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    }
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
  const sizeView = snapshot.gsize || assets?.geoms?.size || null;
  const typeView = snapshot.gtype || assets?.geoms?.type || null;
  const dataIdView = snapshot.gdataid || assets?.geoms?.dataid || null;
  for (let i = 0; i < ngeom; i += 1) {
    const type = typeView?.[i] ?? MJ_GEOM.BOX;
    const dataId = dataIdView?.[i] ?? -1;
    const base = 3 * i;
    const sizeVec = sizeView
      ? [
          sizeView[base + 0] ?? 0,
          sizeView[base + 1] ?? 0,
          sizeView[base + 2] ?? 0,
        ]
      : null;
    const mesh = ensureGeomMesh(ctx, i, type, assets, dataId, sizeVec);
    if (!mesh) continue;
    updateMeshFromSnapshot(mesh, i, snapshot, state, assets);
    let visible = mesh.visible;
    if (hideAllGeometry) {
      visible = false;
    } else if (highlightGeometry) {
      if (mesh.material?.emissive && typeof mesh.material.emissive.set === 'function') {
        mesh.material.emissive.set(0x2b3a7a);
      } else if (mesh.material) {
        mesh.material.emissive = new THREE.Color(0x2b3a7a);
      }
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

  // Expand shadow frustum to cover current bounds so shadows become visible
  if (ctx.light && ctx.bounds) {
    const r = Math.max(0.1, Number(ctx.bounds.radius) || 1);
    const cam = ctx.light.shadow && ctx.light.shadow.camera ? ctx.light.shadow.camera : null;
    if (cam && typeof cam.left !== 'undefined') {
      const k = 2.2;
      const l = -r * k;
      const rt = r * k;
      cam.left = l;
      cam.right = rt;
      cam.top = r * 1.6;
      cam.bottom = -r * 1.6;
      cam.near = Math.max(0.01, r * 0.03);
      cam.far = Math.max(40, r * 8);
      if (typeof cam.updateProjectionMatrix === 'function') cam.updateProjectionMatrix();
      if (ctx.lightTarget) {
        ctx.lightTarget.position.set(ctx.bounds.center[0], ctx.bounds.center[1], ctx.bounds.center[2]);
        if (ctx.light && ctx.light.target) ctx.light.target.updateMatrixWorld?.();
      }
    }
  }

  if (debugMode) {
    ctx.debugFrameCount = (ctx.debugFrameCount || 0) + 1;
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const logState = ctx.debugLogState || { count: 0, lastTs: 0 };
    const shouldLog = logState.count < 3 || (now - logState.lastTs) > 5000;
    if (shouldLog) {
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
      logState.count += 1;
      logState.lastTs = now;
      ctx.debugLogState = logState;
    }
  }

  emitAdapterSceneSnapshot(ctx, snapshot, state);

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
        const horiz = radius * 3.0;
        const alt = Math.tan(20 * Math.PI / 180) * horiz; // ~20° sun altitude
        const lightOffset = new THREE.Vector3(horiz, -horiz * 0.9, Math.max(0.6, alt));
        ctx.light.position.copy(focus.clone().add(lightOffset));
        if (ctx.lightTarget) {
          ctx.lightTarget.position.copy(focus);
          ctx.light.target.updateMatrixWorld();
        }
        ctx.envDirty = true;
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
  // In both fallback presets we prefer no grid to avoid visual clutter
  const fb = ctx.fallback || {};
  const gridVisible = !fb.enabled && (
    baseGrid && !(copyState && copyState.precision === 'full' && copyState.seq === ctx.copySeq)
  );
  ctx.grid.visible = gridVisible;
}
function createLabel(text) {
  const label = document.createElement('label');
  label.textContent = text;
  return label;
}

function renderCheckbox(container, control) {
  const row = createControlRow(control);
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
  const row = createControlRow(control);
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

  if (control.default !== undefined) {
    binding.setValue(control.default);
  }

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

function renderVectorInput(container, control, expectedLength) {
  const { row, label, field } = createLabeledRow(control);
  const inputId = `${sanitiseName(control.item_id)}__vector`;
  label.setAttribute('for', inputId);
  const input = document.createElement('input');
  input.type = 'text';
  input.id = inputId;
  input.setAttribute('data-testid', control.item_id);
  input.autocomplete = 'off';
  input.spellcheck = false;
  field.append(input);
  container.append(row);

  const targetLength = Math.max(1, expectedLength | 0);
  let lastValid = '';

  const binding = {
    skip: false,
    getValue: () => input.value.trim(),
    setValue: (value) => {
      binding.skip = true;
      let text = '';
      if (Array.isArray(value)) {
        text = value.map(formatNumber).join(' ');
      } else if (typeof value === 'string') {
        text = value.trim();
      } else if (value != null && typeof value === 'object') {
        try {
          text = Array.from(value).map(formatNumber).join(' ');
        } catch {
          text = '';
        }
      }
      input.value = text;
      if (text) {
        lastValid = text;
        input.classList.remove('is-invalid');
      }
      binding.skip = false;
    },
  };
  registerControl(control, binding);

  async function commit() {
    if (binding.skip) return;
    const tokens = input.value.trim().split(/\s+/).filter(Boolean);
    const numbers = tokens.map((token) => Number(token));
    const isValid =
      tokens.length === targetLength && numbers.every((num) => Number.isFinite(num));
    if (isValid) {
      const formatted = numbers.map(formatNumber);
      const payload = formatted.join(' ');
      binding.skip = true;
      input.value = payload;
      binding.skip = false;
      lastValid = payload;
      input.classList.remove('is-invalid');
      await applySpecAction(store, backend, control, payload);
      return;
    }
    input.classList.add('is-invalid');
    if (lastValid) {
      if (input._invalidTimer) {
        clearTimeout(input._invalidTimer);
      }
      input._invalidTimer = setTimeout(() => {
        binding.skip = true;
        input.value = lastValid;
        binding.skip = false;
        input.classList.remove('is-invalid');
      }, 900);
    }
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
    case 'edit_vec3':
      return renderVectorInput(container, control, 3);
    case 'edit_rgba':
      return renderVectorInput(container, control, 4);
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
      getFallbackState: () => ({
        enabled: renderCtx.fallback?.enabled ?? fallbackEnabledDefault,
        preset: renderCtx.fallback?.preset ?? fallbackPresetKey,
        mode: renderCtx.fallback?.mode ?? fallbackModeParam,
      }),
      getShadows: () => ({ enabled: !!renderCtx.renderer?.shadowMap?.enabled, cast: !!renderCtx.light?.castShadow }),
      setShadowsEnabled: (on) => {
        if (renderCtx.renderer && renderCtx.renderer.shadowMap) {
          renderCtx.renderer.shadowMap.enabled = !!on;
        }
        if (renderCtx.light) renderCtx.light.castShadow = !!on;
      },
      setFallbackEnabled: (enabled) => {
        renderCtx.fallback = renderCtx.fallback || {};
        renderCtx.fallback.enabled = !!enabled;
      },
      setFallbackPreset: (preset) => {
        if (!preset) return;
        const key = FALLBACK_PRESET_ALIASES[preset.toLowerCase()] || preset.toLowerCase();
        if (!FALLBACK_PRESETS[key]) return;
        renderCtx.fallback = renderCtx.fallback || {};
        renderCtx.fallback.preset = key;
      },
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

