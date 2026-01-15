// Physics worker: loads MuJoCo WASM (dynamically), advances simulation at fixed rate,
// and posts Float64Array snapshots (xpos/xmat) back to the main thread.
import { collectRenderAssetsFromModule, heapViewF64, heapViewF32, heapViewI32, readCString, MjSimLite } from './bridge.mjs';
import {
  isVerboseDebug,
  logError,
  logStatus,
  logWarn,
  withCacheTag,
  strictCatch,
  strictEnsure,
  getStrictReport,
} from './viewer_runtime.mjs';
import { compatFallback } from './fallbacks.mjs';
import { DEFAULT_VOPT_FLAGS_NUMERIC, MJ_GROUP_COUNT, MJ_GROUP_TYPES, SCENE_FLAG_DEFAULTS_NUMERIC } from './viewer_defaults.mjs';
import {
  detectOptionSupport,
  readOptionStruct,
  readStatisticStruct,
  readVisualStruct,
  writeOptionField,
  writeStatisticField,
  writeVisualField,
} from './viewer_structs.mjs';
import { dispatchCommand } from './dispatch.gen.mjs';
import { collectSnapshotTransfers } from './protocol.gen.mjs';

const MJ_TIMER_STEP = 0;
const MJ_TIMER_FORWARD = 1;
const MJ_NTIMER = 15;
const MJ_NSOLVER = 50;
const SOLVER_LOG_EPS = 1e-15;
const MJ_STATE_SIG = 0x1fff;
// Minimal local getView to avoid path issues in buildless mode
function getView(mod, ptr, dtype, len) {
  if (!ptr || !len) {
    if (dtype === 'f64') return new Float64Array(0);
    if (dtype === 'f32') return new Float32Array(0);
    return new Int32Array(0);
  }
  switch (dtype) {
    case 'f64':
      return heapViewF64(mod, ptr, len);
    case 'f32':
      return heapViewF32(mod, ptr, len);
    case 'i32':
      return heapViewI32(mod, ptr, len);
    default:
      return new Float64Array(0);
  }
}

let mod = null;
let sim = null;
let h = 0;
let dt = 0.002;
let rate = 1.0;
let running = false;
let ngeom = 0;
let nu = 0;
let pendingCtrl = new Map(); // index -> value (clamped later)
let ctrlNoiseStd = 0;
let ctrlNoiseRate = 0;
let ctrlNoiseSpare = null;
let gestureState = { mode: 'idle', phase: 'idle', pointer: null };
let dragState = { dx: 0, dy: 0 };
let voptFlags = DEFAULT_VOPT_FLAGS_NUMERIC.slice();
let sceneFlags = SCENE_FLAG_DEFAULTS_NUMERIC.slice();
let labelMode = 0;
let frameMode = 0;
let cameraMode = 0;
let groupState = createGroupState();
let lastBounds = { center: [0, 0, 0], radius: 0 };
let alignSeq = 0;
let copySeq = 0;
let selectionSeq = 0;
let renderAssets = null;
let frameSeq = 0;
let optionSupport = { supported: false, pointers: [] };
let flexLayer = 0;
let bvhDepth = 1;

// mjv perturb pipeline (forge exports): JS only sends begin/move/end + normalized deltas,
// wasm handles mjv_movePerturb + mjv_applyPerturbForce.
const MJ_CAMERA = {
  FREE: 0,
  TRACKING: 1,
  FIXED: 2,
};
const MJ_MOUSE = {
  ROTATE_V: 1,
  ROTATE_H: 2,
  MOVE_V: 3,
  MOVE_H: 4,
  ZOOM: 5,
};
const MJ_PERT = {
  TRANSLATE: 1,
  ROTATE: 2,
};
let mjvPerturbActive = false;
let mjvPerturbBodyId = -1;
let mjvPerturbPtrs = { modelPtr: 0, dataPtr: 0, camPtr: 0, scnPtr: 0, pertPtr: 0 };
let mjvPerturbFns = null;
let mjvCameraFns = null;
let lastSyncWallTime = (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000;
let lastSyncSimTime = 0;
let simTimeApprox = 0;
let hasLoggedNoSim = false;
let measuredSlowdown = 1;
let timingNeedsResync = true;
let lastCpuTimerSnapshot = null;
let snapshotHz = 60;
let snapshotIntervalMs = 1000 / snapshotHz;
let snapshotAccumulatorMs = 0;
let snapshotLastTickMs = 0;
let flexSnapshotLastSentMs = 0;
let lastStepPerf = null;
let lastSnapshotPostMessageMs = 0;

const MAX_WALL_DELTA = 0.25; // clamp wall delta to avoid huge catch-up after tab suspension
const STEP_TICK_BUDGET_MS = 8; // cap stepping time per tick to keep snapshots/messages responsive
const SYNC_MISALIGN_SIM_SEC = 0.1; // match MuJoCo simulate syncMisalign (simulation seconds)

const WORKER_START_WALL_MS = Date.now();
const WORKER_START_PERF_MS =
  (typeof performance !== 'undefined' && typeof performance.now === 'function')
    ? performance.now()
    : Date.now();

function perfNowMs() {
  return (typeof performance !== 'undefined' && typeof performance.now === 'function')
    ? performance.now()
    : Date.now();
}

const perfEnabled = isVerboseDebug();

const perfStages = {
  loadModuleMs: null,
  initFromXmlMs: null,
  collectRenderAssetsMs: null,
};

function buildPerf(extra = null, { includeStages = false } = {}) {
  if (!perfEnabled) return null;
  const payload = {
    sentWallMs: Date.now(),
    workerStartWallMs: WORKER_START_WALL_MS,
    workerUptimeMs: perfNowMs() - WORKER_START_PERF_MS,
  };
  if (includeStages) {
    payload.stages = { ...perfStages };
  }
  if (extra && typeof extra === 'object') {
    return { ...payload, ...extra };
  }
  return payload;
}


// Log minimal status lines to the main thread, keep the rest in the worker console.

// Noise controls are currently disabled in the web build.
// Keep the helpers defined as no-ops so the message wiring stays intact
// without affecting underlying MuJoCo control values.
function standardNormalNoise() {
  return 0;
}

function applyCtrlNoise() {
  // Intentionally left blank: ctrl noise is disabled.
}

const HISTORY_DEFAULT_CAPTURE_HZ = 30;
const HISTORY_MAX_CAPTURE_HZ = 60;
const HISTORY_DEFAULT_CAPACITY = 900;
const KEYFRAME_EXTRA_SLOTS = 5;
const WATCH_FIELDS = ['qpos', 'qvel', 'ctrl', 'sensordata', 'xpos', 'xmat', 'body_xpos', 'body_xmat'];

let historyConfig = { captureHz: HISTORY_DEFAULT_CAPTURE_HZ, capacity: HISTORY_DEFAULT_CAPACITY, stateSig: MJ_STATE_SIG };
let historyState = null;
let keyframeState = null;
let watchState = null;
let keySliderIndex = -1;

function setRunning(next, source = 'backend', notify = true) {
  const target = !!next;
  const changed = running !== target;
  running = target;
  if (running && changed) {
    resetTimingForCurrentSim();
  }
  if (notify && changed) {
    try {
      postMessage({ kind: 'run_state', running: target, source });
    } catch (err) {
      strictCatch(err, 'worker:run_state_post');
    }
  }
}

function resetTimingForCurrentSim(initialRate = null) {
  const nowSec = (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000;
  let tSim = 0;
  try {
    if (sim && typeof sim.time === 'function') {
      tSim = sim.time() || 0;
    } else {
      tSim = simTimeApprox || 0;
    }
  } catch (err) {
    strictCatch(err, 'worker:reset_timing');
    tSim = simTimeApprox || 0;
  }
  lastSyncWallTime = nowSec;
  lastSyncSimTime = tSim;
  simTimeApprox = tSim;
  timingNeedsResync = true;
  if (initialRate != null && Number.isFinite(initialRate)) {
    rate = Math.max(0.0625, Math.min(16, Number(initialRate) || 1));
  }
  }

  function readStructState(scope) {
    if (!mod || !(h > 0)) return null;
    try {
      if (scope === 'mjVisual') return readVisualStruct(mod, h);
      if (scope === 'mjStatistic') return readStatisticStruct(mod, h);
    } catch (err) {
      strictCatch(err, 'worker:read_struct_state');
    }
    return null;
  }

function createGroupState() {
  // Match MuJoCo mjv_defaultOption: first 3 groups enabled, remaining disabled.
  const defaultMask = Array.from({ length: MJ_GROUP_COUNT }, (_, idx) => (idx < 3 ? 1 : 0));
  const state = {};
  for (const type of MJ_GROUP_TYPES) {
    state[type] = defaultMask.slice();
  }
  return state;
}

function cloneGroupState(source = groupState) {
  const out = {};
  for (const type of MJ_GROUP_TYPES) {
    const values = Array.isArray(source?.[type]) ? source[type] : null;
    out[type] = Array.from({ length: MJ_GROUP_COUNT }, (_, idx) => (values && values[idx] ? 1 : 0));
  }
  return out;
}

function cloneSceneFlags(source = sceneFlags) {
  const out = [];
  for (let i = 0; i < SCENE_FLAG_DEFAULTS_NUMERIC.length; i += 1) {
    if (source && source[i] != null) {
      out[i] = source[i] ? 1 : 0;
    } else {
      out[i] = SCENE_FLAG_DEFAULTS_NUMERIC[i];
    }
  }
  return out;
}

function emitOptionState() {
  try {
    const optionsState = readOptionStruct(mod, h) || {};
    optionsState.flex_layer = flexLayer;
    optionsState.bvh_depth = bvhDepth;
    postMessage({
      kind: 'options',
      voptFlags: Array.isArray(voptFlags) ? [...voptFlags] : [],
      sceneFlags: cloneSceneFlags(),
      labelMode,
      frameMode,
      cameraMode,
      groups: cloneGroupState(),
      options: optionsState,
    });
  } catch (err) {
    strictCatch(err, 'worker:emitOptionState');
  }
}

function syncVoptToWasm() {
  if (!sim || !mod || !(h > 0)) return false;

  const writeScalar = (view, value) => {
    if (!view || view.length < 1) return false;
    view[0] = value | 0;
    return true;
  };
  const writeGroup = (view, values) => {
    if (!view || !values) return false;
    const n = Math.min(view.length | 0, values.length | 0);
    for (let i = 0; i < n; i += 1) {
      view[i] = values[i] ? 1 : 0;
    }
    return true;
  };

  const flagsView = sim.voptFlagsPtrView?.();
  if (flagsView && Array.isArray(voptFlags) && flagsView.length > 0) {
    const n = Math.min(flagsView.length | 0, voptFlags.length | 0);
    for (let i = 0; i < n; i += 1) flagsView[i] = voptFlags[i] ? 1 : 0;
  }
  writeScalar(sim.voptLabelPtrView?.(), labelMode | 0);
  writeScalar(sim.voptFramePtrView?.(), frameMode | 0);
  writeScalar(sim.voptFlexLayerPtrView?.(), flexLayer | 0);
  writeScalar(sim.voptBvhDepthPtrView?.(), bvhDepth | 0);

  writeGroup(sim.voptGeomGroupView?.(), groupState?.geom || []);
  writeGroup(sim.voptSiteGroupView?.(), groupState?.site || []);
  writeGroup(sim.voptJointGroupView?.(), groupState?.joint || []);
  writeGroup(sim.voptTendonGroupView?.(), groupState?.tendon || []);
  writeGroup(sim.voptActuatorGroupView?.(), groupState?.actuator || []);
  writeGroup(sim.voptFlexGroupView?.(), groupState?.flex || []);
  writeGroup(sim.voptSkinGroupView?.(), groupState?.skin || []);
  return true;
}

function ensureMjvPerturbAbi() {
  if (mjvPerturbFns) return mjvPerturbFns;
  const requiredFns = [
    '_mjwf_mjv_updateCamera',
    '_mjwf_mjv_initPerturb',
    '_mjwf_mjv_movePerturb',
    '_mjwf_mjv_applyPerturbPose',
    '_mjwf_mjv_applyPerturbForce',
  ];
  const requiredPtrs = [
    '_mjwf_scene_maxgeom_ptr',
    '_mjwf_cam_type_ptr',
    '_mjwf_cam_lookat_ptr',
    '_mjwf_cam_distance_ptr',
    '_mjwf_cam_azimuth_ptr',
    '_mjwf_cam_elevation_ptr',
    '_mjwf_cam_orthographic_ptr',
    '_mjwf_pert_select_ptr',
    '_mjwf_pert_active_ptr',
    '_mjwf_pert_active2_ptr',
    '_mjwf_pert_localpos_ptr',
    '_mjwf_pert_scale_ptr',
    '_mjwf_pert_flexselect_ptr',
    '_mjwf_pert_skinselect_ptr',
  ];
  const missing = [
    ...requiredFns.filter((name) => typeof mod?.[name] !== 'function'),
    ...requiredPtrs.filter((name) => typeof mod?.[name] !== 'function'),
  ];
  if (missing.length) {
    throw new Error(`[forge] Missing mjv perturb ABI exports: ${missing.join(', ')}`);
  }
  mjvPerturbFns = {
    updateCamera: mod._mjwf_mjv_updateCamera,
    initPerturb: mod._mjwf_mjv_initPerturb,
    movePerturb: mod._mjwf_mjv_movePerturb,
    applyPose: mod._mjwf_mjv_applyPerturbPose,
    applyForce: mod._mjwf_mjv_applyPerturbForce,
  };
  strictEnsure('ensureMjvPerturbAbi', { reason: 'create' });
  return mjvPerturbFns;
}

function ensureMjvCameraAbi() {
  if (mjvCameraFns) return mjvCameraFns;
  const requiredFns = [
    '_mjwf_mjv_updateCamera',
    '_mjwf_mjv_moveCamera',
  ];
  const requiredPtrs = [
    '_mjwf_cam_type_ptr',
    '_mjwf_cam_trackbodyid_ptr',
    '_mjwf_cam_fixedcamid_ptr',
    '_mjwf_cam_lookat_ptr',
    '_mjwf_cam_distance_ptr',
    '_mjwf_cam_azimuth_ptr',
    '_mjwf_cam_elevation_ptr',
    '_mjwf_cam_orthographic_ptr',
    '_mjwf_scene_maxgeom_ptr',
  ];
  const missing = [
    ...requiredFns.filter((name) => typeof mod?.[name] !== 'function'),
    ...requiredPtrs.filter((name) => typeof mod?.[name] !== 'function'),
  ];
  if (missing.length) {
    throw new Error(`[forge] Missing mjv camera ABI exports: ${missing.join(', ')}`);
  }
  mjvCameraFns = {
    updateCamera: mod._mjwf_mjv_updateCamera,
    moveCamera: mod._mjwf_mjv_moveCamera,
  };
  strictEnsure('ensureMjvCameraAbi', { reason: 'create' });
  return mjvCameraFns;
}

function mjvMouseActionFor(mode, shiftKey) {
  const m = mode === 'rotate' ? 'rotate' : 'translate';
  if (m === 'translate') {
    return shiftKey ? MJ_MOUSE.MOVE_H : MJ_MOUSE.MOVE_V;
  }
  if (m === 'rotate') {
    return shiftKey ? MJ_MOUSE.ROTATE_H : MJ_MOUSE.ROTATE_V;
  }
  return null;
}

function writeViewerCameraFromPayload(payload) {
  if (!payload || !sim) return;
  const lookat = Array.isArray(payload.lookat) ? payload.lookat : null;
  const lookatView = sim.camLookatPtrView?.();
  const typeView = sim.camTypePtrView?.();
  const distView = sim.camDistancePtrView?.();
  const azView = sim.camAzimuthPtrView?.();
  const elView = sim.camElevationPtrView?.();
  const orthoView = sim.camOrthographicPtrView?.();
  const fixedView = sim.camFixedcamidPtrView?.();
  const trackView = sim.camTrackbodyidPtrView?.();
  const payloadType = Number.isFinite(payload.type) ? (payload.type | 0) : MJ_CAMERA.FREE;
  const nextType =
    payloadType === MJ_CAMERA.TRACKING || payloadType === MJ_CAMERA.FIXED
      ? payloadType
      : MJ_CAMERA.FREE;
  if (typeView && typeView.length) typeView[0] = nextType;
  if (fixedView && fixedView.length) {
    fixedView[0] =
      nextType === MJ_CAMERA.FIXED && Number.isFinite(payload.fixedcamid)
        ? (payload.fixedcamid | 0)
        : -1;
  }
  if (trackView && trackView.length) {
    trackView[0] =
      nextType === MJ_CAMERA.TRACKING && Number.isFinite(payload.trackbodyid)
        ? (payload.trackbodyid | 0)
        : -1;
  }
  if (lookatView && lookatView.length >= 3 && lookat) {
    lookatView[0] = Number(lookat[0]) || 0;
    lookatView[1] = Number(lookat[1]) || 0;
    lookatView[2] = Number(lookat[2]) || 0;
  }
  if (distView && distView.length) distView[0] = Number(payload.distance) || 0;
  if (azView && azView.length) azView[0] = Number(payload.azimuth) || 0;
  if (elView && elView.length) elView[0] = Number(payload.elevation) || 0;
  if (orthoView && orthoView.length) orthoView[0] = payload.orthographic ? 1 : 0;
}

function readViewerFreeCameraState() {
  if (!sim) return null;
  const lookatView = sim.camLookatPtrView?.();
  const typeView = sim.camTypePtrView?.();
  const distView = sim.camDistancePtrView?.();
  const azView = sim.camAzimuthPtrView?.();
  const elView = sim.camElevationPtrView?.();
  const orthoView = sim.camOrthographicPtrView?.();
  if (!lookatView || lookatView.length < 3) return null;
  if (!distView || !azView || !elView) return null;
  return {
    type: typeView && typeView.length ? (typeView[0] | 0) : 0,
    lookat: [Number(lookatView[0]) || 0, Number(lookatView[1]) || 0, Number(lookatView[2]) || 0],
    distance: Number(distView[0]) || 0,
    azimuth: Number(azView[0]) || 0,
    elevation: Number(elView[0]) || 0,
    orthographic: !!(orthoView && orthoView.length && orthoView[0]),
  };
}

function clearPerturbXfrcIfNeeded() {
  if (!sim) return;
  const bodyId = mjvPerturbBodyId | 0;
  if (!(bodyId > 0)) return;
  const zero = [0, 0, 0];
  const ok = typeof sim.applyXfrcByBody === 'function' ? sim.applyXfrcByBody(bodyId, zero, zero) : false;
  if (!ok && typeof sim.clearAllXfrc === 'function') {
    sim.clearAllXfrc();
  }
}

function applyMjvPerturbForceIfActive() {
  if (!mjvPerturbActive) return;
  if (!sim || !mod || !(h > 0)) return;
  const fns = ensureMjvPerturbAbi();
  const modelPtr = mjvPerturbPtrs.modelPtr | 0;
  const dataPtr = mjvPerturbPtrs.dataPtr | 0;
  const pertPtr = mjvPerturbPtrs.pertPtr | 0;
  if (!(modelPtr > 0) || !(dataPtr > 0) || !(pertPtr > 0)) return;
  fns.applyForce.call(mod, modelPtr, dataPtr, pertPtr);
}

function applySimulatePerturbPipeline({ paused }) {
  if (!sim || !mod || !(h > 0)) return;
  const fns = ensureMjvPerturbAbi();
  let modelPtr = 0;
  let dataPtr = 0;
  try {
    ({ modelPtr, dataPtr } = sim.ensurePointers());
  } catch (err) {
    strictCatch(err, 'worker:perturb_ensure_pointers');
    return;
  }
  const pertPtr = typeof sim.pertPtr === 'function' ? (sim.pertPtr() | 0) : 0;
  if (!(modelPtr > 0) || !(dataPtr > 0) || !(pertPtr > 0)) return;

  const isPaused = !!paused;
  if (!isPaused) {
    // Simulate: clear old perturbations before applying new ones.
    try { sim.clearAllXfrc?.(); } catch (err) { strictCatch(err, 'worker:clear_xfrc'); }
    try { fns.applyPose.call(mod, modelPtr, dataPtr, pertPtr, 0); } catch (err) { strictCatch(err, 'worker:perturb_pose_run'); }
    try { fns.applyForce.call(mod, modelPtr, dataPtr, pertPtr); } catch (err) { strictCatch(err, 'worker:perturb_force_run'); }
  } else {
    try { fns.applyPose.call(mod, modelPtr, dataPtr, pertPtr, 1); } catch (err) { strictCatch(err, 'worker:perturb_pose_pause'); }
    try { sim.forward?.(); } catch (err) { strictCatch(err, 'worker:perturb_forward_pause'); }
  }
}

function emitStructState(scope) {
  const value = readStructState(scope);
  if (!value) return;
  try {
    postMessage({ kind: 'struct_state', scope, value });
  } catch (err) {
    strictCatch(err, 'worker:emitStructState');
  }
}

function collectCameraMeta() {
  const cameras = [];
  if (!sim || !mod || !(h > 0)) return cameras;
  const count = sim?.ncam?.() | 0;
  if (!(count > 0)) return cameras;
  const readFloat = (field, stride = 1) => {
    if (typeof sim._readModelPtr !== 'function') return null;
    const ptr = sim._readModelPtr(field);
    if (!ptr) return null;
    const len = stride * count;
    if (!(len > 0)) return null;
    const view = heapViewF64(mod, ptr, len);
    if (!view) return null;
    return Array.from(view);
  };
  const readInt = (field) => {
    if (typeof sim._readModelPtr !== 'function') return null;
    const ptr = sim._readModelPtr(field);
    if (!ptr) return null;
    const len = count;
    const view = heapViewI32(mod, ptr, len);
    if (!view) return null;
    return Array.from(view);
  };
  const pos0 = readFloat('cam_pos0', 3) || [];
  const mat0 = readFloat('cam_mat0', 9) || [];
  const fovy = readFloat('cam_fovy', 1) || [];
  const ortho = readInt('cam_orthographic') || [];
  const mode = readInt('cam_mode') || [];
  const bodyId = readInt('cam_bodyid') || [];
  const targetId = readInt('cam_targetbodyid') || [];
  for (let i = 0; i < count; i += 1) {
    const entry = {
      index: i,
      name: typeof sim.cameraNameOf === 'function' ? sim.cameraNameOf(i) || `Camera ${i + 1}` : `Camera ${i + 1}`,
    };
    if (pos0.length >= (i + 1) * 3) {
      entry.pos = pos0.slice(i * 3, i * 3 + 3);
    }
    if (mat0.length >= (i + 1) * 9) {
      const slice = mat0.slice(i * 9, i * 9 + 9);
      entry.mat = slice;
      entry.up = [slice[3], slice[4], slice[5]];
      entry.forward = [slice[6], slice[7], slice[8]];
    }
    if (fovy.length > i) entry.fovy = fovy[i];
    if (Array.isArray(ortho) && ortho.length > i) entry.orthographic = !!ortho[i];
    if (Array.isArray(mode) && mode.length > i) entry.mode = mode[i] | 0;
    if (Array.isArray(bodyId) && bodyId.length > i) entry.bodyId = bodyId[i] | 0;
    if (Array.isArray(targetId) && targetId.length > i) entry.targetBodyId = targetId[i] | 0;
    cameras.push(entry);
  }
  return cameras;
}

function emitCameraMeta() {
  try {
    const cameras = collectCameraMeta();
    postMessage({ kind: 'meta_cameras', cameras });
  } catch (err) {
    logWarn('worker: camera meta failed', String(err || ''));
    strictCatch(err, 'worker:meta_cameras');
  }
}

function collectGeomMeta() {
  const count = sim?.ngeom?.() | 0;
  const geoms = [];
  if (!(count > 0) || !sim) return geoms;
  for (let i = 0; i < count; i += 1) {
    const name =
      typeof sim.geomNameOf === 'function'
        ? sim.geomNameOf(i) || `Geom ${i}`
        : `Geom ${i}`;
    geoms.push({ index: i, name });
  }
  return geoms;
}

function emitGeomMeta() {
  try {
    const geoms = collectGeomMeta();
    postMessage({ kind: 'meta_geoms', geoms });
  } catch (err) {
    logWarn('worker: geom meta failed', String(err || ''));
    strictCatch(err, 'worker:meta_geoms');
  }
}

function normaliseInt(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? (num | 0) : fallback;
}

function clamp(value, lo, hi) {
  return Math.max(lo, Math.min(hi, value));
}

function initHistoryBuffers() {
  const capacity = Math.max(0, historyConfig.capacity | 0);
  const captureHz = Math.max(1, Number(historyConfig.captureHz) || HISTORY_DEFAULT_CAPTURE_HZ);
  const stateSize = typeof sim?.stateSize === 'function' ? (sim.stateSize(historyConfig.stateSig) | 0) : 0;
  if (!(capacity > 0) || !(stateSize > 0)) {
    historyState = {
      enabled: false,
      captureHz,
      capacity,
      stateSize: 0,
      samples: [],
      head: 0,
      count: 0,
      lastCaptureTs: 0,
      scrubIndex: 0,
      scrubActive: false,
      resumeRun: true,
    };
    return;
  }
  historyState = {
    enabled: true,
    captureHz,
    capacity,
    captureIntervalMs: 1000 / captureHz,
    stateSize,
    stateSig: historyConfig.stateSig,
    samples: Array.from({ length: capacity }, () => new Float64Array(stateSize)),
    head: 0,
    count: 0,
    lastCaptureTs: 0,
    scrubIndex: 0,
    scrubActive: false,
    resumeRun: true,
  };
}

function serializeHistoryMeta() {
  if (!historyState) {
    return {
      captureHz: historyConfig.captureHz || HISTORY_DEFAULT_CAPTURE_HZ,
      capacity: historyConfig.capacity || HISTORY_DEFAULT_CAPACITY,
      count: 0,
      horizon: 0,
      scrubIndex: 0,
      live: true,
    };
  }
  const captureHz = historyState.captureHz || HISTORY_DEFAULT_CAPTURE_HZ;
  const horizon = captureHz > 0 ? historyState.count / captureHz : 0;
  return {
    captureHz,
    capacity: historyState.capacity || historyConfig.capacity,
    count: historyState.count || 0,
    horizon,
    scrubIndex: historyState.scrubIndex || 0,
    live: historyState.scrubActive !== true,
  };
}

function emitHistoryMeta() {
  try {
    postMessage({ kind: 'history', ...serializeHistoryMeta() });
  } catch (err) {
    strictCatch(err, 'worker:emitHistoryMeta');
  }
}

function buildInfoStats(sim, tSim, nconLocal) {
  const moduleRef = mod;
  const handle = h;
  if (!moduleRef || !(handle > 0)) return null;
  const out = {
    time: Number(tSim) || 0,
    nefc: 0,
    ncon: Number(nconLocal) || 0,
    cpuStepMs: null,
    cpuForwardMs: null,
    solverSolerr: null,
    solverNiter: null,
    solverFwdinv: null,
    energy: null,
    nisland: null,
    maxuseCon: null,
    maxuseEfc: null,
    narena: null,
    maxuseArena: null,
  };

  const nefcFn = moduleRef._mjwf_data_nefc;
  if (typeof nefcFn === 'function') {
    out.nefc = (nefcFn.call(moduleRef, handle) | 0) || 0;
  }

  const durFn = moduleRef._mjwf_data_timer_duration_ptr;
  const numFn = moduleRef._mjwf_data_timer_number_ptr;
  if (typeof durFn === 'function' && typeof numFn === 'function') {
    const durPtr = durFn.call(moduleRef, handle) | 0;
    const numPtr = numFn.call(moduleRef, handle) | 0;
    if (durPtr && numPtr) {
      const durations = heapViewF64(moduleRef, durPtr, MJ_NTIMER);
      const numbers = heapViewI32(moduleRef, numPtr, MJ_NTIMER);
      const stepDur = Number(durations[MJ_TIMER_STEP]) || 0;
      const stepNum = Number(numbers[MJ_TIMER_STEP]) || 0;
      const fwdDur = Number(durations[MJ_TIMER_FORWARD]) || 0;
      const fwdNum = Number(numbers[MJ_TIMER_FORWARD]) || 0;
      const prev = lastCpuTimerSnapshot;
      if (
        prev
        && typeof prev.stepDur === 'number' && typeof prev.stepNum === 'number'
        && stepDur >= prev.stepDur && stepNum >= prev.stepNum
      ) {
        const deltaDur = stepDur - prev.stepDur;
        const deltaNum = stepNum - prev.stepNum;
        out.cpuStepMs = (deltaDur / Math.max(1, deltaNum)) * 1000;
      } else {
        out.cpuStepMs = (stepDur / Math.max(1, stepNum)) * 1000;
      }
      if (
        prev
        && typeof prev.fwdDur === 'number' && typeof prev.fwdNum === 'number'
        && fwdDur >= prev.fwdDur && fwdNum >= prev.fwdNum
      ) {
        const deltaDur = fwdDur - prev.fwdDur;
        const deltaNum = fwdNum - prev.fwdNum;
        out.cpuForwardMs = (deltaDur / Math.max(1, deltaNum)) * 1000;
      } else {
        out.cpuForwardMs = (fwdDur / Math.max(1, fwdNum)) * 1000;
      }
      lastCpuTimerSnapshot = {
        stepDur,
        stepNum,
        fwdDur,
        fwdNum,
      };
    }
  }

  const nislandFn = moduleRef._mjwf_data_nisland;
  const nisland = (typeof nislandFn === 'function')
    ? ((nislandFn.call(moduleRef, handle) | 0) || 0)
    : 0;
  out.nisland = nisland;

  const niterPtrFn = moduleRef._mjwf_data_solver_niter_ptr;
  const imprPtrFn = moduleRef._mjwf_data_solver_improvement_ptr;
  const gradPtrFn = moduleRef._mjwf_data_solver_gradient_ptr;
  const fwdinvPtrFn = moduleRef._mjwf_data_solver_fwdinv_ptr;

  if (nisland > 0 && typeof niterPtrFn === 'function') {
    const niterPtr = niterPtrFn.call(moduleRef, handle) | 0;
    if (niterPtr) {
      const niterArr = heapViewI32(moduleRef, niterPtr, nisland);
      let totalIter = 0;
      for (let i = 0; i < nisland; i += 1) {
        const it = Number(niterArr[i]) || 0;
        if (it > 0) totalIter += it;
      }
      out.solverNiter = totalIter;
      if (typeof imprPtrFn === 'function' && typeof gradPtrFn === 'function') {
        const baseCount = nisland * MJ_NSOLVER;
        const imprPtr = imprPtrFn.call(moduleRef, handle) | 0;
        const gradPtr = gradPtrFn.call(moduleRef, handle) | 0;
        if (imprPtr && gradPtr && baseCount > 0) {
          const impr = heapViewF64(moduleRef, imprPtr, baseCount);
          const grad = heapViewF64(moduleRef, gradPtr, baseCount);
          let worst = 0;
          for (let i = 0; i < nisland; i += 1) {
            const it = Math.min(MJ_NSOLVER, Math.max(0, Number(niterArr[i]) || 0));
            if (!(it > 0)) continue;
            const idx = i * MJ_NSOLVER + (it - 1);
            const a = Number(impr[idx]) || 0;
            const b = Number(grad[idx]) || 0;
            if (a === 0 && b === 0) continue;
            let solerr_i = 0;
            if (a === 0) {
              solerr_i = b;
            } else if (b === 0) {
              solerr_i = a;
            } else {
              solerr_i = Math.min(a, b);
              if (solerr_i === 0) solerr_i = Math.max(a, b);
            }
            if (solerr_i > worst) worst = solerr_i;
          }
          if (worst > 0) {
            out.solverSolerr = Math.log10(Math.max(SOLVER_LOG_EPS, worst));
          }
        }
      }
    }
  }
  if (typeof fwdinvPtrFn === 'function') {
    const fptr = fwdinvPtrFn.call(moduleRef, handle) | 0;
    if (fptr) {
      const fv = heapViewF64(moduleRef, fptr, 2);
      const f0 = Number(fv[0]) || 0;
      const f1 = Number(fv[1]) || 0;
      out.solverFwdinv = [
        Math.log10(Math.max(SOLVER_LOG_EPS, Math.abs(f0))),
        Math.log10(Math.max(SOLVER_LOG_EPS, Math.abs(f1))),
      ];
    }
  }

  const energyPtrFn = moduleRef._mjwf_data_energy_ptr;
  if (typeof energyPtrFn === 'function') {
    const eptr = energyPtrFn.call(moduleRef, handle) | 0;
    if (eptr) {
      const ev = heapViewF64(moduleRef, eptr, 2);
      const e0 = Number(ev[0]) || 0;
      const e1 = Number(ev[1]) || 0;
      out.energy = e0 + e1;
    }
  }

  const maxConFn = moduleRef._mjwf_data_maxuse_con_ptr;
  const maxEfcFn = moduleRef._mjwf_data_maxuse_efc_ptr;
  if (typeof maxConFn === 'function') {
    const p = maxConFn.call(moduleRef, handle) | 0;
    if (p) {
      const v = heapViewI32(moduleRef, p, 1);
      out.maxuseCon = (v && v.length > 0 ? v[0] : 0) | 0;
    }
  }
  if (typeof maxEfcFn === 'function') {
    const p = maxEfcFn.call(moduleRef, handle) | 0;
    if (p) {
      const v = heapViewI32(moduleRef, p, 1);
      out.maxuseEfc = (v && v.length > 0 ? v[0] : 0) | 0;
    }
  }

  const narenaFn = moduleRef._mjwf_data_narena;
  const maxArenaPtrFn = moduleRef._mjwf_data_maxuse_arena_ptr;
  if (typeof narenaFn === 'function') {
    out.narena = (narenaFn.call(moduleRef, handle) | 0) || 0;
  }
  if (typeof maxArenaPtrFn === 'function') {
    const p = maxArenaPtrFn.call(moduleRef, handle) | 0;
    if (p) {
      const v = heapViewI32(moduleRef, p, 1);
      out.maxuseArena = (v && v.length > 0 ? v[0] : 0) | 0;
    }
  }

  return out;
}

function captureHistorySample(force = false) {
  if (!historyState || !historyState.enabled || !sim) return;
  if (!(historyState.samples?.length > 0)) return;
  if (!force && (!running || historyState.scrubActive)) return;
  const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
  if (!force && historyState.captureIntervalMs > 0) {
    if ((now - historyState.lastCaptureTs) < historyState.captureIntervalMs) return;
  }
  historyState.lastCaptureTs = now;
  const slot = historyState.samples[historyState.head];
  if (!slot) return;
  sim.captureState?.(slot, historyState.stateSig || MJ_STATE_SIG);
  historyState.head = (historyState.head + 1) % historyState.capacity;
  historyState.count = Math.min(historyState.count + 1, historyState.capacity);
}

function releaseHistoryScrub() {
  if (!historyState) return;
  historyState.scrubIndex = 0;
  if (historyState.scrubActive) {
    historyState.scrubActive = false;
    historyState.resumeRun = false;
    setRunning(false, 'history');
  }
}

function loadHistoryOffset(offset) {
  if (!historyState || !(historyState.count > 0) || !sim) {
    releaseHistoryScrub();
    return false;
  }
  if (!(Number.isFinite(offset)) || offset >= 0) {
    releaseHistoryScrub();
    return true;
  }
  const steps = Math.min(historyState.count, Math.abs(offset));
  if (!(steps > 0)) {
    releaseHistoryScrub();
    return false;
  }
  const idx = (historyState.head - steps + historyState.capacity) % historyState.capacity;
  const slot = historyState.samples[idx];
  if (!slot) return false;
  const applied = sim.applyState?.(slot, historyState.stateSig || MJ_STATE_SIG);
  if (!applied) return false;
  historyState.scrubIndex = -steps;
  if (!historyState.scrubActive) {
    historyState.scrubActive = true;
    historyState.resumeRun = false;
  }
  setRunning(false, 'history');
  return true;
}

function applyHistoryConfig(partial = {}) {
  const next = { ...historyConfig };
  if (partial.captureHz !== undefined) {
    const hz = Number(partial.captureHz);
    if (Number.isFinite(hz) && hz > 0) {
      next.captureHz = clamp(Math.round(hz), 5, 240);
    }
  }
  if (partial.capacity !== undefined) {
    const cap = Number(partial.capacity);
    if (Number.isFinite(cap) && cap > 0) {
      next.capacity = clamp(Math.round(cap), 32, 3600);
    }
  }
  historyConfig = next;
  initHistoryBuffers();
  emitHistoryMeta();
}

function resetKeyframes() {
  const stateSig = historyConfig.stateSig || MJ_STATE_SIG;
  const stateSize = typeof sim?.stateSize === 'function' ? (sim.stateSize(stateSig) | 0) : 0;
  const nativeCount = typeof sim?.nkey === 'function' ? (sim.nkey() | 0) : 0;
  const totalSlots = nativeCount + KEYFRAME_EXTRA_SLOTS;
  const slots = Array.from({ length: totalSlots }, (_, idx) => ({
    label: idx < nativeCount ? `XML Key ${idx}` : `User Slot ${idx - nativeCount + 1}`,
    kind: idx < nativeCount ? 'xml' : 'user',
    available: false,
    state: stateSize > 0 ? new Float64Array(stateSize) : null,
  }));
  keyframeState = {
    stateSize,
    stateSig,
    slots,
    nativeCount,
    lastSaved: -1,
    lastLoaded: -1,
  };
  const captureState = typeof sim?.captureState === 'function' ? sim.captureState.bind(sim) : null;
  const applyState = typeof sim?.applyState === 'function' ? sim.applyState.bind(sim) : null;
  if (captureState && applyState && stateSize > 0 && slots.length) {
    const restore = captureState(null, stateSig);
    if (nativeCount > 0 && typeof sim.resetKeyframe === 'function') {
      for (let i = 0; i < nativeCount; i += 1) {
        const slot = slots[i];
        const ok = sim.resetKeyframe(i);
        if (ok && slot.state) {
          captureState(slot.state, stateSig);
          slot.available = true;
        }
      }
      if (restore && restore.length === stateSize) {
        applyState(restore, stateSig);
      }
    } else if (restore && restore.length === stateSize && slots[0]?.state) {
      slots[0].state.set(restore);
      slots[0].available = true;
    }
  }
  keySliderIndex = slots.length ? Math.max(0, Math.min(keySliderIndex, slots.length - 1)) : -1;
  emitKeyframeMeta();
}
function serializeKeyframeMeta() {
  if (!keyframeState) {
    return { capacity: 0, count: 0, labels: [], slots: [], lastSaved: -1, lastLoaded: -1 };
  }
  const slots = Array.isArray(keyframeState.slots) ? keyframeState.slots : [];
  return {
    capacity: slots.length,
    count: slots.filter((slot) => slot.available).length,
    labels: slots.map((slot) => slot.label),
    slots: slots.map((slot, idx) => ({
      index: idx,
      label: slot.label,
      kind: slot.kind,
      available: !!slot.available,
    })),
    lastSaved: keyframeState.lastSaved ?? -1,
    lastLoaded: keyframeState.lastLoaded ?? -1,
  };
}
function emitKeyframeMeta() {
  try {
    postMessage({ kind: 'keyframes', ...serializeKeyframeMeta(), keyIndex: keySliderIndex });
  } catch (err) {
    strictCatch(err, 'worker:emitKeyframeMeta');
  }
}

function ensureKeySlot(index) {
  if (!keyframeState || !Array.isArray(keyframeState.slots)) return null;
  const slots = keyframeState.slots;
  if (!slots.length) return null;
  const target = Math.max(0, Math.min(index, slots.length - 1));
  const slot = slots[target];
  if (slot && !slot.state && (keyframeState.stateSize | 0) > 0) {
    slot.state = new Float64Array(keyframeState.stateSize | 0);
    strictEnsure('ensureKeySlot', { reason: 'allocate', index: target, size: keyframeState.stateSize | 0 });
  }
  return slot;
}

function saveKeyframe(requestedIndex) {
  if (!keyframeState || !sim) return -1;
  const slots = keyframeState.slots || [];
  if (!slots.length) return -1;
  const target = Math.max(
    0,
    Math.min(
      Number.isFinite(requestedIndex) && requestedIndex >= 0 ? requestedIndex | 0 : (keySliderIndex | 0),
      slots.length - 1,
    ),
  );
  const slot = ensureKeySlot(target);
  if (!slot || !slot.state || typeof sim.captureState !== 'function') return -1;
  sim.captureState(slot.state, keyframeState.stateSig || MJ_STATE_SIG);
  slot.available = true;
  keyframeState.lastSaved = target;
  emitKeyframeMeta();
  return target;
}

function loadKeyframe(index) {
  if (!keyframeState || !sim) return false;
  const slots = keyframeState.slots || [];
  if (!slots.length) return false;
  const target = Math.max(0, Math.min(index | 0, slots.length - 1));
  const slot = slots[target];
  if (!slot || !slot.state || !slot.available || typeof sim.applyState !== 'function') return false;
  const ok = sim.applyState(slot.state, keyframeState.stateSig || MJ_STATE_SIG);
  if (!ok) return false;
  keyframeState.lastLoaded = target;
  emitKeyframeMeta();
  releaseHistoryScrub();
  return true;
}
function resetWatchState() {
  watchState = {
    field: 'qpos',
    index: 0,
    value: null,
    min: null,
    max: null,
    samples: 0,
    status: 'idle',
    valid: false,
  };
}

function resolveWatchField(field) {
  const token = String(field || '').trim().toLowerCase();
  if (WATCH_FIELDS.includes(token)) return token;
  if (token === 'xipos' || token === 'body_xipos') return 'body_xpos';
  return null;
}

function updateWatchTarget(field, index) {
  if (!watchState) resetWatchState();
  if (typeof field === 'string') {
    watchState.field = field.trim();
  }
  watchState.index = Math.max(0, normaliseInt(index, 0));
  watchState.value = null;
  watchState.min = null;
  watchState.max = null;
  watchState.samples = 0;
  watchState.status = 'pending';
  watchState.valid = false;
}

function readWatchView(field) {
  const token = resolveWatchField(field) || 'qpos';
  switch (token) {
    case 'xpos':
      return sim?.geomXposView?.();
    case 'xmat':
      return sim?.geomXmatView?.();
    case 'body_xpos':
      return sim?.bodyXposView?.();
    case 'body_xmat':
      return sim?.bodyXmatView?.();
    case 'qvel':
      return sim?.qvelView?.();
    case 'ctrl':
      return sim?.ctrlView?.();
    case 'sensordata':
      return sim?.sensordataView?.();
    default:
      return sim?.qposView?.();
  }
}

function sampleWatch() {
  if (!watchState || !sim) return null;
  const resolved = resolveWatchField(watchState.field);
  const view = readWatchView(resolved || watchState.field);
  const idx = watchState.index | 0;
  if (view && idx >= 0 && idx < view.length) {
    const val = Number(view[idx]) || 0;
    watchState.value = val;
    watchState.min = watchState.min == null ? val : Math.min(watchState.min, val);
    watchState.max = watchState.max == null ? val : Math.max(watchState.max, val);
    watchState.samples += 1;
    watchState.status = 'ok';
    watchState.valid = true;
  } else {
    watchState.value = null;
    watchState.status = 'invalid';
    watchState.valid = false;
  }
  return {
    field: watchState.field,
    resolved: resolved || 'qpos',
    index: watchState.index,
    value: watchState.value,
    min: watchState.min,
    max: watchState.max,
    samples: watchState.samples,
    status: watchState.status,
    valid: !!watchState.valid,
    summary:
      watchState.valid && typeof watchState.value === 'number'
        ? `${(resolved || watchState.field || 'qpos')}[${watchState.index}] = ${watchState.value}`
        : 'n/a',
  };
}

function emitWatchState() {
  const payload = sampleWatch();
  if (!payload) return;
  try {
    postMessage({ kind: 'watch', ...payload });
  } catch (err) {
    strictCatch(err, 'worker:emitWatchState');
  }
}

function collectWatchSources() {
  const sources = {};
  const add = (id, length, label) => {
    if (Number.isFinite(length) && length > 0) {
      sources[id] = {
        length,
        label: label || id,
      };
    }
  };
  const nq = sim?.nq?.() | 0;
  const nv = sim?.nv?.() | 0;
  const nuLocal = sim?.nu?.() | 0;
  const nsens = readDataCount('nsensordata');
  const ngeomLocal = sim?.ngeom?.() | 0;
  const nbodyLocal = sim?.nbody?.() | 0;
  add('qpos', nq, `qpos (${nq})`);
  add('qvel', nv, `qvel (${nv})`);
  add('ctrl', nuLocal, `ctrl (${nuLocal})`);
  add('sensordata', nsens || 0, `sensordata (${nsens || 0})`);
  add('xpos', ngeomLocal * 3, `geom xpos (${ngeomLocal}×3)`);
  add('xmat', ngeomLocal * 9, `geom xmat (${ngeomLocal}×9)`);
  add('body_xpos', nbodyLocal * 3, `body xpos (${nbodyLocal}×3)`);
  add('body_xmat', nbodyLocal * 9, `body xmat (${nbodyLocal}×9)`);
  return sources;
}

function wasmUrl(rel) { return new URL(rel, import.meta.url).href; }

logStatus('worker: boot');

function cstr(modRef, ptr) {
  return readCString(modRef, ptr);
}

function readLastErrorMeta(modRef) {
  const m = modRef || mod || null;
  const meta = {
    errno: 0,
    errmsg: '',
    helperErrno: 0,
    helperErrmsg: '',
  };
  if (!m) return meta;
  if (typeof m._mjwf_helper_errno_last_global === 'function') {
    meta.helperErrno = m._mjwf_helper_errno_last_global() | 0;
  }
  if (typeof m._mjwf_helper_errmsg_last_global === 'function') {
    meta.helperErrmsg = cstr(m, m._mjwf_helper_errmsg_last_global() | 0);
  }
  meta.errno = meta.helperErrno;
  meta.errmsg = meta.helperErrmsg;
  return meta;
}

function readErrno(modRef) {
  const meta = readLastErrorMeta(modRef);
  return meta.errno || meta.helperErrno || 0;
}

function readModelCount(name) {
  if (sim && typeof sim[name] === 'function') {
    return sim[name]() | 0;
  }
  if (!mod || !(h > 0)) return 0;
  const modern = mod[`_mjwf_model_${name}`];
  if (typeof modern === 'function') {
    return modern.call(mod, h) | 0;
  }
  return 0;
}

function readDataCount(name) {
  if (sim && typeof sim[name] === 'function') {
    return sim[name]() | 0;
  }
  if (!mod || !(h > 0)) return 0;
  const modern = mod[`_mjwf_data_${name}`];
  if (typeof modern === 'function') {
    return modern.call(mod, h) | 0;
  }
  return 0;
}

function readPtr(owner, name) {
  if (sim) {
    if (owner === 'model') return sim._readModelPtr?.(name) || 0;
    if (owner === 'data') return sim._readDataPtr?.(name) || 0;
  }
  if (!mod || !(h > 0)) return 0;
  const modern = mod[`_mjwf_${owner}_${name}_ptr`];
  if (typeof modern === 'function') {
    return modern.call(mod, h) | 0;
  }
  return 0;
}

const readModelPtr = (name) => readPtr('model', name);
const readDataPtr = (name) => readPtr('data', name);

function computeBoundsFromPositions(arr, n) {
  if (!arr || !n) {
    return { center: [0, 0, 0], radius: 0 };
  }
  let minx = Infinity;
  let miny = Infinity;
  let minz = Infinity;
  let maxx = -Infinity;
  let maxy = -Infinity;
  let maxz = -Infinity;
  for (let i = 0; i < n; i++) {
    const ix = 3 * i;
    const x = Number(arr[ix + 0]) || 0;
    const y = Number(arr[ix + 1]) || 0;
    const z = Number(arr[ix + 2]) || 0;
    if (x < minx) minx = x;
    if (y < miny) miny = y;
    if (z < minz) minz = z;
    if (x > maxx) maxx = x;
    if (y > maxy) maxy = y;
    if (z > maxz) maxz = z;
  }
  if (!Number.isFinite(minx) || !Number.isFinite(maxx)) {
    return { center: [0, 0, 0], radius: 0 };
  }
  const cx = (minx + maxx) / 2;
  const cy = (miny + maxy) / 2;
  const cz = (minz + maxz) / 2;
  const dx = maxx - minx;
  const dy = maxy - miny;
  const dz = maxz - minz;
  let radius = Math.max(dx, dy, dz) / 2;
  if (!Number.isFinite(radius) || radius <= 0) {
    radius = Math.max(0.1, Math.max(Math.abs(cx), Math.abs(cy), Math.abs(cz)));
  }
  return {
    center: [cx, cy, cz],
    radius,
  };
}

function captureBounds() {
  const n = sim?.ngeom?.() || (ngeom | 0);
  if (!sim || !(n > 0)) {
    return { center: [0, 0, 0], radius: 0 };
  }
  const view = sim.geomXposView?.();
  if (!view) {
    return { center: [0, 0, 0], radius: 0 };
  }
  return computeBoundsFromPositions(view, n);
}

function captureCopyState(precision) {
  const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const nq = readModelCount('nq');
  const nv = readModelCount('nv');
  const nuLocal = readModelCount('nu');
  const naLocal = readModelCount('na');
  const nmocap = readModelCount('nmocap');
  const tSim = sim?.time?.() || 0;
  const payload = {
    kind: 'copyState',
    seq: ++copySeq,
    precision,
    nq,
    nv,
    nu: nuLocal,
    na: naLocal,
    nmocap,
    timestamp: now,
    tSim,
    qposPreview: [],
    qvelPreview: [],
    ctrlPreview: [],
    complete: false,
  };
  if (nq > 0) {
    const view = sim?.qposView?.();
    if (view) {
      const limitPreview = Math.min(nq, 8);
      for (let i = 0; i < limitPreview; i++) {
        payload.qposPreview.push(Number(view[i]) || 0);
      }
      payload.qpos = Array.from(view);
      payload.complete = true;
    }
  }
  if (nv > 0) {
    const view = sim?.qvelView?.();
    if (view) {
      const limitPreview = Math.min(nv, 8);
      for (let i = 0; i < limitPreview; i++) {
        payload.qvelPreview.push(Number(view[i]) || 0);
      }
      payload.qvel = Array.from(view);
      payload.complete = payload.complete && true;
    }
  }
  if (nuLocal > 0) {
    const ctrlView = sim?.ctrlView?.();
    if (ctrlView && ctrlView.length) {
      const limitPreview = Math.min(ctrlView.length, 8);
      for (let i = 0; i < limitPreview; i++) {
        payload.ctrlPreview.push(Number(ctrlView[i]) || 0);
      }
      payload.ctrl = Array.from(ctrlView);
    }
  }
  if (naLocal > 0) {
    const actPtr = readDataPtr('act');
    if (actPtr) {
      const actView = heapViewF64(mod, actPtr, naLocal);
      if (actView && actView.length >= naLocal) {
        payload.act = Array.from(actView);
      }
    }
  }
  if (nmocap > 0) {
    const mposPtr = readDataPtr('mocap_pos');
    const mquatPtr = readDataPtr('mocap_quat');
    if (mposPtr) {
      const mposView = heapViewF64(mod, mposPtr, nmocap * 3);
      if (mposView && mposView.length >= nmocap * 3) {
        payload.mpos = Array.from(mposView);
      }
    }
    if (mquatPtr) {
      const mquatView = heapViewF64(mod, mquatPtr, nmocap * 4);
      if (mquatView && mquatView.length >= nmocap * 4) {
        payload.mquat = Array.from(mquatView);
      }
    }
  }
  return payload;
}

async function loadModule() {
  logStatus('worker: loading forge module...');
  const tLoadStart = perfEnabled ? perfNowMs() : 0;
  // Build absolute URLs and import dynamically to avoid ref path/caching pitfalls
  // Versioned dist base from worker URL (?ver=...) and optional forgeBase override.
  let ver = '3.3.7';
  let forgeBaseOverride = '';
  try {
    const urlSelf = new URL(import.meta.url);
    const v = urlSelf.searchParams.get('ver');
    if (v) ver = v;
    const fb = urlSelf.searchParams.get('forgeBase');
    if (fb) forgeBaseOverride = fb;
  } catch (err) {
    strictCatch(err, 'worker:parse_worker_url');
  }

  let distBase;
  if (forgeBaseOverride) {
    // When forgeBase is provided (e.g. from GitHub Pages demo),
    // treat it as the canonical dist/<ver>/ base URL.
    try {
      // Resolve relative paths (e.g. "/dist/3.3.7/") against this worker URL so
      // local dev + Playwright can pass forgeBase without needing an absolute URL.
      distBase = new URL(forgeBaseOverride, import.meta.url);
    } catch (err) {
      // Fallback to local dist layout if forgeBase is malformed.
      strictCatch(err, 'worker:forgeBase_url', { allow: true });
      distBase = compatFallback(
        'forgeBase.malformed',
        { forgeBase: forgeBaseOverride },
        () => new URL(`../dist/${ver}/`, import.meta.url),
      );
    }
  } else {
    // Local dev: serve dist/<ver>/ from the same origin.
    distBase = new URL(`../dist/${ver}/`, import.meta.url);
  }
  const jsAbs = new URL(`mujoco.js`, distBase);
  const wasmAbs = new URL(`mujoco.wasm`, distBase);

  const assertForgeViewerAbi = (moduleRef) => {
      const required = [
        // Scene pipeline (mjv_updateScene -> packed SoA)
        '_mjwf_scene_update_and_pack',
        '_mjwf_scene_maxgeom_ptr',
        '_mjwf_scene_ngeom',
        '_mjwf_scene_geomorder_ptr',
        '_mjwf_scene_geoms_type_ptr',
        '_mjwf_scene_geoms_pos_ptr',
      '_mjwf_scene_geoms_mat_ptr',
      '_mjwf_scene_geoms_size_ptr',
      '_mjwf_scene_geoms_rgba_ptr',
      '_mjwf_scene_geoms_matid_ptr',
      '_mjwf_scene_geoms_dataid_ptr',
      '_mjwf_scene_geoms_objtype_ptr',
      '_mjwf_scene_geoms_objid_ptr',
      '_mjwf_scene_geoms_category_ptr',
      '_mjwf_scene_geoms_segid_ptr',
      '_mjwf_scene_geoms_transparent_ptr',
      // Viewer options (vopt pointers)
      '_mjwf_vopt_flags_ptr',
      '_mjwf_vopt_label_ptr',
      '_mjwf_vopt_frame_ptr',
      '_mjwf_vopt_flex_layer_ptr',
      '_mjwf_vopt_bvh_depth_ptr',
      '_mjwf_vopt_geomgroup_ptr',
      '_mjwf_vopt_sitegroup_ptr',
        '_mjwf_vopt_jointgroup_ptr',
        '_mjwf_vopt_tendongroup_ptr',
        '_mjwf_vopt_actuatorgroup_ptr',
        '_mjwf_vopt_flexgroup_ptr',
        '_mjwf_vopt_skingroup_ptr',
        // Viewer camera pointers (mjvCamera fields)
        '_mjwf_cam_type_ptr',
        '_mjwf_cam_lookat_ptr',
        '_mjwf_cam_distance_ptr',
        '_mjwf_cam_azimuth_ptr',
        '_mjwf_cam_elevation_ptr',
        '_mjwf_cam_fixedcamid_ptr',
        '_mjwf_cam_orthographic_ptr',
        '_mjwf_cam_trackbodyid_ptr',
        // Perturb pointers (mjvPerturb fields)
        '_mjwf_pert_select_ptr',
        '_mjwf_pert_active_ptr',
        '_mjwf_pert_active2_ptr',
        '_mjwf_pert_localpos_ptr',
        '_mjwf_pert_scale_ptr',
        '_mjwf_pert_flexselect_ptr',
        '_mjwf_pert_skinselect_ptr',
      // mjv helpers for perturb pipeline
      '_mjwf_mjv_updateCamera',
      '_mjwf_mjv_initPerturb',
      '_mjwf_mjv_movePerturb',
      '_mjwf_mjv_applyPerturbPose',
      '_mjwf_mjv_applyPerturbForce',
      // mjv helpers for selection
      '_mjwf_mjv_select',
      // mjv helpers for camera gestures
      '_mjwf_mjv_moveCamera',
    ];
    const missing = required.filter((name) => typeof moduleRef?.[name] !== 'function');
    if (missing.length === 0) return;

    const message =
      `[forge] Missing viewer ABI exports (${missing.length}): ${missing.join(', ')}. ` +
      `This repo now requires a forge build with viewer extensions (scene + vopt pointers). ` +
      `distBase=${distBase.href}`;
    try {
      postMessage({ kind: 'error', message, distBase: distBase.href, missing });
    } catch (err) {
      strictCatch(err, 'worker:abi_missing_notify');
    }
    throw new Error(message);
  };

  // Optional cache tag from version.json (sha8) to avoid stale caching
  let vTag = '';
  try {
    const vinfoUrl = new URL('version.json', distBase);
    vinfoUrl.searchParams.set('cb', String(Date.now()));
    const r = await fetch(vinfoUrl.href, { cache: 'no-store' });
    if (r.ok) {
      const j = await r.json();
      const s = String(j.sha256 || j.git_sha || j.mujoco_git_sha || '');
      vTag = s.slice(0, 8);
    }
  } catch (err) {
    strictCatch(err, 'worker:version_json', { allow: true });
  }
  try {
    const jsHref = withCacheTag(jsAbs.href, vTag);
    const wasmHref = withCacheTag(wasmAbs.href, vTag);
    const loaderMod = await import(/* @vite-ignore */ jsHref);
    const load_mujoco = loaderMod.default;
    const wasmUrl = new URL(wasmHref);
    if (!vTag) wasmUrl.searchParams.set('cb', String(Date.now()));
    mod = await load_mujoco({ locateFile: (p) => (p.endsWith('.wasm') ? wasmUrl.href : p) });
    assertForgeViewerAbi(mod);
    try {
      const enableTimers =
        typeof mod._mjwf_enable_timers === 'function'
          ? mod._mjwf_enable_timers
          : (typeof mod.cwrap === 'function' ? mod.cwrap('mjwf_enable_timers', null, []) : null);
      if (typeof enableTimers === 'function') {
        enableTimers.call(mod);
      }
    } catch (err) {
      strictCatch(err, 'worker:enable_timers');
    }
  } catch (e) {
    strictCatch(e, 'worker:loadModule');
    throw e;
  }
  logStatus('worker: forge module ready');
  if (perfEnabled) {
    perfStages.loadModuleMs = perfNowMs() - tLoadStart;
  }
  return mod;
}


async function loadXmlWithFallback(xmlText, initOptions = null) {
  if (!mod) await loadModule();
  const ensureSim = () => {
    if (!sim || sim.mod !== mod) {
      sim = new MjSimLite(mod);
    }
  };
  const abi = typeof mod?._mjwf_abi_version === 'function' ? (mod._mjwf_abi_version() | 0) : 0;
  const attempts = [];
  if (typeof xmlText === 'string' && xmlText.trim().length) {
    attempts.push({ stage: 'primary', loader: async () => xmlText });
  }
  for (const attempt of attempts) {
    try {
      const text = await attempt.loader();
      const tInitStart = perfEnabled ? perfNowMs() : 0;
      ensureSim();
      sim.term();
      sim.initFromXmlStrict(text, initOptions || undefined);
      h = sim.h | 0;
      if (perfEnabled) {
        perfStages.initFromXmlMs = perfNowMs() - tInitStart;
      }
      logStatus(`worker: loaded via ${attempt.stage}`);
      return {
        ok: true,
        abi,
        handle: h,
        errno: 0,
        errmsg: '',
        helperErrno: 0,
        helperErrmsg: '',
      };
    } catch (err) {
      logWarn('worker: loadXmlWithFallback failed', String(err || ''));
      strictCatch(err, 'worker:loadXmlWithFallback', { allow: true });
      compatFallback('loadXmlWithFallback', { stage: attempt.stage, error: String(err || '') });
      const meta = readLastErrorMeta(mod || {});
      if (attempts.length === 1) {
        return {
          ok: false,
          abi,
          handle: 0,
          errno: meta.errno || meta.helperErrno || 0,
          errmsg: meta.errmsg || meta.helperErrmsg || String(err || ''),
          helperErrno: meta.helperErrno || 0,
          helperErrmsg: meta.helperErrmsg || '',
        };
      }
    }
  }
  throw new Error('Unable to create handle');
}



function snapshot() {
  if (!sim || !(sim.h > 0)) return;
  const tSnapshotStart = perfNowMs();
  let snapshotSyncVoptMs = 0;
  let snapshotScenePackMs = 0;
  let snapshotCopyGeomMs = 0;
  let snapshotCopyBodyMs = 0;
  let snapshotCopyCtrlMs = 0;
  let snapshotCopyQposMs = 0;
  let snapshotCopyGsizeMs = 0;
  let snapshotCopyGtypeMs = 0;
  let snapshotCopySceneMs = 0;
  let snapshotCopyFlexMs = 0;
  let snapshotCopyEqMs = 0;
  let snapshotCopyLightMs = 0;
  let snapshotMetaMs = 0;
  let snapshotCollectTransfersMs = 0;
  let snapshotPostMessageMsPrev = lastSnapshotPostMessageMs;
  let transferBytes = 0;
  let transferBuffers = 0;
  let sceneBytes = 0;
  let flexBytes = 0;

  if (perfEnabled) {
    const tSync = perfNowMs();
    syncVoptToWasm();
    snapshotSyncVoptMs = perfNowMs() - tSync;
  } else {
    syncVoptToWasm();
  }
  const catmask = 7; // mjCAT_ALL = mjCAT_STATIC|mjCAT_DYNAMIC|mjCAT_DECOR
  if (typeof sim.sceneUpdateAndPack === 'function') {
    if (perfEnabled) {
      const tScene = perfNowMs();
      sim.sceneUpdateAndPack(catmask);
      snapshotScenePackMs = perfNowMs() - tScene;
    } else {
      sim.sceneUpdateAndPack(catmask);
    }
  }
  const scnNgeom = (typeof sim.sceneNgeom === 'function') ? (sim.sceneNgeom() | 0) : 0;
  const scnTypeView = scnNgeom > 0 ? (sim.sceneGeomTypeView?.() || null) : null;
  const scnPosView = scnNgeom > 0 ? (sim.sceneGeomPosView?.() || null) : null;
  const scnMatView = scnNgeom > 0 ? (sim.sceneGeomMatView?.() || null) : null;
  const scnSizeView = scnNgeom > 0 ? (sim.sceneGeomSizeView?.() || null) : null;
  const scnRgbaView = scnNgeom > 0 ? (sim.sceneGeomRgbaView?.() || null) : null;
  const scnMatIdView = scnNgeom > 0 ? (sim.sceneGeomMatIdView?.() || null) : null;
  const scnDataIdView = scnNgeom > 0 ? (sim.sceneGeomDataIdView?.() || null) : null;
  const scnObjTypeView = scnNgeom > 0 ? (sim.sceneGeomObjTypeView?.() || null) : null;
  const scnObjIdView = scnNgeom > 0 ? (sim.sceneGeomObjIdView?.() || null) : null;
  const scnCategoryView = scnNgeom > 0 ? (sim.sceneGeomCategoryView?.() || null) : null;
  const scnGeomOrderView = scnNgeom > 0 ? (sim.sceneGeomOrderView?.() || null) : null;
  const scnLabelView = scnNgeom > 0 ? (sim.sceneGeomLabelView?.() || null) : null;
  const n = sim.ngeom?.() | 0;
  const nbodyLocal = sim.nbody?.() | 0;
  const nlightLocal = sim.nlight?.() | 0;
  const lightXposView = nlightLocal > 0 ? (sim.lightXposView?.() || null) : null;
  const lightXdirView = nlightLocal > 0 ? (sim.lightXdirView?.() || null) : null;
  const xposView = sim.geomXposView?.();
  const xmatView = sim.geomXmatView?.();
  let xpos = null;
  let xmat = null;
  if (perfEnabled) {
    const tCopy = perfNowMs();
    xpos = xposView ? new Float64Array(xposView) : new Float64Array(0);
    xmat = xmatView ? new Float64Array(xmatView) : new Float64Array(0);
    snapshotCopyGeomMs = perfNowMs() - tCopy;
  } else {
    xpos = xposView ? new Float64Array(xposView) : new Float64Array(0);
    xmat = xmatView ? new Float64Array(xmatView) : new Float64Array(0);
  }
  const gsizeView = sim.geomSizeView?.();
  const gtypeView = sim.geomTypeView?.();
  const ctrlView = sim.ctrlView?.();
  const showFlex = !!(voptFlags?.[24] || voptFlags?.[25] || voptFlags?.[26] || voptFlags?.[27]);
  const wantFlex = showFlex && (() => {
    // Flex snapshots are large; throttle them to reduce contention with mj_step.
    const hz = snapshotHz >= 120 ? 60 : 30;
    const intervalMs = 1000 / hz;
    return !(flexSnapshotLastSentMs > 0) || (tSnapshotStart - flexSnapshotLastSentMs) >= intervalMs;
  })();
  const flexvertXposView = wantFlex ? (sim.flexvertXposView?.() || null) : null;
  const eqTypeView = sim.eqTypeView?.();
  const eqObj1View = sim.eqObj1IdView?.();
  const eqObj2View = sim.eqObj2IdView?.();
  const eqObjTypeView = sim.eqObjTypeView?.();
  const eqActiveView = sim.eqActiveView?.();
  const bodyXposView = sim.bodyXposView?.();
  const bodyXmatView = sim.bodyXmatView?.();
  let bxpos = null;
  let bxmat = null;
  if (bodyXposView || bodyXmatView) {
    if (perfEnabled) {
      const tBody = perfNowMs();
      bxpos = bodyXposView ? new Float64Array(bodyXposView) : null;
      bxmat = bodyXmatView ? new Float64Array(bodyXmatView) : null;
      snapshotCopyBodyMs = perfNowMs() - tBody;
    } else {
      bxpos = bodyXposView ? new Float64Array(bodyXposView) : null;
      bxmat = bodyXmatView ? new Float64Array(bodyXmatView) : null;
    }
  }
  const tSim = sim.time?.() || 0;
  lastBounds = computeBoundsFromPositions(xpos, n);
  const nq = sim.nq?.() | 0;
  const nv = sim.nv?.() | 0;
  const nuLocal = sim.nu?.() | 0;
  let ctrl = null;
  if (nuLocal > 0 && ctrlView) {
    if (perfEnabled) {
      const tCtrl = perfNowMs();
      ctrl = new Float64Array(ctrlView);
      snapshotCopyCtrlMs = perfNowMs() - tCtrl;
    } else {
      ctrl = new Float64Array(ctrlView);
    }
  }
  let qpos = null;
  const qposView = sim.qposView?.();
  if (qposView && nq > 0) {
    // Avoid shipping huge buffers; cap to moderate size while keeping simulate parity for typical models
    if (nq <= 512) {
      if (perfEnabled) {
        const tQpos = perfNowMs();
        qpos = new Float64Array(qposView);
        snapshotCopyQposMs = perfNowMs() - tQpos;
      } else {
        qpos = new Float64Array(qposView);
      }
    }
  }

  const gesture = gestureState
    ? {
        mode: gestureState.mode,
        phase: gestureState.phase,
        pointer: gestureState.pointer
          ? {
              x: Number(gestureState.pointer.x) || 0,
              y: Number(gestureState.pointer.y) || 0,
              dx: Number(gestureState.pointer.dx) || 0,
              dy: Number(gestureState.pointer.dy) || 0,
              buttons: Number(gestureState.pointer.buttons ?? 0),
              pressure: Number(gestureState.pointer.pressure ?? 0),
            }
          : null,
      }
    : { mode: 'idle', phase: 'idle', pointer: null };
  const drag = dragState
    ? { dx: Number(dragState.dx) || 0, dy: Number(dragState.dy) || 0 }
    : { dx: 0, dy: 0 };
  const viewerCamera = readViewerFreeCameraState();
  const frameId = frameSeq++;
  const slowdownSafe = (() => {
    if (!Number.isFinite(measuredSlowdown) || measuredSlowdown <= 0) return 1;
    return measuredSlowdown;
  })();
  const msg = {
    kind: 'snapshot',
    tSim,
    ngeom: n,
    scn_ngeom: scnNgeom,
    nq,
    nv,
    nbody: nbodyLocal,
    xpos,
    xmat,
    bxpos,
    bxmat,
    gesture,
    drag,
    viewerCamera,
    voptFlags: Array.isArray(voptFlags) ? [...voptFlags] : [],
    sceneFlags: cloneSceneFlags(),
    labelMode,
    frameMode,
    cameraMode,
    frameId,
    optionSupport: (typeof optionSupport === 'object' && optionSupport) ? optionSupport : { supported: false, pointers: [] },
    paused: !running,
    pausedSource: historyState?.scrubActive ? 'history' : 'backend',
    rate,
    measuredSlowdown: slowdownSafe,
    qpos,
  };
  let nconLocal = 0;
  try {
    nconLocal = sim.ncon?.() | 0;
  } catch (err) {
    strictCatch(err, 'worker:ncon_read');
  }
  try {
    const info = buildInfoStats(sim, tSim, nconLocal);
    if (info) {
      msg.info = info;
    }
  } catch (err) {
    strictCatch(err, 'worker:build_info_stats');
  }
  const optionsStruct = readOptionStruct(mod, h);
  if (optionsStruct) {
    optionsStruct.flex_layer = flexLayer;
    optionsStruct.bvh_depth = bvhDepth;
    msg.options = optionsStruct;
  } else {
    msg.options = { flex_layer: flexLayer, bvh_depth: bvhDepth };
  }
  let metaStartMs = 0;
  if (perfEnabled) {
    metaStartMs = perfNowMs();
  }
  msg.history = serializeHistoryMeta();
  msg.keyframes = serializeKeyframeMeta();
  const watchPayload = sampleWatch();
  if (watchPayload) {
    msg.watch = watchPayload;
  }
  msg.watchSources = collectWatchSources();
  if (Number.isFinite(keySliderIndex)) {
    msg.keyIndex = keySliderIndex | 0;
  }
  if (perfEnabled) {
    snapshotMetaMs = perfNowMs() - metaStartMs;
  }
  if (gsizeView) {
    if (perfEnabled) {
      const tGsize = perfNowMs();
      msg.gsize = new Float64Array(gsizeView);
      snapshotCopyGsizeMs = perfNowMs() - tGsize;
    } else {
      msg.gsize = new Float64Array(gsizeView);
    }
  }
  if (gtypeView) {
    if (perfEnabled) {
      const tGtype = perfNowMs();
      msg.gtype = new Int32Array(gtypeView);
      snapshotCopyGtypeMs = perfNowMs() - tGtype;
    } else {
      msg.gtype = new Int32Array(gtypeView);
    }
  }
  if (scnNgeom > 0) {
    let tScnCopy = 0;
    if (perfEnabled) {
      tScnCopy = perfNowMs();
    }
    if (scnTypeView) {
      msg.scn_type = new Int32Array(scnTypeView);
      if (perfEnabled) sceneBytes += msg.scn_type.byteLength;
    }
    if (scnPosView) {
      msg.scn_pos = new Float32Array(scnPosView);
      if (perfEnabled) sceneBytes += msg.scn_pos.byteLength;
    }
    if (scnMatView) {
      msg.scn_mat = new Float32Array(scnMatView);
      if (perfEnabled) sceneBytes += msg.scn_mat.byteLength;
    }
    if (scnSizeView) {
      msg.scn_size = new Float32Array(scnSizeView);
      if (perfEnabled) sceneBytes += msg.scn_size.byteLength;
    }
    if (scnRgbaView) {
      msg.scn_rgba = new Float32Array(scnRgbaView);
      if (perfEnabled) sceneBytes += msg.scn_rgba.byteLength;
    }
    if (scnMatIdView) {
      msg.scn_matid = new Int32Array(scnMatIdView);
      if (perfEnabled) sceneBytes += msg.scn_matid.byteLength;
    }
    if (scnDataIdView) {
      msg.scn_dataid = new Int32Array(scnDataIdView);
      if (perfEnabled) sceneBytes += msg.scn_dataid.byteLength;
    }
    if (scnObjTypeView) {
      msg.scn_objtype = new Int32Array(scnObjTypeView);
      if (perfEnabled) sceneBytes += msg.scn_objtype.byteLength;
    }
    if (scnObjIdView) {
      msg.scn_objid = new Int32Array(scnObjIdView);
      if (perfEnabled) sceneBytes += msg.scn_objid.byteLength;
    }
    if (scnCategoryView) {
      msg.scn_category = new Int32Array(scnCategoryView);
      if (perfEnabled) sceneBytes += msg.scn_category.byteLength;
    }
    if (scnGeomOrderView) {
      msg.scn_geomorder = new Int32Array(scnGeomOrderView);
      if (perfEnabled) sceneBytes += msg.scn_geomorder.byteLength;
    }
    if (scnLabelView) {
      msg.scn_label = new Uint8Array(scnLabelView);
      if (perfEnabled) sceneBytes += msg.scn_label.byteLength;
    }
    if (perfEnabled) {
      snapshotCopySceneMs = perfNowMs() - tScnCopy;
    }
  }
  if (flexvertXposView) {
    if (perfEnabled) {
      const tFlex = perfNowMs();
      const fPos = new Float32Array(flexvertXposView.length | 0);
      fPos.set(flexvertXposView);
      msg.flexvert_xpos = fPos;
      flexBytes = fPos.byteLength;
      snapshotCopyFlexMs = perfNowMs() - tFlex;
    } else {
      const fPos = new Float32Array(flexvertXposView.length | 0);
      fPos.set(flexvertXposView);
      msg.flexvert_xpos = fPos;
    }
    flexSnapshotLastSentMs = tSnapshotStart;
  }
  if (eqTypeView || eqObj1View || eqObj2View || eqObjTypeView || eqActiveView) {
    if (perfEnabled) {
      const tEq = perfNowMs();
      if (eqTypeView) msg.eq_type = new Int32Array(eqTypeView);
      if (eqObj1View) msg.eq_obj1id = new Int32Array(eqObj1View);
      if (eqObj2View) msg.eq_obj2id = new Int32Array(eqObj2View);
      if (eqObjTypeView) msg.eq_objtype = new Int32Array(eqObjTypeView);
      if (eqActiveView) msg.eq_active = new Uint8Array(eqActiveView);
      snapshotCopyEqMs = perfNowMs() - tEq;
    } else {
      if (eqTypeView) msg.eq_type = new Int32Array(eqTypeView);
      if (eqObj1View) msg.eq_obj1id = new Int32Array(eqObj1View);
      if (eqObj2View) msg.eq_obj2id = new Int32Array(eqObj2View);
      if (eqObjTypeView) msg.eq_objtype = new Int32Array(eqObjTypeView);
      if (eqActiveView) msg.eq_active = new Uint8Array(eqActiveView);
    }
  }
  if (nlightLocal > 0 && (lightXposView || lightXdirView)) {
    if (perfEnabled) {
      const tLight = perfNowMs();
      if (lightXposView) msg.light_xpos = new Float32Array(lightXposView);
      if (lightXdirView) msg.light_xdir = new Float32Array(lightXdirView);
      snapshotCopyLightMs = perfNowMs() - tLight;
    } else {
      if (lightXposView) msg.light_xpos = new Float32Array(lightXposView);
      if (lightXdirView) msg.light_xdir = new Float32Array(lightXdirView);
    }
  }
  // Equality names: match simulate's equality_names_ = m->names + m->name_eqadr[i]
  // via mj_id2name(mjOBJ_EQUALITY, i).
  if (eqTypeView && typeof sim.id2name === 'function') {
    const names = [];
    const eqCount = eqTypeView.length | 0;
    const MJOBJ_EQUALITY = 17; // from mjOBJ_EQUALITY enum
    for (let i = 0; i < eqCount; i += 1) {
      const nm = sim.id2name(MJOBJ_EQUALITY, i) || '';
      names.push(nm || `equality ${i}`);
    }
    if (names.length === eqCount) {
      msg.eq_names = names;
    }
  }
  if (ctrl) {
    msg.ctrl = ctrl;
  }
  msg.contacts = nconLocal > 0 ? { n: nconLocal } : null;
  const transfers = (() => {
    if (!perfEnabled) return collectSnapshotTransfers(msg);
    const tTransfers = perfNowMs();
    const out = collectSnapshotTransfers(msg);
    snapshotCollectTransfersMs = perfNowMs() - tTransfers;
    if (Array.isArray(out) && out.length) {
      transferBuffers = out.length | 0;
      for (const buf of out) {
        if (buf && typeof buf.byteLength === 'number') {
          transferBytes += buf.byteLength;
        }
      }
    }
    return out;
  })();
  const snapshotMs = perfNowMs() - tSnapshotStart;
  const sentWallMs = Date.now();
  msg.snapshotMs = snapshotMs;
  msg.sentWallMs = sentWallMs;
  if (perfEnabled) {
    const stepPerf = (lastStepPerf && typeof lastStepPerf === 'object') ? lastStepPerf : null;
    msg.perf = buildPerf({
      snapshotMs,
      sentWallMs,
      ngeom: n | 0,
      scn_ngeom: scnNgeom | 0,
      snapshotSyncVoptMs,
      snapshotScenePackMs,
      snapshotCopyGeomMs,
      snapshotCopyBodyMs,
      snapshotCopyCtrlMs,
      snapshotCopyQposMs,
      snapshotCopyGsizeMs,
      snapshotCopyGtypeMs,
      snapshotCopySceneMs,
      snapshotCopyFlexMs,
      snapshotCopyEqMs,
      snapshotCopyLightMs,
      snapshotMetaMs,
      snapshotCollectTransfersMs,
      snapshotPostMessageMsPrev,
      transferBytes,
      transferBuffers,
      sceneBytes,
      flexBytes,
      ...(stepPerf
        ? {
            stepTickMs: stepPerf.tickMs,
            stepSteps: stepPerf.steps,
            stepSimMsPerStep: stepPerf.steps > 0 ? (stepPerf.stepMs / stepPerf.steps) : null,
            stepHistoryMsPerStep: stepPerf.steps > 0 ? (stepPerf.historyMs / stepPerf.steps) : null,
            stepPerturbMsPerStep: stepPerf.steps > 0 ? (stepPerf.perturbMs / stepPerf.steps) : null,
            stepOtherMsPerStep: stepPerf.steps > 0
              ? (Math.max(0, stepPerf.tickMs - stepPerf.stepMs - stepPerf.historyMs - stepPerf.perturbMs) / stepPerf.steps)
              : null,
          }
        : null),
    });
  }
  if (perfEnabled && ((frameId | 0) % 4 === 0)) {
    try {
      postMessage({ kind: 'latency_probe', sentWallMs: Date.now(), frameId });
    } catch (err) {
      strictCatch(err, 'worker:latency_probe_post');
    }
  }
  try {
    const tPostStart = perfEnabled ? perfNowMs() : 0;
    postMessage(msg, transfers);
    if (perfEnabled) {
      lastSnapshotPostMessageMs = perfNowMs() - tPostStart;
    }
  } catch (err) {
    try {
      postMessage({ kind:'error', message: `snapshot postMessage failed: ${err}` });
    } catch (innerErr) {
      strictCatch(innerErr, 'worker:snapshot_post_error');
    }
    strictCatch(err, 'worker:snapshot_post');
  }
}

function emitRenderAssets() {
  if (!mod || !(h > 0)) return;
  try {
    const tCollectStart = perfEnabled ? perfNowMs() : 0;
    const assets = collectRenderAssetsFromModule(mod, h);
    if (!assets) return;
    renderAssets = assets;
    if (perfEnabled) {
      perfStages.collectRenderAssetsMs = perfNowMs() - tCollectStart;
    }
    const transfers = collectAssetBuffersForTransfer(assets);
    try {
      postMessage({
        kind: 'render_assets',
        assets,
        perf: buildPerf({ collectRenderAssetsMs: perfStages.collectRenderAssetsMs }, { includeStages: true }),
      }, transfers);
    } catch (err) {
      logWarn('worker: render_assets post failed', String(err || ''));
      strictCatch(err, 'worker:render_assets_post');
    }
  } catch (err) {
    logWarn('worker: collectRenderAssets failed', String(err || ''));
    strictCatch(err, 'worker:collect_render_assets');
  }
}

function collectAssetBuffersForTransfer(assets) {
  const buffers = [];
  const seen = new Set();
  const push = (arr) => {
    if (!arr || !arr.buffer || !(arr.buffer instanceof ArrayBuffer)) return;
    if (seen.has(arr.buffer)) return;
    seen.add(arr.buffer);
    buffers.push(arr.buffer);
  };
  if (assets?.geoms) {
    push(assets.geoms.size);
    push(assets.geoms.type);
    push(assets.geoms.matid);
    push(assets.geoms.bodyid);
    push(assets.geoms.group);
    push(assets.geoms.rgba);
  }
  if (assets?.sites) {
    push(assets.sites.size);
    push(assets.sites.type);
    push(assets.sites.matid);
    push(assets.sites.bodyid);
    push(assets.sites.group);
    push(assets.sites.rgba);
  }
  if (assets?.tendons) {
    push(assets.tendons.width);
    push(assets.tendons.matid);
    push(assets.tendons.group);
    push(assets.tendons.rgba);
    push(assets.tendons.num);
    push(assets.tendons.limited);
    push(assets.tendons.stiffness);
    push(assets.tendons.damping);
    push(assets.tendons.frictionloss);
    push(assets.tendons.range);
    push(assets.tendons.lengthspring);
  }
  if (assets?.actuators) {
    push(assets.actuators.trnid);
    push(assets.actuators.trntype);
    push(assets.actuators.cranklength);
  }
  if (assets?.bodies) {
    push(assets.bodies.weldid);
    push(assets.bodies.mocapid);
    push(assets.bodies.parentid);
    push(assets.bodies.jntadr);
    push(assets.bodies.jntnum);
    push(assets.bodies.dofadr);
    push(assets.bodies.dofnum);
    push(assets.bodies.mass);
    push(assets.bodies.inertia);
  }
  if (assets?.lights) {
    push(assets.lights.type);
    push(assets.lights.texid);
    push(assets.lights.active);
    push(assets.lights.castshadow);
    push(assets.lights.bulbradius);
    push(assets.lights.intensity);
    push(assets.lights.range);
    push(assets.lights.attenuation);
    push(assets.lights.cutoff);
    push(assets.lights.exponent);
    push(assets.lights.ambient);
    push(assets.lights.diffuse);
    push(assets.lights.specular);
  }
  if (assets?.sensors) {
    push(assets.sensors.type);
    push(assets.sensors.objid);
    push(assets.sensors.refid);
    push(assets.sensors.dim);
    push(assets.sensors.adr);
  }
  if (assets?.flexes) {
    push(assets.flexes.dim);
    push(assets.flexes.radius);
    push(assets.flexes.matid);
    push(assets.flexes.group);
    push(assets.flexes.rgba);
    push(assets.flexes.flatskin);
    push(assets.flexes.texcoordadr);
    push(assets.flexes.texcoord);
    push(assets.flexes.elemtexcoord);
    push(assets.flexes.vertadr);
    push(assets.flexes.vertnum);
    push(assets.flexes.edgeadr);
    push(assets.flexes.edgenum);
    push(assets.flexes.elemadr);
    push(assets.flexes.elemnum);
    push(assets.flexes.elemdataadr);
    push(assets.flexes.shellnum);
    push(assets.flexes.shelldataadr);
    push(assets.flexes.edge);
    push(assets.flexes.elem);
    push(assets.flexes.elemlayer);
    push(assets.flexes.shell);
  }
  if (assets?.skins) {
    push(assets.skins.matid);
    push(assets.skins.group);
    push(assets.skins.rgba);
    push(assets.skins.inflate);
    push(assets.skins.texcoordadr);
    push(assets.skins.texcoord);
    push(assets.skins.vertadr);
    push(assets.skins.vertnum);
    push(assets.skins.faceadr);
    push(assets.skins.facenum);
    push(assets.skins.boneadr);
    push(assets.skins.bonenum);
    push(assets.skins.vert);
    push(assets.skins.face);
    push(assets.skins.bonevertadr);
    push(assets.skins.bonevertnum);
    push(assets.skins.bonebindpos);
    push(assets.skins.bonebindquat);
    push(assets.skins.bonebodyid);
    push(assets.skins.bonevertid);
    push(assets.skins.bonevertweight);
  }
  if (assets?.materials) {
    push(assets.materials.rgba);
    push(assets.materials.reflectance);
    push(assets.materials.emission);
    push(assets.materials.specular);
    push(assets.materials.shininess);
    push(assets.materials.metallic);
    push(assets.materials.roughness);
    push(assets.materials.texid);
    push(assets.materials.texrepeat);
    push(assets.materials.texuniform);
  }
  if (assets?.meshes) {
    push(assets.meshes.vertadr);
    push(assets.meshes.vertnum);
    push(assets.meshes.faceadr);
    push(assets.meshes.facenum);
    push(assets.meshes.texcoordadr);
    push(assets.meshes.texcoordnum);
    push(assets.meshes.vert);
    push(assets.meshes.face);
    push(assets.meshes.normal);
    push(assets.meshes.texcoord);
    push(assets.meshes.graphadr);
    push(assets.meshes.graph);
    push(assets.meshes.polynum);
    push(assets.meshes.polyadr);
    push(assets.meshes.polynormal);
    push(assets.meshes.polyvertadr);
    push(assets.meshes.polyvertnum);
    push(assets.meshes.polyvert);
  }
  if (assets?.textures) {
    push(assets.textures.type);
    push(assets.textures.width);
    push(assets.textures.height);
    push(assets.textures.nchannel);
    push(assets.textures.adr);
    push(assets.textures.colorspace);
    push(assets.textures.data);
  }
  if (assets?.bvh) {
    push(assets.bvh.aabb);
    push(assets.bvh.child);
    push(assets.bvh.depth);
    push(assets.bvh.nodeid);
    push(assets.bvh.geom_aabb);
    push(assets.bvh.body_bvhadr);
    push(assets.bvh.body_bvhnum);
    push(assets.bvh.flex_bvhadr);
    push(assets.bvh.flex_bvhnum);
    push(assets.bvh.mesh_bvhadr);
    push(assets.bvh.mesh_bvhnum);
    push(assets.bvh.mesh_octadr);
    push(assets.bvh.mesh_octnum);
    push(assets.bvh.oct_depth);
    push(assets.bvh.oct_aabb);
  }
  return buffers;
}

// Physics stepping timer (simulate-style walltime sync)
setInterval(() => {
  if (!mod || !h || !running) return;
  if (!sim || typeof sim.step !== 'function') {
    if (!hasLoggedNoSim) {
      logError('[physics.worker] sim is not available, cannot step simulation');
      hasLoggedNoSim = true;
    }
    return;
  }
  // Flush pending control writes (coalesce burst updates)
  try {
    if (pendingCtrl.size && sim) {
      const ctrlView = sim.ctrlView?.();
      if (ctrlView && ctrlView.length) {
        const rangeView = sim.actuatorCtrlRangeView?.();
        for (const [i, v] of pendingCtrl.entries()) {
          const idx = i | 0;
          if (idx < 0 || idx >= ctrlView.length) continue;
          let vv = +v || 0;
          if (rangeView && (2 * idx + 1) < rangeView.length) {
            const lo = +rangeView[2 * idx];
            const hi = +rangeView[2 * idx + 1];
            if (Number.isFinite(lo) && Number.isFinite(hi) && (hi - lo) > 1e-12) {
              vv = Math.max(Math.min(hi, vv), lo);
            }
          }
          ctrlView[idx] = vv;
        }
        pendingCtrl.clear();
      }
    }
  } catch (err) {
    strictCatch(err, 'worker:pending_ctrl_flush');
  }
  const currentDt = (() => {
    try {
      if (sim && typeof sim.timestep === 'function') {
        const raw = sim.timestep();
        if (Number.isFinite(raw) && raw > 0) return raw;
      }
    } catch (err) {
      strictCatch(err, 'worker:read_timestep');
    }
    return dt;
  })();
  if (Number.isFinite(currentDt) && currentDt > 0) {
    dt = currentDt;
  }

  const tickStartMs = perfNowMs();
  const tickStartSec = tickStartMs / 1000;

  const rateRaw = Number(rate);
  const rateSafe = (Number.isFinite(rateRaw) && rateRaw > 0) ? rateRaw : 1.0;
  const slowdown = 1 / rateSafe;

  let tSimStart = simTimeApprox;
  try {
    if (sim && typeof sim.time === 'function') {
      tSimStart = sim.time() || 0;
    }
  } catch (err) {
    strictCatch(err, 'worker:sync_timer_time');
    tSimStart = simTimeApprox || 0;
  }

  const elapsedCpuSec = tickStartSec - lastSyncWallTime;
  const elapsedSimSec = tSimStart - lastSyncSimTime;
  const misaligned =
    Number.isFinite(elapsedCpuSec)
    && Number.isFinite(elapsedSimSec)
    && Math.abs(elapsedCpuSec * rateSafe - elapsedSimSec) > SYNC_MISALIGN_SIM_SEC;

  const needsResync =
    timingNeedsResync
    || !(Number.isFinite(lastSyncWallTime) && lastSyncWallTime > 0)
    || !(Number.isFinite(lastSyncSimTime) && lastSyncSimTime >= 0)
    || !(Number.isFinite(elapsedCpuSec) && elapsedCpuSec >= 0)
    || !(Number.isFinite(elapsedSimSec) && elapsedSimSec >= 0)
    || misaligned;

  const maxStepsPerTick = 240;
  let stepsDone = 0;
  let stepTickHistoryMs = 0;
  let stepTickPerturbMs = 0;
  let stepTickStepMs = 0;
  let tSimNow = tSimStart;

  if (needsResync) {
    lastSyncWallTime = tickStartSec;
    lastSyncSimTime = tSimStart;
    timingNeedsResync = false;
    try {
      if (perfEnabled) {
        const tHist = perfNowMs();
        captureHistorySample();
        stepTickHistoryMs += perfNowMs() - tHist;
      } else {
        captureHistorySample();
      }
      applyCtrlNoise();
      if (mjvPerturbActive) {
        if (perfEnabled) {
          const tPert = perfNowMs();
          applySimulatePerturbPipeline({ paused: false });
          stepTickPerturbMs += perfNowMs() - tPert;
        } else {
          applySimulatePerturbPipeline({ paused: false });
        }
      }
      if (perfEnabled) {
        const tStep = perfNowMs();
        sim.step(1);
        stepTickStepMs += perfNowMs() - tStep;
      } else {
        sim.step(1);
      }
      stepsDone = 1;
      try {
        if (sim && typeof sim.time === 'function') {
          tSimNow = sim.time() || tSimNow;
        }
      } catch (err) {
        strictCatch(err, 'worker:sync_timer_time');
      }
    } catch (err) {
      strictCatch(err, 'worker:step_loop');
      timingNeedsResync = true;
    }
  } else {
    const deadlineMs = tickStartMs + STEP_TICK_BUDGET_MS;
    let measured = false;
    const slowdownSample = (() => {
      if (!(elapsedCpuSec > 0) || !(elapsedSimSec > 0)) return null;
      const value = elapsedCpuSec / elapsedSimSec;
      return Number.isFinite(value) && value > 0 ? value : null;
    })();
    while (stepsDone < maxStepsPerTick && perfNowMs() < deadlineMs) {
      const nowSec = perfNowMs() / 1000;
      const cpuElapsed = nowSec - lastSyncWallTime;
      const simElapsed = tSimNow - lastSyncSimTime;
      if (!(Number.isFinite(cpuElapsed) && cpuElapsed >= 0) || !(Number.isFinite(simElapsed) && simElapsed >= 0)) {
        timingNeedsResync = true;
        break;
      }
      if ((simElapsed * slowdown) >= cpuElapsed) {
        break;
      }
      if (!measured && slowdownSample != null) {
        measuredSlowdown = slowdownSample;
        measured = true;
      }
      const prevSim = tSimNow;
      try {
        if (perfEnabled) {
          const tHist = perfNowMs();
          captureHistorySample();
          stepTickHistoryMs += perfNowMs() - tHist;
        } else {
          captureHistorySample();
        }
        applyCtrlNoise();
        if (mjvPerturbActive) {
          if (perfEnabled) {
            const tPert = perfNowMs();
            applySimulatePerturbPipeline({ paused: false });
            stepTickPerturbMs += perfNowMs() - tPert;
          } else {
            applySimulatePerturbPipeline({ paused: false });
          }
        }
        if (perfEnabled) {
          const tStep = perfNowMs();
          sim.step(1);
          stepTickStepMs += perfNowMs() - tStep;
        } else {
          sim.step(1);
        }
      } catch (err) {
        strictCatch(err, 'worker:step_loop');
        timingNeedsResync = true;
        break;
      }
      stepsDone += 1;
      try {
        if (sim && typeof sim.time === 'function') {
          tSimNow = sim.time() || tSimNow;
        }
      } catch (err) {
        strictCatch(err, 'worker:sync_timer_time');
      }
      if (tSimNow + 1e-12 < prevSim) {
        timingNeedsResync = true;
        break;
      }
    }
  }

  if (stepsDone > 0) {
    simTimeApprox = tSimNow;
  }
  if (perfEnabled && stepsDone > 0) {
    lastStepPerf = {
      tickMs: perfNowMs() - tickStartMs,
      steps: stepsDone,
      stepMs: stepTickStepMs,
      historyMs: stepTickHistoryMs,
      perturbMs: stepTickPerturbMs,
    };
  }
}, 8);

// Snapshot timer (adaptive 120/60/30Hz via setSnapshotHz)
setInterval(() => {
  if (!sim || !h) return;
  const intervalMs = (Number.isFinite(snapshotIntervalMs) && snapshotIntervalMs > 0)
    ? snapshotIntervalMs
    : 16;
  const now = (typeof performance !== 'undefined' && typeof performance.now === 'function')
    ? performance.now()
    : Date.now();
  if (!(snapshotLastTickMs > 0)) {
    snapshotLastTickMs = now;
    return;
  }
  let tickDt = now - snapshotLastTickMs;
  snapshotLastTickMs = now;
  if (!(tickDt > 0)) return;
  // Clamp to avoid huge bursts after tab suspension; keep best-effort (max 1 snapshot per tick).
  const tickClampMs = MAX_WALL_DELTA * 1000;
  if (tickDt > tickClampMs) tickDt = tickClampMs;
  snapshotAccumulatorMs += tickDt;
  if (snapshotAccumulatorMs < intervalMs) return;
  snapshotAccumulatorMs -= intervalMs;
  if (snapshotAccumulatorMs > intervalMs) snapshotAccumulatorMs = intervalMs;
  if (!running && mjvPerturbActive) {
    applySimulatePerturbPipeline({ paused: true });
  }
  snapshot();
}, 8);

const commandHandlers = {
  strictReport: (payload) => {
    postMessage({ kind: 'strict_report', id: payload.id || 0, report: getStrictReport() });
  },
  load: async (payload) => {
    // Stop stepping during reload and clear handle so timers are gated.
    try {
      setRunning(false, 'load', false);
    } catch (err) {
      strictCatch(err, 'worker:setRunning_load');
    }
    if (sim) {
      try { sim.term(); } catch (err) { strictCatch(err, 'worker:sim_term'); }
    }
    if (mod && h && typeof mod._mjwf_helper_free === 'function') {
      try { mod._mjwf_helper_free(h); } catch (err) { strictCatch(err, 'worker:helper_free'); }
    }
    h = 0;
    lastCpuTimerSnapshot = null;
    const initOptions = (() => {
      const opts = {};
      if (typeof payload?.xmlPath === 'string' && payload.xmlPath.trim().length) {
        opts.xmlPath = payload.xmlPath;
      }
      if (Array.isArray(payload?.files) && payload.files.length) {
        opts.files = payload.files;
      }
      return Object.keys(opts).length ? opts : null;
    })();
    const result = await loadXmlWithFallback(payload.xmlText || '', initOptions);
    if (!result || !result.ok || !(result.handle > 0)) {
      const errMeta = {
        errno: result?.errno ?? 0,
        errmsg: result?.errmsg || '',
        helperErrno: result?.helperErrno ?? 0,
        helperErrmsg: result?.helperErrmsg || '',
      };
      const messageParts = [];
      if (errMeta.errmsg) messageParts.push(errMeta.errmsg);
      if (errMeta.helperErrmsg && errMeta.helperErrmsg !== errMeta.errmsg) {
        messageParts.push(`helper: ${errMeta.helperErrmsg}`);
      }
      const summary = messageParts.length ? messageParts.join(' | ') : 'Unable to create handle';
      try {
        postMessage({
          kind: 'error',
          message: `XML load failed: ${summary}`,
          errno: errMeta.errno,
          errmsg: errMeta.errmsg,
          helperErrno: errMeta.helperErrno,
          helperErrmsg: errMeta.helperErrmsg,
        });
      } catch (err) {
        strictCatch(err, 'worker:load_error_post');
      }
      return;
    }
    const { abi, handle } = result;
    h = handle | 0;
    lastCpuTimerSnapshot = null;
    frameSeq = 0;
    optionSupport = detectOptionSupport(mod);
    dt = sim?.timestep?.() || 0.002;
    if (Number.isFinite(dt) && dt > 0) {
      const targetHz = clamp(Math.round(1 / dt), 5, HISTORY_MAX_CAPTURE_HZ);
      historyConfig = { ...historyConfig, captureHz: targetHz };
    }
    ngeom = sim?.ngeom?.() | 0;
    nu = sim?.nu?.() | 0;
    pendingCtrl.clear();
    initHistoryBuffers();
    resetKeyframes();
    resetWatchState();
    keySliderIndex = -1;
    captureHistorySample(true);
    emitHistoryMeta();
    emitKeyframeMeta();
    emitWatchState();
    // Fresh sync of stepping timeline and rate for new model.
    resetTimingForCurrentSim(typeof payload.rate === 'number' ? payload.rate : 1.0);
    setRunning(true, 'load');
    gestureState = { mode: 'idle', phase: 'idle', pointer: null };
    dragState = { dx: 0, dy: 0 };
    voptFlags = DEFAULT_VOPT_FLAGS_NUMERIC.slice();
    sceneFlags = SCENE_FLAG_DEFAULTS_NUMERIC.slice();
    groupState = createGroupState();
    labelMode = 0;
    frameMode = 0;
    cameraMode = 0;
    flexLayer = 0;
    bvhDepth = 1;
    const visualState = readStructState('mjVisual');
    const statisticState = readStructState('mjStatistic');
    postMessage({
      kind: 'ready',
      abi,
      dt,
      ngeom,
      perf: buildPerf({ abi }, { includeStages: true }),
      optionSupport: (typeof optionSupport === 'object' && optionSupport) ? optionSupport : { supported: false, pointers: [] },
      visual: visualState || null,
      statistic: statisticState || null,
    });
    emitOptionState();
    // Send joint/geom mapping meta for picking->joint association (optional)
    try {
      const geomBody = sim?.geomBodyIdView?.();
        const bodyAdr = sim?.bodyJntAdrView?.();
        const bodyNum = sim?.bodyJntNumView?.();
        const bodyParent = sim?.bodyParentIdView?.();
        const jtypeView = sim?.jntTypeView?.();
        const jqposAdr = sim?.jntQposAdrView?.();
        const jrangeView = sim?.jntRangeView?.();
        const nbody = sim?.nbody?.() | 0;
        const nj = sim?.njnt?.() | 0;
        const geom_bodyid = geomBody ? new Int32Array(geomBody) : null;
        const body_jntadr = bodyAdr ? new Int32Array(bodyAdr) : null;
        const body_jntnum = bodyNum ? new Int32Array(bodyNum) : null;
        const body_parentid = bodyParent ? new Int32Array(bodyParent) : null;
        const jtype = jtypeView ? new Int32Array(jtypeView) : null;
        const jnt_qposadr = jqposAdr ? new Int32Array(jqposAdr) : null;
        const jnt_range = jrangeView ? new Float64Array(jrangeView) : null;
        const jnt_names = (() => {
          if (!(nj > 0) || typeof sim?.jntNameOf !== 'function') return null;
          const names = [];
          for (let i = 0; i < nj; i += 1) {
            try { names.push(sim.jntNameOf(i) || `jnt ${i}`); } catch (err) { strictCatch(err, 'worker:jntNameOf'); names.push(`jnt ${i}`); }
          }
          return names;
        })();
        const transfers = [
          geom_bodyid?.buffer,
          body_jntadr?.buffer,
          body_jntnum?.buffer,
          body_parentid?.buffer,
          jtype?.buffer,
          jnt_qposadr?.buffer,
          jnt_range?.buffer,
        ].filter(Boolean);
        postMessage({
          kind:'meta_joints',
          ngeom,
          nbody,
          njnt: nj,
          geom_bodyid,
          body_jntadr,
          body_jntnum,
          body_parentid,
          jtype,
          jnt_qposadr,
          jnt_range,
          jnt_names,
        }, transfers);
    } catch (err) {
      strictCatch(err, 'worker:meta_joints');
    }
    // Send meta for control panel (always). If nu==0, send empty to clear UI.
    try {
      const acts = [];
      const rangeView = sim?.actuatorCtrlRangeView?.();
      if (nu > 0) {
        for (let i = 0; i < nu; i += 1) {
          const name = sim?.actuatorNameOf?.(i) || `act ${i}`;
          const rawLo = rangeView ? +rangeView[2 * i] : NaN;
          const rawHi = rangeView ? +rangeView[2 * i + 1] : NaN;
          const valid = Number.isFinite(rawLo) && Number.isFinite(rawHi) && (rawHi - rawLo) > 1e-12;
          const lo = valid ? rawLo : -1;
          const hi = valid ? rawHi : 1;
          acts.push({ index:i, name, min: lo, max: hi, step: 0.001, value: 0 });
        }
      }
      postMessage({ kind:'meta', actuators: acts });
    } catch (err) {
      strictCatch(err, 'worker:meta_actuators');
    }
    emitCameraMeta();
    emitGeomMeta();
    snapshot();
    emitRenderAssets();
  },
  reset: () => {
    if (sim && typeof sim.reset === 'function') {
      sim.reset();
      initHistoryBuffers();
      captureHistorySample(true);
      emitHistoryMeta();
      snapshot();
      resetTimingForCurrentSim(rate);
    }
  },
  step: (payload) => {
    if (sim) {
      const n = Math.max(1, Math.min(10000, (payload.n | 0) || 1));
      let steps = 0;
      while (steps < n) {
        try { captureHistorySample(true); } catch (err) { strictCatch(err, 'worker:step_history'); }
        try {
          applySimulatePerturbPipeline({ paused: true });
          sim.step(1);
        } catch (err) {
          strictCatch(err, 'worker:step_sim');
          break;
        }
        steps += 1;
      }
      try {
        const tSim = (sim && typeof sim.time === 'function') ? (sim.time() || 0) : simTimeApprox;
        simTimeApprox = tSim;
      } catch (err) {
        strictCatch(err, 'worker:step_time');
      }
      snapshot();
    }
  },
  gesture: (payload) => {
    const sourceGesture = payload.gesture || {};
    const mode = typeof payload.mode === 'string' ? payload.mode : sourceGesture.mode;
    const phase = typeof payload.phase === 'string' ? payload.phase : sourceGesture.phase;
    const gestureType = typeof payload.gestureType === 'string' ? payload.gestureType : null;
    const pointerSource = payload.pointer ?? sourceGesture.pointer ?? null;
    const pointer = pointerSource
      ? {
          x: Number(pointerSource.x) || 0,
          y: Number(pointerSource.y) || 0,
          dx: Number(pointerSource.dx) || 0,
          dy: Number(pointerSource.dy) || 0,
          buttons: Number(pointerSource.buttons ?? 0),
          pressure: Number(pointerSource.pressure ?? 0),
        }
      : null;
    const dragSource = payload.drag ?? (pointer ? { dx: pointer.dx, dy: pointer.dy } : null);
    gestureState = {
      mode: phase === 'end' ? 'idle' : (mode ?? gestureState.mode ?? 'idle'),
      phase: phase ?? gestureState.phase ?? 'update',
      pointer,
    };
    if (dragSource) {
      dragState = {
        dx: Number(dragSource.dx) || 0,
        dy: Number(dragSource.dy) || 0,
      };
    } else if (gestureState.phase === 'end') {
      dragState = { dx: 0, dy: 0 };
    }
    if (gestureType === 'camera' && sim && mod && (h > 0)) {
      const reldx = Number(payload.reldx);
      const reldy = Number(payload.reldy);
      const shiftKey = !!payload.shiftKey;
      const camPayload = payload.cam || null;
      const cameraModeIndex = Number(cameraMode) | 0;
      const canApply = cameraModeIndex <= 1;
      if (canApply) {
        if (camPayload) {
          writeViewerCameraFromPayload(camPayload);
        }
        if (phase === 'sync') {
          const fns = ensureMjvCameraAbi();
          const { modelPtr, dataPtr } = sim.ensurePointers();
          const scnPtr = sim.scenePtr() | 0;
          const camPtr = mod._mjwf_cam_type_ptr(h) | 0;
          if ((modelPtr > 0) && (dataPtr > 0) && (scnPtr > 0) && (camPtr > 0)) {
            fns.updateCamera.call(mod, modelPtr | 0, dataPtr | 0, camPtr | 0, scnPtr | 0);
          }
        } else if (phase !== 'end' && Number.isFinite(reldx) && Number.isFinite(reldy)) {
          const effectiveMode = mode === 'translate' ? 'translate' : (mode === 'zoom' ? 'zoom' : 'rotate');
          const action =
            effectiveMode === 'zoom'
              ? MJ_MOUSE.ZOOM
              : mjvMouseActionFor(effectiveMode, shiftKey);
          if (action != null) {
            const fns = ensureMjvCameraAbi();
            const { modelPtr, dataPtr } = sim.ensurePointers();
            const scnPtr = sim.scenePtr() | 0;
            const camPtr = mod._mjwf_cam_type_ptr(h) | 0;
            if ((modelPtr > 0) && (dataPtr > 0) && (scnPtr > 0) && (camPtr > 0)) {
              fns.updateCamera.call(mod, modelPtr | 0, dataPtr | 0, camPtr | 0, scnPtr | 0);
              fns.moveCamera.call(mod, modelPtr | 0, action | 0, reldx, reldy, scnPtr | 0, camPtr | 0);
              fns.updateCamera.call(mod, modelPtr | 0, dataPtr | 0, camPtr | 0, scnPtr | 0);
            }
          }
        }
      }
    }
    try { postMessage({ kind: 'gesture', gesture: gestureState, drag: dragState }); } catch (err) { strictCatch(err, 'worker:gesture_post'); }
  },
  setVoptFlag: (payload) => {
    const idx = Number(payload.index) | 0;
    const enabled = !!payload.enabled;
    if (!Array.isArray(voptFlags)) voptFlags = DEFAULT_VOPT_FLAGS_NUMERIC.slice();
    if (idx >= 0 && idx < voptFlags.length) {
      voptFlags[idx] = enabled ? 1 : 0;
      emitOptionState();
    }
  },
  setSceneFlag: (payload) => {
    const idx = Number(payload.index) | 0;
    const enabled = !!payload.enabled;
    if (!Array.isArray(sceneFlags) || sceneFlags.length !== SCENE_FLAG_DEFAULTS_NUMERIC.length) {
      sceneFlags = SCENE_FLAG_DEFAULTS_NUMERIC.slice();
    }
    if (idx >= 0 && idx < sceneFlags.length) {
      sceneFlags[idx] = enabled ? 1 : 0;
      emitOptionState();
    }
  },
  setLabelMode: (payload) => {
    const modeVal = Number(payload.mode) || 0;
    labelMode = modeVal | 0;
    emitOptionState();
  },
  setFrameMode: (payload) => {
    const modeVal = Number(payload.mode) || 0;
    frameMode = modeVal | 0;
    emitOptionState();
  },
  setCameraMode: (payload) => {
    const modeVal = Number(payload.mode) || 0;
    cameraMode = modeVal | 0;
    emitOptionState();
  },
  setGroupState: (payload) => {
    const type = typeof payload.group === 'string' ? payload.group.toLowerCase() : '';
    const idx = Number(payload.index) | 0;
    const enabled = !!payload.enabled;
    if (MJ_GROUP_TYPES.includes(type) && idx >= 0 && idx < MJ_GROUP_COUNT) {
      if (!groupState[type]) {
        groupState[type] = Array.from({ length: MJ_GROUP_COUNT }, () => 1);
      }
      groupState[type][idx] = enabled ? 1 : 0;
      emitOptionState();
    }
  },
  historyScrub: (payload) => {
    const offset = Number(payload.offset) || 0;
    if (offset < 0) {
      loadHistoryOffset(offset);
    } else {
      releaseHistoryScrub();
    }
    emitHistoryMeta();
  },
  historyConfig: (payload) => {
    applyHistoryConfig({ captureHz: payload.captureHz, capacity: payload.capacity });
  },
  keyframeSave: (payload) => {
    const used = saveKeyframe(Number(payload.index));
    if (used >= 0) {
      keySliderIndex = used;
    }
  },
  keyframeLoad: (payload) => {
    const idx = Math.max(0, normaliseInt(payload.index, 0));
    if (loadKeyframe(idx)) {
      keySliderIndex = idx;
      resetTimingForCurrentSim();
    }
  },
  keyframeSelect: (payload) => {
    const idx = Math.max(0, normaliseInt(payload.index, 0));
    if (keyframeState?.slots?.length) {
      keySliderIndex = Math.min(idx, keyframeState.slots.length - 1);
    } else {
      keySliderIndex = idx;
    }
    emitKeyframeMeta();
  },
  setWatch: (payload) => {
    const field = typeof payload.field === 'string' ? payload.field : watchState?.field;
    updateWatchTarget(field, payload.index);
    emitWatchState();
  },
  setVisualOption: (payload) => {
    const field = typeof payload.field === 'string' ? payload.field : '';
    const rawValue = Number(payload.value);
    if (!Number.isFinite(rawValue)) {
      return;
    }
    const normalized = Math.max(0, Math.trunc(rawValue));
    if (field === 'flex_layer') {
      flexLayer = normalized;
      emitOptionState();
    } else if (field === 'bvh_depth') {
      bvhDepth = normalized;
      emitOptionState();
    }
  },
  setField: (payload) => {
    const target = payload.target;
    if (target === 'mjOption') {
      try {
        const pathArr = Array.isArray(payload.path) ? payload.path : [];
        const ok = writeOptionField(mod, h, pathArr, payload.kind, payload.value);
        if (ok) {
          if (Array.isArray(pathArr) && pathArr.length === 1 && pathArr[0] === 'timestep') {
            try {
              const rawDt = sim?.timestep?.() || dt;
              if (Number.isFinite(rawDt) && rawDt > 0) {
                dt = rawDt;
                const targetHz = clamp(Math.round(1 / dt), 5, 240);
                historyConfig = { ...historyConfig, captureHz: targetHz };
                resetTimingForCurrentSim(rate);
              }
            } catch (err) {
              strictCatch(err, 'worker:setField_timestep');
            }
          }
          snapshot();
        }
      } catch (err) {
        logWarn('worker: setField (mjOption) failed', String(err || ''));
        strictCatch(err, 'worker:setField_mjOption');
      }
    } else if (target === 'mjVisual') {
      try {
        const ok = writeVisualField(mod, h, Array.isArray(payload.path) ? payload.path : [], payload.kind, payload.value, payload.size);
        if (ok) {
          emitStructState('mjVisual');
        }
      } catch (err) {
        logWarn('worker: setField (mjVisual) failed', String(err || ''));
        strictCatch(err, 'worker:setField_mjVisual');
      }
    } else if (target === 'mjStatistic') {
      try {
        const ok = writeStatisticField(mod, h, Array.isArray(payload.path) ? payload.path : [], payload.kind, payload.value, payload.size);
        if (ok) {
          emitStructState('mjStatistic');
        }
      } catch (err) {
        logWarn('worker: setField (mjStatistic) failed', String(err || ''));
        strictCatch(err, 'worker:setField_mjStatistic');
      }
    }
  },
  applyPerturb: (payload) => {
    if (!sim || !mod || !(h > 0)) return;
    const phase = typeof payload.phase === 'string' ? payload.phase : '';
    if (phase === 'begin') {
      ensureMjvPerturbAbi();
      const selectView = sim.pertSelectPtrView?.();
      const localposView = sim.pertLocalposPtrView?.();
      const activeView = sim.pertActivePtrView?.();
      const active2View = sim.pertActive2PtrView?.();
      const scaleView = sim.pertScalePtrView?.();
      if (!selectView || !localposView || !activeView || !active2View || !scaleView) {
        throw new Error('[worker] applyPerturb(begin) missing pert field views');
      }
      const bodyId = selectView.length ? (selectView[0] | 0) : 0;
      if (!(bodyId > 0)) return;

      const { modelPtr, dataPtr } = sim.ensurePointers();
      const camPtr = mod._mjwf_cam_type_ptr(h) | 0;
      const scnPtr = sim.scenePtr() | 0;
      const pertPtr = sim.pertPtr() | 0;
      if (!(camPtr > 0) || !(scnPtr > 0) || !(pertPtr > 0)) {
        throw new Error('[worker] applyPerturb(begin) missing cam/scn/pert pointers');
      }
      mjvPerturbPtrs = { modelPtr: modelPtr | 0, dataPtr: dataPtr | 0, camPtr, scnPtr, pertPtr };

      writeViewerCameraFromPayload(payload.cam || null);
      mjvPerturbFns = ensureMjvPerturbAbi();
      mjvPerturbFns.updateCamera.call(mod, modelPtr | 0, dataPtr | 0, camPtr | 0, scnPtr | 0);

      const nextActive = (payload.mode === 'rotate' ? MJ_PERT.ROTATE : MJ_PERT.TRANSLATE) | 0;
      const prevActive = activeView[0] | 0;
      // Simulate: perturbation onset resets reference.
      if (nextActive && !prevActive) {
        mjvPerturbFns.initPerturb.call(mod, modelPtr | 0, dataPtr | 0, scnPtr | 0, pertPtr | 0);
      }
      activeView[0] = nextActive;
      active2View[0] = 0;
      const scale = Number(payload.scale);
      if (Number.isFinite(scale) && scale > 0) {
        scaleView[0] = scale;
      }
      mjvPerturbActive = true;
      mjvPerturbBodyId = bodyId | 0;
    } else if (phase === 'move') {
      if (!mjvPerturbActive) return;
      ensureMjvPerturbAbi();
      const mode = payload.mode === 'rotate' ? 'rotate' : 'translate';
      const action = mjvMouseActionFor(mode, !!payload.shiftKey);
      const reldx = Number(payload.reldx) || 0;
      const reldy = Number(payload.reldy) || 0;
      writeViewerCameraFromPayload(payload.cam || null);
      mjvPerturbFns = ensureMjvPerturbAbi();
      mjvPerturbFns.updateCamera.call(mod, mjvPerturbPtrs.modelPtr | 0, mjvPerturbPtrs.dataPtr | 0, mjvPerturbPtrs.camPtr | 0, mjvPerturbPtrs.scnPtr | 0);
      const activeView = sim.pertActivePtrView?.();
      const active2View = sim.pertActive2PtrView?.();
      if (activeView && activeView.length) activeView[0] = (mode === 'rotate' ? MJ_PERT.ROTATE : MJ_PERT.TRANSLATE) | 0;
      if (active2View && active2View.length) active2View[0] = 0;
      mjvPerturbFns.movePerturb.call(mod, mjvPerturbPtrs.modelPtr | 0, mjvPerturbPtrs.dataPtr | 0, action | 0, reldx, reldy, mjvPerturbPtrs.scnPtr | 0, mjvPerturbPtrs.pertPtr | 0);
    } else if (phase === 'end') {
      if (!mjvPerturbActive) return;
      const activeView = sim.pertActivePtrView?.();
      const active2View = sim.pertActive2PtrView?.();
      if (activeView && activeView.length) activeView[0] = 0;
      if (active2View && active2View.length) active2View[0] = 0;
      clearPerturbXfrcIfNeeded();
      mjvPerturbActive = false;
      mjvPerturbBodyId = -1;
      mjvPerturbPtrs = { modelPtr: 0, dataPtr: 0, camPtr: 0, scnPtr: 0, pertPtr: 0 };
    } else {
      throw new Error(`[worker] applyPerturb requires phase=begin|move|end (got ${String(phase || payload.phase)})`);
    }
  },
  setSelection: (payload) => {
    if (!sim || !mod || !(h > 0)) return;

    if (mjvPerturbActive) {
      const activeView = sim.pertActivePtrView?.();
      const active2View = sim.pertActive2PtrView?.();
      if (activeView && activeView.length) activeView[0] = 0;
      if (active2View && active2View.length) active2View[0] = 0;
      clearPerturbXfrcIfNeeded();
      mjvPerturbActive = false;
      mjvPerturbBodyId = -1;
      mjvPerturbPtrs = { modelPtr: 0, dataPtr: 0, camPtr: 0, scnPtr: 0, pertPtr: 0 };
    }

    const bodyId = Number(payload.bodyId) | 0;
    const selectView = sim.pertSelectPtrView?.();
    const localposView = sim.pertLocalposPtrView?.();
    const activeView = sim.pertActivePtrView?.();
    const active2View = sim.pertActive2PtrView?.();
    const flexView = sim.pertFlexselectPtrView?.();
    const skinView = sim.pertSkinselectPtrView?.();
    if (!selectView || !localposView) {
      throw new Error('[worker] setSelection missing pert field views');
    }
    if (activeView && activeView.length) activeView[0] = 0;
    if (active2View && active2View.length) active2View[0] = 0;
    if (flexView && flexView.length) flexView[0] = -1;
    if (skinView && skinView.length) skinView[0] = -1;

    if (bodyId > 0) {
      selectView[0] = bodyId | 0;
      const localpos = Array.isArray(payload.localpos) ? payload.localpos : null;
      if (localpos && localpos.length >= 3) {
        localposView[0] = Number(localpos[0]) || 0;
        localposView[1] = Number(localpos[1]) || 0;
        localposView[2] = Number(localpos[2]) || 0;
      } else {
        localposView[0] = 0;
        localposView[1] = 0;
        localposView[2] = 0;
      }
    } else {
      selectView[0] = 0;
      localposView[0] = 0;
      localposView[1] = 0;
      localposView[2] = 0;
    }

    snapshot();
  },
  selectAt: (payload) => {
    if (!sim || !mod || !(h > 0)) return;
    if (typeof mod._mjwf_mjv_select !== 'function') {
      throw new Error('[forge] Missing mjv select ABI export: _mjwf_mjv_select');
    }

    // Simulate: stop perturbation on selection.
    if (mjvPerturbActive) {
      const activeView = sim.pertActivePtrView?.();
      const active2View = sim.pertActive2PtrView?.();
      if (activeView && activeView.length) activeView[0] = 0;
      if (active2View && active2View.length) active2View[0] = 0;
      clearPerturbXfrcIfNeeded();
      mjvPerturbActive = false;
      mjvPerturbBodyId = -1;
      mjvPerturbPtrs = { modelPtr: 0, dataPtr: 0, camPtr: 0, scnPtr: 0, pertPtr: 0 };
    }

    const relxRaw = Number(payload.relx);
    const relyRaw = Number(payload.rely);
    const aspectRaw = Number(payload.aspect);
    const relx = Number.isFinite(relxRaw) ? Math.max(0, Math.min(1, relxRaw)) : 0;
    const rely = Number.isFinite(relyRaw) ? Math.max(0, Math.min(1, relyRaw)) : 0;
    const aspect = Number.isFinite(aspectRaw) && aspectRaw > 0 ? aspectRaw : 1;

    syncVoptToWasm();
    try {
      sim.sceneUpdateAndPack?.(7); // mjCAT_ALL
    } catch (err) {
      strictCatch(err, 'worker:selectAt_scene_update');
    }

    const { modelPtr, dataPtr } = sim.ensurePointers();
    const voptPtr = mod._mjwf_vopt_label_ptr(h) | 0;
    const scnPtr = sim.scenePtr() | 0;
    if (!(voptPtr > 0) || !(scnPtr > 0)) {
      throw new Error('[worker] selectAt missing vopt/scn pointers');
    }

    let selbody = -1;
    let geomId = -1;
    let flexId = -1;
    let skinId = -1;
    let selpnt = [0, 0, 0];

    const sp = mod.stackSave();
    try {
      const selpntPtr = mod.stackAlloc(3 * 8);
      const geomPtr = mod.stackAlloc(4);
      const flexPtr = mod.stackAlloc(4);
      const skinPtr = mod.stackAlloc(4);
      const selpntView = heapViewF64(mod, selpntPtr, 3);
      const geomView = heapViewI32(mod, geomPtr, 1);
      const flexView = heapViewI32(mod, flexPtr, 1);
      const skinView = heapViewI32(mod, skinPtr, 1);
      selpntView[0] = 0;
      selpntView[1] = 0;
      selpntView[2] = 0;
      geomView[0] = -1;
      flexView[0] = -1;
      skinView[0] = -1;

      selbody = mod._mjwf_mjv_select(
        modelPtr | 0,
        dataPtr | 0,
        voptPtr | 0,
        aspect,
        relx,
        rely,
        scnPtr | 0,
        selpntPtr | 0,
        geomPtr | 0,
        flexPtr | 0,
        skinPtr | 0,
      ) | 0;

      geomId = geomView[0] | 0;
      flexId = flexView[0] | 0;
      skinId = skinView[0] | 0;
      selpnt = [Number(selpntView[0]) || 0, Number(selpntView[1]) || 0, Number(selpntView[2]) || 0];
    } finally {
      mod.stackRestore(sp);
    }

    const selectView = sim.pertSelectPtrView?.();
    const localposView = sim.pertLocalposPtrView?.();
    const activeView = sim.pertActivePtrView?.();
    const active2View = sim.pertActive2PtrView?.();
    const flexSelView = sim.pertFlexselectPtrView?.();
    const skinSelView = sim.pertSkinselectPtrView?.();
    if (!selectView || !localposView) {
      throw new Error('[worker] selectAt missing pert field views');
    }
    if (activeView && activeView.length) activeView[0] = 0;
    if (active2View && active2View.length) active2View[0] = 0;

    let selectedBody = 0;
    let localpos = [0, 0, 0];
    if (selbody > 0) {
      selectedBody = selbody | 0;
      selectView[0] = selectedBody;
      if (flexSelView && flexSelView.length) flexSelView[0] = flexId | 0;
      if (skinSelView && skinSelView.length) skinSelView[0] = skinId | 0;

      const bodyXposView = sim.bodyXposView?.();
      const bodyXmatView = sim.bodyXmatView?.();
      if (!bodyXposView || !bodyXmatView) {
        throw new Error('[worker] selectAt missing body transform views');
      }
      const bpos = 3 * selectedBody;
      const bmat = 9 * selectedBody;
      const tmp0 = selpnt[0] - (Number(bodyXposView[bpos + 0]) || 0);
      const tmp1 = selpnt[1] - (Number(bodyXposView[bpos + 1]) || 0);
      const tmp2 = selpnt[2] - (Number(bodyXposView[bpos + 2]) || 0);
      const m0 = Number(bodyXmatView[bmat + 0]) || 0;
      const m1 = Number(bodyXmatView[bmat + 1]) || 0;
      const m2 = Number(bodyXmatView[bmat + 2]) || 0;
      const m3 = Number(bodyXmatView[bmat + 3]) || 0;
      const m4 = Number(bodyXmatView[bmat + 4]) || 0;
      const m5 = Number(bodyXmatView[bmat + 5]) || 0;
      const m6 = Number(bodyXmatView[bmat + 6]) || 0;
      const m7 = Number(bodyXmatView[bmat + 7]) || 0;
      const m8 = Number(bodyXmatView[bmat + 8]) || 0;
      localpos = [
        m0 * tmp0 + m3 * tmp1 + m6 * tmp2,
        m1 * tmp0 + m4 * tmp1 + m7 * tmp2,
        m2 * tmp0 + m5 * tmp1 + m8 * tmp2,
      ];
      localposView[0] = localpos[0];
      localposView[1] = localpos[1];
      localposView[2] = localpos[2];
    } else {
      // Simulate: treat world/empty as "no selection".
      selectView[0] = 0;
      if (flexSelView && flexSelView.length) flexSelView[0] = -1;
      if (skinSelView && skinSelView.length) skinSelView[0] = -1;
      localposView[0] = 0;
      localposView[1] = 0;
      localposView[2] = 0;
      geomId = -1;
      flexId = -1;
      skinId = -1;
      selpnt = [0, 0, 0];
      localpos = [0, 0, 0];
    }

    try {
      postMessage({
        kind: 'selection',
        seq: ++selectionSeq,
        bodyId: selectedBody,
        geomId: geomId | 0,
        flexId: flexId | 0,
        skinId: skinId | 0,
        point: selpnt,
        localpos,
        timestamp: Date.now(),
      });
    } catch (err) {
      strictCatch(err, 'worker:selection_post');
    }

    snapshot();
  },
  align: (payload) => {
    const info = captureBounds();
    if (info) lastBounds = info;
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    try {
      postMessage({
        kind: 'align',
        seq: ++alignSeq,
        center: (info && info.center) || [0, 0, 0],
        radius: (info && info.radius) || 0,
        timestamp: now,
        source: payload.source || 'backend',
      });
    } catch (err) {
      strictCatch(err, 'worker:align_post');
    }
  },
  copyState: (payload) => {
    const precision = payload.precision === 'full' ? 'full' : 'standard';
    const nextPayload = captureCopyState(precision);
    nextPayload.source = payload.source || 'backend';
    try { postMessage(nextPayload); } catch (err) { strictCatch(err, 'worker:copy_state_post'); }
  },
  setCtrlNoise: (payload) => {
    ctrlNoiseStd = +payload.std || 0;
    ctrlNoiseRate = +payload.rate || 0;
  },
  setCtrl: (payload) => {
    // Write a single actuator control value if pointers available
    try { const i = payload.index|0; pendingCtrl.set(i, +payload.value||0); } catch (err) { strictCatch(err, 'worker:set_ctrl'); }
  },
  setQpos: (payload) => {
    try {
      const idx = Number(payload.index) | 0;
      if (idx < 0) throw new Error('invalid qpos index');
      const target = Number(payload.value);
      if (!Number.isFinite(target)) throw new Error('invalid qpos value');
      const qpos = sim?.qposView?.();
      if (!qpos || idx >= qpos.length) throw new Error('qpos view missing');
      let v = target;
      if (Number.isFinite(payload.min)) v = Math.max(Number(payload.min), v);
      if (Number.isFinite(payload.max)) v = Math.min(Number(payload.max), v);
      qpos[idx] = v;
      try { sim.forward?.(); } catch (err) { strictCatch(err, 'worker:setQpos_forward'); }
    } catch (err) {
      logWarn('worker: setQpos failed', String(err || ''));
      strictCatch(err, 'worker:setQpos');
    }
  },
  setEqualityActive: (payload) => {
    try {
      const idx = Number(payload.index) | 0;
      const active = !!payload.active;
      if (idx < 0) throw new Error('invalid equality index');
      const eqActive = sim?.eqActiveView?.();
      if (!eqActive || idx >= eqActive.length) throw new Error('eq_active view missing');
      eqActive[idx] = active ? 1 : 0;
      try { sim.forward?.(); } catch (err) { strictCatch(err, 'worker:setEqualityActive_forward'); }
    } catch (err) {
      logWarn('worker: setEqualityActive failed', String(err || ''));
      strictCatch(err, 'worker:setEqualityActive');
    }
  },
  setRate: (payload) => {
    const nextRate = +payload.rate || 1;
    resetTimingForCurrentSim(nextRate);
  },
  setSnapshotHz: (payload) => {
    const hz = Number(payload.hz);
    if (!Number.isFinite(hz) || hz <= 0) return;
    const tiers = [30, 60, 120];
    let best = tiers[0];
    let bestDist = Math.abs(hz - best);
    for (const t of tiers) {
      const dist = Math.abs(hz - t);
      if (dist < bestDist) {
        bestDist = dist;
        best = t;
      }
    }
    snapshotHz = best;
    snapshotIntervalMs = 1000 / best;
    snapshotAccumulatorMs = 0;
    snapshotLastTickMs = 0;
  },
  setPaused: (payload) => {
    const nextRunning = !payload.paused;
    setRunning(nextRunning, payload.source || 'ui');
    if (!nextRunning) {
      historyState && (historyState.resumeRun = false);
    } else if (historyState?.scrubActive) {
      releaseHistoryScrub();
      emitHistoryMeta();
    }
  },
  snapshot: () => {
    if (sim && h) snapshot();
  },
};

async function dispatchCommandMessage(message) {
  const result = dispatchCommand(commandHandlers, message);
  if (result && typeof result.then === 'function') {
    await result;
  }
}

onmessage = async (ev) => {
  const msg = ev.data || {};
  try {
    await dispatchCommandMessage(msg);
  } catch (e) {
    try {
      postMessage({ kind:'error', message: String(e) });
    } catch (innerErr) {
      strictCatch(innerErr, 'worker:post_error');
    }
    strictCatch(e, 'worker:onmessage');
  }
};
