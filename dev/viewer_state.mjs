import { prefetchBindingIndex, prepareBindingUpdate, splitBinding } from './viewer_bindings.mjs';
import { VISUAL_FIELD_DESCRIPTORS } from './viewer_structs.mjs';
import { VISUAL_FIELD_GROUPS } from './visual_field_groups.mjs';
import {
  DEFAULT_REALTIME_INDEX,
  DEFAULT_VOPT_FLAGS,
  MJ_GROUP_COUNT,
  MJ_GROUP_TYPES,
  REALTIME_LEVELS,
  SCENE_FLAG_DEFAULTS,
} from './viewer_defaults.mjs';
import {
  isPerfEnabled,
  perfMarkOnce,
  perfNow,
  perfSample,
  logError,
  logStatus,
  logWarn,
} from './viewer_runtime.mjs';

// Lightweight state container and backend helpers for the simulate parity UI.
// Runtime implementation lives in JS so it can be consumed directly by the
// buildless viewer. Type definitions are provided separately in viewer_state_types.ts.

const VISUAL_FLOAT_TOLERANCE = 1e-4;

function createDefaultHistoryState() {
  return {
    captureHz: 0,
    capacity: 0,
    count: 0,
    horizon: 0,
    scrubIndex: 0,
    live: true,
  };
}

function createDefaultWatchState() {
  return {
    field: 'qpos',
    index: 0,
    value: null,
    min: null,
    max: null,
    samples: 0,
    status: 'idle',
    summary: '',
    valid: false,
    sources: {},
  };
}

function createDefaultKeyframeState() {
  return {
    capacity: 0,
    count: 0,
    labels: [],
    slots: [],
    lastSaved: -1,
    lastLoaded: -1,
  };
}

function createViewerGroupState(initial = true) {
  const state = {};
  for (const type of MJ_GROUP_TYPES) {
    state[type] = Array.from({ length: MJ_GROUP_COUNT }, () => !!initial);
  }
  return state;
}

function normaliseGroupState(input) {
  const output = {};
  for (const type of MJ_GROUP_TYPES) {
    const source = Array.isArray(input?.[type]) ? input[type] : null;
    output[type] = Array.from(
      { length: MJ_GROUP_COUNT },
      (_, idx) => (source && idx < source.length ? !!source[idx] : true),
    );
  }
  return output;
}

function resolveRealTimeIndexFromRate(rate) {
  const raw = Number(rate);
  if (!Number.isFinite(raw) || raw <= 0) return null;
  const percent = raw * 100;
  let bestIdx = DEFAULT_REALTIME_INDEX;
  let bestDiff = Infinity;
  for (let i = 0; i < REALTIME_LEVELS.length; i += 1) {
    const diff = Math.abs(REALTIME_LEVELS[i] - percent);
    if (diff < bestDiff) {
      bestDiff = diff;
      bestIdx = i;
    }
  }
  return bestIdx;
}

function createDefaultSelectionState() {
  return {
    geom: -1,
    body: -1,
    joint: -1,
    name: '',
    kind: 'geom',
    point: [0, 0, 0],
    localPoint: [0, 0, 0],
    normal: [0, 0, 1],
    seq: 0,
    timestamp: 0,
  };
}

function resetSelectionState(runtime) {
  if (!runtime) return;
  runtime.selection = createDefaultSelectionState();
}

const DISABLE_FLAG_LABELS = Object.freeze([
  'Constraint',
  'Equality',
  'Frictionloss',
  'Limit',
  'Contact',
  'Spring',
  'Damper',
  'Gravity',
  'Clampctrl',
  'Warmstart',
  'Filterparent',
  'Actuation',
  'Refsafe',
  'Sensor',
  'Midphase',
  'Eulerdamp',
  'AutoReset',
  'NativeCCD',
  'Island',
]);

const ENABLE_FLAG_LABELS = Object.freeze([
  'Override',
  'Energy',
  'Fwdinv',
  'InvDiscrete',
  'MultiCCD',
]);

const ACTUATOR_GROUP_LABELS = Object.freeze([
  'Act Group 0',
  'Act Group 1',
  'Act Group 2',
  'Act Group 3',
  'Act Group 4',
  'Act Group 5',
]);

function flagsFromMask(mask, labels, invert = false) {
  const result = {};
  const m = Number(mask) | 0;
  for (let i = 0; i < labels.length; i += 1) {
    const label = labels[i];
    const bitOn = !!(m & (1 << i));
    result[label] = invert ? !bitOn : bitOn;
  }
  return result;
}

const DEFAULT_VIEWER_STATE = Object.freeze({
  overlays: {
    help: false,
    info: false,
    profiler: false,
    sensor: false,
    fullscreen: false,
    vsync: true,
    busywait: false,
    pauseUpdate: false,
  },
  simulation: {
    run: true,
    scrubIndex: 0,
    keyIndex: 0,
    realTimeIndex: DEFAULT_REALTIME_INDEX,
  },
  runtime: {
    cameraIndex: 0,
    cameraLabel: 'Free',
    trackingGeom: -1,
    lastAction: 'idle',
    gesture: {
      mode: 'idle',
      phase: 'idle',
    },
    drag: {
      dx: 0,
      dy: 0,
    },
    selection: createDefaultSelectionState(),
    perturb: {
      mode: 'idle',
      active: false,
    },
    lastAlign: {
      seq: 0,
      center: [0, 0, 0],
      radius: 0,
      timestamp: 0,
      source: 'init',
    },
    lastCopy: {
      seq: 0,
      precision: 'standard',
      nq: 0,
      nv: 0,
      timestamp: 0,
      qposPreview: [],
      qvelPreview: [],
      complete: false,
    },
  },
  model: {
    opt: {},
    vis: {},
    stat: {},
    visDefaults: {},
    cameras: [],
    geoms: [],
    ctrl: [],
    optSupport: { supported: false, pointers: [] },
  },
  theme: {
    color: 0,   // 0 = Dark, 1 = Light
    spacing: 0, // 0 = Tight, 1 = Wide
    font: 2,    // index into option.font options (50%, 75%, 100%, 150%, 200%)
  },
  // visualSourceMode now has three explicit modes:
  // - 'model'       : MuJoCo-driven skybox / lights.
  // - 'preset-sun'  : daytime HDRI preset.
  // - 'preset-moon' : nighttime HDRI preset.
  visualSourceMode: 'model',
  visualBackups: {
    model: null,
    presetSun: null,
    presetMoon: null,
    sceneFlagsModel: null,
    sceneFlagsPresetSun: null,
    sceneFlagsPresetMoon: null,
  },
  visualBaselines: {
    model: null,
    presetSun: null,
    presetMoon: null,
    sceneFlagsModel: null,
    sceneFlagsPresetSun: null,
    sceneFlagsPresetMoon: null,
  },
  panels: {
    left: true,
    right: true,
  },
  physics: {
    disableFlags: {},
    enableFlags: {},
    actuatorGroups: {},
  },
  rendering: {
    voptFlags: DEFAULT_VOPT_FLAGS.slice(),
    sceneFlags: SCENE_FLAG_DEFAULTS.slice(),
    labelMode: 0,
    frameMode: 0,
    flexLayer: 0,
    bvhDepth: 1,
    assets: null,
    groups: createViewerGroupState(true),
  },
  hud: {
    time: 0,
    frames: 0,
    fps: 0,
    rate: 1,
    measuredSlowdown: 1,
    ngeom: 0,
    contacts: 0,
    pausedSource: 'backend',
    rateSource: 'backend',
    modelLabel: '',
    info: null,
  },
  toast: null,
  visualDiagnostics: {
    diffs: {},
    timestamp: 0,
  },
  history: createDefaultHistoryState(),
  watch: createDefaultWatchState(),
  keyframes: createDefaultKeyframeState(),
});

const CAMERA_BASE_LABELS = ['Free', 'Tracking'];
let latestHudTime = 0;
const TIME_RESET_EPSILON = 1e-6;
const MODEL_ALIASES = {
  rkob: 'mujoco_Rajagopal2015_simple.xml',
  raj: 'mujoco_Rajagopal2015_simple.xml',
};
const MODEL_POOL = [
  'mujoco_Rajagopal2015_simple.xml',
];

function ctrlMirrorEnabled() {
  return false;
}

function cloneState(state) {
  if (typeof structuredClone === 'function') {
    return structuredClone(state);
  }
  return JSON.parse(JSON.stringify(state));
}

function cloneStruct(value) {
  if (!value) return null;
  if (typeof structuredClone === 'function') {
    try {
      return structuredClone(value);
    } catch {}
  }
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return null;
  }
}

function deepMerge(target, patch) {
  const output = Array.isArray(target) ? [...target] : { ...target };
  if (!patch) return output;
  for (const [key, value] of Object.entries(patch)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      output[key] = deepMerge(target ? target[key] : undefined, value);
    } else {
      output[key] = value;
    }
  }
  return output;
}

function bool(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const v = value.trim().toLowerCase();
    return v === '1' || v === 'true' || v === 'on';
  }
  return !!value;
}

function resolveStructPath(target, pathSegments) {
  if (!target || !Array.isArray(pathSegments)) return undefined;
  let current = target;
  for (const segment of pathSegments) {
    if (current == null) return undefined;
    const match = typeof segment === 'string' ? segment.match(/^(.*)\[(\d+)\]$/) : null;
    if (match) {
      const base = match[1];
      const index = Number(match[2]);
      const container = current?.[base];
      if (!Array.isArray(container)) return undefined;
      current = container[index];
      continue;
    }
    current = current?.[segment];
  }
  return current;
}

function assignStructPath(target, pathSegments, value) {
  if (!target || !Array.isArray(pathSegments) || !pathSegments.length) return;
  let cursor = target;
  for (let i = 0; i < pathSegments.length; i += 1) {
    const segment = pathSegments[i];
    const match = typeof segment === 'string' ? segment.match(/^(.*)\[(\d+)\]$/) : null;
    const key = match ? match[1] : segment;
    const hasIndex = !!match;
    const index = hasIndex ? Number(match[2]) : -1;
    if (i === pathSegments.length - 1) {
      if (hasIndex) {
        cursor[key] = Array.isArray(cursor[key]) ? cursor[key] : [];
        cursor[key][index] = value;
      } else {
        cursor[key] = value;
      }
      return;
    }
    if (hasIndex) {
      cursor[key] = Array.isArray(cursor[key]) ? cursor[key] : [];
      cursor[key][index] = cursor[key][index] || {};
      cursor = cursor[key][index];
    } else {
      cursor[key] = cursor[key] || {};
      cursor = cursor[key];
    }
  }
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

export function resetModelFrontendState(store) {
  latestHudTime = 0;
  if (!store || typeof store.replace !== 'function') return;
  store.replace(DEFAULT_VIEWER_STATE);
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

function toNumber(value) {
  if (typeof value === 'number') return value;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function normaliseControlValue(control, raw) {
  if (!control) return raw;
  switch (control.type) {
    case 'checkbox':
      return bool(raw);
    case 'slider_int':
    case 'edit_int':
      return Math.trunc(toNumber(raw));
    case 'slider_float':
    case 'edit_float':
    case 'slider_num':
    case 'slidernum':
      return toNumber(raw);
    case 'edit_vec3':
    case 'edit_vec3_string': {
      if (Array.isArray(raw)) {
        return raw.map((value) => toNumber(value));
      }
      if (typeof raw === 'string') {
        const tokens = raw
          .trim()
          .split(/\s+/)
          .map((token) => Number(token))
          .filter((num) => Number.isFinite(num));
        if (tokens.length === 3) return tokens;
        return raw.trim();
      }
      return raw ?? '';
    }
    case 'edit_rgba':
      if (Array.isArray(raw)) {
        return raw.map((value) => String(value ?? '')).join(' ');
      }
      if (raw === null || raw === undefined) return '';
      return String(raw).trim();
    case 'radio':
      if (typeof raw === 'string') {
        if (control?.item_id === 'simulation.run') {
          return raw.toLowerCase() !== 'pause';
        }
        return raw;
      }
      if (Array.isArray(control.options) && typeof raw === 'number') {
        return control.options[raw] ?? control.options[0];
      }
      if (control?.item_id === 'simulation.run') {
        return bool(raw);
      }
      return raw;
    case 'select':
      return raw;
    default:
      return raw;
  }
}

function cameraLabelFromIndex(index, cameras = []) {
  const i = index | 0;
  if (i < CAMERA_BASE_LABELS.length) {
    return CAMERA_BASE_LABELS[i];
  }
  const list = Array.isArray(cameras) ? cameras : [];
  const cam = list[i - CAMERA_BASE_LABELS.length];
  if (cam && typeof cam.name === 'string' && cam.name.length) {
    return cam.name;
  }
  return `Camera ${i - CAMERA_BASE_LABELS.length + 1}`;
}

function mergeBackendSnapshot(draft, snapshot) {
  if (!snapshot) return;
  const mirrorCtrl = ctrlMirrorEnabled();
  if (typeof snapshot.t === 'number' && Number.isFinite(snapshot.t)) {
    const t = snapshot.t;
    if (t + TIME_RESET_EPSILON < latestHudTime) {
      latestHudTime = t;
    } else {
      latestHudTime = Math.max(latestHudTime, t);
    }
    draft.hud.time = latestHudTime;
  }
  if (typeof snapshot.rate === 'number' && Number.isFinite(snapshot.rate)) {
    draft.hud.rate = snapshot.rate;
    const idx = resolveRealTimeIndexFromRate(snapshot.rate);
    if (idx !== null) {
      draft.simulation.realTimeIndex = idx;
    }
  }
  if (typeof snapshot.measuredSlowdown === 'number' && Number.isFinite(snapshot.measuredSlowdown)) {
    draft.hud.measuredSlowdown = snapshot.measuredSlowdown;
  }
  if (typeof snapshot.ngeom === 'number' && Number.isFinite(snapshot.ngeom)) {
    draft.hud.ngeom = snapshot.ngeom | 0;
  }
  if (snapshot.contacts && typeof snapshot.contacts.n === 'number') {
    draft.hud.contacts = snapshot.contacts.n | 0;
  } else {
    draft.hud.contacts = 0;
  }
  if (typeof snapshot.pausedSource === 'string') {
    draft.hud.pausedSource = snapshot.pausedSource;
  }
  if (typeof snapshot.rateSource === 'string') {
    draft.hud.rateSource = snapshot.rateSource;
  }
  if (snapshot.info) {
    draft.hud.info = { ...snapshot.info };
  }
  if (typeof snapshot.paused === 'boolean') {
    draft.simulation.run = !snapshot.paused;
  }
  if (snapshot.gesture) {
    const gesture = snapshot.gesture;
    const current = draft.runtime.gesture ?? {};
    draft.runtime.gesture = {
      ...current,
      ...gesture,
    };
    if (!draft.runtime?.perturb?.active) {
      const mode = typeof gesture.mode === 'string' ? gesture.mode : 'idle';
      draft.runtime.lastAction = mode !== 'idle' ? mode : (draft.runtime.lastAction || 'idle');
    }
  }
  if (snapshot.drag) {
    draft.runtime.drag = {
      ...(draft.runtime.drag || {}),
      ...snapshot.drag,
    };
  }
  if (snapshot.align) {
    const current = draft.runtime.lastAlign || {};
    draft.runtime.lastAlign = {
      ...current,
      ...snapshot.align,
      center: Array.isArray(snapshot.align.center)
        ? snapshot.align.center.slice(0, 3).map((n) => Number(n) || 0)
        : current.center ?? [0, 0, 0],
      radius: Number(snapshot.align.radius) || 0,
      seq: Number(snapshot.align.seq) || current.seq || 0,
      timestamp: Number(snapshot.align.timestamp) || Date.now(),
      source: snapshot.align.source || current.source || 'backend',
    };
  }
  if (snapshot.copyState) {
    const current = draft.runtime.lastCopy || {};
    draft.runtime.lastCopy = {
      ...current,
      ...snapshot.copyState,
      seq: Number(snapshot.copyState.seq) || current.seq || 0,
      precision: snapshot.copyState.precision || current.precision || 'standard',
      nq: Number(snapshot.copyState.nq) || 0,
      nv: Number(snapshot.copyState.nv) || 0,
      timestamp: Number(snapshot.copyState.timestamp) || Date.now(),
      complete: !!snapshot.copyState.complete,
      qposPreview: Array.isArray(snapshot.copyState.qposPreview)
        ? snapshot.copyState.qposPreview.map((n) => Number(n) || 0)
        : current.qposPreview ?? [],
      qvelPreview: Array.isArray(snapshot.copyState.qvelPreview)
        ? snapshot.copyState.qvelPreview.map((n) => Number(n) || 0)
        : current.qvelPreview ?? [],
    };
  }
  if (snapshot.history) {
    const history = ensureHistoryState(draft);
    history.captureHz = Number(snapshot.history.captureHz) || 0;
    history.capacity = Math.max(0, Number(snapshot.history.capacity) || 0);
    history.count = Math.max(0, Number(snapshot.history.count) || 0);
    history.horizon = Number(snapshot.history.horizon) || 0;
    history.scrubIndex = Number(snapshot.history.scrubIndex) || 0;
    history.live = snapshot.history.live !== false;
    draft.simulation.scrubIndex = history.scrubIndex | 0;
  }
  if (snapshot.keyframes) {
    const keyframes = ensureKeyframeState(draft);
    if (typeof snapshot.keyframes.capacity === 'number') {
      keyframes.capacity = Math.max(0, snapshot.keyframes.capacity | 0);
    }
    if (typeof snapshot.keyframes.count === 'number') {
      keyframes.count = Math.max(0, snapshot.keyframes.count | 0);
    }
    if (Array.isArray(snapshot.keyframes.labels)) {
      keyframes.labels = snapshot.keyframes.labels.slice();
    }
    if (Array.isArray(snapshot.keyframes.slots)) {
      keyframes.slots = snapshot.keyframes.slots.map((slot) => ({
        index: Number(slot.index) || 0,
        label: typeof slot.label === 'string' ? slot.label : `Key ${slot.index | 0}`,
        kind: slot.kind || 'user',
        available: !!slot.available,
      }));
    }
    if (typeof snapshot.keyframes.lastSaved === 'number') {
      keyframes.lastSaved = snapshot.keyframes.lastSaved | 0;
    }
    if (typeof snapshot.keyframes.lastLoaded === 'number') {
      keyframes.lastLoaded = snapshot.keyframes.lastLoaded | 0;
    }
  }
  if (typeof snapshot.keyIndex === 'number' && Number.isFinite(snapshot.keyIndex)) {
    draft.simulation.keyIndex = snapshot.keyIndex | 0;
  }
  if (snapshot.watch) {
    const watch = ensureWatchState(draft);
    if (typeof snapshot.watch.field === 'string') {
      watch.field = snapshot.watch.field;
    }
    if (typeof snapshot.watch.index === 'number' && Number.isFinite(snapshot.watch.index)) {
      watch.index = snapshot.watch.index | 0;
    }
    if ('value' in snapshot.watch) {
      const raw = Number(snapshot.watch.value);
      watch.value = Number.isFinite(raw) ? raw : null;
    }
    const minVal = Number(snapshot.watch.min);
    const maxVal = Number(snapshot.watch.max);
    watch.min = Number.isFinite(minVal) ? minVal : null;
    watch.max = Number.isFinite(maxVal) ? maxVal : null;
    watch.samples = Math.max(0, Number(snapshot.watch.samples) || 0);
    watch.valid = !!snapshot.watch.valid;
    watch.status = snapshot.watch.status || (watch.valid ? 'ok' : 'invalid');
    if (watch.valid && typeof watch.value === 'number') {
      watch.summary = watch.value.toPrecision(6);
    } else if (typeof snapshot.watch.message === 'string') {
      watch.summary = snapshot.watch.message;
    } else {
      watch.summary = '—';
    }
  }
  if (snapshot.watchSources) {
    const watch = ensureWatchState(draft);
    watch.sources = { ...snapshot.watchSources };
  }
  if (typeof snapshot.cameraMode === 'number' && Number.isFinite(snapshot.cameraMode)) {
    const idx = snapshot.cameraMode | 0;
    draft.runtime.cameraIndex = idx;
    draft.runtime.cameraLabel = cameraLabelFromIndex(idx, draft.model?.cameras);
  }
  if (Array.isArray(snapshot.voptFlags)) {
    const rendering = ensureRenderingState(draft);
    rendering.voptFlags = snapshot.voptFlags.map((flag) => !!flag);
  }
  if (Array.isArray(snapshot.sceneFlags)) {
    const rendering = ensureRenderingState(draft);
    const flags = [];
    for (let i = 0; i < SCENE_FLAG_DEFAULTS.length; i += 1) {
      if (i < snapshot.sceneFlags.length && snapshot.sceneFlags[i] != null) {
        flags[i] = !!snapshot.sceneFlags[i];
      } else {
        flags[i] = SCENE_FLAG_DEFAULTS[i];
      }
    }
    rendering.sceneFlags = flags;
    const backups = ensureVisualBackups(draft);
    if (!backups.sceneFlagsModel) {
      backups.sceneFlagsModel = [...flags];
    }
    if (!backups.sceneFlagsPreset) {
      backups.sceneFlagsPreset = [...flags];
    }
  }
  if (snapshot.groups) {
    const rendering = ensureRenderingState(draft);
    rendering.groups = normaliseGroupState(snapshot.groups);
  }
  if (typeof snapshot.labelMode === 'number' && Number.isFinite(snapshot.labelMode)) {
    const rendering = ensureRenderingState(draft);
    rendering.labelMode = Math.max(0, snapshot.labelMode | 0);
  }
  if (typeof snapshot.frameMode === 'number' && Number.isFinite(snapshot.frameMode)) {
    const rendering = ensureRenderingState(draft);
    rendering.frameMode = Math.max(0, snapshot.frameMode | 0);
  }
  if (snapshot.renderAssets) {
    const rendering = ensureRenderingState(draft);
    rendering.assets = snapshot.renderAssets;
  }
  if (snapshot.options) {
    if (!draft.model) draft.model = {};
    draft.model.opt = {
      ...(draft.model.opt || {}),
      ...snapshot.options,
    };
    if (!draft.physics) {
      draft.physics = { disableFlags: {}, enableFlags: {}, actuatorGroups: {} };
    }
    if (typeof snapshot.options.disableflags === 'number' && Number.isFinite(snapshot.options.disableflags)) {
      draft.physics.disableFlags = flagsFromMask(snapshot.options.disableflags, DISABLE_FLAG_LABELS, false);
    }
    if (typeof snapshot.options.enableflags === 'number' && Number.isFinite(snapshot.options.enableflags)) {
      draft.physics.enableFlags = flagsFromMask(snapshot.options.enableflags, ENABLE_FLAG_LABELS, false);
    }
    if (typeof snapshot.options.disableactuator === 'number' && Number.isFinite(snapshot.options.disableactuator)) {
      draft.physics.actuatorGroups = flagsFromMask(
        snapshot.options.disableactuator,
        ACTUATOR_GROUP_LABELS,
        true,
      );
    }
    const rendering = ensureRenderingState(draft);
    if (typeof snapshot.options.flex_layer === 'number' && Number.isFinite(snapshot.options.flex_layer)) {
      rendering.flexLayer = Math.max(0, snapshot.options.flex_layer | 0);
    }
    if (typeof snapshot.options.bvh_depth === 'number' && Number.isFinite(snapshot.options.bvh_depth)) {
      rendering.bvhDepth = Math.max(0, snapshot.options.bvh_depth | 0);
    }
  }
  if (snapshot.visual) {
    if (!draft.model) draft.model = {};
    draft.model.vis = deepMerge(draft.model.vis || {}, snapshot.visual);
  }
  const baselines = ensureVisualBaselines(draft);
  if (snapshot.visualDefaults) {
    if (!draft.model) draft.model = {};
    draft.model.visDefaults = deepMerge(draft.model.visDefaults || {}, snapshot.visualDefaults);
    baselines.model = cloneStruct(snapshot.visualDefaults);
    baselines.sceneFlagsModel = normaliseSceneFlagArray(snapshot.sceneFlags);
    baselines.preset = applyPresetOverridesToStruct(baselines.model);
    baselines.sceneFlagsPreset = baselines.sceneFlagsModel ? [...baselines.sceneFlagsModel] : null;
  } else if (!baselines.model && snapshot.visual) {
    baselines.model = cloneStruct(snapshot.visual);
    baselines.sceneFlagsModel = normaliseSceneFlagArray(snapshot.sceneFlags);
    baselines.preset = applyPresetOverridesToStruct(baselines.model);
    baselines.sceneFlagsPreset = baselines.sceneFlagsModel ? [...baselines.sceneFlagsModel] : null;
  }
  if (snapshot.cameras) {
    if (!draft.model) draft.model = {};
    draft.model.cameras = Array.isArray(snapshot.cameras) ? snapshot.cameras.slice() : [];
  }
  if (snapshot.geoms) {
    if (!draft.model) draft.model = {};
    draft.model.geoms = Array.isArray(snapshot.geoms) ? snapshot.geoms.slice() : [];
    const maxGeom = draft.model.geoms.length - 1;
    if (typeof draft.runtime.trackingGeom === 'number' && draft.runtime.trackingGeom > maxGeom) {
      draft.runtime.trackingGeom = maxGeom >= 0 ? maxGeom : -1;
    }
    if (draft.runtime?.selection && draft.runtime.selection.geom > maxGeom) {
      resetSelectionState(draft.runtime);
    }
  }
  if (snapshot.geom_bodyid) {
    if (!draft.model) draft.model = {};
    draft.model.geomBodyId = snapshot.geom_bodyid;
  }
  if (snapshot.body_parentid) {
    if (!draft.model) draft.model = {};
    draft.model.bodyParentId = snapshot.body_parentid;
  }
  if (snapshot.body_jntadr) {
    if (!draft.model) draft.model = {};
    draft.model.bodyJntAdr = snapshot.body_jntadr;
  }
  if (snapshot.body_jntnum) {
    if (!draft.model) draft.model = {};
    draft.model.bodyJntNum = snapshot.body_jntnum;
  }
  if (snapshot.jtype) {
    if (!draft.model) draft.model = {};
    draft.model.jntType = snapshot.jtype;
  }
  if (typeof snapshot.nbody === 'number') {
    if (!draft.model) draft.model = {};
    draft.model.nbody = snapshot.nbody | 0;
  }
  if (typeof snapshot.njnt === 'number') {
    if (!draft.model) draft.model = {};
    draft.model.njnt = snapshot.njnt | 0;
  }
  if (snapshot.statistic) {
    if (!draft.model) draft.model = {};
    draft.model.stat = deepMerge(draft.model.stat || {}, snapshot.statistic);
  }
  if (snapshot.ctrl && mirrorCtrl) {
    if (!draft.model) draft.model = {};
    draft.model.ctrl = Array.isArray(snapshot.ctrl)
      ? snapshot.ctrl.slice()
      : Array.from(snapshot.ctrl);
  }
  if (snapshot.optionSupport) {
    if (!draft.model) draft.model = {};
    draft.model.optSupport = { ...snapshot.optionSupport };
  }
  if (typeof snapshot.cameraMode === 'number' && Number.isFinite(snapshot.cameraMode)) {
    const mode = snapshot.cameraMode | 0;
    draft.runtime.cameraIndex = mode;
    draft.runtime.cameraLabel = cameraLabelFromIndex(mode, draft.model?.cameras);
  }
}

function ensureRenderingState(target) {
  if (!target.rendering) {
    target.rendering = {
      voptFlags: DEFAULT_VOPT_FLAGS.slice(),
      sceneFlags: SCENE_FLAG_DEFAULTS.slice(),
      labelMode: 0,
      frameMode: 0,
      flexLayer: 0,
      bvhDepth: 1,
      groups: createViewerGroupState(true),
    };
  } else {
    if (!Array.isArray(target.rendering.voptFlags)) {
      target.rendering.voptFlags = DEFAULT_VOPT_FLAGS.slice();
    }
    if (!Array.isArray(target.rendering.sceneFlags)) {
      target.rendering.sceneFlags = SCENE_FLAG_DEFAULTS.slice();
    }
    if (target.rendering.sceneFlags.length !== SCENE_FLAG_DEFAULTS.length) {
      const normalised = [];
      for (let i = 0; i < SCENE_FLAG_DEFAULTS.length; i += 1) {
        if (i < target.rendering.sceneFlags.length && target.rendering.sceneFlags[i] != null) {
          normalised[i] = !!target.rendering.sceneFlags[i];
        } else {
          normalised[i] = SCENE_FLAG_DEFAULTS[i];
        }
      }
      target.rendering.sceneFlags = normalised;
    }
    if (typeof target.rendering.labelMode !== 'number') {
      target.rendering.labelMode = 0;
    }
    if (typeof target.rendering.frameMode !== 'number') {
      target.rendering.frameMode = 0;
    }
    if (typeof target.rendering.flexLayer !== 'number') {
      target.rendering.flexLayer = 0;
    }
    if (typeof target.rendering.bvhDepth !== 'number') {
      target.rendering.bvhDepth = 1;
    }
    if (!target.rendering.groups) {
      target.rendering.groups = createViewerGroupState(true);
    } else {
      target.rendering.groups = normaliseGroupState(target.rendering.groups);
    }
  }
  return target.rendering;
}

function ensureHistoryState(target) {
  if (!target.history) {
    target.history = createDefaultHistoryState();
  }
  return target.history;
}

function ensureWatchState(target) {
  if (!target.watch) {
    target.watch = createDefaultWatchState();
  }
  return target.watch;
}

function ensureKeyframeState(target) {
  if (!target.keyframes) {
    target.keyframes = createDefaultKeyframeState();
  }
  return target.keyframes;
}

function ensureThemeState(target) {
  if (!target.theme) {
    target.theme = {
      color: 0,
      spacing: 0,
      font: 0,
    };
  } else {
    if (typeof target.theme.color !== 'number' || !Number.isFinite(target.theme.color)) {
      target.theme.color = 0;
    }
    if (typeof target.theme.spacing !== 'number' || !Number.isFinite(target.theme.spacing)) {
      target.theme.spacing = 0;
    }
    if (typeof target.theme.font !== 'number' || !Number.isFinite(target.theme.font)) {
      target.theme.font = 0;
    }
  }
  return target.theme;
}
function applyBinding(draft, binding, value, control) {
  switch (binding) {
    case 'Simulate::help':
      draft.overlays.help = bool(value);
      return true;
    case 'Simulate::info':
      draft.overlays.info = bool(value);
      return true;
    case 'Simulate::profiler':
      draft.overlays.profiler = bool(value);
      return true;
    case 'Simulate::sensor':
      draft.overlays.sensor = bool(value);
      return true;
    case 'Simulate::fullscreen':
      draft.overlays.fullscreen = bool(value);
      return true;
    case 'Simulate::vsync':
      draft.overlays.vsync = bool(value);
      return true;
    case 'Simulate::busywait':
      draft.overlays.busywait = bool(value);
      return true;
    case 'Simulate::pause_update':
      draft.overlays.pauseUpdate = bool(value);
      return true;
    case 'Simulate::spacing': {
      const theme = ensureThemeState(draft);
      let idx = 0;
      if (typeof value === 'number') {
        idx = Math.max(0, Math.trunc(value));
      } else if (typeof value === 'string') {
        const token = value.trim().toLowerCase();
        if (/^[01]$/.test(token)) {
          idx = token === '1' ? 1 : 0;
        } else if (token.startsWith('wide')) {
          idx = 1;
        } else {
          idx = 0;
        }
      }
      theme.spacing = idx;
      return true;
    }
    case 'Simulate::color': {
      const theme = ensureThemeState(draft);
      let idx = 0;
      if (typeof value === 'number') {
        idx = Math.max(0, Math.trunc(value));
      } else if (typeof value === 'string') {
        const token = value.trim().toLowerCase();
        if (/^[01]$/.test(token)) {
          idx = token === '1' ? 1 : 0;
        } else if (token.startsWith('light')) {
          idx = 1;
        } else if (token.startsWith('dark')) {
          idx = 0;
        } else {
          idx = 0;
        }
      }
      theme.color = idx;
      return true;
    }
    case 'Simulate::font': {
      const theme = ensureThemeState(draft);
      const options = Array.isArray(control?.options) ? control.options : [];
      let idx = 0;
      if (typeof value === 'number') {
        idx = Math.max(0, Math.trunc(value));
      } else if (typeof value === 'string') {
        const trimmed = value.trim();
        const lower = trimmed.toLowerCase();
        const direct = options.findIndex(
          (opt) => String(opt).trim().toLowerCase() === lower,
        );
        if (direct >= 0) {
          idx = direct;
        } else {
          const match = lower.match(/(\d+)/);
          if (match) {
            const num = Number(match[1]);
            if (Number.isFinite(num) && num >= 50) {
              idx = Math.round((num - 50) / 50);
            }
          }
        }
      }
      if (options.length > 0) {
        idx = Math.min(Math.max(0, idx), options.length - 1);
      }
      theme.font = idx;
      return true;
    }
    case 'Simulate::tracking_geom': {
      const geomIdx = Math.trunc(toNumber(value));
      draft.runtime.trackingGeom = Number.isFinite(geomIdx) ? geomIdx : -1;
      return true;
    }
    default:
      break;
  }
  return false;
}

function formatKeyframeLabelFromState(state, index) {
  const keyframes = ensureKeyframeState(state);
  const slots = Array.isArray(keyframes.slots) && keyframes.slots.length
    ? keyframes.slots
    : (Array.isArray(keyframes.labels)
        ? keyframes.labels.map((label, slotIndex) => ({
            index: slotIndex,
            label,
            available: true,
            kind: 'user',
          }))
        : []);
  let idx = Number.isFinite(index) ? (index | 0) : 0;
  if (idx < 0) idx = 0;
  let slot = null;
  if (Array.isArray(slots) && slots.length) {
    slot = slots.find((s) => Number.isFinite(s.index) && (s.index | 0) === idx) || slots[idx] || null;
  }
  const baseLabel = slot && typeof slot.label === 'string' ? slot.label : `Key ${idx}`;
  if (slot && slot.available === false) {
    return `${baseLabel} (empty)`;
  }
  return baseLabel;
}

function applyControl(draft, control, value) {
  if (!control) return false;
  if (control.item_id === 'simulation.reset') {
    draft.toast = { message: 'Simulation reset', ts: Date.now() };
    return true;
  }
  if (control.item_id === 'simulation.reload') {
    draft.toast = { message: 'Model reloaded', ts: Date.now() };
    return true;
  }
  if (control.item_id === 'simulation.align') {
    draft.toast = { message: 'View aligned', ts: Date.now() };
    return true;
  }
  if (control.item_id === 'simulation.copy_state') {
    const precision = value && typeof value === 'object' && value.shiftKey ? 'full' : 'standard';
    draft.toast = { message: `State copied (${precision})`, ts: Date.now() };
    return true;
  }
  if (control.item_id === 'simulation.save_key') {
    const idx = draft.simulation?.keyIndex;
    const label = formatKeyframeLabelFromState(draft, idx);
    draft.toast = { message: `Saved keyframe ${label}`, ts: Date.now() };
    return true;
  }
  if (control.item_id === 'simulation.load_key') {
    const idx = draft.simulation?.keyIndex;
    const label = formatKeyframeLabelFromState(draft, idx);
    draft.toast = { message: `Loaded keyframe ${label}`, ts: Date.now() };
    return true;
  }
  if (control.item_id === 'file.quit') {
    draft.toast = { message: 'Quit requested', ts: Date.now() };
    return true;
  }
  if (control.item_id === 'option.help-toggle') {
    draft.overlays.help = bool(value);
    return true;
  }
  const binding = control.binding;
  if (binding) {
    return applyBinding(draft, binding, value, control);
  }
  return false;
}

function readBindingValue(state, binding, control) {
  switch (binding) {
    case 'Simulate::help':
      return !!state.overlays.help;
    case 'Simulate::info':
      return !!state.overlays.info;
    case 'Simulate::profiler':
      return !!state.overlays.profiler;
    case 'Simulate::sensor':
      return !!state.overlays.sensor;
    case 'Simulate::fullscreen':
      return !!state.overlays.fullscreen;
    case 'Simulate::vsync':
      return !!state.overlays.vsync;
    case 'Simulate::busywait':
      return !!state.overlays.busywait;
    case 'Simulate::pause_update':
      return !!state.overlays.pauseUpdate;
    case 'Simulate::run':
      if (control && Array.isArray(control.options)) {
        return state.simulation.run ? control.options[1] ?? 'Run' : control.options[0] ?? 'Pause';
      }
      return state.simulation.run;
    case 'Simulate::camera':
      return state.runtime.cameraIndex | 0;
    case 'Simulate::tracking_geom':
      return Number.isFinite(state.runtime.trackingGeom) ? state.runtime.trackingGeom : -1;
    case 'Simulate::scrub_index':
      return state.simulation.scrubIndex | 0;
    case 'Simulate::key':
      return state.simulation.keyIndex | 0;
    case 'Simulate::field':
      return state.watch?.field ?? 'qpos';
    case 'Simulate::index':
      return Number.isFinite(state.watch?.index) ? state.watch.index | 0 : 0;
    case 'Simulate::spacing':
      return Number.isFinite(state.theme?.spacing) ? state.theme.spacing | 0 : 0;
    case 'Simulate::color':
      return Number.isFinite(state.theme?.color) ? state.theme.color | 0 : 0;
    case 'Simulate::font':
      return Number.isFinite(state.theme?.font) ? state.theme.font | 0 : 0;
    case 'UpdateWatch': {
      if (state.watch?.summary) return state.watch.summary;
      if (typeof state.watch?.value === 'number' && Number.isFinite(state.watch.value)) {
        return state.watch.value.toFixed(6);
      }
      return '—';
    }
    default:
      break;
  }

  const groupMatch = binding?.match(/^mjvOption::(geom|site|joint|tendon|actuator|flex|skin)group\[(\d+)\]$/);
  if (groupMatch) {
    const type = groupMatch[1];
    const idx = Math.max(0, Math.trunc(toNumber(groupMatch[2])));
    const groups = state.rendering?.groups;
    const arr = Array.isArray(groups?.[type]) ? groups[type] : null;
    if (!arr) return true;
    if (idx >= 0 && idx < arr.length) {
      return !!arr[idx];
    }
    return true;
  }

  if (binding?.startsWith('Simulate::disable[')) {
    const name = control?.label ?? control?.name ?? binding;
    return !!state.physics.disableFlags[name];
  }
  if (binding?.startsWith('Simulate::enable[')) {
    const name = control?.label ?? control?.name ?? binding;
    return !!state.physics.enableFlags[name];
  }
  if (binding?.startsWith('Simulate::enableactuator[')) {
    const name = control?.label ?? control?.name ?? binding;
    return !!state.physics.actuatorGroups[name];
  }
  if (binding?.startsWith('Simulate::opt.')) {
    const field = binding.slice('Simulate::opt.'.length);
    if (field) {
      return state.rendering?.[field] ?? 0;
    }
  }
  const bindingParts = splitBinding(binding);
  if (bindingParts) {
    const { scope, path } = bindingParts;
    if (scope === 'mjOption') {
      const value = resolveStructPath(state.model?.opt, path);
      return value;
    }
    if (scope === 'mjVisual') {
      const value = resolveStructPath(state.model?.vis, path);
      return value;
    }
    if (scope === 'mjStatistic') {
      const value = resolveStructPath(state.model?.stat, path);
      return value;
    }
  }
  const voptMatch = binding?.match(/^mjvOption::flags\[(\d+)\]$/);
  if (voptMatch) {
    const idx = Number(voptMatch[1]);
    return !!state.rendering?.voptFlags?.[idx];
  }
  const sceneMatch = binding?.match(/^mjvScene::flags\[(\d+)\]$/);
  if (sceneMatch) {
    const idx = Number(sceneMatch[1]);
    return !!state.rendering?.sceneFlags?.[idx];
  }
  if (binding === 'mjvOption::label') {
    return state.rendering?.labelMode ?? 0;
  }
  if (binding === 'mjvOption::frame') {
    return state.rendering?.frameMode ?? 0;
  }
  return undefined;
}

function readControlValue(state, control) {
  if (!control) return undefined;
  if (control.item_id === 'simulation.reset') return null;
  if (control.item_id === 'simulation.align') return null;
  if (control.item_id === 'option.visual_source') {
    const mode = state.visualSourceMode || 'model';
    if (mode === 'model') return 'Model';
    if (mode === 'preset-moon') return 'PresetMoon';
    return 'PresetSun';
  }
  if (control.item_id === 'file.quit') return null;
  if (control.binding) {
    return readBindingValue(state, control.binding, control);
  }
  return undefined;
}

export function createViewerStore(initialState) {
  let state = deepMerge(DEFAULT_VIEWER_STATE, initialState);
  latestHudTime = Math.max(0, Number(state?.hud?.time) || 0);
  const listeners = new Set();

  function notify() {
    for (const fn of listeners) {
      try {
        fn(state);
      } catch (err) {
        logError(err);
      }
    }
  }

  return {
    get() {
      return state;
    },
    replace(next) {
      if (!next) return;
      state = deepMerge(DEFAULT_VIEWER_STATE, next);
      notify();
    },
    update(mutator) {
      mutator(state);
      if (!state.hud) state.hud = {};
      const currentTime = typeof state.hud.time === 'number' ? state.hud.time : 0;
      state.hud.time = Math.max(latestHudTime, currentTime);
      notify();
    },
    subscribe(fn) {
      listeners.add(fn);
      fn(state);
      return () => listeners.delete(fn);
    },
  };
}

export async function applySpecAction(store, backend, control, rawValue) {
  if (!control) return;
  const value = normaliseControlValue(control, rawValue);
  if (control.item_id === 'option.visual_source') {
    let nextMode = 'model';
    if (typeof value === 'string') {
      const token = value.toLowerCase();
      if (token.startsWith('model')) {
        nextMode = 'model';
      } else if (token.includes('moon')) {
        nextMode = 'preset-moon';
      } else {
        nextMode = 'preset-sun';
      }
    }
    try {
      await switchVisualSourceMode(store, backend, nextMode);
    } catch (err) {
      logError('[option.visual_source] switch failed', err);
    }
    return;
  }
  const isRunToggle = control.item_id === 'simulation.run' && typeof backend?.setRunState === 'function';
  let snapshot = null;
  if (backend) {
    try {
      if (isRunToggle && typeof backend.setRunState === 'function') {
        const runState = typeof value === 'string' ? value.toLowerCase() !== 'pause' : !!value;
        snapshot = await backend.setRunState(runState, 'ui');
      } else if (typeof backend.apply === 'function') {
        snapshot = await backend.apply({ kind: 'ui', id: control.item_id, value, control });
      }
    } catch (err) {
      logError('[backend.apply] failed', err);
    }
  }

  store.update((draft) => {
    applyControl(draft, control, value);
    if (snapshot) {
      mergeBackendSnapshot(draft, snapshot);
    }
  });
}

export function applyGesture(store, backend, payload) {
  if (!payload) return;
  const mode = payload.mode ?? 'idle';
  const phase = payload.phase ?? 'update';
  const pointer = payload.pointer
    ? {
        x: Number(payload.pointer.x) || 0,
        y: Number(payload.pointer.y) || 0,
        dx: Number(payload.pointer.dx) || 0,
        dy: Number(payload.pointer.dy) || 0,
        buttons: Number(payload.pointer.buttons ?? 0),
        pressure: Number(payload.pointer.pressure ?? 0),
      }
    : null;
  const drag = payload.drag ?? (pointer ? { dx: pointer.dx, dy: pointer.dy } : null);
  store.update((draft) => {
    const perturbActive = !!draft.runtime?.perturb?.active;
    const nextMode = phase === 'end' ? 'idle' : mode;
    draft.runtime.gesture = {
      ...(draft.runtime.gesture || {}),
      mode: nextMode,
      phase,
      pointer,
    };
    if (!perturbActive) {
      draft.runtime.lastAction = nextMode;
    }
    if (drag) {
      draft.runtime.drag = {
        dx: Number(drag.dx) || 0,
        dy: Number(drag.dy) || 0,
      };
    } else if (phase === 'end') {
      draft.runtime.drag = { dx: 0, dy: 0 };
      if (!draft.runtime.lastAction) {
        draft.runtime.lastAction = 'idle';
      }
    }
  });
  if (backend && typeof backend.apply === 'function') {
    Promise.resolve(
      backend.apply({
        kind: 'gesture',
        mode,
        phase,
        pointer,
        drag,
      }),
    )
      .then((snapshot) => {
        if (snapshot) {
          store.update((draft) => {
            mergeBackendSnapshot(draft, snapshot);
          });
        }
      })
      .catch((err) => {
        logError('[backend.apply gesture] failed', err);
      });
  }
}

const WORKER_URL = new URL('./physics.worker.mjs', import.meta.url);

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

  return {
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
    xpos: viewOrNull(state.xpos, Float64Array),
      xmat: viewOrNull(state.xmat, Float64Array),
      scn_ngeom: Number.isFinite(state.scn_ngeom) ? (state.scn_ngeom | 0) : 0,
      scn_type: viewOrNull(state.scn_type, Int32Array),
      scn_pos: viewOrNull(state.scn_pos, Float32Array),
      scn_mat: viewOrNull(state.scn_mat, Float32Array),
      scn_size: viewOrNull(state.scn_size, Float32Array),
      scn_rgba: viewOrNull(state.scn_rgba, Float32Array),
      scn_matid: viewOrNull(state.scn_matid, Int32Array),
      scn_dataid: viewOrNull(state.scn_dataid, Int32Array),
      scn_objtype: viewOrNull(state.scn_objtype, Int32Array),
      scn_objid: viewOrNull(state.scn_objid, Int32Array),
      scn_category: viewOrNull(state.scn_category, Int32Array),
      scn_segid: viewOrNull(state.scn_segid, Int32Array),
      scn_geomorder: viewOrNull(state.scn_geomorder, Int32Array),
      scn_transparent: viewOrNull(state.scn_transparent, Uint8Array),
      scn_label: viewOrNull(state.scn_label, Uint8Array),
      gsize: viewOrNull(state.gsize, Float64Array),
      gtype: viewOrNull(state.gtype, Int32Array),
      gmatid: viewOrNull(state.gmatid, Int32Array),
      geom_bodyid: viewOrNull(state.geom_bodyid, Int32Array),
      body_parentid: viewOrNull(state.body_parentid, Int32Array),
      body_jntadr: viewOrNull(state.body_jntadr, Int32Array),
      body_jntnum: viewOrNull(state.body_jntnum, Int32Array),
      jtype: viewOrNull(state.jtype, Int32Array),
      jnt_qposadr: viewOrNull(state.jnt_qposadr, Int32Array),
      jnt_range: viewOrNull(state.jnt_range, Float64Array),
      jnt_names: Array.isArray(state.jnt_names) ? state.jnt_names.slice() : null,
      qpos: viewOrNull(state.qpos, Float64Array),
      bxpos: viewOrNull(state.bxpos, Float64Array),
      bxmat: viewOrNull(state.bxmat, Float64Array),
      xipos: viewOrNull(state.xipos, Float64Array),
      ximat: viewOrNull(state.ximat, Float64Array),
      xanchor: viewOrNull(state.xanchor, Float64Array),
      dof_island: viewOrNull(state.dof_island, Int32Array),
      nisland: typeof state.nisland === 'number' ? (state.nisland | 0) : 0,
      bvh_active: viewOrNull(state.bvh_active, Uint8Array),
      bvh_aabb_dyn: viewOrNull(state.bvh_aabb_dyn, Float64Array),
      cam_xpos: viewOrNull(state.cam_xpos, Float64Array),
      cam_xmat: viewOrNull(state.cam_xmat, Float64Array),
    light_xpos: viewOrNull(state.light_xpos, Float64Array),
    light_xdir: viewOrNull(state.light_xdir, Float64Array),
    jpos: viewOrNull(state.jpos, Float64Array),
    jaxis: viewOrNull(state.jaxis, Float64Array),
    jbody: viewOrNull(state.jbody, Int32Array),
    jtype: viewOrNull(state.jtype, Int32Array),
    act_trnid: viewOrNull(state.act_trnid, Int32Array),
    act_trntype: viewOrNull(state.act_trntype, Int32Array),
    act_cranklength: viewOrNull(state.act_cranklength, Float64Array),
    site_xpos: viewOrNull(state.site_xpos, Float64Array),
    site_xmat: viewOrNull(state.site_xmat, Float64Array),
    ten_wrapadr: viewOrNull(state.ten_wrapadr, Int32Array),
    ten_wrapnum: viewOrNull(state.ten_wrapnum, Int32Array),
    wrap_obj: viewOrNull(state.wrap_obj, Int32Array),
    wrap_xpos: viewOrNull(state.wrap_xpos, Float64Array),
    flexvert_xpos: viewOrNull(state.flexvert_xpos, Float32Array),
    sensor_type: viewOrNull(state.sensor_type, Int32Array),
    sensor_objid: viewOrNull(state.sensor_objid, Int32Array),
    eq_type: viewOrNull(state.eq_type, Int32Array),
    eq_obj1id: viewOrNull(state.eq_obj1id, Int32Array),
    eq_obj2id: viewOrNull(state.eq_obj2id, Int32Array),
    eq_objtype: viewOrNull(state.eq_objtype, Int32Array),
    eq_active0: viewOrNull(state.eq_active0, Uint8Array),
    eq_active: viewOrNull(state.eq_active, Uint8Array),
    eq_names: Array.isArray(state.eq_names) ? state.eq_names.slice() : null,
    eq_data: viewOrNull(state.eq_data, Float64Array),
    matrgba: viewOrNull(state.matrgba, Float32Array),
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
    options: state.options ?? null,
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
}

export async function createBackend(options = {}) {
  const mode = 'worker'; // play UI only supports worker backend
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
  const modelKey = modelToken.toLowerCase();
    const modelFile = resolveModelFileName(modelToken);
    const defaultModelFile = modelFile || MODEL_POOL[0] || null;
    const initialModelInfo = {
      token: modelToken || '',
      file: defaultModelFile,
      label: defaultModelFile || modelToken || '',
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

  await prefetchBindingIndex();

  async function spawnWorkerBackend() {
    const workerUrl = new URL(WORKER_URL.href);
    // Propagate forgeBase (if present) so the worker can choose
    // between local dist/ and forge CDN artifacts.
    try {
      if (typeof location !== 'undefined' && location.search) {
        const params = new URLSearchParams(location.search);
        const forgeBase = params.get('forgeBase');
        if (forgeBase) {
          workerUrl.searchParams.set('forgeBase', forgeBase);
        }
        const logToken = params.get('log');
        if (logToken) {
          workerUrl.searchParams.set('log', logToken);
        }
        const verboseToken = params.get('verbose');
        if (verboseToken) {
          workerUrl.searchParams.set('verbose', verboseToken);
        }
      }
    } catch {
      // ignore query parsing issues
    }
  workerUrl.searchParams.set('cb', String(Date.now()));
  const worker = new Worker(workerUrl, { type: 'module' });
  return worker;
}

async function loadDefaultXml() {
  const candidates = [];
  const seen = new Set();
  if (modelFile) {
    candidates.push({ file: modelFile, label: modelToken || modelFile });
  }
  // Always ensure we have a pool-backed fallback; no empty model fallback.
  for (const file of MODEL_POOL) {
    candidates.push({ file, label: file });
  }

  const errors = [];
  for (const candidate of candidates) {
    const file = candidate.file;
    if (!file || seen.has(file)) continue;
    seen.add(file);
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
  throw new Error(`No model loaded. Tried: ${Array.from(seen).join(', ')}. Errors: ${errors.join('; ')}`);
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
    lastSnapshot.xpos = makeView(data.xpos, new Float64Array(0), Float64Array);
    lastSnapshot.xmat = makeView(data.xmat, new Float64Array(0), Float64Array);
    if (typeof data.scn_ngeom === 'number' && Number.isFinite(data.scn_ngeom)) {
      lastSnapshot.scn_ngeom = data.scn_ngeom | 0;
    }
    if (data.scn_type) lastSnapshot.scn_type = makeView(data.scn_type, null, Int32Array);
    if (data.scn_pos) lastSnapshot.scn_pos = makeView(data.scn_pos, null, Float32Array);
    if (data.scn_mat) lastSnapshot.scn_mat = makeView(data.scn_mat, null, Float32Array);
    if (data.scn_size) lastSnapshot.scn_size = makeView(data.scn_size, null, Float32Array);
    if (data.scn_rgba) lastSnapshot.scn_rgba = makeView(data.scn_rgba, null, Float32Array);
    if (data.scn_matid) lastSnapshot.scn_matid = makeView(data.scn_matid, null, Int32Array);
    if (data.scn_dataid) lastSnapshot.scn_dataid = makeView(data.scn_dataid, null, Int32Array);
    if (data.scn_objtype) lastSnapshot.scn_objtype = makeView(data.scn_objtype, null, Int32Array);
    if (data.scn_objid) lastSnapshot.scn_objid = makeView(data.scn_objid, null, Int32Array);
    if (data.scn_category) lastSnapshot.scn_category = makeView(data.scn_category, null, Int32Array);
    if (data.scn_segid) lastSnapshot.scn_segid = makeView(data.scn_segid, null, Int32Array);
    if (data.scn_geomorder) lastSnapshot.scn_geomorder = makeView(data.scn_geomorder, null, Int32Array);
    if (data.scn_transparent) lastSnapshot.scn_transparent = makeView(data.scn_transparent, null, Uint8Array);
    if (data.scn_label) lastSnapshot.scn_label = makeView(data.scn_label, null, Uint8Array);
    if (data.bxpos) lastSnapshot.bxpos = makeView(data.bxpos, null, Float64Array);
    if (data.bxmat) lastSnapshot.bxmat = makeView(data.bxmat, null, Float64Array);
    if (data.xipos) lastSnapshot.xipos = makeView(data.xipos, null, Float64Array);
    if (data.ximat) lastSnapshot.ximat = makeView(data.ximat, null, Float64Array);
    if (data.xanchor) lastSnapshot.xanchor = makeView(data.xanchor, null, Float64Array);
    if (data.dof_island) lastSnapshot.dof_island = makeView(data.dof_island, null, Int32Array);
    if (typeof data.nisland === 'number' && Number.isFinite(data.nisland)) lastSnapshot.nisland = data.nisland | 0;
    if (data.bvh_active) lastSnapshot.bvh_active = makeView(data.bvh_active, null, Uint8Array);
    if (data.bvh_aabb_dyn) lastSnapshot.bvh_aabb_dyn = makeView(data.bvh_aabb_dyn, null, Float64Array);
    if (data.jtype) lastSnapshot.jtype = makeView(data.jtype, null, Int32Array);
    if (data.jpos) lastSnapshot.jpos = makeView(data.jpos, null, Float64Array);
    if (data.jaxis) lastSnapshot.jaxis = makeView(data.jaxis, null, Float64Array);
    if (data.jbody) lastSnapshot.jbody = makeView(data.jbody, null, Int32Array);
    if (data.act_trnid) lastSnapshot.act_trnid = makeView(data.act_trnid, null, Int32Array);
    if (data.act_trntype) lastSnapshot.act_trntype = makeView(data.act_trntype, null, Int32Array);
    if (data.act_cranklength) lastSnapshot.act_cranklength = makeView(data.act_cranklength, null, Float64Array);
    if (data.site_xpos) lastSnapshot.site_xpos = makeView(data.site_xpos, null, Float64Array);
    if (data.site_xmat) lastSnapshot.site_xmat = makeView(data.site_xmat, null, Float64Array);
    if (data.ten_wrapadr) lastSnapshot.ten_wrapadr = makeView(data.ten_wrapadr, null, Int32Array);
    if (data.ten_wrapnum) lastSnapshot.ten_wrapnum = makeView(data.ten_wrapnum, null, Int32Array);
    if (data.wrap_obj) lastSnapshot.wrap_obj = makeView(data.wrap_obj, null, Int32Array);
    if (data.wrap_xpos) lastSnapshot.wrap_xpos = makeView(data.wrap_xpos, null, Float64Array);
    if (data.flexvert_xpos) lastSnapshot.flexvert_xpos = makeView(data.flexvert_xpos, null, Float32Array);
    if (data.sensor_type) lastSnapshot.sensor_type = makeView(data.sensor_type, null, Int32Array);
    if (data.sensor_objid) lastSnapshot.sensor_objid = makeView(data.sensor_objid, null, Int32Array);
    if (data.eq_type) lastSnapshot.eq_type = makeView(data.eq_type, null, Int32Array);
    if (data.eq_obj1id) lastSnapshot.eq_obj1id = makeView(data.eq_obj1id, null, Int32Array);
      if (data.eq_obj2id) lastSnapshot.eq_obj2id = makeView(data.eq_obj2id, null, Int32Array);
      if (data.eq_objtype) lastSnapshot.eq_objtype = makeView(data.eq_objtype, null, Int32Array);
      if (data.eq_data) lastSnapshot.eq_data = makeView(data.eq_data, null, Float64Array);
      if (data.eq_active0) lastSnapshot.eq_active0 = makeView(data.eq_active0, null, Uint8Array);
      if (data.eq_active) lastSnapshot.eq_active = makeView(data.eq_active, null, Uint8Array);
      if (Array.isArray(data.eq_names)) lastSnapshot.eq_names = data.eq_names.slice();
      if (data.qpos) lastSnapshot.qpos = makeView(data.qpos, null, Float64Array);
      if (data.cam_xpos) lastSnapshot.cam_xpos = makeView(data.cam_xpos, null, Float64Array);
      if (data.cam_xmat) lastSnapshot.cam_xmat = makeView(data.cam_xmat, null, Float64Array);
      if (data.light_xpos) lastSnapshot.light_xpos = makeView(data.light_xpos, null, Float64Array);
      if (data.light_xdir) lastSnapshot.light_xdir = makeView(data.light_xdir, null, Float64Array);
      lastSnapshot.gsize = makeView(data.gsize, null, Float64Array);
    lastSnapshot.gtype = makeView(data.gtype, null, Int32Array);
    lastSnapshot.gmatid = makeView(data.gmatid, null, Int32Array);
    lastSnapshot.matrgba = makeView(data.matrgba, null, Float32Array);
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
        if (typeof data.measuredSlowdown === 'number' && Number.isFinite(data.measuredSlowdown)) {
          lastSnapshot.measuredSlowdown = data.measuredSlowdown;
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
          lastSnapshot.history = lastSnapshot.history || createDefaultHistoryState();
          lastSnapshot.history.captureHz = Number(data.history.captureHz) || 0;
          lastSnapshot.history.capacity = Number(data.history.capacity) || 0;
          lastSnapshot.history.count = Number(data.history.count) || 0;
          lastSnapshot.history.horizon = Number(data.history.horizon) || 0;
          lastSnapshot.history.scrubIndex = Number(data.history.scrubIndex) || 0;
          lastSnapshot.history.live = data.history.live !== false;
        }
        if (data.keyframes) {
          lastSnapshot.keyframes = lastSnapshot.keyframes || createDefaultKeyframeState();
          if (typeof data.keyframes.capacity === 'number') {
            lastSnapshot.keyframes.capacity = data.keyframes.capacity | 0;
          }
          if (typeof data.keyframes.count === 'number') {
            lastSnapshot.keyframes.count = Math.max(0, data.keyframes.count | 0);
          }
      if (Array.isArray(data.keyframes.labels)) {
        lastSnapshot.keyframes.labels = data.keyframes.labels.slice();
      }
      if (Array.isArray(data.keyframes.slots)) {
        lastSnapshot.keyframes.slots = data.keyframes.slots.map((slot) => ({
          index: Number(slot.index) || 0,
          label: typeof slot.label === 'string' ? slot.label : `Key ${slot.index | 0}`,
          kind: slot.kind || 'user',
          available: !!slot.available,
        }));
      }
          if (typeof data.keyframes.lastSaved === 'number') {
            lastSnapshot.keyframes.lastSaved = data.keyframes.lastSaved | 0;
          }
          if (typeof data.keyframes.lastLoaded === 'number') {
            lastSnapshot.keyframes.lastLoaded = data.keyframes.lastLoaded | 0;
          }
        }
        if (data.watch) {
          lastSnapshot.watch = lastSnapshot.watch || createDefaultWatchState();
          if (typeof data.watch.field === 'string') {
            lastSnapshot.watch.field = data.watch.field;
          }
          if (typeof data.watch.index === 'number') {
            lastSnapshot.watch.index = data.watch.index | 0;
          }
          if ('value' in data.watch) {
            const raw = Number(data.watch.value);
            lastSnapshot.watch.value = Number.isFinite(raw) ? raw : null;
          }
          const minVal = Number(data.watch.min);
          const maxVal = Number(data.watch.max);
          lastSnapshot.watch.min = Number.isFinite(minVal) ? minVal : null;
          lastSnapshot.watch.max = Number.isFinite(maxVal) ? maxVal : null;
          lastSnapshot.watch.samples = Number(data.watch.samples) || 0;
          lastSnapshot.watch.status = data.watch.status || lastSnapshot.watch.status || 'idle';
          lastSnapshot.watch.summary = data.watch.summary || lastSnapshot.watch.summary || '';
          lastSnapshot.watch.valid = !!data.watch.valid;
        }
        if (typeof data.keyIndex === 'number' && Number.isFinite(data.keyIndex)) {
          lastSnapshot.keyIndex = data.keyIndex | 0;
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
        lastSnapshot.keyframes = lastSnapshot.keyframes || createDefaultKeyframeState();
        const meta = data;
        if (typeof meta.capacity === 'number') {
          lastSnapshot.keyframes.capacity = meta.capacity | 0;
        }
        if (typeof meta.count === 'number') {
          lastSnapshot.keyframes.count = Math.max(0, meta.count | 0);
        }
        if (Array.isArray(meta.labels)) {
          lastSnapshot.keyframes.labels = meta.labels.slice();
        }
        if (Array.isArray(meta.slots)) {
          lastSnapshot.keyframes.slots = meta.slots.map((slot) => ({
            index: Number(slot.index) || 0,
            label: typeof slot.label === 'string' ? slot.label : `Key ${slot.index | 0}`,
            kind: slot.kind || 'user',
            available: !!slot.available,
          }));
        }
        if (typeof meta.lastSaved === 'number') {
          lastSnapshot.keyframes.lastSaved = meta.lastSaved | 0;
        }
        if (typeof meta.lastLoaded === 'number') {
          lastSnapshot.keyframes.lastLoaded = meta.lastLoaded | 0;
        }
        if (typeof meta.keyIndex === 'number' && Number.isFinite(meta.keyIndex)) {
          lastSnapshot.keyIndex = meta.keyIndex | 0;
        }
        notifyListeners();
        break;
      }
      case 'history': {
        const history = lastSnapshot.history || createDefaultHistoryState();
        history.captureHz = Number(data.captureHz) || 0;
        history.capacity = Math.max(0, Number(data.capacity) || 0);
        history.count = Math.max(0, Number(data.count) || 0);
        history.horizon = Number(data.horizon) || 0;
        history.scrubIndex = Number(data.scrubIndex) || 0;
        history.live = data.live !== false;
        lastSnapshot.history = history;
        notifyListeners();
        break;
      }
      case 'watch': {
        const watch = lastSnapshot.watch || createDefaultWatchState();
        if (typeof data.field === 'string') {
          watch.field = data.field;
        }
        if (typeof data.index === 'number' && Number.isFinite(data.index)) {
          watch.index = data.index | 0;
        }
        if ('value' in data) {
          const raw = Number(data.value);
          watch.value = Number.isFinite(raw) ? raw : null;
        }
        const minVal = Number(data.min);
        const maxVal = Number(data.max);
        watch.min = Number.isFinite(minVal) ? minVal : null;
        watch.max = Number.isFinite(maxVal) ? maxVal : null;
        watch.samples = Math.max(0, Number(data.samples) || 0);
        watch.status = data.status || watch.status || 'idle';
        watch.valid = !!data.valid;
        if (watch.valid && typeof watch.value === 'number') {
          watch.summary = watch.value.toPrecision(6);
        } else {
          watch.summary = '—';
        }
        lastSnapshot.watch = watch;
        notifyListeners();
        break;
      }
      case 'render_assets':
        if (data.assets) {
          lastSnapshot.renderAssets = data.assets;
          const rendering = ensureRenderingState(lastSnapshot);
          rendering.assets = data.assets;
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
      case 'info_debug': {
        if (typeof window !== 'undefined') {
          try {
            window.__infoDebug = data.info || null;
          } catch {}
        }
        break;
      }
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

  async function apply(payload) {
    if (!payload) {
      return resolveSnapshot(lastSnapshot);
    }
    if (payload.kind === 'gesture') {
      const mode = payload.mode ?? payload.gesture?.mode ?? 'idle';
      const phase = payload.phase ?? payload.gesture?.phase ?? 'update';
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
    if (binding === 'Simulate::camera') {
      const totalModes = Math.max(1, 2 + (lastSnapshot.cameras?.length || 0));
      const modeValue = Math.max(0, Math.min(totalModes - 1, Math.trunc(toNumber(value))));
      try { client.postMessage?.({ cmd: 'setCameraMode', mode: modeValue }); } catch (err) {
        logWarn('[backend camera] post failed', err);
      }
      return resolveSnapshot(lastSnapshot);
    }
    if (binding === 'Simulate::tracking_geom') {
      return resolveSnapshot(lastSnapshot);
    }
    const optMatch = binding?.match(/^Simulate::opt\.(flex_layer|bvh_depth)$/);
    if (optMatch) {
      const field = optMatch[1];
      const nextValue = Math.max(0, Math.trunc(toNumber(value)));
      try {
        client.postMessage?.({
          cmd: 'setVisualOption',
          field,
          value: nextValue,
        });
      } catch (err) {
        logWarn('[backend setVisualOption] post failed', err);
      }
      return resolveSnapshot(lastSnapshot);
    }
    if (applySimulateMaskBinding(binding, value, 'Simulate::disable', 'disableflags', false, 'disableflags')) {
      return resolveSnapshot(lastSnapshot);
    }
    if (applySimulateMaskBinding(binding, value, 'Simulate::enable', 'enableflags', false, 'enableflags')) {
      return resolveSnapshot(lastSnapshot);
    }
    if (applySimulateMaskBinding(binding, value, 'Simulate::enableactuator', 'disableactuator', true, 'disableactuator')) {
      return resolveSnapshot(lastSnapshot);
    }
    const groupMatch = binding?.match(/^mjvOption::(geom|site|joint|tendon|actuator|flex|skin)group\[(\d+)\]$/);
    if (groupMatch) {
      const type = groupMatch[1];
      const idx = Math.max(0, Math.trunc(toNumber(groupMatch[2])));
      if (idx < MJ_GROUP_COUNT) {
        try { client.postMessage?.({ cmd: 'setGroupState', group: type, index: idx, enabled: bool(value) }); } catch (err) {
          logWarn('[backend group] post failed', err);
        }
      }
      return resolveSnapshot(lastSnapshot);
    }
    if (id === 'simulation.history_scrubber') {
      const offset = Math.min(0, normaliseInt(value, 0));
      try { client.postMessage?.({ cmd: 'historyScrub', offset }); } catch (err) {
        logWarn('[backend history] post failed', err);
      }
      return resolveSnapshot(lastSnapshot);
    }
    if (id === 'simulation.key_slider') {
      const index = Math.max(-1, normaliseInt(value, -1));
      try {
        client.postMessage?.({ cmd: 'keyframeSelect', index });
      } catch (err) {
        logWarn('[backend keyframe select] failed', err);
      }
      return resolveSnapshot(lastSnapshot);
    }
    if (id === 'simulation.save_key') {
      const index = normaliseInt(lastSnapshot.keyIndex ?? -1, -1);
      try { client.postMessage?.({ cmd: 'keyframeSave', index }); } catch (err) {
        logWarn('[backend keyframe save] failed', err);
      }
      return resolveSnapshot(lastSnapshot);
    }
    if (id === 'simulation.load_key') {
      const index = Math.max(0, normaliseInt(lastSnapshot.keyIndex ?? 0, 0));
      try { client.postMessage?.({ cmd: 'keyframeLoad', index }); } catch (err) {
        logWarn('[backend keyframe load] failed', err);
      }
      return resolveSnapshot(lastSnapshot);
    }
    if (id === 'watch.field') {
      const field = typeof value === 'string' ? value.trim() : '';
      const nextField = field.length > 0 ? field : (lastSnapshot.watch?.field || '');
      if (!nextField) return resolveSnapshot(lastSnapshot);
      try {
        client.postMessage?.({
          cmd: 'setWatch',
          field: nextField,
          index: Number.isFinite(lastSnapshot.watch?.index) ? (lastSnapshot.watch.index | 0) : 0,
        });
      } catch (err) {
        logWarn('[backend watch field] failed', err);
      }
      return resolveSnapshot(lastSnapshot);
    }
    if (id === 'watch.index') {
      const target = Math.max(0, normaliseInt(value, 0));
      try {
        client.postMessage?.({
          cmd: 'setWatch',
          field: lastSnapshot.watch?.field,
          index: target,
        });
      } catch (err) {
        logWarn('[backend watch index] failed', err);
      }
      return resolveSnapshot(lastSnapshot);
    }
    // Generic actuator control (dynamic UI)
      if (id === 'control.actuator') {
        try {
          const idx = Number(value?.index ?? value?.i ?? value?.id);
          const v = Number(value?.value ?? value?.v ?? 0);
          if (Number.isFinite(idx) && idx >= 0) {
            client.postMessage?.({ cmd: 'setCtrl', index: idx | 0, value: v });
          }
        } catch (err) {
          logWarn('[backend control.actuator] failed', err);
        }
        return resolveSnapshot(lastSnapshot);
      }
      if (id === 'joint.slider') {
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
        }
        return resolveSnapshot(lastSnapshot);
      }
      if (id === 'equality.toggle') {
        try {
          const idx = Number(value?.index ?? value?.i);
          const active = !!(value?.active ?? value?.value ?? value?.v);
          if (Number.isFinite(idx) && idx >= 0) {
            client.postMessage?.({ cmd: 'setEqualityActive', index: idx | 0, active });
          }
        } catch (err) {
          logWarn('[backend equality.toggle] failed', err);
        }
        return resolveSnapshot(lastSnapshot);
      }
    if (id === 'control.clear') {
      try {
        const acts = Array.isArray(lastSnapshot.actuators) ? lastSnapshot.actuators : [];
        for (let i = 0; i < acts.length; i += 1) {
          try { client.postMessage?.({ cmd: 'setCtrl', index: i, value: 0 }); } catch {}
        }
      } catch {}
      return resolveSnapshot(lastSnapshot);
    }
    const prepared = await prepareBindingUpdate(control, value);
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
    const voptMatch = binding?.match(/^mjvOption::flags\[(\d+)\]$/);
    if (voptMatch) {
      const idx = Number(voptMatch[1]);
      const enabled = bool(value);
      try { client.postMessage?.({ cmd: 'setVoptFlag', index: idx, enabled }); } catch (err) {
        logWarn('[backend vopt flag] post failed', err);
      }
      return resolveSnapshot(lastSnapshot);
    }
    const sceneMatch = binding?.match(/^mjvScene::flags\[(\d+)\]$/);
    if (sceneMatch) {
      const idx = Number(sceneMatch[1]);
      const enabled = bool(value);
      try { client.postMessage?.({ cmd: 'setSceneFlag', index: idx, enabled }); } catch (err) {
        logWarn('[backend scene flag] post failed', err);
      }
      return resolveSnapshot(lastSnapshot);
    }
    if (binding === 'mjvOption::label') {
      const mode = Math.max(0, Math.trunc(toNumber(value)));
      try { client.postMessage?.({ cmd: 'setLabelMode', mode }); } catch (err) {
        logWarn('[backend label mode] post failed', err);
      }
      return resolveSnapshot(lastSnapshot);
    }
    if (binding === 'mjvOption::frame') {
      const mode = Math.max(0, Math.trunc(toNumber(value)));
      try { client.postMessage?.({ cmd: 'setFrameMode', mode }); } catch (err) {
        logWarn('[backend frame mode] post failed', err);
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

export {
  DEFAULT_VIEWER_STATE,
  applyControl,
  readControlValue,
  cameraLabelFromIndex,
  mergeBackendSnapshot,
  switchVisualSourceMode,
};
const VISUAL_OVERRIDE_PRESET = [
  { path: ['headlight', 'active'], kind: 'enum', size: 1, value: 1 },
  { path: ['headlight', 'ambient'], kind: 'float_vec', size: 3, value: [0.1, 0.1, 0.1] },
  { path: ['headlight', 'diffuse'], kind: 'float_vec', size: 3, value: [0.4, 0.4, 0.4] },
  { path: ['headlight', 'specular'], kind: 'float_vec', size: 3, value: [0.5, 0.5, 0.5] },
  { path: ['map', 'force'], kind: 'float', size: 1, value: 0.005 },
  { path: ['map', 'torque'], kind: 'float', size: 1, value: 0.1 },
  { path: ['map', 'alpha'], kind: 'float', size: 1, value: 0.3 },
  { path: ['map', 'fogstart'], kind: 'float', size: 1, value: 6 },
  { path: ['map', 'fogend'], kind: 'float', size: 1, value: 24 },
  { path: ['map', 'znear'], kind: 'float', size: 1, value: 0.01 },
  { path: ['map', 'zfar'], kind: 'float', size: 1, value: 50 },
  { path: ['map', 'haze'], kind: 'float', size: 1, value: 0.4 },
  { path: ['map', 'shadowclip'], kind: 'float', size: 1, value: 1 },
  { path: ['map', 'shadowscale'], kind: 'float', size: 1, value: 0.6 },
  { path: ['scale', 'forcewidth'], kind: 'float', size: 1, value: 0.1 },
  { path: ['scale', 'contactwidth'], kind: 'float', size: 1, value: 0.3 },
  { path: ['scale', 'contactheight'], kind: 'float', size: 1, value: 0.1 },
  { path: ['scale', 'connect'], kind: 'float', size: 1, value: 0.2 },
  { path: ['scale', 'com'], kind: 'float', size: 1, value: 0.4 },
  { path: ['scale', 'camera'], kind: 'float', size: 1, value: 0.3 },
  { path: ['scale', 'light'], kind: 'float', size: 1, value: 0.3 },
  { path: ['scale', 'selectpoint'], kind: 'float', size: 1, value: 0.2 },
  { path: ['scale', 'jointlength'], kind: 'float', size: 1, value: 1 },
  { path: ['scale', 'jointwidth'], kind: 'float', size: 1, value: 0.1 },
  { path: ['scale', 'actuatorlength'], kind: 'float', size: 1, value: 0.7 },
  { path: ['scale', 'actuatorwidth'], kind: 'float', size: 1, value: 0.2 },
  { path: ['scale', 'framelength'], kind: 'float', size: 1, value: 1 },
  { path: ['scale', 'framewidth'], kind: 'float', size: 1, value: 0.1 },
  { path: ['scale', 'constraint'], kind: 'float', size: 1, value: 0.1 },
  { path: ['scale', 'slidercrank'], kind: 'float', size: 1, value: 0.2 },
{ path: ['rgba', 'fog'], kind: 'float_vec', size: 4, value: [0.7, 0.75, 0.85, 1] },
{ path: ['rgba', 'haze'], kind: 'float_vec', size: 4, value: [0.9411765, 0.9568627, 1, 1] },
  { path: ['rgba', 'force'], kind: 'float_vec', size: 4, value: [1, 0.5, 0.5, 1] },
  { path: ['rgba', 'inertia'], kind: 'float_vec', size: 4, value: [0.8, 0.2, 0.2, 0.6] },
  { path: ['rgba', 'joint'], kind: 'float_vec', size: 4, value: [0.2, 0.6, 0.8, 1] },
  { path: ['rgba', 'actuator'], kind: 'float_vec', size: 4, value: [0.2, 0.25, 0.2, 1] },
  { path: ['rgba', 'actuatornegative'], kind: 'float_vec', size: 4, value: [0.2, 0.6, 0.9, 1] },
  { path: ['rgba', 'actuatorpositive'], kind: 'float_vec', size: 4, value: [0.9, 0.4, 0.2, 1] },
  { path: ['rgba', 'com'], kind: 'float_vec', size: 4, value: [0.9, 0.9, 0.9, 1] },
  { path: ['rgba', 'contact'], kind: 'float_vec', size: 4, value: [1, 0.55, 0, 0.85] },
  { path: ['rgba', 'contactforce'], kind: 'float_vec', size: 4, value: [0.302, 0.486, 1, 0.8] },
  { path: ['rgba', 'camera'], kind: 'float_vec', size: 4, value: [0.6, 0.9, 0.6, 1] },
  { path: ['rgba', 'light'], kind: 'float_vec', size: 4, value: [0.6, 0.6, 0.9, 1] },
  { path: ['rgba', 'selectpoint'], kind: 'float_vec', size: 4, value: [0.9, 0.9, 0.1, 1] },
];

function applyPresetOverridesToStruct(base) {
  const source = cloneStruct(base) || {};
  for (const entry of VISUAL_OVERRIDE_PRESET) {
    const overrideValue = Array.isArray(entry.value) ? entry.value.slice() : entry.value;
    assignStructPath(source, entry.path, overrideValue);
  }
  return source;
}

function cloneVisualValue(value) {
  if (value == null) return null;
  if (ArrayBuffer.isView(value)) {
    return Array.from(value);
  }
  if (Array.isArray(value)) {
    return value.slice();
  }
  if (typeof value === 'object') {
    try {
      return JSON.parse(JSON.stringify(value));
    } catch {
      return value;
    }
  }
  return value;
}

function visualValuesEqual(a, b) {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  const aIsArray = Array.isArray(a) || ArrayBuffer.isView(a);
  const bIsArray = Array.isArray(b) || ArrayBuffer.isView(b);
  if (aIsArray || bIsArray) {
    const arrA = aIsArray ? Array.from(a) : [a];
    const arrB = bIsArray ? Array.from(b) : [b];
    if (arrA.length !== arrB.length) return false;
    for (let i = 0; i < arrA.length; i += 1) {
      if (!visualValuesEqual(arrA[i], arrB[i])) {
        return false;
      }
    }
    return true;
  }
  if (typeof a === 'number' || typeof b === 'number') {
    const numA = Number(a) || 0;
    const numB = Number(b) || 0;
    return Math.abs(numA - numB) < VISUAL_FLOAT_TOLERANCE;
  }
  if (typeof a === 'boolean' || typeof b === 'boolean') {
    return !!a === !!b;
  }
  return String(a) === String(b);
}

function computeVisualGroupDiffs(modelVisual, presetVisual) {
  const diagnostics = {};
  for (const group of VISUAL_FIELD_GROUPS) {
    const fields = [];
    let changed = false;
    for (const path of group.fields) {
      const modelValue = cloneVisualValue(resolveStructPath(modelVisual, path));
      const presetValue = cloneVisualValue(resolveStructPath(presetVisual, path));
      const equal = visualValuesEqual(modelValue, presetValue);
      if (!equal) changed = true;
      fields.push({
        path,
        modelValue,
        presetValue,
        equal,
      });
    }
    diagnostics[group.id] = {
      id: group.id,
      label: group.label,
      changed,
      fields,
    };
  }
  return diagnostics;
}

function ensureVisualBackups(target) {
  if (!target.visualBackups) {
    target.visualBackups = {
      model: null,
      sceneFlagsModel: null,
      presetSun: null,
      presetMoon: null,
      sceneFlagsPresetSun: null,
      sceneFlagsPresetMoon: null,
    };
  }
  return target.visualBackups;
}

function ensureVisualBaselines(target) {
  if (!target.visualBaselines) {
    target.visualBaselines = {
      model: null,
      sceneFlagsModel: null,
      presetSun: null,
      presetMoon: null,
      sceneFlagsPresetSun: null,
      sceneFlagsPresetMoon: null,
    };
  }
  return target.visualBaselines;
}

async function switchVisualSourceMode(store, backend, requestedMode) {
  const allowedModes = ['model', 'preset-sun', 'preset-moon'];
  const targetMode = allowedModes.includes(requestedMode) ? requestedMode : 'model';
  if (!store || typeof store.get !== 'function' || !backend || typeof backend.snapshot !== 'function') {
    throw new Error('switchVisualSourceMode requires a store and backend with snapshot support');
  }
  const currentState = store.get();
  const currentRaw = currentState?.visualSourceMode;
  const currentMode = allowedModes.includes(currentRaw) ? currentRaw : 'model';
  let snapshot;
  try {
    snapshot = await backend.snapshot();
  } catch (err) {
    logError('[visual source switch] snapshot failed', err);
    throw err;
  }
  if (!snapshot) {
    throw new Error('Unable to resolve backend snapshot for visual source switch');
  }
  const baselineVisual = snapshot.visualDefaults
    ? cloneStruct(snapshot.visualDefaults)
    : snapshot.visual
    ? cloneStruct(snapshot.visual)
    : null;
  const currentVisual = snapshot.visual
    ? cloneStruct(snapshot.visual)
    : snapshot.visualDefaults
    ? cloneStruct(snapshot.visualDefaults)
    : null;
  const currentSceneFlags = normaliseSceneFlagArray(snapshot.sceneFlags);
  store.update((draft) => {
    const backups = ensureVisualBackups(draft);
    const baselines = ensureVisualBaselines(draft);
    if (!baselines.model && baselineVisual) {
      baselines.model = cloneStruct(baselineVisual);
      baselines.sceneFlagsModel = normaliseSceneFlagArray(snapshot.sceneFlags);
    }
    if (!baselines.presetSun && baselines.model) {
      const presetBase = applyPresetOverridesToStruct(baselines.model);
      baselines.presetSun = cloneStruct(presetBase);
      baselines.sceneFlagsPresetSun = baselines.sceneFlagsModel ? [...baselines.sceneFlagsModel] : null;
    }
    if (!baselines.presetMoon && baselines.presetSun) {
      // Start moon from sun baseline; can diverge over time via backups.
      baselines.presetMoon = cloneStruct(baselines.presetSun);
      baselines.sceneFlagsPresetMoon = baselines.sceneFlagsPresetSun
        ? [...baselines.sceneFlagsPresetSun]
        : baselines.sceneFlagsModel
        ? [...baselines.sceneFlagsModel]
        : null;
    }
    if (currentMode === 'preset-sun') {
      backups.presetSun = cloneStruct(currentVisual) || cloneStruct(baselines.presetSun) || null;
      backups.sceneFlagsPresetSun = currentSceneFlags
        ? [...currentSceneFlags]
        : baselines.sceneFlagsPresetSun
        ? [...baselines.sceneFlagsPresetSun]
        : null;
    } else if (currentMode === 'preset-moon') {
      backups.presetMoon = cloneStruct(currentVisual) || cloneStruct(baselines.presetMoon) || null;
      backups.sceneFlagsPresetMoon = currentSceneFlags
        ? [...currentSceneFlags]
        : baselines.sceneFlagsPresetMoon
        ? [...baselines.sceneFlagsPresetMoon]
        : null;
    } else {
      backups.model = cloneStruct(currentVisual) || cloneStruct(baselines.model) || null;
      backups.sceneFlagsModel = currentSceneFlags
        ? [...currentSceneFlags]
        : baselines.sceneFlagsModel
        ? [...baselines.sceneFlagsModel]
        : null;
    }
  });
  const updatedState = store.get();
  const backups = ensureVisualBackups(updatedState);
  const baselines = ensureVisualBaselines(updatedState);
  let targetVisual = {};
  let targetSceneFlags = normaliseSceneFlagArray(null);
  if (targetMode === 'preset-sun') {
    const cache = backups.presetSun;
    const base = baselines.presetSun || baselines.model;
    targetVisual = cloneStruct(cache) || cloneStruct(base) || {};
    if (Array.isArray(backups.sceneFlagsPresetSun)) {
      targetSceneFlags = [...backups.sceneFlagsPresetSun];
    } else if (Array.isArray(baselines.sceneFlagsPresetSun)) {
      targetSceneFlags = [...baselines.sceneFlagsPresetSun];
    } else if (Array.isArray(baselines.sceneFlagsModel)) {
      targetSceneFlags = [...baselines.sceneFlagsModel];
    }
  } else if (targetMode === 'preset-moon') {
    const cache = backups.presetMoon;
    const base = baselines.presetMoon || baselines.presetSun || baselines.model;
    targetVisual = cloneStruct(cache) || cloneStruct(base) || {};
    if (Array.isArray(backups.sceneFlagsPresetMoon)) {
      targetSceneFlags = [...backups.sceneFlagsPresetMoon];
    } else if (Array.isArray(baselines.sceneFlagsPresetMoon)) {
      targetSceneFlags = [...baselines.sceneFlagsPresetMoon];
    } else if (Array.isArray(baselines.sceneFlagsPresetSun)) {
      targetSceneFlags = [...baselines.sceneFlagsPresetSun];
    } else if (Array.isArray(baselines.sceneFlagsModel)) {
      targetSceneFlags = [...baselines.sceneFlagsModel];
    }
  } else {
    const cache = backups.model;
    const base = baselines.model;
    targetVisual = cloneStruct(cache) || cloneStruct(base) || {};
    if (Array.isArray(backups.sceneFlagsModel)) {
      targetSceneFlags = [...backups.sceneFlagsModel];
    } else if (Array.isArray(baselines.sceneFlagsModel)) {
      targetSceneFlags = [...baselines.sceneFlagsModel];
    }
  }
  const diagnostics = computeVisualGroupDiffs(
    backups.model || baselines.model || {},
    backups.presetSun ||
      baselines.presetSun ||
      applyPresetOverridesToStruct(baselines.model || {}),
  );
  store.update((draft) => {
    draft.visualSourceMode = targetMode;
    if (!draft.model) draft.model = {};
    draft.model.vis = cloneStruct(targetVisual) || {};
    const rendering = ensureRenderingState(draft);
    rendering.sceneFlags = Array.isArray(targetSceneFlags)
      ? targetSceneFlags.slice()
      : SCENE_FLAG_DEFAULTS.slice();
    draft.visualDiagnostics = {
      diffs: diagnostics,
      timestamp: Date.now(),
    };
  });
  if (typeof backend.setVisualState === 'function') {
    try {
      await backend.setVisualState({ visual: targetVisual, sceneFlags: targetSceneFlags });
    } catch (err) {
      logError('[visual source switch] apply failed', err);
    }
  }
  return {
    mode: targetMode,
    visual: targetVisual,
    sceneFlags: targetSceneFlags,
  };
}

function normaliseSceneFlagArray(source) {
  const arr = [];
  for (let i = 0; i < SCENE_FLAG_DEFAULTS.length; i += 1) {
    if (Array.isArray(source) && source[i] != null) {
      arr[i] = !!source[i];
    } else {
      arr[i] = SCENE_FLAG_DEFAULTS[i];
    }
  }
  return arr;
}
