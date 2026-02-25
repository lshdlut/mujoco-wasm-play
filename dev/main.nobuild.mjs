import * as THREE from 'three';
import {
  consumeViewerParams,
  isPerfEnabled,
  isStrictEnabled,
  readNumericParam,
  perfMarkOnce,
  perfNow,
  perfSample,
  logDebug,
  logWarn,
  logStatus,
  logError,
  strictCatch,
  strictEnsure,
  strictOverride,
} from './viewer_runtime.mjs';
import { compatFallback } from './fallbacks.mjs';
import { DEFAULT_REALTIME_INDEX, DEFAULT_VOPT_FLAGS, REALTIME_LEVELS, SCENE_FLAG_DEFAULTS } from './viewer_defaults.mjs';
import {
  assignStructPath,
  bool,
  cloneStruct,
  createDefaultHistoryState,
  createDefaultKeyframeState,
  createDefaultWatchState,
  createViewerGroupState,
  normaliseGroupState,
  resolveStructPath,
  splitBinding,
  toNumber,
} from './viewer_shared.mjs';
import { STAT_FIELD_DESCRIPTORS, VISUAL_FIELD_DESCRIPTORS } from './viewer_structs.mjs';
import { createBackend } from './viewer_backend.mjs';


import {
  DEFAULT_VIEWER_STATE,
  applyGesture,
  applySpecAction,
  createControlManager,
  createViewerStore,
  installPanelSectionDblclickDelegation,
  setPlaySectionCollapsed,
  toggleAllPlaySections,
  mergeBackendSnapshot,
  prepareBindingUpdate,
  readControlValue,
} from './main_ui.mjs';
import { createCameraController, createPickingController, createRendererManager } from './main_renderer.mjs';
import { createEnvironmentManager } from './main_environment.mjs';

perfMarkOnce('play:main:start', {
  href: (typeof window !== 'undefined' && window.location?.href) ? window.location.href : null,
});

const CAMERA_PRESETS = ['Free', 'Tracking'];

const leftPanel = document.querySelector('[data-testid="panel-left"]');
const rightPanel = document.querySelector('[data-testid="panel-right"]');
const leftPanelMount = document.querySelector('[data-play-mount="leftPanel"]') || leftPanel;
const rightPanelMount = document.querySelector('[data-play-mount="rightPanel"]') || rightPanel;
const leftPanelPluginMount = document.querySelector('[data-play-mount="leftPanelPlugin"]') || null;
const rightPanelPluginMount = document.querySelector('[data-play-mount="rightPanelPlugin"]') || null;
const overlayRootMount = document.querySelector('[data-play-mount="overlayRoot"]') || document.querySelector('.overlay-stack');
const canvas = document.querySelector('[data-testid="viewer-canvas"]');
const overlayRealtime = document.querySelector('[data-testid="overlay-realtime"]');
const overlayHelp = document.querySelector('[data-testid="overlay-help"]');
const overlayInfo = document.querySelector('[data-testid="overlay-info"]');
const overlayProfiler = document.querySelector('[data-testid="overlay-profiler"]');
const overlaySensor = document.querySelector('[data-testid="overlay-sensor"]');
const toastEl = document.querySelector('[data-testid="toast"]');
let viewerStoreRef = null;
let infoTimeEl = null;
let infoFpsEl = null;
let infoSizeEl = null;
let infoCpuEl = null;
let infoSolverEl = null;
let infoEnergyEl = null;
let infoFwdinvEl = null;

let latestSnapshot = null;
let renderStats = { drawn: 0, hidden: 0 };
let fpsEstimate = 0;
let lastFpsFrameSample = 0;
let lastFpsSampleTimeMs = perfNow();
const uiTickSubscribers = new Set();
const snapshotSubscribers = new Set();
const frameSubscribers = new Set();
const pluginDisposers = [];
let pluginDisposeInstalled = false;

installPanelSectionDblclickDelegation(leftPanel);
installPanelSectionDblclickDelegation(rightPanel);

function subscribeClock(set, fn) {
  if (typeof fn !== 'function') {
    return () => {};
  }
  set.add(fn);
  return () => set.delete(fn);
}


function formatArenaBytes(bytes) {
  const n = Number(bytes) || 0;
  if (n <= 0) return '0B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let idx = 0;
  let value = n;
  while (value >= 1024 && idx < units.length - 1) {
    value /= 1024;
    idx += 1;
  }
  if (value >= 100) return `${Math.round(value)}${units[idx]}`;
  return `${value.toFixed(1)}${units[idx]}`;
}
const panelStateCache = {
  left: null,
  right: null,
  fullscreen: null,
};
const overlayStateCache = {
  help: null,
  info: null,
  profiler: null,
  sensor: null,
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
  viewerCameraSynced: false,
  viewerCameraSyncSeqSent: 0,
  viewerCameraSyncSeqAck: 0,
  viewerCameraTrackId: null,
  bounds: null,
  snapshotLogState: null,
  frameId: null,
};
if (typeof window !== 'undefined') {
  window.__renderCtx = renderCtx;
}



const {
  fallbackModeParam,
  debugMode,
  hideAllGeometryDefault,
  dumpToken,
  findToken,
  bigN,
  skyOverride,
  requestedModel,
  skyDebugModeParam,
} = consumeViewerParams();

const dumpBigParam = dumpToken === 'big' || findToken === 'big';
const skyOffParam = skyOverride === true;
// Play UI runs on a worker backend only.
if (typeof window !== 'undefined') {
  const search = window.location?.search || '';
  if (/(?:^|[?&])mode=/.test(search)) {
    logWarn("[viewer] query parameter 'mode' is deprecated and ignored (worker-only backend).");
  }
}
const backend = await createBackend({ model: requestedModel, prepareBindingUpdate });
const store = createViewerStore({});
viewerStoreRef = store;
if (typeof window !== 'undefined') {
  window.__viewerStore = store;
  window.__PLAY_STRICT_REPORT__ = () => backend.getStrictReport();
}

const fallbackEnabledDefault = fallbackModeParam !== 'off';

const { applyFallbackAppearance, ensureEnvIfNeeded } = createEnvironmentManager({
  THREE_NS: THREE,
  skyOffParam,
  fallbackEnabledDefault,
  skyDebugModeParam,
});

const parseTransparentBins = (search, fallbackBins = 16) => {
  const match = String(search || '').match(/(?:^|[?&])tbins=(\d+)/);
  if (!match) return fallbackBins;
  const parsed = Number(match[1]);
  if (!Number.isFinite(parsed)) return fallbackBins;
  const clamped = Math.max(0, Math.min(16, parsed | 0));
  if (clamped === 0) return 0;
  if (clamped <= 1) return 1;
  if (clamped <= 4) return 4;
  if (clamped <= 8) return 8;
  return 16;
};

const parseTransparentSortMode = (search) => {
  const s = String(search || '');
  if (s.includes('tmode=nosort') || s.includes('tmode=fast')) return 'nosort';
  if (s.includes('tmode=bins')) return 'bins';
  return 'strict';
};

if (store && typeof store.update === 'function') {
  const search = (typeof window !== 'undefined') ? (window.location?.search || '') : '';
  const forceBasic = search.includes('forceBasic=1');
  let disableInstancing = search.includes('inst=0') || search.includes('instancing=0') || search.includes('noinst=1');
  if (typeof globalThis !== 'undefined') {
    const override = globalThis.PLAY_DISABLE_INSTANCING;
    if (override === true) disableInstancing = true;
    if (override === false) disableInstancing = false;
  }
  let transparentBins = parseTransparentBins(search, 16);
  let transparentSortMode = parseTransparentSortMode(search);
  if (typeof globalThis !== 'undefined') {
    const bins = globalThis.PLAY_TRANSPARENT_BINS;
    if (Number.isFinite(bins)) transparentBins = Math.max(0, Math.min(16, bins | 0));
    const mode = globalThis.PLAY_TRANSPARENT_SORT_MODE;
    if (mode === 'strict' || mode === 'bins' || mode === 'nosort') transparentSortMode = mode;
  }
  store.update((draft) => {
    if (!draft.rendering) draft.rendering = { ...DEFAULT_VIEWER_STATE.rendering };
    draft.rendering.hideAllGeometry = !!hideAllGeometryDefault;
    if (!draft.rendering.options) draft.rendering.options = { ...DEFAULT_VIEWER_STATE.rendering.options };
    if (!draft.rendering.options.materials) draft.rendering.options.materials = { ...DEFAULT_VIEWER_STATE.rendering.options.materials };
    draft.rendering.options.materials.forceBasic = !!forceBasic;
    if (!draft.rendering.options.instancing) draft.rendering.options.instancing = { ...DEFAULT_VIEWER_STATE.rendering.options.instancing };
    draft.rendering.options.instancing.enabled = !disableInstancing;
    if (!draft.rendering.options.transparency) draft.rendering.options.transparency = { ...DEFAULT_VIEWER_STATE.rendering.options.transparency };
    draft.rendering.options.transparency.bins = transparentBins;
    draft.rendering.options.transparency.sortMode = transparentSortMode;
  });
}

const rendererManager = createRendererManager({
  canvas,
  backend,
  renderCtx,
  applyFallbackAppearance,
  ensureEnvIfNeeded,
  debugMode,
  setRenderStats: (stats) => {
    renderStats = { ...renderStats, ...stats };
    const frame = Number(stats?.frame);
    const now = perfNow();
    if (Number.isFinite(frame) && frame > lastFpsFrameSample) {
      const deltaFrame = frame - lastFpsFrameSample;
      const deltaMs = Math.max(1, now - lastFpsSampleTimeMs);
      const instFps = (deltaFrame * 1000) / deltaMs;
      if (Number.isFinite(instFps) && instFps > 0) {
        if (!Number.isFinite(fpsEstimate) || fpsEstimate <= 0) {
          fpsEstimate = instFps;
        } else {
          const alpha = 0.2;
          fpsEstimate = fpsEstimate * (1 - alpha) + instFps * alpha;
        }
        lastFpsFrameSample = frame;
        lastFpsSampleTimeMs = now;
      }
    }
  },
});
rendererManager.setup();

const controlManager = createControlManager({
  store,
  backend,
  applySpecAction,
  readControlValue,
  leftPanel: leftPanelMount,
  rightPanel: rightPanelMount,
  cameraPresets: CAMERA_PRESETS,
});
const { loadUiSpec, renderPanels, updateControls, toggleControl, cycleCamera, registerGlobalShortcut } = controlManager;
const initialInfo = typeof backend?.getInitialModelInfo === 'function'
  ? backend.getInitialModelInfo()
  : null;
if (initialInfo && (initialInfo.label || initialInfo.file)) {
  const label = initialInfo.label || initialInfo.file || '';
  store.update((draft) => {
    if (!draft.hud) draft.hud = {};
    draft.hud.modelLabel = label;
  });
}

function updateOverlay(card, visible) {
  if (!card) return;
  card.classList.toggle('visible', !!visible);
}

function updateRealtimeOverlay(state) {
  if (!overlayRealtime) return;
  const sim = state?.simulation || {};
  const hud = state?.hud || {};
  const run = !!sim.run;
  const total = REALTIME_LEVELS.length;
  if (!total) {
    overlayRealtime.classList.remove('visible');
    return;
  }
  const idxRaw = Number.isFinite(sim.realTimeIndex) ? (sim.realTimeIndex | 0) : DEFAULT_REALTIME_INDEX;
  const clampedIdx = Math.max(0, Math.min(total - 1, idxRaw));
  const desired = REALTIME_LEVELS[clampedIdx] || 100;
  const slowdown = Number(hud.measuredSlowdown);
  const actual = (Number.isFinite(slowdown) && slowdown > 0) ? (100 / slowdown) : desired;
  const offset = Math.abs(actual - desired);
  const misaligned = run && offset > 0.1 * desired;
  const shouldShow = (desired !== 100) || misaligned;
  const formatPercentSpeed = (val) => {
    const v = Number(val) || 0;
    const abs = Math.abs(v);
    if (!Number.isFinite(abs) || abs <= 0) return '0%';
    return `${Math.round(abs)}%`;
  };
  const formatPercentPhysics = (val) => {
    const v = Number(val) || 0;
    const abs = Math.abs(v);
    if (!Number.isFinite(abs) || abs <= 0) return '0.0%';
    return `${abs.toFixed(1)}%`;
  };
  const desiredEl = overlayRealtime.querySelector('[data-testid="overlay-realtime-desired"]') || overlayRealtime;
  const actualEl = overlayRealtime.querySelector('[data-testid="overlay-realtime-actual"]');
  if (shouldShow) {
    if (desiredEl) desiredEl.textContent = `Speed : ${formatPercentSpeed(desired)}`;
    if (actualEl) actualEl.textContent = `Physics: ${formatPercentPhysics(actual)}`;
    overlayRealtime.classList.add('visible');
  } else {
    overlayRealtime.classList.remove('visible');
  }
}

const TOAST_HIDE_MS = 2200;

function updateToast(state) {
  if (!toastEl) return;
  const toast = state.toast;
  const message = toast?.message;
  if (message) {
    const id = toast.ts ?? toast.message;
    if (updateToast._currentId !== id) {
      toastEl.textContent = message;
      toastEl.classList.add('visible');
      updateToast._currentId = id;
      clearTimeout(updateToast._hideTimer);
      clearTimeout(updateToast._clearTimer);
      updateToast._hideTimer = setTimeout(() => {
        toastEl.classList.remove('visible');
        toastEl.textContent = '';
      }, TOAST_HIDE_MS);
      updateToast._clearTimer = setTimeout(() => {
        if (viewerStoreRef && typeof viewerStoreRef.update === 'function') {
          viewerStoreRef.update((draft) => {
            const currentId = draft.toast ? (draft.toast.ts ?? draft.toast.message) : null;
            if (currentId === id) {
              draft.toast = null;
            }
          });
        }
      }, TOAST_HIDE_MS + 50);
    }
  } else {
    toastEl.classList.remove('visible');
    toastEl.textContent = '';
    updateToast._currentId = null;
  }
}

function updateInfoOverlayTime(state) {
  if (!overlayInfo) return;
  if (!state?.overlays?.info) return;
  const time = Number(state?.hud?.time);
  if (!Number.isFinite(time)) return;
  if (!infoTimeEl || !infoTimeEl.isConnected) {
    const grid = overlayInfo.querySelector('.info-grid');
    infoTimeEl = grid ? grid.querySelector('.info-value[data-info-field="time"]') : null;
    if (!infoTimeEl) return;
  }
  infoTimeEl.textContent = `${time.toFixed(3)} s`;
}

function updateInfoOverlayFast(state) {
  if (!overlayInfo) return;
  if (!state?.overlays?.info) return;
  const grid = overlayInfo.querySelector('.info-grid');
  if (!grid) return;
  if (!infoFpsEl || !infoFpsEl.isConnected) {
    infoFpsEl = grid.querySelector('.info-value[data-info-field="fps"]');
  }
  if (!infoSizeEl || !infoSizeEl.isConnected) {
    infoSizeEl = grid.querySelector('.info-value[data-info-field="size"]');
  }
  if (!infoCpuEl || !infoCpuEl.isConnected) {
    infoCpuEl = grid.querySelector('.info-value[data-info-field="cpu"]');
  }
  if (!infoSolverEl || !infoSolverEl.isConnected) {
    infoSolverEl = grid.querySelector('.info-value[data-info-field="solver"]');
  }
  if (!infoEnergyEl || !infoEnergyEl.isConnected) {
    infoEnergyEl = grid.querySelector('.info-value[data-info-field="energy"]');
  }
  if (!infoFwdinvEl || !infoFwdinvEl.isConnected) {
    infoFwdinvEl = grid.querySelector('.info-value[data-info-field="fwdinv"]');
  }
  const info = state?.hud?.info || null;
  const simRun = !!state?.simulation?.run;
  const fpsState = Number(state?.hud?.fps);
  const fps = Number.isFinite(fpsEstimate) && fpsEstimate > 0
    ? fpsEstimate
    : (Number.isFinite(fpsState) ? fpsState : 0);
  const value = simRun ? (Number(fps) || 0) : 0;
  const text = value < 1 ? `${value.toFixed(1)} fps` : `${Math.round(value)} fps`;
  if (infoFpsEl && infoFpsEl.textContent !== text) infoFpsEl.textContent = text;

  if (infoSizeEl) {
    const nefc = Number(info?.nefc) || 0;
    const ncon = Number(info?.ncon) || Number(state?.hud?.contacts) || 0;
    const sizeText = nefc ? `${nefc}  (${ncon} con)` : `${ncon} con`;
    if (infoSizeEl.textContent !== sizeText) infoSizeEl.textContent = sizeText;
  }

  if (infoCpuEl) {
    const step = Number(info?.cpuStepMs);
    const fwd = Number(info?.cpuForwardMs);
    const val = simRun ? step : fwd;
    const cpuMs = Number.isFinite(val) && val > 0 ? val : null;
    const cpuText = cpuMs != null ? `${cpuMs.toFixed(3)} ms` : 'n/a';
    if (infoCpuEl.textContent !== cpuText) infoCpuEl.textContent = cpuText;
  }

  if (infoSolverEl) {
    const solverErr = Number(info?.solverSolerr);
    const solverIter = Number(info?.solverNiter) || 0;
    const solverText = (() => {
      if (Number.isFinite(solverErr)) return `${solverErr.toFixed(2)}  (${solverIter | 0} it)`;
      if (solverIter > 0) return `${solverIter | 0} it`;
      return 'n/a';
    })();
    if (infoSolverEl.textContent !== solverText) infoSolverEl.textContent = solverText;
  }

  if (infoEnergyEl) {
    const energy = Number(info?.energy);
    const energyText = Number.isFinite(energy) ? energy.toFixed(3) : 'n/a';
    if (infoEnergyEl.textContent !== energyText) infoEnergyEl.textContent = energyText;
  }

  if (infoFwdinvEl) {
    const enableFlags = state?.model?.opt?.enableflags;
    const enabled = typeof enableFlags === 'number' && !!(enableFlags & (1 << 2));
    const solverFwdinv = Array.isArray(info?.solverFwdinv) ? info.solverFwdinv : null;
    const fwdinvText = (() => {
      if (!enabled || !solverFwdinv || solverFwdinv.length < 2) return 'n/a';
      const f0 = Number(solverFwdinv[0]);
      const f1 = Number(solverFwdinv[1]);
      if (!Number.isFinite(f0) || !Number.isFinite(f1)) return 'n/a';
      return `${f0.toFixed(1)}  ${f1.toFixed(1)}`;
    })();
    if (infoFwdinvEl.textContent !== fwdinvText) infoFwdinvEl.textContent = fwdinvText;
  }
}


function updateInfoOverlayCard(state) {
  if (!overlayInfo) return;
  let grid = overlayInfo.querySelector('.info-grid');
  if (!grid) {
    overlayInfo.innerHTML = '';
    grid = document.createElement('div');
    grid.className = 'info-grid';
    const addRow = (key, label) => {
      const labelEl = document.createElement('div');
      labelEl.className = 'info-label';
      labelEl.textContent = label;
      const valueEl = document.createElement('div');
      valueEl.className = 'info-value';
      valueEl.setAttribute('data-info-field', key);
      grid.append(labelEl, valueEl);
    };
    addRow('model', 'Model');
    addRow('state', 'State');
    addRow('time', 'Time');
    addRow('size', 'Size');
    addRow('cpu', 'CPU');
    addRow('solver', 'Solver');
    addRow('fps', 'FPS');
    addRow('memory', 'Memory');
    addRow('energy', 'Energy');
    addRow('fwdinv', 'FwdInv');
    addRow('islands', 'Islands');
    overlayInfo.appendChild(grid);
  }
  const info = state?.hud?.info || null;
  const getFieldEl = (key) => grid.querySelector(`.info-value[data-info-field="${key}"]`);
  const modelLabel = state?.hud?.modelLabel || '';
  const simRun = !!state?.simulation?.run;
  const time = Number(state?.hud?.time) || 0;
  const fpsState = Number(state?.hud?.fps);
  const fps = Number.isFinite(fpsEstimate) && fpsEstimate > 0
    ? fpsEstimate
    : (Number.isFinite(fpsState) ? fpsState : 0);
  const nefc = Number(info?.nefc) || 0;
  const ncon = Number(info?.ncon) || Number(state?.hud?.contacts) || 0;
  const cpuMs = (() => {
    const step = Number(info?.cpuStepMs);
    const fwd = Number(info?.cpuForwardMs);
    const val = simRun ? step : fwd;
    return Number.isFinite(val) && val > 0 ? val : null;
  })();
  const solverErr = Number(info?.solverSolerr);
  const solverIter = Number(info?.solverNiter) || 0;
  const maxCon = Number(info?.maxuseCon) || 0;
  const maxEfc = Number(info?.maxuseEfc) || 0;
  const narena = Number(info?.narena) || 0;
  const maxArena = Number(info?.maxuseArena) || 0;
  const energy = Number(info?.energy);
  const solverFwdinv = Array.isArray(info?.solverFwdinv) ? info.solverFwdinv : null;
  const nisland = Number(info?.nisland) || 0;

  const modelEl = getFieldEl('model');
  if (modelEl) {
    const label = modelLabel || '(default model)';
    modelEl.textContent = label;
    modelEl.title = label;
  }
  const stateEl = getFieldEl('state');
  if (stateEl) stateEl.textContent = simRun ? 'Running' : 'Paused';
  const timeEl = getFieldEl('time');
  if (timeEl) timeEl.textContent = `${time.toFixed(3)} s`;
  infoTimeEl = timeEl || infoTimeEl;
  const sizeEl = getFieldEl('size');
  if (sizeEl) sizeEl.textContent = nefc ? `${nefc}  (${ncon} con)` : `${ncon} con`;
  const cpuEl = getFieldEl('cpu');
  if (cpuEl) cpuEl.textContent = cpuMs != null ? `${cpuMs.toFixed(3)} ms` : 'n/a';
  const solverEl = getFieldEl('solver');
  if (solverEl) {
    if (Number.isFinite(solverErr)) {
      solverEl.textContent = `${solverErr.toFixed(2)}  (${solverIter | 0} it)`;
    } else if (solverIter > 0) {
      solverEl.textContent = `${solverIter | 0} it`;
    } else {
      solverEl.textContent = 'n/a';
    }
  }
  const fpsEl = getFieldEl('fps');
  if (fpsEl) {
    const value = simRun ? (Number(fps) || 0) : 0;
    fpsEl.textContent = value < 1 ? `${value.toFixed(1)} fps` : `${Math.round(value)} fps`;
  }
  const memEl = getFieldEl('memory');
  if (memEl) {
    if (narena > 0 && maxArena >= 0) {
      const pct = (maxArena / narena) * 100;
      const label = formatArenaBytes(narena);
      memEl.textContent = `${pct.toFixed(1)}% of ${label}`;
    } else if (maxCon > 0 || maxEfc > 0) {
      memEl.textContent = `con/efc ${maxCon}/${maxEfc}`;
    } else {
      memEl.textContent = 'n/a';
    }
  }
  const fwdinvEl = getFieldEl('fwdinv');
  if (fwdinvEl) {
    const enableFlags = state?.model?.opt?.enableflags;
    const enabled = typeof enableFlags === 'number' && !!(enableFlags & (1 << 2));
    if (enabled && solverFwdinv && solverFwdinv.length >= 2) {
      const f0 = Number(solverFwdinv[0]);
      const f1 = Number(solverFwdinv[1]);
      if (Number.isFinite(f0) && Number.isFinite(f1)) {
        fwdinvEl.textContent = `${f0.toFixed(1)}  ${f1.toFixed(1)}`;
      } else {
        fwdinvEl.textContent = 'n/a';
      }
    } else {
      fwdinvEl.textContent = 'n/a';
    }
  }
  const energyEl = getFieldEl('energy');
  if (energyEl) {
    energyEl.textContent = Number.isFinite(energy) ? energy.toFixed(3) : 'n/a';
  }
  const islandsEl = getFieldEl('islands');
  if (islandsEl) {
    islandsEl.textContent = nisland > 0 ? String(nisland | 0) : '0';
  }
}

function updatePanels(state) {
  const leftVisible = !!state.panels.left;
  const rightVisible = !!state.panels.right;
  const fullscreen = !!state.overlays.fullscreen;

  const changed =
    leftVisible !== panelStateCache.left ||
    rightVisible !== panelStateCache.right ||
    fullscreen !== panelStateCache.fullscreen;

  if (!changed) return;

  if (leftPanel) leftPanel.classList.toggle('is-hidden', !leftVisible);
  if (rightPanel) rightPanel.classList.toggle('is-hidden', !rightVisible);

  // Compute layout class (areas-based, mutually exclusive)
  const layoutClass = fullscreen
    ? 'layout-main'
    : (leftVisible && rightVisible)
      ? 'layout-3col'
      : (leftVisible && !rightVisible)
        ? 'layout-left'
        : (!leftVisible && rightVisible)
          ? 'layout-right'
          : 'layout-main';

  const layouts = ['layout-3col', 'layout-left', 'layout-right', 'layout-main'];
  for (const cls of layouts) document.body.classList.remove(cls);
  document.body.classList.add(layoutClass);

  // Keep fullscreen flag for other visual toggles
  document.body.classList.toggle('fullscreen', fullscreen);

  panelStateCache.left = leftVisible;
  panelStateCache.right = rightVisible;
  panelStateCache.fullscreen = fullscreen;
  if (changed && typeof resizeCanvas === 'function') {
    resizeCanvas();
  }
}

function applySnapshot(snapshot) {
  latestSnapshot = snapshot;
  if (renderCtx) {
    const seqAckSource = Number(snapshot?.viewerCameraSyncSeq);
    if (Number.isFinite(seqAckSource)) {
      const seqAck = Math.max(0, Math.trunc(seqAckSource));
      const prevAckSource = Number(renderCtx.viewerCameraSyncSeqAck);
      const prevAck = Number.isFinite(prevAckSource) ? Math.max(0, Math.trunc(prevAckSource)) : 0;
      renderCtx.viewerCameraSyncSeqAck = Math.max(prevAck, seqAck);
    }
    const seqSentSource = Number(renderCtx.viewerCameraSyncSeqSent);
    const seqSent = Number.isFinite(seqSentSource) ? Math.max(0, Math.trunc(seqSentSource)) : 0;
    const seqAckSource2 = Number(renderCtx.viewerCameraSyncSeqAck);
    const seqAck2 = Number.isFinite(seqAckSource2) ? Math.max(0, Math.trunc(seqAckSource2)) : 0;
    renderCtx.viewerCameraSynced = seqSent > 0 && seqAck2 >= seqSent;
  }
  const perfEnabled = isPerfEnabled();
  const t0 = perfEnabled ? perfNow() : 0;
  let mergeMs = null;
  store.update((draft) => {
    if (perfEnabled) {
      const tMergeStart = perfNow();
      mergeBackendSnapshot(draft, snapshot);
      mergeMs = perfNow() - tMergeStart;
    } else {
      mergeBackendSnapshot(draft, snapshot);
    }
  });
  if (perfEnabled) {
    perfSample('main:store_update_ms', perfNow() - t0, {
      frameId: Number.isFinite(snapshot?.frameId) ? (snapshot.frameId | 0) : null,
      ngeom: typeof snapshot?.ngeom === 'number' ? (snapshot.ngeom | 0) : null,
      hasSceneSoA: (snapshot?.scn_ngeom | 0) > 0,
    });
    if (typeof mergeMs === 'number' && Number.isFinite(mergeMs)) {
      perfSample('main:mergeBackendSnapshot_ms', mergeMs, {
        frameId: Number.isFinite(snapshot?.frameId) ? (snapshot.frameId | 0) : null,
        ngeom: typeof snapshot?.ngeom === 'number' ? (snapshot.ngeom | 0) : null,
        hasSceneSoA: (snapshot?.scn_ngeom | 0) > 0,
      });
    }
    perfMarkOnce('play:main:first_store_update_end');
  }
  if (snapshotSubscribers.size) {
    const state = store.get();
    const nowMs = perfNow();
    for (const fn of snapshotSubscribers) {
      try {
        fn({ snapshot, state, nowMs });
      } catch (err) {
        logWarn('[clock] snapshot subscriber error', err);
        strictCatch(err, 'main:clock_snapshot_subscriber');
      }
    }
  }
  if (typeof window !== 'undefined') {
    window.__lastSnapshot = snapshot;
  }
}
if (typeof window !== 'undefined') {
  window.__PLAY_DUMP_GEOMORDER = () => ({ disabled: true });
}
let pendingRenderFrame = false;
let renderSceneDirty = false;
function scheduleRenderScene() {
  renderSceneDirty = true;
  if (pendingRenderFrame) return;
  if (typeof window === 'undefined' || typeof window.requestAnimationFrame !== 'function') return;
  pendingRenderFrame = true;
  window.requestAnimationFrame(() => {
    pendingRenderFrame = false;
    if (!renderSceneDirty) return;
    renderSceneDirty = false;
    if (!latestSnapshot) return;
    const perfEnabled = isPerfEnabled();
    const tRenderStart = perfEnabled ? perfNow() : 0;
    rendererManager.renderScene(latestSnapshot, store.get());
    if (frameSubscribers.size) {
      for (const fn of frameSubscribers) {
        try {
          fn({ snapshot: latestSnapshot, state: store.get() });
        } catch (err) {
          logWarn('[clock] frame subscriber error', err);
          strictCatch(err, 'main:clock_frame_subscriber');
        }
      }
    }
    if (perfEnabled) {
      perfSample('main:raf_renderScene_ms', perfNow() - tRenderStart, {
        frameId: Number.isFinite(latestSnapshot?.frameId) ? (latestSnapshot.frameId | 0) : null,
        ngeom: typeof latestSnapshot?.ngeom === 'number' ? (latestSnapshot.ngeom | 0) : null,
        scn_ngeom: (latestSnapshot?.scn_ngeom | 0) > 0 ? (latestSnapshot.scn_ngeom | 0) : null,
      });
      perfMarkOnce('play:main:first_raf_renderScene_end');
    }
  });
}

const initialSnapshot = await backend.snapshot();
applySnapshot(initialSnapshot);
backend.subscribe((snapshot) => {
  applySnapshot(snapshot);
});

let lastLayoutKey = null;
let lastFontIndex = null;
let pendingUiFrame = false;
let pendingUiState = null;
let lastUiUpdateMs = 0;
let lastControlsUpdateMs = 0;
let lastUiSlowUpdateMs = 0;
let lastInfoOverlayVisible = false;
let lastRightPanelVisible = false;
let lastRightCtrlRef = null;
let lastRightActsRef = null;
let lastRightQposRef = null;
let lastRightEqActiveRef = null;
const UI_UPDATE_INTERVAL_MS = readNumericParam(
  'ui_ms',
  33,
  { parser: (value) => Number.parseInt(value, 10), min: 16, max: 2000 },
);
const UI_SLOW_UPDATE_INTERVAL_MS = readNumericParam(
  'ui_slow_ms',
  1000,
  { parser: (value) => Number.parseInt(value, 10), min: 200, max: 10000 },
);
const CONTROLS_UPDATE_INTERVAL_MS = Math.max(UI_UPDATE_INTERVAL_MS, 120);

function scheduleUiUpdate(state) {
  pendingUiState = state;
  if (pendingUiFrame) return;
  pendingUiFrame = true;
  const tick = () => {
    pendingUiFrame = false;
    const now = perfNow();
    const elapsedMs = now - lastUiUpdateMs;
    if (elapsedMs < UI_UPDATE_INTERVAL_MS) {
      const waitMs = Math.max(0, UI_UPDATE_INTERVAL_MS - elapsedMs);
      pendingUiFrame = true;
      setTimeout(() => {
        if (typeof window !== 'undefined' && window.requestAnimationFrame) {
          window.requestAnimationFrame(tick);
        } else {
          tick();
        }
      }, waitMs);
      return;
    }
    lastUiUpdateMs = now;
    const uiState = pendingUiState || state;
    if ((now - lastControlsUpdateMs) >= CONTROLS_UPDATE_INTERVAL_MS) {
      lastControlsUpdateMs = now;
      updateControls(uiState);
    }
    updateToast(uiState);
    updateRealtimeOverlay(uiState);
    updateInfoOverlayTime(uiState);

    const infoVisible = !!uiState?.overlays?.info;
    if (infoVisible && !lastInfoOverlayVisible) {
      updateInfoOverlayCard(uiState);
      lastUiSlowUpdateMs = now;
      lastInfoOverlayVisible = true;
    } else if (!infoVisible) {
      lastInfoOverlayVisible = false;
    } else if ((now - lastUiSlowUpdateMs) >= UI_SLOW_UPDATE_INTERVAL_MS) {
      lastUiSlowUpdateMs = now;
      updateInfoOverlayCard(uiState);
    }

    updateInfoOverlayFast(uiState);

    const snapshot = latestSnapshot || null;
    if (uiTickSubscribers.size) {
      for (const fn of uiTickSubscribers) {
        try {
          fn({ snapshot, state: uiState, nowMs: now });
        } catch (err) {
          logWarn('[clock] ui tick subscriber error', err);
          strictCatch(err, 'main:clock_ui_subscriber');
        }
      }
    }

    // Dynamic panel elements (actuator/joint/equality lists) can involve lots of DOM writes.
    // Keep them on the UI tick so snapshotHz (30/60/120) does not directly scale UI costs.
    const rightVisible = !!uiState?.panels?.right && !uiState?.overlays?.fullscreen;
    if (!rightVisible || !snapshot) {
      lastRightPanelVisible = false;
      lastRightCtrlRef = null;
      lastRightActsRef = null;
      lastRightQposRef = null;
      lastRightEqActiveRef = null;
      return;
    }
    const panelJustOpened = !lastRightPanelVisible;
    lastRightPanelVisible = true;
    const perfEnabled = isPerfEnabled();

    // Dynamic: build actuator sliders when metadata arrives
    const acts = Array.isArray(snapshot.actuators) ? snapshot.actuators : null;
    if (acts && acts.length > 0 && typeof controlManager.ensureActuatorSliders === 'function') {
      // Prefer freshest ctrl values from the latest backend snapshot; fallback to state
      const ctrlValues = snapshot.ctrl != null
        ? snapshot.ctrl
        : (uiState.model && uiState.model.ctrl != null ? uiState.model.ctrl : []);
      if (panelJustOpened || lastRightActsRef !== acts || lastRightCtrlRef !== ctrlValues) {
        lastRightActsRef = acts;
        lastRightCtrlRef = ctrlValues;
        if (perfEnabled) {
          const tActsStart = perfNow();
          controlManager.ensureActuatorSliders(acts, ctrlValues);
          perfSample('main:subscriber_ensureActuatorSliders_ms', perfNow() - tActsStart);
        } else {
          controlManager.ensureActuatorSliders(acts, ctrlValues);
        }
      }
    }

    if (typeof controlManager.ensureJointSliders === 'function') {
      const qposRef = snapshot.qpos || null;
      if (panelJustOpened || lastRightQposRef !== qposRef) {
        lastRightQposRef = qposRef;
        const tDofsStart = perfEnabled ? perfNow() : 0;
        const dofs = deriveJointDofs(snapshot, uiState);
        if (perfEnabled) {
          perfSample('main:subscriber_deriveJointDofs_ms', perfNow() - tDofsStart, {
            ngeom: typeof snapshot?.ngeom === 'number' ? (snapshot.ngeom | 0) : null,
            hasDofs: Array.isArray(dofs) ? dofs.length : null,
          });
        }
        if (perfEnabled) {
          const tJointStart = perfNow();
          controlManager.ensureJointSliders(dofs);
          perfSample('main:subscriber_ensureJointSliders_ms', perfNow() - tJointStart);
        } else {
          controlManager.ensureJointSliders(dofs);
        }
      }
    }

    if (typeof controlManager.ensureEqualityToggles === 'function') {
      const eqActiveRef = snapshot.eq_active || null;
      if (panelJustOpened || lastRightEqActiveRef !== eqActiveRef) {
        lastRightEqActiveRef = eqActiveRef;
        const tEqStart = perfEnabled ? perfNow() : 0;
        const eqs = deriveEqualityList(snapshot);
        if (perfEnabled) {
          perfSample('main:subscriber_deriveEqualityList_ms', perfNow() - tEqStart);
        }
        if (perfEnabled) {
          const tEqToggleStart = perfNow();
          controlManager.ensureEqualityToggles(eqs);
          perfSample('main:subscriber_ensureEqualityToggles_ms', perfNow() - tEqToggleStart);
        } else {
          controlManager.ensureEqualityToggles(eqs);
        }
      }
    }

  };
  if (typeof window !== 'undefined' && window.requestAnimationFrame) {
    window.requestAnimationFrame(tick);
  } else {
    tick();
  }
}

store.subscribe((state) => {
  const perfEnabled = isPerfEnabled();
  const tSubStart = perfEnabled ? perfNow() : 0;
  if (perfEnabled) {
    const tRenderQueueStart = perfNow();
    scheduleRenderScene();
    perfSample('main:subscriber_scheduleRenderScene_ms', perfNow() - tRenderQueueStart);
  } else {
    scheduleRenderScene();
  }
  const tOverlaysStart = perfEnabled ? perfNow() : 0;
  const overlays = state.overlays || {};
  if (overlays.help !== overlayStateCache.help) {
    updateOverlay(overlayHelp, overlays.help);
    overlayStateCache.help = overlays.help;
  }
  if (overlays.info !== overlayStateCache.info) {
    updateOverlay(overlayInfo, overlays.info);
    overlayStateCache.info = overlays.info;
  }
  if (overlays.profiler !== overlayStateCache.profiler) {
    updateOverlay(overlayProfiler, overlays.profiler);
    overlayStateCache.profiler = overlays.profiler;
  }
  if (overlays.sensor !== overlayStateCache.sensor) {
    updateOverlay(overlaySensor, overlays.sensor);
    overlayStateCache.sensor = overlays.sensor;
  }
  if (overlays.info) {
    // Keep F2 Info HUD time responsive even when UI updates are throttled.
    updateInfoOverlayTime(state);
  }
  if (perfEnabled) {
    perfSample('main:subscriber_updateOverlays_ms', perfNow() - tOverlaysStart);
  }
  if (perfEnabled) {
    const tPanelsStart = perfNow();
    updatePanels(state);
    perfSample('main:subscriber_updatePanels_ms', perfNow() - tPanelsStart);
  } else {
    updatePanels(state);
  }

  const leftVisible = !!state.panels?.left;
  const rightVisible = !!state.panels?.right;
  const fullscreen = !!state.overlays?.fullscreen;
  const layoutKey = `${leftVisible ? '1' : '0'}${rightVisible ? '1' : '0'}${fullscreen ? '1' : '0'}`;
  const fontIndex = Number.isFinite(state.theme?.font) ? (state.theme.font | 0) : null;
  if (layoutKey !== lastLayoutKey || fontIndex !== lastFontIndex) {
    lastLayoutKey = layoutKey;
    lastFontIndex = fontIndex;
    if (perfEnabled) {
      const tResizeStart = perfNow();
      queueResizeCanvas();
      perfSample('main:subscriber_queueResizeCanvas_ms', perfNow() - tResizeStart);
    } else {
      queueResizeCanvas();
    }
  }
  if (perfEnabled) {
    const tUiStart = perfNow();
    scheduleUiUpdate(state);
    perfSample('main:subscriber_scheduleUiUpdate_ms', perfNow() - tUiStart);
  } else {
    scheduleUiUpdate(state);
  }
  if (perfEnabled) {
    perfSample('main:store_subscriber_ms', perfNow() - tSubStart, {
      ngeom: typeof latestSnapshot?.ngeom === 'number' ? (latestSnapshot.ngeom | 0) : null,
      scn_ngeom: (latestSnapshot?.scn_ngeom | 0) > 0 ? (latestSnapshot.scn_ngeom | 0) : null,
    });
  }
});

const cameraController = createCameraController({
  THREE_NS: THREE,
  canvas,
  store,
  backend,
  onGesture: (payload) => applyGesture(store, backend, payload),
  renderCtx,
  debugMode,
  globalUp: new THREE.Vector3(0, 0, 1),
  invertY: false,
  useWasmCamera: true,
});
cameraController.setup();

const pickingController = createPickingController({
  THREE_NS: THREE,
  canvas,
  store,
  backend,
  renderCtx,
  debugMode,
  getSnapshot: () => latestSnapshot,
});
pickingController.setup();

let cachedJointDofs = [];
let cachedJointDofsMeta = null;
let cachedEqualityEntries = [];
let cachedEqualityMeta = null;
let cachedEqualityActiveRef = null;

function deriveJointDofs(snapshot, state) {
  if (!snapshot) return [];
  const jtype = snapshot.jtype instanceof Int32Array
    ? snapshot.jtype
    : (Array.isArray(snapshot.jtype) ? Int32Array.from(snapshot.jtype) : null);
  const jqpos = snapshot.jnt_qposadr instanceof Int32Array
    ? snapshot.jnt_qposadr
    : (Array.isArray(snapshot.jnt_qposadr) ? Int32Array.from(snapshot.jnt_qposadr) : null);
  const jrange = snapshot.jnt_range instanceof Float64Array
    ? snapshot.jnt_range
    : (Array.isArray(snapshot.jnt_range) ? Float64Array.from(snapshot.jnt_range) : null);
  const names = Array.isArray(snapshot.jnt_names) ? snapshot.jnt_names : [];
  const qpos = snapshot.qpos instanceof Float64Array
    ? snapshot.qpos
    : (Array.isArray(snapshot.qpos) ? Float64Array.from(snapshot.qpos) : null);
  const nq = snapshot.nq | 0;
  const groupState = state?.rendering?.groups?.joint;
  const jointGroupEnabled = Array.isArray(groupState) ? groupState.some(Boolean) : true;
  if (!jointGroupEnabled) return [];

  if (!jtype || !jqpos || !jrange) return [];
  const nj = jtype.length || 0;
  const metaSame = !!(cachedJointDofsMeta
    && cachedJointDofsMeta.jtype === jtype
    && cachedJointDofsMeta.jqpos === jqpos
    && cachedJointDofsMeta.jrange === jrange
    && cachedJointDofsMeta.names === names
    && cachedJointDofsMeta.nq === nq);

  if (!metaSame) {
    const out = [];
    for (let i = 0; i < nj; i += 1) {
      const type = jtype[i] | 0;
      if (type !== 2 && type !== 3) continue; // slide / hinge
      const qposIndex = jqpos && i < jqpos.length ? jqpos[i] : -1;
      if (qposIndex < 0 || qposIndex >= nq) continue;
      const r0 = jrange && jrange.length >= 2 * (i + 1) ? jrange[2 * i] : null;
      const r1 = jrange && jrange.length >= 2 * (i + 1) ? jrange[2 * i + 1] : null;
      const min = Number.isFinite(r0) ? r0 : (type === 3 ? -Math.PI : -1);
      const max = Number.isFinite(r1) ? r1 : (type === 3 ? Math.PI : 1);
      const value = qpos && qpos.length > qposIndex ? qpos[qposIndex] : 0;
      const label = names[i] ? String(names[i]) : `Joint ${i}`;
      out.push({ index: qposIndex, jointIndex: i, min, max, value, label });
    }
    cachedJointDofs = out;
    cachedJointDofsMeta = { jtype, jqpos, jrange, names, nq };
    return out;
  }

  if (qpos && qpos.length) {
    for (const entry of cachedJointDofs) {
      const idx = entry.index | 0;
      if (idx >= 0 && idx < qpos.length) {
        entry.value = qpos[idx];
      }
    }
  }
  return cachedJointDofs;
}

function deriveEqualityList(snapshot) {
  if (!snapshot) return [];
  const eqActive = snapshot.eq_active instanceof Uint8Array
    ? snapshot.eq_active
    : (Array.isArray(snapshot.eq_active) ? Uint8Array.from(snapshot.eq_active) : null);
  if (!eqActive || !eqActive.length) return [];
  const eqType = snapshot.eq_type instanceof Int32Array
    ? snapshot.eq_type
    : (Array.isArray(snapshot.eq_type) ? Int32Array.from(snapshot.eq_type) : null);
  const eqObj1 = snapshot.eq_obj1id instanceof Int32Array
    ? snapshot.eq_obj1id
    : (Array.isArray(snapshot.eq_obj1id) ? Int32Array.from(snapshot.eq_obj1id) : null);
  const eqObj2 = snapshot.eq_obj2id instanceof Int32Array
    ? snapshot.eq_obj2id
    : (Array.isArray(snapshot.eq_obj2id) ? Int32Array.from(snapshot.eq_obj2id) : null);
  const eqObjType = snapshot.eq_objtype instanceof Int32Array
    ? snapshot.eq_objtype
    : (Array.isArray(snapshot.eq_objtype) ? Int32Array.from(snapshot.eq_objtype) : null);
  const eqNames = Array.isArray(snapshot.eq_names) ? snapshot.eq_names : null;
  const jointNames = Array.isArray(snapshot.jnt_names) ? snapshot.jnt_names : [];
  const n = eqActive.length | 0;
  const typeLabels = ['connect', 'weld', 'joint', 'tendon', 'flex', 'contact'];

  const meta = { n, eqType, eqObj1, eqObj2, eqObjType, eqNames, jointNames };
  const metaSame = !!(cachedEqualityMeta
    && cachedEqualityMeta.n === meta.n
    && cachedEqualityMeta.eqType === meta.eqType
    && cachedEqualityMeta.eqObj1 === meta.eqObj1
    && cachedEqualityMeta.eqObj2 === meta.eqObj2
    && cachedEqualityMeta.eqObjType === meta.eqObjType
    && cachedEqualityMeta.eqNames === meta.eqNames
    && cachedEqualityMeta.jointNames === meta.jointNames);

  if (!metaSame) {
    const out = [];
    for (let i = 0; i < n; i += 1) {
      const active = !!eqActive[i];
      const t = eqType && i < eqType.length ? (eqType[i] | 0) : -1;
      const typeName = t >= 0 && t < typeLabels.length ? typeLabels[t] : null;
      const objStride = eqObj1 && eqObj1.length >= 2 * n ? 2 : 1;
      const objTypeStride = eqObjType && eqObjType.length >= 2 * n ? 2 : 1;
      const obj1Id = eqObj1 ? eqObj1[(objStride * i) | 0] : -1;
      const obj2Id = eqObj2 ? eqObj2[(objStride * i) | 0] : -1;
      const objType1 = eqObjType ? eqObjType[(objTypeStride * i) | 0] : -1;
      const objType2 = eqObjType ? eqObjType[(objTypeStride * i) + 1] ?? objType1 : objType1;
      const nameFromEq = eqNames && eqNames[i] ? String(eqNames[i]) : null;
      const name1 = objType1 === 3 && obj1Id >= 0 && obj1Id < jointNames.length
        ? String(jointNames[obj1Id] ?? '')
        : null;
      const name2 = objType2 === 3 && obj2Id >= 0 && obj2Id < jointNames.length
        ? String(jointNames[obj2Id] ?? '')
        : null;
      let label = nameFromEq || `Eq ${i}`;
      let fullLabel = label;
      if (!nameFromEq) {
        if (name1 && name2 && name1 !== name2) {
          label = typeName ? `[${typeName}] ${name1} \u2194 ${name2}` : `${name1} \u2194 ${name2}`;
        } else if (name1) {
          label = typeName ? `[${typeName}] ${name1}` : name1;
        } else if (typeName) {
          label = `[${typeName}] Eq ${i}`;
        } else {
          label = `Eq ${i}`;
        }
        fullLabel = label;
      } else {
        fullLabel = nameFromEq;
        label = nameFromEq;
      }
      out.push({ index: i, active, label, fullLabel, typeName, objType1, objType2, obj1Id, obj2Id });
    }
    cachedEqualityEntries = out;
    cachedEqualityMeta = meta;
    cachedEqualityActiveRef = eqActive;
    return out;
  }

  if (cachedEqualityActiveRef !== eqActive) {
    cachedEqualityActiveRef = eqActive;
    for (let i = 0; i < n && i < cachedEqualityEntries.length; i += 1) {
      cachedEqualityEntries[i].active = !!eqActive[i];
    }
  }
  return cachedEqualityEntries;
}

const spec = await loadUiSpec();
renderPanels(spec);
scheduleUiUpdate(store.get());

if (typeof registerGlobalShortcut === 'function') {
  registerGlobalShortcut(['Space'], async (event) => {
    event?.preventDefault?.();
    await toggleControl('simulation.run');
  });

  registerGlobalShortcut(['ArrowRight'], async (event) => {
    event?.preventDefault?.();
    await backend.step?.(1);
  });

  registerGlobalShortcut(['ArrowLeft'], async (event) => {
    event?.preventDefault?.();
    await backend.step?.(-1);
  });

  registerGlobalShortcut(['Escape'], async (event) => {
    event?.preventDefault?.();
    await toggleControl('rendering.camera_mode', 0);
  });

  const togglePanelsWithTab = (event) => {
    event?.preventDefault?.();
    store.update((draft) => {
      if (event?.shiftKey) {
        draft.panels.right = !draft.panels.right;
      } else {
        draft.panels.left = !draft.panels.left;
      }
    });
  };

  registerGlobalShortcut(['Tab'], togglePanelsWithTab);
  registerGlobalShortcut(['Shift', 'Tab'], togglePanelsWithTab);

  registerGlobalShortcut([']'], async (event) => {
    event?.preventDefault?.();
    await cycleCamera(1);
  });

  registerGlobalShortcut(['['], async (event) => {
    event?.preventDefault?.();
    await cycleCamera(-1);
  });

  registerGlobalShortcut(['PageUp'], (event) => {
    event?.preventDefault?.();
    const state = store.get();
    const selection = state?.runtime?.selection;
    const parents = state?.model?.bodyParentId;
    if (!selection || !parents) return;
    const bodyArr = ArrayBuffer.isView(parents) ? parents : null;
    if (!bodyArr || typeof bodyArr.length !== 'number') return;
    let bodyId = Number(selection.body) | 0;
    if (!(bodyId >= 0) && Number.isInteger(selection.geom) && selection.geom >= 0) {
      const geomBody = state?.model?.geomBodyId;
      if (ArrayBuffer.isView(geomBody) && selection.geom < geomBody.length) {
        bodyId = geomBody[selection.geom] | 0;
      }
    }
    if (!(bodyId > 0) || bodyId >= bodyArr.length) return;
    let parentId = -1;
    try {
      parentId = bodyArr[bodyId] ?? -1;
    } catch (err) {
      strictCatch(err, 'main:parentId_lookup');
      parentId = -1;
    }
    if (!(parentId >= 0) || parentId === bodyId) return;
    const geomBodyIds = state?.model?.geomBodyId;
    const ngeom = ArrayBuffer.isView(geomBodyIds) ? geomBodyIds.length : 0;
    let nextGeom = -1;
    if (ArrayBuffer.isView(geomBodyIds)) {
      const currentGeom = Number(selection.geom) | 0;
      if (currentGeom >= 0 && currentGeom < ngeom && (geomBodyIds[currentGeom] | 0) === parentId) {
        nextGeom = currentGeom;
      } else {
        for (let i = 0; i < ngeom; i += 1) {
          if ((geomBodyIds[i] | 0) === parentId) {
            nextGeom = i;
            break;
          }
        }
      }
    }
    const bxpos = latestSnapshot?.bxpos;
    const hasBxpos = ArrayBuffer.isView(bxpos) && typeof latestSnapshot?.nbody === 'number';
    const nbody = hasBxpos ? (latestSnapshot.nbody | 0) : 0;
    let point = null;
    if (hasBxpos && parentId >= 0 && parentId < nbody && bxpos.length >= (parentId + 1) * 3) {
      const base = parentId * 3;
      const px = Number(bxpos[base + 0]) || 0;
      const py = Number(bxpos[base + 1]) || 0;
      const pz = Number(bxpos[base + 2]) || 0;
      point = [px, py, pz];
    } else if (Array.isArray(selection.point) && selection.point.length >= 3) {
      point = [
        Number(selection.point[0]) || 0,
        Number(selection.point[1]) || 0,
        Number(selection.point[2]) || 0,
      ];
    } else {
      point = [0, 0, 0];
    }
    let label = '';
    if (nextGeom >= 0 && Array.isArray(state?.model?.geoms)) {
      const geoms = state.model.geoms;
      const found = geoms.find((g) => (g?.index | 0) === (nextGeom | 0));
      label = typeof found?.name === 'string' && found.name.trim().length > 0
        ? found.name.trim()
        : `Geom ${nextGeom}`;
    } else {
      label = `Body ${parentId}`;
    }
    const ts = Date.now();
    store.update((draft) => {
      if (!draft.runtime) draft.runtime = { ...(draft.runtime || {}) };
      const prevSel = draft.runtime.selection || {};
      const prevSeq = Number(prevSel.seq) || 0;
      const localPoint = Array.isArray(prevSel.localPoint) && prevSel.localPoint.length >= 3
        ? [
            Number(prevSel.localPoint[0]) || 0,
            Number(prevSel.localPoint[1]) || 0,
            Number(prevSel.localPoint[2]) || 0,
          ]
        : [0, 0, 0];
      const normal = Array.isArray(prevSel.normal) && prevSel.normal.length >= 3
        ? [
            Number(prevSel.normal[0]) || 0,
            Number(prevSel.normal[1]) || 0,
            Number(prevSel.normal[2]) || 1,
          ]
        : [0, 0, 1];
      draft.runtime.selection = {
        geom: nextGeom,
        body: parentId,
        joint: -1,
        name: label,
        kind: 'geom',
        point,
        localPoint,
        normal,
        seq: prevSeq + 1,
        timestamp: ts,
      };
      draft.runtime.lastAction = 'select-parent';
      draft.toast = { message: `Selected parent: ${label}`, ts };
    });
  });

  const adjustRealtime = async (delta) => {
    const state = store.get();
    const total = REALTIME_LEVELS.length;
    if (!total) return;
    const currentIdxRaw = Number.isFinite(state?.simulation?.realTimeIndex)
      ? (state.simulation.realTimeIndex | 0)
      : DEFAULT_REALTIME_INDEX;
    const currentIdx = Math.max(0, Math.min(total - 1, currentIdxRaw));
    let nextIdx = currentIdx + delta;
    if (nextIdx < 0) nextIdx = 0;
    if (nextIdx >= total) nextIdx = total - 1;
    if (nextIdx === currentIdx) return;
    const desired = REALTIME_LEVELS[nextIdx] || 100;
    const nextRate = desired / 100;
    store.update((draft) => {
      if (!draft.simulation) draft.simulation = { ...DEFAULT_VIEWER_STATE.simulation };
      draft.simulation.realTimeIndex = nextIdx;
    });
    try {
      if (typeof backend.setRate === 'function') {
        await backend.setRate(nextRate, 'ui');
      }
    } catch (err) {
      logWarn('[ui] setRate failed', err);
      strictCatch(err, 'main:ui_set_rate');
    }
  };

  registerGlobalShortcut(['-'], async (event) => {
    event?.preventDefault?.();
    await adjustRealtime(+1);
  });

  registerGlobalShortcut(['_'], async (event) => {
    event?.preventDefault?.();
    await adjustRealtime(+1);
  });

  registerGlobalShortcut(['='], async (event) => {
    event?.preventDefault?.();
    await adjustRealtime(-1);
  });

  registerGlobalShortcut(['+'], async (event) => {
    event?.preventDefault?.();
    await adjustRealtime(-1);
  });
}

const uiSectionRegistry = new Map();
const UI_PLUGIN_SECTION_PREFIX = 'plugin:';

function assertUiPanel(panel) {
  if (panel !== 'left' && panel !== 'right') {
    throw new Error(`ui: invalid panel "${panel}" (expected "left" | "right")`);
  }
  return panel;
}

function assertPluginSectionId(sectionId) {
  const id = String(sectionId || '').trim();
  if (!id) throw new Error('ui.sections.register: missing sectionId');
  if (!id.startsWith(UI_PLUGIN_SECTION_PREFIX)) {
    throw new Error(`ui.sections.register: plugin sectionId must start with "${UI_PLUGIN_SECTION_PREFIX}"`);
  }
  if (!/^[A-Za-z0-9:_.-]+$/.test(id)) {
    throw new Error(`ui.sections.register: invalid sectionId "${id}"`);
  }
  return id;
}

function uiPanelRoot(panel) {
  const p = assertUiPanel(panel);
  return p === 'left' ? leftPanel : rightPanel;
}

function uiPanelCoreMount(panel) {
  const p = assertUiPanel(panel);
  return p === 'left' ? leftPanelMount : rightPanelMount;
}

function uiPanelAfterFileMount() {
  return document.querySelector('[data-play-mount="leftPanelAfterFilePlugin"]') || null;
}

function createUiApi() {
  const panelApi = (panel) => {
    const p = assertUiPanel(panel);
    const root = uiPanelRoot(p);
    return {
      root,
      collapseAll: () => (root ? toggleAllPlaySections(root, { nextCollapsed: true }) : { changed: 0, collapsed: true }),
      expandAll: () => (root ? toggleAllPlaySections(root, { nextCollapsed: false }) : { changed: 0, collapsed: false }),
      toggleAll: () => (root ? toggleAllPlaySections(root) : { changed: 0, collapsed: null }),
    };
  };

  const registerSection = (spec) => {
    const mount = (typeof spec?.mount === 'string' && spec.mount.trim().length) ? spec.mount.trim() : null;
    const mountPanel = mount?.startsWith?.('leftPanel')
      ? 'left'
      : (mount?.startsWith?.('rightPanel') ? 'right' : null);
    const rawPanel = String(spec?.panel ?? mountPanel ?? 'left').trim();
    const panel = assertUiPanel(rawPanel);
    if (mountPanel && panel !== mountPanel) {
      throw new Error(`ui.sections.register: mount "${mount}" requires panel "${mountPanel}" (got "${panel}")`);
    }
    const sectionId = assertPluginSectionId(spec?.sectionId ?? spec?.section_id ?? spec?.id);
    if (uiSectionRegistry.has(sectionId)) {
      throw new Error(`ui.sections.register: section already registered: "${sectionId}"`);
    }
    const panelRoot = uiPanelRoot(panel);
    if (!panelRoot) throw new Error(`ui.sections.register: panel root unavailable: "${panel}"`);

    // Reject collisions with built-in sections (or other plugins that bypassed the registry).
    const existing = panelRoot.querySelector(`[data-play-section-id="${sectionId}"]`);
    if (existing) {
      throw new Error(`ui.sections.register: sectionId collision in DOM: "${sectionId}"`);
    }

    const title = (typeof spec?.title === 'string' && spec.title.trim().length) ? spec.title.trim() : sectionId;
    const defaultOpen =
      (typeof spec?.defaultOpen === 'boolean')
        ? spec.defaultOpen
        : (typeof spec?.default_open === 'boolean' ? spec.default_open : true);

    const after = (typeof spec?.after === 'string' && spec.after.trim().length) ? spec.after.trim() : null;
    const before = (typeof spec?.before === 'string' && spec.before.trim().length) ? spec.before.trim() : null;

    let container = null;
    let insertBefore = null;

    if (mount) {
      if (mount === 'leftPanelAfterFilePlugin') {
        container = uiPanelAfterFileMount();
      } else if (mount === 'leftPanel') {
        container = leftPanelMount;
      } else if (mount === 'rightPanel') {
        container = rightPanelMount;
      } else if (mount === 'leftPanelPlugin') {
        container = leftPanelPluginMount;
      } else if (mount === 'rightPanelPlugin') {
        container = rightPanelPluginMount;
      } else {
        throw new Error(`ui.sections.register: unknown mount "${mount}"`);
      }
      if (!container) throw new Error(`ui.sections.register: mount unavailable: "${mount}"`);
    } else if (panel === 'left' && after === 'file') {
      container = uiPanelAfterFileMount();
      if (!container) {
        container = uiPanelCoreMount(panel);
      }
    } else {
      container = uiPanelCoreMount(panel);
    }

    if (!mount && container === uiPanelCoreMount(panel) && (after || before)) {
      const refId = before || after;
      const refEl = panelRoot.querySelector(`[data-play-section-id="${refId}"]`);
      if (!refEl) {
        throw new Error(`ui.sections.register: reference section not found: "${refId}"`);
      }
      const parent = refEl.parentElement;
      if (parent) {
        container = parent;
        insertBefore = before ? refEl : refEl.nextSibling;
      }
    }

    const { sectionEl, body } = controlManager.createSection({
      container,
      panel,
      sectionId,
      title,
      defaultOpen,
      insertBefore,
    });
    if (!sectionEl || !body) {
      throw new Error(`ui.sections.register: failed to create section: "${sectionId}"`);
    }

    let renderCleanup = null;
    if (typeof spec?.render === 'function') {
      try {
        const result = spec.render(body, { panel, sectionId, sectionEl, body, host: window.__PLAY_HOST__ });
        if (typeof result === 'function') {
          renderCleanup = result;
        } else if (result && typeof result.dispose === 'function') {
          renderCleanup = () => result.dispose();
        }
      } catch (err) {
        try {
          sectionEl.remove();
        } catch (removeErr) {
          logWarn('[ui] plugin section cleanup after render failure failed', { sectionId, err: removeErr });
          strictCatch(removeErr, 'main:ui_plugin_section_cleanup_after_render', { allow: true });
        }
        logWarn('[ui] plugin section render failed', { sectionId, err });
        strictCatch(err, 'main:ui_plugin_section_render', { allow: true });
        throw err;
      }
    }

    const handle = {
      panel,
      sectionId,
      sectionEl,
      body,
      setCollapsed: (collapsed) => setPlaySectionCollapsed(sectionEl, !!collapsed, { panel }),
      collapse: () => setPlaySectionCollapsed(sectionEl, true, { panel }),
      expand: () => setPlaySectionCollapsed(sectionEl, false, { panel }),
      toggle: () => setPlaySectionCollapsed(sectionEl, !sectionEl.classList.contains('is-collapsed'), { panel }),
      dispose: () => {
        try {
          const cleanup = renderCleanup;
          renderCleanup = null;
          if (typeof cleanup === 'function') {
            try {
              cleanup();
            } catch (err) {
              logWarn('[ui] plugin section cleanup failed', { sectionId, err });
              strictCatch(err, 'main:ui_plugin_section_cleanup', { allow: true });
            }
          }
          uiSectionRegistry.delete(sectionId);
          sectionEl.remove();
        } catch (err) {
          logWarn('[ui] plugin section dispose failed', { sectionId, err });
          strictCatch(err, 'main:ui_plugin_section_dispose', { allow: true });
        }
      },
    };
    uiSectionRegistry.set(sectionId, handle);
    return handle;
  };

  const kit = {
    namedRow: (labelText, options = null) => {
      const row = document.createElement('div');
      row.className = 'control-row';
      if (options?.full) row.classList.add('full');
      if (options?.half) row.classList.add('half');
      const label = document.createElement('label');
      label.className = 'control-label';
      label.textContent = labelText ?? '';
      const field = document.createElement('div');
      field.className = 'control-field';
      row.append(label, field);
      return { row, label, field };
    },
    fullRow: (options = null) => {
      const row = document.createElement('div');
      row.className = 'control-row full';
      if (options?.half) row.classList.add('half');
      const field = document.createElement('div');
      field.className = 'control-field';
      row.append(field);
      return { row, field };
    },
    button: ({ label, variant = 'secondary', testId = null, onClick } = {}) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = String(label ?? '').trim();
      if (testId) button.setAttribute('data-testid', String(testId));
      if (variant === 'primary') button.className = 'btn-primary';
      else if (variant === 'pill') button.className = 'btn-pill';
      else button.className = 'btn-secondary';
      if (typeof onClick === 'function') {
        button.addEventListener('click', (event) => onClick(event));
      }
      return button;
    },
    textbox: ({ value = '', placeholder = '', testId = null, onInput, onChange } = {}) => {
      const input = document.createElement('input');
      input.type = 'text';
      input.value = String(value ?? '');
      if (placeholder) input.placeholder = String(placeholder);
      if (testId) input.setAttribute('data-testid', String(testId));
      if (typeof onInput === 'function') {
        input.addEventListener('input', (event) => onInput(event, input.value));
      }
      if (typeof onChange === 'function') {
        input.addEventListener('change', (event) => onChange(event, input.value));
      }
      return input;
    },
    textarea: ({
      value = '',
      placeholder = '',
      rows = 4,
      variant = 'default',
      testId = null,
      onInput,
      onChange,
    } = {}) => {
      const ta = document.createElement('textarea');
      ta.value = String(value ?? '');
      if (placeholder) ta.placeholder = String(placeholder);
      if (Number.isFinite(rows) && (rows | 0) > 0) ta.rows = rows | 0;
      if (variant === 'code') ta.classList.add('code-textarea');
      if (testId) ta.setAttribute('data-testid', String(testId));
      if (typeof onInput === 'function') {
        ta.addEventListener('input', (event) => onInput(event, ta.value));
      }
      if (typeof onChange === 'function') {
        ta.addEventListener('change', (event) => onChange(event, ta.value));
      }
      return ta;
    },
    select: ({ value = '', options = [], testId = null, onChange } = {}) => {
      const sel = document.createElement('select');
      if (testId) sel.setAttribute('data-testid', String(testId));

      const opts = Array.isArray(options) ? options : [];
      for (const entry of opts) {
        const obj = (entry && typeof entry === 'object') ? entry : null;
        const optValue = obj ? obj.value : entry;
        const optLabel = obj ? (obj.label ?? obj.value) : entry;
        const option = document.createElement('option');
        option.value = String(optValue ?? '');
        option.textContent = String(optLabel ?? '');
        sel.appendChild(option);
      }

      sel.value = String(value ?? '');
      if (typeof onChange === 'function') {
        sel.addEventListener('change', (event) => onChange(event, sel.value));
      }
      return sel;
    },
    number: ({
      value = 0,
      min = null,
      max = null,
      step = null,
      variant = 'default',
      testId = null,
      onInput,
      onChange,
    } = {}) => {
      const input = document.createElement('input');
      input.type = 'number';
      input.value = String(Number.isFinite(value) ? value : 0);
      if (min != null) input.min = String(min);
      if (max != null) input.max = String(max);
      if (step != null) input.step = String(step);
      if (variant === 'compact_center') input.classList.add('number-compact-center');
      if (testId) input.setAttribute('data-testid', String(testId));
      if (typeof onInput === 'function') {
        input.addEventListener('input', (event) => onInput(event, input.value));
      }
      if (typeof onChange === 'function') {
        input.addEventListener('change', (event) => onChange(event, input.value));
      }
      return input;
    },
    range: ({ value = 0, min = 0, max = 100, step = 1, testId = null, onInput, onChange } = {}) => {
      const input = document.createElement('input');
      input.type = 'range';
      input.min = String(min);
      input.max = String(max);
      input.step = String(step);
      input.value = String(value);
      if (testId) input.setAttribute('data-testid', String(testId));
      if (typeof onInput === 'function') {
        input.addEventListener('input', (event) => onInput(event, input.value));
      }
      if (typeof onChange === 'function') {
        input.addEventListener('change', (event) => onChange(event, input.value));
      }
      return input;
    },
    segmented: ({ options = [], value = null, testId = null, onChange } = {}) => {
      const root = document.createElement('div');
      root.className = 'segmented';
      if (testId) root.setAttribute('data-testid', String(testId));

      const groupName = `seg_${Math.random().toString(36).slice(2)}`;
      const inputs = [];

      const opts = Array.isArray(options) ? options : [];
      for (const entry of opts) {
        const obj = (entry && typeof entry === 'object') ? entry : null;
        const optValue = obj ? obj.value : entry;
        const optLabel = obj ? (obj.label ?? obj.value) : entry;
        const label = document.createElement('label');
        label.className = 'segmented-option';

        const input = document.createElement('input');
        input.type = 'radio';
        input.name = groupName;
        input.value = String(optValue ?? '');

        const span = document.createElement('span');
        span.textContent = String(optLabel ?? '');

        label.append(input, span);
        root.appendChild(label);
        inputs.push(input);

        input.addEventListener('change', (event) => {
          if (!input.checked) return;
          if (typeof onChange === 'function') onChange(event, input.value);
        });
      }

      if (value != null) {
        const want = String(value);
        for (const input of inputs) {
          if (input.value === want) input.checked = true;
        }
      }

      const api = {
        root,
        inputs,
        value: () => {
          const hit = inputs.find((i) => i.checked);
          return hit ? hit.value : null;
        },
        setValue: (nextValue) => {
          const want = String(nextValue ?? '');
          for (const input of inputs) {
            input.checked = (input.value === want);
          }
        },
      };
      return api;
    },
    codebox: ({ value = '', testId = null } = {}) => {
      const pre = document.createElement('pre');
      pre.className = 'codebox';
      pre.textContent = String(value ?? '');
      if (testId) pre.setAttribute('data-testid', String(testId));
      return pre;
    },
    boolButton: ({ label, value = false, disabled = false, testId = null, onChange } = {}) => {
      const root = document.createElement('label');
      root.className = 'bool-button bool-label';
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.setAttribute('role', 'switch');
      if (testId) input.setAttribute('data-testid', String(testId));
      input.checked = !!value;
      input.disabled = !!disabled;
      input.setAttribute('aria-checked', input.checked ? 'true' : 'false');
      root.classList.toggle('is-active', input.checked);
      root.classList.toggle('is-disabled', input.disabled);
      const text = document.createElement('span');
      text.className = 'bool-text';
      text.textContent = String(label ?? '');
      root.append(input, text);
      input.addEventListener('change', (event) => {
        const next = !!input.checked;
        input.setAttribute('aria-checked', next ? 'true' : 'false');
        root.classList.toggle('is-active', next);
        if (typeof onChange === 'function') onChange(event, next);
      });
      input.addEventListener('focus', () => root.classList.add('has-focus'));
      input.addEventListener('blur', () => root.classList.remove('has-focus'));
      return { root, input, text };
    },
  };

  return {
    panel: panelApi,
    sections: {
      register: registerSection,
      unregister: (sectionId) => {
        const id = String(sectionId || '').trim();
        const entry = uiSectionRegistry.get(id);
        if (!entry) return false;
        entry.dispose();
        return true;
      },
      get: (sectionId) => uiSectionRegistry.get(String(sectionId || '').trim()) ?? null,
      list: () => Array.from(uiSectionRegistry.keys()).sort(),
    },
    kit,
  };
}

if (typeof window !== 'undefined') {
  window.__viewerStore = store;
  window.__viewerControls = {
    getBinding: (id) => controlManager.getBinding(id),
    listIds: (prefix) => controlManager.listIds(prefix),
    toggleControl: (id, value) => controlManager.toggleControl(id, value),
    getControl: (id) => controlManager.getControl(id),
    loadXmlTextAsModel: (xmlText, label) => controlManager.loadXmlTextAsModel?.(xmlText, label),
  };
  window.__viewerRenderer = {
    getStats: () => ({ ...renderStats }),
    getContext: () => (rendererManager.getContext ? rendererManager.getContext() : (renderCtx.initialized ? renderCtx : null)),
    ensureLoop: () => rendererManager.ensureRenderLoop(),
    renderScene: (snapshot, state) => rendererManager.renderScene(snapshot, state),
    getOverlay3D: () => (rendererManager.getOverlay3D ? rendererManager.getOverlay3D() : null),
    overlay3d: {
      get: () => (rendererManager.getOverlay3D ? rendererManager.getOverlay3D() : null),
      createScope: (scopeId, options) => {
        const mgr = rendererManager.getOverlay3D ? rendererManager.getOverlay3D() : null;
        return mgr ? mgr.createScope(scopeId, options) : null;
      },
      getScope: (scopeId) => {
        const mgr = rendererManager.getOverlay3D ? rendererManager.getOverlay3D() : null;
        return mgr ? mgr.getScope(scopeId) : null;
      },
    },
  };
  window.__PLAY_HOST__ = {
    apiVersion: 1,
    mounts: {
      leftPanel: leftPanelMount,
      rightPanel: rightPanelMount,
      overlayRoot: overlayRootMount,
      leftPanelAfterFilePlugin: document.querySelector('[data-play-mount="leftPanelAfterFilePlugin"]') || null,
      leftPanelPlugin: leftPanelPluginMount,
      rightPanelPlugin: rightPanelPluginMount,
    },
    ui: createUiApi(),
    store,
    backend,
    controls: window.__viewerControls,
    renderer: window.__viewerRenderer,
    getSnapshot: () => latestSnapshot,
    clock: {
      onUiTick: (fn) => subscribeClock(uiTickSubscribers, fn),
      onSnapshot: (fn) => subscribeClock(snapshotSubscribers, fn),
      onFrame: (fn) => subscribeClock(frameSubscribers, fn),
    },
    logStatus,
    logWarn,
    logError,
    strictCatch,
  };
}

async function loadPlayPlugins(host) {
  if (!host) return;
  const urls = [];
  if (typeof window !== 'undefined' && !pluginDisposeInstalled) {
    pluginDisposeInstalled = true;
    window.addEventListener('beforeunload', () => {
      while (pluginDisposers.length) {
        const entry = pluginDisposers.pop();
        if (!entry || typeof entry.dispose !== 'function') continue;
        try {
          entry.dispose();
        } catch (err) {
          logWarn('[plugins] dispose failed', { url: entry.url, err });
          strictCatch(err, 'main:plugins_dispose', { allow: true });
        }
      }
    }, { capture: true });
  }
  try {
    const rawList = (typeof globalThis !== 'undefined' && Array.isArray(globalThis.PLAY_PLUGINS))
      ? globalThis.PLAY_PLUGINS
      : [];
    for (const entry of rawList) {
      const s = String(entry || '').trim();
      if (s) urls.push(s);
    }
  } catch (err) {
    logWarn('[plugins] PLAY_PLUGINS parse failed', err);
    strictCatch(err, 'main:plugins_parse_global', { allow: true });
  }
  try {
    if (typeof location !== 'undefined' && location?.search != null) {
      const params = new URLSearchParams(location.search);
      const token = params.get('plugins');
      if (token) {
        for (const raw of token.split(',')) {
          const s = String(raw || '').trim();
          if (s) urls.push(s);
        }
      }
    }
  } catch (err) {
    logWarn('[plugins] query parse failed', err);
    strictCatch(err, 'main:plugins_parse_query', { allow: true });
  }
  if (!urls.length) return;
  const unique = Array.from(new Set(urls));
  for (const url of unique) {
    try {
      const mod = await import(url);
      const register = (mod && typeof mod.registerPlayPlugin === 'function')
        ? mod.registerPlayPlugin
        : (mod && typeof mod.default === 'function' ? mod.default : null);
      if (!register) {
        logWarn('[plugins] missing registerPlayPlugin/default export', { url });
        continue;
      }
      const maybeDisposer = await register(host);
      if (typeof maybeDisposer === 'function') {
        pluginDisposers.push({ url, dispose: maybeDisposer });
      } else if (maybeDisposer && typeof maybeDisposer.dispose === 'function') {
        pluginDisposers.push({ url, dispose: () => maybeDisposer.dispose() });
      }
      logStatus('[plugins] loaded', { url });
    } catch (err) {
      logError('[plugins] load failed', { url, err });
      strictCatch(err, 'main:plugins_load', { allow: true });
    }
  }
}

if (typeof window !== 'undefined') {
  loadPlayPlugins(window.__PLAY_HOST__).catch((err) => {
    logError('[plugins] load failed (uncaught)', err);
    strictCatch(err, 'main:plugins_load_uncaught', { allow: true });
  });
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

function queueResizeCanvas() {
  if (typeof window === 'undefined' || typeof window.requestAnimationFrame !== 'function') {
    resizeCanvas();
    return;
  }
  if (queueResizeCanvas._pending) return;
  queueResizeCanvas._pending = true;
  window.requestAnimationFrame(() => {
    queueResizeCanvas._pending = false;
    resizeCanvas();
  });
}

queueResizeCanvas();
window.addEventListener('resize', queueResizeCanvas);
if (typeof ResizeObserver !== 'undefined' && canvas) {
  const ro = new ResizeObserver(() => queueResizeCanvas());
  ro.observe(canvas);
}
