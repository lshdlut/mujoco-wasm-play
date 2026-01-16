import * as THREE from 'three';
import {
  consumeViewerParams,
  isPerfEnabled,
  isStrictEnabled,
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
const canvas = document.querySelector('[data-testid="viewer-canvas"]');
const overlayRealtime = document.querySelector('[data-testid="overlay-realtime"]');
const overlayHelp = document.querySelector('[data-testid="overlay-help"]');
const overlayInfo = document.querySelector('[data-testid="overlay-info"]');
const overlayProfiler = document.querySelector('[data-testid="overlay-profiler"]');
const overlaySensor = document.querySelector('[data-testid="overlay-sensor"]');
const toastEl = document.querySelector('[data-testid="toast"]');
let viewerStoreRef = null;
let infoTimeEl = null;

let latestSnapshot = null;
let renderStats = { drawn: 0, hidden: 0 };
let fpsEstimate = 0;
let lastFpsFrameSample = 0;
let lastFpsSampleTimeMs = perfNow();


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
  requestedMode,
  requestedModel,
  skyDebugModeParam,
} = consumeViewerParams();

const dumpBigParam = dumpToken === 'big' || findToken === 'big';
const skyOffParam = skyOverride === true;
// Play UI runs on worker backend only; ignore direct/auto requests for now.
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
  leftPanel,
  rightPanel,
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
const UI_UPDATE_INTERVAL_MS = 120;

function scheduleUiUpdate(state) {
  pendingUiState = state;
  if (pendingUiFrame) return;
  pendingUiFrame = true;
  const tick = () => {
    pendingUiFrame = false;
    const now = perfNow();
    if ((now - lastUiUpdateMs) < UI_UPDATE_INTERVAL_MS) {
      pendingUiFrame = true;
      setTimeout(() => {
        if (typeof window !== 'undefined' && window.requestAnimationFrame) {
          window.requestAnimationFrame(tick);
        } else {
          tick();
        }
      }, UI_UPDATE_INTERVAL_MS);
      return;
    }
    lastUiUpdateMs = now;
    const snapshot = pendingUiState || state;
    updateControls(snapshot);
    updateInfoOverlayCard(snapshot);
    updateToast(snapshot);
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
  if (perfEnabled) {
    const tOverlaysStart = perfNow();
    updateOverlay(overlayHelp, state.overlays.help);
    updateOverlay(overlayInfo, state.overlays.info);
    updateOverlay(overlayProfiler, state.overlays.profiler);
    updateOverlay(overlaySensor, state.overlays.sensor);
    perfSample('main:subscriber_updateOverlays_ms', perfNow() - tOverlaysStart);
  } else {
    updateOverlay(overlayHelp, state.overlays.help);
    updateOverlay(overlayInfo, state.overlays.info);
    updateOverlay(overlayProfiler, state.overlays.profiler);
    updateOverlay(overlaySensor, state.overlays.sensor);
  }
  updateInfoOverlayTime(state);
  if (perfEnabled) {
    const tRealtimeStart = perfNow();
    updateRealtimeOverlay(state);
    perfSample('main:subscriber_updateRealtimeOverlay_ms', perfNow() - tRealtimeStart);
  } else {
    updateRealtimeOverlay(state);
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
  // Dynamic: build actuator sliders when metadata arrives
  const acts = latestSnapshot && Array.isArray(latestSnapshot.actuators)
    ? latestSnapshot.actuators
    : null;
  if (acts && acts.length > 0 && typeof controlManager.ensureActuatorSliders === 'function') {
    // Prefer freshest ctrl values from the latest backend snapshot; fallback to state
    const ctrlValues = (latestSnapshot && latestSnapshot.ctrl != null)
      ? latestSnapshot.ctrl
      : (state.model && state.model.ctrl != null ? state.model.ctrl : []);
    if (perfEnabled) {
      const tActsStart = perfNow();
      controlManager.ensureActuatorSliders(acts, ctrlValues);
      perfSample('main:subscriber_ensureActuatorSliders_ms', perfNow() - tActsStart);
    } else {
      controlManager.ensureActuatorSliders(acts, ctrlValues);
    }
  }
  const tDofsStart = perfEnabled ? perfNow() : 0;
  const dofs = deriveJointDofs(latestSnapshot, state);
  if (perfEnabled) {
    perfSample('main:subscriber_deriveJointDofs_ms', perfNow() - tDofsStart, {
      ngeom: typeof latestSnapshot?.ngeom === 'number' ? (latestSnapshot.ngeom | 0) : null,
      hasDofs: Array.isArray(dofs) ? dofs.length : null,
    });
  }
  if (typeof controlManager.ensureJointSliders === 'function') {
    if (perfEnabled) {
      const tJointStart = perfNow();
      controlManager.ensureJointSliders(dofs);
      perfSample('main:subscriber_ensureJointSliders_ms', perfNow() - tJointStart);
    } else {
      controlManager.ensureJointSliders(dofs);
    }
  }
  const tEqStart = perfEnabled ? perfNow() : 0;
  const eqs = deriveEqualityList(latestSnapshot);
  if (perfEnabled) {
    perfSample('main:subscriber_deriveEqualityList_ms', perfNow() - tEqStart);
  }
  if (typeof controlManager.ensureEqualityToggles === 'function') {
    if (perfEnabled) {
      const tEqToggleStart = perfNow();
      controlManager.ensureEqualityToggles(eqs);
      perfSample('main:subscriber_ensureEqualityToggles_ms', perfNow() - tEqToggleStart);
    } else {
      controlManager.ensureEqualityToggles(eqs);
    }
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
  const out = [];
  const nj = jtype?.length || 0;
  const groupState = state?.rendering?.groups?.joint;
  const jointGroupEnabled = Array.isArray(groupState) ? groupState.some(Boolean) : true;
  if (!jointGroupEnabled) return out;
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
  return out;
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
  const out = [];
  const typeLabels = ['connect', 'weld', 'joint', 'tendon', 'flex', 'contact'];
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
  return out;
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
    };
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


/**
 * Camera controller for orbit/pan/zoom with pointer gestures.
 *
 * Options:
 * - minDistance: fixed minimum distance (takes precedence over getMinDistance).
 * - getMinDistance(camera, target, ctx): dynamic minimum distance when minDistance is not provided.
 * - zoomK: wheel delta scale (default 0.35), maxWheelStep clamps magnitude pre-scaling.
 * - invertY: inverts vertical component for orbit/rotate and translate.
 * - keyRoot: element to receive key events (falls back to canvas).
 * - assertUp: when true, verify camera.up matches initial up and realign if it drifts.
 * - wheelLineFactor / wheelPageFactor: DOM_DELTA normalization constants.
 * - minOrthoZoom / maxOrthoZoom: zoom clamps for orthographic cameras.
 *
 */
