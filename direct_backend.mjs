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
    this.sceneFlags = Array.from({ length: 8 }, () => 0);
    this.labelMode = 0;
    this.frameMode = 0;
    this.cameraMode = 0;
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
    this.running = false;
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
            this.#snapshot();
            this.#emitRenderAssets();
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
        if (!Array.isArray(this.sceneFlags)) this.sceneFlags = Array.from({ length: 8 }, () => 0);
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
        this.running = !msg.paused;
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
    this.running = true;
    this.lastSimNow = performance.now();
    this.visualState = this.#captureStructState('mjVisual');
    this.statisticState = this.#captureStructState('mjStatistic');

    const abi = this.#readAbi();
    this.#emitLog('direct: forge module ready', {
      hasMake: typeof this.mod?._mjwf_helper_make_from_xml === 'function',
      hasCcall: typeof this.mod?.ccall === 'function',
    });
    this.voptFlags = Array.from({ length: 32 }, () => 0);
    this.sceneFlags = Array.from({ length: 8 }, () => 0);
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
        };
        this.snapshotState.frame += 1;
      }
      try {
        const ncon = this.sim.ncon?.() | 0;
        if (ncon > 0) {
          const pos = this.sim.contactPosView?.();
          if (pos) {
            contacts = { n: ncon, pos: cloneArray(pos, Float64Array) || new Float64Array(pos) };
            const frame = this.sim.contactFrameView?.();
            if (frame) contacts.frame = cloneArray(frame, Float64Array) || new Float64Array(frame);
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
        gesture,
        drag,
        voptFlags: Array.isArray(this.voptFlags) ? [...this.voptFlags] : [],
        sceneFlags: Array.isArray(this.sceneFlags) ? [...this.sceneFlags] : [],
        labelMode: this.labelMode | 0,
        frameMode: this.frameMode | 0,
        cameraMode: this.cameraMode | 0,
        frameId,
        optionSupport: this.optionSupport,
      };
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
      sceneFlags: Array.isArray(this.sceneFlags) ? [...this.sceneFlags] : [],
      labelMode: this.labelMode | 0,
      frameMode: this.frameMode | 0,
      cameraMode: this.cameraMode | 0,
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
