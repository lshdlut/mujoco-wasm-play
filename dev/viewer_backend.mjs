import { buildWorkerUrl, isPerfEnabled, perfMarkOnce, perfNow, perfSample, logWarn, logError, logStatus } from './viewer_runtime.mjs';
import { MJ_GROUP_COUNT, SCENE_FLAG_DEFAULTS } from './viewer_defaults.mjs';
import { VISUAL_FIELD_DESCRIPTORS } from './viewer_structs.mjs';
import { bool, cloneStruct, createDefaultHistoryState, createDefaultKeyframeState, createDefaultWatchState, createViewerGroupState, normaliseGroupState, resolveStructPath, toNumber } from './viewer_shared.mjs';

const WORKER_URL = new URL('./physics.worker.mjs', import.meta.url);
const MODEL_ALIASES = {
  rkob: 'mujoco_Rajagopal2015_simple.xml',
  raj: 'mujoco_Rajagopal2015_simple.xml',
};
const MODEL_POOL = [
  'mujoco_Rajagopal2015_simple.xml',
];

const SNAPSHOT_VIEW_FIELDS = [
  [Float64Array, ['xpos', 'xmat', 'gsize', 'jnt_range', 'qpos', 'bxpos', 'bxmat', 'xipos', 'ximat', 'xanchor', 'bvh_aabb_dyn', 'cam_xpos', 'cam_xmat', 'light_xpos', 'light_xdir', 'jpos', 'jaxis', 'act_cranklength', 'site_xpos', 'site_xmat', 'wrap_xpos', 'eq_data']],
  [Float32Array, ['scn_pos', 'scn_mat', 'scn_size', 'scn_rgba', 'matrgba', 'flexvert_xpos']],
  [Int32Array, ['scn_type', 'scn_matid', 'scn_dataid', 'scn_objtype', 'scn_objid', 'scn_category', 'scn_segid', 'scn_geomorder', 'gtype', 'gmatid', 'geom_bodyid', 'body_parentid', 'body_jntadr', 'body_jntnum', 'jtype', 'jnt_qposadr', 'dof_island', 'jbody', 'act_trnid', 'act_trntype', 'ten_wrapadr', 'ten_wrapnum', 'wrap_obj', 'sensor_type', 'sensor_objid', 'eq_type', 'eq_obj1id', 'eq_obj2id', 'eq_objtype']],
  [Uint8Array, ['scn_transparent', 'scn_label', 'bvh_active', 'eq_active0', 'eq_active']],
];

const GEOM_VIEW_FIELDS_OPTIONAL = [
  [Float64Array, ['bxpos', 'bxmat', 'xipos', 'ximat', 'xanchor', 'bvh_aabb_dyn', 'jpos', 'jaxis', 'act_cranklength', 'site_xpos', 'site_xmat', 'wrap_xpos', 'eq_data', 'qpos', 'cam_xpos', 'cam_xmat', 'light_xpos', 'light_xdir']],
  [Float32Array, ['scn_pos', 'scn_mat', 'scn_size', 'scn_rgba', 'flexvert_xpos']],
  [Int32Array, ['scn_type', 'scn_matid', 'scn_dataid', 'scn_objtype', 'scn_objid', 'scn_category', 'scn_segid', 'scn_geomorder', 'dof_island', 'jtype', 'jbody', 'act_trnid', 'act_trntype', 'ten_wrapadr', 'ten_wrapnum', 'wrap_obj', 'sensor_type', 'sensor_objid', 'eq_type', 'eq_obj1id', 'eq_obj2id', 'eq_objtype']],
  [Uint8Array, ['scn_transparent', 'scn_label', 'bvh_active', 'eq_active0', 'eq_active']],
];

const GEOM_VIEW_FIELDS_ALWAYS = [
  [Float64Array, ['gsize']],
  [Int32Array, ['gtype', 'gmatid']],
  [Float32Array, ['matrgba']],
];

function applyViewFields(target, source, fields, viewFn, options = {}) {
  const skipMissing = !!options.skipMissing;
  for (const [Ctor, keys] of fields) {
    for (const key of keys) {
      const value = source[key];
      if (skipMissing && value == null) continue;
      target[key] = viewFn(value, Ctor);
    }
  }
}

function applyHistoryPayload(target, payload) {
  const history = target.history || createDefaultHistoryState();
  history.captureHz = Number(payload.captureHz) || 0;
  history.capacity = Math.max(0, Number(payload.capacity) || 0);
  history.count = Math.max(0, Number(payload.count) || 0);
  history.horizon = Number(payload.horizon) || 0;
  history.scrubIndex = Number(payload.scrubIndex) || 0;
  history.live = payload.live !== false;
  target.history = history;
}

function applyKeyframesPayload(target, payload, keyIndexOverride = null) {
  const keyframes = target.keyframes || createDefaultKeyframeState();
  if (typeof payload.capacity === 'number') {
    keyframes.capacity = payload.capacity | 0;
  }
  if (typeof payload.count === 'number') {
    keyframes.count = Math.max(0, payload.count | 0);
  }
  if (Array.isArray(payload.labels)) {
    keyframes.labels = payload.labels.slice();
  }
  if (Array.isArray(payload.slots)) {
    keyframes.slots = payload.slots.map((slot) => ({
      index: Number(slot.index) || 0,
      label: typeof slot.label === 'string' ? slot.label : `Key ${slot.index | 0}`,
      kind: slot.kind || 'user',
      available: !!slot.available,
    }));
  }
  if (typeof payload.lastSaved === 'number') {
    keyframes.lastSaved = payload.lastSaved | 0;
  }
  if (typeof payload.lastLoaded === 'number') {
    keyframes.lastLoaded = payload.lastLoaded | 0;
  }
  target.keyframes = keyframes;
  const keyIndex = Number.isFinite(keyIndexOverride)
    ? keyIndexOverride
    : (Number.isFinite(payload.keyIndex) ? payload.keyIndex : null);
  if (keyIndex != null) {
    target.keyIndex = keyIndex | 0;
  }
}

function applyWatchPayload(target, payload, options = {}) {
  const watch = target.watch || createDefaultWatchState();
  if (typeof payload.field === 'string') {
    watch.field = payload.field;
  }
  const indexIsFinite = Number.isFinite(payload.index);
  if (typeof payload.index === 'number' && (!options.requireFiniteIndex || indexIsFinite)) {
    watch.index = payload.index | 0;
  }
  if ('value' in payload) {
    const raw = Number(payload.value);
    watch.value = Number.isFinite(raw) ? raw : null;
  }
  const minVal = Number(payload.min);
  const maxVal = Number(payload.max);
  watch.min = Number.isFinite(minVal) ? minVal : null;
  watch.max = Number.isFinite(maxVal) ? maxVal : null;
  const samples = Number(payload.samples) || 0;
  watch.samples = options.clampSamples ? Math.max(0, samples) : samples;
  watch.status = payload.status || watch.status || 'idle';
  watch.valid = !!payload.valid;
  if (options.computeSummary) {
    if (watch.valid && typeof watch.value === 'number') {
      watch.summary = watch.value.toPrecision(6);
    } else {
      watch.summary = '—';
    }
  } else {
    const summary = typeof payload.summary === 'string' ? payload.summary : '';
    watch.summary = summary || watch.summary || '';
  }
  target.watch = watch;
}

function resolveModelFileName(raw) {
  if (raw === null || raw === undefined) return null;
  const token = String(raw).trim();
  if (!token) return null;
  const key = token.toLowerCase();
  const alias = MODEL_ALIASES[key];
  let file = alias || token;
  if (!file.toLowerCase().endsWith('.xml')) {
    file = `${file}.xml`;
  }
  return file;
}

function buildModelCandidates(modelToken, modelFile) {
  const out = [];
  const seen = new Set();
  const pushCandidate = (file, label) => {
    if (!file || seen.has(file)) return;
    seen.add(file);
    out.push({ file, label: label || file });
  };
  if (modelFile) {
    pushCandidate(modelFile, modelToken || modelFile);
  }
  for (const file of MODEL_POOL) {
    pushCandidate(file, file);
  }
  return out;
}


function createInitialSnapshot() {
  return {
    t: 0,
    rate: 1,
    measuredSlowdown: 1,
    paused: false,
    ngeom: 0,
    nq: 0,
    nv: 0,
    pausedSource: 'backend',
    rateSource: 'backend',
    gesture: { mode: 'idle', phase: 'idle', pointer: null },
    drag: { dx: 0, dy: 0 },
    voptFlags: Array.from({ length: 32 }, () => 0),
    sceneFlags: SCENE_FLAG_DEFAULTS.map((flag) => (flag ? 1 : 0)),
    labelMode: 0,
    frameMode: 0,
    cameraMode: 0,
    viewerCamera: null,
    groups: createViewerGroupState(true),
    align: null,
    copyState: null,
    xpos: new Float64Array(0),
    xmat: new Float64Array(0),
    gsize: null,
    gtype: null,
    gmatid: null,
    matrgba: null,
    contacts: null,
    renderAssets: null,
    options: null,
    ctrl: null,
    optionSupport: { supported: false, pointers: [] },
    visual: null,
    statistic: null,
    visualDefaults: null,
    cameras: [],
    history: createDefaultHistoryState(),
    keyframes: createDefaultKeyframeState(),
    watch: createDefaultWatchState(),
    keyIndex: -1,
  };
}

function resolveSnapshot(state) {
  const viewOrNull = (value, Ctor) => {
    if (ArrayBuffer.isView(value)) return value;
    if (Array.isArray(value) && Ctor) {
      try {
        return new Ctor(value);
      } catch {
        return null;
      }
    }
    return null;
  };

  const snapshot = {
    t: state.t ?? 0,
    rate: state.rate ?? 1,
    measuredSlowdown: state.measuredSlowdown ?? 1,
    paused: !!state.paused,
    ngeom: state.ngeom ?? 0,
    nq: state.nq ?? 0,
    nv: state.nv ?? 0,
    pausedSource: state.pausedSource ?? 'backend',
    rateSource: state.rateSource ?? 'backend',
    gesture: state.gesture
      ? {
          mode: state.gesture.mode ?? 'idle',
          phase: state.gesture.phase ?? 'idle',
          pointer: state.gesture.pointer
            ? {
                x: Number(state.gesture.pointer.x) || 0,
                y: Number(state.gesture.pointer.y) || 0,
                dx: Number(state.gesture.pointer.dx) || 0,
                dy: Number(state.gesture.pointer.dy) || 0,
                buttons: Number(state.gesture.pointer.buttons ?? 0),
                pressure: Number(state.gesture.pointer.pressure ?? 0),
              }
            : null,
        }
      : { mode: 'idle', phase: 'idle', pointer: null },
    drag: state.drag
      ? {
          dx: Number(state.drag.dx) || 0,
          dy: Number(state.drag.dy) || 0,
        }
      : { dx: 0, dy: 0 },
    voptFlags: Array.isArray(state.voptFlags)
      ? state.voptFlags.map((flag) => (flag ? 1 : 0))
      : Array.from({ length: 32 }, () => 0),
    sceneFlags: (() => {
      const flags = [];
      const source = Array.isArray(state.sceneFlags) ? state.sceneFlags : [];
      for (let i = 0; i < SCENE_FLAG_DEFAULTS.length; i += 1) {
        if (i < source.length && source[i] != null) {
          flags[i] = source[i] ? 1 : 0;
        } else {
          flags[i] = SCENE_FLAG_DEFAULTS[i] ? 1 : 0;
        }
      }
      return flags;
    })(),
    labelMode: Number.isFinite(state.labelMode) ? (state.labelMode | 0) : 0,
    frameMode: Number.isFinite(state.frameMode) ? (state.frameMode | 0) : 0,
    cameraMode: Number.isFinite(state.cameraMode) ? (state.cameraMode | 0) : 0,
    viewerCamera:
      state.viewerCamera && typeof state.viewerCamera === 'object'
        ? {
            type: Number.isFinite(state.viewerCamera.type) ? (state.viewerCamera.type | 0) : 0,
            lookat: Array.isArray(state.viewerCamera.lookat)
              ? state.viewerCamera.lookat.slice(0, 3).map((n) => Number(n) || 0)
              : [0, 0, 0],
            distance: Number(state.viewerCamera.distance) || 0,
            azimuth: Number(state.viewerCamera.azimuth) || 0,
            elevation: Number(state.viewerCamera.elevation) || 0,
            orthographic: !!state.viewerCamera.orthographic,
          }
        : null,
    actuators: Array.isArray(state.actuators) ? state.actuators.slice() : null,
    options: state.options ?? null,
    ctrl: state.ctrl ? Array.from(state.ctrl) : null,
    cameras: Array.isArray(state.cameras) ? state.cameras.slice() : null,
    geoms: Array.isArray(state.geoms) ? state.geoms.slice() : null,
    frameId: Number.isFinite(state.frameId) ? (state.frameId | 0) : null,
    optionSupport: state.optionSupport ? { ...state.optionSupport } : null,
    info: state.info ? { ...state.info } : null,
    visual: cloneStruct(state.visual),
    statistic: cloneStruct(state.statistic),
    visualDefaults: cloneStruct(state.visualDefaults),
    scn_ngeom: Number.isFinite(state.scn_ngeom) ? (state.scn_ngeom | 0) : 0,
    nisland: typeof state.nisland === 'number' ? (state.nisland | 0) : 0,
    jnt_names: Array.isArray(state.jnt_names) ? state.jnt_names.slice() : null,
    eq_names: Array.isArray(state.eq_names) ? state.eq_names.slice() : null,
    contacts:
      state.contacts && typeof state.contacts === 'object'
        ? {
            ...state.contacts,
            pos: viewOrNull(state.contacts.pos, Float64Array),
            frame: viewOrNull(state.contacts.frame, Float64Array),
            geom1: viewOrNull(state.contacts.geom1, Int32Array),
            geom2: viewOrNull(state.contacts.geom2, Int32Array),
            dist: viewOrNull(state.contacts.dist, Float64Array),
            fric: viewOrNull(state.contacts.fric, Float64Array),
            force: viewOrNull(state.contacts.force, Float64Array),
          }
        : null,
    align: state.align
      ? {
          seq: Number(state.align.seq) || 0,
          center: Array.isArray(state.align.center)
            ? state.align.center.slice(0, 3).map((n) => Number(n) || 0)
            : [0, 0, 0],
          radius: Number(state.align.radius) || 0,
          source: state.align.source || 'backend',
          timestamp: Number(state.align.timestamp) || 0,
        }
      : null,
    copyState: state.copyState
      ? {
          seq: Number(state.copyState.seq) || 0,
          precision: state.copyState.precision || 'standard',
          nq: Number(state.copyState.nq) || 0,
          nv: Number(state.copyState.nv) || 0,
          timestamp: Number(state.copyState.timestamp) || 0,
          complete: !!state.copyState.complete,
          qposPreview: Array.isArray(state.copyState.qposPreview)
            ? state.copyState.qposPreview.map((n) => Number(n) || 0)
            : [],
          qvelPreview: Array.isArray(state.copyState.qvelPreview)
            ? state.copyState.qvelPreview.map((n) => Number(n) || 0)
            : [],
        }
      : null,
    renderAssets: state.renderAssets ?? null,
    groups: state.groups ? normaliseGroupState(state.groups) : null,
    nbody: Number.isFinite(state.nbody) ? (state.nbody | 0) : null,
    njnt: Number.isFinite(state.njnt) ? (state.njnt | 0) : null,
    history: state.history
      ? {
          captureHz: Number(state.history.captureHz) || 0,
          capacity: Number(state.history.capacity) || 0,
          count: Number(state.history.count) || 0,
          horizon: Number(state.history.horizon) || 0,
          scrubIndex: Number(state.history.scrubIndex) || 0,
          live: state.history.live !== false,
        }
      : null,
    keyframes: state.keyframes
      ? {
          capacity: Number(state.keyframes.capacity) || 0,
          count: Number(state.keyframes.count) || 0,
          labels: Array.isArray(state.keyframes.labels) ? state.keyframes.labels.slice() : [],
          slots: Array.isArray(state.keyframes.slots) ? state.keyframes.slots.map((slot) => ({ ...slot })) : [],
          lastSaved: Number.isFinite(state.keyframes.lastSaved) ? (state.keyframes.lastSaved | 0) : -1,
          lastLoaded: Number.isFinite(state.keyframes.lastLoaded) ? (state.keyframes.lastLoaded | 0) : -1,
        }
      : null,
    watch: state.watch
      ? {
          field: state.watch.field || 'qpos',
          index: Number.isFinite(state.watch.index) ? (state.watch.index | 0) : 0,
          value: typeof state.watch.value === 'number' && Number.isFinite(state.watch.value) ? state.watch.value : null,
          min: typeof state.watch.min === 'number' && Number.isFinite(state.watch.min) ? state.watch.min : null,
          max: typeof state.watch.max === 'number' && Number.isFinite(state.watch.max) ? state.watch.max : null,
          samples: Number(state.watch.samples) || 0,
          summary: state.watch.summary || '',
          status: state.watch.status || 'idle',
          valid: !!state.watch.valid,
          sources: state.watch.sources ? { ...state.watch.sources } : {},
        }
      : null,
  };
  applyViewFields(snapshot, state, SNAPSHOT_VIEW_FIELDS, viewOrNull);
  return snapshot;
}


export async function createBackend(options = {}) {
  const perfEnabled = isPerfEnabled();
  const snapshotDebug =
    typeof window !== 'undefined'
    && (
      (window.location?.search?.includes('snapshot=1'))
      || (window.location?.search?.includes('snapshot=debug'))
    );
  if (typeof window !== 'undefined') {
    window.PLAY_SNAPSHOT_DEBUG = snapshotDebug;
  }
  const modelToken = typeof options.model === 'string' ? options.model.trim() : '';
  const modelFile = resolveModelFileName(modelToken);
  const modelCandidates = buildModelCandidates(modelToken, modelFile);
  const initialCandidate = modelCandidates[0] || null;
  const initialModelInfo = {
    token: modelToken || '',
    file: initialCandidate ? initialCandidate.file : null,
    label: initialCandidate ? initialCandidate.label : (modelToken || ''),
  };
  const listeners = new Set();
  const normaliseInt = (value, fallback = 0) => {
    const num = Number(value);
    return Number.isFinite(num) ? (num | 0) : fallback;
  };
  let client = null;
  const kind = 'worker';
  let lastSnapshot = createInitialSnapshot();
  let lastFrameId = -1;
  let messageHandler = null;
  let lastXmlText = null;

  function applySimulateMaskBinding(binding, value, prefix, field, invert, warnLabel) {
    if (!binding || !binding.startsWith(`${prefix}[`)) return false;
    const start = prefix.length + 1;
    const end = binding.indexOf(']', start);
    const bitIndex = end > start ? normaliseInt(binding.slice(start, end), -1) : -1;
    if (bitIndex >= 0 && bitIndex < 32) {
      const active = bool(value);
      const bit = 1 << bitIndex;
      const currentMask =
        typeof lastSnapshot.options?.[field] === 'number'
          ? (lastSnapshot.options[field] | 0)
          : 0;
      const nextMask = invert
        ? (active ? (currentMask & ~bit) : (currentMask | bit))
        : (active ? (currentMask | bit) : (currentMask & ~bit));
      try {
        client.postMessage?.({
          cmd: 'setField',
          target: 'mjOption',
          path: [field],
          kind: 'int',
          size: 1,
          value: [nextMask],
        });
      } catch (err) {
        logWarn(`[backend ${warnLabel}] post failed`, err);
        throw err;
      }
    }
    return true;
  }

  function spawnWorkerBackend() {
    const workerUrl = buildWorkerUrl(WORKER_URL);
    return new Worker(workerUrl, { type: 'module' });
  }

  async function loadDefaultXml() {
    const errors = [];
    if (!modelCandidates.length) {
      throw new Error('No model loaded. No model candidates available.');
    }
    for (const candidate of modelCandidates) {
      const file = candidate.file;
      if (!file) continue;
    try {
      const url = new URL(file, import.meta.url);
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) {
        errors.push(`fetch ${file} status ${res.status}`);
        logWarn(`[backend] fetch ${file} failed with status ${res.status}`);
        continue;
      }
      const text = await res.text();
      if (text && text.trim().length > 0) {
        return text;
      }
      errors.push(`empty content for ${file}`);
    } catch (err) {
      errors.push(`fetch ${file} error ${String(err)}`);
      logWarn('[backend] failed to fetch xml', { file, err });
    }
  }
    throw new Error(
      `No model loaded. Tried: ${modelCandidates.map((c) => c.file).join(', ')}. Errors: ${errors.join('; ')}`,
    );
  }

  function notifyListeners() {
    if (!Number.isFinite(lastSnapshot.rate)) {
      lastSnapshot.rate = 1;
    }
    if (typeof lastSnapshot.paused !== 'boolean') {
      lastSnapshot.paused = false;
    }
    if (!lastSnapshot.rateSource) lastSnapshot.rateSource = 'backend';
    if (!lastSnapshot.pausedSource) lastSnapshot.pausedSource = 'backend';
    const snapshot = resolveSnapshot(lastSnapshot);
    for (const fn of listeners) {
      try {
        fn(snapshot);
      } catch (err) {
        logError(err);
      }
    }
    return snapshot;
  }

  function detachClient() {
    if (messageHandler) {
      try { client?.removeEventListener?.('message', messageHandler); } catch {}
      try { if (client && 'onmessage' in client) client.onmessage = null; } catch {}
    }
  }

  async function restartWorkerWithXml(xmlText) {
    const payload = typeof xmlText === 'string' ? xmlText : String(xmlText ?? '');
    if (!payload || payload.trim().length === 0) {
      return resolveSnapshot(lastSnapshot);
    }
    // Tear down old worker (if any).
    try { detachClient(); } catch {}
    try { client?.terminate?.(); } catch {}
    client = null;
    // Spawn a fresh worker (new wasm instance).
    try {
      client = await spawnWorkerBackend();
    } catch (err) {
      logError('[backend] worker init failed', err);
      throw err;
    }
    // Attach message handler to the new worker.
    if (typeof client.addEventListener === 'function') {
      messageHandler = (evt) => handleMessage(evt);
      client.addEventListener('message', messageHandler);
    } else if ('onmessage' in client) {
      messageHandler = (evt) => handleMessage(evt);
      client.onmessage = messageHandler;
    }
    const loadRate = Number.isFinite(lastSnapshot.rate) ? lastSnapshot.rate : 1;
    // Reset local snapshot state and kick off load on the fresh worker.
    lastSnapshot = createInitialSnapshot();
    lastFrameId = -1;
    lastSnapshot.visualDefaults = null;
    notifyListeners();
    try {
      client.postMessage({ cmd: 'load', rate: loadRate, xmlText: payload });
      client.postMessage({ cmd: 'snapshot' });
    } catch (err) {
      logError('[backend load] failed', err);
      throw err;
    }
    return resolveSnapshot(lastSnapshot);
  }

  function formatCopyNumber(value, precision) {
    const num = Number(value);
    if (!Number.isFinite(num)) return '0';
    if (precision === 'full') {
      return num.toPrecision(16);
    }
    return num.toPrecision(6);
  }

  function buildCopyKeyXmlFromPayload(data) {
    if (!data || typeof data !== 'object') return null;
    const precision = data.precision === 'full' ? 'full' : 'standard';
    const nq = Number(data.nq) || 0;
    const nv = Number(data.nv) || 0;
    const nu = Number(data.nu) || 0;
    const na = Number(data.na) || 0;
    const nmocap = Number(data.nmocap) || 0;
    const tSim = typeof data.tSim === 'number' ? data.tSim : 0;
    const hasFullQpos = Array.isArray(data.qpos) && data.qpos.length >= nq && nq > 0;
    const hasFullQvel = Array.isArray(data.qvel) && data.qvel.length >= nv && nv > 0;
    const hasFullCtrl = Array.isArray(data.ctrl) && data.ctrl.length >= nu && nu > 0;
    const hasFullAct = Array.isArray(data.act) && data.act.length >= na && na > 0;
    const hasFullMpos = Array.isArray(data.mpos) && data.mpos.length >= nmocap * 3 && nmocap > 0;
    const hasFullMquat = Array.isArray(data.mquat) && data.mquat.length >= nmocap * 4 && nmocap > 0;
    const qpos = hasFullQpos
      ? data.qpos
      : (Array.isArray(data.qposPreview) ? data.qposPreview : []);
    const qvel = hasFullQvel
      ? data.qvel
      : (Array.isArray(data.qvelPreview) ? data.qvelPreview : []);
    const ctrl = hasFullCtrl
      ? data.ctrl
      : (Array.isArray(data.ctrlPreview) ? data.ctrlPreview : []);
    const act = hasFullAct ? data.act : [];
    const mpos = hasFullMpos ? data.mpos : [];
    const mquat = hasFullMquat ? data.mquat : [];
    const format = (v) => formatCopyNumber(v, precision);
    let xml = '<key\n';
    xml += `  time=\"${format(tSim)}\"\n`;
    if (qpos.length) {
      xml += `  qpos=\"${qpos.map(format).join(' ')}\"\n`;
    }
    if (qvel.length) {
      xml += `  qvel=\"${qvel.map(format).join(' ')}\"\n`;
    }
    if (act.length) {
      xml += `  act=\"${act.map(format).join(' ')}\"\n`;
    }
    if (ctrl.length) {
      xml += `  ctrl=\"${ctrl.map(format).join(' ')}\"\n`;
    }
    if (mpos.length) {
      xml += `  mpos=\"${mpos.map(format).join(' ')}\"\n`;
    }
    if (mquat.length) {
      xml += `  mquat=\"${mquat.map(format).join(' ')}\"\n`;
    }
    xml += '/>';
    return xml;
  }

  async function writeCopyKeyToClipboard(xml) {
    if (!xml) return;
    if (typeof navigator === 'undefined' || !navigator.clipboard || typeof navigator.clipboard.writeText !== 'function') {
      logWarn('[backend copyState] clipboard API unavailable');
      return;
    }
    try {
      await navigator.clipboard.writeText(xml);
    } catch (err) {
      logError('[backend copyState] clipboard write failed', err);
      throw err;
    }
  }

  function applyOptionSnapshot(data) {
    if (!data || typeof data !== 'object') return;
    if (Array.isArray(data.voptFlags)) {
      lastSnapshot.voptFlags = data.voptFlags.map((flag) => (flag ? 1 : 0));
    }
    if (Array.isArray(data.sceneFlags)) {
      const flags = [];
      for (let i = 0; i < SCENE_FLAG_DEFAULTS.length; i += 1) {
        if (i < data.sceneFlags.length && data.sceneFlags[i] != null) {
          flags[i] = data.sceneFlags[i] ? 1 : 0;
        } else {
          flags[i] = SCENE_FLAG_DEFAULTS[i] ? 1 : 0;
        }
      }
      lastSnapshot.sceneFlags = flags;
    }
    if (typeof data.labelMode === 'number' && Number.isFinite(data.labelMode)) {
      lastSnapshot.labelMode = data.labelMode | 0;
    }
    if (typeof data.frameMode === 'number' && Number.isFinite(data.frameMode)) {
      lastSnapshot.frameMode = data.frameMode | 0;
    }
    if (typeof data.cameraMode === 'number' && Number.isFinite(data.cameraMode)) {
      lastSnapshot.cameraMode = data.cameraMode | 0;
    }
    if (data.groups && typeof data.groups === 'object') {
      lastSnapshot.groups = normaliseGroupState(data.groups);
    }
    if (data.options) {
      lastSnapshot.options = data.options;
    }
  }

  function setRunState(run, source = 'ui', notifyBackend = true) {
    const nextPaused = !run;
    if (notifyBackend) {
      try {
        client.postMessage?.({ cmd: 'setPaused', paused: nextPaused, source });
      } catch (err) {
        logWarn('[backend] setPaused post failed', err);
      }
    }
    return resolveSnapshot(lastSnapshot);
  }

  function setRate(nextRate, source = 'ui') {
    const raw = Number(nextRate);
    const clamped = Number.isFinite(raw) ? Math.max(0.0625, Math.min(16, raw)) : 1;
    try {
      client.postMessage?.({ cmd: 'setRate', rate: clamped, source });
    } catch (err) {
      logWarn('[backend] setRate post failed', err);
    }
    return resolveSnapshot(lastSnapshot);
  }

  async function loadXmlText(xmlText) {
    const payload = typeof xmlText === 'string' ? xmlText : String(xmlText ?? '');
    lastXmlText = payload;
    return restartWorkerWithXml(payload);
  }

  function applyVisualStatePayload(payload) {
    if (!payload || typeof client?.postMessage !== 'function') {
      return resolveSnapshot(lastSnapshot);
    }
    if (payload.visual && typeof payload.visual === 'object') {
      for (const descriptor of VISUAL_FIELD_DESCRIPTORS) {
        const value = resolveStructPath(payload.visual, descriptor.path);
        if (value == null) continue;
        try {
          client.postMessage({
            cmd: 'setField',
            target: 'mjVisual',
            path: descriptor.path,
            kind: descriptor.kind,
            size: descriptor.size,
            value,
          });
        } catch (err) {
          logWarn('[backend setField] failed', descriptor.path, err);
        }
      }
    }
    if (Array.isArray(payload.sceneFlags)) {
      for (let i = 0; i < payload.sceneFlags.length; i += 1) {
        const enabled = !!payload.sceneFlags[i];
        try {
          client.postMessage?.({ cmd: 'setSceneFlag', index: i, enabled });
        } catch (err) {
          logWarn('[backend setSceneFlag] failed', { index: i, enabled }, err);
        }
      }
    }
    return resolveSnapshot(lastSnapshot);
  }

  function updateGeometryCaches(data = {}) {
    const makeView = (value, fallback, Ctor) => {
      if (ArrayBuffer.isView(value)) {
        return value;
      }
      if (Array.isArray(value) && Ctor) {
        try {
          return new Ctor(value);
        } catch {
          return fallback;
        }
      }
      return fallback;
    };
    const makeViewOrNull = (value, Ctor) => makeView(value, null, Ctor);
    lastSnapshot.xpos = makeView(data.xpos, new Float64Array(0), Float64Array);
    lastSnapshot.xmat = makeView(data.xmat, new Float64Array(0), Float64Array);
    if (typeof data.scn_ngeom === 'number' && Number.isFinite(data.scn_ngeom)) {
      lastSnapshot.scn_ngeom = data.scn_ngeom | 0;
    }
    applyViewFields(lastSnapshot, data, GEOM_VIEW_FIELDS_OPTIONAL, makeViewOrNull, { skipMissing: true });
    if (typeof data.nisland === 'number' && Number.isFinite(data.nisland)) lastSnapshot.nisland = data.nisland | 0;
    if (Array.isArray(data.eq_names)) lastSnapshot.eq_names = data.eq_names.slice();
    applyViewFields(lastSnapshot, data, GEOM_VIEW_FIELDS_ALWAYS, makeViewOrNull);
    lastSnapshot.contacts = data.contacts && typeof data.contacts === 'object' ? data.contacts : null;
  }

  function handleMessage(event) {
    const data = event?.data ?? event;
    if (!data || typeof data !== 'object') return;
    switch (data.kind) {
      case 'run_state': {
        if (typeof data.running === 'boolean') {
          lastSnapshot.paused = !data.running;
          lastSnapshot.pausedSource = data.source || 'backend';
          notifyListeners();
        }
        break;
      }
      case 'ready':
        perfMarkOnce('play:backend:worker_ready', {
          sentWallMs: (typeof data?.perf?.sentWallMs === 'number') ? data.perf.sentWallMs : null,
          transferMs: (typeof data?.perf?.sentWallMs === 'number') ? (Date.now() - data.perf.sentWallMs) : null,
          worker: data?.perf && typeof data.perf === 'object' ? data.perf : null,
          ngeom: typeof data.ngeom === 'number' ? (data.ngeom | 0) : null,
        });
        lastFrameId = -1;
        lastSnapshot.history = createDefaultHistoryState();
        lastSnapshot.keyframes = createDefaultKeyframeState();
        lastSnapshot.watch = createDefaultWatchState();
        lastSnapshot.keyIndex = -1;
        if (typeof data.ngeom === 'number') lastSnapshot.ngeom = data.ngeom;
        if (typeof data.nq === 'number') lastSnapshot.nq = data.nq;
        if (typeof data.nv === 'number') lastSnapshot.nv = data.nv;
        if (data.optionSupport) {
          lastSnapshot.optionSupport = data.optionSupport;
        }
        if (data.visual) {
          lastSnapshot.visual = cloneStruct(data.visual);
          lastSnapshot.visualDefaults = cloneStruct(data.visual);
        }
        if (data.statistic) {
          lastSnapshot.statistic = cloneStruct(data.statistic);
        }
        updateGeometryCaches(data);
        if (data.gesture) {
          lastSnapshot.gesture = {
            ...(lastSnapshot.gesture || {}),
            ...data.gesture,
          };
        }
      if (data.drag) {
        lastSnapshot.drag = {
          ...(lastSnapshot.drag || {}),
          ...data.drag,
        };
      }
      if (data.ctrl) {
        try {
          lastSnapshot.ctrl = Array.isArray(data.ctrl)
            ? data.ctrl.slice()
            : Array.from(data.ctrl);
        } catch (err) {
          logWarn('[backend] ctrl decode failed', err);
          lastSnapshot.ctrl = [];
        }
      }
        if (data.options) {
          lastSnapshot.options = data.options;
        }
        applyOptionSnapshot(data);
        notifyListeners();
        break;
      case 'struct_state': {
        if (data.scope === 'mjVisual') {
          lastSnapshot.visual = data.value || null;
        } else if (data.scope === 'mjStatistic') {
          lastSnapshot.statistic = data.value || null;
        }
        notifyListeners();
        break;
      }
      case 'meta_cameras': {
        lastSnapshot.cameras = Array.isArray(data.cameras) ? data.cameras : [];
        const totalModes = Math.max(1, 2 + (lastSnapshot.cameras?.length || 0));
        const mode = lastSnapshot.cameraMode | 0;
        if (mode >= totalModes) {
          lastSnapshot.cameraMode = 0;
          try { client.postMessage?.({ cmd: 'setCameraMode', mode: 0 }); } catch {}
        }
        notifyListeners();
        break;
      }
      case 'meta_geoms': {
        lastSnapshot.geoms = Array.isArray(data.geoms) ? data.geoms : [];
        notifyListeners();
        break;
      }
      case 'meta_joints': {
        const toI32 = (value) => {
          if (!value) return null;
          if (ArrayBuffer.isView(value)) {
            try { return new Int32Array(value); } catch { return null; }
          }
          if (value instanceof ArrayBuffer) {
            try { return new Int32Array(value); } catch { return null; }
          }
          if (Array.isArray(value)) {
            try { return Int32Array.from(value); } catch { return null; }
          }
          return null;
        };
        const geomBody = toI32(data.geom_bodyid);
        if (geomBody) lastSnapshot.geom_bodyid = geomBody;
        const bodyAdr = toI32(data.body_jntadr);
        if (bodyAdr) lastSnapshot.body_jntadr = bodyAdr;
        const bodyNum = toI32(data.body_jntnum);
        if (bodyNum) lastSnapshot.body_jntnum = bodyNum;
        const bodyParent = toI32(data.body_parentid);
        if (bodyParent) lastSnapshot.body_parentid = bodyParent;
        const jtype = toI32(data.jtype);
        if (jtype) lastSnapshot.jtype = jtype;
        if (typeof data.nbody === 'number') lastSnapshot.nbody = data.nbody | 0;
        if (typeof data.njnt === 'number') lastSnapshot.njnt = data.njnt | 0;
        const jqposadr = toI32(data.jnt_qposadr);
        if (jqposadr) lastSnapshot.jnt_qposadr = jqposadr;
        const jrange = (() => {
          const source = data.jnt_range;
          if (!source) return null;
          try {
            if (ArrayBuffer.isView(source)) return new Float64Array(source);
            if (Array.isArray(source)) return Float64Array.from(source);
            if (source instanceof ArrayBuffer) return new Float64Array(source);
          } catch {}
          return null;
        })();
        if (jrange) lastSnapshot.jnt_range = jrange;
        if (Array.isArray(data.jnt_names)) {
          lastSnapshot.jnt_names = data.jnt_names.map((name, idx) => String(name ?? `jnt ${idx}`));
        }
        notifyListeners();
        break;
      }
      case 'meta': {
        try {
          // Actuator metadata for dynamic control UI
          if (Array.isArray(data.actuators)) {
            lastSnapshot.actuators = data.actuators.map((a) => ({
              index: Number(a.index) | 0,
              name: String(a.name ?? `act ${a.index|0}`),
              min: Number(a.min),
              max: Number(a.max),
              step: Number.isFinite(+a.step) && +a.step > 0 ? +a.step : 0.001,
              value: Number(a.value) || 0,
            }));
            notifyListeners();
          }
        } catch {}
        break;
      }
      case 'snapshot': {
        const tDecodeStart = perfEnabled ? perfNow() : 0;
        const recvWallMs = perfEnabled ? Date.now() : 0;
        if (perfEnabled) {
          perfMarkOnce('play:backend:first_snapshot', {
            sentWallMs: (typeof data?.perf?.sentWallMs === 'number') ? data.perf.sentWallMs : null,
            transferMs: (typeof data?.perf?.sentWallMs === 'number') ? (recvWallMs - data.perf.sentWallMs) : null,
            worker: data?.perf && typeof data.perf === 'object' ? data.perf : null,
          });
        }
        const frameId = Number.isFinite(data.frameId) ? (data.frameId | 0) : null;
        if (frameId !== null) {
          if (frameId <= lastFrameId) {
            break;
          }
          lastFrameId = frameId;
          lastSnapshot.frameId = frameId;
        }
        if (typeof data.tSim === 'number') lastSnapshot.t = data.tSim;
        if (typeof data.ngeom === 'number') lastSnapshot.ngeom = data.ngeom;
        if (typeof data.nq === 'number') lastSnapshot.nq = data.nq;
        if (typeof data.nv === 'number') lastSnapshot.nv = data.nv;
        if (typeof data.rate === 'number' && Number.isFinite(data.rate)) {
          lastSnapshot.rate = data.rate;
        }
        if (typeof data.measuredSlowdown === 'number' && Number.isFinite(data.measuredSlowdown)) {
          lastSnapshot.measuredSlowdown = data.measuredSlowdown;
        }
        if (typeof data.paused === 'boolean') {
          lastSnapshot.paused = data.paused;
        }
        if (typeof data.pausedSource === 'string') {
          lastSnapshot.pausedSource = data.pausedSource;
        }
        if (typeof data.rateSource === 'string') {
          lastSnapshot.rateSource = data.rateSource;
        }
        if (data.info && typeof data.info === 'object') {
          lastSnapshot.info = { ...data.info };
        }
        updateGeometryCaches(data);
        if (data.ctrl) {
          try {
            lastSnapshot.ctrl = Array.isArray(data.ctrl)
              ? data.ctrl.slice()
              : Array.from(data.ctrl);
          } catch {
            lastSnapshot.ctrl = [];
          }
        }
        if (data.optionSupport) {
          lastSnapshot.optionSupport = data.optionSupport;
        }
        if (data.history) {
          applyHistoryPayload(lastSnapshot, data.history);
        }
        const keyIndexValue = Number.isFinite(data.keyIndex) ? data.keyIndex : null;
        if (data.keyframes) {
          applyKeyframesPayload(lastSnapshot, data.keyframes, keyIndexValue);
        } else if (keyIndexValue != null) {
          lastSnapshot.keyIndex = keyIndexValue | 0;
        }
        if (data.watch) {
          applyWatchPayload(lastSnapshot, data.watch, {
            clampSamples: false,
            computeSummary: false,
            requireFiniteIndex: false,
          });
        }
        if (data.gesture) {
          lastSnapshot.gesture = {
            ...(lastSnapshot.gesture || {}),
            ...data.gesture,
          };
        }
        if (data.drag) {
          lastSnapshot.drag = {
            ...(lastSnapshot.drag || {}),
            ...data.drag,
          };
        }
        if (data.viewerCamera && typeof data.viewerCamera === 'object') {
          lastSnapshot.viewerCamera = {
            type: Number.isFinite(data.viewerCamera.type) ? (data.viewerCamera.type | 0) : 0,
            lookat: Array.isArray(data.viewerCamera.lookat)
              ? data.viewerCamera.lookat.slice(0, 3).map((n) => Number(n) || 0)
              : [0, 0, 0],
            distance: Number(data.viewerCamera.distance) || 0,
            azimuth: Number(data.viewerCamera.azimuth) || 0,
            elevation: Number(data.viewerCamera.elevation) || 0,
            orthographic: !!data.viewerCamera.orthographic,
          };
        }
        if (data.options) {
          lastSnapshot.options = data.options;
        }
        applyOptionSnapshot(data);
        if (perfEnabled) {
          const workerPerf = data?.perf && typeof data.perf === 'object' ? data.perf : null;
          const ngeomValue = typeof data.ngeom === 'number' ? (data.ngeom | 0) : null;
          const scnNgeomValue = typeof data.scn_ngeom === 'number' ? (data.scn_ngeom | 0) : null;
          const decodeMs = perfNow() - tDecodeStart;
          perfSample('backend:snapshot_decode_ms', decodeMs, {
            frameId,
            ngeom: ngeomValue,
            scn_ngeom: scnNgeomValue,
          });
          if (workerPerf) {
            if (typeof workerPerf.snapshotMs === 'number' && Number.isFinite(workerPerf.snapshotMs)) {
              perfSample('worker:snapshot_ms', workerPerf.snapshotMs, {
                ngeom: ngeomValue,
                scn_ngeom: scnNgeomValue,
              });
            }
          }
          const sentWallMs = typeof data?.perf?.sentWallMs === 'number' ? data.perf.sentWallMs : null;
          if (sentWallMs != null) {
            perfSample('worker_to_main:snapshot_transfer_ms', recvWallMs - sentWallMs);
          }
          if ((data?.scn_ngeom | 0) > 0) {
            perfMarkOnce('play:backend:first_scene_snapshot', {
              frameId,
              scn_ngeom: data?.scn_ngeom | 0,
            });
          }
        }
        const tNotifyStart = perfEnabled ? perfNow() : 0;
        notifyListeners();
        if (perfEnabled) {
          perfSample('backend:notifyListeners_ms', perfNow() - tNotifyStart, {
            frameId,
            ngeom: typeof data.ngeom === 'number' ? (data.ngeom | 0) : null,
            scn_ngeom: typeof data.scn_ngeom === 'number' ? (data.scn_ngeom | 0) : null,
          });
        }
        break;
      }
      case 'keyframes': {
        applyKeyframesPayload(lastSnapshot, data);
        notifyListeners();
        break;
      }
      case 'history': {
        applyHistoryPayload(lastSnapshot, data);
        notifyListeners();
        break;
      }
      case 'watch': {
        applyWatchPayload(lastSnapshot, data, {
          clampSamples: true,
          computeSummary: true,
          requireFiniteIndex: true,
        });
        notifyListeners();
        break;
      }
      case 'render_assets':
        if (data.assets) {
          lastSnapshot.renderAssets = data.assets;
          notifyListeners();
          if (perfEnabled) {
            const recvWallMs = Date.now();
            const sentWallMs = typeof data?.perf?.sentWallMs === 'number' ? data.perf.sentWallMs : null;
            if (sentWallMs != null) {
              perfSample('worker_to_main:render_assets_transfer_ms', recvWallMs - sentWallMs);
            }
            if (typeof data?.perf?.collectRenderAssetsMs === 'number' && Number.isFinite(data.perf.collectRenderAssetsMs)) {
              perfSample('worker:collectRenderAssets_ms', data.perf.collectRenderAssetsMs);
            }
            perfMarkOnce('play:backend:render_assets', {
              sentWallMs,
              transferMs: sentWallMs != null ? (recvWallMs - sentWallMs) : null,
              worker: data?.perf && typeof data.perf === 'object' ? data.perf : null,
            });
          } else {
            perfMarkOnce('play:backend:render_assets');
          }
        }
        break;
      case 'gesture':
        if (data.gesture) {
          lastSnapshot.gesture = {
            ...(lastSnapshot.gesture || {}),
            ...data.gesture,
          };
        }
        if (data.drag) {
          lastSnapshot.drag = {
            ...(lastSnapshot.drag || {}),
            ...data.drag,
          };
        }
        applyOptionSnapshot(data);
        notifyListeners();
        break;
      case 'align': {
        const seq = Number(data.seq) || ((lastSnapshot.align?.seq ?? 0) + 1);
        const center = Array.isArray(data.center)
          ? data.center.slice(0, 3).map((n) => Number(n) || 0)
          : lastSnapshot.align?.center ?? [0, 0, 0];
        const radius = Number(data.radius) || lastSnapshot.align?.radius || 0;
        lastSnapshot.align = {
          seq,
          center,
          radius,
          source: data.source || 'backend',
          timestamp: Number(data.timestamp) || Date.now(),
        };
        notifyListeners();
        break;
      }
      case 'copyState': {
        const seq = Number(data.seq) || ((lastSnapshot.copyState?.seq ?? 0) + 1);
        const precision = data.precision || lastSnapshot.copyState?.precision || 'standard';
        const qposPreview = Array.isArray(data.qposPreview)
          ? data.qposPreview.map((n) => Number(n) || 0)
          : lastSnapshot.copyState?.qposPreview ?? [];
        const qvelPreview = Array.isArray(data.qvelPreview)
          ? data.qvelPreview.map((n) => Number(n) || 0)
          : lastSnapshot.copyState?.qvelPreview ?? [];
        const keyXml = buildCopyKeyXmlFromPayload(data);
        lastSnapshot.copyState = {
          seq,
          precision,
          nq: Number(data.nq) || 0,
          nv: Number(data.nv) || 0,
          timestamp: Number(data.timestamp) || Date.now(),
          complete: !!data.complete,
          qposPreview,
          qvelPreview,
          keyXml: keyXml || null,
        };
        if (keyXml) {
          // Fire-and-forget clipboard write; errors are logged inside helper.
          void writeCopyKeyToClipboard(keyXml);
        }
        notifyListeners();
        break;
      }
      case 'options':
        applyOptionSnapshot(data);
        notifyListeners();
        break;
      case 'log':
        logStatus(`[backend] ${data.message ?? ''}`, data.extra ?? null);
        break;
      case 'error': {
        const message =
          typeof data.message === 'string' && data.message.length
            ? data.message
            : `Backend error: ${JSON.stringify(data)}`;
        lastSnapshot.toast = { message, ts: Date.now() };
        lastSnapshot.backendError = message;
        logError('[backend error]', data);
        notifyListeners();
        break;
      }
      default:
        break;
    }
  }

  const initialXml = await loadDefaultXml();
  lastXmlText = typeof initialXml === 'string' ? initialXml : String(initialXml ?? '');
  await restartWorkerWithXml(initialXml);

  const uiHandlers = new Map([
    ['simulation.history_scrubber', (value) => {
      const offset = Math.min(0, normaliseInt(value, 0));
      try { client.postMessage?.({ cmd: 'historyScrub', offset }); } catch (err) {
        logWarn('[backend history] post failed', err);
        throw err;
      }
      return true;
    }],
    ['simulation.key_slider', (value) => {
      const index = Math.max(-1, normaliseInt(value, -1));
      try {
        client.postMessage?.({ cmd: 'keyframeSelect', index });
      } catch (err) {
        logWarn('[backend keyframe select] failed', err);
        throw err;
      }
      return true;
    }],
    ['simulation.save_key', () => {
      const index = normaliseInt(lastSnapshot.keyIndex ?? -1, -1);
      try { client.postMessage?.({ cmd: 'keyframeSave', index }); } catch (err) {
        logWarn('[backend keyframe save] failed', err);
        throw err;
      }
      return true;
    }],
    ['simulation.load_key', () => {
      const index = Math.max(0, normaliseInt(lastSnapshot.keyIndex ?? 0, 0));
      try { client.postMessage?.({ cmd: 'keyframeLoad', index }); } catch (err) {
        logWarn('[backend keyframe load] failed', err);
        throw err;
      }
      return true;
    }],
    ['watch.field', (value) => {
      const field = typeof value === 'string' ? value.trim() : '';
      const nextField = field.length > 0 ? field : (lastSnapshot.watch?.field || '');
      if (!nextField) return true;
      try {
        client.postMessage?.({
          cmd: 'setWatch',
          field: nextField,
          index: Number.isFinite(lastSnapshot.watch?.index) ? (lastSnapshot.watch.index | 0) : 0,
        });
      } catch (err) {
        logWarn('[backend watch field] failed', err);
        throw err;
      }
      return true;
    }],
    ['watch.index', (value) => {
      const target = Math.max(0, normaliseInt(value, 0));
      try {
        client.postMessage?.({
          cmd: 'setWatch',
          field: lastSnapshot.watch?.field,
          index: target,
        });
      } catch (err) {
        logWarn('[backend watch index] failed', err);
        throw err;
      }
      return true;
    }],
    ['control.actuator', (value) => {
      try {
        const idx = Number(value?.index ?? value?.i ?? value?.id);
        const v = Number(value?.value ?? value?.v ?? 0);
        if (Number.isFinite(idx) && idx >= 0) {
          client.postMessage?.({ cmd: 'setCtrl', index: idx | 0, value: v });
        }
      } catch (err) {
        logWarn('[backend control.actuator] failed', err);
        throw err;
      }
      return true;
    }],
    ['joint.slider', (value) => {
      try {
        const idx = Number(value?.index ?? value?.qposIndex ?? value?.i);
        const v = Number(value?.value ?? value?.v);
        if (Number.isFinite(idx) && idx >= 0 && Number.isFinite(v)) {
          const min = Number.isFinite(value?.min) ? Number(value.min) : null;
          const max = Number.isFinite(value?.max) ? Number(value.max) : null;
          client.postMessage?.({ cmd: 'setQpos', index: idx | 0, value: v, min, max });
        }
      } catch (err) {
        logWarn('[backend joint.slider] failed', err);
        throw err;
      }
      return true;
    }],
    ['equality.toggle', (value) => {
      try {
        const idx = Number(value?.index ?? value?.i);
        const active = !!(value?.active ?? value?.value ?? value?.v);
        if (Number.isFinite(idx) && idx >= 0) {
          client.postMessage?.({ cmd: 'setEqualityActive', index: idx | 0, active });
        }
      } catch (err) {
        logWarn('[backend equality.toggle] failed', err);
        throw err;
      }
      return true;
    }],
    ['control.clear', () => {
      try {
        const acts = Array.isArray(lastSnapshot.actuators) ? lastSnapshot.actuators : [];
        for (let i = 0; i < acts.length; i += 1) {
          client.postMessage?.({ cmd: 'setCtrl', index: i, value: 0 });
        }
      } catch (err) {
        logWarn('[backend control.clear] failed', err);
        throw err;
      }
      return true;
    }],
  ]);

  const bindingExactHandlers = new Map([
    ['Simulate::camera', (value) => {
      const totalModes = Math.max(1, 2 + (lastSnapshot.cameras?.length || 0));
      const modeValue = Math.max(0, Math.min(totalModes - 1, Math.trunc(toNumber(value))));
      try {
        client.postMessage?.({ cmd: 'setCameraMode', mode: modeValue });
      } catch (err) {
        logWarn('[backend camera] post failed', err);
        throw err;
      }
      return true;
    }],
    ['Simulate::tracking_geom', () => true],
    ['mjvOption::label', (value) => {
      const mode = Math.max(0, Math.trunc(toNumber(value)));
      try {
        client.postMessage?.({ cmd: 'setLabelMode', mode });
      } catch (err) {
        logWarn('[backend label mode] post failed', err);
        throw err;
      }
      return true;
    }],
    ['mjvOption::frame', (value) => {
      const mode = Math.max(0, Math.trunc(toNumber(value)));
      try {
        client.postMessage?.({ cmd: 'setFrameMode', mode });
      } catch (err) {
        logWarn('[backend frame mode] post failed', err);
        throw err;
      }
      return true;
    }],
  ]);

  const bindingRegexHandlers = [
    {
      pattern: /^Simulate::opt\.(flex_layer|bvh_depth)$/,
      handle: (match, value) => {
        const field = match[1];
        const nextValue = Math.max(0, Math.trunc(toNumber(value)));
        try {
          client.postMessage?.({
            cmd: 'setVisualOption',
            field,
            value: nextValue,
          });
        } catch (err) {
          logWarn('[backend setVisualOption] post failed', err);
          throw err;
        }
        return true;
      },
    },
    {
      pattern: /^mjvOption::(geom|site|joint|tendon|actuator|flex|skin)group\[(\d+)\]$/,
      handle: (match, value) => {
        const type = match[1];
        const idx = Math.max(0, Math.trunc(toNumber(match[2])));
        if (idx < MJ_GROUP_COUNT) {
          try {
            client.postMessage?.({ cmd: 'setGroupState', group: type, index: idx, enabled: bool(value) });
          } catch (err) {
            logWarn('[backend group] post failed', err);
            throw err;
          }
        }
        return true;
      },
    },
    {
      pattern: /^mjvOption::flags\[(\d+)\]$/,
      handle: (match, value) => {
        const idx = Number(match[1]);
        const enabled = bool(value);
        try {
          client.postMessage?.({ cmd: 'setVoptFlag', index: idx, enabled });
        } catch (err) {
          logWarn('[backend vopt flag] post failed', err);
          throw err;
        }
        return true;
      },
    },
    {
      pattern: /^mjvScene::flags\[(\d+)\]$/,
      handle: (match, value) => {
        const idx = Number(match[1]);
        const enabled = bool(value);
        try {
          client.postMessage?.({ cmd: 'setSceneFlag', index: idx, enabled });
        } catch (err) {
          logWarn('[backend scene flag] post failed', err);
          throw err;
        }
        return true;
      },
    },
  ];

  function dispatchBinding(binding, value) {
    if (!binding) return false;
    const exactHandler = bindingExactHandlers.get(binding);
    if (exactHandler) {
      exactHandler(value);
      return true;
    }
    if (applySimulateMaskBinding(binding, value, 'Simulate::disable', 'disableflags', false, 'disableflags')) {
      return true;
    }
    if (applySimulateMaskBinding(binding, value, 'Simulate::enable', 'enableflags', false, 'enableflags')) {
      return true;
    }
    if (applySimulateMaskBinding(binding, value, 'Simulate::enableactuator', 'disableactuator', true, 'disableactuator')) {
      return true;
    }
    for (const entry of bindingRegexHandlers) {
      const match = binding.match(entry.pattern);
      if (!match) continue;
      entry.handle(match, value);
      return true;
    }
    return false;
  }

  async function apply(payload) {
    if (!payload) {
      return resolveSnapshot(lastSnapshot);
    }
    if (payload.kind === 'gesture') {
      const mode = payload.mode ?? payload.gesture?.mode ?? 'idle';
      const phase = payload.phase ?? payload.gesture?.phase ?? 'update';
      const gestureType = typeof payload.gestureType === 'string' ? payload.gestureType : null;
      const pointerSource = payload.pointer ?? payload.gesture?.pointer ?? null;
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
      const gesture = {
        mode: phase === 'end' ? 'idle' : mode,
        phase,
        pointer,
      };
      const drag = dragSource
        ? {
            dx: Number(dragSource.dx) || 0,
            dy: Number(dragSource.dy) || 0,
          }
        : (phase === 'end' ? { dx: 0, dy: 0 } : null);
      try {
        client.postMessage?.({
          cmd: 'gesture',
          gesture,
          pointer,
          drag,
          gestureType,
          reldx: Number(payload.reldx),
          reldy: Number(payload.reldy),
          shiftKey: !!payload.shiftKey,
          cam: payload.cam || null,
        });
      } catch (err) {
        logError('[backend gesture] failed', err);
      }
      return resolveSnapshot(lastSnapshot);
    }
    if (payload.kind !== 'ui') {
      return resolveSnapshot(lastSnapshot);
    }
    const { id, value, control } = payload;
    const binding = typeof control?.binding === 'string' ? control.binding : null;
    if (dispatchBinding(binding, value)) {
      return resolveSnapshot(lastSnapshot);
    }
    const uiHandler = uiHandlers.get(id);
    if (uiHandler) {
      uiHandler(value);
      return resolveSnapshot(lastSnapshot);
    }
    const prepared = typeof options.prepareBindingUpdate === 'function'
      ? await options.prepareBindingUpdate(control, value)
      : null;
    if (prepared) {
      try {
        client.postMessage?.({
          cmd: 'setField',
          target: prepared.meta.scope,
          path: prepared.meta.path,
          kind: prepared.meta.kind,
          size: prepared.meta.size,
          value: prepared.value,
        });
        // Force a fresh snapshot so UI can observe the updated struct fields,
        // even when the worker is paused or snapshot delivery is delayed.
        client.postMessage?.({ cmd: 'snapshot' });
      } catch (err) {
        logWarn('[backend setField] post failed', err);
      }
      return resolveSnapshot(lastSnapshot);
    }
    switch (id) {
      case 'simulation.run': {
        const run = value === 'Run' || value === true || value === 1;
        return setRunState(run, 'ui');
      }
      case 'simulation.reset':
        client.postMessage?.({ cmd: 'reset' });
        break;
      case 'simulation.reload': {
        if (lastXmlText && typeof lastXmlText === 'string' && lastXmlText.trim().length > 0) {
          return restartWorkerWithXml(lastXmlText);
        }
        const xmlText = await loadDefaultXml();
        lastXmlText = typeof xmlText === 'string' ? xmlText : String(xmlText ?? '');
        return restartWorkerWithXml(xmlText);
      }
      case 'simulation.align': {
        try {
          client.postMessage?.({ cmd: 'align', source: 'ui' });
        } catch (err) {
          logWarn('[backend align] post failed', err);
        }
        break;
      }
      case 'simulation.copy_state': {
        const meta = value && typeof value === 'object' ? value : {};
        const precision = meta.shiftKey ? 'full' : 'standard';
        try {
          client.postMessage?.({ cmd: 'copyState', precision, source: 'ui' });
        } catch (err) {
          logWarn('[backend copyState] post failed', err);
        }
        break;
      }
      case 'simulation.noise_scale':
      case 'simulation.noise_rate':
        // Noise controls are disabled in this build; UI state is still
        // tracked via Simulate::ctrl_noise_* bindings but no messages are
        // sent to the worker.
        break;
      case 'rendering.camera_mode':
      case 'option.help':
      default:
        break;
    }
    return resolveSnapshot(lastSnapshot);
  }

  function snapshot() {
    return resolveSnapshot(lastSnapshot);
  }

  function subscribe(fn) {
    listeners.add(fn);
    fn(resolveSnapshot(lastSnapshot));
    return () => listeners.delete(fn);
  }

  async function step(direction = 1) {
    const dir = direction >= 0 ? 1 : -1;
    const history = lastSnapshot.history || createDefaultHistoryState();
    const currentOffset = Number.isFinite(history.scrubIndex) ? history.scrubIndex : 0;
    const count = Number.isFinite(history.count) ? history.count : 0;
    let nextOffset = currentOffset;

    if (currentOffset !== 0 || (dir < 0 && count > 0)) {
      if (currentOffset === 0) {
        if (dir < 0) {
          nextOffset = -1;
        }
      } else if (dir > 0) {
        nextOffset = Math.min(0, currentOffset + 1);
      } else if (dir < 0) {
        const minOffset = -Math.max(0, count);
        nextOffset = Math.max(minOffset, currentOffset - 1);
      }

      if (nextOffset === currentOffset) {
        return resolveSnapshot(lastSnapshot);
      }

      try {
        client.postMessage?.({ cmd: 'historyScrub', offset: nextOffset });
      } catch (err) {
        logWarn('[backend history step] post failed', err);
      }
      return resolveSnapshot(lastSnapshot);
    }

    setRunState(false, 'ui');
    const n = Math.max(1, Math.abs(direction | 0) || 1);
    try {
      client.postMessage?.({ cmd: 'step', n });
    } catch (err) {
      logWarn('[backend step] post failed', err);
    }
    return resolveSnapshot(lastSnapshot);
  }

  async function setCameraIndex() {
    return resolveSnapshot(lastSnapshot);
  }

  const toVec3 = (value) => {
    if (Array.isArray(value)) {
      return [
        Number(value[0]) || 0,
        Number(value[1]) || 0,
        Number(value[2]) || 0,
      ];
    }
    return [0, 0, 0];
  };

  async function applyPerturbCommand(options = {}) {
    const phase = typeof options.phase === 'string' ? options.phase : '';
    if (!phase) return resolveSnapshot(lastSnapshot);

    const msg = { cmd: 'applyPerturb', phase };
    const mode = options.mode === 'rotate' ? 'rotate' : 'translate';
    const cam = options.cam && typeof options.cam === 'object' ? options.cam : null;
    const camPayload = cam
      ? {
          lookat: toVec3(cam.lookat),
          distance: Number(cam.distance) || 0,
          azimuth: Number(cam.azimuth) || 0,
          elevation: Number(cam.elevation) || 0,
          orthographic: !!cam.orthographic,
        }
      : null;

    if (phase === 'begin') {
      msg.mode = mode;
      msg.shiftKey = !!options.shiftKey;
      msg.bodyId = Number(options.bodyId) | 0;
      msg.localpos = toVec3(options.localpos);
      msg.scale = Number(options.scale) || 0;
      if (camPayload) msg.cam = camPayload;
    } else if (phase === 'move') {
      msg.mode = mode;
      msg.shiftKey = !!options.shiftKey;
      msg.reldx = Number(options.reldx) || 0;
      msg.reldy = Number(options.reldy) || 0;
      if (camPayload) msg.cam = camPayload;
    } else if (phase === 'end') {
      // nothing else
    } else {
      return resolveSnapshot(lastSnapshot);
    }

    try {
      client.postMessage?.(msg);
    } catch (err) {
      logWarn('[backend applyPerturb] failed', err);
    }
    return resolveSnapshot(lastSnapshot);
  }

  function dispose() {
    if (messageHandler) {
      try { client.removeEventListener?.('message', messageHandler); } catch {}
    }
    client?.terminate?.();
  }

  return {
    kind,
    apply,
    snapshot,
    subscribe,
    step,
    setCameraIndex,
    setRunState,
    setRate,
    applyPerturb: applyPerturbCommand,
    setVisualState: applyVisualStatePayload,
    loadXmlText,
    getInitialModelInfo: () => initialModelInfo,
    dispose,
  };
}
