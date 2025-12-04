// Physics worker: loads MuJoCo WASM (dynamically), advances simulation at fixed rate,
// and posts Float64Array snapshots (xpos/xmat) back to the main thread.
import { collectRenderAssetsFromModule, heapViewF64, heapViewF32, heapViewI32, readCString, MjSimLite } from './bridge.mjs';
import { withCacheTag } from './paths.mjs';
import { writeOptionField, readOptionStruct, detectOptionSupport } from './viewer_option_struct.mjs';
import { writeVisualField, readVisualStruct } from './viewer_visual_struct.mjs';
import { writeStatisticField, readStatisticStruct } from './viewer_stat_struct.mjs';
import installForgeAbiCompat from './forge_abi_compat.js';
import { createSceneSnap } from './snapshots.mjs';

const FORCE_EPS = 1e-9;
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
let voptFlags = Array.from({ length: 32 }, () => 0);
const SCENE_FLAG_DEFAULTS = [1, 0, 1, 0, 1, 0, 1, 0, 0, 1];
let sceneFlags = SCENE_FLAG_DEFAULTS.slice();
let labelMode = 0;
let frameMode = 0;
let cameraMode = 0;
const GROUP_TYPES = ['geom', 'site', 'joint', 'tendon', 'actuator', 'flex', 'skin'];
const MJ_GROUP_COUNT = 6;
let groupState = createGroupState();
let lastBounds = { center: [0, 0, 0], radius: 0 };
let alignSeq = 0;
let copySeq = 0;
let renderAssets = null;
let frameSeq = 0;
let optionSupport = { supported: false, pointers: [] };
const diagStagesLogged = new Set();
let lastSyncWallTime = (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000;
let lastSyncSimTime = 0;
let simTimeApprox = 0;
let stepDebt = 0;
let hasLoggedNoSim = false;
let measuredSlowdown = 1;

const MAX_WALL_DELTA = 0.25; // clamp wall delta to avoid huge catch-up after tab suspension

const snapshotDebug = (() => {
  if (typeof self !== 'undefined') {
    const flag = self.PLAY_SNAPSHOT_DEBUG;
    if (flag === true || flag === 1 || flag === '1') return true;
  }
  try {
    const url = new URL(import.meta.url);
    return url.searchParams.get('snapshot') === '1';
  } catch {}
  return false;
})();

const verboseWorkerLogs = (() => {
  try {
    const url = new URL(import.meta.url);
    if (url.searchParams.get('verbose') === '1') return true;
  } catch {}
  try {
    if (typeof self !== 'undefined' && self.PLAY_VERBOSE_DEBUG === true) return true;
  } catch {}
  return false;
})();
const snapshotLogEnabled = snapshotDebug && verboseWorkerLogs;
const verboseLogEnabled = verboseWorkerLogs;

function emitLog(message, extra, { force = false } = {}) {
  if (!force && !verboseLogEnabled) return;
  try { postMessage({ kind: 'log', message, extra }); } catch {}
}

// Noise controls are currently disabled in the web build.
// Keep the helpers defined as no-ops so the message wiring stays intact
// without affecting underlying MuJoCo control values.
function standardNormalNoise() {
  return 0;
}

function applyCtrlNoise() {
  // Intentionally left blank: ctrl noise is disabled.
}

const snapshotState = { frame: 0, lastSim: null, loggedCtrlSample: false };

const HISTORY_DEFAULT_CAPTURE_HZ = 30;
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
    } catch {}
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
  } catch {
    tSim = simTimeApprox || 0;
  }
  lastSyncWallTime = nowSec;
  lastSyncSimTime = tSim;
  simTimeApprox = tSim;
  stepDebt = 0;
  if (initialRate != null && Number.isFinite(initialRate)) {
    rate = Math.max(0.0625, Math.min(16, Number(initialRate) || 1));
  }
}

function readStructState(scope) {
  if (!mod || !(h > 0)) return null;
  try {
    if (scope === 'mjVisual') {
      return readVisualStruct(mod, h);
    }
    if (scope === 'mjStatistic') {
      return readStatisticStruct(mod, h);
    }
  } catch {}
  return null;
}

function createGroupState(initial = 1) {
  const state = {};
  for (const type of GROUP_TYPES) {
    state[type] = Array.from({ length: MJ_GROUP_COUNT }, () => (initial ? 1 : 0));
  }
  return state;
}

function cloneGroupState(source = groupState) {
  const out = {};
  for (const type of GROUP_TYPES) {
    const values = Array.isArray(source?.[type]) ? source[type] : null;
    out[type] = Array.from({ length: MJ_GROUP_COUNT }, (_, idx) => (values && values[idx] ? 1 : 0));
  }
  return out;
}

function cloneSceneFlags(source = sceneFlags) {
  const out = [];
  for (let i = 0; i < SCENE_FLAG_DEFAULTS.length; i += 1) {
    if (source && source[i] != null) {
      out[i] = source[i] ? 1 : 0;
    } else {
      out[i] = SCENE_FLAG_DEFAULTS[i];
    }
  }
  return out;
}

function emitOptionState() {
  try {
    postMessage({
      kind: 'options',
      voptFlags: Array.isArray(voptFlags) ? [...voptFlags] : [],
      sceneFlags: cloneSceneFlags(),
      labelMode,
      frameMode,
      cameraMode,
      groups: cloneGroupState(),
    });
  } catch {}
}

function emitStructState(scope) {
  const value = readStructState(scope);
  if (!value) return;
  try {
    postMessage({ kind: 'struct_state', scope, value });
  } catch {}
}

function collectCameraMeta() {
  const cameras = [];
  if (!sim || !mod || !(h > 0)) return cameras;
  const count = typeof sim.ncam === 'function' ? (sim.ncam() | 0) : (typeof mod._mjwf_ncam === 'function' ? (mod._mjwf_ncam(h) | 0) : 0);
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
    if (snapshotDebug) {
      postMessage({ kind: 'log', message: 'worker: camera meta failed', extra: String(err) });
    }
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
    if (snapshotDebug) {
      postMessage({ kind: 'log', message: 'worker: geom meta failed', extra: String(err) });
    }
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
  } catch {}
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

  try {
    const nefcFn = typeof moduleRef.data_nefc === 'function' ? moduleRef.data_nefc : moduleRef._mjwf_data_nefc;
    const nefcPtrFn = typeof moduleRef.data_nefc_ptr === 'function' ? moduleRef.data_nefc_ptr : moduleRef._mjwf_data_nefc_ptr;
    if (typeof nefcFn === 'function') {
      out.nefc = (nefcFn.call(moduleRef, handle) | 0) || 0;
    } else if (typeof nefcPtrFn === 'function') {
      const ptr = nefcPtrFn.call(moduleRef, handle) | 0;
      if (ptr) {
        const view = heapViewI32(mod, ptr, 1);
        out.nefc = (view && view.length > 0 ? view[0] : 0) | 0;
      }
    }
  } catch {}

  try {
    const durFn = moduleRef.data_timer_duration_ptr || moduleRef._mjwf_data_timer_duration_ptr;
    const numFn = moduleRef.data_timer_number_ptr || moduleRef._mjwf_data_timer_number_ptr;
    if (typeof durFn === 'function' && typeof numFn === 'function') {
      const durPtr = durFn.call(moduleRef, handle) | 0;
      const numPtr = numFn.call(moduleRef, handle) | 0;
      if (durPtr && numPtr) {
        const durations = heapViewF64(moduleRef, durPtr, MJ_NTIMER);
        const numbers = heapViewI32(moduleRef, numPtr, MJ_NTIMER);
        const stepDur = Number(durations[MJ_TIMER_STEP]) || 0;
        const stepNum = Math.max(1, Number(numbers[MJ_TIMER_STEP]) || 0);
        const fwdDur = Number(durations[MJ_TIMER_FORWARD]) || 0;
        const fwdNum = Math.max(1, Number(numbers[MJ_TIMER_FORWARD]) || 0);
        out.cpuStepMs = (stepDur / stepNum) * 1000;
        out.cpuForwardMs = (fwdDur / fwdNum) * 1000;
      }
    }
  } catch {}

  let nisland = 0;
  try {
    const nislandPtrFn = moduleRef.data_nisland_ptr || moduleRef._mjwf_data_nisland_ptr;
    if (typeof nislandPtrFn === 'function') {
      const ptr = nislandPtrFn.call(moduleRef, handle) | 0;
      if (ptr) {
        const view = heapViewI32(moduleRef, ptr, 1);
        nisland = (view && view.length > 0 ? view[0] : 0) | 0;
      }
    }
  } catch {}
  out.nisland = nisland;

  try {
    const niterPtrFn = moduleRef.data_solver_niter_ptr || moduleRef._mjwf_data_solver_niter_ptr;
    const imprPtrFn = moduleRef.data_solver_improvement_ptr || moduleRef._mjwf_data_solver_improvement_ptr;
    const gradPtrFn = moduleRef.data_solver_gradient_ptr || moduleRef._mjwf_data_solver_gradient_ptr;
    const fwdinvPtrFn = moduleRef.data_solver_fwdinv_ptr || moduleRef._mjwf_data_solver_fwdinv_ptr;

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
        const imprFn = imprPtrFn;
        const gradFn = gradPtrFn;
        if (typeof imprFn === 'function' && typeof gradFn === 'function') {
          const baseCount = nisland * MJ_NSOLVER;
          const imprPtr = imprFn.call(moduleRef, handle) | 0;
          const gradPtr = gradFn.call(moduleRef, handle) | 0;
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
  } catch {}

  try {
    const energyPtrFn = moduleRef.data_energy_ptr || moduleRef._mjwf_data_energy_ptr;
    if (typeof energyPtrFn === 'function') {
      const eptr = energyPtrFn.call(moduleRef, handle) | 0;
      if (eptr) {
        const ev = heapViewF64(moduleRef, eptr, 2);
        const e0 = Number(ev[0]) || 0;
        const e1 = Number(ev[1]) || 0;
        out.energy = e0 + e1;
      }
    }
  } catch {}

  try {
    const maxConFn = moduleRef.data_maxuse_con_ptr || moduleRef._mjwf_data_maxuse_con_ptr;
    const maxEfcFn = moduleRef.data_maxuse_efc_ptr || moduleRef._mjwf_data_maxuse_efc_ptr;
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
  } catch {}

  try {
    const narenaPtrFn = moduleRef.data_narena_ptr || moduleRef._mjwf_data_narena_ptr;
    const maxArenaPtrFn = moduleRef.data_maxuse_arena_ptr || moduleRef._mjwf_data_maxuse_arena_ptr;
    if (typeof narenaPtrFn === 'function') {
      const p = narenaPtrFn.call(moduleRef, handle) | 0;
      if (p) {
        const v = heapViewI32(moduleRef, p, 1);
        out.narena = (v && v.length > 0 ? v[0] : 0) | 0;
      }
    }
    if (typeof maxArenaPtrFn === 'function') {
      const p = maxArenaPtrFn.call(moduleRef, handle) | 0;
      if (p) {
        const v = heapViewI32(moduleRef, p, 1);
        out.maxuseArena = (v && v.length > 0 ? v[0] : 0) | 0;
      }
    }
  } catch {}

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
  } catch {}
}

function ensureKeySlot(index) {
  if (!keyframeState || !Array.isArray(keyframeState.slots)) return null;
  const slots = keyframeState.slots;
  if (!slots.length) return null;
  const target = Math.max(0, Math.min(index, slots.length - 1));
  const slot = slots[target];
  if (slot && !slot.state && (keyframeState.stateSize | 0) > 0) {
    slot.state = new Float64Array(keyframeState.stateSize | 0);
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
  } catch {}
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

// Boot log for diagnostics
emitLog('worker: boot');

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
  try {
    if (typeof m._mjwf_errno_last_global === 'function') {
      meta.errno = m._mjwf_errno_last_global() | 0;
    }
  } catch {}
  try {
    if (!meta.errno && typeof m._mjwf_helper_errno_last_global === 'function') {
      meta.helperErrno = m._mjwf_helper_errno_last_global() | 0;
    }
  } catch {}
  try {
    if (typeof m._mjwf_errmsg_last_global === 'function') {
      meta.errmsg = cstr(m, m._mjwf_errmsg_last_global() | 0);
    }
  } catch {}
  try {
    if (!meta.errmsg && typeof m._mjwf_helper_errmsg_last_global === 'function') {
      meta.helperErrmsg = cstr(m, m._mjwf_helper_errmsg_last_global() | 0);
    }
  } catch {}
  return meta;
}

function readErrno(modRef) {
  const meta = readLastErrorMeta(modRef);
  return meta.errno || meta.helperErrno || 0;
}

function logHandleFailure(stage, info) {
  const meta = readLastErrorMeta(mod);
  emitLog(`worker: handle failure (${stage})`, {
    errno: meta.errno,
    errmsg: meta.errmsg,
    helperErrno: meta.helperErrno,
    helperErrmsg: meta.helperErrmsg,
    extra: info ?? null,
  }, { force: true });
}

function readModelCount(name) {
  if (sim && typeof sim[name] === 'function') {
    try { return sim[name]() | 0; } catch { return 0; }
  }
  if (!mod || !(h > 0)) return 0;
  const modern = mod[`_mjwf_model_${name}`];
  if (typeof modern === 'function') {
    try { return modern.call(mod, h) | 0; } catch { return 0; }
  }
  return 0;
}

function readDataCount(name) {
  if (sim && typeof sim[name] === 'function') {
    try { return sim[name]() | 0; } catch { return 0; }
  }
  if (!mod || !(h > 0)) return 0;
  const modern = mod[`_mjwf_data_${name}`];
  if (typeof modern === 'function') {
    try { return modern.call(mod, h) | 0; } catch { return 0; }
  }
  return 0;
}

function readPtr(owner, name) {
  if (sim) {
    try {
      if (owner === 'model') return sim._readModelPtr?.(name) || 0;
      if (owner === 'data') return sim._readDataPtr?.(name) || 0;
    } catch {}
  }
  if (!mod || !(h > 0)) return 0;
  const modern = mod[`_mjwf_${owner}_${name}_ptr`];
  if (typeof modern === 'function') {
    try { return modern.call(mod, h) | 0; } catch { return 0; }
  }
  return 0;
}

const readModelPtr = (name) => readPtr('model', name);
const readDataPtr = (name) => readPtr('data', name);

function logSimPointers(stage, { force = false } = {}) {
  if (!sim || typeof sim.pointerDiagnostics !== 'function') return;
  if (!force && diagStagesLogged.has(stage)) return;
  try {
    const diag = sim.pointerDiagnostics(stage);
    diag.modMatch = sim.mod === mod;
    diag.moduleTag = sim.mod?.__forgeModuleId || null;
    diagStagesLogged.add(stage);
    emitLog(`worker: sim pointer diag (${stage})`, diag, { force });
  } catch (err) {
    emitLog(`worker: sim pointer diag failed (${stage})`, String(err || ''), { force });
  }
}


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

function summariseForceArray(arr, nbody) {
  if (!(arr instanceof Float64Array) && !Array.isArray(arr)) return null;
  const bodyCount = Math.max(0, Number(nbody) | 0);
  if (!(bodyCount > 0)) return null;
  let active = 0;
  let maxMagSq = 0;
  for (let body = 0; body < bodyCount; body += 1) {
    const base = body * 6;
    if (base + 5 >= arr.length) break;
    let magSq = 0;
    for (let i = 0; i < 6; i += 1) {
      const v = Number(arr[base + i]) || 0;
      magSq += v * v;
    }
    if (magSq > FORCE_EPS) {
      active += 1;
      if (magSq > maxMagSq) maxMagSq = magSq;
    }
  }
  return { activeBodies: active, maxMagnitude: Math.sqrt(maxMagSq || 0) };
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
  emitLog('worker: loading forge module...');
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
  } catch {}

  let distBase;
  if (forgeBaseOverride) {
    // When forgeBase is provided (e.g. from GitHub Pages demo),
    // treat it as the canonical dist/<ver>/ base URL.
    try {
      distBase = new URL(forgeBaseOverride);
    } catch {
      // Fallback to local dist layout if forgeBase is malformed.
      distBase = new URL(`../../dist/${ver}/`, import.meta.url);
    }
  } else {
    // Local dev: serve dist/<ver>/ from the same origin.
    distBase = new URL(`../../dist/${ver}/`, import.meta.url);
  }
  const jsAbs = new URL(`mujoco.js`, distBase);
  const wasmAbs = new URL(`mujoco.wasm`, distBase);
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
      emitLog('worker: forge version.json', {
        distBase: distBase.href,
        mujocoVersion: j.mujocoVersion || null,
        buildProfile: j.profile || null,
        exceptions: j.exceptions || null,
        shaTag: vTag || null,
      }, { force: true });
    }
  } catch {}
  try {
    const jsHref = withCacheTag(jsAbs.href, vTag);
    const wasmHref = withCacheTag(wasmAbs.href, vTag);
    const loaderMod = await import(/* @vite-ignore */ jsHref);
    const load_mujoco = loaderMod.default;
    const wasmUrl = new URL(wasmHref);
    if (!vTag) wasmUrl.searchParams.set('cb', String(Date.now()));
    mod = await load_mujoco({ locateFile: (p) => (p.endsWith('.wasm') ? wasmUrl.href : p) });
    try { installForgeAbiCompat(mod); } catch {}
    try {
      const enableTimers =
        typeof mod._mjwf_enable_timers === 'function'
          ? mod._mjwf_enable_timers
          : (typeof mod.cwrap === 'function' ? mod.cwrap('mjwf_enable_timers', null, []) : null);
      if (typeof enableTimers === 'function') {
        enableTimers.call(mod);
      }
    } catch {}
  } catch (e) {
    throw e;
  }
  try {
    emitLog('worker: forge module ready', {
      hasMake: typeof (mod)._mjwf_helper_make_from_xml === 'function',
      hasCcall: typeof mod.ccall === 'function',
    });
    const geomKeys = Object.keys(mod || {}).filter((k) => k.includes('_geom_')).slice(0, 16);
    emitLog('worker: geom export sample', geomKeys);
    const contactKeys = Object.keys(mod || {})
      .filter((k) => k.includes('_contact') || k.includes('_data_contact'))
      .slice(0, 24);
    if (contactKeys.length > 0) {
      emitLog('worker: contact export sample', contactKeys);
    } else {
      emitLog('worker: no contact exports detected');
    }
  } catch {}
  return mod;
}


async function loadXmlWithFallback(xmlText) {
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
      ensureSim();
      sim.term();
      sim.initFromXmlStrict(text);
      h = sim.h | 0;
      logSimPointers(`load:${attempt.stage}`, { force: true });
      emitLog(`worker: loaded via ${attempt.stage}`, { abi });
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
      const meta = readLastErrorMeta(mod || {});
      const errPayload = {
        stage: attempt.stage,
        error: String(err || ''),
        errno: meta.errno,
        errmsg: meta.errmsg,
        helperErrno: meta.helperErrno,
        helperErrmsg: meta.helperErrmsg,
        file: attempt.stage === 'primary' ? 'primary' : 'fallback-none',
      };
      logHandleFailure('tryMakeHandle_fail', errPayload);
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
  const n = sim.ngeom?.() | 0;
  const nbodyLocal = sim.nbody?.() | 0;
  const xposView = sim.geomXposView?.();
  const xmatView = sim.geomXmatView?.();
  const xpos = xposView ? new Float64Array(xposView) : new Float64Array(0);
  const xmat = xmatView ? new Float64Array(xmatView) : new Float64Array(0);
  const gsizeView = sim.geomSizeView?.();
  const gtypeView = sim.geomTypeView?.();
  const gmatidView = sim.geomMatIdView?.();
  const gdataidView = sim.geomDataidView?.();
  const matRgbaView = sim.matRgbaView?.();
  const ctrlView = sim.ctrlView?.();
  const xfrcView = sim.xfrcAppliedView?.();
  const qfrcView = sim.qfrcAppliedView?.();
  const sensordataView = sim.sensordataView?.();
  const jntTypeView = sim.jntTypeView?.();
  const jntPosView = sim.jntPosView?.();
  const jntAxisView = sim.jntAxisView?.();
  const jntBodyView = sim.jntBodyIdView?.();
  const jointDebug = {
    njnt: typeof sim.njnt === 'function' ? (sim.njnt() | 0) : null,
    modelPtr: sim?.modelPtr ?? null,
    dataPtr: sim?.dataPtr ?? null,
    hasPos: !!jntPosView,
    lenPos: jntPosView?.length || 0,
    hasAxis: !!jntAxisView,
    lenAxis: jntAxisView?.length || 0,
    hasBody: !!jntBodyView,
    lenBody: jntBodyView?.length || 0,
  };
  const actTrnidView = sim.actuatorTrnidView?.();
  const actTrntypeView = sim.actuatorTrntypeView?.();
  const actCrankView = sim.actuatorCranklengthView?.();
  const siteXposView = sim.siteXposView?.();
  const siteXmatView = sim.siteXmatView?.();
  const sensorTypeView = sim.sensorTypeView?.();
  const sensorObjIdView = sim.sensorObjIdView?.();
  const eqTypeView = sim.eqTypeView?.();
  const eqObj1View = sim.eqObj1IdView?.();
  const eqObj2View = sim.eqObj2IdView?.();
  const eqObjTypeView = sim.eqObjTypeView?.();
  const eqDataView = sim.eqDataView?.();
  const eqActiveView = sim.eqActiveView?.();
  const eqActive0View = sim.eqActive0View?.();
  const bodyXposView = sim.bodyXposView?.();
  const bodyXmatView = sim.bodyXmatView?.();
  const bodyXiposView = sim.bodyXiposView?.();
  const camXposView = sim.camXposView?.();
  const camXmatView = sim.camXmatView?.();
  const lightXposView = sim.lightXposView?.();
  const lightXdirView = sim.lightXdirView?.();
  const tSim = sim.time?.() || 0;
  if (!diagStagesLogged.has('first_snapshot')) {
    logSimPointers('first_snapshot');
  }
  let scenePayload = null;
  if (n > 0 && xposView && xmatView) {
    try {
      scenePayload = createSceneSnap({
        frame: snapshotState.frame,
        ngeom: n,
        gtype: gtypeView ? new Int32Array(gtypeView) : null,
        gsize: gsizeView ? new Float64Array(gsizeView) : null,
        gmatid: gmatidView ? new Int32Array(gmatidView) : null,
        matrgba: matRgbaView ? new Float32Array(matRgbaView) : null,
        gdataid: gdataidView ? new Int32Array(gdataidView) : null,
        xpos,
        xmat,
        mesh: renderAssets?.meshes ?? null,
      });
    } catch (err) {
      if (snapshotDebug) {
        try { postMessage({ kind: 'log', message: 'worker: scene snapshot prep failed', extra: String(err) }); } catch {}
      }
    }
    if (snapshotState) {
      snapshotState.lastSim = scenePayload ?? null;
      snapshotState.frame += 1;
    }
  }
  lastBounds = computeBoundsFromPositions(xpos, n);
    const nq = sim.nq?.() | 0;
    const nv = sim.nv?.() | 0;
    const nuLocal = sim.nu?.() | 0;
    let ctrl = null;
    if (nuLocal > 0 && ctrlView) {
      ctrl = new Float64Array(ctrlView);
    }
    let qpos = null;
    const qposView = sim.qposView?.();
    if (qposView && nq > 0) {
      // Avoid shipping huge buffers; cap to moderate size while keeping simulate parity for typical models
      if (nq <= 512) {
        qpos = new Float64Array(qposView);
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
  const frameId = frameSeq++;
  const slowdownSafe = (() => {
    if (!Number.isFinite(measuredSlowdown) || measuredSlowdown <= 0) return 1;
    return measuredSlowdown;
  })();
  const msg = {
    kind: 'snapshot',
    tSim,
    ngeom: n,
    nq,
    nv,
    nbody: nbodyLocal,
    xpos,
    xmat,
    bxpos: bodyXposView ? new Float64Array(bodyXposView) : null,
    bxmat: bodyXmatView ? new Float64Array(bodyXmatView) : null,
    xipos: bodyXiposView ? new Float64Array(bodyXiposView) : null,
    cam_xpos: camXposView ? new Float64Array(camXposView) : null,
    cam_xmat: camXmatView ? new Float64Array(camXmatView) : null,
    light_xpos: lightXposView ? new Float64Array(lightXposView) : null,
    light_xdir: lightXdirView ? new Float64Array(lightXdirView) : null,
    gesture,
    drag,
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
    try {
      const nconLocal = sim.ncon?.() | 0;
      const info = buildInfoStats(sim, tSim, nconLocal);
      if (info) {
        msg.info = info;
      }
    } catch {}
    const transfers = [xpos.buffer, xmat.buffer];
    if (msg.bxpos) transfers.push(msg.bxpos.buffer);
    if (msg.bxmat) transfers.push(msg.bxmat.buffer);
    if (msg.xipos) transfers.push(msg.xipos.buffer);
    if (msg.cam_xpos) transfers.push(msg.cam_xpos.buffer);
    if (msg.cam_xmat) transfers.push(msg.cam_xmat.buffer);
    if (msg.light_xpos) transfers.push(msg.light_xpos.buffer);
    if (msg.light_xdir) transfers.push(msg.light_xdir.buffer);
    if (msg.qpos) transfers.push(msg.qpos.buffer);
  const optionsStruct = readOptionStruct(mod, h);
  if (optionsStruct) {
    msg.options = optionsStruct;
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
  if (gsizeView) {
    if (snapshotLogEnabled) console.log('[worker] gsize view len', gsizeView.length);
    const gsize = new Float64Array(gsizeView);
    msg.gsize = gsize;
    transfers.push(gsize.buffer);
  }
  if (gtypeView) {
    if (snapshotLogEnabled) console.log('[worker] gtype view len', gtypeView.length);
    const gtype = new Int32Array(gtypeView);
    msg.gtype = gtype;
    transfers.push(gtype.buffer);
  }
  if (gmatidView) {
    const gmatid = new Int32Array(gmatidView);
    msg.gmatid = gmatid;
    transfers.push(gmatid.buffer);
  }
  if (gdataidView) {
    const gdataid = new Int32Array(gdataidView);
    msg.gdataid = gdataid;
    transfers.push(gdataid.buffer);
  }
  if (jntTypeView) {
    const jtype = new Int32Array(jntTypeView);
    msg.jtype = jtype;
    transfers.push(jtype.buffer);
  }
  if (jntPosView) {
    const jpos = new Float64Array(jntPosView);
    msg.jpos = jpos;
    transfers.push(jpos.buffer);
  }
  if (jntAxisView) {
    const jaxis = new Float64Array(jntAxisView);
    msg.jaxis = jaxis;
    transfers.push(jaxis.buffer);
  }
  if (jntBodyView) {
    const jbody = new Int32Array(jntBodyView);
    msg.jbody = jbody;
    transfers.push(jbody.buffer);
  }
  msg.debugJoint = jointDebug;
  if (actTrnidView) {
    const atrn = new Int32Array(actTrnidView);
    msg.act_trnid = atrn;
    transfers.push(atrn.buffer);
  }
  if (actTrntypeView) {
    const atype = new Int32Array(actTrntypeView);
    msg.act_trntype = atype;
    transfers.push(atype.buffer);
  }
  if (actCrankView) {
    const acrank = new Float64Array(actCrankView);
    msg.act_cranklength = acrank;
    transfers.push(acrank.buffer);
  }
  if (siteXposView) {
    const sPos = new Float64Array(siteXposView);
    msg.site_xpos = sPos;
    transfers.push(sPos.buffer);
  }
  if (siteXmatView) {
    const sMat = new Float64Array(siteXmatView);
    msg.site_xmat = sMat;
    transfers.push(sMat.buffer);
  }
  if (sensorTypeView) {
    const stype = new Int32Array(sensorTypeView);
    msg.sensor_type = stype;
    transfers.push(stype.buffer);
  }
  if (sensorObjIdView) {
    const sobj = new Int32Array(sensorObjIdView);
    msg.sensor_objid = sobj;
    transfers.push(sobj.buffer);
  }
  if (eqTypeView) {
    const et = new Int32Array(eqTypeView);
    msg.eq_type = et;
    transfers.push(et.buffer);
  }
  if (eqObj1View) {
    const eo1 = new Int32Array(eqObj1View);
    msg.eq_obj1id = eo1;
    transfers.push(eo1.buffer);
  }
  if (eqObj2View) {
    const eo2 = new Int32Array(eqObj2View);
    msg.eq_obj2id = eo2;
    transfers.push(eo2.buffer);
  }
  if (eqObjTypeView) {
    const eot = new Int32Array(eqObjTypeView);
    msg.eq_objtype = eot;
    transfers.push(eot.buffer);
  }
  if (eqDataView) {
    const ed = new Float64Array(eqDataView);
    msg.eq_data = ed;
    transfers.push(ed.buffer);
  }
  if (eqActiveView) {
    const ea = new Uint8Array(eqActiveView);
    msg.eq_active = ea;
    transfers.push(ea.buffer);
  }
  if (eqActive0View) {
    const ea0 = new Uint8Array(eqActive0View);
    msg.eq_active0 = ea0;
    transfers.push(ea0.buffer);
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
  if (snapshotDebug && !diagStagesLogged.has('eq_snapshot')) {
    diagStagesLogged.add('eq_snapshot');
    const neqVal = typeof sim?.neq === 'function' ? (sim.neq() | 0) : 0;
    const eqActiveLen = ArrayBuffer.isView(eqActiveView) ? eqActiveView.length : 0;
    emitLog('worker: eq snapshot diag', {
      neq: neqVal,
      hasEqActiveView: !!eqActiveView,
      eqActiveLen,
    }, { force: true });
  }
  if (matRgbaView) {
    const matrgba = new Float32Array(matRgbaView);
    msg.matrgba = matrgba;
    transfers.push(matrgba.buffer);
  }
  if (ctrl) {
    msg.ctrl = ctrl;
    transfers.push(ctrl.buffer);
    if (!snapshotState.loggedCtrlSample) {
      snapshotState.loggedCtrlSample = true;
      emitLog('worker: ctrl sample', { len: ctrl.length, sample: Array.from(ctrl.slice(0, Math.min(4, ctrl.length))) });
    }
  }
  if (xfrcView) {
    const xfrc = new Float64Array(xfrcView);
    msg.xfrc_applied = xfrc;
    transfers.push(xfrc.buffer);
    const summary = summariseForceArray(xfrc, nbodyLocal);
    if (summary) msg.force_meta = summary;
  }
  if (qfrcView) {
    const qfrc = new Float64Array(qfrcView);
    msg.qfrc_applied = qfrc;
    transfers.push(qfrc.buffer);
  }
  if (sensordataView) {
    const sens = new Float64Array(sensordataView);
    msg.sensordata = sens;
    transfers.push(sens.buffer);
  }
  let contacts = null;
  try {
    if (typeof sim.ensurePointers === 'function') {
      sim.ensurePointers();
    }
    const ncon = sim.ncon?.() | 0;
    if (ncon > 0) {
      contacts = { n: ncon };
      const posView = sim.contactPosView?.();
      if (posView) {
        const pos = new Float64Array(posView);
        contacts.pos = pos;
        transfers.push(pos.buffer);
      }
      const frameView = sim.contactFrameView?.();
      if (frameView) {
        const frame = new Float64Array(frameView);
        contacts.frame = frame;
        transfers.push(frame.buffer);
      }
      if (snapshotDebug) {
        try {
          console.log('[worker] contact view diag', {
            ncon,
            hasPos: !!posView,
            hasFrame: !!frameView,
            posLen: posView ? posView.length : 0,
            frameLen: frameView ? frameView.length : 0,
          });
        } catch {}
      }
      const geom1View = sim.contactGeom1View?.();
      if (geom1View) {
        const geom1 = new Int32Array(geom1View);
        contacts.geom1 = geom1;
        transfers.push(geom1.buffer);
      }
      const geom2View = sim.contactGeom2View?.();
      if (geom2View) {
        const geom2 = new Int32Array(geom2View);
        contacts.geom2 = geom2;
        transfers.push(geom2.buffer);
      }
      const distView = sim.contactDistView?.();
      if (distView) {
        const dist = new Float64Array(distView);
        contacts.dist = dist;
        transfers.push(dist.buffer);
      }
      const fricView = sim.contactFrictionView?.();
      if (fricView) {
        const fric = new Float64Array(fricView);
        contacts.fric = fric;
        transfers.push(fric.buffer);
      }
      try {
        const forceLocal = sim.contactForceBuffer?.();
        if (forceLocal instanceof Float64Array && forceLocal.length >= (3 * ncon)) {
          let forceOut = forceLocal;
          const frameArray = contacts.frame || null;
          if (frameArray && frameArray.length >= (9 * ncon)) {
            forceOut = new Float64Array(forceLocal.length);
            for (let i = 0; i < ncon; i += 1) {
              const base = 3 * i;
              const rot = 9 * i;
              const fx = forceLocal[base + 0] || 0;
              const fy = forceLocal[base + 1] || 0;
              const fz = forceLocal[base + 2] || 0;
              const c0 = frameArray[rot + 0] || 0;
              const c1 = frameArray[rot + 1] || 0;
              const c2 = frameArray[rot + 2] || 0;
              const c3 = frameArray[rot + 3] || 0;
              const c4 = frameArray[rot + 4] || 0;
              const c5 = frameArray[rot + 5] || 0;
              const c6 = frameArray[rot + 6] || 0;
              const c7 = frameArray[rot + 7] || 0;
              const c8 = frameArray[rot + 8] || 0;
              forceOut[base + 0] = c0 * fx + c3 * fy + c6 * fz;
              forceOut[base + 1] = c1 * fx + c4 * fy + c7 * fz;
              forceOut[base + 2] = c2 * fx + c5 * fy + c8 * fz;
            }
          }
          contacts.force = forceOut;
          transfers.push(forceOut.buffer);
        }
      } catch (err) {
        if (typeof console !== 'undefined') {
          console.error('[worker] contact force compute failed', err);
        }
        try {
          postMessage({
            kind: 'log',
            message: 'worker: contact force failed',
            extra: { error: String(err?.message || err), stack: err?.stack || null },
          });
        } catch {}
      }
    }
  } catch (err) {
    if (snapshotDebug) {
      try { postMessage({ kind: 'log', message: 'worker: contact extraction failed', extra: String(err) }); } catch {}
    }
  }
  msg.contacts = contacts || null;
  if (scenePayload) {
    msg.scene_snapshot = { source: 'sim', frame: snapshotState.frame - 1, snap: scenePayload };
  }
  try {
    if (snapshotLogEnabled) console.log('[worker] snapshot keys', Object.keys(msg));
    postMessage(msg, transfers);
  } catch (err) {
    try { postMessage({ kind:'error', message: `snapshot postMessage failed: ${err}` }); } catch {}
  }
}

function emitRenderAssets() {
  if (!mod || !(h > 0)) return;
  try {
    const assets = collectRenderAssetsFromModule(mod, h);
    if (!assets) return;
    renderAssets = assets;
    const transfers = collectAssetBuffersForTransfer(assets);
    try {
      postMessage({ kind: 'render_assets', assets }, transfers);
    } catch (err) {
      postMessage({ kind: 'log', message: 'worker: render_assets post failed', extra: String(err) });
    }
  } catch (err) {
    try {
      postMessage({ kind: 'log', message: 'worker: collectRenderAssets failed', extra: String(err) });
    } catch {}
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
  if (assets?.materials) {
    push(assets.materials.rgba);
    push(assets.materials.reflectance);
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
  return buffers;
}

// Physics fixed-step timer (decoupled from render, simulate-like time management)
setInterval(() => {
  if (!mod || !h || !running) return;
  if (!sim || typeof sim.step !== 'function') {
    if (!hasLoggedNoSim) {
      try { console.error('[physics.worker] sim is not available, cannot step simulation'); } catch {}
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
  } catch {}
  const nowSec = (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000;
  let wallDelta = nowSec - lastSyncWallTime;
  if (!(wallDelta > 0)) return;
  if (wallDelta > MAX_WALL_DELTA) {
    wallDelta = MAX_WALL_DELTA;
  }
  // Accumulate desired simulation steps based on wall time and current rate.
  const currentDt = (() => {
    try {
      if (sim && typeof sim.timestep === 'function') {
        const raw = sim.timestep();
        if (Number.isFinite(raw) && raw > 0) return raw;
      }
    } catch {}
    return dt;
  })();
  if (Number.isFinite(currentDt) && currentDt > 0) {
    dt = currentDt;
    stepDebt += (wallDelta * rate) / currentDt;
  }
  const maxStepsPerTick = 240;
  let steps = stepDebt > 0 ? Math.floor(stepDebt) : 0;
  if (steps > maxStepsPerTick) steps = maxStepsPerTick;
  if (steps <= 0) {
    lastSyncWallTime = nowSec;
    return;
  }
  const tSimBefore = simTimeApprox;
  // Advance sim by a bounded number of fixed steps.
  for (let i = 0; i < steps && sim && typeof sim.step === 'function'; i += 1) {
    try {
      captureHistorySample(true);
      applyCtrlNoise();
      sim.step(1);
    } catch {
      break;
    }
  }
  stepDebt -= steps;
  if (stepDebt < 0) stepDebt = 0;
  lastSyncWallTime = nowSec;
  try {
    if (sim && typeof sim.time === 'function') {
      const tSim = sim.time() || 0;
      lastSyncSimTime = tSim;
      simTimeApprox = tSim;
      const simDelta = Math.max(0, tSim - tSimBefore);
      const theoretical = wallDelta * rate;
      if (simDelta > 0 && theoretical > 0) {
        const instSlowdown = theoretical / simDelta;
        if (Number.isFinite(instSlowdown) && instSlowdown > 0) {
          if (!(measuredSlowdown > 0)) {
            measuredSlowdown = instSlowdown;
          } else {
            const alpha = 0.1;
            measuredSlowdown = measuredSlowdown * (1 - alpha) + instSlowdown * alpha;
          }
        }
      }
    }
  } catch {}
}, 8);

// Snapshot timer at ~60Hz
setInterval(() => { if (sim && h) snapshot(); }, 16);

onmessage = async (ev) => {
  const msg = ev.data || {};
  try {
    if (msg.cmd === 'load') {
      // Stop stepping during reload and clear handle so timers are gated.
      try {
        setRunning(false, 'load', false);
      } catch {}
      if (sim) {
        try { sim.term(); } catch {}
      }
      if (mod && h && typeof mod._mjwf_helper_free === 'function') {
        try { mod._mjwf_helper_free(h); } catch {}
      }
      h = 0;
      const result = await loadXmlWithFallback(msg.xmlText || '');
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
        } catch {}
        return;
      }
      const { abi, handle } = result;
      h = handle | 0;
      frameSeq = 0;
      if (snapshotState) {
        snapshotState.frame = 0;
        snapshotState.lastSim = null;
        snapshotState.loggedCtrlSample = false;
      }
      optionSupport = detectOptionSupport(mod);
      dt = sim?.timestep?.() || 0.002;
      if (Number.isFinite(dt) && dt > 0) {
        const targetHz = clamp(Math.round(1 / dt), 5, 240);
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
      resetTimingForCurrentSim(typeof msg.rate === 'number' ? msg.rate : 1.0);
      setRunning(true, 'load');
      gestureState = { mode: 'idle', phase: 'idle', pointer: null };
      dragState = { dx: 0, dy: 0 };
      voptFlags = Array.from({ length: 32 }, () => 0);
      sceneFlags = SCENE_FLAG_DEFAULTS.slice();
      labelMode = 0;
      frameMode = 0;
      cameraMode = 0;
      const visualState = readStructState('mjVisual');
      const statisticState = readStructState('mjStatistic');
      postMessage({
        kind: 'ready',
        abi,
        dt,
        ngeom,
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
              try { names.push(sim.jntNameOf(i) || `jnt ${i}`); } catch { names.push(`jnt ${i}`); }
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
      } catch {}
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
      } catch {}
      emitCameraMeta();
      emitGeomMeta();
      snapshot();
      emitRenderAssets();
    } else if (msg.cmd === 'reset') {
      if (sim && sim.reset?.()) {
        initHistoryBuffers();
        captureHistorySample(true);
        emitHistoryMeta();
        snapshot();
        resetTimingForCurrentSim(rate);
      }
    } else if (msg.cmd === 'step') {
      if (sim) {
        const n = Math.max(1, Math.min(10000, (msg.n | 0) || 1));
        let steps = 0;
        while (steps < n) {
          try { captureHistorySample(true); } catch {}
          try {
            sim.step(1);
          } catch {
            break;
          }
          steps += 1;
        }
        try {
          const tSim = (sim && typeof sim.time === 'function') ? (sim.time() || 0) : simTimeApprox;
          simTimeApprox = tSim;
        } catch {}
        snapshot();
      }
    } else if (msg.cmd === 'gesture') {
      const sourceGesture = msg.gesture || {};
      const mode = typeof msg.mode === 'string' ? msg.mode : sourceGesture.mode;
      const phase = typeof msg.phase === 'string' ? msg.phase : sourceGesture.phase;
      const pointerSource = msg.pointer ?? sourceGesture.pointer ?? null;
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
      const dragSource = msg.drag ?? (pointer ? { dx: pointer.dx, dy: pointer.dy } : null);
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
      try { postMessage({ kind: 'gesture', gesture: gestureState, drag: dragState }); } catch {}
    } else if (msg.cmd === 'setVoptFlag') {
      const idx = Number(msg.index) | 0;
      const enabled = !!msg.enabled;
      if (!Array.isArray(voptFlags)) voptFlags = Array.from({ length: 32 }, () => 0);
      if (idx >= 0 && idx < voptFlags.length) {
        voptFlags[idx] = enabled ? 1 : 0;
        emitOptionState();
      }
    } else if (msg.cmd === 'setSceneFlag') {
      const idx = Number(msg.index) | 0;
      const enabled = !!msg.enabled;
      if (!Array.isArray(sceneFlags) || sceneFlags.length !== SCENE_FLAG_DEFAULTS.length) {
        sceneFlags = SCENE_FLAG_DEFAULTS.slice();
      }
      if (idx >= 0 && idx < sceneFlags.length) {
        sceneFlags[idx] = enabled ? 1 : 0;
        emitOptionState();
      }
    } else if (msg.cmd === 'setLabelMode') {
      const modeVal = Number(msg.mode) || 0;
      labelMode = modeVal | 0;
      emitOptionState();
    } else if (msg.cmd === 'setFrameMode') {
      const modeVal = Number(msg.mode) || 0;
      frameMode = modeVal | 0;
      emitOptionState();
    } else if (msg.cmd === 'setCameraMode') {
      const modeVal = Number(msg.mode) || 0;
      cameraMode = modeVal | 0;
      emitOptionState();
    } else if (msg.cmd === 'setGroupState') {
      const type = typeof msg.group === 'string' ? msg.group.toLowerCase() : '';
      const idx = Number(msg.index) | 0;
      const enabled = !!msg.enabled;
      if (GROUP_TYPES.includes(type) && idx >= 0 && idx < MJ_GROUP_COUNT) {
        if (!groupState[type]) {
          groupState[type] = Array.from({ length: MJ_GROUP_COUNT }, () => 1);
        }
        groupState[type][idx] = enabled ? 1 : 0;
        emitOptionState();
      }
    } else if (msg.cmd === 'historyScrub') {
      const offset = Number(msg.offset) || 0;
      if (offset < 0) {
        loadHistoryOffset(offset);
      } else {
        releaseHistoryScrub();
      }
      emitHistoryMeta();
    } else if (msg.cmd === 'historyConfig') {
      applyHistoryConfig({ captureHz: msg.captureHz, capacity: msg.capacity });
    } else if (msg.cmd === 'keyframeSave') {
      const used = saveKeyframe(Number(msg.index));
      if (used >= 0) {
        keySliderIndex = used;
      }
    } else if (msg.cmd === 'keyframeLoad') {
      const idx = Math.max(0, normaliseInt(msg.index, 0));
      if (loadKeyframe(idx)) {
        keySliderIndex = idx;
        resetTimingForCurrentSim();
      }
    } else if (msg.cmd === 'keyframeSelect') {
      const idx = Math.max(0, normaliseInt(msg.index, 0));
      if (keyframeState?.slots?.length) {
        keySliderIndex = Math.min(idx, keyframeState.slots.length - 1);
      } else {
        keySliderIndex = idx;
      }
      emitKeyframeMeta();
    } else if (msg.cmd === 'setWatch') {
      const field = typeof msg.field === 'string' ? msg.field : watchState?.field;
      updateWatchTarget(field, msg.index);
      emitWatchState();
    } else if (msg.cmd === 'setField') {
      const target = msg.target;
      if (target === 'mjOption') {
        try {
          const ok = writeOptionField(mod, h, Array.isArray(msg.path) ? msg.path : [], msg.kind, msg.value);
          if (ok) {
            if (Array.isArray(msg.path) && msg.path.length === 1 && msg.path[0] === 'timestep') {
              try {
                const rawDt = sim?.timestep?.() || dt;
                if (Number.isFinite(rawDt) && rawDt > 0) {
                  dt = rawDt;
                  const targetHz = clamp(Math.round(1 / dt), 5, 240);
                  historyConfig = { ...historyConfig, captureHz: targetHz };
                  resetTimingForCurrentSim(rate);
                }
              } catch {}
            }
            snapshot();
          } else if (snapshotDebug) {
            postMessage({ kind: 'log', message: 'worker: setField (mjOption) unsupported', extra: String(msg.path || []) });
          }
        } catch (err) {
          postMessage({ kind: 'log', message: 'worker: setField (mjOption) failed', extra: String(err) });
        }
      } else if (target === 'mjVisual') {
        try {
          const ok = writeVisualField(mod, h, Array.isArray(msg.path) ? msg.path : [], msg.kind, msg.value, msg.size);
          if (ok) {
            emitStructState('mjVisual');
          } else if (snapshotDebug) {
            postMessage({ kind: 'log', message: 'worker: setField (mjVisual) unsupported', extra: String(msg.path || []) });
          }
        } catch (err) {
          postMessage({ kind: 'log', message: 'worker: setField (mjVisual) failed', extra: String(err) });
        }
      } else if (target === 'mjStatistic') {
        try {
          const ok = writeStatisticField(mod, h, Array.isArray(msg.path) ? msg.path : [], msg.kind, msg.value, msg.size);
          if (ok) {
            emitStructState('mjStatistic');
          } else if (snapshotDebug) {
            postMessage({ kind: 'log', message: 'worker: setField (mjStatistic) unsupported', extra: String(msg.path || []) });
          }
        } catch (err) {
          postMessage({ kind: 'log', message: 'worker: setField (mjStatistic) failed', extra: String(err) });
        }
      }
    } else if (msg.cmd === 'applyForce') {
      // Expected: { geomIndex, force:[fx,fy,fz], torque:[tx,ty,tz], point:[x,y,z] }
      try {
        const fx=+msg.force?.[0]||0, fy=+msg.force?.[1]||0, fz=+msg.force?.[2]||0;
        const tx=+msg.torque?.[0]||0, ty=+msg.torque?.[1]||0, tz=+msg.torque?.[2]||0;
        const px=+msg.point?.[0]||0, py=+msg.point?.[1]||0, pz=+msg.point?.[2]||0;
        const gi=msg.geomIndex|0;
        if (!sim?.applyXfrcByGeom?.(gi, [fx, fy, fz], [tx, ty, tz], [px, py, pz]) && snapshotDebug) {
          emitLog('worker: applyForce unsupported in current mode');
        }
      } catch {}
    } else if (msg.cmd === 'applyBodyForce') {
      try {
        const fx=+msg.force?.[0]||0, fy=+msg.force?.[1]||0, fz=+msg.force?.[2]||0;
        const tx=+msg.torque?.[0]||0, ty=+msg.torque?.[1]||0, tz=+msg.torque?.[2]||0;
        const body=msg.bodyId|0;
        if (!sim?.applyXfrcByBody?.(body, [fx, fy, fz], [tx, ty, tz]) && snapshotDebug) {
          emitLog('worker: applyBodyForce unsupported in current mode');
        }
      } catch {}
    } else if (msg.cmd === 'align') {
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
          source: msg.source || 'backend',
        });
      } catch {}
    } else if (msg.cmd === 'copyState') {
      const precision = msg.precision === 'full' ? 'full' : 'standard';
      const payload = captureCopyState(precision);
      payload.source = msg.source || 'backend';
      try { postMessage(payload); } catch {}
    } else if (msg.cmd === 'setCtrlNoise') {
      ctrlNoiseStd = +msg.std || 0;
      ctrlNoiseRate = +msg.rate || 0;
    } else if (msg.cmd === 'clearForces') {
      try { sim?.clearAllXfrc?.(); } catch {}
    } else if (msg.cmd === 'setCtrl') {
      // Write a single actuator control value if pointers available
      try { const i = msg.index|0; pendingCtrl.set(i, +msg.value||0); } catch {}
    } else if (msg.cmd === 'setQpos') {
      try {
        const idx = Number(msg.index) | 0;
        if (idx < 0) throw new Error('invalid qpos index');
        const target = Number(msg.value);
        if (!Number.isFinite(target)) throw new Error('invalid qpos value');
        const qpos = sim?.qposView?.();
        if (!qpos || idx >= qpos.length) throw new Error('qpos view missing');
        let v = target;
        if (Number.isFinite(msg.min)) v = Math.max(Number(msg.min), v);
        if (Number.isFinite(msg.max)) v = Math.min(Number(msg.max), v);
        qpos[idx] = v;
        try { sim.forward?.(); } catch {}
      } catch (err) {
        if (snapshotDebug) emitLog('worker: setQpos failed', { err: String(err) });
      }
    } else if (msg.cmd === 'setEqualityActive') {
      try {
        const idx = Number(msg.index) | 0;
        const active = !!msg.active;
        if (idx < 0) throw new Error('invalid equality index');
        const eqActive = sim?.eqActiveView?.();
        if (!eqActive || idx >= eqActive.length) throw new Error('eq_active view missing');
        eqActive[idx] = active ? 1 : 0;
        try { sim.forward?.(); } catch {}
      } catch (err) {
        if (snapshotDebug) emitLog('worker: setEqualityActive failed', { err: String(err) });
      }
    } else if (msg.cmd === 'setRate') {
      const nextRate = +msg.rate || 1;
      resetTimingForCurrentSim(nextRate);
    } else if (msg.cmd === 'setPaused') {
      const nextRunning = !msg.paused;
      setRunning(nextRunning, msg.source || 'ui');
      if (!nextRunning) {
        historyState && (historyState.resumeRun = false);
      } else if (historyState?.scrubActive) {
        releaseHistoryScrub();
        emitHistoryMeta();
      }
    } else if (msg.cmd === 'snapshot') {
      if (sim && h) snapshot();
    }
  } catch (e) {
    try { postMessage({ kind:'error', message: String(e) }); } catch {}
  }
};
