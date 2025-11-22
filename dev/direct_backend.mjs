// Direct backend that mirrors the Worker protocol but runs MuJoCo on the main thread.
// Exposes a Worker-like surface (addEventListener/postMessage/terminate) so that the
// viewer UI can remain agnostic to whether physics runs in a worker or inline.

import { MjSimLite, createLocalModule, heapViewF64, heapViewF32, heapViewI32, readCString } from './bridge.mjs';
import { writeOptionField, readOptionStruct, detectOptionSupport } from '../../viewer_option_struct.mjs';
import { writeVisualField, readVisualStruct } from '../../viewer_visual_struct.mjs';
import { writeStatisticField, readStatisticStruct } from '../../viewer_stat_struct.mjs';
import { normalizeVer, getForgeDistBase, getVersionInfo, withCacheTag } from './paths.mjs';
import { createSceneSnap } from './snapshots.mjs';
import installForgeAbiCompat from './forge_abi_compat.js';

const TICK_INTERVAL_MS = 8;   // matches physics.worker.mjs stepping cadence
const SNAP_INTERVAL_MS = 16;  // ~60 Hz snapshot stream
const GROUP_TYPES = ['geom', 'site', 'joint', 'tendon', 'actuator', 'flex', 'skin'];
const MJ_GROUP_COUNT = 6;
const MJ_STATE_SIG = 0x1fff;
const HISTORY_DEFAULT_CAPTURE_HZ = 30;
const HISTORY_DEFAULT_CAPACITY = 900;
const KEYFRAME_USER_SLOTS = 5;
const WATCH_FIELDS = ['qpos', 'qvel', 'ctrl', 'sensordata', 'xpos', 'xmat', 'body_xpos', 'body_xmat'];
const SCENE_FLAG_DEFAULTS = [1, 0, 1, 0, 1, 0, 1, 0, 0, 1];

function createGroupState(initial = 1) {
  const state = {};
  for (const type of GROUP_TYPES) {
    state[type] = Array.from({ length: MJ_GROUP_COUNT }, () => (initial ? 1 : 0));
  }
  return state;
}

function cloneGroupState(source) {
  const out = {};
  for (const type of GROUP_TYPES) {
    const arr = Array.isArray(source?.[type]) ? source[type] : [];
    out[type] = Array.from({ length: MJ_GROUP_COUNT }, (_, idx) => (arr[idx] ? 1 : 0));
  }
  return out;
}

function cloneSceneFlags(source) {
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

function getView(mod, ptr, dtype, len) {
  if (!mod || !ptr || !(len > 0)) return null;
  switch (dtype) {
    case 'f64':
      return heapViewF64(mod, ptr, len);
    case 'f32':
      return heapViewF32(mod, ptr, len);
    case 'i32':
      return heapViewI32(mod, ptr, len);
    default:
      return null;
  }
}

function cloneArray(view, ctor) {
  if (!view) return null;
  try {
    if (ctor === Float64Array) return new Float64Array(view);
    if (ctor === Float32Array) return new Float32Array(view);
    if (ctor === Int32Array) return new Int32Array(view);
  } catch {}
  return null;
}

function toEventPayload(data) {
  return { data };
}

function safeCStr(mod, ptr) {
  return readCString(mod, ptr);
}

function readErrno(mod) {
  let eno = 0;
  let emsg = '';
  try { if (typeof mod._mjwf_errno_last === 'function') eno = mod._mjwf_errno_last() | 0; } catch {}
  try {
    if (typeof mod._mjwf_errmsg_last === 'function') {
      emsg = safeCStr(mod, mod._mjwf_errmsg_last() | 0);
    } else if (typeof mod._mjwf_errmsg_last_global === 'function') {
      emsg = safeCStr(mod, mod._mjwf_errmsg_last_global() | 0);
    }
  } catch {}
  return { eno, emsg };
}

export function createDirectBackend(options = {}) {
  return new DirectBackend(options);
}

class DirectBackend {
  constructor(options = {}) {
    const search = typeof location !== 'undefined' ? new URLSearchParams(location.search) : new URLSearchParams();
    this.ver = normalizeVer(options.ver ?? search.get('ver'));
    this.shimParam = options.shimParam ?? search.get('shim');
    this.debug = !!options.debug;
    this.snapshotDebug =
      options.snapshotDebug ?? (typeof window !== 'undefined' ? !!window.PLAY_SNAPSHOT_DEBUG : false);
    this.listeners = {
      message: new Set(),
      error: new Set(),
    };
    this.pending = Promise.resolve();
    this.mod = null;
    this.sim = null;
    this.handle = 0;
    this.dt = 0.002;
    this.rate = 1.0;
    this.running = true;
    this.pendingCtrl = new Map();
    this.tickTimer = null;
    this.snapshotTimer = null;
    this.lastSimNow = performance.now();
    this.gesture = { mode: 'idle', phase: 'idle', pointer: null };
    this.drag = { dx: 0, dy: 0 };
    this.voptFlags = Array.from({ length: 32 }, () => 0);
    this.sceneFlags = SCENE_FLAG_DEFAULTS.slice();
    this.labelMode = 0;
    this.frameMode = 0;
    this.cameraMode = 0;
    this.groupState = createGroupState();
    this.groupState = createGroupState();
    this.groupState = createGroupState();
    this.groupState = createGroupState();
    this.renderAssets = null;
    this.lastBounds = { center: [0, 0, 0], radius: 0 };
    this.alignSeq = 0;
    this.copySeq = 0;
    this.snapshotState = this.snapshotDebug ? { frame: 0, lastSim: null } : null;
    this.frameSeq = 0;
    this.optionSupport = { supported: false, pointers: [] };
    this.visualState = null;
    this.statisticState = null;
    this.cameraList = [];
    this.geomList = [];
    this.historyConfig = { captureHz: HISTORY_DEFAULT_CAPTURE_HZ, capacity: HISTORY_DEFAULT_CAPACITY, stateSig: MJ_STATE_SIG };
    this.history = null;
    this.keyframes = null;
    this.watch = null;
    this.keySliderIndex = -1;
  }

  #computeBoundsFromPositions(view, n) {
    if (!view || !(n > 0)) {
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
      const x = Number(view[ix + 0]) || 0;
      const y = Number(view[ix + 1]) || 0;
      const z = Number(view[ix + 2]) || 0;
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
    return { center: [cx, cy, cz], radius };
  }

  #captureStructState(scope) {
    if (!this.mod || !(this.handle > 0)) return null;
    try {
      if (scope === 'mjVisual') {
        return readVisualStruct(this.mod, this.handle | 0);
      }
      if (scope === 'mjStatistic') {
        return readStatisticStruct(this.mod, this.handle | 0);
      }
    } catch (err) {
      if (this.debug) {
        this.#emitLog('direct: capture struct failed', { scope, error: String(err) });
      }
    }
    return null;
  }

  #emitStructState(scope) {
    const value = this.#captureStructState(scope);
    if (!value) return;
    if (scope === 'mjVisual') {
      this.visualState = value;
    } else if (scope === 'mjStatistic') {
      this.statisticState = value;
    }
    this.#emitMessage({ kind: 'struct_state', scope, value });
  }

  #captureBounds() {
    try {
      if (!this.sim) return { center: [0, 0, 0], radius: 0 };
      const ngeom = this.sim.ngeom?.() | 0;
      if (!(ngeom > 0)) return { center: [0, 0, 0], radius: 0 };
      const posView = this.sim.geomXposView?.();
      if (!posView) return { center: [0, 0, 0], radius: 0 };
      return this.#computeBoundsFromPositions(posView, ngeom);
    } catch {
      return { center: [0, 0, 0], radius: 0 };
    }
  }

  #resetHistory() {
    const capacity = Math.max(0, this.historyConfig.capacity | 0);
    const captureHz = Math.max(1, Number(this.historyConfig.captureHz) || HISTORY_DEFAULT_CAPTURE_HZ);
    const stateSize = typeof this.sim?.stateSize === 'function'
      ? (this.sim.stateSize(this.historyConfig.stateSig) | 0)
      : 0;
    if (!(capacity > 0) || !(stateSize > 0)) {
      this.history = {
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
    this.history = {
      enabled: true,
      captureHz,
      capacity,
      captureIntervalMs: 1000 / captureHz,
      stateSize,
      stateSig: this.historyConfig.stateSig,
      samples: Array.from({ length: capacity }, () => new Float64Array(stateSize)),
      head: 0,
      count: 0,
      lastCaptureTs: 0,
      scrubIndex: 0,
      scrubActive: false,
      resumeRun: true,
    };
  }

  #serializeHistoryMeta() {
    if (!this.history) {
      return {
        captureHz: this.historyConfig.captureHz || HISTORY_DEFAULT_CAPTURE_HZ,
        capacity: this.historyConfig.capacity || HISTORY_DEFAULT_CAPACITY,
        count: 0,
        horizon: 0,
        scrubIndex: 0,
        live: true,
      };
    }
    const captureHz = this.history.captureHz || HISTORY_DEFAULT_CAPTURE_HZ;
    const horizon = captureHz > 0 ? this.history.count / captureHz : 0;
    return {
      captureHz,
      capacity: this.history.capacity || this.historyConfig.capacity,
      count: this.history.count || 0,
      horizon,
      scrubIndex: this.history.scrubIndex || 0,
      live: this.history.scrubActive !== true,
    };
  }

  #emitHistoryMeta() {
    this.#emitMessage({ kind: 'history', ...this.#serializeHistoryMeta(), keyIndex: this.keySliderIndex });
  }

  #captureHistorySample(force = false) {
    if (!this.history || !this.history.enabled || !this.sim) return;
    if (!(this.history.samples?.length > 0)) return;
    if (!force && (!this.running || this.history.scrubActive)) return;
    const now = performance.now();
    if (!force && this.history.captureIntervalMs > 0) {
      if ((now - this.history.lastCaptureTs) < this.history.captureIntervalMs) return;
    }
    this.history.lastCaptureTs = now;
    const slot = this.history.samples[this.history.head];
    if (!slot) return;
    this.sim.captureState?.(slot, this.history.stateSig || MJ_STATE_SIG);
    this.history.head = (this.history.head + 1) % this.history.capacity;
    this.history.count = Math.min(this.history.count + 1, this.history.capacity);
  }

  #setRunning(run, source = 'backend', notify = true) {
    const target = !!run;
    const changed = this.running !== target;
    this.running = target;
    if (notify && changed) {
      this.#emitMessage({ kind: 'run_state', running: target, source });
    }
  }

  #releaseHistoryScrub() {
    if (!this.history) return;
    this.history.scrubIndex = 0;
    if (this.history.scrubActive) {
      this.history.scrubActive = false;
      const resume = this.history.resumeRun;
      this.history.resumeRun = true;
      this.#setRunning(resume, 'history');
    }
  }

  #loadHistoryOffset(offset) {
    if (!this.history || !(this.history.count > 0) || !this.sim) {
      this.#releaseHistoryScrub();
      return false;
    }
    if (!(Number.isFinite(offset)) || offset >= 0) {
      this.#releaseHistoryScrub();
      return true;
    }
    const steps = Math.min(this.history.count, Math.abs(offset));
    if (!(steps > 0)) {
      this.#releaseHistoryScrub();
      return false;
    }
    const idx = (this.history.head - steps + this.history.capacity) % this.history.capacity;
    const slot = this.history.samples[idx];
    if (!slot) return false;
    const applied = this.sim.applyState?.(slot, this.history.stateSig || MJ_STATE_SIG);
    if (!applied) return false;
    this.history.scrubIndex = -steps;
    if (!this.history.scrubActive) {
      this.history.scrubActive = true;
      this.history.resumeRun = this.running;
    }
    this.#setRunning(false, 'history');
    return true;
  }

  #applyHistoryConfig(partial = {}) {
    const next = { ...this.historyConfig };
    if (partial.captureHz !== undefined) {
      const hz = Number(partial.captureHz);
      if (Number.isFinite(hz) && hz > 0) {
        next.captureHz = Math.max(5, Math.min(240, Math.round(hz)));
      }
    }
    if (partial.capacity !== undefined) {
      const cap = Number(partial.capacity);
      if (Number.isFinite(cap) && cap > 0) {
        next.capacity = Math.max(32, Math.min(3600, Math.round(cap)));
      }
    }
    this.historyConfig = next;
    this.#resetHistory();
    this.#emitHistoryMeta();
  }

  #resetKeyframes() {
    const stateSig = this.historyConfig?.stateSig || MJ_STATE_SIG;
    const stateSize = typeof this.sim?.stateSize === 'function' ? (this.sim.stateSize(stateSig) | 0) : 0;
    const nativeCount = typeof this.sim?.nkey === 'function' ? (this.sim.nkey() | 0) : 0;
    const totalSlots = nativeCount + KEYFRAME_USER_SLOTS;
    const slots = Array.from({ length: totalSlots }, (_, idx) => ({
      label: idx < nativeCount ? `XML Key ${idx}` : `User Slot ${idx - nativeCount + 1}`,
      kind: idx < nativeCount ? 'xml' : 'user',
      available: false,
      state: stateSize > 0 ? new Float64Array(stateSize) : null,
    }));
    this.keyframes = {
      stateSize,
      stateSig,
      slots,
      nativeCount,
      lastSaved: -1,
      lastLoaded: -1,
    };
    const captureState = typeof this.sim?.captureState === 'function' ? this.sim.captureState.bind(this.sim) : null;
    const applyState = typeof this.sim?.applyState === 'function' ? this.sim.applyState.bind(this.sim) : null;
    if (captureState && applyState && stateSize > 0 && slots.length) {
      const restore = captureState(null, stateSig);
      if (nativeCount > 0 && typeof this.sim.resetKeyframe === 'function') {
        for (let i = 0; i < nativeCount; i += 1) {
          const slot = slots[i];
          const ok = this.sim.resetKeyframe(i);
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
    if (slots.length > 0) {
      this.keySliderIndex = Math.max(0, Math.min(this.keySliderIndex ?? 0, slots.length - 1));
    } else {
      this.keySliderIndex = -1;
    }
    this.#emitKeyframeMeta();
  }

  #serializeKeyframes() {
    if (!this.keyframes) {
      return { capacity: 0, count: 0, labels: [], slots: [], lastSaved: -1, lastLoaded: -1 };
    }
    const slots = Array.isArray(this.keyframes.slots) ? this.keyframes.slots : [];
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
      lastSaved: this.keyframes.lastSaved ?? -1,
      lastLoaded: this.keyframes.lastLoaded ?? -1,
    };
  }

  #emitKeyframeMeta() {
    this.#emitMessage({ kind: 'keyframes', ...this.#serializeKeyframes(), keyIndex: this.keySliderIndex });
  }

  #ensureKeyframeSlot(index) {
    if (!this.keyframes || !Array.isArray(this.keyframes.slots)) return null;
    const slots = this.keyframes.slots;
    if (!slots.length) return null;
    const target = Math.max(0, Math.min(index, slots.length - 1));
    const slot = slots[target];
    if (slot && !slot.state && (this.keyframes.stateSize | 0) > 0) {
      slot.state = new Float64Array(this.keyframes.stateSize | 0);
    }
    return slot;
  }

  #saveKeyframe(requestedIndex) {
    if (!this.keyframes || !this.sim) return -1;
    const slots = this.keyframes.slots || [];
    if (!slots.length) return -1;
    const target = Math.max(0, Math.min(Number.isFinite(requestedIndex) && requestedIndex >= 0
      ? requestedIndex | 0
      : (this.keySliderIndex | 0), slots.length - 1));
    const slot = this.#ensureKeyframeSlot(target);
    if (!slot || !slot.state) return -1;
    if (typeof this.sim.captureState !== 'function') return -1;
    this.sim.captureState(slot.state, this.keyframes.stateSig || MJ_STATE_SIG);
    slot.available = true;
    this.keyframes.lastSaved = target;
    this.#emitKeyframeMeta();
    return target;
  }

  #loadKeyframe(index) {
    if (!this.keyframes || !this.sim) return false;
    const slots = this.keyframes.slots || [];
    if (!slots.length) return false;
    const target = Math.max(0, Math.min(index | 0, slots.length - 1));
    const slot = slots[target];
    if (!slot || !slot.state || !slot.available) return false;
    if (typeof this.sim.applyState !== 'function') return false;
    const ok = this.sim.applyState(slot.state, this.keyframes.stateSig || MJ_STATE_SIG);
    if (!ok) return false;
    this.keyframes.lastLoaded = target;
    this.#emitKeyframeMeta();
    this.#releaseHistoryScrub();
    return true;
  }

  #resetWatch() {
    this.watch = {
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

  #resolveWatchField(field) {
    const token = String(field || '').trim().toLowerCase();
    if (WATCH_FIELDS.includes(token)) return token;
    if (token === 'xipos' || token === 'body_xipos') return 'body_xpos';
    return null;
  }

  #updateWatchTarget(field, index, emit = false) {
    if (!this.watch) this.#resetWatch();
    if (typeof field === 'string') {
      this.watch.field = field.trim();
    }
    if (Number.isFinite(index)) {
      this.watch.index = Math.max(0, index | 0);
    }
    this.watch.value = null;
    this.watch.min = null;
    this.watch.max = null;
    this.watch.samples = 0;
    this.watch.status = 'pending';
    this.watch.valid = false;
    if (emit) this.#emitWatchState();
  }

  #readWatchView(field) {
    const token = this.#resolveWatchField(field) || 'qpos';
    switch (token) {
      case 'xpos':
        return this.sim?.geomXposView?.();
      case 'xmat':
        return this.sim?.geomXmatView?.();
      case 'body_xpos':
        return this.sim?.bodyXposView?.();
      case 'body_xmat':
        return this.sim?.bodyXmatView?.();
      case 'qvel':
        return this.sim?.qvelView?.();
      case 'ctrl':
        return this.sim?.ctrlView?.();
      case 'sensordata':
        return this.sim?.sensordataView?.();
      default:
        return this.sim?.qposView?.();
    }
  }

  #sampleWatch() {
    if (!this.watch || !this.sim) return null;
    const resolved = this.#resolveWatchField(this.watch.field);
    const view = this.#readWatchView(resolved || this.watch.field);
    const idx = this.watch.index | 0;
    if (view && idx >= 0 && idx < view.length) {
      const val = Number(view[idx]) || 0;
      this.watch.value = val;
      this.watch.min = this.watch.min == null ? val : Math.min(this.watch.min, val);
      this.watch.max = this.watch.max == null ? val : Math.max(this.watch.max, val);
      this.watch.samples += 1;
      this.watch.status = 'ok';
      this.watch.valid = true;
    } else {
      this.watch.value = null;
      this.watch.status = 'invalid';
      this.watch.valid = false;
    }
    return {
      field: this.watch.field,
      resolved: resolved || 'qpos',
      index: this.watch.index,
      value: this.watch.value,
      min: this.watch.min,
      max: this.watch.max,
      samples: this.watch.samples,
      status: this.watch.status,
      valid: !!this.watch.valid,
      summary:
        this.watch.valid && typeof this.watch.value === 'number'
          ? `${(resolved || this.watch.field || 'qpos')}[${this.watch.index}] = ${this.watch.value}`
          : 'n/a',
    };
  }

  #emitWatchState() {
    const payload = this.#sampleWatch();
    if (!payload) return;
    this.#emitMessage({ kind: 'watch', ...payload });
  }

  #collectWatchSources() {
    const sources = {};
    const add = (id, length, label) => {
      if (Number.isFinite(length) && length > 0) {
        sources[id] = {
          length,
          label: label || id,
        };
      }
    };
    const nq = this.sim?.nq?.() | 0;
    const nv = this.sim?.nv?.() | 0;
    const nuLocal = this.sim?.nu?.() | 0;
    let nsens = 0;
    try {
      nsens = this.sim?.nsensordata?.() | 0;
    } catch {}
    const ngeom = this.sim?.ngeom?.() | 0;
    const nbody = this.sim?.nbody?.() | 0;
    add('qpos', nq, `qpos (${nq})`);
    add('qvel', nv, `qvel (${nv})`);
    add('ctrl', nuLocal, `ctrl (${nuLocal})`);
    add('sensordata', nsens, `sensordata (${nsens})`);
    add('xpos', ngeom * 3, `geom xpos (${ngeom}x3)`);
    add('xmat', ngeom * 9, `geom xmat (${ngeom}x9)`);
    add('body_xpos', nbody * 3, `body xpos (${nbody}x3)`);
    add('body_xmat', nbody * 9, `body xmat (${nbody}x9)`);
    return sources;
  }

  #collectCameraMeta() {
    if (!this.sim || !this.mod) return [];
    const count = typeof this.sim.ncam === 'function' ? (this.sim.ncam() | 0) : 0;
    if (!(count > 0)) return [];
    const readFloat = (field, stride = 1) => {
      if (typeof this.sim._readModelPtr !== 'function') return null;
      const ptr = this.sim._readModelPtr(field);
      if (!ptr) return null;
      const len = stride * count;
      if (!(len > 0)) return null;
      const view = heapViewF64(this.mod, ptr, len);
      if (!view) return null;
      return Array.from(view);
    };
    const readInt = (field) => {
      if (typeof this.sim._readModelPtr !== 'function') return null;
      const ptr = this.sim._readModelPtr(field);
      if (!ptr) return null;
      const len = count;
      const view = heapViewI32(this.mod, ptr, len);
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
    const cameras = [];
    for (let i = 0; i < count; i += 1) {
      const entry = {
        index: i,
        name: typeof this.sim.cameraNameOf === 'function' ? this.sim.cameraNameOf(i) || `Camera ${i + 1}` : `Camera ${i + 1}`,
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

  #emitCameraMeta() {
    try {
      const cameras = this.#collectCameraMeta();
      this.cameraList = cameras;
      this.#emitMessage({ kind: 'meta_cameras', cameras });
    } catch (err) {
      this.#emitLog('direct: camera meta failed', { error: String(err) });
    }
  }

  #collectGeomMeta() {
    const count = this.sim?.ngeom?.() | 0;
    const geoms = [];
    if (!(count > 0) || !this.sim) return geoms;
    for (let i = 0; i < count; i += 1) {
      const name =
        typeof this.sim.geomNameOf === 'function'
          ? this.sim.geomNameOf(i) || `Geom ${i}`
          : `Geom ${i}`;
      geoms.push({ index: i, name });
    }
    return geoms;
  }

  #emitGeomMeta() {
    try {
      const geoms = this.#collectGeomMeta();
      this.geomList = geoms;
      this.#emitMessage({ kind: 'meta_geoms', geoms });
    } catch (err) {
      this.#emitLog('direct: geom meta failed', { error: String(err) });
    }
  }

  #captureCopyState(precision) {
    const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    const nq = this.sim?.nq?.() | 0;
    const nv = this.sim?.nv?.() | 0;
    const qposView = this.sim?.qposView?.();
    const qvelView = this.sim?.qvelView?.();
    const previewLenQ = precision === 'full' ? nq : Math.min(nq, 8);
    const previewLenV = precision === 'full' ? nv : Math.min(nv, 8);
    const payload = {
      kind: 'copyState',
      seq: ++this.copySeq,
      precision,
      nq,
      nv,
      timestamp: now,
      tSim: this.sim?.time?.() || 0,
      qposPreview: [],
      qvelPreview: [],
      complete: false,
    };
    if (qposView) {
      for (let i = 0; i < previewLenQ; i++) {
        payload.qposPreview.push(Number(qposView[i]) || 0);
      }
      if (precision === 'full' && nq <= 128) {
        payload.qpos = Array.from(qposView);
        payload.complete = true;
      }
    }
    if (qvelView) {
      for (let i = 0; i < previewLenV; i++) {
        payload.qvelPreview.push(Number(qvelView[i]) || 0);
      }
      if (precision === 'full' && nv <= 128) {
        payload.qvel = Array.from(qvelView);
        payload.complete = payload.complete && nv <= 128;
      }
    }
    return payload;
  }

  addEventListener(type, handler) {
    if (this.listeners[type]) this.listeners[type].add(handler);
  }

  removeEventListener(type, handler) {
    if (this.listeners[type]) this.listeners[type].delete(handler);
  }

  postMessage(message) {
    this.pending = this.pending.then(() => this.#handleCommand(message)).catch((err) => {
      this.#emitError(err);
    });
  }

  terminate() {
    this.#setRunning(false, 'terminate');
    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
    if (this.snapshotTimer) {
      clearInterval(this.snapshotTimer);
      this.snapshotTimer = null;
    }
    try {
      if (this.sim) {
        this.sim.term?.();
      } else if (this.mod && this.handle) {
        try { this.mod.ccall?.('mjwf_free', null, ['number'], [this.handle]); } catch {}
      }
    } catch {}
    this.handle = 0;
    this.sim = null;
    this.mod = null;
    this.renderAssets = null;
  }

  async #handleCommand(msg) {
    if (!msg || typeof msg !== 'object') return;
    switch (msg.cmd) {
      case 'load': {
        await this.#handleLoad(msg);
        break;
      }
      case 'reset': {
        if (this.sim) {
          const ok = this.sim.reset?.();
          if (ok) {
            this.#resetHistory();
            this.#captureHistorySample(true);
            this.#emitHistoryMeta();
            this.#snapshot();
          }
        }
        break;
      }
      case 'step': {
        if (this.sim) {
          try {
            const n = Math.max(1, Math.min(10000, (msg.n | 0) || 1));
            this.sim.step?.(n);
            this.#snapshot();
          } catch (err) {
            this.#emitError(err);
          }
        }
        break;
      }
      case 'gesture': {
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
        this.gesture = {
          mode: phase === 'end' ? 'idle' : (mode ?? this.gesture.mode ?? 'idle'),
          phase: phase ?? this.gesture.phase ?? 'update',
          pointer,
        };
        if (dragSource) {
          this.drag = {
            dx: Number(dragSource.dx) || 0,
            dy: Number(dragSource.dy) || 0,
          };
        } else if (this.gesture.phase === 'end') {
          this.drag = { dx: 0, dy: 0 };
        }
        this.#emitMessage({ kind: 'gesture', gesture: this.gesture, drag: this.drag });
        break;
      }
      case 'setVoptFlag': {
        const idx = Number(msg.index) | 0;
        const enabled = !!msg.enabled;
        if (!Array.isArray(this.voptFlags)) this.voptFlags = Array.from({ length: 32 }, () => 0);
        if (idx >= 0 && idx < this.voptFlags.length) {
          this.voptFlags[idx] = enabled ? 1 : 0;
          this.#emitOptions();
        }
        break;
      }
      case 'setSceneFlag': {
        const idx = Number(msg.index) | 0;
        const enabled = !!msg.enabled;
        if (!Array.isArray(this.sceneFlags) || this.sceneFlags.length !== SCENE_FLAG_DEFAULTS.length) {
          this.sceneFlags = SCENE_FLAG_DEFAULTS.slice();
        }
        if (idx >= 0 && idx < this.sceneFlags.length) {
          this.sceneFlags[idx] = enabled ? 1 : 0;
          this.#emitOptions();
        }
        break;
      }
      case 'setLabelMode': {
        const mode = Number(msg.mode) || 0;
        this.labelMode = mode | 0;
        this.#emitOptions();
        break;
      }
      case 'setFrameMode': {
        const mode = Number(msg.mode) || 0;
        this.frameMode = mode | 0;
        this.#emitOptions();
        break;
      }
      case 'setCameraMode': {
        const mode = Number(msg.mode) || 0;
        this.cameraMode = mode | 0;
        this.#emitOptions();
        break;
      }
      case 'setGroupState': {
        const type = typeof msg.group === 'string' ? msg.group.toLowerCase() : '';
        const idx = Number(msg.index) | 0;
        const enabled = !!msg.enabled;
        if (GROUP_TYPES.includes(type) && idx >= 0 && idx < MJ_GROUP_COUNT) {
          if (!this.groupState[type]) {
            this.groupState[type] = Array.from({ length: MJ_GROUP_COUNT }, () => 1);
          }
          this.groupState[type][idx] = enabled ? 1 : 0;
          this.#emitOptions();
        }
        break;
      }
      case 'historyScrub': {
        const offset = Number(msg.offset) || 0;
        if (offset < 0) {
          this.#loadHistoryOffset(offset);
        } else {
          this.#releaseHistoryScrub();
        }
        this.#emitHistoryMeta();
        break;
      }
      case 'historyConfig': {
        this.#applyHistoryConfig({ captureHz: msg.captureHz, capacity: msg.capacity });
        break;
      }
      case 'keyframeSave': {
        const used = this.#saveKeyframe(Number(msg.index));
        if (used >= 0) {
          this.keySliderIndex = used;
        }
        break;
      }
      case 'keyframeLoad': {
        const idx = Math.max(0, Number(msg.index) | 0);
        if (this.#loadKeyframe(idx)) {
          this.keySliderIndex = idx;
        }
        break;
      }
      case 'keyframeSelect': {
        const idx = Math.max(0, Number(msg.index) | 0);
        if (this.keyframes?.slots?.length) {
          this.keySliderIndex = Math.min(idx, this.keyframes.slots.length - 1);
          this.#emitKeyframeMeta();
        } else {
          this.keySliderIndex = idx;
        }
        break;
      }
      case 'setWatch': {
        this.#updateWatchTarget(msg.field, msg.index, true);
        break;
      }
      case 'setField': {
        if (msg.target === 'mjOption') {
          try {
            const ok = writeOptionField(this.mod, this.handle | 0, Array.isArray(msg.path) ? msg.path : [], msg.kind, msg.value);
            if (ok) {
              this.#snapshot();
            } else if (this.debug) {
              this.#emitLog('direct: setField (mjOption) unsupported', { path: msg.path });
            }
          } catch (err) {
            this.#emitError(err);
          }
        } else if (msg.target === 'mjVisual') {
          try {
            const ok = writeVisualField(this.mod, this.handle | 0, Array.isArray(msg.path) ? msg.path : [], msg.kind, msg.value, msg.size);
            if (ok) {
              this.#emitStructState('mjVisual');
            } else if (this.debug) {
              this.#emitLog('direct: setField (mjVisual) unsupported', { path: msg.path });
            }
          } catch (err) {
            this.#emitError(err);
          }
        } else if (msg.target === 'mjStatistic') {
          try {
            const ok = writeStatisticField(this.mod, this.handle | 0, Array.isArray(msg.path) ? msg.path : [], msg.kind, msg.value, msg.size);
            if (ok) {
              this.#emitStructState('mjStatistic');
            } else if (this.debug) {
              this.#emitLog('direct: setField (mjStatistic) unsupported', { path: msg.path });
            }
          } catch (err) {
            this.#emitError(err);
          }
        }
        break;
      }
      case 'align': {
        const info = this.#captureBounds();
        this.lastBounds = info;
        const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
        this.#emitMessage({
          kind: 'align',
          seq: ++this.alignSeq,
          center: info.center,
          radius: info.radius,
          timestamp: now,
          source: msg.source || 'backend',
        });
        break;
      }
      case 'copyState': {
        const precision = msg.precision === 'full' ? 'full' : 'standard';
        const payload = this.#captureCopyState(precision);
        payload.source = msg.source || 'backend';
        this.#emitMessage(payload);
        break;
      }
      case 'setCtrl': {
        const idx = msg.index | 0;
        const value = +msg.value || 0;
        this.pendingCtrl.set(idx, value);
        break;
      }
      case 'setRate': {
        const r = +msg.rate;
        if (Number.isFinite(r) && r > 0) this.rate = Math.max(0.0625, Math.min(16, r));
        break;
      }
      case 'setPaused': {
        const nextRunning = !msg.paused;
        this.#setRunning(nextRunning, msg.source || 'ui');
        if (!nextRunning && this.history) {
          this.history.resumeRun = false;
        } else if (nextRunning && this.history?.scrubActive) {
          this.#releaseHistoryScrub();
          this.#emitHistoryMeta();
        }
        break;
      }
      case 'applyForce': {
        if (this.sim && typeof this.sim.applyXfrcByGeom === 'function') {
          try {
            this.sim.applyXfrcByGeom(
              msg.geomIndex | 0,
              msg.force || [0, 0, 0],
              msg.torque || [0, 0, 0],
              msg.point || [0, 0, 0],
            );
          } catch (err) {
            this.#emitError(err);
          }
        }
        break;
      }
      case 'applyBodyForce': {
        if (this.sim && typeof this.sim.applyXfrcByBody === 'function') {
          try {
            this.sim.applyXfrcByBody(
              msg.bodyId | 0,
              msg.force || [0, 0, 0],
              msg.torque || [0, 0, 0],
            );
          } catch (err) {
            this.#emitError(err);
          }
        }
        break;
      }
      case 'clearForces': {
        try {
          this.sim?.clearAllXfrc?.();
        } catch (err) {
          if (this.debug) this.#emitLog('direct: clearForces failed', String(err));
        }
        break;
      }
      case 'snapshot': {
        this.#snapshot();
        break;
      }
      default:
        break;
    }
  }

  async #handleLoad(msg) {
    await this.#ensureModule();
    if (!this.sim) {
      throw new Error('Direct backend module not ready');
    }
    this.optionSupport = detectOptionSupport(this.mod);
    // Dispose previous state
    try {
      if (this.sim && this.sim.h) {
        this.sim.term?.();
        this.sim.h = 0;
      }
    } catch {}

    if (this.snapshotState) {
      this.snapshotState.frame = 0;
      this.snapshotState.lastSim = null;
    }
    this.frameSeq = 0;

    let xmlText = String(msg.xmlText || '');
    if (!xmlText) xmlText = await this.#fallbackXml();

    let loaded = this.#initSimFromXml(xmlText, 'primary');
    if (!loaded) {
      const demo = await this.#fallbackXml(true);
      loaded = this.#initSimFromXml(demo, 'demo');
    }
    if (!loaded) {
      const empty = await this.#fallbackXml(false);
      loaded = this.#initSimFromXml(empty, 'empty');
    }
    if (!loaded) {
      const info = readErrno(this.mod);
      this.#emitLog('direct: make_from_xml failed', { errno: info.eno, errmsg: info.emsg });
      throw new Error('make_from_xml failed');
    }

    this.handle = this.sim.h | 0;
    if (!(this.handle > 0)) {
      const info = readErrno(this.mod);
      throw new Error(`Direct backend handle invalid (errno=${info.eno} errmsg=${info.emsg})`);
    }

    this.dt = this.sim.timestep?.() || 0.002;
    this.rate = typeof msg.rate === 'number' ? msg.rate : 1.0;
    this.#setRunning(true, 'load');
    this.lastSimNow = performance.now();
    this.visualState = this.#captureStructState('mjVisual');
    this.statisticState = this.#captureStructState('mjStatistic');
    this.#resetHistory();
    this.#resetKeyframes();
    this.#resetWatch();
    this.keySliderIndex = -1;
    this.#captureHistorySample(true);
    this.#emitHistoryMeta();
    this.#emitKeyframeMeta();
    this.#emitWatchState();

    const abi = this.#readAbi();
    this.#emitLog('direct: forge module ready', {
      hasMake: typeof this.mod?._mjwf_helper_make_from_xml === 'function',
      hasCcall: typeof this.mod?.ccall === 'function',
    });
    this.voptFlags = Array.from({ length: 32 }, () => 0);
    this.sceneFlags = SCENE_FLAG_DEFAULTS.slice();
    this.labelMode = 0;
    this.frameMode = 0;
    this.cameraMode = 0;
    this.#emitMessage({
      kind: 'ready',
      abi,
      dt: this.dt,
      ngeom: this.sim.ngeom?.() | 0,
      optionSupport: this.optionSupport,
      visual: this.visualState || null,
      statistic: this.statisticState || null,
    });
    this.#emitOptions();
    this.#snapshot();
    this.#emitRenderAssets();

    this.#sendMeta();
    this.#emitCameraMeta();
    this.#emitGeomMeta();

    this.#startLoops();
  }

  async #ensureModule() {
    if (this.mod && this.sim) return;
    try {
      this.mod = await this.#loadForgeModule();
      this.sim = new MjSimLite(this.mod);
      await this.sim.maybeInstallShimFromQuery?.();
    } catch (err) {
      this.#emitError(err);
      this.mod = createLocalModule();
      this.sim = new MjSimLite(this.mod);
    }
  }

  async #loadForgeModule() {
    if (this.mod) return this.mod;
    const distBase = getForgeDistBase(this.ver);
    let vTag = '';
    try {
      const info = await getVersionInfo(distBase);
      if (info) {
        const raw = String(info.sha256 || info.git_sha || info.mujoco_git_sha || '');
        vTag = raw.slice(0, 8);
      }
    } catch {}
    const distUrl = new URL(distBase, location.href);
    const jsHref = withCacheTag(new URL('mujoco.js', distUrl).href, vTag);
    const wasmHref = withCacheTag(new URL('mujoco.wasm', distUrl).href, vTag);
    let loader;
    try {
      loader = await import(/* @vite-ignore */ jsHref);
    } catch (err) {
      this.#emitLog('direct: forge loader import failed, using local shim', { error: String(err) });
      const modLocal = createLocalModule();
      try { installForgeAbiCompat(modLocal); } catch {}
      return modLocal;
    }
    const loadMuJoCo = loader?.default;
    if (typeof loadMuJoCo !== 'function') {
      throw new Error('Forge loader missing default export');
    }
    const module = await loadMuJoCo({
      locateFile: (path) => (path.endsWith('.wasm') ? wasmHref : path),
    });
    try { installForgeAbiCompat(module); } catch {}
    return module;
  }

  async #fallbackXml(isDemo) {
    if (isDemo) {
      try {
        const demoUrl = new URL('./demo_box.xml', import.meta.url);
        const res = await fetch(demoUrl);
        if (res.ok) return await res.text();
      } catch {}
    }
    const empty = `<?xml version='1.0'?>\n<mujoco model='empty'><option timestep='0.002'/><worldbody/></mujoco>`;
    return empty;
  }

  #initSimFromXml(xmlText, stage) {
    if (!xmlText) return false;
    try {
      this.sim.initFromXml(xmlText);
      return true;
    } catch (errPrimary) {
      this.#emitLog(`direct: initFromXml failed (${stage})`, { error: String(errPrimary || '') });
      try {
        if (typeof this.sim.initFromXmlStrict === 'function') {
          this.sim.initFromXmlStrict(xmlText);
          return true;
        }
      } catch (errStrict) {
        this.#emitLog(`direct: initFromXmlStrict failed (${stage})`, { error: String(errStrict || '') });
      }
    }
    return false;
  }

  #startLoops() {
    if (this.tickTimer) clearInterval(this.tickTimer);
    if (this.snapshotTimer) clearInterval(this.snapshotTimer);
    this.tickTimer = setInterval(() => this.#tick(), TICK_INTERVAL_MS);
    this.snapshotTimer = setInterval(() => this.#snapshot(), SNAP_INTERVAL_MS);
  }

  #tick() {
    if (!this.mod || !this.sim || !(this.handle > 0) || !this.running) return;
    try {
      if (this.pendingCtrl.size) {
        const ctrlView = this.sim.ctrlView?.();
        const range = this.sim.actuatorCtrlRangeView?.();
        if (ctrlView) {
          for (const [idx, value] of this.pendingCtrl.entries()) {
            let v = +value || 0;
            if (range && (2 * idx + 1) < range.length) {
              const lo = +range[2 * idx];
              const hi = +range[2 * idx + 1];
              const valid = Number.isFinite(lo) && Number.isFinite(hi) && (hi - lo) > 1e-12;
              if (valid) v = Math.max(Math.min(hi, v), lo);
            }
            ctrlView[idx | 0] = v;
          }
        }
        this.pendingCtrl.clear();
      }
    } catch {}

    const now = performance.now();
    let acc = Math.min(0.1, (now - this.lastSimNow) / 1000) * this.rate;
    this.lastSimNow = now;
    let guard = 0;
    const dt = this.dt || 0.002;
    while (acc >= dt && guard < 1000) {
      try {
        this.sim.step?.(1);
      } catch (err) {
        this.#emitError(err);
        break;
      }
      acc -= dt;
      guard++;
    }
  }

  #snapshot() {
    if (!this.mod || !this.sim || !(this.handle > 0)) return;
    try {
      const ngeom = this.sim.ngeom?.() | 0;
      this.#captureHistorySample();
      if (!(ngeom > 0)) {
        this.lastBounds = { center: [0, 0, 0], radius: 0 };
      }
      let xpos = new Float64Array(0);
      let xmat = new Float64Array(0);
      let gsize = null;
      let gtype = null;
      let gmatid = null;
      let gdataid = null;
      let matrgba = null;
      if (ngeom > 0) {
        const posView = this.sim.geomXposView?.();
        const matView = this.sim.geomXmatView?.();
        if (posView) xpos = cloneArray(posView, Float64Array) || new Float64Array(posView);
        if (matView) xmat = cloneArray(matView, Float64Array) || new Float64Array(matView);
        if (posView) {
          this.lastBounds = this.#computeBoundsFromPositions(posView, ngeom);
        } else {
          this.lastBounds = { center: [0, 0, 0], radius: 0 };
        }
        const sizeView = this.sim.geomSizeView?.();
        if (sizeView) gsize = cloneArray(sizeView, Float64Array);
        const typeView = this.sim.geomTypeView?.();
        if (typeView) gtype = cloneArray(typeView, Int32Array);
        const matidView = this.sim.geomMatIdView?.();
        if (matidView) gmatid = cloneArray(matidView, Int32Array);
        const dataIdView = this.sim.geomDataidView?.();
        if (dataIdView) gdataid = cloneArray(dataIdView, Int32Array);
        const rgbaView = this.sim.matRgbaView?.();
        if (rgbaView) matrgba = cloneArray(rgbaView, Float32Array);
      }
      // Body-level pose (optional but recommended for picking/perturb)
      let bxpos = null;
      let bxmat = null;
      let xipos = null;
      try {
        const bposView = this.sim.bodyXposView?.();
        const bmatView = this.sim.bodyXmatView?.();
        const xiposView = this.sim.bodyXiposView?.();
        if (bposView) bxpos = cloneArray(bposView, Float64Array) || new Float64Array(bposView);
        if (bmatView) bxmat = cloneArray(bmatView, Float64Array) || new Float64Array(bmatView);
        if (xiposView) xipos = cloneArray(xiposView, Float64Array) || new Float64Array(xiposView);
      } catch {}

      let contacts = null;
      if (this.snapshotState) {
        this.snapshotState.lastSim = {
          frame: this.snapshotState.frame,
          ngeom,
          gtype,
          gsize,
          gmatid,
          matrgba,
          gdataid,
          xpos,
          xmat,
          bxpos,
          bxmat,
          xipos,
        };
        this.snapshotState.frame += 1;
      }
      try {
        const ncon = this.sim.ncon?.() | 0;
        if (ncon > 0) {
          contacts = { n: ncon };
          const pos = this.sim.contactPosView?.();
          if (pos) {
            contacts.pos = cloneArray(pos, Float64Array) || new Float64Array(pos);
          }
          const frame = this.sim.contactFrameView?.();
          if (frame) {
            contacts.frame = cloneArray(frame, Float64Array) || new Float64Array(frame);
          }
          const geom1 = this.sim.contactGeom1View?.();
          if (geom1) {
            contacts.geom1 = cloneArray(geom1, Int32Array) || new Int32Array(geom1);
          }
          const geom2 = this.sim.contactGeom2View?.();
          if (geom2) {
            contacts.geom2 = cloneArray(geom2, Int32Array) || new Int32Array(geom2);
          }
          const dist = this.sim.contactDistView?.();
          if (dist) {
            contacts.dist = cloneArray(dist, Float64Array) || new Float64Array(dist);
          }
          const fric = this.sim.contactFrictionView?.();
          if (fric) {
            contacts.fric = cloneArray(fric, Float64Array) || new Float64Array(fric);
          }
          try {
            const forceLocal = this.sim.contactForceBuffer?.();
            if (forceLocal instanceof Float64Array && forceLocal.length >= (3 * ncon)) {
              let forceOut = forceLocal;
              if (contacts.frame && contacts.frame.length >= (9 * ncon)) {
                forceOut = new Float64Array(forceLocal.length);
                for (let i = 0; i < ncon; i += 1) {
                  const base = 3 * i;
                  const rot = 9 * i;
                  const fx = forceLocal[base + 0] || 0;
                  const fy = forceLocal[base + 1] || 0;
                  const fz = forceLocal[base + 2] || 0;
                  const c0 = contacts.frame[rot + 0] || 0;
                  const c1 = contacts.frame[rot + 1] || 0;
                  const c2 = contacts.frame[rot + 2] || 0;
                  const c3 = contacts.frame[rot + 3] || 0;
                  const c4 = contacts.frame[rot + 4] || 0;
                  const c5 = contacts.frame[rot + 5] || 0;
                  const c6 = contacts.frame[rot + 6] || 0;
                  const c7 = contacts.frame[rot + 7] || 0;
                  const c8 = contacts.frame[rot + 8] || 0;
                  forceOut[base + 0] = c0 * fx + c3 * fy + c6 * fz;
                  forceOut[base + 1] = c1 * fx + c4 * fy + c7 * fz;
                  forceOut[base + 2] = c2 * fx + c5 * fy + c8 * fz;
                }
              }
              contacts.force = forceOut;
            }
          } catch (err) {
            this.#emitMessage({
              kind: 'log',
              message: 'direct: contact force failed',
              extra: { error: String(err?.message || err), stack: err?.stack || null },
            });
          }
        }
      } catch {}
      const gesture = this.gesture
        ? {
            mode: this.gesture.mode,
            phase: this.gesture.phase,
            pointer: this.gesture.pointer
              ? {
                  x: Number(this.gesture.pointer.x) || 0,
                  y: Number(this.gesture.pointer.y) || 0,
                  dx: Number(this.gesture.pointer.dx) || 0,
                  dy: Number(this.gesture.pointer.dy) || 0,
                  buttons: Number(this.gesture.pointer.buttons ?? 0),
                  pressure: Number(this.gesture.pointer.pressure ?? 0),
                }
              : null,
          }
        : { mode: 'idle', phase: 'idle', pointer: null };
      const drag = this.drag
        ? { dx: Number(this.drag.dx) || 0, dy: Number(this.drag.dy) || 0 }
        : { dx: 0, dy: 0 };
      const frameId = this.frameSeq++;
      const ctrlView = this.sim.ctrlView?.();
      const ctrlArray = ctrlView ? cloneArray(ctrlView, Float64Array) || new Float64Array(ctrlView) : null;
      const msg = {
        kind: 'snapshot',
        tSim: this.sim.time?.() || 0,
        ngeom,
        nq: this.sim.nq?.() | 0,
        nv: this.sim.nv?.() | 0,
        xpos,
        xmat,
        bxpos,
        bxmat,
        xipos,
        gesture,
        drag,
        voptFlags: Array.isArray(this.voptFlags) ? [...this.voptFlags] : [],
        sceneFlags: cloneSceneFlags(this.sceneFlags),
        labelMode: this.labelMode | 0,
        frameMode: this.frameMode | 0,
        cameraMode: this.cameraMode | 0,
        frameId,
        optionSupport: this.optionSupport,
        paused: !this.running,
        pausedSource: this.history?.scrubActive ? 'history' : 'backend',
        rate: this.rate,
      };
      msg.history = this.#serializeHistoryMeta();
      msg.keyframes = this.#serializeKeyframes();
      const watchPayload = this.#sampleWatch();
      if (watchPayload) msg.watch = watchPayload;
      msg.watchSources = this.#collectWatchSources();
      if (Number.isFinite(this.keySliderIndex)) {
        msg.keyIndex = this.keySliderIndex | 0;
      }
      const optionsStruct = this.optionSupport.supported ? readOptionStruct(this.mod, this.handle | 0) : null;
    if (optionsStruct) {
      msg.options = optionsStruct;
    }
    if (ctrlArray) {
      msg.ctrl = ctrlArray;
      if (this.debug && !this._loggedCtrlSample) {
        this._loggedCtrlSample = true;
        try {
          const sample = Array.from(ctrlArray.slice(0, Math.min(4, ctrlArray.length)));
          this.#emitMessage({ kind: 'log', message: 'direct: ctrl sample', extra: { len: ctrlArray.length, sample } });
        } catch {}
      }
    }
      if (gsize) msg.gsize = gsize;
      if (gtype) msg.gtype = gtype;
      if (gmatid) msg.gmatid = gmatid;
      if (gdataid) msg.gdataid = gdataid;
      if (matrgba) msg.matrgba = matrgba;
      if (contacts) msg.contacts = contacts;
      this.#emitMessage(msg);
    } catch (err) {
      this.#emitError(err);
    }
  }

  #sendMeta() {
    if (!this.mod || !this.sim || !(this.handle > 0)) return;
    const ngeom = this.sim.ngeom?.() | 0;
    const msgActs = { kind: 'meta', actuators: [] };
    try {
      const nu = this.sim.nu?.() | 0;
      if (nu > 0) {
        const rng = this.sim.actuatorCtrlRangeView?.();
        const acts = [];
        for (let i = 0; i < nu; i++) {
          const name = this.sim.actuatorNameOf?.(i) || `act ${i}`;
          const rawLo = rng ? (+rng[2 * i]) : NaN;
          const rawHi = rng ? (+rng[2 * i + 1]) : NaN;
          const valid = Number.isFinite(rawLo) && Number.isFinite(rawHi) && (rawHi - rawLo) > 1e-12;
          acts.push({
            index: i,
            name,
            min: valid ? rawLo : -1,
            max: valid ? rawHi : 1,
            step: 0.001,
            value: 0,
          });
        }
        msgActs.actuators = acts;
      }
    } catch {}
    this.#emitMessage(msgActs);

    try {
      const mod = this.mod;
      const h = this.handle | 0;
      const njnt = typeof mod._mjwf_model_njnt === 'function' ? (mod._mjwf_model_njnt(h) | 0) : 0;
      const gbidPtr = typeof mod._mjwf_model_geom_bodyid_ptr === 'function' ? (mod._mjwf_model_geom_bodyid_ptr(h) | 0) : 0;
      const bjadrPtr = typeof mod._mjwf_model_body_jntadr_ptr === 'function' ? (mod._mjwf_model_body_jntadr_ptr(h) | 0) : 0;
      const bjnumPtr = typeof mod._mjwf_model_body_jntnum_ptr === 'function' ? (mod._mjwf_model_body_jntnum_ptr(h) | 0) : 0;
      const jtypePtr = typeof mod._mjwf_model_jnt_type_ptr === 'function' ? (mod._mjwf_model_jnt_type_ptr(h) | 0) : 0;
      const out = { kind: 'meta_joints', ngeom, njnt };
      if (ngeom > 0 && gbidPtr) out.geom_bodyid = cloneArray(getView(mod, gbidPtr, 'i32', ngeom), Int32Array);
      const nbody = typeof mod._mjwf_model_nbody === 'function' ? (mod._mjwf_model_nbody(h) | 0) : 0;
      if (nbody > 0) out.nbody = nbody;
      if (nbody > 0 && bjadrPtr) out.body_jntadr = cloneArray(getView(mod, bjadrPtr, 'i32', nbody), Int32Array);
      if (nbody > 0 && bjnumPtr) out.body_jntnum = cloneArray(getView(mod, bjnumPtr, 'i32', nbody), Int32Array);
      if (njnt > 0 && jtypePtr) out.jtype = cloneArray(getView(mod, jtypePtr, 'i32', njnt), Int32Array);
      this.#emitMessage(out);
    } catch {}
  }

  #readAbi() {
    try {
      if (this.mod && typeof this.mod._mjwf_abi_version === 'function') {
        return this.mod._mjwf_abi_version() | 0;
      }
    } catch {}
    return 0;
  }

  #emitLog(message, extra) {
    const payload = { kind: 'log', message };
    if (extra !== undefined) payload.extra = extra;
    this.#emitMessage(payload);
  }

  #emitOptions() {
    this.#emitMessage({
      kind: 'options',
      voptFlags: Array.isArray(this.voptFlags) ? [...this.voptFlags] : [],
      sceneFlags: cloneSceneFlags(this.sceneFlags),
      labelMode: this.labelMode | 0,
      frameMode: this.frameMode | 0,
      cameraMode: this.cameraMode | 0,
      groups: cloneGroupState(this.groupState),
    });
  }

  #emitMessage(data) {
    const evt = toEventPayload(data);
    for (const handler of this.listeners.message) {
      try { handler(evt); } catch (err) { console.error(err); }
    }
  }

  #emitError(err) {
    const info = readErrno(this.mod || {});
    const payload = {
      kind: 'error',
      message: err && err.message ? err.message : String(err),
      errno: info.eno,
      errmsg: info.emsg,
    };
    const evt = toEventPayload(payload);
    for (const handler of this.listeners.message) {
      try { handler(evt); } catch (e) { if (this.debug) console.error(e); }
    }
    const errEvt = { error: err };
    for (const handler of this.listeners.error) {
      try { handler(errEvt); } catch (e) { if (this.debug) console.error(e); }
    }
    if (this.debug) {
      console.error(err);
    }
  }
  #emitRenderAssets() {
    if (!this.sim || !(this.sim.h > 0) || typeof this.sim.collectRenderAssets !== 'function') {
      return;
    }
    try {
      const assets = this.sim.collectRenderAssets();
      if (assets) {
        this.renderAssets = assets;
        this.#emitMessage({ kind: 'render_assets', assets });
        if (this.snapshotState?.lastSim) {
          try {
            const clone = (view) => {
              if (!view) return view ?? null;
              if (typeof view.slice === 'function') return view.slice();
              try { return new view.constructor(view); } catch { return view; }
            };
            this.snapshotState.lastSim.gtype = assets.geoms?.type ? clone(assets.geoms.type) : this.snapshotState.lastSim.gtype;
            this.snapshotState.lastSim.gsize = assets.geoms?.size ? clone(assets.geoms.size) : this.snapshotState.lastSim.gsize;
            this.snapshotState.lastSim.gmatid = assets.geoms?.matid ? clone(assets.geoms.matid) : this.snapshotState.lastSim.gmatid;
            this.snapshotState.lastSim.gdataid = assets.geoms?.dataid ? clone(assets.geoms.dataid) : this.snapshotState.lastSim.gdataid;
            this.snapshotState.lastSim.matrgba = assets.materials?.rgba ? clone(assets.materials.rgba) : this.snapshotState.lastSim.matrgba;
            if (assets.textures) {
              this.snapshotState.lastSim.textures = {
                type: assets.textures.type ? clone(assets.textures.type) : null,
                width: assets.textures.width ? clone(assets.textures.width) : null,
                height: assets.textures.height ? clone(assets.textures.height) : null,
                nchannel: assets.textures.nchannel ? clone(assets.textures.nchannel) : null,
                adr: assets.textures.adr ? clone(assets.textures.adr) : null,
                colorspace: assets.textures.colorspace ? clone(assets.textures.colorspace) : null,
                data: assets.textures.data ? clone(assets.textures.data) : null,
              };
            }
            const meshSnapshot = assets.meshes
              ? {
                  vertnum: assets.meshes.vertnum ? clone(assets.meshes.vertnum) : null,
                  facenum: assets.meshes.facenum ? clone(assets.meshes.facenum) : null,
                  vertadr: assets.meshes.vertadr ? clone(assets.meshes.vertadr) : null,
                  faceadr: assets.meshes.faceadr ? clone(assets.meshes.faceadr) : null,
                  texcoordadr: assets.meshes.texcoordadr ? clone(assets.meshes.texcoordadr) : null,
                  texcoordnum: assets.meshes.texcoordnum ? clone(assets.meshes.texcoordnum) : null,
                  vert: assets.meshes.vert ? clone(assets.meshes.vert) : null,
                  face: assets.meshes.face ? clone(assets.meshes.face) : null,
                  normal: assets.meshes.normal ? clone(assets.meshes.normal) : null,
                  texcoord: assets.meshes.texcoord ? clone(assets.meshes.texcoord) : null,
                }
              : null;
            const scene = createSceneSnap({
              frame: this.snapshotState.lastSim.frame,
              ngeom: this.snapshotState.lastSim.ngeom,
              gtype: this.snapshotState.lastSim.gtype,
              gsize: this.snapshotState.lastSim.gsize,
              gmatid: this.snapshotState.lastSim.gmatid,
              matrgba: this.snapshotState.lastSim.matrgba,
              gdataid: this.snapshotState.lastSim.gdataid,
              xpos: this.snapshotState.lastSim.xpos,
              xmat: this.snapshotState.lastSim.xmat,
              mesh: meshSnapshot,
            });
            this.#emitMessage({ kind: 'scene_snapshot', source: 'sim', frame: scene.frame, snap: scene });
          } catch (err) {
            if (this.debug) {
              this.#emitLog('direct: scene snapshot failed', { error: String(err) });
            }
          }
        }
      }
    } catch (err) {
      if (this.debug) {
        this.#emitLog('direct: render asset capture failed', { error: String(err) });
      }
    }
  }
}
