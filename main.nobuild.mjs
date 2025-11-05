import * as THREE from 'three';

import {
  createViewerStore,
  createBackend,
  applySpecAction,
  applyGesture,
  readControlValue,
  mergeBackendSnapshot,
} from './src/viewer/state.mjs';
import { createSceneSnap, diffSceneSnaps } from './local_tools/viewer_demo/snapshots.mjs';
import { parseDeg, consumeViewerParams } from './viewer_params.mjs';
import {
  FALLBACK_PRESET_ALIASES,
  FALLBACK_PRESETS,
  createEnvironmentManager,
} from './viewer_environment.mjs';
import { createControlManager } from './viewer_controls.mjs';
import { createCameraController } from './viewer_camera.mjs';

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

let latestSnapshot = null;
let renderStats = { drawn: 0, hidden: 0 };

const {
  fallbackModeParam,
  presetParam: fallbackPresetParam,
  envRotParam,
  envRotXDeg,
  envRotYDeg,
  envRotZDeg,
  debugMode,
  hideAllGeometryDefault,
  hiddenTypeTokens,
  dumpToken,
  findToken,
  hideBigParam,
  bigN,
  bigFactorRaw,
  hiddenIndexSet,
  skyOverride,
  skyFlag,
  backendModeToken,
  requestedModel,
  hdriParam: hdriQueryParam,
} = consumeViewerParams();

const hiddenTypeSet = new Set(hiddenTypeTokens);
const dumpBigParam = dumpToken === 'big' || findToken === 'big';
const bigFactor = Number.isFinite(bigFactorRaw) && bigFactorRaw > 0 ? bigFactorRaw : 8;
const skyOffParam = skyOverride === true || skyFlag === false;
const backendMode =
  backendModeToken === 'worker' || backendModeToken === 'direct' ? backendModeToken : 'auto';
const backend = await createBackend({ mode: backendMode, debug: debugMode, model: requestedModel });
const store = createViewerStore({});
if (typeof window !== 'undefined') {
  window.__viewerStore = store;
}

const fallbackEnabledDefault = fallbackModeParam !== 'off';

// Environment orientation controls (HDRI/PMREM)
let envRotX = 0, envRotY = 0, envRotZ = 0;
if (envRotParam) {
  const toks = envRotParam.split(/[ ,]+/).map((t) => t.trim()).filter(Boolean);
  envRotX = parseDeg(toks[0] ?? 0, 0);
  envRotY = parseDeg(toks[1] ?? 0, 0);
  envRotZ = parseDeg(toks[2] ?? 0, 0);
}
if (envRotXDeg != null) envRotX = parseDeg(envRotXDeg, envRotX);
if (envRotYDeg != null) envRotY = parseDeg(envRotYDeg, envRotY);
if (envRotZDeg != null) envRotZ = parseDeg(envRotZDeg, envRotZ);

const fallbackPresetKey = FALLBACK_PRESET_ALIASES[fallbackPresetParam] || 'bright-outdoor';
const { applyFallbackAppearance } = createEnvironmentManager({
  THREE_NS: THREE,
  store,
  skyOffParam,
  hdriQueryParam: hdriQueryParam,
  fallbackEnabledDefault,
  fallbackPresetKey,
  envRotation: { x: envRotX, y: envRotY, z: envRotZ },
});

const controlManager = createControlManager({
  store,
  backend,
  applySpecAction,
  readControlValue,
  leftPanel,
  rightPanel,
  cameraPresets: CAMERA_PRESETS,
});
const { loadUiSpec, renderPanels, updateControls, toggleControl, cycleCamera } = controlManager;
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
  frameId: null,
};

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
  if (renderCtx.initialized || !canvas) return renderCtx;

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: false,
    powerPreference: 'high-performance',
  });
  if (typeof window !== 'undefined') {
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  }
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;
  if ('physicallyCorrectLights' in renderer) {
    renderer.physicallyCorrectLights = true;
  }
  renderer.setClearColor(0x000000, 1);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x151a26, 12, 48);

  const ambient = new THREE.AmbientLight(0xffffff, 0);
  scene.add(ambient);
  const hemi = new THREE.HemisphereLight(0xffffff, 0x10131c, 0);
  scene.add(hemi);
  const dir = new THREE.DirectionalLight(0xffffff, 2.2);
  dir.position.set(6, -8, 8);
  dir.color.setHSL(0.58, 0.32, 0.92);
  dir.castShadow = true;
  dir.shadow.mapSize.set(4096, 4096);
  dir.shadow.bias = -0.00008;
  if ('radius' in dir.shadow) {
    dir.shadow.radius = 0;
  }
  if ('normalBias' in dir.shadow) {
    dir.shadow.normalBias = 0.002;
  }
  const dirShadowCam = dir.shadow.camera;
  if (dirShadowCam) {
    dirShadowCam.left = -6;
    dirShadowCam.right = 6;
    dirShadowCam.top = 6;
    dirShadowCam.bottom = -6;
    dirShadowCam.near = 0.1;
    dirShadowCam.far = 40;
    if (typeof dirShadowCam.updateProjectionMatrix === 'function') {
      dirShadowCam.updateProjectionMatrix();
    }
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
  const axesMaterials = Array.isArray(axes.material) ? axes.material : [axes.material];
  for (const mat of axesMaterials) {
    if (!mat) continue;
    mat.depthTest = true;
    mat.depthWrite = false;
  }
  axes.renderOrder = 0;
  scene.add(axes);

  Object.assign(renderCtx, {
    initialized: true,
    renderer,
    scene,
    camera,
    root,
    grid,
    axes,
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
    hdriReady: false,
    hdriLoading: false,
    fallback: {
      enabled: fallbackEnabledDefault,
      preset: fallbackPresetKey,
      mode: fallbackModeParam,
    },
  });
  renderCtx.cameraTarget.set(0, 0, 0);

  updateRendererViewport();
  if (typeof window !== 'undefined') {
    window.addEventListener('resize', updateRendererViewport);
    ensureRenderLoop();
  }
  return renderCtx;
}

function updateRendererViewport() {
  if (!canvas || !renderCtx.renderer || !renderCtx.camera) return;
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(1, rect.width);
  const height = Math.max(1, rect.height);
  renderCtx.renderer.setSize(width, height, false);
  renderCtx.camera.aspect = width / height;
  renderCtx.camera.updateProjectionMatrix();
}

function renderLoop() {
  if (typeof window !== 'undefined') {
    renderCtx.frameId = window.requestAnimationFrame(renderLoop);
  }
  if (!renderCtx.initialized || !renderCtx.renderer || !renderCtx.scene || !renderCtx.camera) return;
  try {
    if (renderCtx.hdriReady && renderCtx.hdriBackground && renderCtx.scene) {
      if (renderCtx.scene.background !== renderCtx.hdriBackground) {
        renderCtx.scene.background = renderCtx.hdriBackground;
        if ('backgroundIntensity' in renderCtx.scene) {
          const fb = renderCtx.fallback || {};
          renderCtx.scene.backgroundIntensity = fb.envIntensity ?? 1.7;
        }
        if ('backgroundBlurriness' in renderCtx.scene) {
          renderCtx.scene.backgroundBlurriness = 0.0;
        }
      }
    }
  } catch {}
  renderCtx.renderer.render(renderCtx.scene, renderCtx.camera);
}

function ensureRenderLoop() {
  if (typeof window === 'undefined') return;
  if (renderCtx.frameId != null) return;
  renderCtx.frameId = window.requestAnimationFrame(renderLoop);
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
        materialOpts = { color: 0xdbcfc2, metalness: 0.05, roughness: 0.55, envMapIntensity: 1.15, map: null };
      }
      postCreate = (mesh) => {
        // In z-up (camera.up = (0,0,1)) world, PlaneGeometry is already XY-facing +Z.
        // Keep it unrotated so it acts as ground at z=0 and receives shadows.
        mesh.rotation.set(0, 0, 0);
        mesh.receiveShadow = true;
        mesh.renderOrder = -2;
        if (mesh.material) {
          mesh.material.color.setHex(0xdbcfc2);
          mesh.material.metalness = 0.05;
          mesh.material.roughness = 0.55;
          mesh.material.envMapIntensity = 1.2;
        }
        try {
          const backMat = mesh.material.clone();
          backMat.side = THREE.BackSide;
          backMat.transparent = true;
          backMat.opacity = 0.18;
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
      ctx.renderer.shadowMap.type = THREE.PCFShadowMap;
    }
  }
  if (ctx.light) {
    const baseLight = sceneFlags[0] ? 2.2 : 1.8;
    ctx.light.intensity = baseLight;
  }
  if (ctx.hemi) {
    const fillLight = sceneFlags[0] ? 0.45 : 0.3;
    ctx.hemi.intensity = fillLight;
    ctx.hemi.groundColor.set(sceneFlags[0] ? 0x111622 : 0x161b29);
  }
  let hideAllGeometry = hideAllGeometryDefault;
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
  // Views for geometry attributes
  const sizeView = snapshot.gsize || assets?.geoms?.size || null;
  const typeView = snapshot.gtype || assets?.geoms?.type || null;
  const dataIdView = snapshot.gdataid || assets?.geoms?.dataid || null;
  // Pre-compute approximate radii for geoms to support big-geom diagnostics/hiding
  const xposForBig = snapshot.xpos || null;
  const approxRadii = new Array(ngeom);
  if (ngeom > 0) {
    for (let i = 0; i < ngeom; i += 1) {
      const base = 3 * i;
      const sx = sizeView?.[base + 0] ?? 0.1;
      const sy = sizeView?.[base + 1] ?? sx;
      const sz = sizeView?.[base + 2] ?? sx;
      const t = typeView?.[i] ?? MJ_GEOM.BOX;
      approxRadii[i] = computeGeomRadius(t, sx, sy, sz);
    }
  }
  let bigMedian = 0;
  let bigThreshold = 0;
  if (approxRadii.length > 4) {
    const tmp = approxRadii.slice().sort((a, b) => (a - b));
    bigMedian = tmp[Math.floor(tmp.length / 2)] || 0;
    bigThreshold = (bigMedian || 0) * bigFactor;
  }
  if ((debugMode || dumpBigParam) && !renderCtx.bigDumped && ngeom > 0) {
    try {
      const items = [];
      for (let i = 0; i < ngeom; i += 1) {
        const r = approxRadii[i] || 0;
        const base = 3 * i;
        const pos = xposForBig && xposForBig.length >= base + 3
          ? [xposForBig[base + 0], xposForBig[base + 1], xposForBig[base + 2]]
          : [0, 0, 0];
        const t = typeView?.[i] ?? MJ_GEOM.BOX;
        const typeName = (function(tt){
          switch (tt|0) {
            case MJ_GEOM.PLANE: return 'plane';
            case MJ_GEOM.HFIELD: return 'hfield';
            case MJ_GEOM.SPHERE: return 'sphere';
            case MJ_GEOM.CAPSULE: return 'capsule';
            case MJ_GEOM.ELLIPSOID: return 'ellipsoid';
            case MJ_GEOM.CYLINDER: return 'cylinder';
            case MJ_GEOM.BOX: return 'box';
            case MJ_GEOM.MESH: return 'mesh';
            default: return 'unknown';
          }
        })(t);
        items.push({ i, typeName, r, pos });
      }
      items.sort((a, b) => b.r - a.r);
      const take = Math.min(bigN, items.length);
      console.log('[debug] biggest geoms', {
        median: Number(bigMedian.toFixed(4)),
        threshold: Number(bigThreshold.toFixed(4)),
        top: items.slice(0, take).map(it => ({ index: it.i, type: it.typeName, r: Number((it.r||0).toFixed(4)), pos: it.pos.map(v => Number((v||0).toFixed(3))) }))
      });
      renderCtx.bigDumped = true;
    } catch {}
  }
  let drawn = 0;
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
    if (!hideAllGeometry && hiddenTypeSet.size > 0) {
      const typeName = (function(t){
        switch (t|0) {
          case MJ_GEOM.PLANE: return 'plane';
          case MJ_GEOM.HFIELD: return 'hfield';
          case MJ_GEOM.SPHERE: return 'sphere';
          case MJ_GEOM.CAPSULE: return 'capsule';
          case MJ_GEOM.ELLIPSOID: return 'ellipsoid';
          case MJ_GEOM.CYLINDER: return 'cylinder';
          case MJ_GEOM.BOX: return 'box';
          case MJ_GEOM.MESH: return 'mesh';
          default: return 'unknown';
        }
      })(type);
      if (hiddenTypeSet.has(typeName) || hiddenTypeSet.has('*') || hiddenTypeSet.has('all')) {
        visible = false;
      }
    }
    if (!hideAllGeometry && hiddenIndexSet.size > 0 && hiddenIndexSet.has(i)) {
      visible = false;
    }
    if (!hideAllGeometry && hideBigParam && approxRadii && Number.isFinite(approxRadii[i]) && approxRadii[i] > bigThreshold && bigThreshold > 0) {
      visible = false;
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
        // Expand far plane to comfortably include scene bounds
        const desiredFar = Math.max(100, radius * 10);
        if (ctx.camera.far < desiredFar) {
          ctx.camera.far = desiredFar;
          if (typeof ctx.camera.updateProjectionMatrix === 'function') ctx.camera.updateProjectionMatrix();
        }
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
  ctx.grid.visible = gridVisible && !hideAllGeometry && !hiddenTypeSet.has('grid');
  if (ctx.axes) {
    ctx.axes.visible = !hideAllGeometry && !hiddenTypeSet.has('axes');
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
      getBinding: (id) => controlManager.getBinding(id),
      listIds: (prefix) => controlManager.listIds(prefix),
    };
    window.__viewerRenderer = {
      getStats: () => ({ ...renderStats }),
      getContext: () => (renderCtx.initialized ? renderCtx : null),
      getFallbackState: () => ({
        enabled: renderCtx.fallback?.enabled ?? fallbackEnabledDefault,
        preset: renderCtx.fallback?.preset ?? fallbackPresetKey,
        mode: renderCtx.fallback?.mode ?? fallbackModeParam,
      }),
      getShadows: () => ({
        enabled: !!renderCtx.renderer?.shadowMap?.enabled,
        cast: !!renderCtx.light?.castShadow,
      }),
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

const cameraController = createCameraController({
  THREE_NS: THREE,
  canvas,
  store,
  backend,
  applyGesture,
  renderCtx,
  debugMode,
  globalUp: new THREE.Vector3(0, 0, 1),
});
cameraController.setup();

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
