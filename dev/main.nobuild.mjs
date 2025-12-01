import * as THREE from 'three';

import {
  createViewerStore,
  createBackend,
  applySpecAction,
  applyGesture,
  readControlValue,
  mergeBackendSnapshot,
} from './viewer_state.mjs';
import { consumeViewerParams } from './viewer_params.mjs';
import {
  FALLBACK_PRESET_ALIASES,
  FALLBACK_PRESETS,
  createEnvironmentManager,
} from './viewer_environment.mjs';
import { createControlManager } from './viewer_controls.mjs';
import { createCameraController } from './viewer_camera.mjs';
import { createRendererManager } from './viewer_renderer.mjs';
import { createPickingController } from './viewer_picking.mjs';

const CAMERA_PRESETS = ['Free', 'Tracking'];
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
const SCREENSHOT_PIXEL_RATIO_CAP = 2;

const leftPanel = document.querySelector('[data-testid="panel-left"]');
const rightPanel = document.querySelector('[data-testid="panel-right"]');
const canvas = document.querySelector('[data-testid="viewer-canvas"]');
const overlayHelp = document.querySelector('[data-testid="overlay-help"]');
const overlayInfo = document.querySelector('[data-testid="overlay-info"]');
const overlayProfiler = document.querySelector('[data-testid="overlay-profiler"]');
const overlaySensor = document.querySelector('[data-testid="overlay-sensor"]');
const toastEl = document.querySelector('[data-testid="toast"]');
// TODO(play): legacy header HUD elements (sim time/status/camera/gesture) are no longer used.
// Leave the queries commented out for now; remove once header is fully deleted.
// const simTimeEl = document.querySelector('[data-testid="sim-time"]');
// const simStatusEl = document.querySelector('[data-testid="sim-status"]');
// const cameraSummaryEl = document.querySelector('[data-testid="camera-summary"]');
// const gestureEl = document.querySelector('[data-testid="perturb-state"]');
let viewerStoreRef = null;

let latestSnapshot = null;
let renderStats = { drawn: 0, hidden: 0 };
let fpsEstimate = 0;
let lastFpsFrameSample = 0;
let lastFpsSampleTimeMs = (typeof performance !== 'undefined' && performance.now)
  ? performance.now()
  : Date.now();
const panelStateCache = {
  left: null,
  right: null,
  fullscreen: null,
};
let lastScreenshotSeq = 0;
let pendingScreenshotSeq = 0;
let screenshotInFlight = false;
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
if (typeof window !== 'undefined') {
  window.__renderCtx = renderCtx;
}



const {
  fallbackModeParam,
  presetParam: fallbackPresetParam,
  debugMode,
  hideAllGeometryDefault,
  dumpToken,
  findToken,
  bigN,
  skyOverride,
  requestedMode,
  requestedModel,
  skyDebugModeParam,
  hdriParam: hdriQueryParam,
} = consumeViewerParams();

const dumpBigParam = dumpToken === 'big' || findToken === 'big';
const skyOffParam = skyOverride === true;
// Play UI runs on worker backend only; ignore direct/auto requests for now.
const backendMode = 'worker';
const backend = await createBackend({ mode: backendMode, debug: debugMode, model: requestedModel });
const store = createViewerStore({});
viewerStoreRef = store;
if (typeof window !== 'undefined') {
  window.__viewerStore = store;
}

const fallbackEnabledDefault = fallbackModeParam !== 'off';

const fallbackPresetKey = FALLBACK_PRESET_ALIASES[fallbackPresetParam] || 'bright-outdoor';
const { applyFallbackAppearance, ensureEnvIfNeeded } = createEnvironmentManager({
  THREE_NS: THREE,
  store,
  skyOffParam,
  hdriQueryParam: hdriQueryParam,
  fallbackEnabledDefault,
  skyDebugModeParam,
});

const rendererManager = createRendererManager({
  canvas,
  renderCtx,
  applyFallbackAppearance,
  ensureEnvIfNeeded,
  hideAllGeometryDefault,
  fallbackEnabledDefault,
  fallbackPresetKey,
  fallbackModeParam,
  debugMode,
  setRenderStats: (stats) => {
    renderStats = { ...renderStats, ...stats };
    try {
      const frame = Number(stats?.frame);
      const now = (typeof performance !== 'undefined' && performance.now)
        ? performance.now()
        : Date.now();
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
    } catch {}
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
try {
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
} catch {}

function updateOverlay(card, visible) {
  if (!card) return;
  card.classList.toggle('visible', !!visible);
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

// TODO(play): legacy header HUD updater (superseded by F2 info overlay).
// function updateHud(state) {
//   const displayTime = typeof state.hud?.time === 'number' ? state.hud.time : 0;
//   if (simTimeEl) {
//     simTimeEl.textContent = `t = ${displayTime.toFixed(3)}`;
//   }
//   if (simStatusEl) {
//     const status = state.simulation.run ? 'running' : 'paused';
//     const ngeom = state.hud?.ngeom ?? 0;
//     const contacts = state.hud?.contacts ?? 0;
//     const rate = Number.isFinite(state.hud?.rate) ? state.hud.rate : 1;
//     const drawn = renderStats.drawn ?? 0;
//     const pausedSource = state.hud?.pausedSource ?? 'backend';
//     const rateSource = state.hud?.rateSource ?? 'backend';
//     simStatusEl.textContent = `${status} | ngeom=${ngeom} (visible ${drawn}) | contacts=${contacts} | rate=${rate.toFixed(2)}x [${rateSource}] | pause:${pausedSource}`;
//   }
//   if (cameraSummaryEl) {
//     cameraSummaryEl.textContent = `camera: ${state.runtime.cameraLabel}`;
//   }
//   if (gestureEl) {
//     const action = state.runtime.perturb?.active
//       ? (state.runtime.perturb.mode === 'translate' ? 'perturb-translate' : 'perturb-rotate')
//       : (state.runtime.lastAction || 'idle');
//     const selection = state.runtime.selection;
//     const selLabel = selection && selection.geom >= 0
//       ? (selection.name || `geom ${selection.geom}`)
//       : 'none';
//     gestureEl.textContent = `gesture: ${action} | sel: ${selLabel}`;
//   }
// }

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
  const energy = Number(info?.energy);
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
    if (maxCon > 0 || maxEfc > 0) {
      memEl.textContent = `max con/efc: ${maxCon} / ${maxEfc}`;
    } else {
      memEl.textContent = 'n/a';
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

  // Keep legacy fullscreen flag for other visual toggles
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
  if (typeof window !== 'undefined') {
    window.__lastSnapshot = snapshot;
  }
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
  // updateHud(state); // legacy header HUD (kept for reference, replaced by F2 info overlay)
  updatePanels(state);
  updateToast(state);
  updateControls(state);
  updateInfoOverlayCard(state);
  const screenshotSeq = Number(state.runtime?.screenshotSeq) || 0;
  if (screenshotSeq > lastScreenshotSeq) {
    pendingScreenshotSeq = Math.max(pendingScreenshotSeq, screenshotSeq);
  }
  processScreenshotQueue(state);
  // Dynamic: build actuator sliders when metadata arrives
  try {
    const acts = latestSnapshot && Array.isArray(latestSnapshot.actuators)
      ? latestSnapshot.actuators
      : null;
    if (acts && acts.length > 0 && typeof controlManager.ensureActuatorSliders === 'function') {
      // Prefer freshest ctrl values from the latest backend snapshot; fallback to state
      const ctrlValues = (latestSnapshot && latestSnapshot.ctrl != null)
        ? latestSnapshot.ctrl
        : (state.model && state.model.ctrl != null ? state.model.ctrl : []);
      controlManager.ensureActuatorSliders(acts, ctrlValues);
    }
  } catch {}
  try {
    const dofs = deriveJointDofs(latestSnapshot, state);
    if (typeof controlManager.ensureJointSliders === 'function') {
      controlManager.ensureJointSliders(dofs);
    }
  } catch {}
  try {
    const eqs = deriveEqualityList(latestSnapshot);
    if (typeof controlManager.ensureEqualityToggles === 'function') {
      controlManager.ensureEqualityToggles(eqs);
    }
  } catch {}
});

rendererManager.renderScene(latestSnapshot, store.get());


const cameraController = createCameraController({
  THREE_NS: THREE,
  canvas,
  store,
  backend,
  onGesture: (payload) => applyGesture(store, backend, payload),
  renderCtx,
  debugMode,
  globalUp: new THREE.Vector3(0, 0, 1),
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
updateControls(store.get());

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
    } catch {
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

  registerGlobalShortcut(['Ctrl', 'P'], async (event) => {
    event?.preventDefault?.();
    await toggleControl('file.screenshot');
  });

  registerGlobalShortcut(['Meta', 'P'], async (event) => {
    event?.preventDefault?.();
    await toggleControl('file.screenshot');
  });
}
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
      renderScene: (snapshot, state) => rendererManager.renderScene(snapshot, state),
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

function processScreenshotQueue(state) {
  if (!pendingScreenshotSeq || screenshotInFlight) return;
  if (!renderCtx.initialized || !renderCtx.renderer || !renderCtx.scene || !renderCtx.camera) return;
  const seq = pendingScreenshotSeq;
  pendingScreenshotSeq = 0;
  screenshotInFlight = true;
  captureScreenshot(renderCtx, state)
    .catch((err) => {
      console.warn('[screenshot] capture failed', err);
      if (store) {
        try {
          store.update((draft) => {
            draft.toast = { message: 'Screenshot failed', ts: Date.now() };
          });
        } catch {}
      }
    })
    .finally(() => {
      lastScreenshotSeq = Math.max(lastScreenshotSeq, seq);
      screenshotInFlight = false;
      if (pendingScreenshotSeq > 0) {
        processScreenshotQueue(store.get());
      }
    });
}

async function captureScreenshot(ctx, state) {
  const renderer = ctx?.renderer;
  const scene = ctx?.scene;
  const camera = ctx?.camera;
  if (!renderer || !scene || !camera) {
    throw new Error('Renderer not ready for screenshot');
  }
  const size = new THREE.Vector2();
  renderer.getSize(size);
  const pixelRatio =
    typeof window !== 'undefined'
      ? Math.min(Math.max(window.devicePixelRatio || 1, 1), SCREENSHOT_PIXEL_RATIO_CAP)
      : 1;
  const width = Math.max(1, Math.floor(size.x * pixelRatio));
  const height = Math.max(1, Math.floor(size.y * pixelRatio));
  const options = {};
  if (renderer.capabilities?.isWebGL2) {
    const maxSamples = renderer.capabilities.maxSamples || 4;
    options.samples = Math.min(4, maxSamples);
  }
  const target = new THREE.WebGLRenderTarget(width, height, options);
  target.texture.colorSpace = THREE.SRGBColorSpace;
  const prevTarget = renderer.getRenderTarget();
  const prevXr = renderer.xr ? renderer.xr.enabled : false;
  renderer.setRenderTarget(target);
  if (renderer.xr) renderer.xr.enabled = false;
  renderer.render(scene, camera);
  const buffer = new Uint8Array(width * height * 4);
  renderer.readRenderTargetPixels(target, 0, 0, width, height, buffer);
  renderer.setRenderTarget(prevTarget);
  if (renderer.xr) renderer.xr.enabled = prevXr;
  target.dispose();
  const flipped = flipPixelBuffer(buffer, width, height);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx2d = canvas.getContext('2d');
  ctx2d.putImageData(new ImageData(flipped, width, height), 0, 0);
  const blob = await canvasToBlob(canvas);
  triggerDownload(blob, buildScreenshotFilename(state));
}

function flipPixelBuffer(buffer, width, height) {
  const flipped = new Uint8ClampedArray(buffer.length);
  const stride = width * 4;
  for (let y = 0; y < height; y += 1) {
    const src = (height - 1 - y) * stride;
    const dst = y * stride;
    flipped.set(buffer.subarray(src, src + stride), dst);
  }
  return flipped;
}

function canvasToBlob(canvas) {
  return new Promise((resolve, reject) => {
    if (!canvas) {
      reject(new Error('Canvas unavailable'));
      return;
    }
    if (canvas.toBlob) {
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error('Empty screenshot blob'));
      }, 'image/png');
      return;
    }
    try {
      const dataUrl = canvas.toDataURL('image/png');
      const parts = dataUrl.split(',');
      const mime = parts[0]?.match(/:(.*?);/)?.[1] || 'image/png';
      const bytes = atob(parts[1]);
      const buffer = new Uint8Array(bytes.length);
      for (let i = 0; i < bytes.length; i += 1) {
        buffer[i] = bytes.charCodeAt(i);
      }
      resolve(new Blob([buffer], { type: mime }));
    } catch (err) {
      reject(err);
    }
  });
}

function sanitizeToken(value, fallback = 'scene') {
  const token = String(value || fallback)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return token || fallback;
}

function timestampTag() {
  const now = new Date();
  const pad = (v) => String(v).padStart(2, '0');
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(
    now.getMinutes()
  )}${pad(now.getSeconds())}`;
}

function buildScreenshotFilename(state) {
  const name = sanitizeToken(state?.model?.name || 'scene');
  return `mujoco-play-${name}-${timestampTag()}.png`;
}

function triggerDownload(blob, filename) {
  if (typeof document === 'undefined') return;
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  if (document.body && typeof document.body.appendChild === 'function') {
    document.body.appendChild(link);
  }
  link.click();
  if (link.parentNode && typeof link.parentNode.removeChild === 'function') {
    link.parentNode.removeChild(link);
  } else if (typeof link.remove === 'function') {
    link.remove();
  }
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
