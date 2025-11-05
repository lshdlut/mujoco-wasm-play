import * as THREE from 'three';

import {
  createViewerStore,
  createBackend,
  applySpecAction,
  applyGesture,
  readControlValue,
  mergeBackendSnapshot,
} from './src/viewer/state.mjs';
import { parseDeg, consumeViewerParams } from './viewer_params.mjs';
import {
  FALLBACK_PRESET_ALIASES,
  FALLBACK_PRESETS,
  createEnvironmentManager,
} from './viewer_environment.mjs';
import { createControlManager } from './viewer_controls.mjs';
import { createCameraController } from './viewer_camera.mjs';
import { createRendererManager } from './viewer_renderer.mjs';

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
const panelStateCache = {
  left: null,
  right: null,
  fullscreen: null,
};
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



const {
  fallbackModeParam,
  presetParam: fallbackPresetParam,
  envRotParam,
  envRotXDeg,
  envRotYDeg,
  envRotZDeg,
  debugMode,
  hideAllGeometryDefault,
  dumpToken,
  findToken,
  bigN,
  skyOverride,
  skyFlag,
  backendModeToken,
  requestedModel,
  hdriParam: hdriQueryParam,
} = consumeViewerParams();

const dumpBigParam = dumpToken === 'big' || findToken === 'big';
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

const rendererManager = createRendererManager({
  canvas,
  renderCtx,
  applyFallbackAppearance,
  hideAllGeometryDefault,
  fallbackEnabledDefault,
  fallbackPresetKey,
  fallbackModeParam,
  debugMode,
  setRenderStats: (stats) => {
    renderStats = { ...renderStats, ...stats };
  },
});
rendererManager.setup();

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

function updateOverlay(card, visible) {
  if (!card) return;
  card.classList.toggle('visible', !!visible);
}

function updateToast(state) {
  if (!toastEl) return;
  const message = state.toast?.message;
  if (message) {
    toastEl.textContent = message;
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
    const ngeom = state.hud?.ngeom ?? 0;
    const rate = Number.isFinite(state.hud?.rate) ? state.hud.rate : 1;
    const drawn = renderStats.drawn ?? 0;
    const pausedSource = state.hud?.pausedSource ?? 'backend';
    const rateSource = state.hud?.rateSource ?? 'backend';
    simStatusEl.textContent = `${status} | ngeom=${ngeom} (visible ${drawn}) | rate=${rate.toFixed(2)}x [${rateSource}] | pause:${pausedSource}`;
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
  const leftVisible = !!state.panels.left;
  const rightVisible = !!state.panels.right;
  const fullscreen = !!state.overlays.fullscreen;
  if (leftPanel) {
    leftPanel.classList.toggle('is-hidden', !leftVisible);
  }
  if (rightPanel) {
    rightPanel.classList.toggle('is-hidden', !rightVisible);
  }
  document.body.classList.toggle('panel-left-hidden', !leftVisible);
  document.body.classList.toggle('panel-right-hidden', !rightVisible);
  document.body.classList.toggle('fullscreen', fullscreen);
  const changed =
    leftVisible !== panelStateCache.left ||
    rightVisible !== panelStateCache.right ||
    fullscreen !== panelStateCache.fullscreen;
  panelStateCache.left = leftVisible;
  panelStateCache.right = rightVisible;
  panelStateCache.fullscreen = fullscreen;
  if (changed && typeof resizeCanvas === 'function') {
    resizeCanvas();
  }
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

store.subscribe((state) => {
  if (latestSnapshot) {
    rendererManager.renderScene(latestSnapshot, state);
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

rendererManager.renderScene(latestSnapshot, store.get());


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
      ensureLoop: () => rendererManager.ensureRenderLoop(),
    };
  } catch {}
}

// Keep canvas resized to container.
function resizeCanvas() {
  if (!canvas) return;
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width;
  canvas.height = rect.height;
  if (rendererManager?.updateViewport) {
    rendererManager.updateViewport();
  }
}
resizeCanvas();
window.addEventListener('resize', resizeCanvas);


