import * as THREE from 'three';
import {
  consumeViewerParams,
  isPerfEnabled,
  perfMarkOnce,
  perfNow,
  perfSample,
  logDebug,
  logWarn,
  logStatus,
  logError,
} from './viewer_runtime.mjs';
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
import { VISUAL_FIELD_DESCRIPTORS } from './viewer_structs.mjs';
import { createBackend } from './viewer_backend.mjs';

function clamp01(value) {
  if (!Number.isFinite(value)) return 0;
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

// Lightweight state container and backend helpers for the simulate parity UI.
// Runtime implementation lives in JS so it can be consumed directly by the
// buildless viewer. Type definitions are provided separately in viewer_state_types.ts.

const VISUAL_FLOAT_TOLERANCE = 1e-4;

const VISUAL_FIELD_GROUPS = [
  {
    id: 'headlight',
    label: 'Headlight',
    fields: [
      ['headlight', 'active'],
      ['headlight', 'ambient'],
      ['headlight', 'diffuse'],
      ['headlight', 'specular'],
    ],
    consumers: ['lighting'],
  },
  {
    id: 'fog',
    label: 'Fog',
    fields: [
      ['map', 'fogstart'],
      ['map', 'fogend'],
      ['rgba', 'fog'],
    ],
    sceneFlagIndex: 5,
    consumers: ['fog'],
  },
  {
    id: 'haze',
    label: 'Haze',
    fields: [
      ['map', 'haze'],
      ['rgba', 'haze'],
    ],
    sceneFlagIndex: 6,
    consumers: ['haze'],
  },
  {
    id: 'contact_points',
    label: 'Contact Points',
    fields: [
      ['scale', 'contactwidth'],
      ['scale', 'contactheight'],
      ['rgba', 'contact'],
    ],
    voptFlagIndex: 14,
    consumers: ['contact_points'],
  },
  {
    id: 'contact_forces',
    label: 'Contact Forces',
    fields: [
      ['map', 'force'],
      ['scale', 'forcewidth'],
      ['rgba', 'contactforce'],
    ],
    voptFlagIndex: 16,
    consumers: ['contact_forces'],
  },
  {
    id: 'select_point',
    label: 'Select Point',
    fields: [
      ['scale', 'selectpoint'],
      ['rgba', 'selectpoint'],
    ],
    consumers: ['selection'],
  },
];

let bindingIndex = null;
let bindingIndexPromise = null;

async function ensureBindingIndex() {
  if (bindingIndex) return bindingIndex;
  if (!bindingIndexPromise) {
    // Struct/binding index lives under dev/spec/; resolve relative to the
    // viewer module so both local dev (dev/) and GitHub Pages
    // (/mujoco-wasm-play/dev/) layouts work.
    const url = new URL('./spec/ui_bindings_index.json', import.meta.url);
    bindingIndexPromise = fetch(url, { cache: 'no-store' })
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to load ui_bindings_index.json (${res.status})`);
        return res.json();
      })
      .then((json) => json)
      .catch((err) => {
        logError('[bindings] load failed', err);
        throw err;
      });
  }
  bindingIndex = await bindingIndexPromise;
  return bindingIndex;
}

function resolveBindingSpec(binding, control = null) {
  if (!binding || typeof binding !== 'string') return null;
  const raw = binding.trim();
  if (!raw) return null;
  switch (raw) {
    case 'Simulate::help':
      return { kind: 'overlay', key: 'help' };
    case 'Simulate::info':
      return { kind: 'overlay', key: 'info' };
    case 'Simulate::profiler':
      return { kind: 'overlay', key: 'profiler' };
    case 'Simulate::sensor':
      return { kind: 'overlay', key: 'sensor' };
    case 'Simulate::fullscreen':
      return { kind: 'overlay', key: 'fullscreen' };
    case 'Simulate::vsync':
      return { kind: 'overlay', key: 'vsync' };
    case 'Simulate::busywait':
      return { kind: 'overlay', key: 'busywait' };
    case 'Simulate::pause_update':
      return { kind: 'overlay', key: 'pauseUpdate' };
    case 'Simulate::run':
      return { kind: 'run' };
    case 'Simulate::camera':
      return { kind: 'camera' };
    case 'Simulate::tracking_geom':
      return { kind: 'tracking_geom' };
    case 'Simulate::scrub_index':
      return { kind: 'scrub_index' };
    case 'Simulate::key':
      return { kind: 'key_index' };
    case 'Simulate::field':
      return { kind: 'watch_field' };
    case 'Simulate::index':
      return { kind: 'watch_index' };
    case 'Simulate::spacing':
      return { kind: 'theme', key: 'spacing' };
    case 'Simulate::color':
      return { kind: 'theme', key: 'color' };
    case 'Simulate::font':
      return { kind: 'theme', key: 'font' };
    case 'UpdateWatch':
      return { kind: 'watch_summary' };
    default:
      break;
  }

  const groupMatch = raw.match(/^mjvOption::(geom|site|joint|tendon|actuator|flex|skin)group\[(\d+)\]$/);
  if (groupMatch) {
    return { kind: 'group', group: groupMatch[1], index: Math.max(0, Math.trunc(toNumber(groupMatch[2]))) };
  }

  if (raw.startsWith('Simulate::disable[')) {
    return {
      kind: 'mask',
      mask: 'disable',
      name: control?.label ?? control?.name ?? raw,
    };
  }
  if (raw.startsWith('Simulate::enable[')) {
    return {
      kind: 'mask',
      mask: 'enable',
      name: control?.label ?? control?.name ?? raw,
    };
  }
  if (raw.startsWith('Simulate::enableactuator[')) {
    return {
      kind: 'mask',
      mask: 'enableactuator',
      name: control?.label ?? control?.name ?? raw,
    };
  }
  if (raw.startsWith('Simulate::opt.')) {
    const field = raw.slice('Simulate::opt.'.length);
    if (field) return { kind: 'sim_opt', field };
  }

  const bindingParts = splitBinding(raw);
  if (bindingParts) {
    const { scope, path } = bindingParts;
    if (scope === 'mjOption' || scope === 'mjVisual' || scope === 'mjStatistic') {
      return { kind: 'struct', scope, path };
    }
  }

  const voptMatch = raw.match(/^mjvOption::flags\[(\d+)\]$/);
  if (voptMatch) {
    return { kind: 'vopt_flag', index: Number(voptMatch[1]) };
  }
  const sceneMatch = raw.match(/^mjvScene::flags\[(\d+)\]$/);
  if (sceneMatch) {
    return { kind: 'scene_flag', index: Number(sceneMatch[1]) };
  }
  if (raw === 'mjvOption::label') return { kind: 'label_mode' };
  if (raw === 'mjvOption::frame') return { kind: 'frame_mode' };

  return { kind: 'unknown', binding: raw };
}

function getControlBindingSpec(control) {
  if (!control || !control.binding) return null;
  if (control.bindingSpec) return control.bindingSpec;
  const spec = resolveBindingSpec(control.binding, control);
  if (spec) {
    control.bindingSpec = spec;
  }
  return spec;
}

function parseNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function parseVector(value, length) {
  if (Array.isArray(value)) {
    const arr = value.map((v) => Number(v));
    return arr.every((n) => Number.isFinite(n)) && (!length || arr.length === length) ? arr : null;
  }
  if (typeof value === 'string') {
    const tokens = value.trim().split(/\s+/).filter(Boolean);
    if (length && tokens.length !== length) return null;
    const arr = tokens.map((token) => Number(token));
    return arr.every((n) => Number.isFinite(n)) ? arr : null;
  }
  if (value && typeof value === 'object') {
    try {
      const arr = Array.from(value, (v) => Number(v));
      if (arr.every((n) => Number.isFinite(n)) && (!length || arr.length === length)) {
        return arr;
      }
    } catch {}
  }
  const numeric = parseNumber(value);
  if (numeric == null) return null;
  const arr = [numeric];
  return length && length !== 1 ? null : arr;
}

function toBoolean(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const token = value.trim().toLowerCase();
    return token === '1' || token === 'true' || token === 'yes' || token === 'on';
  }
  if (value && typeof value === 'object') {
    if ('checked' in value) return !!value.checked;
    if ('value' in value) return toBoolean(value.value);
  }
  return !!value;
}

function normaliseEnumValue(control, rawValue) {
  if (!control) return null;
  const options = Array.isArray(control.options)
    ? control.options.map((opt) => String(opt))
    : [];
  if (typeof rawValue === 'number' && Number.isFinite(rawValue)) {
    return rawValue | 0;
  }
  const token = String(rawValue ?? '').trim();
  const idx = options.findIndex((opt) => opt === token);
  if (idx >= 0) return idx;
  if (token) {
    const numeric = Number(token);
    if (Number.isFinite(numeric)) return numeric | 0;
  }
  return null;
}

function normaliseValueByKind(kind, size, rawValue, control) {
  switch (kind) {
    case 'float':
      return parseNumber(rawValue);
    case 'float_vec':
      return parseVector(rawValue, size);
    case 'int': {
      const intVal = parseNumber(rawValue);
      return intVal != null ? intVal | 0 : null;
    }
    case 'enum':
      return normaliseEnumValue(control, rawValue);
    case 'bool':
      return toBoolean(rawValue);
    case 'string':
      return rawValue == null ? '' : String(rawValue);
    default:
      return null;
  }
}

function normaliseControlInput(control, rawValue) {
  if (!control) return rawValue;
  switch (control.type) {
    case 'checkbox':
      return toBoolean(rawValue);
    case 'slider_int':
    case 'edit_int':
      return Math.trunc(toNumber(rawValue));
    case 'slider_float':
    case 'edit_float':
    case 'slider_num':
    case 'slidernum':
      return toNumber(rawValue);
    case 'edit_vec3':
    case 'edit_vec3_string': {
      if (Array.isArray(rawValue)) {
        return rawValue.map((value) => toNumber(value));
      }
      if (typeof rawValue === 'string') {
        const parsed = parseVector(rawValue, 3);
        if (parsed) return parsed;
        return rawValue.trim();
      }
      return rawValue ?? '';
    }
    case 'edit_rgba':
      if (Array.isArray(rawValue)) {
        return rawValue.map((value) => String(value ?? '')).join(' ');
      }
      if (rawValue === null || rawValue === undefined) return '';
      return String(rawValue).trim();
    case 'radio':
      if (typeof rawValue === 'string') {
        if (control?.item_id === 'simulation.run') {
          return rawValue.toLowerCase() !== 'pause';
        }
        return rawValue;
      }
      if (Array.isArray(control.options) && typeof rawValue === 'number') {
        return control.options[rawValue] ?? control.options[0];
      }
      if (control?.item_id === 'simulation.run') {
        return toBoolean(rawValue);
      }
      return rawValue;
    case 'select':
      return rawValue;
    default:
      return rawValue;
  }
}

async function prepareBindingUpdate(control, rawValue) {
  const bindingRaw = control?.binding;
  const binding = typeof bindingRaw === 'string' ? bindingRaw.trim() : bindingRaw;
  if (!binding || typeof binding !== 'string') return null;
  if (binding === 'Simulate::run') return null;
  const meta = await ensureBindingIndex();
  const entry = meta?.[binding];
  if (!entry || !entry.value) {
    logWarn('[bindings] no binding metadata for', binding);
    return null;
  }
  const bindingParts = splitBinding(binding);
  if (!bindingParts) return null;
  // Simulate-level bindings are handled explicitly in the backend; do not
  // try to treat them as struct-backed fields here.
  if (bindingParts.scope === 'Simulate') {
    if (
      binding.startsWith('Simulate::disable[')
      || binding.startsWith('Simulate::enable[')
      || binding.startsWith('Simulate::enableactuator[')
    ) {
      return null;
    }
  }
  if (bindingParts.scope === 'mjvOption' || bindingParts.scope === 'mjvScene') {
    return null;
  }
  const { scope, path } = bindingParts;
  const kind = entry.value.kind || 'float';
  const size = entry.value.size || 1;
  if (kind === 'static') return null;
  const normalised = normaliseValueByKind(kind, size, rawValue, control);
  if (normalised == null) {
    logWarn('[bindings] unable to normalise value for', binding, rawValue);
    if (control && typeof control.binding === 'string' && control.binding.startsWith('mjVisual::headlight.')) {
      try {
        addToast(`[${control.label || 'headlight'}] invalid vector input`);
      } catch {}
    }
    return null;
  }
  return {
    meta: {
      scope,
      path,
      kind,
      size,
    },
    value: normalised,
  };
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

function cloneState(state) {
  if (typeof structuredClone === 'function') {
    return structuredClone(state);
  }
  return JSON.parse(JSON.stringify(state));
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

function resetModelFrontendState(store) {
  latestHudTime = 0;
  if (!store || typeof store.replace !== 'function') return;
  store.replace(DEFAULT_VIEWER_STATE);
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
  const model = draft.model || (draft.model = {});
  const rendering = ensureRenderingState(draft);
  const physics = draft.physics || (draft.physics = { disableFlags: {}, enableFlags: {}, actuatorGroups: {} });
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
  if (Array.isArray(snapshot.voptFlags)) {
    rendering.voptFlags = snapshot.voptFlags.map((flag) => !!flag);
  }
  if (Array.isArray(snapshot.sceneFlags)) {
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
    rendering.groups = normaliseGroupState(snapshot.groups);
  }
  if (typeof snapshot.labelMode === 'number' && Number.isFinite(snapshot.labelMode)) {
    rendering.labelMode = Math.max(0, snapshot.labelMode | 0);
  }
  if (typeof snapshot.frameMode === 'number' && Number.isFinite(snapshot.frameMode)) {
    rendering.frameMode = Math.max(0, snapshot.frameMode | 0);
  }
  if (snapshot.renderAssets) {
    rendering.assets = snapshot.renderAssets;
  }
  if (snapshot.options) {
    model.opt = {
      ...(model.opt || {}),
      ...snapshot.options,
    };
    if (typeof snapshot.options.disableflags === 'number' && Number.isFinite(snapshot.options.disableflags)) {
      physics.disableFlags = flagsFromMask(snapshot.options.disableflags, DISABLE_FLAG_LABELS, false);
    }
    if (typeof snapshot.options.enableflags === 'number' && Number.isFinite(snapshot.options.enableflags)) {
      physics.enableFlags = flagsFromMask(snapshot.options.enableflags, ENABLE_FLAG_LABELS, false);
    }
    if (typeof snapshot.options.disableactuator === 'number' && Number.isFinite(snapshot.options.disableactuator)) {
      physics.actuatorGroups = flagsFromMask(
        snapshot.options.disableactuator,
        ACTUATOR_GROUP_LABELS,
        true,
      );
    }
    if (typeof snapshot.options.flex_layer === 'number' && Number.isFinite(snapshot.options.flex_layer)) {
      rendering.flexLayer = Math.max(0, snapshot.options.flex_layer | 0);
    }
    if (typeof snapshot.options.bvh_depth === 'number' && Number.isFinite(snapshot.options.bvh_depth)) {
      rendering.bvhDepth = Math.max(0, snapshot.options.bvh_depth | 0);
    }
  }
  if (snapshot.visual) {
    model.vis = deepMerge(model.vis || {}, snapshot.visual);
  }
  const baselines = ensureVisualBaselines(draft);
  if (snapshot.visualDefaults) {
    model.visDefaults = deepMerge(model.visDefaults || {}, snapshot.visualDefaults);
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
    model.cameras = Array.isArray(snapshot.cameras) ? snapshot.cameras.slice() : [];
  }
  if (snapshot.geoms) {
    model.geoms = Array.isArray(snapshot.geoms) ? snapshot.geoms.slice() : [];
    const maxGeom = model.geoms.length - 1;
    if (typeof draft.runtime.trackingGeom === 'number' && draft.runtime.trackingGeom > maxGeom) {
      draft.runtime.trackingGeom = maxGeom >= 0 ? maxGeom : -1;
    }
    if (draft.runtime?.selection && draft.runtime.selection.geom > maxGeom) {
      resetSelectionState(draft.runtime);
    }
  }
  if (snapshot.geom_bodyid) {
    model.geomBodyId = snapshot.geom_bodyid;
  }
  if (snapshot.body_parentid) {
    model.bodyParentId = snapshot.body_parentid;
  }
  if (snapshot.body_jntadr) {
    model.bodyJntAdr = snapshot.body_jntadr;
  }
  if (snapshot.body_jntnum) {
    model.bodyJntNum = snapshot.body_jntnum;
  }
  if (snapshot.jtype) {
    model.jntType = snapshot.jtype;
  }
  if (typeof snapshot.nbody === 'number') {
    model.nbody = snapshot.nbody | 0;
  }
  if (typeof snapshot.njnt === 'number') {
    model.njnt = snapshot.njnt | 0;
  }
  if (snapshot.statistic) {
    model.stat = deepMerge(model.stat || {}, snapshot.statistic);
  }
  if (snapshot.optionSupport) {
    model.optSupport = { ...snapshot.optionSupport };
  }
  if (typeof snapshot.cameraMode === 'number' && Number.isFinite(snapshot.cameraMode)) {
    const mode = snapshot.cameraMode | 0;
    draft.runtime.cameraIndex = mode;
    draft.runtime.cameraLabel = cameraLabelFromIndex(mode, model?.cameras);
  }
}function ensureRenderingState(target) {
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

function ensureState(target, key, createFn) {
  if (!target[key]) {
    target[key] = createFn();
  }
  return target[key];
}

const ensureHistoryState = (target) => ensureState(target, 'history', createDefaultHistoryState);
const ensureWatchState = (target) => ensureState(target, 'watch', createDefaultWatchState);
const ensureKeyframeState = (target) => ensureState(target, 'keyframes', createDefaultKeyframeState);

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

function parseThemeBinary(value, { onTokens = [], offTokens = [] } = {}) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(0, Math.trunc(value));
  }
  if (typeof value === 'string') {
    const token = value.trim().toLowerCase();
    if (/^[01]$/.test(token)) return token === '1' ? 1 : 0;
    if (onTokens.some((t) => token.startsWith(t))) return 1;
    if (offTokens.some((t) => token.startsWith(t))) return 0;
  }
  return 0;
}
function applyBinding(draft, bindingOrSpec, value, control) {
  const spec = typeof bindingOrSpec === 'string'
    ? resolveBindingSpec(bindingOrSpec, control)
    : bindingOrSpec;
  if (!spec) return false;
  if (spec.kind === 'overlay') {
    draft.overlays[spec.key] = bool(value);
    return true;
  }
  if (spec.kind === 'theme') {
    const theme = ensureThemeState(draft);
    if (spec.key === 'spacing') {
      theme.spacing = parseThemeBinary(value, { onTokens: ['wide'] });
      return true;
    }
    if (spec.key === 'color') {
      theme.color = parseThemeBinary(value, { onTokens: ['light'], offTokens: ['dark'] });
      return true;
    }
    if (spec.key === 'font') {
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
    return false;
  }
  if (spec.kind === 'tracking_geom') {
    const geomIdx = Math.trunc(toNumber(value));
    draft.runtime.trackingGeom = Number.isFinite(geomIdx) ? geomIdx : -1;
    return true;
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
    const spec = getControlBindingSpec(control) || binding;
    return applyBinding(draft, spec, value, control);
  }
  return false;
}

function readBindingValue(state, bindingOrSpec, control) {
  const spec = typeof bindingOrSpec === 'string'
    ? resolveBindingSpec(bindingOrSpec, control)
    : bindingOrSpec;
  if (!spec) return undefined;
  switch (spec.kind) {
    case 'overlay':
      return !!state.overlays?.[spec.key];
    case 'run':
      if (control && Array.isArray(control.options)) {
        return state.simulation.run ? control.options[1] ?? 'Run' : control.options[0] ?? 'Pause';
      }
      return state.simulation.run;
    case 'camera':
      return state.runtime.cameraIndex | 0;
    case 'tracking_geom':
      return Number.isFinite(state.runtime.trackingGeom) ? state.runtime.trackingGeom : -1;
    case 'scrub_index':
      return state.simulation.scrubIndex | 0;
    case 'key_index':
      return state.simulation.keyIndex | 0;
    case 'watch_field':
      return state.watch?.field ?? 'qpos';
    case 'watch_index':
      return Number.isFinite(state.watch?.index) ? state.watch.index | 0 : 0;
    case 'theme':
      return Number.isFinite(state.theme?.[spec.key]) ? state.theme[spec.key] | 0 : 0;
    case 'watch_summary': {
      if (state.watch?.summary) return state.watch.summary;
      if (typeof state.watch?.value === 'number' && Number.isFinite(state.watch.value)) {
        return state.watch.value.toFixed(6);
      }
      return '—';
    }
    case 'group': {
      const groups = state.rendering?.groups;
      const arr = Array.isArray(groups?.[spec.group]) ? groups[spec.group] : null;
      if (!arr) return true;
      if (spec.index >= 0 && spec.index < arr.length) {
        return !!arr[spec.index];
      }
      return true;
    }
    case 'mask': {
      const name = spec.name ?? spec.binding ?? '';
      if (spec.mask === 'disable') return !!state.physics.disableFlags[name];
      if (spec.mask === 'enable') return !!state.physics.enableFlags[name];
      if (spec.mask === 'enableactuator') return !!state.physics.actuatorGroups[name];
      return undefined;
    }
    case 'sim_opt':
      return state.rendering?.[spec.field] ?? 0;
    case 'struct': {
      if (spec.scope === 'mjOption') {
        return resolveStructPath(state.model?.opt, spec.path);
      }
      if (spec.scope === 'mjVisual') {
        return resolveStructPath(state.model?.vis, spec.path);
      }
      if (spec.scope === 'mjStatistic') {
        return resolveStructPath(state.model?.stat, spec.path);
      }
      return undefined;
    }
    case 'vopt_flag':
      return !!state.rendering?.voptFlags?.[spec.index];
    case 'scene_flag':
      return !!state.rendering?.sceneFlags?.[spec.index];
    case 'label_mode':
      return state.rendering?.labelMode ?? 0;
    case 'frame_mode':
      return state.rendering?.frameMode ?? 0;
    default:
      break;
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
    const spec = getControlBindingSpec(control) || control.binding;
    return readBindingValue(state, spec, control);
  }
  return undefined;
}

const LOCAL_CONTROL_IDS = new Set([
  'simulation.reset',
  'simulation.reload',
  'simulation.align',
  'simulation.copy_state',
  'simulation.save_key',
  'simulation.load_key',
  'file.quit',
  'option.help-toggle',
]);

function createViewerStore(initialState) {
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

async function applySpecAction(store, backend, control, rawValue) {
  if (!control) return;
  const value = normaliseControlInput(control, rawValue);
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
  const bindingSpec = getControlBindingSpec(control);
  const shouldApplyLocal =
    LOCAL_CONTROL_IDS.has(control.item_id)
    || (bindingSpec && (bindingSpec.kind === 'overlay' || bindingSpec.kind === 'theme' || bindingSpec.kind === 'tracking_geom'));
  if (shouldApplyLocal) {
    store.update((draft) => {
      applyControl(draft, control, value);
    });
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
  if (snapshot) {
    store.update((draft) => {
      mergeBackendSnapshot(draft, snapshot);
    });
  }
}

function applyGesture(store, backend, payload) {
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

function createInfiniteGridHelper({
  size1 = 1.0,
  size2 = 10.0,
  color = 0xffffff,
  distance = 400.0,
  axes = 'xyz',
  renderOrder = -5,
} = {}) {
  const colorObj = color instanceof THREE.Color ? color.clone() : new THREE.Color(color);
  const planeAxes = axes.slice(0, 2);
  const geometry = new THREE.PlaneGeometry(2, 2, 1, 1);
  const material = new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    transparent: true,
    depthWrite: true,
    depthTest: true,
    uniforms: {
      uSize1: { value: size1 },
      uSize2: { value: size2 },
      uColor: { value: colorObj },
      uDistance: { value: distance },
    },
    vertexShader: `
      varying vec3 worldPosition;
      uniform float uDistance;
      void main() {
        vec3 pos = position.${axes} * uDistance;
        pos.${planeAxes} += cameraPosition.${planeAxes};
        worldPosition = pos;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
      }
    `,
    fragmentShader: `
      varying vec3 worldPosition;
      uniform float uSize1;
      uniform float uSize2;
      uniform vec3 uColor;
      uniform float uDistance;

      float getGrid(float size) {
        vec2 r = worldPosition.${planeAxes} / size;
        vec2 grid = abs(fract(r - 0.5) - 0.5) / fwidth(r);
        float line = min(grid.x, grid.y);
        return 1.0 - min(line, 1.0);
      }

      void main() {
        float d = 1.0 - min(distance(cameraPosition.${planeAxes}, worldPosition.${planeAxes}) / uDistance, 1.0);
        float g1 = getGrid(uSize1);
        float g2 = getGrid(uSize2);
        float strength = mix(g2, g1, g1) * pow(d, 3.0);
        vec4 color = vec4(uColor.rgb, strength);
        color.a = mix(0.5 * color.a, color.a, g2);
        if (color.a <= 0.0) discard;
        gl_FragColor = color;
      }
    `,
    extensions: {
      derivatives: true,
    },
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = renderOrder;
  mesh.userData.infiniteGrid = {
    uniforms: material.uniforms,
    baseDistance: distance,
  };
  return mesh;
}

function createInfiniteGroundHelper({
  color = 0xffffff,
  distance = 2000.0,
  renderOrder = -10,
} = {}) {
  const colorObj = color instanceof THREE.Color ? color.clone() : new THREE.Color(color);
  const geometry = new THREE.PlaneGeometry(2, 2, 1, 1);
  const material = new THREE.MeshStandardMaterial({
    color: colorObj,
    roughness: 0.9,
    metalness: 0,
    transparent: true,
    opacity: 1,
    side: THREE.DoubleSide,
  });
  const uniforms = {
    uMuJoCoTexEnabled: { value: 0 },
    uMuJoCoMap: { value: null },
    uMuJoCoTexScl: { value: new THREE.Vector2(1, 1) },
    uDistance: { value: distance },
    uFadeStart: { value: distance * 0.9 },
    uFadeEnd: { value: distance },
    uQuadDistance: { value: distance },
    uFadePow: { value: 2.5 },
    uPlaneOrigin: { value: new THREE.Vector3(0, 0, 0) },
    uPlaneAxisU: { value: new THREE.Vector3(1, 0, 0) },
    uPlaneAxisV: { value: new THREE.Vector3(0, 1, 0) },
    uPlaneNormal: { value: new THREE.Vector3(0, 0, 1) },
    uGridStep: { value: 2.0 },
    uGridColor: { value: colorObj.clone() },
    uGridIntensity: { value: 0.2 },
  };
  material.extensions = material.extensions || {};
  material.extensions.derivatives = true;
  material.userData.infiniteUniforms = uniforms;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uMuJoCoTexEnabled = uniforms.uMuJoCoTexEnabled;
    shader.uniforms.uMuJoCoMap = uniforms.uMuJoCoMap;
    shader.uniforms.uMuJoCoTexScl = uniforms.uMuJoCoTexScl;
    shader.uniforms.uDistance = uniforms.uDistance;
    shader.uniforms.uFadeStart = uniforms.uFadeStart;
    shader.uniforms.uFadeEnd = uniforms.uFadeEnd;
    shader.uniforms.uQuadDistance = uniforms.uQuadDistance;
    shader.uniforms.uFadePow = uniforms.uFadePow;
    shader.uniforms.uPlaneOrigin = uniforms.uPlaneOrigin;
    shader.uniforms.uPlaneAxisU = uniforms.uPlaneAxisU;
    shader.uniforms.uPlaneAxisV = uniforms.uPlaneAxisV;
    shader.uniforms.uPlaneNormal = uniforms.uPlaneNormal;
    shader.uniforms.uGridStep = uniforms.uGridStep;
    shader.uniforms.uGridColor = uniforms.uGridColor;
    shader.uniforms.uGridIntensity = uniforms.uGridIntensity;
    shader.vertexShader = `
varying vec3 vInfiniteWorldPosition;
varying vec2 vPlaneCoord;
varying float vCameraSide;
uniform vec3 uPlaneOrigin;
uniform vec3 uPlaneAxisU;
uniform vec3 uPlaneAxisV;
uniform vec3 uPlaneNormal;
uniform float uDistance;
uniform float uQuadDistance;
${shader.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
      vec3 camVec = cameraPosition - uPlaneOrigin;
      float camSide = dot(camVec, uPlaneNormal);
      vec3 camProjected = cameraPosition - camSide * uPlaneNormal;
      float quadScale = uQuadDistance;
      if (quadScale <= 0.0) quadScale = uDistance;
      vec3 span = position.x * quadScale * uPlaneAxisU + position.y * quadScale * uPlaneAxisV;
      transformed = camProjected + span;
      vPlaneCoord = vec2(dot(transformed - uPlaneOrigin, uPlaneAxisU), dot(transformed - uPlaneOrigin, uPlaneAxisV));
      vCameraSide = camSide;`
    )}`.replace(
      '#include <worldpos_vertex>',
      `#include <worldpos_vertex>
      vec4 infiniteWorldPosition = modelMatrix * vec4(transformed, 1.0);
      vInfiniteWorldPosition = infiniteWorldPosition.xyz;`
    );
    shader.fragmentShader = `
varying vec3 vInfiniteWorldPosition;
varying vec2 vPlaneCoord;
varying float vCameraSide;
uniform float uMuJoCoTexEnabled;
uniform sampler2D uMuJoCoMap;
uniform vec2 uMuJoCoTexScl;
uniform float uDistance;
uniform float uFadeStart;
uniform float uFadeEnd;
uniform float uQuadDistance;
uniform float uFadePow;
uniform vec3 uPlaneOrigin;
uniform vec3 uPlaneAxisU;
uniform vec3 uPlaneAxisV;
uniform vec3 uPlaneNormal;
uniform float uGridStep;
uniform vec3 uGridColor;
uniform float uGridIntensity;
${shader.fragmentShader.replace(
      '#include <dithering_fragment>',
      `
      vec3 camVec = cameraPosition - uPlaneOrigin;
      vec2 camCoord = vec2(dot(camVec, uPlaneAxisU), dot(camVec, uPlaneAxisV));
      float planarDist = length(camCoord - vPlaneCoord);

      float baseRadius = max(1e-4, uQuadDistance);
      if (planarDist >= baseRadius) discard;

      float alpha = 1.0;

      float fadeStart = max(0.0, uFadeStart);
      float fadeEnd = max(fadeStart, uFadeEnd);
      if (fadeEnd > fadeStart + 1e-4 && uFadePow > 1e-5) {
        float t = clamp((planarDist - fadeStart) / max(fadeEnd - fadeStart, 1e-6), 0.0, 1.0);
        float hazeAlpha = pow(1.0 - t, uFadePow);
        alpha *= hazeAlpha;
      }

      float edge = smoothstep(baseRadius * 0.9, baseRadius, planarDist);
      alpha *= (1.0 - edge);

      if (vCameraSide < -0.01) {
        alpha *= 0.25;
      }
      if (alpha <= 0.0) discard;
      vec3 baseColor = gl_FragColor.rgb;
      if (uMuJoCoTexEnabled > 0.5) {
        vec2 uv = vPlaneCoord * max(uMuJoCoTexScl, vec2(1e-6));
        vec4 texColor = texture2D(uMuJoCoMap, uv);
        baseColor *= texColor.rgb;
      }
      if (uGridStep > 1e-6 && uGridIntensity > 1e-6) {
        vec2 r = vPlaneCoord / max(uGridStep, 1e-6);
        vec2 grid = abs(fract(r - 0.5) - 0.5) / fwidth(r);
        float line = min(grid.x, grid.y);
        float gridStrength = 1.0 - min(line, 1.0);
        float mixAmt = clamp(gridStrength * uGridIntensity, 0.0, 1.0);
        gl_FragColor.rgb = mix(baseColor, uGridColor, mixAmt);
      } else {
        gl_FragColor.rgb = baseColor;
      }
      gl_FragColor.a = alpha;
      #include <dithering_fragment>`
    )}`;
    material.userData.shader = shader;
  };
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = renderOrder;
  mesh.receiveShadow = true;
  mesh.matrixAutoUpdate = false;
  mesh.matrix.identity();
  mesh.updateMatrix();
  mesh.userData.infiniteGround = { uniforms };
  return mesh;
}

const MJ_GEOM = {
  PLANE: 0,
  HFIELD: 1,
  SPHERE: 2,
  CAPSULE: 3,
  ELLIPSOID: 4,
  CYLINDER: 5,
  BOX: 6,
  MESH: 7,
  SDF: 8,
  // rendering-only geom types (from mjmodel_tmp.h:mjtGeom)
  ARROW: 100,
  ARROW1: 101,
  ARROW2: 102,
  LINE: 103,
  LINEBOX: 104,
  FLEX: 105,
  SKIN: 106,
  LABEL: 107,
  TRIANGLE: 108,
  NONE: 1001,
};
const FIXED_CAMERA_OFFSET = 2;
const MJ_VIS = {
  CONVEXHULL: 0,
  TEXTURE: 1,
  JOINT: 2,
  CAMERA: 3,
  ACTUATOR: 4,
  ACTIVATION: 5,
  LIGHT: 6,
  TENDON: 7,
  RANGEFINDER: 8,
  CONSTRAINT: 9,
  INERTIA: 10,
  SCLINERTIA: 11,
  PERTFORCE: 12,
  PERTOBJ: 13,
  CONTACTPOINT: 14,
  ISLAND: 15,
  CONTACTFORCE: 16,
  CONTACTSPLIT: 17,
  TRANSPARENT: 18,
  AUTOCONNECT: 19,
  COM: 20,
  SELECT: 21,
  STATIC: 22,
  SKIN: 23,
  FLEXVERT: 24,
  FLEXEDGE: 25,
  FLEXFACE: 26,
  FLEXSKIN: 27,
  BODYBVH: 28,
  MESHBVH: 29,
  SDFITER: 30,
};
const MJ_OBJ = {
  UNKNOWN: 0,
  BODY: 1,
  XBODY: 2,
  JOINT: 3,
  DOF: 4,
  GEOM: 5,
  SITE: 6,
  CAMERA: 7,
  LIGHT: 8,
  FLEX: 9,
  MESH: 10,
  SKIN: 11,
  HFIELD: 12,
  TEXTURE: 13,
  MATERIAL: 14,
  PAIR: 15,
  EXCLUDE: 16,
  EQUALITY: 17,
  TENDON: 18,
  ACTUATOR: 19,
  SENSOR: 20,
  NUMERIC: 21,
  TEXT: 22,
  TUPLE: 23,
  KEY: 24,
  PLUGIN: 25,
  FRAME: 100,
  DEFAULT: 101,
  MODEL: 102,
};
const LABEL_TEXTURE_CACHE = new Map();
const LABEL_TEXTURE_VERSION = 3;
const LABEL_DEFAULT_HEIGHT = 0.08;
const LABEL_DEFAULT_OFFSET = 0.04;
const MJ_LABEL_STRIDE = 100;
const MJ_LABEL_DECODER = (typeof TextDecoder !== 'undefined') ? new TextDecoder('utf-8') : null;
const LABEL_LOD_NEAR = 2.0;
const LABEL_LOD_MID = 4.5;
const LABEL_LOD_FACTORS = { near: 2, mid: 1.4, far: 1 };
const __TMP_VEC3 = new THREE.Vector3();
const __TMP_VEC3_A = new THREE.Vector3();
const __TMP_VEC3_B = new THREE.Vector3();
const __TMP_VEC3_C = new THREE.Vector3();
const __TMP_VEC3_D = new THREE.Vector3();
const __TMP_COLOR = new THREE.Color();
const LABEL_DPR_CAP = 2;
const LABEL_GEOM_LIMIT = 120;
const TEMP_MAT4 = new THREE.Matrix4();
const DEFAULT_CLEAR_HEX = 0xd6dce4;
const GROUND_DISTANCE = 2000;
const PLANE_SIZE_EPS = 1e-9;
const RENDER_ORDER = Object.freeze({
  GROUND: -50,
});
const HAZE_TMP_HEAD = new THREE.Vector3();
const HAZE_TMP_PLANE_POS = new THREE.Vector3();
const HAZE_TMP_NORMAL = new THREE.Vector3();
const HAZE_TMP_DELTA = new THREE.Vector3();
const HAZE_TMP_MAT_HEAD = new THREE.Matrix4();
const HAZE_TMP_MAT_SCALE = new THREE.Matrix4();
const HAZE_TMP_MAT_ROT = new THREE.Matrix4();
const HAZE_TMP_MAT_LOCAL_T = new THREE.Matrix4();
const HAZE_TMP_MAT_LOCAL_S = new THREE.Matrix4();
const HAZE_TMP_MAT_FINAL = new THREE.Matrix4();
const TRANSPARENT_BIN_CAM_POS = new THREE.Vector3();
const TRANSPARENT_BIN_CAM_DIR = new THREE.Vector3();
const TRANSPARENT_BIN_WORLD_POS = new THREE.Vector3();

function isMatrixLike(value) {
  return value && typeof value.copy === 'function';
}

function getWorldScene(ctx, override = null) {
  if (override) return override;
  if (ctx?.sceneWorld) return ctx.sceneWorld;
  if (ctx?.scene) return ctx.scene;
  return null;
}

function renderWorldScene(ctx, renderer, options = {}) {
  if (!ctx || !renderer) return;
  const camera = options.camera || ctx.camera;
  const worldScene = getWorldScene(ctx, options.sceneWorld);
  if (!camera || !worldScene) return;
  const target = options.target ?? null;
  if (typeof renderer.setRenderTarget === 'function') {
    renderer.setRenderTarget(target);
  }
  if (options.clearColor !== undefined) {
    const alpha = options.clearAlpha ?? 1;
    renderer.setClearColor(options.clearColor, alpha);
  }
  renderer.clear(true, true, false);
  renderer.render(worldScene, camera);
  if (target) {
    renderer.setRenderTarget(null);
  }
}

function createGeomNameLookup(sourceList) {
  const lookup = new Map();
  if (!Array.isArray(sourceList)) return lookup;
  for (const entry of sourceList) {
    const idx = Number(entry?.index);
    if (!Number.isFinite(idx)) continue;
    const label = typeof entry?.name === 'string' ? entry.name.trim() : '';
    lookup.set(idx, label || `Geom ${idx}`);
  }
  return lookup;
}

function geomNameFromLookup(lookup, index) {
  if (lookup && lookup.has(index)) {
    return lookup.get(index);
  }
  return `Geom ${index}`;
}

function isInfinitePlaneSize(sizeVec) {
  if (!Array.isArray(sizeVec) || sizeVec.length < 2) return false;
  const sx = Math.abs(Number(sizeVec[0]) || 0);
  const sy = Math.abs(Number(sizeVec[1]) || 0);
  return sx <= PLANE_SIZE_EPS || sy <= PLANE_SIZE_EPS;
}

function applyGeomMetadata(mesh, meta) {
  if (!mesh || !meta) return;
  const userData = mesh.userData || (mesh.userData = {});
  if (meta.index != null) {
    userData.geomIndex = meta.index;
  }
  if (meta.type != null) {
    userData.geomType = meta.type;
  }
  if (meta.dataId != null) {
    userData.geomDataId = meta.dataId;
  }
  if (meta.size) {
    const src = meta.size;
    let geomSize = userData.geomSize;
    if (!Array.isArray(geomSize) || geomSize.length < 3) {
      geomSize = [0, 0, 0];
      userData.geomSize = geomSize;
    }
    geomSize[0] = Number(src[0]) || 0;
    geomSize[1] = Number(src[1]) || 0;
    geomSize[2] = Number(src[2]) || 0;
  }
  if (meta.grid != null) {
    userData.geomGrid = meta.grid;
  }
  if (meta.name) {
    userData.geomName = meta.name;
    mesh.name = meta.name;
  }
  if (meta.bodyId != null) {
    userData.geomBodyId = meta.bodyId;
  }
  if (meta.groupId != null) {
    userData.geomGroupId = meta.groupId;
    userData.geomGroup = meta.groupId;
  }
  if (meta.matId != null) {
    userData.geomMatId = meta.matId;
    userData.matId = meta.matId;
  }
  if (meta.rgba) {
    const src = meta.rgba;
    let geomRgba = userData.geomRgba;
    if (!Array.isArray(geomRgba) || geomRgba.length < 4) {
      geomRgba = [0, 0, 0, 1];
      userData.geomRgba = geomRgba;
    }
    geomRgba[0] = Number(src[0]) || 0;
    geomRgba[1] = Number(src[1]) || 0;
    geomRgba[2] = Number(src[2]) || 0;
    geomRgba[3] = Number(src[3]) || 0;
  }
  const md = userData.geomMetadata || (userData.geomMetadata = {});
  md.index = meta.index;
  md.type = meta.type;
  md.name = meta.name;
  md.bodyId = meta.bodyId;
  md.matId = meta.matId;
  md.dataId = meta.dataId;
  md.size = userData.geomSize || meta.size || null;
  md.grid = meta.grid;
  md.groupId = meta.groupId;
  md.rgba = userData.geomRgba || meta.rgba || null;
}

function applySkyboxVisibility(ctx, enabled, options = {}) {
  if (!ctx) return;
  const worldScene = getWorldScene(ctx);
  if (!worldScene) return;
  const useBlackBackground = options.useBlackOnDisable !== false;
  const baseClear = typeof ctx.baseClearHex === 'number' ? ctx.baseClearHex : DEFAULT_CLEAR_HEX;
  const skyEnabled = enabled !== false;
  if (!skyEnabled) {
    if (ctx.skyShader) ctx.skyShader.visible = false;
    worldScene.environment = null;
    worldScene.background = new THREE.Color(useBlackBackground ? 0x000000 : baseClear);
    pushSkyDebug(ctx, { mode: 'disable', useBlack: useBlackBackground });
    return;
  }
  ctx.envDirty = true;
  if (ctx.envFromHDRI && ctx.envRT && ctx.envRT.texture) {
    worldScene.environment = ctx.envRT.texture;
    if (ctx.hdriBackground) {
      worldScene.background = ctx.hdriBackground;
    }
    if (ctx.skyShader) ctx.skyShader.visible = false;
    pushSkyDebug(ctx, { mode: 'hdri', envRT: !!ctx.envRT, background: !!ctx.hdriBackground });
    return;
  }
  if (ctx.skyMode === 'shader' && ctx.skyShader) {
    ctx.skyShader.visible = true;
    worldScene.background = ctx.skyBackground || null;
    pushSkyDebug(ctx, { mode: 'sky-dome', skyVisible: true, background: !!ctx.skyBackground });
    return;
  }
  if (ctx.skyMode === 'cube') {
    worldScene.background = ctx.skyBackground || ctx.skyCube || null;
    if (ctx.skyShader) ctx.skyShader.visible = false;
    pushSkyDebug(ctx, { mode: 'sky-cube', background: !!worldScene.background });
    return;
  }
  // If no sky resources exist, fall back to a solid clear colour
  worldScene.background = new THREE.Color(baseClear);
  pushSkyDebug(ctx, { mode: 'fallback' });
}


function mat3ToQuat(m) {
  const m00 = m[0] ?? 1;
  const m01 = m[1] ?? 0;
  const m02 = m[2] ?? 0;
  const m10 = m[3] ?? 0;
  const m11 = m[4] ?? 1;
  const m12 = m[5] ?? 0;
  const m20 = m[6] ?? 0;
  const m21 = m[7] ?? 0;
  const m22 = m[8] ?? 1;
  const t = m00 + m11 + m22;
  let w = 1;
  let x = 0;
  let y = 0;
  let z = 0;
  if (t > 0) {
    const s = Math.sqrt(t + 1.0) * 2;
    w = 0.25 * s;
    x = (m21 - m12) / s;
    y = (m02 - m20) / s;
    z = (m10 - m01) / s;
  } else if (m00 > m11 && m00 > m22) {
    const s = Math.sqrt(1.0 + m00 - m11 - m22) * 2;
    w = (m21 - m12) / s;
    x = 0.25 * s;
    y = (m01 + m10) / s;
    z = (m02 + m20) / s;
  } else if (m11 > m22) {
    const s = Math.sqrt(1.0 + m11 - m00 - m22) * 2;
    w = (m02 - m20) / s;
    x = (m01 + m10) / s;
    y = 0.25 * s;
    z = (m12 + m21) / s;
  } else {
    const s = Math.sqrt(1.0 + m22 - m00 - m11) * 2;
    w = (m10 - m01) / s;
    x = (m02 + m20) / s;
    y = (m12 + m21) / s;
    z = 0.25 * s;
  }
  return new THREE.Quaternion(x, y, z, w);
}

function setQuatFromMat3(out, m00, m01, m02, m10, m11, m12, m20, m21, m22) {
  if (!out || typeof out.set !== 'function') return;
  const t = m00 + m11 + m22;
  let w = 1;
  let x = 0;
  let y = 0;
  let z = 0;
  if (t > 0) {
    const s = Math.sqrt(t + 1.0) * 2;
    w = 0.25 * s;
    x = (m21 - m12) / s;
    y = (m02 - m20) / s;
    z = (m10 - m01) / s;
  } else if (m00 > m11 && m00 > m22) {
    const s = Math.sqrt(1.0 + m00 - m11 - m22) * 2;
    w = (m21 - m12) / s;
    x = 0.25 * s;
    y = (m01 + m10) / s;
    z = (m02 + m20) / s;
  } else if (m11 > m22) {
    const s = Math.sqrt(1.0 + m11 - m00 - m22) * 2;
    w = (m02 - m20) / s;
    x = (m01 + m10) / s;
    y = 0.25 * s;
    z = (m12 + m21) / s;
  } else {
    const s = Math.sqrt(1.0 + m22 - m00 - m11) * 2;
    w = (m10 - m01) / s;
    x = (m02 + m20) / s;
    y = (m12 + m21) / s;
    z = 0.25 * s;
  }
  out.set(x, y, z, w);
}

function computeGeomRadius(type, sx, sy, sz) {
  const s1 = Math.abs(sx) || 0;
  const s2 = Math.abs(sy) || 0;
  const s3 = Math.abs(sz) || 0;
  switch (type) {
    case MJ_GEOM.SPHERE:
    case MJ_GEOM.ELLIPSOID:
      return Math.max(s1, s2, s3, 1e-3);
    case MJ_GEOM.CAPSULE:
      return Math.max(s1 + s2, 1e-3);
    case MJ_GEOM.CYLINDER:
      return Math.max(Math.sqrt(s1 * s1 + s2 * s2), 1e-3);
    case MJ_GEOM.BOX:
      return Math.max(Math.sqrt(s1 * s1 + s2 * s2 + s3 * s3), 1e-3);
    case MJ_GEOM.PLANE:
    case MJ_GEOM.HFIELD:
      return Math.max(s1, s2, 5);
    default:
      return Math.max(Math.sqrt(s1 * s1 + s2 * s2 + s3 * s3), 0.15);
  }
}

function clampUnit(value) {
  if (!Number.isFinite(value)) return 0;
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

function parseVectorLike(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    const tokens = value
      .trim()
      .split(/[\s,]+/)
      .map((token) => Number(token))
      .filter((num) => Number.isFinite(num));
    return tokens.length ? tokens : null;
  }
  if (value && typeof value === 'object') {
    try {
      const arr = Array.from(value, (v) => Number(v));
      return arr.every((n) => Number.isFinite(n)) ? arr : null;
    } catch {}
  }
  return null;
}

function rgbFromArray(arr, fallback = [1, 1, 1]) {
  const source = parseVectorLike(arr);
  if (Array.isArray(source) && source.length >= 3) {
    return [
      clampUnit(Number(source[0])),
      clampUnit(Number(source[1])),
      clampUnit(Number(source[2])),
    ];
  }
  return fallback.slice();
}

function alphaFromArray(color, fallback = 1) {
  const source = parseVectorLike(color);
  if (Array.isArray(source) && source.length >= 4) {
    const a = Number(source[3]);
    if (Number.isFinite(a)) {
      return clampUnit(a);
    }
  }
  return clampUnit(fallback);
}

function applyAppearanceToMaterial(mesh, appearance) {
  if (!mesh || !mesh.material || !appearance) return;
  const { color, opacity } = appearance;
  const mat = mesh.material;
  if (color && mat.color && typeof mat.color.setRGB === 'function') {
    const r = Math.max(0, Number(color[0]) || 0);
    const g = Math.max(0, Number(color[1]) || 0);
    const b = Math.max(0, Number(color[2]) || 0);
    if ((mat.color.r !== r) || (mat.color.g !== g) || (mat.color.b !== b)) {
      mat.color.setRGB(r, g, b);
    }
  }
  if ('opacity' in mat && opacity != null) {
    const nextOpacity = Number(opacity) || 0;
    const nextTransparent = nextOpacity < 0.999;
    if (mat.opacity !== nextOpacity) mat.opacity = nextOpacity;
    if (mat.transparent !== nextTransparent) mat.transparent = nextTransparent;
  }
  const userData = mesh.userData || (mesh.userData = {});
  if (appearance.rgba) {
    const src = appearance.rgba;
    let rgba = userData.geomRgba;
    if (!Array.isArray(rgba) || rgba.length < 4) {
      rgba = [0, 0, 0, 1];
      userData.geomRgba = rgba;
    }
    rgba[0] = Number(src[0]) || 0;
    rgba[1] = Number(src[1]) || 0;
    rgba[2] = Number(src[2]) || 0;
    rgba[3] = Number(src[3]) || 0;
    userData.geomOpacity = opacity;
  }
}

function resolveFlexAppearance(index, assets) {
  const matIdView = assets?.flexes?.matid || null;
  const matIndex = matIdView && index < matIdView.length ? matIdView[index] : -1;
  const matRgbaView = assets?.materials?.rgba || null;
  const flexRgbaView = assets?.flexes?.rgba || null;
  if (matIndex >= 0 && matRgbaView && matRgbaView.length >= (matIndex * 4 + 4)) {
    const rgba = [
      matRgbaView[matIndex * 4 + 0],
      matRgbaView[matIndex * 4 + 1],
      matRgbaView[matIndex * 4 + 2],
      matRgbaView[matIndex * 4 + 3],
    ];
    return {
      rgba,
      color: rgbFromArray(rgba),
      opacity: alphaFromArray(rgba),
    };
  }
  if (matIndex < 0 && flexRgbaView && flexRgbaView.length >= (index * 4 + 4)) {
    const base = index * 4;
    const rgba = [
      flexRgbaView[base + 0],
      flexRgbaView[base + 1],
      flexRgbaView[base + 2],
      flexRgbaView[base + 3],
    ];
    return {
      rgba,
      color: rgbFromArray(rgba),
      opacity: alphaFromArray(rgba),
    };
  }
  return { rgba: null, color: null, opacity: null };
}

function resolveSkinAppearance(index, assets) {
  const matIdView = assets?.skins?.matid || null;
  const matIndex = matIdView && index < matIdView.length ? matIdView[index] : -1;
  const matRgbaView = assets?.materials?.rgba || null;
  const skinRgbaView = assets?.skins?.rgba || null;
  if (matIndex >= 0 && matRgbaView && matRgbaView.length >= (matIndex * 4 + 4)) {
    const rgba = [
      matRgbaView[matIndex * 4 + 0],
      matRgbaView[matIndex * 4 + 1],
      matRgbaView[matIndex * 4 + 2],
      matRgbaView[matIndex * 4 + 3],
    ];
    return {
      rgba,
      color: rgbFromArray(rgba),
      opacity: alphaFromArray(rgba),
    };
  }
  if (matIndex < 0 && skinRgbaView && skinRgbaView.length >= (index * 4 + 4)) {
    const base = index * 4;
    const rgba = [
      skinRgbaView[base + 0],
      skinRgbaView[base + 1],
      skinRgbaView[base + 2],
      skinRgbaView[base + 3],
    ];
    return {
      rgba,
      color: rgbFromArray(rgba),
      opacity: alphaFromArray(rgba),
    };
  }
  return { rgba: null, color: null, opacity: null };
}

function resolveMaterialTextureDescriptor(matId, assets) {
  const materials = assets?.materials || null;
  const texIdView = materials?.texid || null;
  if (!texIdView || !(matId >= 0) || matId >= texIdView.length) return null;
  const matCount = materials?.count | 0;
  const stride =
    matCount > 0 && texIdView.length >= matCount && texIdView.length % matCount === 0
      ? texIdView.length / matCount
      : 1;
  // Simulate uses mjTEXROLE_RGB (1) as the regular albedo texture source.
  const rolePreferred = stride > 1 ? 1 : 0;
  const idxPreferred = matId * stride + rolePreferred;
  const idxFallback = matId * stride;
  let texid = idxPreferred >= 0 && idxPreferred < texIdView.length ? (texIdView[idxPreferred] | 0) : -1;
  if (texid < 0 && idxFallback >= 0 && idxFallback < texIdView.length) {
    texid = texIdView[idxFallback] | 0;
  }
  if (!(texid >= 0)) return null;
  const repeatView = materials?.texrepeat || null;
  let repeatX = 1;
  let repeatY = 1;
  if (repeatView && repeatView.length >= (matId * 2 + 2)) {
    repeatX = Number(repeatView[matId * 2 + 0]) || 1;
    repeatY = Number(repeatView[matId * 2 + 1]) || 1;
  }
  const uniformView = materials?.texuniform || null;
  const uniform = !!(uniformView && matId < uniformView.length && uniformView[matId]);
  return { texid, repeatX, repeatY, uniform };
}

function getMuJoCoTextureCache(ctx) {
  if (!ctx) return null;
  ctx.assetCache = ctx.assetCache || {};
  ctx.assetCache.mjTextures = ctx.assetCache.mjTextures || new Map();
  return ctx.assetCache.mjTextures;
}

function createMuJoCoDataTexture(THREE, pixels, width, height, nchannel, colorspace = 0) {
  if (!pixels || !(width > 0) || !(height > 0) || !(nchannel > 0)) return null;
  const src = pixels;
  const ch = nchannel | 0;
  let rgbaPixels = src;
  if (ch !== 4) {
    const count = width * height;
    const out = new Uint8Array(count * 4);
    if (ch === 3) {
      for (let i = 0, j = 0; i < count; i += 1, j += 3) {
        const o = i * 4;
        out[o + 0] = src[j + 0] ?? 0;
        out[o + 1] = src[j + 1] ?? 0;
        out[o + 2] = src[j + 2] ?? 0;
        out[o + 3] = 255;
      }
    } else if (ch === 2) {
      // Interpret as luminance-alpha (r==g==b==L, a==A).
      for (let i = 0, j = 0; i < count; i += 1, j += 2) {
        const o = i * 4;
        const lum = src[j + 0] ?? 0;
        out[o + 0] = lum;
        out[o + 1] = lum;
        out[o + 2] = lum;
        out[o + 3] = src[j + 1] ?? 255;
      }
    } else if (ch === 1) {
      for (let i = 0; i < count; i += 1) {
        const o = i * 4;
        const lum = src[i] ?? 0;
        out[o + 0] = lum;
        out[o + 1] = lum;
        out[o + 2] = lum;
        out[o + 3] = 255;
      }
    } else {
      for (let i = 0; i < out.length; i += 4) {
        out[i + 3] = 255;
      }
    }
    rgbaPixels = out;
  }

  const tex = new THREE.DataTexture(rgbaPixels, width, height, THREE.RGBAFormat);
  tex.generateMipmaps = false;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.flipY = true;
  tex.unpackAlignment = 1;
  // Follow MuJoCo's resolved m->tex_colorspace: only promote to sRGB when the
  // model requests it (mjCOLORSPACE_SRGB = 2). AUTO/LINEAR stay linear.
  applyMuJoCoTextureColorspace(THREE, tex, colorspace);
  tex.needsUpdate = true;
  return tex;
}

function applyMuJoCoTextureColorspace(THREE, texture, colorspace = 0) {
  if (!texture) return;
  const isSrgb = (colorspace | 0) === 2;
  if (!isSrgb) return;
  if ('colorSpace' in texture && typeof THREE.SRGBColorSpace === 'string') {
    texture.colorSpace = THREE.SRGBColorSpace;
  } else if ('encoding' in texture && typeof THREE.sRGBEncoding === 'number') {
    texture.encoding = THREE.sRGBEncoding;
  }
}

function createMuJoCoCubeTexture(THREE, pixels, width, height, nchannel, colorspace = 0) {
  if (!pixels || !(width > 0) || !(height > 0) || !(nchannel > 0)) return null;
  const faceHeight = width;
  const faces = [];
  const faceByteStride = width * faceHeight * nchannel;
  if (height === faceHeight && pixels.length >= faceByteStride) {
    const facePixels = pixels.subarray(0, faceByteStride);
    for (let i = 0; i < 6; i += 1) {
      const faceTex = createMuJoCoDataTexture(THREE, facePixels, width, faceHeight, nchannel, colorspace);
      if (!faceTex) return null;
      faceTex.flipY = false;
      faces.push(faceTex);
    }
  } else if (height >= 6 * faceHeight) {
    for (let i = 0; i < 6; i += 1) {
      const start = i * faceByteStride;
      const end = start + faceByteStride;
      if (end > pixels.length) return null;
      const facePixels = pixels.subarray(start, end);
      const faceTex = createMuJoCoDataTexture(THREE, facePixels, width, faceHeight, nchannel, colorspace);
      if (!faceTex) return null;
      faceTex.flipY = false;
      faces.push(faceTex);
    }
  } else {
    return null;
  }
  const cube = new THREE.CubeTexture(faces);
  cube.generateMipmaps = false;
  cube.magFilter = THREE.LinearFilter;
  cube.minFilter = THREE.LinearFilter;
  cube.wrapS = THREE.ClampToEdgeWrapping;
  cube.wrapT = THREE.ClampToEdgeWrapping;
  cube.flipY = false;
  cube.unpackAlignment = 1;
  applyMuJoCoTextureColorspace(THREE, cube, colorspace);
  cube.needsUpdate = true;
  return cube;
}

function getOrCreateMuJoCoTexture(ctx, assets, descriptor) {
  if (!ctx || !assets || !descriptor) return null;
  const cache = getMuJoCoTextureCache(ctx);
  if (!cache) return null;
  const texid = descriptor.texid | 0;
  const key = `2d:${texid}`;
  if (cache.has(key)) return cache.get(key) || null;

  const texAssets = assets?.textures || null;
  const typeView = texAssets?.type || null;
  const widthView = texAssets?.width || null;
  const heightView = texAssets?.height || null;
  const nchannelView = texAssets?.nchannel || null;
  const adrView = texAssets?.adr || null;
  const colorspaceView = texAssets?.colorspace || null;
  const data = texAssets?.data || null;
  if (!widthView || !heightView || !nchannelView || !adrView || !data) return null;
  if (texid < 0 || texid >= widthView.length || texid >= heightView.length || texid >= nchannelView.length || texid >= adrView.length) {
    return null;
  }
  const texType = typeView && texid < typeView.length ? (typeView[texid] | 0) : 0;
  const baseWidth = widthView[texid] | 0;
  const baseHeight = heightView[texid] | 0;
  const width = baseWidth;
  // MuJoCo stores cube textures either as a single square face (height==width)
  // or as 6 faces packed back-to-back (often height==6*width). For now we take
  // the first face so textured materials at least render deterministically.
  const height = texType === 0 ? baseHeight : baseWidth;
  const nchannel = nchannelView[texid] | 0;
  const adr = adrView[texid] | 0;
  if (!(width > 0) || !(height > 0) || !(nchannel > 0) || !(adr >= 0)) return null;
  const byteLen = width * height * nchannel;
  const end = adr + byteLen;
  if (end > data.length) return null;

  const pixels = data.subarray(adr, end);
  const colorspace = colorspaceView && texid < colorspaceView.length ? (colorspaceView[texid] | 0) : 0;
  const texture = createMuJoCoDataTexture(THREE, pixels, width, height, nchannel, colorspace);
  if (!texture) return null;
  texture.repeat.set(1, 1);
  cache.set(key, texture);
  return texture;
}

function getOrCreateMuJoCoCubeTexture(ctx, assets, descriptor) {
  if (!ctx || !assets || !descriptor) return null;
  const cache = getMuJoCoTextureCache(ctx);
  if (!cache) return null;
  const texid = descriptor.texid | 0;
  const key = `cube:${texid}`;
  if (cache.has(key)) return cache.get(key) || null;

  const texAssets = assets?.textures || null;
  const widthView = texAssets?.width || null;
  const heightView = texAssets?.height || null;
  const nchannelView = texAssets?.nchannel || null;
  const adrView = texAssets?.adr || null;
  const colorspaceView = texAssets?.colorspace || null;
  const data = texAssets?.data || null;
  if (!widthView || !heightView || !nchannelView || !adrView || !data) return null;
  if (texid < 0 || texid >= widthView.length || texid >= heightView.length || texid >= nchannelView.length || texid >= adrView.length) {
    return null;
  }
  const width = widthView[texid] | 0;
  const height = heightView[texid] | 0;
  const nchannel = nchannelView[texid] | 0;
  const adr = adrView[texid] | 0;
  if (!(width > 0) || !(height > 0) || !(nchannel > 0) || !(adr >= 0)) return null;
  const byteLen = width * height * nchannel;
  const end = adr + byteLen;
  if (end > data.length) return null;
  const pixels = data.subarray(adr, end);
  const colorspace = colorspaceView && texid < colorspaceView.length ? (colorspaceView[texid] | 0) : 0;
  const cube = createMuJoCoCubeTexture(THREE, pixels, width, height, nchannel, colorspace);
  if (!cube) return null;
  cache.set(key, cube);
  return cube;
}

const MJ_MINVAL = 1e-12;
const MJ_TEXTURE = {
  TEX2D: 0,
};

function resolveMuJoCoTextureType(assets, texid) {
  const typeView = assets?.textures?.type || null;
  if (!typeView || !(texid >= 0) || texid >= typeView.length) return -1;
  return typeView[texid] | 0;
}

const TMP_TEX_SCALE3 = { scaleX: 1, scaleY: 1, scaleZ: 1 };
function quantize1e6(value) {
  const v = Number(value);
  if (!Number.isFinite(v)) return 0;
  return Math.round(v * 1e6);
}

function quantize1e3(value) {
  const v = Number(value);
  if (!Number.isFinite(v)) return 0;
  return Math.round(v * 1e3);
}

function resolveMuJoCoTexcoordScale3(geomType, geomSize, out = null) {
  const sx = Math.abs(Number(geomSize?.[0]) || 0);
  const sy = Math.abs(Number(geomSize?.[1]) || 0);
  const sz = Math.abs(Number(geomSize?.[2]) || 0);
  const scaleX = Math.max(MJ_MINVAL, sx);
  const scaleY = Math.max(MJ_MINVAL, sy);
  const scaleZ = Math.max(MJ_MINVAL, sz);
  if (out && typeof out === 'object') {
    out.scaleX = scaleX;
    out.scaleY = scaleY;
    out.scaleZ = scaleZ;
    return out;
  }
  switch (geomType | 0) {
    case MJ_GEOM.PLANE:
    case MJ_GEOM.HFIELD:
    case MJ_GEOM.BOX:
    case MJ_GEOM.SPHERE:
    case MJ_GEOM.ELLIPSOID:
    case MJ_GEOM.CYLINDER:
    case MJ_GEOM.CAPSULE:
      return { scaleX, scaleY, scaleZ };
    default:
      return { scaleX, scaleY, scaleZ };
  }
}

function ensureMuJoCo2DGeneratedTexcoords(mesh, geomType, geomSize, geomDataId, matId, descriptor) {
  if (!mesh || !mesh.geometry) return 0;
  const geometry = mesh.geometry;
  const positionAttr = geometry.getAttribute?.('position') || null;
  if (!positionAttr || !(positionAttr.count > 0)) return 0;

  const repeatX = Number.isFinite(descriptor?.repeatX) ? descriptor.repeatX : 1;
  const repeatY = Number.isFinite(descriptor?.repeatY) ? descriptor.repeatY : 1;
  const uniform = !!descriptor?.uniform;
  const size0 = Number(geomSize?.[0]) || 0;
  const size1 = Number(geomSize?.[1]) || 0;

  let scl0 = repeatX;
  let scl1 = repeatY;
  const did = geomDataId | 0;
  if (did >= 0) {
    if (size0 > 0) {
      scl0 /= Math.max(MJ_MINVAL, size0);
    }
    if (size1 > 0) {
      scl1 /= Math.max(MJ_MINVAL, size1);
    }
  }
  if (uniform) {
    if (size0 > 0) {
      scl0 *= size0;
    }
    if (size1 > 0) {
      scl1 *= size1;
    }
  }

  resolveMuJoCoTexcoordScale3(geomType, geomSize, TMP_TEX_SCALE3);
  const scaleX = TMP_TEX_SCALE3.scaleX;
  const scaleY = TMP_TEX_SCALE3.scaleY;
  const vcount = positionAttr.count | 0;
  const matKey = matId | 0;
  const geomTypeKey = geomType | 0;
  const qScl0 = quantize1e6(scl0);
  const qScl1 = quantize1e6(scl1);
  const qScaleX = quantize1e6(scaleX);
  const qScaleY = quantize1e6(scaleY);

  const userData = mesh.userData || (mesh.userData = {});
  if (
    userData.mj2dMatId === matKey &&
    userData.mj2dGeomType === geomTypeKey &&
    userData.mj2dDataId === did &&
    userData.mj2dVcount === vcount &&
    userData.mj2dScl0Q === qScl0 &&
    userData.mj2dScl1Q === qScl1 &&
    userData.mj2dScaleXQ === qScaleX &&
    userData.mj2dScaleYQ === qScaleY
  ) {
    return 1;
  }
  userData.mj2dMatId = matKey;
  userData.mj2dGeomType = geomTypeKey;
  userData.mj2dDataId = did;
  userData.mj2dVcount = vcount;
  userData.mj2dScl0Q = qScl0;
  userData.mj2dScl1Q = qScl1;
  userData.mj2dScaleXQ = qScaleX;
  userData.mj2dScaleYQ = qScaleY;
  if ('mj2dTexcoordKey' in userData) userData.mj2dTexcoordKey = null;

  if (userData.ownGeometry === false) {
    const cloned = geometry.clone();
    mesh.geometry = cloned;
    userData.ownGeometry = true;
  }

  const uv = new Float32Array(vcount * 2);
  for (let i = 0; i < vcount; i += 1) {
    const x = positionAttr.getX(i);
    const y = positionAttr.getY(i);
    const x0 = x / scaleX;
    const y0 = y / scaleY;
    uv[i * 2 + 0] = 0.5 * scl0 * x0 - 0.5;
    uv[i * 2 + 1] = -0.5 * scl1 * y0 - 0.5;
  }
  mesh.geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return 2;
}

function ensureMuJoCoCubeAlbedoHooks(material) {
  if (!material) return;
  material.userData = material.userData || {};
  if (material.userData.mjCubeAlbedoHooks) return;
  const previous = typeof material.onBeforeCompile === 'function' ? material.onBeforeCompile : null;
  material.onBeforeCompile = (shader, renderer) => {
    if (previous) previous(shader, renderer);
    shader.uniforms.mjCubeMap = { value: null };
    shader.uniforms.mjCubeScale = { value: new THREE.Vector3(1, 1, 1) };
    shader.uniforms.mjCubeEnabled = { value: 0 };
    material.userData.mjCubeShader = shader;

    if (!shader.vertexShader.includes('varying vec3 vMjObjPos')) {
      shader.vertexShader = `varying vec3 vMjObjPos;\n${shader.vertexShader}`;
      shader.vertexShader = shader.vertexShader.replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\n      vMjObjPos = transformed;'
      );
    }
    if (!shader.fragmentShader.includes('uniform samplerCube mjCubeMap')) {
      shader.fragmentShader = `uniform samplerCube mjCubeMap;\nuniform vec3 mjCubeScale;\nuniform float mjCubeEnabled;\nvarying vec3 vMjObjPos;\n${shader.fragmentShader}`;
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <map_fragment>',
        `#include <map_fragment>

      if (mjCubeEnabled > 0.5) {
        vec3 dir = normalize(vMjObjPos * mjCubeScale);
        vec4 cubeColor = textureCube(mjCubeMap, dir);
        diffuseColor *= cubeColor;
      }`
      );
    }
  };
  material.userData.mjCubeAlbedoHooks = true;
  material.needsUpdate = true;
}

function applyMuJoCoCubeAlbedo(mesh, cubeTexture, scaleVec3, enabled) {
  if (!mesh || !mesh.material) return;
  const material = mesh.material;
  if (!enabled) {
    const shader = material.userData?.mjCubeShader;
    if (shader?.uniforms?.mjCubeEnabled) {
      shader.uniforms.mjCubeEnabled.value = 0;
    }
    material.userData.mjCubeEnabled = 0;
    return;
  }
  ensureMuJoCoCubeAlbedoHooks(material);
  material.userData.mjCubeEnabled = 1;
  material.userData.mjCubeTexture = cubeTexture;
  material.userData.mjCubeScale = scaleVec3;
  const shader = material.userData.mjCubeShader;
  if (shader?.uniforms?.mjCubeEnabled) shader.uniforms.mjCubeEnabled.value = 1;
  if (shader?.uniforms?.mjCubeMap) shader.uniforms.mjCubeMap.value = cubeTexture;
  if (shader?.uniforms?.mjCubeScale && scaleVec3) shader.uniforms.mjCubeScale.value.copy(scaleVec3);
}

function applyMuJoCoTextureToMesh(mesh, matId, ctx, assets, textureEnabled, options = {}) {
  if (!mesh || !mesh.material || !ctx) return;
  const material = mesh.material;
  if (!('map' in material)) return;
  const perfOut = options?.perfOut || null;
  const isInfinitePlane = !!mesh.userData?.infinitePlane;
  if (isInfinitePlane) {
    const uniforms =
      mesh.userData?.infiniteGround?.uniforms ||
      material.userData?.infiniteUniforms ||
      null;
    if (material.map) {
      material.map = null;
      material.needsUpdate = true;
      if (perfOut) perfOut.texMapChanged = (perfOut.texMapChanged | 0) + 1;
    }
    if (!uniforms) return;
    if (!uniforms.uMuJoCoTexEnabled) uniforms.uMuJoCoTexEnabled = { value: 0 };
    if (!uniforms.uMuJoCoMap) uniforms.uMuJoCoMap = { value: null };
    if (!uniforms.uMuJoCoTexScl) uniforms.uMuJoCoTexScl = { value: new THREE.Vector2(1, 1) };

    if (!textureEnabled || !(matId >= 0) || !assets) {
      uniforms.uMuJoCoTexEnabled.value = 0;
      uniforms.uMuJoCoMap.value = null;
      return;
    }

    const desc = resolveMaterialTextureDescriptor(matId, assets);
    const texType = desc ? resolveMuJoCoTextureType(assets, desc.texid) : -1;
    const isCube = texType !== -1 && texType !== MJ_TEXTURE.TEX2D;
    const texture = desc && !isCube ? getOrCreateMuJoCoTexture(ctx, assets, desc) : null;
    if (!texture) {
      uniforms.uMuJoCoTexEnabled.value = 0;
      uniforms.uMuJoCoMap.value = null;
      return;
    }

    const repeatX = Number.isFinite(desc?.repeatX) ? desc.repeatX : 1;
    const repeatY = Number.isFinite(desc?.repeatY) ? desc.repeatY : 1;
    const scl = uniforms.uMuJoCoTexScl.value;
    if (scl?.set) {
      scl.set(repeatX, repeatY);
    }
    uniforms.uMuJoCoMap.value = texture;
    uniforms.uMuJoCoTexEnabled.value = 1;
    return;
  }
  if (!textureEnabled || !(matId >= 0)) {
    if (material.map) {
      material.map = null;
      material.needsUpdate = true;
      if (perfOut) perfOut.texMapChanged = (perfOut.texMapChanged | 0) + 1;
    }
    return;
  }
  if (!assets) {
    if (material.map) {
      material.map = null;
      material.needsUpdate = true;
      if (perfOut) perfOut.texMapChanged = (perfOut.texMapChanged | 0) + 1;
    }
    return;
  }
  const desc = resolveMaterialTextureDescriptor(matId, assets);
  const texType = desc ? resolveMuJoCoTextureType(assets, desc.texid) : -1;
  const isCube = texType !== -1 && texType !== MJ_TEXTURE.TEX2D;
  const texture = desc && !isCube ? getOrCreateMuJoCoTexture(ctx, assets, desc) : null;
  const nextMap = texture || null;
  if (material.map !== nextMap) {
    material.map = nextMap;
    material.needsUpdate = true;
    if (perfOut) perfOut.texMapChanged = (perfOut.texMapChanged | 0) + 1;
  }

  if (!desc) return;
  const texcoordMode = options?.texcoordMode || 'explicit';
  if (texType === MJ_TEXTURE.TEX2D && texcoordMode === 'generated') {
    const geomType = options?.geomType ?? (mesh.userData?.geomType ?? MJ_GEOM.BOX);
    const geomSize = options?.geomSize ?? (mesh.userData?.geomSize ?? null);
    const geomDataId = options?.geomDataId ?? (mesh.userData?.geomDataId ?? -1);
    if (Array.isArray(geomSize) && geomSize.length >= 2) {
      const uvStatus = ensureMuJoCo2DGeneratedTexcoords(mesh, geomType, geomSize, geomDataId, matId, desc);
      if (perfOut) {
        perfOut.texUvCalls = (perfOut.texUvCalls | 0) + 1;
        if (uvStatus === 1) perfOut.texUvCacheHit = (perfOut.texUvCacheHit | 0) + 1;
        else if (uvStatus === 2) perfOut.texUvRecompute = (perfOut.texUvRecompute | 0) + 1;
        else perfOut.texUvSkip = (perfOut.texUvSkip | 0) + 1;
      }
    }
  }

  if (!isCube) {
    applyMuJoCoCubeAlbedo(mesh, null, null, false);
    return;
  }
  const cube = getOrCreateMuJoCoCubeTexture(ctx, assets, desc);
  if (!cube) {
    applyMuJoCoCubeAlbedo(mesh, null, null, false);
    return;
  }
  const geomType = options?.geomType ?? (mesh.userData?.geomType ?? MJ_GEOM.BOX);
  const geomSize = options?.geomSize ?? (mesh.userData?.geomSize ?? null);
  resolveMuJoCoTexcoordScale3(geomType, geomSize, TMP_TEX_SCALE3);
  const scaleX = TMP_TEX_SCALE3.scaleX;
  const scaleY = TMP_TEX_SCALE3.scaleY;
  const scaleZ = TMP_TEX_SCALE3.scaleZ;
  const uniform = !!desc.uniform;
  const size0 = Number(geomSize?.[0]) || 0;
  const size1 = Number(geomSize?.[1]) || 0;
  const size2 = Number(geomSize?.[2]) || 0;
  const factorX = uniform ? size0 : 1;
  const factorY = uniform ? size1 : 1;
  const factorZ = uniform ? size2 : 1;
  const meshUserData = mesh.userData || (mesh.userData = {});
  const matKey = matId | 0;
  const uniformKey = uniform ? 1 : 0;
  const qFactorX = quantize1e6(factorX);
  const qFactorY = quantize1e6(factorY);
  const qFactorZ = quantize1e6(factorZ);
  const qScaleX = quantize1e6(scaleX);
  const qScaleY = quantize1e6(scaleY);
  const qScaleZ = quantize1e6(scaleZ);
  let scaleVec = meshUserData.mjCubeScaleVec;
  if (!scaleVec) {
    scaleVec = new THREE.Vector3(1, 1, 1);
    meshUserData.mjCubeScaleVec = scaleVec;
    meshUserData.mjCubeMatId = null;
    meshUserData.mjCubeUniform = null;
  }
  if (
    meshUserData.mjCubeMatId !== matKey ||
    meshUserData.mjCubeUniform !== uniformKey ||
    meshUserData.mjCubeFactorXQ !== qFactorX ||
    meshUserData.mjCubeFactorYQ !== qFactorY ||
    meshUserData.mjCubeFactorZQ !== qFactorZ ||
    meshUserData.mjCubeScaleXQ !== qScaleX ||
    meshUserData.mjCubeScaleYQ !== qScaleY ||
    meshUserData.mjCubeScaleZQ !== qScaleZ
  ) {
    scaleVec.set(factorX / scaleX, factorY / scaleY, factorZ / scaleZ);
    meshUserData.mjCubeMatId = matKey;
    meshUserData.mjCubeUniform = uniformKey;
    meshUserData.mjCubeFactorXQ = qFactorX;
    meshUserData.mjCubeFactorYQ = qFactorY;
    meshUserData.mjCubeFactorZQ = qFactorZ;
    meshUserData.mjCubeScaleXQ = qScaleX;
    meshUserData.mjCubeScaleYQ = qScaleY;
    meshUserData.mjCubeScaleZQ = qScaleZ;
    if ('mjCubeScaleKey' in meshUserData) meshUserData.mjCubeScaleKey = null;
  }
  applyMuJoCoCubeAlbedo(mesh, cube, scaleVec, true);
}

function averageRGB(arr) {
  if (!Array.isArray(arr) || arr.length === 0) return 0;
  return arr.reduce((acc, v) => acc + (Number(v) || 0), 0) / arr.length;
}

function isDisabledFlag(mask, bitIndex) {
  const m = Number(mask) || 0;
  const bit = bitIndex | 0;
  if (bit < 0 || bit >= 31) return false;
  return (m & (1 << bit)) !== 0;
}

function vec3Norm(x, y, z) {
  return Math.sqrt(x * x + y * y + z * z);
}

function vec3NormalizeInPlace(v) {
  const x = v[0] || 0;
  const y = v[1] || 0;
  const z = v[2] || 0;
  const n = vec3Norm(x, y, z);
  if (!(n > 1e-12)) {
    v[0] = 0; v[1] = 0; v[2] = 0;
    return 0;
  }
  const inv = 1 / n;
  v[0] = x * inv;
  v[1] = y * inv;
  v[2] = z * inv;
  return n;
}

function vec3Dot(ax, ay, az, bx, by, bz) {
  return ax * bx + ay * by + az * bz;
}

function coshSinh(x) {
  const expx = Math.exp(x);
  const inv = 1 / expx;
  return {
    cosh: 0.5 * (expx + inv),
    sinh: 0.5 * (expx - inv),
  };
}

function catenaryIntercept(v, h, length) {
  const term = Math.sqrt(Math.max(0, length * length - v * v)) / Math.max(1e-12, h) - 1;
  if (!(term > 0)) return 0;
  return 1 / Math.sqrt(Math.sqrt(term));
}

function catenaryResidual(b, intercept) {
  const a = 0.5 / b;
  const { cosh, sinh } = coshSinh(a);
  const denom = 2 * b * sinh - 1;
  if (!(denom > 0)) {
    return { res: Number.POSITIVE_INFINITY, grad: 0 };
  }
  const invSqrt = 1 / Math.sqrt(denom);
  const res = invSqrt - intercept;
  const grad = (a * cosh - sinh) * Math.pow(denom, -1.5);
  return { res, grad };
}

function solveCatenary(v, h, length) {
  const intercept = catenaryIntercept(v, h, length);
  let b = intercept / Math.sqrt(24);
  const tol = 1e-9;
  for (let i = 0; i < 50; i += 1) {
    const { res, grad } = catenaryResidual(b, intercept);
    if (Math.abs(res) < tol) break;
    let step = -res / (grad || 1e-12);
    for (let j = 0; j < 10; j += 1) {
      const next = catenaryResidual(b + step, intercept).res;
      if (Math.abs(next) < Math.abs(res)) break;
      step *= 0.5;
    }
    b += step;
  }
  return b;
}

function computeCatenaryPoints(x0, x1, gravity, length, ncatenary) {
  const dx = (x1[0] || 0) - (x0[0] || 0);
  const dy = (x1[1] || 0) - (x0[1] || 0);
  const dz = (x1[2] || 0) - (x0[2] || 0);
  const dist = vec3Norm(dx, dy, dz);
  if (!(dist > 0) || dist > length) {
    return { points: [x0.slice(), x1.slice()], npoints: 2 };
  }

  const up = [-(gravity?.[0] || 0), -(gravity?.[1] || 0), -(gravity?.[2] || 0)];
  vec3NormalizeInPlace(up);

  const across = [dx, dy, dz];
  const proj = vec3Dot(up[0], up[1], up[2], across[0], across[1], across[2]);
  across[0] -= up[0] * proj;
  across[1] -= up[1] * proj;
  across[2] -= up[2] * proj;
  const acrossNorm = vec3NormalizeInPlace(across);
  if (acrossNorm < 1e-12) {
    across[0] = 0; across[1] = 0; across[2] = 0;
  }

  const h = vec3Dot(dx, dy, dz, across[0], across[1], across[2]);
  const v = vec3Dot(dx, dy, dz, up[0], up[1], up[2]);

  if (length > 100 * h) {
    const dUp = -0.5 * (Math.sqrt(Math.max(0, length * length - h * h)) - v);
    const denom = 2 * dUp - v;
    const dAcross = Math.abs(denom) > 1e-12 ? (h * dUp) / denom : 0;
    const mid = [
      (x0[0] || 0) + up[0] * dUp + across[0] * dAcross,
      (x0[1] || 0) + up[1] * dUp + across[1] * dAcross,
      (x0[2] || 0) + up[2] * dUp + across[2] * dAcross,
    ];
    return { points: [x0.slice(), mid, x1.slice()], npoints: 3 };
  }

  const n = Math.max(2, Math.min(100, ncatenary | 0));
  const bh = solveCatenary(v, h, length) * h;
  const ratio = (length + v) / Math.max(1e-12, (length - v));
  const hOffset = -0.5 * (Math.log(Math.max(1e-12, ratio)) * bh - h);
  const vOffset = -coshSinh(hOffset / bh).cosh * bh;
  const points = [];
  points.push(x0.slice());
  for (let i = 1; i < n - 1; i += 1) {
    const horizontal = (i * h) / n;
    const t = (horizontal - hOffset) / bh;
    const vertical = bh * coshSinh(t).cosh + vOffset;
    points.push([
      (x0[0] || 0) + across[0] * horizontal + up[0] * vertical,
      (x0[1] || 0) + across[1] * horizontal + up[1] * vertical,
      (x0[2] || 0) + across[2] * horizontal + up[2] * vertical,
    ]);
  }
  points.push(x1.slice());
  return { points, npoints: points.length };
}

function computeSceneExtent(bounds, statStruct) {
  const fromBounds = Number(bounds?.radius);
  const fromStat = Number(statStruct?.extent);
  if (Number.isFinite(fromBounds) && fromBounds > 0) return fromBounds;
  if (Number.isFinite(fromStat) && fromStat > 0) return fromStat;
  return 1;
}

function resolveFogConfig(vis, statStruct, bounds, enabled) {
  if (!enabled || !vis?.map) {
    return { enabled: false };
  }
  const start = Number(vis.map.fogstart);
  const end = Number(vis.map.fogend);
  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    return { enabled: false };
  }
  const extent = computeSceneExtent(bounds, statStruct);
  const fogStart = Math.max(0, start) * extent;
  const fogEnd = Math.max(fogStart + 0.1, end * extent);
  // Fog colour:
  // - primary source: model vis.rgba.fog (if present)
  // - otherwise: viewer/preset fallback decides, see render loop.
  let fogColor = null;
  if (vis?.rgba?.fog != null) {
    const colorArr = rgbFromArray(vis.rgba.fog);
    fogColor = new THREE.Color().setRGB(colorArr[0], colorArr[1], colorArr[2]);
  }
  return {
    enabled: true,
    start: fogStart,
    end: fogEnd,
    color: fogColor,
    bgStrength: 0.65,
  };
}

function resolveHazeConfig(vis, statStruct, bounds, enabled) {
  if (!enabled || !vis) {
    return { enabled: false };
  }
  const map = vis.map || {};
  const hazeAmount = Number(map.haze);
  if (!Number.isFinite(hazeAmount) || hazeAmount <= 0) {
    return { enabled: false };
  }
  // Interpret map.haze as a generic intensity scalar; radius/region
  // are left to individual consumers (e.g. infinite ground) so they
  // can tie fade to their own geometry.
  const extent = computeSceneExtent(bounds, statStruct);
  const baseScale = Math.max(1e-3, extent);
  const intensity = Math.max(0.0, hazeAmount);
  const pow = 2.5;
  return {
    enabled: true,
    intensity,
    baseScale,
    pow,
  };
}

function applySceneFog(scene, config) {
  if (!scene) return;
  if (!config?.enabled) {
    scene.fog = null;
    return;
  }
  const fogColor = config.color || new THREE.Color(DEFAULT_CLEAR_HEX);
  const fogNear = Math.max(0, config.start ?? 10);
  const fogFar = Math.max(fogNear + 0.1, config.end ?? fogNear + 30);
  if (!scene.fog || !scene.fog.isFog) {
    scene.fog = new THREE.Fog(fogColor.getHex(), fogNear, fogFar);
  } else {
    scene.fog.near = fogNear;
    scene.fog.far = fogFar;
    if (scene.fog.color && typeof scene.fog.color.copy === 'function') {
      scene.fog.color.copy(fogColor);
    }
  }
}

function ensureCameraTarget(ctx) {
  if (!ctx) return null;
  if (!ctx.cameraTarget) {
    ctx.cameraTarget = new THREE.Vector3(0, 0, 0);
  }
  return ctx.cameraTarget;
}

function ensureFreeCameraPose(ctx) {
  if (!ctx) return null;
  if (!ctx.freeCameraPose) {
    ctx.freeCameraPose = {
      position: new THREE.Vector3(),
      target: new THREE.Vector3(),
      up: new THREE.Vector3(0, 0, 1),
      fov: 75,
      valid: false,
      autoAligned: false,
    };
  }
  ensureCameraTarget(ctx);
  return ctx.freeCameraPose;
}

function cacheTrackingPoseFromCurrent(ctx, bounds) {
  if (!ctx?.camera) return;
  const target = ensureCameraTarget(ctx);
  if (!ctx.trackingOffset) {
    ctx.trackingOffset = new THREE.Vector3();
  }
  ctx.trackingOffset.copy(ctx.camera.position).sub(target);
  const radiusSource =
    bounds?.radius ??
    ctx.bounds?.radius ??
    ctx.trackingRadius ??
    Math.max(0.6, target.length());
  ctx.trackingRadius = Math.max(0.1, Number(radiusSource) || 0.6);
}

function rememberFreeCameraPose(ctx, bounds) {
  if (!ctx?.camera) return;
  const pose = ensureFreeCameraPose(ctx);
  const target = ensureCameraTarget(ctx);
  pose.position.copy(ctx.camera.position);
  pose.target.copy(target);
  pose.up.copy(ctx.camera.up);
  pose.fov = Number.isFinite(ctx.camera.fov) ? ctx.camera.fov : pose.fov;
  pose.valid = true;
  pose.autoAligned = !!ctx.autoAligned;
  cacheTrackingPoseFromCurrent(ctx, bounds);
}

function restoreFreeCameraPose(ctx) {
  if (!ctx?.camera || !ctx.freeCameraPose || !ctx.freeCameraPose.valid) return false;
  const pose = ctx.freeCameraPose;
  const target = ensureCameraTarget(ctx);
  ctx.camera.position.copy(pose.position);
  target.copy(pose.target);
  ctx.camera.lookAt(target);
  ctx.camera.up.copy(pose.up);
  if (Number.isFinite(pose.fov) && ctx.camera.fov !== pose.fov) {
    ctx.camera.fov = pose.fov;
    if (typeof ctx.camera.updateProjectionMatrix === 'function') {
      ctx.camera.updateProjectionMatrix();
    }
  }
  if (pose.autoAligned) {
    ctx.autoAligned = true;
  }
  cacheTrackingPoseFromCurrent(ctx, ctx.bounds || null);
  ctx.fixedCameraActive = false;
  return true;
}

function applyTrackingCamera(ctx, bounds, { tempVecA, tempVecB }, trackingOverride = null) {
  if (!ctx?.camera) return false;
  const target = ensureCameraTarget(ctx);
  const sourceBounds = bounds || ctx.bounds || null;
  const center = trackingOverride?.position
    ? tempVecA.set(
        Number(trackingOverride.position[0]) || 0,
        Number(trackingOverride.position[1]) || 0,
        Number(trackingOverride.position[2]) || 0,
      )
    : tempVecA.set(
        Number(sourceBounds?.center?.[0] ?? target.x) || 0,
        Number(sourceBounds?.center?.[1] ?? target.y) || 0,
        Number(sourceBounds?.center?.[2] ?? target.z) || 0,
      );
  const baseRadius = Number.isFinite(trackingOverride?.radius) ? Number(trackingOverride.radius) : null;
  const fallbackRadius = Number(sourceBounds?.radius) || ctx.trackingRadius || 0.6;
  const radius = Math.max(baseRadius != null ? baseRadius : fallbackRadius, 0.6);
  if (!ctx.trackingOffset) {
    ctx.trackingOffset = new THREE.Vector3(radius * 2.6, -radius * 2.6, radius * 1.2);
    ctx.trackingRadius = ctx.trackingOffset.length();
  }
  ctx.camera.position.copy(center.clone().add(ctx.trackingOffset));
  ctx.trackingRadius = ctx.trackingOffset.length();
  ctx.camera.lookAt(center);
  target.copy(center);
  ctx.trackingRadius = ctx.trackingOffset.length();
  ctx.fixedCameraActive = false;
  const minFar = Math.max(GROUND_DISTANCE * 2.5, 400);
  const desiredFar = Math.max(minFar, Math.max(radius, ctx.trackingRadius || radius) * 10);
  if (ctx.camera.far < desiredFar) {
    ctx.camera.far = desiredFar;
    if (typeof ctx.camera.updateProjectionMatrix === 'function') {
      ctx.camera.updateProjectionMatrix();
    }
  }
  return true;
}

  function syncCameraPoseFromMode(ctx, state, bounds, helpers, trackingCtx = {}) {
    if (!ctx?.camera || !state) return;
    const runtimeMode = Number(state.runtime?.cameraIndex ?? 0) | 0;
  const cameraList = Array.isArray(state.model?.cameras) ? state.model.cameras : [];
  const maxMode = FIXED_CAMERA_OFFSET + cameraList.length - 1;
  const desired = Math.max(
    0,
    maxMode >= 0 ? Math.min(runtimeMode, Math.max(0, maxMode)) : runtimeMode
  );
  const previous =
    typeof ctx.currentCameraMode === 'number' ? ctx.currentCameraMode : 0;
    if (desired !== previous) {
      if (previous === 0) {
        rememberFreeCameraPose(ctx, bounds);
      }
      // When returning from fixed cameras, restore the saved free pose.
      // When returning from tracking (mode 1), keep the current camera pose
      // and simply stop tracking so the transition stays lightweight.
      if (desired === 0 && previous >= FIXED_CAMERA_OFFSET) {
        restoreFreeCameraPose(ctx);
      }
      ctx.currentCameraMode = desired;
    }
  if (desired >= FIXED_CAMERA_OFFSET) {
    if (!applyFixedCameraPreset(ctx, state, helpers)) {
      ctx.fixedCameraActive = false;
    }
    return;
  }
  if (desired === 1) {
    applyTrackingCamera(ctx, trackingCtx.trackingBounds || bounds, helpers, trackingCtx.trackingOverride || null);
    return;
  }
  ctx.fixedCameraActive = false;
}

function applyVisualLighting(ctx, vis) {
  if (!vis || !ctx) return;
  const head = vis.headlight || {};
  const diffuseRGB = rgbFromArray(head.diffuse, [1, 1, 1]);
  const ambientRGB = rgbFromArray(head.ambient, [0.2, 0.2, 0.2]);
  const active = (head.active ?? 1) !== 0;
  if (ctx.light) {
    ctx.light.intensity = active ? Math.max(0.05, averageRGB(diffuseRGB) * 3) : 0;
    ctx.light.color.setRGB(diffuseRGB[0], diffuseRGB[1], diffuseRGB[2]);
  }
  if (ctx.fill) {
    ctx.fill.intensity = active ? Math.max(0.05, averageRGB(diffuseRGB) * 1.0) : 0;
    ctx.fill.color.setRGB(diffuseRGB[0], diffuseRGB[1], diffuseRGB[2]);
  }
  if (ctx.ambient) {
    ctx.ambient.intensity = active ? Math.max(0.0, averageRGB(ambientRGB)) : 0;
    ctx.ambient.color.setRGB(ambientRGB[0], ambientRGB[1], ambientRGB[2]);
  }
  if (ctx.hemi) {
    const hemiStrength = Math.max(0.0, averageRGB(ambientRGB));
    ctx.hemi.intensity = active ? hemiStrength : 0;
    ctx.hemi.color.setRGB(diffuseRGB[0], diffuseRGB[1], diffuseRGB[2]);
    ctx.hemi.groundColor.setRGB(ambientRGB[0], ambientRGB[1], ambientRGB[2]);
  }
}

function applyFixedCameraPreset(ctx, state, { tempVecA, tempVecB, tempVecC, tempVecD }) {
  if (!ctx || !ctx.camera) return false;
  const mode = state.runtime?.cameraIndex | 0;
  if (mode < FIXED_CAMERA_OFFSET) {
    ctx.fixedCameraActive = false;
    return false;
  }
  const list = Array.isArray(state.model?.cameras) ? state.model.cameras : [];
  const preset = list[mode - FIXED_CAMERA_OFFSET];
  if (!preset || !Array.isArray(preset.pos) || preset.pos.length < 3) {
    ctx.fixedCameraActive = false;
    return false;
  }
  tempVecA.set(
    Number(preset.pos[0]) || 0,
    Number(preset.pos[1]) || 0,
    Number(preset.pos[2]) || 0,
  );
  ctx.camera.position.copy(tempVecA);
  const up = Array.isArray(preset.up) ? preset.up : (Array.isArray(preset.mat) ? [preset.mat[3], preset.mat[4], preset.mat[5]] : null);
  if (up) {
    tempVecB.set(Number(up[0]) || 0, Number(up[1]) || 0, Number(up[2]) || 1);
    if (tempVecB.lengthSq() > 1e-9) {
      ctx.camera.up.copy(tempVecB.normalize());
    }
  }
  const forward = Array.isArray(preset.forward)
    ? preset.forward
    : (Array.isArray(preset.mat) ? [preset.mat[6], preset.mat[7], preset.mat[8]] : null);
  tempVecC.set(
    Number(forward?.[0]) || 0,
    Number(forward?.[1]) || 0,
    Number(forward?.[2]) || -1,
  );
  if (tempVecC.lengthSq() < 1e-9) tempVecC.set(0, 0, -1);
  tempVecC.normalize();
  const target = tempVecD.copy(ctx.camera.position).add(tempVecC);
  ctx.camera.lookAt(target);
  ensureCameraTarget(ctx)?.copy(target);
  const fovy = Number(preset.fovy);
  if (Number.isFinite(fovy) && ctx.camera.fov !== fovy) {
    ctx.camera.fov = fovy;
    ctx.camera.updateProjectionMatrix();
  }
  ctx.fixedCameraActive = true;
  return true;
}

function computeBoundsFromSnapshot(snapshot, { ignoreStatic = false } = {}) {
  const n = snapshot?.ngeom | 0;
  const xpos = snapshot?.xpos;
  if (!xpos || n <= 0) return null;
  const gsize = snapshot?.gsize;
  const gtype = snapshot?.gtype;
  let minx = Number.POSITIVE_INFINITY;
  let miny = Number.POSITIVE_INFINITY;
  let minz = Number.POSITIVE_INFINITY;
  let maxx = Number.NEGATIVE_INFINITY;
  let maxy = Number.NEGATIVE_INFINITY;
  let maxz = Number.NEGATIVE_INFINITY;
  let used = 0;
  for (let i = 0; i < n; i += 1) {
    const base = 3 * i;
    const x = Number(xpos[base + 0]) || 0;
    const y = Number(xpos[base + 1]) || 0;
    const z = Number(xpos[base + 2]) || 0;
    const sx = gsize?.[base + 0] ?? 0.1;
    const sy = gsize?.[base + 1] ?? sx;
    const sz = gsize?.[base + 2] ?? sx;
    const type = gtype?.[i] ?? MJ_GEOM.BOX;
    if (ignoreStatic && (type === MJ_GEOM.PLANE || type === MJ_GEOM.HFIELD)) {
      continue;
    }
    const radius = computeGeomRadius(type, sx, sy, sz);
    const pxMin = x - radius;
    const pyMin = y - radius;
    const pzMin = z - radius;
    const pxMax = x + radius;
    const pyMax = y + radius;
    const pzMax = z + radius;
    if (pxMin < minx) minx = pxMin;
    if (pyMin < miny) miny = pyMin;
    if (pzMin < minz) minz = pzMin;
    if (pxMax > maxx) maxx = pxMax;
    if (pyMax > maxy) maxy = pyMax;
    if (pzMax > maxz) maxz = pzMax;
    used += 1;
  }
  if (used === 0 || !Number.isFinite(minx) || !Number.isFinite(maxx)) return null;
  const cx = (minx + maxx) / 2;
  const cy = (miny + maxy) / 2;
  const cz = (minz + maxz) / 2;
  const dx = maxx - minx;
  const dy = maxy - miny;
  const dz = maxz - minz;
  const radius = Math.max(dx, dy, dz) / 2;
  const fallback = Math.max(Math.abs(cx), Math.abs(cy), Math.abs(cz), 0.6);
  return {
    center: [cx, cy, cz],
    radius: Number.isFinite(radius) && radius > 0 ? radius : fallback,
  };
}

  function overlayScale(radius, factor, min = 0.05, max = 2) {
    const r = Number.isFinite(radius) && radius > 0 ? radius : 1;
    return Math.min(max, Math.max(min, r * factor));
  }

function scaleAllFactor(state) {
  const value = Number(state?.model?.vis?.scale?.all);
  if (Number.isFinite(value) && value > 1e-6) return value;
  return 1;
}

function voptEnabled(flags, idx) {
  return Array.isArray(flags) && idx >= 0 && !!flags[idx];
}

function meanSizeFromState(state, context = null) {
  const statSize = Number(state?.model?.stat?.meansize);
  if (Number.isFinite(statSize) && statSize > 0) return statSize;
  const radius = Number(context?.bounds?.radius);
  if (Number.isFinite(radius) && radius > 0) return radius;
  return 1;
}

  function computeMeanScale(state, context = null) {
    const meanSize = meanSizeFromState(state, context);
    const scaleAll = scaleAllFactor(state);
    return { meanSize, scaleAll };
  }

  function computeScenePolicy(snapshot, state, context) {
    const sceneFlags = Array.isArray(state.rendering?.sceneFlags) ? state.rendering.sceneFlags : [];
    const voptFlags = Array.isArray(state.rendering?.voptFlags)
      ? state.rendering.voptFlags
      : (Array.isArray(snapshot?.voptFlags) ? snapshot.voptFlags : (getDefaultVopt(context, state) || []));
    const segmentEnabled = !!sceneFlags[SEGMENT_FLAG_INDEX];
    const mode = state?.visualSourceMode ?? 'model';
    const presetMode = mode === 'preset' || mode === 'preset-sun' || mode === 'preset-moon';
    const skyboxFlag = sceneFlags[4] !== false;
    const shadowEnabled = segmentEnabled ? false : sceneFlags[0] !== false;
    const reflectionEnabled = segmentEnabled ? false : sceneFlags[2] !== false;
    const skyboxEnabled = !segmentEnabled && skyboxFlag;
    const fogEnabled = segmentEnabled ? false : !!sceneFlags[5];
    const hazeEnabled = segmentEnabled ? false : !!sceneFlags[6];
    const hideAllGeometry = !!state.rendering?.hideAllGeometry;
    return {
      sceneFlags,
      voptFlags,
      segmentEnabled,
      skyboxEnabled,
      shadowEnabled,
      reflectionEnabled,
      fogEnabled,
      hazeEnabled,
      presetMode,
      hideAllGeometry,
    };
  }

function shouldDisplayGeom(index, options = {}) {
  if (!Number.isFinite(index) || index < 0) return false;
  if (options.hideAllGeometry) return false;
  const mask = options.geomGroupMask;
  const ids = options.geomGroupIds;
  if (mask && ids && index < ids.length) {
    const rawGroup = Number(ids[index]) || 0;
    if (rawGroup >= 0 && rawGroup < mask.length && !mask[rawGroup]) {
      return false;
    }
  }
  return true;
}

function getLabelTexture(text, quality = 1) {
  if (typeof document === 'undefined') return null;
  const label = (text || '').toString();
  const dpr = typeof window !== 'undefined' ? Math.min(window.devicePixelRatio || 1, LABEL_DPR_CAP) : 1;
  const q = Math.max(1, quality);
  const cacheKey = `${LABEL_TEXTURE_VERSION}::${label}::q${q.toFixed(2)}::${dpr.toFixed(2)}`;
  if (LABEL_TEXTURE_CACHE.has(cacheKey)) {
    return LABEL_TEXTURE_CACHE.get(cacheKey);
  }
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const baseFontPx = 18;
  const fontPx = baseFontPx * dpr * q;
  ctx.font = `400 ${fontPx}px "Inter", "Segoe UI", sans-serif`;
  const metrics = ctx.measureText(label);
  const paddingX = 10 * dpr * q;
  const paddingY = 6 * dpr * q;
  const textWidth = Math.max(metrics.width, 12 * dpr * q);
  canvas.width = Math.ceil(textWidth + paddingX * 2);
  canvas.height = Math.ceil(fontPx + paddingY * 2);
  ctx.font = `400 ${fontPx}px "Inter", "Segoe UI", sans-serif`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.lineWidth = Math.max(1.5 * dpr * q, 1);
  ctx.strokeStyle = 'rgba(255,255,255,0.95)';
  ctx.fillStyle = '#050608';
  const centerY = canvas.height / 2 + 0.1 * fontPx;
  ctx.strokeText(label, canvas.width / 2, centerY);
  ctx.fillText(label, canvas.width / 2, centerY);
  const texture = new THREE.CanvasTexture(canvas);
  texture.anisotropy = 1;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  texture.generateMipmaps = false;
  texture.userData = texture.userData || {};
  texture.userData.aspect = canvas.width / Math.max(1, canvas.height);
  LABEL_TEXTURE_CACHE.set(cacheKey, texture);
  return texture;
}

function createLabelSprite() {
  const material = new THREE.SpriteMaterial({
    map: null,
    color: 0xffffff,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
  const sprite = new THREE.Sprite(material);
  sprite.visible = false;
  sprite.renderOrder = 999;
  sprite.center.set(0.5, 0);
  sprite.frustumCulled = false;
  return sprite;
}

function ensureLabelGroup(context) {
  if (!context.labelGroup) {
    context.labelGroup = new THREE.Group();
    context.labelGroup.name = 'overlay:labels';
    const worldScene = getWorldScene(context);
    if (worldScene) worldScene.add(context.labelGroup);
    context.labelPool = [];
  }
  return context.labelGroup;
}

function hideLabelGroup(context) {
  if (Array.isArray(context?.labelPool)) {
    for (const sprite of context.labelPool) {
      if (sprite) sprite.visible = false;
    }
  }
  if (context?.labelGroup) {
    context.labelGroup.visible = false;
  }
}

function updateSceneLabelOverlays(context, snapshot, state, options = {}) {
  const scnNgeom = snapshot?.scn_ngeom | 0;
  const labelBytes = snapshot?.scn_label || null;
  const posView = snapshot?.scn_pos || null;
  if (!(scnNgeom > 0) || !labelBytes || !posView || !MJ_LABEL_DECODER) {
    hideLabelGroup(context);
    return;
  }
  if (labelBytes.length < scnNgeom * MJ_LABEL_STRIDE || posView.length < scnNgeom * 3) {
    hideLabelGroup(context);
    return;
  }
  const hideAllGeometry = !!options.hideAllGeometry;
  if (hideAllGeometry) {
    hideLabelGroup(context);
    return;
  }

  const labelGroup = ensureLabelGroup(context);
  const pool = context.labelPool;
  const camera = context.camera;
  const labelHeight = LABEL_DEFAULT_HEIGHT;
  const verticalOffset = LABEL_DEFAULT_OFFSET;
  const maxLabels = LABEL_GEOM_LIMIT;
  let used = 0;

  for (let si = 0; si < scnNgeom; si += 1) {
    const base = si * MJ_LABEL_STRIDE;
    if ((labelBytes[base] | 0) === 0) continue;
    if (used >= maxLabels) break;
    const bytes = labelBytes.subarray(base, base + MJ_LABEL_STRIDE);
    let end = bytes.indexOf(0);
    if (end < 0) end = MJ_LABEL_STRIDE;
    const text = MJ_LABEL_DECODER.decode(bytes.subarray(0, end)).trim();
    if (!text) continue;
    const pbase = si * 3;
    const px = Number(posView[pbase + 0]);
    const py = Number(posView[pbase + 1]);
    const pz = Number(posView[pbase + 2]);
    if (!Number.isFinite(px) || !Number.isFinite(py) || !Number.isFinite(pz)) continue;

    let quality = LABEL_LOD_FACTORS.far;
    if (camera) {
      const dist = camera.position.distanceTo(__TMP_VEC3.set(px, py, pz));
      if (dist < LABEL_LOD_NEAR) quality = LABEL_LOD_FACTORS.near;
      else if (dist < LABEL_LOD_MID) quality = LABEL_LOD_FACTORS.mid;
    }
    const texture = getLabelTexture(text, quality);
    if (!texture) continue;
    let sprite = pool[used];
    if (!sprite) {
      sprite = createLabelSprite();
      pool[used] = sprite;
      labelGroup.add(sprite);
    }
    sprite.material.map = texture;
    sprite.material.needsUpdate = true;
    const aspect = Number(texture.userData?.aspect) || 3;
    const width = labelHeight * aspect;
    sprite.scale.set(width, labelHeight, 1);
    sprite.position.set(px, py, pz + verticalOffset);
    sprite.visible = true;
    used += 1;
  }

  for (let i = used; i < pool.length; i += 1) {
    if (pool[i]) pool[i].visible = false;
  }
  labelGroup.visible = used > 0;
}

function createPrimitiveGeometry(gtype, sizeVec, options = {}) {
  const fallbackEnabled = options.fallbackEnabled !== false;
  const preset = options.preset || 'bright-outdoor';
  let geometry;
  let materialOpts = {
    color: 0x6fa0ff,
    metalness: 0.05,
    roughness: 0.65,
  };
  let postCreate = null;
  let objectKind = 'mesh';
  const sx = Number(sizeVec?.[0]) || 0;
  const sy = Number(sizeVec?.[1]) || 0;
  const sz = Number(sizeVec?.[2]) || 0;
  switch (gtype) {
    case MJ_GEOM.LINE: {
      // mjGEOM_LINE is a connector: local +Z is the segment direction.
      // Width is denominated in pixels in MuJoCo; WebGL line width is not reliable,
      // so we render as a 1px line and rely on scene RGBA + depth ordering.
      const length = Math.max(1e-6, sy || sz || 0);
      geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
        0, 0, 0,
        0, 0, length,
      ]), 3));
      materialOpts = { color: 0xffffff, kind: 'line' };
      objectKind = 'line';
      break;
    }
    case MJ_GEOM.LINEBOX: {
      // mjGEOM_LINEBOX uses half-sizes (AABB extents).
      const bx = Math.max(1e-6, sx || 0.1);
      const by = Math.max(1e-6, sy || bx);
      const bz = Math.max(1e-6, sz || bx);
      const box = new THREE.BoxGeometry(2 * bx, 2 * by, 2 * bz);
      geometry = new THREE.EdgesGeometry(box);
      box.dispose();
      materialOpts = { color: 0xffffff, kind: 'line' };
      objectKind = 'line';
      break;
    }
    case MJ_GEOM.ARROW:
    case MJ_GEOM.ARROW1:
    case MJ_GEOM.ARROW2: {
      // Connector arrow: local +Z is the arrow direction, origin at the "from" endpoint.
      // Approximate with a single cone (MuJoCo uses wedges; we keep it simple).
      const radius = Math.max(1e-6, sx || 0.02);
      const length = Math.max(1e-6, sy || sz || 0.1);
      geometry = new THREE.CylinderGeometry(0, radius, length, 12, 1, false);
      geometry.rotateX(Math.PI / 2);
      geometry.translate(0, 0, length * 0.5);
      materialOpts = { color: 0xffffff, kind: 'basic' };
      break;
    }
    case MJ_GEOM.TRIANGLE: {
      // Triangle: local X is edge v0->v1, local Y is edge v0->v2 (see engine_vis_visualize.c:makeTriangle).
      const e1 = Math.max(0, sx || 0);
      const e2 = Math.max(0, sy || 0);
      geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
        0, 0, 0,
        e1, 0, 0,
        0, e2, 0,
      ]), 3));
      geometry.setIndex([0, 1, 2]);
      geometry.computeVertexNormals();
      materialOpts = { color: 0xffffff, kind: 'basic', doubleSided: true };
      break;
    }
    case MJ_GEOM.SPHERE: {
      const r = Math.max(1e-6, sx || sy || sz || 0.1);
      geometry = new THREE.SphereGeometry(1, 24, 16);
      geometry.scale(r, r, r);
      break;
    }
    case MJ_GEOM.ELLIPSOID: {
      const ax = Math.max(1e-6, sx || 0.1);
      const ay = Math.max(1e-6, sy || ax);
      const az = Math.max(1e-6, sz || ax);
      geometry = new THREE.SphereGeometry(1, 24, 16);
      geometry.scale(ax, ay, az);
      break;
    }
    case MJ_GEOM.CAPSULE: {
      const radius = Math.max(1e-6, sx || 0.05);
      const halfLength = Math.max(0, sy || 0);
      geometry = new THREE.CapsuleGeometry(radius, Math.max(0, 2 * halfLength), 20, 12);
      geometry.rotateX(Math.PI / 2);
      break;
    }
    case MJ_GEOM.CYLINDER: {
      const radius = Math.max(1e-6, sx || 0.05);
      const halfLength = Math.max(0, sy || 0.05);
      geometry = new THREE.CylinderGeometry(
        radius,
        radius,
        Math.max(1e-6, 2 * halfLength),
        24,
        1
      );
      geometry.rotateX(Math.PI / 2);
      break;
    }
    case MJ_GEOM.PLANE:
    case MJ_GEOM.HFIELD: {
      const halfX = Math.max(Math.abs(sx), PLANE_SIZE_EPS);
      const halfY = Math.max(Math.abs(sy || sx), PLANE_SIZE_EPS);
      const width = Math.max(PLANE_SIZE_EPS, halfX * 2);
      const height = Math.max(PLANE_SIZE_EPS, halfY * 2);
      geometry = new THREE.PlaneGeometry(width, height, 1, 1);
      const lightGray = 0xd0d0d0;
      materialOpts = {
        color: lightGray,
        metalness: 0.0,
        roughness: 0.82,
      };
      postCreate = (mesh) => {
        mesh.rotation.x = -Math.PI / 2;
        mesh.receiveShadow = true;
        mesh.castShadow = false;
        try {
          const baseMat = mesh.material;
          if (baseMat && typeof baseMat.clone === 'function') {
            const backMat = baseMat.clone();
            backMat.side = THREE.BackSide;
            backMat.transparent = true;
            backMat.opacity = 0.25;
            backMat.depthWrite = false;
            backMat.polygonOffset = true;
            backMat.polygonOffsetFactor = -1;
            const backMesh = new THREE.Mesh(mesh.geometry, backMat);
            backMesh.receiveShadow = false;
            backMesh.castShadow = false;
            backMesh.renderOrder = (mesh.renderOrder || 0) + 0.01;
            backMesh.userData = { ownGeometry: false };
            mesh.add(backMesh);
            mesh.userData = mesh.userData || {};
            mesh.userData.fallbackBackface = backMesh;
          }

        } catch {}
      };
      break;
    }
    default: {
      const bx = Math.max(1e-6, sx || 0.1);
      const by = Math.max(1e-6, sy || bx);
      const bz = Math.max(1e-6, sz || bx);
      geometry = new THREE.BoxGeometry(2 * bx, 2 * by, 2 * bz);
      break;
    }
  }
  if (geometry?.computeBoundingBox) geometry.computeBoundingBox();
  if (geometry?.computeBoundingSphere) geometry.computeBoundingSphere();
  return { geometry, materialOpts, postCreate, objectKind };
}

function isDynamicSizeScaleGeomType(gtype) {
  switch (gtype | 0) {
    case MJ_GEOM.CAPSULE:
    case MJ_GEOM.CYLINDER:
    case MJ_GEOM.LINE:
    case MJ_GEOM.LINEBOX:
    case MJ_GEOM.ARROW:
    case MJ_GEOM.ARROW1:
    case MJ_GEOM.ARROW2:
    case MJ_GEOM.TRIANGLE:
      return true;
    default:
      return false;
  }
}

function safeScaleRatio(value, base) {
  const v = Number(value);
  const b = Number(base);
  if (!Number.isFinite(v) || !Number.isFinite(b) || Math.abs(b) < 1e-12) return 1;
  return v / b;
}

function ensureGeomBuiltSizes(mesh, gtype) {
  if (!mesh) return null;
  const type = gtype | 0;
  if (!isDynamicSizeScaleGeomType(type)) return mesh.userData || null;
  const userData = mesh.userData || (mesh.userData = {});
  if (
    Number.isFinite(userData.geomBuiltSizeX) &&
    Number.isFinite(userData.geomBuiltSizeY) &&
    Number.isFinite(userData.geomBuiltSizeZ)
  ) {
    return userData;
  }

  const geometry = mesh.geometry || null;
  if (!geometry) return userData;
  if (!geometry.boundingBox && typeof geometry.computeBoundingBox === 'function') {
    geometry.computeBoundingBox();
  }
  const bb = geometry.boundingBox || null;
  if (!bb) return userData;
  const ex = Math.abs(Number(bb.max.x) - Number(bb.min.x));
  const ey = Math.abs(Number(bb.max.y) - Number(bb.min.y));
  const ez = Math.abs(Number(bb.max.z) - Number(bb.min.z));

  switch (type) {
    case MJ_GEOM.LINE: {
      userData.geomBuiltSizeX = 1;
      userData.geomBuiltSizeY = Math.max(1e-6, ez);
      userData.geomBuiltSizeZ = 1;
      break;
    }
    case MJ_GEOM.CAPSULE:
    case MJ_GEOM.CYLINDER:
    case MJ_GEOM.ARROW:
    case MJ_GEOM.ARROW1:
    case MJ_GEOM.ARROW2: {
      const radius = 0.5 * Math.max(ex, ey);
      userData.geomBuiltSizeX = Math.max(1e-6, radius);
      userData.geomBuiltSizeY = Math.max(1e-6, ez);
      userData.geomBuiltSizeZ = 1;
      break;
    }
    case MJ_GEOM.LINEBOX: {
      userData.geomBuiltSizeX = Math.max(1e-6, 0.5 * ex);
      userData.geomBuiltSizeY = Math.max(1e-6, 0.5 * ey);
      userData.geomBuiltSizeZ = Math.max(1e-6, 0.5 * ez);
      break;
    }
    case MJ_GEOM.TRIANGLE: {
      userData.geomBuiltSizeX = Math.max(0, ex);
      userData.geomBuiltSizeY = Math.max(0, ey);
      userData.geomBuiltSizeZ = 1;
      break;
    }
    default:
      break;
  }
  return userData;
}

function applyDynamicSizeScale(mesh, gtype, sizeVec) {
  if (!mesh) return;
  const type = gtype | 0;
  if (!isDynamicSizeScaleGeomType(type)) return;
  const userData = ensureGeomBuiltSizes(mesh, type) || (mesh.userData || {});
  const sx = Number(sizeVec?.[0]) || 0;
  const sy = Number(sizeVec?.[1]) || 0;
  const sz = Number(sizeVec?.[2]) || 0;

  switch (type) {
    case MJ_GEOM.CYLINDER: {
      const radius = Math.max(1e-6, sx || 0.05);
      const halfLength = Math.max(0, sy || 0.05);
      const fullLength = Math.max(1e-6, 2 * halfLength);
      const sR = safeScaleRatio(radius, userData.geomBuiltSizeX);
      const sL = safeScaleRatio(fullLength, userData.geomBuiltSizeY);
      mesh.scale.set(sR, sR, sL);
      break;
    }
    case MJ_GEOM.CAPSULE: {
      const radius = Math.max(1e-6, sx || 0.05);
      const halfLength = Math.max(0, sy || 0);
      const fullLength = Math.max(1e-6, 2 * halfLength + 2 * radius);
      const sR = safeScaleRatio(radius, userData.geomBuiltSizeX);
      const sL = safeScaleRatio(fullLength, userData.geomBuiltSizeY);
      mesh.scale.set(sR, sR, sL);
      break;
    }
    case MJ_GEOM.LINE: {
      const length = Math.max(1e-6, sy || sz || 0);
      mesh.scale.set(1, 1, safeScaleRatio(length, userData.geomBuiltSizeY));
      break;
    }
    case MJ_GEOM.ARROW:
    case MJ_GEOM.ARROW1:
    case MJ_GEOM.ARROW2: {
      const radius = Math.max(1e-6, sx || 0.02);
      const length = Math.max(1e-6, sy || sz || 0.1);
      const sR = safeScaleRatio(radius, userData.geomBuiltSizeX);
      const sL = safeScaleRatio(length, userData.geomBuiltSizeY);
      mesh.scale.set(sR, sR, sL);
      break;
    }
    case MJ_GEOM.LINEBOX: {
      const bx = Math.max(1e-6, sx || 0.1);
      const by = Math.max(1e-6, sy || bx);
      const bz = Math.max(1e-6, sz || bx);
      mesh.scale.set(
        safeScaleRatio(bx, userData.geomBuiltSizeX),
        safeScaleRatio(by, userData.geomBuiltSizeY),
        safeScaleRatio(bz, userData.geomBuiltSizeZ),
      );
      break;
    }
    case MJ_GEOM.TRIANGLE: {
      const e1 = Math.max(0, sx || 0);
      const e2 = Math.max(0, sy || 0);
      mesh.scale.set(
        safeScaleRatio(e1, userData.geomBuiltSizeX),
        safeScaleRatio(e2, userData.geomBuiltSizeY),
        1,
      );
      break;
    }
    default:
      break;
  }
}

function createMeshGeometryFromAssets(assets, dataId) {
  if (!assets || !assets.meshes) return null;
  const rawDataId = dataId | 0;
  const MESH_DATAID_MASK = 1 << 30;
  const isEncoded = (rawDataId & MESH_DATAID_MASK) !== 0;
  const payload = isEncoded ? (rawDataId & (MESH_DATAID_MASK - 1)) : rawDataId;
  const meshCountGuess =
    Number.isFinite(assets.meshes.count)
      ? (assets.meshes.count | 0)
      : (assets.meshes.vertnum ? (assets.meshes.vertnum.length | 0) : 0);
  const decodedId = payload >> 1;
  const meshId = (!isEncoded && meshCountGuess > 0 && decodedId >= meshCountGuess && rawDataId >= 0 && rawDataId < meshCountGuess)
    ? rawDataId
    : decodedId;
  const hull = (payload & 1) !== 0;
  if (!(meshId >= 0)) return null;

  const {
    vert,
    vertadr,
    vertnum,
    face,
    faceadr,
    facenum,
    normal,
    texcoord,
    texcoordadr,
    texcoordnum,
    graph,
    graphadr,
    graphnum,
    nmeshgraph,
    polynum,
    polyadr,
    polynormal,
    polyvertadr,
    polyvertnum,
    polyvert,
    nmeshpoly,
    nmeshpolyvert,
  } = assets.meshes;
  const hasValidVert =
    vert
    && typeof vert.length === 'number'
    && typeof vert.slice === 'function';
  if (!hasValidVert || !vertadr || !vertnum) return null;

  const count = vertnum[meshId] | 0;
  if (!(count > 0)) return null;
  const start = (vertadr[meshId] | 0) * 3;
  const end = start + count * 3;
  if (start < 0 || end > vert.length) return null;

  if (isEncoded && hull) {
    const polyCount = polynum && meshId < polynum.length ? (polynum[meshId] | 0) : 0;
    const polyStart = polyadr && meshId < polyadr.length ? (polyadr[meshId] | 0) : -1;
    const totalPoly = Number.isFinite(nmeshpoly) ? (nmeshpoly | 0) : (polyvertnum ? (polyvertnum.length | 0) : 0);
    const totalPolyVert = Number.isFinite(nmeshpolyvert) ? (nmeshpolyvert | 0) : (polyvert ? (polyvert.length | 0) : 0);

    if (
      polyCount > 0 &&
      polyStart >= 0 &&
      polyvertadr &&
      polyvertnum &&
      polyvert &&
      polynormal &&
      polyStart < totalPoly
    ) {
      const polyEnd = Math.min(totalPoly, polyStart + polyCount);
      let triCount = 0;
      for (let pid = polyStart; pid < polyEnd; pid += 1) {
        const n = polyvertnum[pid] | 0;
        if (n >= 3) triCount += (n - 2);
      }
      if (triCount > 0) {
        const positions = new Float32Array(triCount * 9);
        const normals = new Float32Array(triCount * 9);
        let t = 0;
        for (let pid = polyStart; pid < polyEnd; pid += 1) {
          const vStart = polyvertadr[pid] | 0;
          const vNum = polyvertnum[pid] | 0;
          if (!(vNum >= 3) || vStart < 0 || (vStart + vNum) > totalPolyVert) continue;
          const v0 = polyvert[vStart] | 0;
          if (v0 < 0 || v0 >= count) continue;
          const nBase = pid * 3;
          const nx = Number(polynormal[nBase + 0]) || 0;
          const ny = Number(polynormal[nBase + 1]) || 0;
          const nz = Number(polynormal[nBase + 2]) || 1;

          for (let j = 1; j < vNum - 1; j += 1) {
            const v1 = polyvert[vStart + j] | 0;
            const v2 = polyvert[vStart + j + 1] | 0;
            if (v1 < 0 || v1 >= count) continue;
            if (v2 < 0 || v2 >= count) continue;

            const dstBase = 9 * t;
            const vtx = [v0, v1, v2];
            for (let k = 0; k < 3; k += 1) {
              const vi = vtx[k] | 0;
              const srcBase = start + 3 * vi;
              const outBase = dstBase + 3 * k;
              positions[outBase + 0] = vert[srcBase + 0] ?? 0;
              positions[outBase + 1] = vert[srcBase + 1] ?? 0;
              positions[outBase + 2] = vert[srcBase + 2] ?? 0;
              normals[outBase + 0] = nx;
              normals[outBase + 1] = ny;
              normals[outBase + 2] = nz;
            }
            t += 1;
          }
        }
        if (t > 0) {
          const geometry = new THREE.BufferGeometry();
          const usedPositions = t === triCount ? positions : positions.subarray(0, t * 9);
          const usedNormals = t === triCount ? normals : normals.subarray(0, t * 9);
          geometry.setAttribute('position', new THREE.BufferAttribute(usedPositions, 3));
          geometry.setAttribute('normal', new THREE.BufferAttribute(usedNormals, 3));
          geometry.computeBoundingBox();
          geometry.computeBoundingSphere();
          return geometry;
        }
      }
    }

    // Fallback: if convex hull data is missing, render the original mesh.
  }

  const positions = vert.slice(start, end);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

  if (normal && normal.length >= end) {
    const normalSlice = normal.slice(start, end);
    geometry.setAttribute('normal', new THREE.BufferAttribute(normalSlice, 3));
  }

  if (face && faceadr && facenum) {
    const triCount = facenum[meshId] | 0;
    if (triCount > 0) {
      const faceStart = (faceadr[meshId] | 0) * 3;
      const faceEnd = faceStart + triCount * 3;
      if (faceStart >= 0 && faceEnd <= face.length) {
        const rawFaces = face.slice(faceStart, faceEnd);
        let needsUint32 = count > 65535;
        if (!needsUint32) {
          for (let i = 0; i < rawFaces.length; i += 1) {
            if (rawFaces[i] > 65535) {
              needsUint32 = true;
              break;
            }
          }
        }
        const IndexCtor = needsUint32 ? Uint32Array : Uint16Array;
        const indices = new IndexCtor(rawFaces);
        geometry.setIndex(new THREE.BufferAttribute(indices, 1));
      }
    }
  }

  if (texcoord && texcoordadr && texcoordnum) {
    const tcCount = texcoordnum[meshId] | 0;
    if (tcCount > 0) {
      const tcStart = (texcoordadr[meshId] | 0) * 2;
      const tcEnd = tcStart + tcCount * 2;
      if (tcStart >= 0 && tcEnd <= texcoord.length) {
        const uvSlice = texcoord.slice(tcStart, tcEnd);
        geometry.setAttribute('uv', new THREE.BufferAttribute(uvSlice, 2));
      }
    }
  }

  if (!geometry.getAttribute('normal')) {
    geometry.computeVertexNormals();
  }
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

function disposeMeshObject(mesh) {
  try {
    if (mesh.userData && mesh.userData.fallbackBackface) {
      const back = mesh.userData.fallbackBackface;
      if (back.material && typeof back.material.dispose === 'function') {
        try {
          back.material.dispose();
        } catch {}
      }
      if (typeof mesh.remove === 'function') {
        try {
          mesh.remove(back);
        } catch {}
      }
      mesh.userData.fallbackBackface = null;
    }
  } catch {}

  if (!mesh) return;
  const parent = mesh.parent;
  if (parent && typeof parent.remove === 'function') {
    parent.remove(mesh);
  }
  const ownGeometry = mesh.userData?.ownGeometry !== false;
  if (ownGeometry && mesh.geometry && typeof mesh.geometry.dispose === 'function') {
    try {
      mesh.geometry.dispose();
    } catch {}
  }
  const material = mesh.material;
  if (Array.isArray(material)) {
    for (const mat of material) {
      if (mat && !mat.userData?.pooled && typeof mat.dispose === 'function') {
        try {
          mat.dispose();
        } catch {}
      }
    }
  } else if (material && !material.userData?.pooled && typeof material.dispose === 'function') {
    try {
      material.dispose();
    } catch {}
  }
}

function disposeInstancing(ctx) {
  const inst = ctx?._instancing || null;
  if (!inst) return;
  const root = inst.root;
  if (root && root.parent && typeof root.parent.remove === 'function') {
    root.parent.remove(root);
  }
  if (inst.batches instanceof Map) {
    for (const batch of inst.batches.values()) {
      const mesh = batch?.mesh || null;
      if (mesh && mesh.parent && typeof mesh.parent.remove === 'function') {
        mesh.parent.remove(mesh);
      }
    }
    inst.batches.clear();
  }
  if (inst.materials instanceof Map) {
    for (const material of inst.materials.values()) {
      if (material && typeof material.dispose === 'function') {
        material.dispose();
      }
    }
    inst.materials.clear();
  }
  if (inst.geometries instanceof Map) {
    for (const geometry of inst.geometries.values()) {
      if (geometry && typeof geometry.dispose === 'function') {
        geometry.dispose();
      }
    }
    inst.geometries.clear();
  }
  ctx._instancing = null;
  ctx.instancing = null;
  if (Array.isArray(ctx.pickables)) {
    ctx.pickables.length = 0;
  }
}

// Lightweight pooled material factory to avoid excessive material instances
class MaterialPool {
  constructor(threeNS) {
    this.THREE = threeNS;
    this.cache = new Map();
  }
  _key(spec) {
    const kind = spec.kind || 'standard';
    const color = (spec.color >>> 0).toString(16);
    const rough = Math.round(((spec.roughness ?? 0.55) + Number.EPSILON) * 1000) / 1000;
    const metal = Math.round(((spec.metalness ?? 0.0) + Number.EPSILON) * 1000) / 1000;
    const wire = !!spec.wireframe;
    return `${kind}|${color}|r${rough}|m${metal}|w${wire}`;
  }
  get(spec) {
    const key = this._key(spec);
    if (this.cache.has(key)) return this.cache.get(key);
    const T = this.THREE;
    let mat;
    const forceBasic = (typeof window !== 'undefined') && (window.location?.search?.includes('forceBasic=1'));
    if (spec.kind === 'standard') {
      mat = forceBasic
        ? new T.MeshBasicMaterial({ color: spec.color ?? 0xffffff, wireframe: !!spec.wireframe })
        : new T.MeshStandardMaterial({
            color: spec.color ?? 0xffffff,
            roughness: spec.roughness ?? 0.55,
            metalness: spec.metalness ?? 0.0,
            wireframe: !!spec.wireframe,
          });
    } else {
      mat = forceBasic
        ? new T.MeshBasicMaterial({ color: spec.color ?? 0xffffff, wireframe: !!spec.wireframe })
        : new T.MeshPhysicalMaterial({
            color: spec.color ?? 0xffffff,
            roughness: spec.roughness ?? 0.55,
            metalness: spec.metalness ?? 0.0,
            clearcoat: 0.2,
            clearcoatRoughness: 0.15,
            specularIntensity: 0.25,
            ior: 1.5,
            wireframe: !!spec.wireframe,
          });
    }
    mat.userData = mat.userData || {};
    mat.userData.pooled = true;
    this.cache.set(key, mat);
    return mat;
  }
  disposeAll() {
    for (const m of this.cache.values()) {
      try { m.dispose?.(); } catch {}
    }
    this.cache.clear();
  }
}

function syncRendererAssets(ctx, assets) {
  const source = assets || null;
  if (ctx.assetSource === source) return;
  ctx.assetSource = source;
  disposeInstancing(ctx);
  if (!ctx.meshes) {
    ctx.meshes = [];
    return;
  }
  for (let i = 0; i < ctx.meshes.length; i += 1) {
    if (ctx.meshes[i]) {
      disposeMeshObject(ctx.meshes[i]);
    }
  }
  ctx.meshes = [];
  if (ctx.assetCache && ctx.assetCache.meshGeometries instanceof Map) {
    for (const geometry of ctx.assetCache.meshGeometries.values()) {
      if (geometry && typeof geometry.dispose === 'function') {
        try {
          geometry.dispose();
        } catch {}
      }
    }
    ctx.assetCache.meshGeometries.clear();
  }
  ctx.assetCache = {
    meshGeometries: new Map(),
  };
}

function ensureInstancingRoot(ctx) {
  if (!ctx) return null;
  const existing = ctx._instancing || null;
  if (existing?.root) return existing;
  const inst = existing || {
    root: null,
    batches: new Map(),
    geometries: new Map(),
    materials: new Map(),
    geomRefs: [],
    pickables: [],
    tmpPos: new THREE.Vector3(),
    tmpQuat: new THREE.Quaternion(),
    tmpScale: new THREE.Vector3(),
    tmpMat4: new THREE.Matrix4(),
    tmpCamPos: new THREE.Vector3(),
    tmpCamDir: new THREE.Vector3(),
  };
  if (!inst.root) {
    const group = new THREE.Group();
    group.name = 'MuJoCoInstancing';
    inst.root = group;
    if (ctx.root) ctx.root.add(group);
  }
  ctx._instancing = inst;
  ctx.instancing = inst;
  return inst;
}

function ensureInstancedGeometry(inst, gtype) {
  if (!inst) return null;
  if (!(inst.geometries instanceof Map)) inst.geometries = new Map();
  const key = gtype | 0;
  if (inst.geometries.has(key)) return inst.geometries.get(key);
  let geometry = null;
  switch (key) {
    case MJ_GEOM.SPHERE:
    case MJ_GEOM.ELLIPSOID: {
      geometry = new THREE.SphereGeometry(1, 24, 16);
      break;
    }
    case MJ_GEOM.BOX: {
      geometry = new THREE.BoxGeometry(2, 2, 2);
      break;
    }
    case MJ_GEOM.CYLINDER: {
      geometry = new THREE.CylinderGeometry(1, 1, 2, 24, 1);
      geometry.rotateX(Math.PI / 2);
      break;
    }
    case MJ_GEOM.CAPSULE: {
      geometry = new THREE.CapsuleGeometry(1, 2, 20, 12);
      geometry.rotateX(Math.PI / 2);
      break;
    }
    default:
      return null;
  }
  if (geometry?.computeBoundingBox) geometry.computeBoundingBox();
  if (geometry?.computeBoundingSphere) geometry.computeBoundingSphere();
  inst.geometries.set(key, geometry);
  return geometry;
}

function instancingForceBasicMaterial() {
  if (typeof window === 'undefined') return false;
  const search = window.location?.search || '';
  return search.includes('forceBasic=1');
}

function instancingIsOverlayObjType(objType) {
  const ot = objType | 0;
  return ot === MJ_OBJ.SITE || ot === MJ_OBJ.TENDON;
}

function instancingDisabledByUrl() {
  if (typeof globalThis !== 'undefined') {
    const override = globalThis.PLAY_DISABLE_INSTANCING;
    if (override === true) return true;
    if (override === false) return false;
  }
  if (typeof window === 'undefined') return false;
  const search = window.location?.search || '';
  return (
    search.includes('inst=0') ||
    search.includes('instancing=0') ||
    search.includes('noinst=1')
  );
}

function transparentBinsFromUrl(defaultBins = 16) {
  if (typeof globalThis !== 'undefined') {
    const override = globalThis.PLAY_TRANSPARENT_BINS;
    if (Number.isFinite(override)) {
      return Math.max(0, Math.min(16, override | 0));
    }
  }
  if (typeof window === 'undefined') return defaultBins;
  const search = window.location?.search || '';
  const match = search.match(/(?:^|[?&])tbins=(\d+)/);
  if (!match) return defaultBins;
  const parsed = Number(match[1]);
  if (!Number.isFinite(parsed)) return defaultBins;
  const clamped = Math.max(0, Math.min(16, parsed | 0));
  if (clamped === 0) return 0;
  if (clamped <= 1) return 1;
  if (clamped <= 4) return 4;
  if (clamped <= 8) return 8;
  return 16;
}

function transparentSortModeFromUrl() {
  if (typeof globalThis !== 'undefined') {
    const override = globalThis.PLAY_TRANSPARENT_SORT_MODE;
    if (override === 'strict' || override === 'bins' || override === 'nosort') return override;
  }
  if (typeof window === 'undefined') return 'strict';
  const search = window.location?.search || '';
  if (search.includes('tmode=nosort') || search.includes('tmode=fast')) return 'nosort';
  if (search.includes('tmode=strict')) return 'strict';
  if (search.includes('tmode=bins')) return 'bins';
  return 'strict';
}

function ensureInstancedMaterial(inst, reflectanceQ, { wireframe = false, opacityQ = 1000, objType = MJ_OBJ.UNKNOWN } = {}) {
  if (!inst) return null;
  if (!(inst.materials instanceof Map)) inst.materials = new Map();
  const oq = Math.max(0, Math.min(1000, opacityQ | 0));
  const forceBasic = instancingForceBasicMaterial() || instancingIsOverlayObjType(objType);
  const key = `inst:${forceBasic ? 1 : 0}:o${oq}:r${reflectanceQ | 0}`;
  if (inst.materials.has(key)) {
    const mat = inst.materials.get(key);
    if (mat && typeof mat.wireframe === 'boolean' && mat.wireframe !== !!wireframe) {
      mat.wireframe = !!wireframe;
    }
    return mat;
  }
  const opacity = oq / 1000;
  const transparent = opacity < 0.999;
  const material = forceBasic
    ? new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent,
        opacity,
        depthWrite: !transparent,
        depthTest: true,
        toneMapped: false,
      })
    : new THREE.MeshPhysicalMaterial({
        color: 0xffffff,
        roughness: 0.65,
        metalness: 0.05,
        transparent,
        opacity,
        depthWrite: !transparent,
        depthTest: true,
      });
  material.vertexColors = true;
  material.wireframe = !!wireframe;
  if (!forceBasic && 'envMapIntensity' in material) {
    material.envMapIntensity = 0;
  }
  material.userData = material.userData || {};
  material.userData.instanced = true;
  material.userData.reflectanceQ = reflectanceQ | 0;
  inst.materials.set(key, material);
  return material;
}

function ensureInstancedBatch(ctx, inst, batchKey, geometry, material, capacity) {
  if (!inst || !(inst.batches instanceof Map)) return null;
  const key = String(batchKey || '');
  const cap = Math.max(1, capacity | 0);
  let batch = inst.batches.get(key) || null;
  if (batch && batch.capacity >= cap && batch.mesh) {
    if (!(batch.instanceOrderRank instanceof Int32Array) || batch.instanceOrderRank.length !== batch.capacity) {
      batch.instanceOrderRank = new Int32Array(batch.capacity);
      batch.instanceOrderRank.fill(-1);
    }
    return batch;
  }
  if (batch?.mesh && batch.mesh.parent && typeof batch.mesh.parent.remove === 'function') {
    batch.mesh.parent.remove(batch.mesh);
  }
  // NOTE: InstancedMesh mutates its geometry by attaching instanced attributes
  // (instanceMatrix/instanceColor). Do not share the same geometry object
  // between multiple InstancedMesh instances, or attributes will collide and
  // cause incorrect transforms/colors.
  const geomClone = geometry?.clone ? geometry.clone() : geometry;
  // three.js uses `material.vertexColors` to enable instance colors for InstancedMesh,
  // but the shader path also expects a per-vertex `color` attribute. When missing,
  // WebGL provides a default (0,0,0,1) which can multiply instance colors to black.
  // Provide a constant white per-vertex color attribute when needed.
  if (material?.vertexColors && geomClone?.getAttribute && geomClone?.setAttribute) {
    const hasColor = !!geomClone.getAttribute('color');
    const posAttr = geomClone.getAttribute('position') || null;
    const vcount = posAttr?.count | 0;
    if (!hasColor && vcount > 0) {
      const arr = new Uint8Array(vcount * 3);
      arr.fill(255);
      const attr = typeof THREE.Uint8BufferAttribute === 'function'
        ? new THREE.Uint8BufferAttribute(arr, 3, true)
        : new THREE.BufferAttribute(new Float32Array(arr.length).fill(1), 3);
      geomClone.setAttribute('color', attr);
    }
  }
  const mesh = new THREE.InstancedMesh(geomClone, material, cap);
  mesh.frustumCulled = false;
  mesh.count = 0;
  mesh.visible = false;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  if (mesh.instanceMatrix && typeof mesh.instanceMatrix.setUsage === 'function') {
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  }
  mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
  mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
  if (mesh.geometry && typeof mesh.geometry.setAttribute === 'function') {
    mesh.geometry.setAttribute('instanceColor', mesh.instanceColor);
  }
  mesh.userData = mesh.userData || {};
  mesh.userData.instanced = true;
  mesh.userData.batchKey = key;
  const instanceToGeomIndex = new Int32Array(cap);
  instanceToGeomIndex.fill(-1);
  const instanceOrderRank = new Int32Array(cap);
  instanceOrderRank.fill(-1);
  mesh.userData.instanceToGeomIndex = instanceToGeomIndex;
  if (inst.root) inst.root.add(mesh);
  batch = {
    key,
    geometry: mesh.geometry,
    material,
    mesh,
    capacity: cap,
    used: 0,
    instanceToGeomIndex,
    instanceOrderRank,
    orderMin: Number.POSITIVE_INFINITY,
    orderMax: Number.NEGATIVE_INFINITY,
  };
  inst.batches.set(key, batch);
  return batch;
}

function sortTransparentInstancedBatch(ctx, inst, batch, camera) {
  const used = batch?.used | 0;
  const mesh = batch?.mesh || null;
  if (!mesh || used <= 1) return false;
  if (!camera || typeof camera.getWorldPosition !== 'function' || typeof camera.getWorldDirection !== 'function') return false;
  const matrixAttr = mesh.instanceMatrix || null;
  const matrixArr = matrixAttr?.array || null;
  const colorAttr = mesh.instanceColor || null;
  const colorArr = colorAttr?.array || null;
  const geomIndexArr = batch.instanceToGeomIndex || null;
  if (!matrixArr || matrixArr.length < used * 16) return false;
  if (!geomIndexArr || geomIndexArr.length < used) return false;

  const cap = batch.capacity | 0;
  if (!(cap > 0)) return false;
  if (!Array.isArray(batch.sortOrder)) batch.sortOrder = [];
  if (!(batch.sortKeys instanceof Float32Array) || batch.sortKeys.length !== cap) {
    batch.sortKeys = new Float32Array(cap);
  }
  if (!(batch.sortTmpMatrix instanceof Float32Array) || batch.sortTmpMatrix.length !== cap * 16) {
    batch.sortTmpMatrix = new Float32Array(cap * 16);
  }
  if (colorArr && (!(batch.sortTmpColor instanceof Float32Array) || batch.sortTmpColor.length !== cap * 3)) {
    batch.sortTmpColor = new Float32Array(cap * 3);
  }
  if (!(batch.sortTmpGeomIndex instanceof Int32Array) || batch.sortTmpGeomIndex.length !== cap) {
    batch.sortTmpGeomIndex = new Int32Array(cap);
  }

  const order = batch.sortOrder;
  order.length = used;
  const keys = batch.sortKeys;
  camera.getWorldPosition(inst.tmpCamPos);
  camera.getWorldDirection(inst.tmpCamDir);
  const camX = inst.tmpCamPos.x;
  const camY = inst.tmpCamPos.y;
  const camZ = inst.tmpCamPos.z;
  const dirX = inst.tmpCamDir.x;
  const dirY = inst.tmpCamDir.y;
  const dirZ = inst.tmpCamDir.z;
  const world = mesh.matrixWorld?.elements || null;

  for (let i = 0; i < used; i += 1) {
    order[i] = i;
    const base = i * 16;
    const lx = matrixArr[base + 12] || 0;
    const ly = matrixArr[base + 13] || 0;
    const lz = matrixArr[base + 14] || 0;
    let wx = lx;
    let wy = ly;
    let wz = lz;
    if (world) {
      wx = world[0] * lx + world[4] * ly + world[8] * lz + world[12];
      wy = world[1] * lx + world[5] * ly + world[9] * lz + world[13];
      wz = world[2] * lx + world[6] * ly + world[10] * lz + world[14];
    }
    const dx = wx - camX;
    const dy = wy - camY;
    const dz = wz - camZ;
    keys[i] = dx * dirX + dy * dirY + dz * dirZ;
  }

  order.sort((a, b) => {
    const da = keys[a];
    const db = keys[b];
    const d = db - da;
    if (d) return d;
    return a - b;
  });

  const tmpMatrix = batch.sortTmpMatrix;
  const tmpColor = batch.sortTmpColor || null;
  const tmpGeomIndex = batch.sortTmpGeomIndex;
  for (let newIdx = 0; newIdx < used; newIdx += 1) {
    const oldIdx = order[newIdx] | 0;
    const srcMatBase = oldIdx * 16;
    const dstMatBase = newIdx * 16;
    for (let j = 0; j < 16; j += 1) {
      tmpMatrix[dstMatBase + j] = matrixArr[srcMatBase + j];
    }
    if (colorArr && tmpColor) {
      const srcColorBase = oldIdx * 3;
      const dstColorBase = newIdx * 3;
      tmpColor[dstColorBase + 0] = colorArr[srcColorBase + 0];
      tmpColor[dstColorBase + 1] = colorArr[srcColorBase + 1];
      tmpColor[dstColorBase + 2] = colorArr[srcColorBase + 2];
    }
    tmpGeomIndex[newIdx] = geomIndexArr[oldIdx] | 0;
  }

  for (let i = 0; i < used * 16; i += 1) {
    matrixArr[i] = tmpMatrix[i];
  }
  if (colorArr && tmpColor) {
    for (let i = 0; i < used * 3; i += 1) {
      colorArr[i] = tmpColor[i];
    }
  }
  for (let i = 0; i < used; i += 1) {
    geomIndexArr[i] = tmpGeomIndex[i] | 0;
  }

  if (inst?.geomRefs) {
    for (let instanceId = 0; instanceId < used; instanceId += 1) {
      const geomIndex = geomIndexArr[instanceId] | 0;
      if (!(geomIndex >= 0)) continue;
      const ref = inst.geomRefs[geomIndex] || null;
      if (ref && ref.kind === 'instance' && ref.mesh === mesh) {
        ref.instanceId = instanceId;
      }
    }
  }

  if (matrixAttr) matrixAttr.needsUpdate = true;
  if (colorAttr) colorAttr.needsUpdate = true;
  mesh.userData = mesh.userData || {};
  mesh.userData.instanceToGeomIndex = geomIndexArr;
  return true;
}

function sortInstancedBatchByOrderRank(inst, batch) {
  const used = batch?.used | 0;
  const mesh = batch?.mesh || null;
  if (!mesh || used <= 1) return false;
  const matrixAttr = mesh.instanceMatrix || null;
  const matrixArr = matrixAttr?.array || null;
  const colorAttr = mesh.instanceColor || null;
  const colorArr = colorAttr?.array || null;
  const geomIndexArr = batch.instanceToGeomIndex || null;
  const orderRankArr = batch.instanceOrderRank || null;
  if (!matrixArr || matrixArr.length < used * 16) return false;
  if (!geomIndexArr || geomIndexArr.length < used) return false;
  if (!orderRankArr || orderRankArr.length < used) return false;

  const cap = batch.capacity | 0;
  if (!(cap > 0)) return false;
  if (!Array.isArray(batch.sortOrder)) batch.sortOrder = [];
  if (!(batch.sortTmpMatrix instanceof Float32Array) || batch.sortTmpMatrix.length !== cap * 16) {
    batch.sortTmpMatrix = new Float32Array(cap * 16);
  }
  if (colorArr && (!(batch.sortTmpColor instanceof Float32Array) || batch.sortTmpColor.length !== cap * 3)) {
    batch.sortTmpColor = new Float32Array(cap * 3);
  }
  if (!(batch.sortTmpGeomIndex instanceof Int32Array) || batch.sortTmpGeomIndex.length !== cap) {
    batch.sortTmpGeomIndex = new Int32Array(cap);
  }
  if (!(batch.sortTmpOrderRank instanceof Int32Array) || batch.sortTmpOrderRank.length !== cap) {
    batch.sortTmpOrderRank = new Int32Array(cap);
  }

  const order = batch.sortOrder;
  order.length = used;
  for (let i = 0; i < used; i += 1) {
    order[i] = i;
  }
  order.sort((a, b) => {
    const da = orderRankArr[a] | 0;
    const db = orderRankArr[b] | 0;
    const d = da - db;
    if (d) return d;
    return a - b;
  });

  const tmpMatrix = batch.sortTmpMatrix;
  const tmpColor = batch.sortTmpColor || null;
  const tmpGeomIndex = batch.sortTmpGeomIndex;
  const tmpOrderRank = batch.sortTmpOrderRank;
  for (let newIdx = 0; newIdx < used; newIdx += 1) {
    const oldIdx = order[newIdx] | 0;
    const srcMatBase = oldIdx * 16;
    const dstMatBase = newIdx * 16;
    for (let j = 0; j < 16; j += 1) {
      tmpMatrix[dstMatBase + j] = matrixArr[srcMatBase + j];
    }
    if (colorArr && tmpColor) {
      const srcColorBase = oldIdx * 3;
      const dstColorBase = newIdx * 3;
      tmpColor[dstColorBase + 0] = colorArr[srcColorBase + 0];
      tmpColor[dstColorBase + 1] = colorArr[srcColorBase + 1];
      tmpColor[dstColorBase + 2] = colorArr[srcColorBase + 2];
    }
    tmpGeomIndex[newIdx] = geomIndexArr[oldIdx] | 0;
    tmpOrderRank[newIdx] = orderRankArr[oldIdx] | 0;
  }

  for (let i = 0; i < used * 16; i += 1) {
    matrixArr[i] = tmpMatrix[i];
  }
  if (colorArr && tmpColor) {
    for (let i = 0; i < used * 3; i += 1) {
      colorArr[i] = tmpColor[i];
    }
  }
  for (let i = 0; i < used; i += 1) {
    geomIndexArr[i] = tmpGeomIndex[i] | 0;
    orderRankArr[i] = tmpOrderRank[i] | 0;
  }

  if (inst?.geomRefs) {
    for (let instanceId = 0; instanceId < used; instanceId += 1) {
      const geomIndex = geomIndexArr[instanceId] | 0;
      if (!(geomIndex >= 0)) continue;
      const ref = inst.geomRefs[geomIndex] || null;
      if (ref && ref.kind === 'instance' && ref.mesh === mesh) {
        ref.instanceId = instanceId;
      }
    }
  }

  if (matrixAttr) matrixAttr.needsUpdate = true;
  if (colorAttr) colorAttr.needsUpdate = true;
  mesh.userData = mesh.userData || {};
  mesh.userData.instanceToGeomIndex = geomIndexArr;
  return true;
}

const GEOM_RESOLVE_TMP_WORLD_MAT4 = new THREE.Matrix4();
const GEOM_RESOLVE_TMP_INSTANCE_MAT4 = new THREE.Matrix4();
function resolveGeomWorldMatrix(ctx, geomIndex, outMat4) {
  if (!ctx || !outMat4) return false;
  const index = geomIndex | 0;
  if (!(index >= 0)) return false;
  const inst = ctx._instancing || null;
  const ref = inst?.geomRefs?.[index] || null;
  if (ref && ref.kind === 'instance' && ref.mesh && typeof ref.instanceId === 'number') {
    const instancedMesh = ref.mesh;
    const instanceId = ref.instanceId | 0;
    if (!(instanceId >= 0)) return false;
    const count = typeof instancedMesh.count === 'number' ? (instancedMesh.count | 0) : null;
    if (count != null && instanceId >= count) return false;
    if (typeof instancedMesh.getMatrixAt !== 'function') return false;
    instancedMesh.getMatrixAt(instanceId, GEOM_RESOLVE_TMP_INSTANCE_MAT4);
    outMat4.multiplyMatrices(instancedMesh.matrixWorld, GEOM_RESOLVE_TMP_INSTANCE_MAT4);
    return true;
  }
  const mesh = Array.isArray(ctx.meshes) ? ctx.meshes[index] : null;
  if (mesh?.matrixWorld) {
    outMat4.copy(mesh.matrixWorld);
    return true;
  }
  return false;
}

function resolveGeomWorldPose(ctx, geomIndex, outPos, outQuat, outScale) {
  if (!outPos || !outQuat || !outScale) return false;
  if (!resolveGeomWorldMatrix(ctx, geomIndex, GEOM_RESOLVE_TMP_WORLD_MAT4)) return false;
  GEOM_RESOLVE_TMP_WORLD_MAT4.decompose(outPos, outQuat, outScale);
  return true;
}

function getSharedMeshGeometry(ctx, assets, dataId) {
  if (!ctx.assetCache || !(ctx.assetCache.meshGeometries instanceof Map)) {
    ctx.assetCache = {
      meshGeometries: new Map(),
    };
  }
  const cache = ctx.assetCache.meshGeometries;
  if (cache.has(dataId)) return cache.get(dataId);
  const geometry = createMeshGeometryFromAssets(assets, dataId);
  if (geometry) {
    cache.set(dataId, geometry);
  }
  return geometry || null;
}

const SEGMENT_FLAG_INDEX = 7;
const SEGMENT_PALETTE = [
  0x1f77b4, 0xff7f0e, 0x2ca02c, 0xd62728, 0x9467bd,
  0x8c564b, 0xe377c2, 0x7f7f7f, 0xbcbd22, 0x17becf,
  0xaec7e8, 0xffbb78, 0x98df8a, 0xff9896, 0xc5b0d5,
  0xc49c94, 0xf7b6d2, 0xc7c7c7, 0xdbdb8d, 0x9edae5,
];

function segmentColorForIndex(index) {
  const palette = SEGMENT_PALETTE;
  if (!(index >= 0)) return palette[0];
  return palette[index % palette.length];
}

function segmentBackgroundColor() {
  return 0x000000;
}

function restoreSegmentMaterial(mesh) {
  const userData = mesh?.userData || null;
  if (!mesh || !userData || !userData.segmentMaterial || !userData.segmentOriginalMaterial) {
    return;
  }
  if (mesh.material === userData.segmentMaterial) {
    mesh.material = userData.segmentOriginalMaterial;
  }
}

function ensureSegmentMaterial(mesh, sceneFlags) {
  if (!mesh) return null;
  const userData = mesh.userData || (mesh.userData = {});
  if (!userData.segmentOriginalMaterial) {
    userData.segmentOriginalMaterial = mesh.material;
  }
  let material = userData.segmentMaterial;
  if (!material) {
    material = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      depthWrite: true,
      depthTest: true,
      toneMapped: false,
    });
    userData.segmentMaterial = material;
  }
  material.wireframe = false;
  return material;
}

function applyMaterialFlags(mesh, index, state, sceneFlagsOverride = null) {
  if (!mesh || !mesh.material) return;
  const sceneFlags = sceneFlagsOverride || state.rendering?.sceneFlags || [];
  mesh.material.wireframe = !!sceneFlags[1];
  if (mesh.material.emissive && typeof mesh.material.emissive.set === 'function') {
    mesh.material.emissive.set(0x000000);
  } else if (mesh.material && 'emissive' in mesh.material) {
    mesh.material.emissive = new THREE.Color(0x000000);
  }
}

function resolveMaterialReflectance(matIndex, assets) {
  if (!(matIndex >= 0)) return 0;
  const reflectArr = assets?.materials?.reflectance || null;
  if (!reflectArr) return 0;
  const value = reflectArr[matIndex];
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Number(value));
}

function applyReflectanceToMaterial(mesh, ctx, reflectance, reflectionEnabled) {
  if (!mesh) return;
  mesh.userData = mesh.userData || {};
  const mode = ctx?.visualSourceMode || 'model';
  const baseIntensity = typeof ctx?.envIntensity === 'number' ? ctx.envIntensity : 0;
  const mat = mesh.material;
  if (!mat || !('envMapIntensity' in mat)) return;
  if (!('reflectanceBaseEnvIntensity' in mesh.userData) || mesh.userData.reflectanceBaseEnvIntensity == null) {
    mesh.userData.reflectanceBaseEnvIntensity = typeof mat.envMapIntensity === 'number' ? mat.envMapIntensity : 0;
  }
  const clampedReflectance = Number.isFinite(reflectance) ? Math.max(0, reflectance) : 0;
  mesh.userData.reflectance = clampedReflectance;
  const presetMode = mode === 'preset-sun' || mode === 'preset-moon';
  const effectiveReflectance = clampedReflectance > 0 ? clampedReflectance : 0;
  let nextEnvIntensity = mat.envMapIntensity;
  if (!reflectionEnabled || baseIntensity <= 0 || !presetMode) {
    nextEnvIntensity = 0;
  } else {
    nextEnvIntensity = baseIntensity * effectiveReflectance;
  }
  if (Number.isFinite(nextEnvIntensity)) {
    const current = typeof mat.envMapIntensity === 'number' ? mat.envMapIntensity : 0;
    if (Math.abs(current - nextEnvIntensity) > 1e-6) {
      mat.envMapIntensity = nextEnvIntensity;
    }
  }
  if (ctx) {
    ctx._envDebugSample = {
      baseIntensity,
      reflectance: clampedReflectance,
      reflectionEnabled: !!reflectionEnabled,
      envMapIntensity: nextEnvIntensity,
    };
  }
}

function ensureGeomMesh(ctx, index, gtype, assets, dataId, sizeVec, options = {}, state = null) {
  if (!ctx.meshes) ctx.meshes = [];
  const infinitePlane = gtype === MJ_GEOM.PLANE && isInfinitePlaneSize(sizeVec);
  let mesh = ctx.meshes[index];
  if (mesh?.userData?.proxy) {
    mesh = null;
  }
  const sx = Number(sizeVec?.[0]) || 0;
  const sy = Number(sizeVec?.[1]) || 0;
  const sz = Number(sizeVec?.[2]) || 0;
  const needsSizeCheck =
    !infinitePlane &&
    (gtype !== MJ_GEOM.MESH && gtype !== MJ_GEOM.SDF);
  const hasSizeKeys =
    !!mesh &&
    !!mesh.userData &&
    typeof mesh.userData.geomSizeX === 'number' &&
    typeof mesh.userData.geomSizeY === 'number' &&
    typeof mesh.userData.geomSizeZ === 'number';
  const dynamicSizeScale = !!options.dynamicSizeScale && isDynamicSizeScaleGeomType(gtype);
  const sizeChanged =
    needsSizeCheck &&
    (!hasSizeKeys ||
      Math.abs(mesh.userData.geomSizeX - sx) > 1e-6 ||
      Math.abs(mesh.userData.geomSizeY - sy) > 1e-6 ||
      Math.abs(mesh.userData.geomSizeZ - sz) > 1e-6);
  const needsRebuild =
    !mesh ||
    mesh.userData?.geomType !== gtype ||
    (!!mesh.userData?.infinitePlane !== infinitePlane) ||
    ((gtype === MJ_GEOM.MESH || gtype === MJ_GEOM.SDF) && mesh.userData?.geomDataId !== dataId) ||
    (sizeChanged && !dynamicSizeScale);

  if (needsRebuild) {
    if (mesh) {
      disposeMeshObject(mesh);
    }

    if (infinitePlane) {
      mesh = createInfiniteGroundHelper({
        color: 0xf5f5f5,
        distance: GROUND_DISTANCE,
        renderOrder: RENDER_ORDER.GROUND,
      });
      mesh.userData = mesh.userData || {};
      mesh.userData.infinitePlane = true;
      mesh.userData.geomType = gtype;
      mesh.userData.geomDataId = -1;
      mesh.userData.geomSizeKey = 'infinite';
      mesh.userData.ownGeometry = true;
      mesh.userData.geomIndex = index;
      ctx.root.add(mesh);
      ctx.meshes[index] = mesh;
    } else {
      let geometryInfo = null;
      if ((gtype === MJ_GEOM.MESH || gtype === MJ_GEOM.SDF) && assets && dataId >= 0) {
        const meshGeometry = getSharedMeshGeometry(ctx, assets, dataId);
        if (meshGeometry) {
          geometryInfo = {
            geometry: meshGeometry,
            materialOpts: {
              color: 0xffffff,
              metalness: 0.05,
              roughness: 0.55,
            },
            postCreate: null,
            ownGeometry: false,
          };
        } else if (!ctx.meshAssetMissingLogged) {
          logDebug('[render] mesh geometry missing', { dataId });
          ctx.meshAssetMissingLogged = true;
        }
      }
      if (!geometryInfo) {
        const fb = ctx.fallback || {};
        geometryInfo = createPrimitiveGeometry(gtype, sizeVec, {
          fallbackEnabled: fb.enabled !== false,
          preset: fb.preset || 'bright-outdoor',
        });
        geometryInfo.ownGeometry = true;
      }
      const objectKind = geometryInfo.objectKind || 'mesh';

      let material;
      if (geometryInfo.materialOpts && geometryInfo.materialOpts.shadow) {
        const op = Number.isFinite(geometryInfo.materialOpts.shadowOpacity)
          ? geometryInfo.materialOpts.shadowOpacity
          : 0.5;
        material = new THREE.ShadowMaterial({ opacity: op });
      } else {
        const baseOpts = geometryInfo.materialOpts || {};
        const useStandard = gtype === MJ_GEOM.PLANE || gtype === MJ_GEOM.HFIELD;
        const sceneFlags = state?.rendering?.sceneFlags || [];
        const wire = !!sceneFlags[1];
        const kind = baseOpts.kind || null;
        if (objectKind === 'line' || kind === 'line') {
          material = new THREE.LineBasicMaterial({
            color: baseOpts.color ?? 0xffffff,
            transparent: true,
            opacity: 1,
            depthWrite: true,
            depthTest: true,
            toneMapped: false,
          });
        } else if (kind === 'basic') {
          material = new THREE.MeshBasicMaterial({
            color: baseOpts.color ?? 0xffffff,
            transparent: true,
            opacity: 1,
            depthWrite: true,
            depthTest: true,
            toneMapped: false,
          });
          if (baseOpts.doubleSided) {
            material.side = THREE.DoubleSide;
          }
        } else {
          const poolKey = {
            kind: useStandard ? 'standard' : 'physical',
            color: baseOpts.color ?? 0xffffff,
            roughness: baseOpts.roughness ?? 0.55,
            metalness: baseOpts.metalness ?? 0.0,
            wireframe: wire,
          };
          if (!ctx.materialPool) ctx.materialPool = new MaterialPool(THREE);
          material = ctx.materialPool.get(poolKey);
          if (material && material.userData?.pooled) {
            const cloned = material.clone();
            cloned.userData = cloned.userData || {};
            cloned.userData.pooled = false;
            material = cloned;
          }
          if (!useStandard) material.envMapIntensity = 0;
        }
      }
      if (material && 'side' in material) material.side = THREE.FrontSide;
      mesh = objectKind === 'line'
        ? new THREE.LineSegments(geometryInfo.geometry, material)
        : new THREE.Mesh(geometryInfo.geometry, material);
      const isDebugGeom =
        gtype === MJ_GEOM.LINE ||
        gtype === MJ_GEOM.LINEBOX ||
        gtype === MJ_GEOM.ARROW ||
        gtype === MJ_GEOM.ARROW1 ||
        gtype === MJ_GEOM.ARROW2 ||
        gtype === MJ_GEOM.TRIANGLE;
      mesh.castShadow = !isDebugGeom;
      mesh.receiveShadow = !isDebugGeom;
      if (typeof geometryInfo.postCreate === 'function') {
        geometryInfo.postCreate(mesh);
      }
      mesh.userData = mesh.userData || {};
      mesh.userData.infinitePlane = false;
      mesh.userData.geomType = gtype;
      mesh.userData.geomDataId = (gtype === MJ_GEOM.MESH || gtype === MJ_GEOM.SDF) ? dataId : -1;
      mesh.userData.geomSizeX = sx;
      mesh.userData.geomSizeY = sy;
      mesh.userData.geomSizeZ = sz;
      mesh.userData.ownGeometry = geometryInfo.ownGeometry !== false;
      mesh.userData.geomIndex = index;
      ctx.root.add(mesh);
      ctx.meshes[index] = mesh;
    }
  }

  if (mesh && options.geomMeta) {
    applyGeomMetadata(mesh, options.geomMeta);
  }
  if (mesh && dynamicSizeScale) {
    ensureGeomBuiltSizes(mesh, gtype);
    mesh.userData = mesh.userData || {};
    mesh.userData.geomSizeX = sx;
    mesh.userData.geomSizeY = sy;
    mesh.userData.geomSizeZ = sz;
  }
  return mesh;
}
function ensureGeomState(context, index, geomMeta = null) {
  context.geomState = context.geomState || [];
  let existing = context.geomState[index];
  if (existing && existing.mj && existing.view) {
    if (!geomMeta) return existing;
    // Refresh mj mirror; view layer kept as-is so overrides persist across frames.
    existing.mj.type = geomMeta.type;
    existing.mj.dataId = geomMeta.dataId;
    existing.mj.matId = geomMeta.matId;
    existing.mj.groupId = geomMeta.groupId;
    existing.mj.bodyId = geomMeta.bodyId;
    if (geomMeta.size) {
      let dst = existing.mj.size;
      if (!Array.isArray(dst) || dst.length < 3) {
        dst = [0, 0, 0];
        existing.mj.size = dst;
      }
      dst[0] = Number(geomMeta.size[0]) || 0;
      dst[1] = Number(geomMeta.size[1]) || 0;
      dst[2] = Number(geomMeta.size[2]) || 0;
    } else {
      existing.mj.size = null;
    }
    if (geomMeta.rgba) {
      let dst = existing.mj.rgba;
      if (!Array.isArray(dst) || dst.length < 4) {
        dst = [0, 0, 0, 0];
        existing.mj.rgba = dst;
      }
      dst[0] = Number(geomMeta.rgba[0]) || 0;
      dst[1] = Number(geomMeta.rgba[1]) || 0;
      dst[2] = Number(geomMeta.rgba[2]) || 0;
      dst[3] = Number(geomMeta.rgba[3]) || 0;
    } else {
      existing.mj.rgba = null;
    }
    return existing;
  }
  const mj = {
    type: geomMeta?.type ?? MJ_GEOM.BOX,
    size: null,
    dataId: geomMeta?.dataId ?? -1,
    matId: geomMeta?.matId ?? -1,
    groupId: geomMeta?.groupId ?? 0,
    bodyId: geomMeta?.bodyId ?? -1,
    rgba: null,
  };
  if (geomMeta?.size) {
    mj.size = [Number(geomMeta.size[0]) || 0, Number(geomMeta.size[1]) || 0, Number(geomMeta.size[2]) || 0];
  }
  if (geomMeta?.rgba) {
    mj.rgba = [Number(geomMeta.rgba[0]) || 0, Number(geomMeta.rgba[1]) || 0, Number(geomMeta.rgba[2]) || 0, Number(geomMeta.rgba[3]) || 0];
  }
  const view = {
    visibleOverride: null,
    debugHidden: false,
    colorOverride: null,
    roughnessOverride: null,
    metalnessOverride: null,
    envMapIntensityOverride: null,
    emissiveIntensityOverride: null,
    flags: {},
    helpers: {},
    __dirty: true,
  };
  const state = { mj, view };
  context.geomState[index] = state;
  return state;
}

/**
 * Apply high-level visual properties into the JS-side geom view state.
 * This helper deliberately hides whether a property is implemented via
 * MuJoCo fields or JS-only overrides; callers should only care about
 * the semantic keys on the props object.
 *
 * Supported props (extensible):
 *   - color: number (0xRRGGBB) | [r,g,b] in 0..1
 *   - opacity: number in 0..1
 *   - roughness: number in 0..1
 *   - metallic / metalness: number in 0..1
 *   - envIntensity: number (maps to envMapIntensityOverride)
 *   - emission: number (maps to emissiveIntensityOverride where available)
 *   - visible: boolean
 */
function setGeomViewProps(context, geomIndex, props = {}) {
  if (!context || geomIndex == null) return;
  context.geomState = context.geomState || [];
  let state = context.geomState[geomIndex];
  if (!state) {
    const fallbackMeta = {
      type: MJ_GEOM.BOX,
      size: null,
      dataId: -1,
      matId: -1,
      groupId: 0,
      bodyId: -1,
      rgba: null,
    };
    state = ensureGeomState(context, geomIndex, fallbackMeta);
  }
  const view = state.view || (state.view = {});

  if (Object.prototype.hasOwnProperty.call(props, 'visible')) {
    const v = props.visible;
    if (v === true || v === false) {
      view.visibleOverride = v;
    }
  }

  if (Object.prototype.hasOwnProperty.call(props, 'color') || Object.prototype.hasOwnProperty.call(props, 'opacity')) {
    let r = 1;
    let g = 1;
    let b = 1;
    let a = 1;
    const color = props.color;
    if (typeof color === 'number' && Number.isFinite(color)) {
      const hex = color >>> 0;
      r = ((hex >> 16) & 0xff) / 255;
      g = ((hex >> 8) & 0xff) / 255;
      b = (hex & 0xff) / 255;
    } else if (Array.isArray(color) && color.length >= 3) {
      r = Number(color[0]) || 0;
      g = Number(color[1]) || 0;
      b = Number(color[2]) || 0;
    }
    if (Object.prototype.hasOwnProperty.call(props, 'opacity') && Number.isFinite(props.opacity)) {
      a = Math.max(0, Math.min(1, props.opacity));
    }
    view.colorOverride = [r, g, b, a];
  }

  if (Object.prototype.hasOwnProperty.call(props, 'roughness') && props.roughness != null) {
    view.roughnessOverride = props.roughness;
  }
  if (Object.prototype.hasOwnProperty.call(props, 'metallic') && props.metallic != null) {
    view.metalnessOverride = props.metallic;
  }
  if (Object.prototype.hasOwnProperty.call(props, 'metalness') && props.metalness != null) {
    view.metalnessOverride = props.metalness;
  }
  if (Object.prototype.hasOwnProperty.call(props, 'envIntensity') && props.envIntensity != null) {
    view.envMapIntensityOverride = props.envIntensity;
  }
  if (Object.prototype.hasOwnProperty.call(props, 'emission') && props.emission != null) {
    view.emissiveIntensityOverride = props.emission;
  }

  view.__dirty = true;
}

function updateInfinitePlaneFromSceneSoA(mesh, scnIndex, snapshot, sceneFlags = null) {
  const groundData = mesh.userData?.infiniteGround;
  if (!groundData) return;
  const xpos = snapshot?.scn_pos;
  const xmat = snapshot?.scn_mat;
  if (!xpos || !xmat) return;
  const uniforms = groundData.uniforms || {};
  const segmentEnabled = Array.isArray(sceneFlags) ? !!sceneFlags[SEGMENT_FLAG_INDEX] : false;
  const userData = mesh.userData || (mesh.userData = {});

  const i = scnIndex | 0;
  const baseIndex = 3 * i;
  const px = xpos?.[baseIndex + 0] ?? 0;
  const py = xpos?.[baseIndex + 1] ?? 0;
  const pz = xpos?.[baseIndex + 2] ?? 0;
  const matBase = 9 * i;
  const rot = [
    xmat?.[matBase + 0] ?? 1,
    xmat?.[matBase + 1] ?? 0,
    xmat?.[matBase + 2] ?? 0,
    xmat?.[matBase + 3] ?? 0,
    xmat?.[matBase + 4] ?? 1,
    xmat?.[matBase + 5] ?? 0,
    xmat?.[matBase + 6] ?? 0,
    xmat?.[matBase + 7] ?? 0,
    xmat?.[matBase + 8] ?? 1,
  ];
  const quat = mat3ToQuat(rot);
  if (uniforms.uPlaneOrigin?.value) {
    uniforms.uPlaneOrigin.value.set(px, py, pz);
  }
  if (uniforms.uPlaneAxisU?.value) {
    uniforms.uPlaneAxisU.value.copy(__TMP_VEC3_A.set(1, 0, 0).applyQuaternion(quat).normalize());
  }
  if (uniforms.uPlaneAxisV?.value) {
    uniforms.uPlaneAxisV.value.copy(__TMP_VEC3_B.set(0, 1, 0).applyQuaternion(quat).normalize());
  }
  if (uniforms.uPlaneNormal?.value) {
    uniforms.uPlaneNormal.value.copy(__TMP_VEC3_C.set(0, 0, 1).applyQuaternion(quat).normalize());
  }

  // Segment view: temporarily hide the ground grid by zeroing intensity,
  // but restore original values when segment is disabled.
  if (segmentEnabled) {
    if (!userData.segmentGroundGrid) {
      userData.segmentGroundGrid = {
        step: uniforms.uGridStep ? uniforms.uGridStep.value : null,
        intensity: uniforms.uGridIntensity ? uniforms.uGridIntensity.value : null,
      };
    }
    if (uniforms.uGridStep) {
      uniforms.uGridStep.value = 0;
    }
    if (uniforms.uGridIntensity) {
      uniforms.uGridIntensity.value = 0;
    }
  } else if (userData.segmentGroundGrid) {
    const backup = userData.segmentGroundGrid;
    if (uniforms.uGridStep && backup.step != null) {
      uniforms.uGridStep.value = backup.step;
    }
    if (uniforms.uGridIntensity && backup.intensity != null) {
      uniforms.uGridIntensity.value = backup.intensity;
    }
    userData.segmentGroundGrid = null;
  }
  // Ensure infinite ground remains blended by alpha
  if (mesh.material) {
    mesh.material.transparent = true;
    if ('depthWrite' in mesh.material) mesh.material.depthWrite = true;
    if ('needsUpdate' in mesh.material) mesh.material.needsUpdate = true;
  }
}

function getDefaultVopt(ctx, state) {
  if (!state?.rendering?.voptFlags) return null;
  if (!ctx.defaultVopt) {
    ctx.defaultVopt = state.rendering.voptFlags.slice();
  }
  return ctx.defaultVopt;
}

function ensureFlexGroup(ctx) {
  if (!ctx) return null;
  if (!ctx.flexGroup) {
    const group = new THREE.Group();
    group.name = 'base:flexes';
    if (ctx.root) ctx.root.add(group);
    ctx.flexGroup = group;
    ctx.flexPool = [];
  }
  return ctx.flexGroup;
}

function hideFlexGroup(ctx) {
  if (!ctx) return;
  const group = ctx.flexGroup || null;
  if (group) group.visible = false;
  if (Array.isArray(ctx.flexPool)) {
    for (const entry of ctx.flexPool) {
      if (entry?.group) entry.group.visible = false;
    }
  }
}

function ensureFlexEntry(ctx, index, assets, state) {
  const flexAssets = assets?.flexes || null;
  const count = flexAssets?.count | 0;
  if (!(count > 0) || index < 0 || index >= count) return null;
  const group = ensureFlexGroup(ctx);
  if (!group) return null;

  const pool = Array.isArray(ctx.flexPool) ? ctx.flexPool : (ctx.flexPool = []);
  const vertnum = flexAssets?.vertnum && index < flexAssets.vertnum.length ? (flexAssets.vertnum[index] | 0) : 0;
  const edgenum = flexAssets?.edgenum && index < flexAssets.edgenum.length ? (flexAssets.edgenum[index] | 0) : 0;
  const dim = flexAssets?.dim && index < flexAssets.dim.length ? (flexAssets.dim[index] | 0) : 0;
  let entry = pool[index] || null;

  const needsRebuild = !entry || entry.vertnum !== vertnum || entry.edgenum !== edgenum || entry.dim !== dim;
  if (needsRebuild) {
    if (entry?.group) {
      try { group.remove(entry.group); } catch {}
    }
    const entryGroup = new THREE.Group();
    entryGroup.name = `flex:${index}`;
    entryGroup.userData = entryGroup.userData || {};
    entryGroup.userData.flexIndex = index;
    group.add(entryGroup);

    const vertexPositions = vertnum > 0 ? new Float32Array(vertnum * 3) : new Float32Array(0);

    const pointsGeom = new THREE.BufferGeometry();
    if (vertexPositions.length) {
      pointsGeom.setAttribute('position', new THREE.BufferAttribute(vertexPositions, 3));
    }
    const pointsMat = new THREE.PointsMaterial({ color: 0xffffff, size: 3, sizeAttenuation: true, transparent: true, opacity: 1 });
    const points = new THREE.Points(pointsGeom, pointsMat);
    points.frustumCulled = false;
    points.userData = points.userData || {};
    points.userData.flexKind = 'vert';
    entryGroup.add(points);

    const edgeGeom = new THREE.BufferGeometry();
    if (vertexPositions.length) {
      edgeGeom.setAttribute('position', new THREE.BufferAttribute(vertexPositions, 3));
    }
    if (edgenum > 0 && flexAssets?.edge) {
      const edgeAdr = flexAssets?.edgeadr && index < flexAssets.edgeadr.length ? (flexAssets.edgeadr[index] | 0) : 0;
      const base = Math.max(0, edgeAdr) * 2;
      const end = base + edgenum * 2;
      const edgeSrc = flexAssets.edge;
      if (end <= edgeSrc.length) {
        const indices = new Uint32Array(edgenum * 2);
        for (let i = 0; i < edgenum * 2; i += 1) {
          indices[i] = edgeSrc[base + i] >>> 0;
        }
        edgeGeom.setIndex(new THREE.BufferAttribute(indices, 1));
      }
    }
    const edgeMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 1 });
    const edges = new THREE.LineSegments(edgeGeom, edgeMat);
    edges.frustumCulled = false;
    edges.userData = edges.userData || {};
    edges.userData.flexKind = 'edge';
    entryGroup.add(edges);

    const faceGeom = new THREE.BufferGeometry();
    const faceMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.8,
      metalness: 0.0,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 1,
    });
    const faces = new THREE.Mesh(faceGeom, faceMat);
    faces.frustumCulled = false;
    faces.castShadow = false;
    faces.receiveShadow = false;
    faces.userData = faces.userData || {};
    faces.userData.flexKind = 'face';
    entryGroup.add(faces);

    entry = {
      group: entryGroup,
      points,
      edges,
      faces,
      vertexPositions,
      vertnum,
      edgenum,
      dim,
      _facePositions: null,
      _faceNormals: null,
      _vertnorm: null,
    };
    pool[index] = entry;
  }

  const sceneFlags = state?.rendering?.sceneFlags || [];
  const wire = !!sceneFlags[1];
  if (entry?.faces?.material && 'wireframe' in entry.faces.material) {
    entry.faces.material.wireframe = wire;
  }

  return entry;
}

function applyFlexAppearance(entry, flexIndex, assets, ctx, textureEnabled) {
  if (!entry) return;
  const appearance = resolveFlexAppearance(flexIndex, assets || null);
  if (entry.points) applyAppearanceToMaterial(entry.points, appearance);
  if (entry.edges) applyAppearanceToMaterial(entry.edges, appearance);
  if (entry.faces) applyAppearanceToMaterial(entry.faces, appearance);
  if (entry.faces) {
    const matIdView = assets?.flexes?.matid || null;
    const matId = matIdView && flexIndex < matIdView.length ? (matIdView[flexIndex] | 0) : -1;
    entry.faces.userData = entry.faces.userData || {};
    entry.faces.userData.matId = matId;
    applyMuJoCoTextureToMesh(entry.faces, matId, ctx, assets, textureEnabled, { texcoordMode: 'explicit' });
  }
}

function normalize3Inv(x, y, z) {
  const n = Math.sqrt(x * x + y * y + z * z);
  if (!(n > 0)) return 0;
  return 1 / n;
}

function flexMakeFace(posOut, nrmOut, faceIndex, radius, vertxpos, i0, i1, i2) {
  const v0x = vertxpos[3 * i0 + 0], v0y = vertxpos[3 * i0 + 1], v0z = vertxpos[3 * i0 + 2];
  const v1x = vertxpos[3 * i1 + 0], v1y = vertxpos[3 * i1 + 1], v1z = vertxpos[3 * i1 + 2];
  const v2x = vertxpos[3 * i2 + 0], v2y = vertxpos[3 * i2 + 1], v2z = vertxpos[3 * i2 + 2];
  const v01x = v1x - v0x, v01y = v1y - v0y, v01z = v1z - v0z;
  const v02x = v2x - v0x, v02y = v2y - v0y, v02z = v2z - v0z;
  const cx = v01y * v02z - v01z * v02y;
  const cy = v01z * v02x - v01x * v02z;
  const cz = v01x * v02y - v01y * v02x;
  const inv = normalize3Inv(cx, cy, cz);
  const nx = cx * inv, ny = cy * inv, nz = cz * inv;
  const offx = radius * nx, offy = radius * ny, offz = radius * nz;
  const base = 9 * faceIndex;
  posOut[base + 0] = v0x + offx;
  posOut[base + 1] = v0y + offy;
  posOut[base + 2] = v0z + offz;
  posOut[base + 3] = v1x + offx;
  posOut[base + 4] = v1y + offy;
  posOut[base + 5] = v1z + offz;
  posOut[base + 6] = v2x + offx;
  posOut[base + 7] = v2y + offy;
  posOut[base + 8] = v2z + offz;
  for (let k = 0; k < 3; k += 1) {
    nrmOut[base + 3 * k + 0] = nx;
    nrmOut[base + 3 * k + 1] = ny;
    nrmOut[base + 3 * k + 2] = nz;
  }
}

function flexAddNormal(vertnorm, vertxpos, i0, i1, i2) {
  const v0x = vertxpos[3 * i0 + 0], v0y = vertxpos[3 * i0 + 1], v0z = vertxpos[3 * i0 + 2];
  const v1x = vertxpos[3 * i1 + 0], v1y = vertxpos[3 * i1 + 1], v1z = vertxpos[3 * i1 + 2];
  const v2x = vertxpos[3 * i2 + 0], v2y = vertxpos[3 * i2 + 1], v2z = vertxpos[3 * i2 + 2];
  const v01x = v1x - v0x, v01y = v1y - v0y, v01z = v1z - v0z;
  const v02x = v2x - v0x, v02y = v2y - v0y, v02z = v2z - v0z;
  const cx = v01y * v02z - v01z * v02y;
  const cy = v01z * v02x - v01x * v02z;
  const cz = v01x * v02y - v01y * v02x;
  const inv = normalize3Inv(cx, cy, cz);
  const nx = cx * inv, ny = cy * inv, nz = cz * inv;
  vertnorm[3 * i0 + 0] += nx; vertnorm[3 * i0 + 1] += ny; vertnorm[3 * i0 + 2] += nz;
  vertnorm[3 * i1 + 0] += nx; vertnorm[3 * i1 + 1] += ny; vertnorm[3 * i1 + 2] += nz;
  vertnorm[3 * i2 + 0] += nx; vertnorm[3 * i2 + 1] += ny; vertnorm[3 * i2 + 2] += nz;
}

function flexMakeSmooth(posOut, nrmOut, faceIndex, radius, flgFlat, vertnorm, vertxpos, i0, i1, i2) {
  const base = 9 * faceIndex;
  const sign = radius > 0 ? 1 : -1;
  const ind0 = i0 | 0, ind1 = i1 | 0, ind2 = i2 | 0;
  if (flgFlat) {
    const v0x = vertxpos[3 * ind0 + 0], v0y = vertxpos[3 * ind0 + 1], v0z = vertxpos[3 * ind0 + 2];
    const v1x = vertxpos[3 * ind1 + 0], v1y = vertxpos[3 * ind1 + 1], v1z = vertxpos[3 * ind1 + 2];
    const v2x = vertxpos[3 * ind2 + 0], v2y = vertxpos[3 * ind2 + 1], v2z = vertxpos[3 * ind2 + 2];
    const v01x = v1x - v0x, v01y = v1y - v0y, v01z = v1z - v0z;
    const v02x = v2x - v0x, v02y = v2y - v0y, v02z = v2z - v0z;
    const cx = v01y * v02z - v01z * v02y;
    const cy = v01z * v02x - v01x * v02z;
    const cz = v01x * v02y - v01y * v02x;
    const inv = normalize3Inv(cx, cy, cz);
    const nx = cx * inv, ny = cy * inv, nz = cz * inv;
    for (let k = 0; k < 3; k += 1) {
      nrmOut[base + 3 * k + 0] = sign * nx;
      nrmOut[base + 3 * k + 1] = sign * ny;
      nrmOut[base + 3 * k + 2] = sign * nz;
    }
  } else {
    const ix = [ind0, ind1, ind2];
    for (let k = 0; k < 3; k += 1) {
      const vid = ix[k];
      nrmOut[base + 3 * k + 0] = sign * vertnorm[3 * vid + 0];
      nrmOut[base + 3 * k + 1] = sign * vertnorm[3 * vid + 1];
      nrmOut[base + 3 * k + 2] = sign * vertnorm[3 * vid + 2];
    }
  }
  const ix = [ind0, ind1, ind2];
  for (let k = 0; k < 3; k += 1) {
    const vid = ix[k];
    posOut[base + 3 * k + 0] = vertxpos[3 * vid + 0] + radius * vertnorm[3 * vid + 0];
    posOut[base + 3 * k + 1] = vertxpos[3 * vid + 1] + radius * vertnorm[3 * vid + 1];
    posOut[base + 3 * k + 2] = vertxpos[3 * vid + 2] + radius * vertnorm[3 * vid + 2];
  }
}

function flexMakeSide(posOut, nrmOut, faceIndex, radius, vertnorm, vertxpos, i0, i1) {
  const base = 9 * faceIndex;
  const v0x = vertxpos[3 * i0 + 0], v0y = vertxpos[3 * i0 + 1], v0z = vertxpos[3 * i0 + 2];
  const v1x = vertxpos[3 * i1 + 0], v1y = vertxpos[3 * i1 + 1], v1z = vertxpos[3 * i1 + 2];
  const v01x = v1x - v0x, v01y = v1y - v0y, v01z = v1z - v0z;
  const vn1x = vertnorm[3 * i1 + 0], vn1y = vertnorm[3 * i1 + 1], vn1z = vertnorm[3 * i1 + 2];
  let cx = v01y * vn1z - v01z * vn1y;
  let cy = v01z * vn1x - v01x * vn1z;
  let cz = v01x * vn1y - v01y * vn1x;
  if (radius < 0) {
    cx = -cx; cy = -cy; cz = -cz;
  }
  const inv = normalize3Inv(cx, cy, cz);
  const nx = cx * inv, ny = cy * inv, nz = cz * inv;
  for (let k = 0; k < 3; k += 1) {
    nrmOut[base + 3 * k + 0] = nx;
    nrmOut[base + 3 * k + 1] = ny;
    nrmOut[base + 3 * k + 2] = nz;
  }
  const ind = [i0 | 0, i1 | 0, i1 | 0];
  for (let k = 0; k < 3; k += 1) {
    const sign = k === 1 ? -1 : 1;
    const vid = ind[k];
    posOut[base + 3 * k + 0] = vertxpos[3 * vid + 0] + sign * radius * vertnorm[3 * vid + 0];
    posOut[base + 3 * k + 1] = vertxpos[3 * vid + 1] + sign * radius * vertnorm[3 * vid + 1];
    posOut[base + 3 * k + 2] = vertxpos[3 * vid + 2] + sign * radius * vertnorm[3 * vid + 2];
  }
}

function fillFlexFaceTexcoords(uvOut, faceIndex, texcoordArr, baseOffset, texcoordLength, i0, i1, i2) {
  if (!uvOut || !texcoordArr || baseOffset < 0) return;
  const destBase = faceIndex * 6;
  const writeUV = (destOffset, texIdx) => {
    const idx = Number.isFinite(texIdx) ? (texIdx | 0) : -1;
    const outIndex = destBase + destOffset;
    if (idx < 0) {
      uvOut[outIndex] = 0;
      uvOut[outIndex + 1] = 0;
      return;
    }
    const srcIndex = baseOffset + idx * 2;
    if (srcIndex + 1 >= texcoordLength) {
      uvOut[outIndex] = 0;
      uvOut[outIndex + 1] = 0;
      return;
    }
    uvOut[outIndex] = texcoordArr[srcIndex];
    uvOut[outIndex + 1] = texcoordArr[srcIndex + 1];
  };
  writeUV(0, i0);
  writeUV(2, i1);
  writeUV(4, i2);
}

function updateFlexFaces(entry, flexIndex, snapshot, state, assets, useSkin, flexLayer) {
  const flexAssets = assets?.flexes || null;
  if (!entry || !flexAssets) return;
  const dim = entry.dim | 0;
  if (dim === 1) {
    entry.faces.visible = false;
    return;
  }
  const flexLayerValue = Number.isFinite(flexLayer) ? (flexLayer | 0) : 0;
  const elemLayerArr = flexAssets?.elemlayer || null;
  const elemAdr = flexAssets?.elemadr && flexIndex < flexAssets.elemadr.length ? (flexAssets.elemadr[flexIndex] | 0) : 0;
  const texcoordArr = flexAssets?.texcoord || null;
  const texcoordAdr = flexAssets?.texcoordadr && flexIndex < flexAssets.texcoordadr.length ? (flexAssets.texcoordadr[flexIndex] | 0) : -1;
  const texcoordBaseOffset = texcoordAdr >= 0 ? Math.max(0, texcoordAdr) * 2 : -1;
  const texcoordLength = texcoordArr?.length || 0;
  const elemTexcoordArr = flexAssets?.elemtexcoord || null;
  const vertadr = flexAssets?.vertadr && flexIndex < flexAssets.vertadr.length ? (flexAssets.vertadr[flexIndex] | 0) : 0;
  const vertnum = entry.vertnum | 0;
  if (!(vertnum > 0)) {
    entry.faces.visible = false;
    return;
  }
  const srcAll = snapshot?.flexvert_xpos || null;
  const base = Math.max(0, vertadr) * 3;
  const end = base + vertnum * 3;
  if (!srcAll || end > srcAll.length) {
    entry.faces.visible = false;
    return;
  }
  const vertxpos = srcAll.subarray(base, end);
  const radius = flexAssets?.radius && flexIndex < flexAssets.radius.length ? Number(flexAssets.radius[flexIndex]) || 0 : 0;
  const flgFlat = flexAssets?.flatskin && flexIndex < flexAssets.flatskin.length ? (flexAssets.flatskin[flexIndex] ? 1 : 0) : 0;

  let nface = 0;
  if (!useSkin) {
    if (dim === 2) {
      const elemnum = flexAssets?.elemnum && flexIndex < flexAssets.elemnum.length ? (flexAssets.elemnum[flexIndex] | 0) : 0;
      nface = Math.max(0, elemnum) * 2;
    } else if (dim === 3) {
      const elemnum = flexAssets?.elemnum && flexIndex < flexAssets.elemnum.length ? (flexAssets.elemnum[flexIndex] | 0) : 0;
      nface = Math.max(0, elemnum) * 4;
    }
  } else {
    if (dim === 2) {
      const elemnum = flexAssets?.elemnum && flexIndex < flexAssets.elemnum.length ? (flexAssets.elemnum[flexIndex] | 0) : 0;
      const shellnum = flexAssets?.shellnum && flexIndex < flexAssets.shellnum.length ? (flexAssets.shellnum[flexIndex] | 0) : 0;
      nface = Math.max(0, elemnum) * 2 + Math.max(0, shellnum) * 2;
    } else if (dim === 3) {
      const shellnum = flexAssets?.shellnum && flexIndex < flexAssets.shellnum.length ? (flexAssets.shellnum[flexIndex] | 0) : 0;
      nface = Math.max(0, shellnum);
    }
  }
  if (!(nface > 0)) {
    entry.faces.visible = false;
    return;
  }

  const needed = nface * 9;
  let posOut = entry._facePositions;
  let nrmOut = entry._faceNormals;
  if (!posOut || posOut.length !== needed) posOut = new Float32Array(needed);
  if (!nrmOut || nrmOut.length !== needed) nrmOut = new Float32Array(needed);
  entry._facePositions = posOut;
  entry._faceNormals = nrmOut;
  const uvNeeded = nface * 6;
  let uvOut = entry._faceTexcoords;
  if (!uvOut || uvOut.length !== uvNeeded) {
    uvOut = new Float32Array(uvNeeded);
  } else if (uvOut.length) {
    uvOut.fill(0);
  }
  entry._faceTexcoords = uvOut;

  const elemArr = flexAssets?.elem || null;
  const shellArr = flexAssets?.shell || null;
  if (!elemArr && !shellArr) {
    entry.faces.visible = false;
    return;
  }

  let cursor = 0;
  if (!useSkin) {
    const elemnum = flexAssets?.elemnum && flexIndex < flexAssets.elemnum.length ? (flexAssets.elemnum[flexIndex] | 0) : 0;
    const elemdataadr = flexAssets?.elemdataadr && flexIndex < flexAssets.elemdataadr.length ? (flexAssets.elemdataadr[flexIndex] | 0) : 0;
    const baseElem = Math.max(0, elemdataadr);
    const elemLayerBase = Math.max(0, elemAdr);
    const elemStride = dim + 1;
    if (dim === 2 && elemArr) {
      for (let e = 0; e < elemnum; e += 1) {
        const layerIdx = elemLayerBase + e;
        const showElement =
          dim === 2 ||
          (elemLayerArr && elemLayerArr.length > layerIdx && elemLayerArr[layerIdx] === flexLayerValue);
        if (!showElement) continue;
        const off = baseElem + e * elemStride;
        const i0 = elemArr[off + 0] | 0;
        const i1 = elemArr[off + 1] | 0;
        const i2 = elemArr[off + 2] | 0;
        const texBase = baseElem + e * elemStride;
        const hasTexIndices = elemTexcoordArr && texBase + elemStride <= elemTexcoordArr.length;
        const texIndices = hasTexIndices
          ? Array.from({ length: elemStride }, (_, idx) => elemTexcoordArr[texBase + idx] | 0)
          : null;
        const getTexIndex = (idx, fallback) =>
          texIndices && Number.isFinite(texIndices[idx]) ? texIndices[idx] : fallback;
        flexMakeFace(posOut, nrmOut, cursor++, radius, vertxpos, i0, i1, i2);
        fillFlexFaceTexcoords(
          uvOut,
          cursor - 1,
          texcoordArr,
          texcoordBaseOffset,
          texcoordLength,
          getTexIndex(0, i0),
          getTexIndex(1, i1),
          getTexIndex(2, i2),
        );
        flexMakeFace(posOut, nrmOut, cursor++, radius, vertxpos, i0, i2, i1);
        fillFlexFaceTexcoords(
          uvOut,
          cursor - 1,
          texcoordArr,
          texcoordBaseOffset,
          texcoordLength,
          getTexIndex(0, i0),
          getTexIndex(2, i2),
          getTexIndex(1, i1),
        );
      }
    } else if (dim === 3 && elemArr) {
      for (let e = 0; e < elemnum; e += 1) {
        const layerIdx = elemLayerBase + e;
        const showElement =
          dim === 2 ||
          (elemLayerArr && elemLayerArr.length > layerIdx && elemLayerArr[layerIdx] === flexLayerValue);
        if (!showElement) continue;
        const off = baseElem + e * elemStride;
        const i0 = elemArr[off + 0] | 0;
        const i1 = elemArr[off + 1] | 0;
        const i2 = elemArr[off + 2] | 0;
        const i3 = elemArr[off + 3] | 0;
        const texBase = baseElem + e * elemStride;
        const hasTexIndices = elemTexcoordArr && texBase + elemStride <= elemTexcoordArr.length;
        const texIndices = hasTexIndices
          ? Array.from({ length: elemStride }, (_, idx) => elemTexcoordArr[texBase + idx] | 0)
          : null;
        const getTexIndex = (idx, fallback) =>
          texIndices && Number.isFinite(texIndices[idx]) ? texIndices[idx] : fallback;
        flexMakeFace(posOut, nrmOut, cursor++, radius, vertxpos, i0, i1, i2);
        fillFlexFaceTexcoords(
          uvOut,
          cursor - 1,
          texcoordArr,
          texcoordBaseOffset,
          texcoordLength,
          getTexIndex(0, i0),
          getTexIndex(1, i1),
          getTexIndex(2, i2),
        );
        flexMakeFace(posOut, nrmOut, cursor++, radius, vertxpos, i0, i2, i3);
        fillFlexFaceTexcoords(
          uvOut,
          cursor - 1,
          texcoordArr,
          texcoordBaseOffset,
          texcoordLength,
          getTexIndex(0, i0),
          getTexIndex(2, i2),
          getTexIndex(3, i3),
        );
        flexMakeFace(posOut, nrmOut, cursor++, radius, vertxpos, i0, i3, i1);
        fillFlexFaceTexcoords(
          uvOut,
          cursor - 1,
          texcoordArr,
          texcoordBaseOffset,
          texcoordLength,
          getTexIndex(0, i0),
          getTexIndex(3, i3),
          getTexIndex(1, i1),
        );
        flexMakeFace(posOut, nrmOut, cursor++, radius, vertxpos, i1, i3, i2);
        fillFlexFaceTexcoords(
          uvOut,
          cursor - 1,
          texcoordArr,
          texcoordBaseOffset,
          texcoordLength,
          getTexIndex(1, i1),
          getTexIndex(3, i3),
          getTexIndex(2, i2),
        );
      }
    }
  } else {
    let vertnorm = entry._vertnorm || null;
    const neededNrm = vertnum * 3;
    if (!vertnorm || vertnorm.length !== neededNrm) {
      vertnorm = new Float32Array(neededNrm);
      entry._vertnorm = vertnorm;
    } else {
      vertnorm.fill(0);
    }
    const elemnum = flexAssets?.elemnum && flexIndex < flexAssets.elemnum.length ? (flexAssets.elemnum[flexIndex] | 0) : 0;
    const elemdataadr = flexAssets?.elemdataadr && flexIndex < flexAssets.elemdataadr.length ? (flexAssets.elemdataadr[flexIndex] | 0) : 0;
    const shellnum = flexAssets?.shellnum && flexIndex < flexAssets.shellnum.length ? (flexAssets.shellnum[flexIndex] | 0) : 0;
    const shelldataadr = flexAssets?.shelldataadr && flexIndex < flexAssets.shelldataadr.length ? (flexAssets.shelldataadr[flexIndex] | 0) : 0;
    const baseElem = Math.max(0, elemdataadr);
    const baseShell = Math.max(0, shelldataadr);
    const elemStride = dim + 1;

    if (dim === 2 && elemArr) {
      for (let e = 0; e < elemnum; e += 1) {
        const off = baseElem + e * 3;
        flexAddNormal(vertnorm, vertxpos, elemArr[off + 0] | 0, elemArr[off + 1] | 0, elemArr[off + 2] | 0);
      }
    } else if (dim === 3 && shellArr) {
      for (let s = 0; s < shellnum; s += 1) {
        const off = baseShell + s * 3;
        flexAddNormal(vertnorm, vertxpos, shellArr[off + 0] | 0, shellArr[off + 1] | 0, shellArr[off + 2] | 0);
      }
    }
    for (let i = 0; i < vertnum; i += 1) {
      const nx = vertnorm[3 * i + 0], ny = vertnorm[3 * i + 1], nz = vertnorm[3 * i + 2];
      const inv = normalize3Inv(nx, ny, nz);
      vertnorm[3 * i + 0] = nx * inv;
      vertnorm[3 * i + 1] = ny * inv;
      vertnorm[3 * i + 2] = nz * inv;
    }
    if (dim === 2 && elemArr) {
      for (let e = 0; e < elemnum; e += 1) {
        const off = baseElem + e * elemStride;
        const i0 = elemArr[off + 0] | 0;
        const i1 = elemArr[off + 1] | 0;
        const i2 = elemArr[off + 2] | 0;
        const texBase = baseElem + e * elemStride;
        const hasTexIndices = elemTexcoordArr && texBase + elemStride <= elemTexcoordArr.length;
        const texIndices = hasTexIndices
          ? Array.from({ length: elemStride }, (_, idx) => elemTexcoordArr[texBase + idx] | 0)
          : null;
        const getTexIndex = (idx, fallback) =>
          texIndices && Number.isFinite(texIndices[idx]) ? texIndices[idx] : fallback;
        flexMakeSmooth(posOut, nrmOut, cursor++, radius, flgFlat, vertnorm, vertxpos, i0, i1, i2);
        fillFlexFaceTexcoords(
          uvOut,
          cursor - 1,
          texcoordArr,
          texcoordBaseOffset,
          texcoordLength,
          getTexIndex(0, i0),
          getTexIndex(1, i1),
          getTexIndex(2, i2),
        );
        flexMakeSmooth(posOut, nrmOut, cursor++, -radius, flgFlat, vertnorm, vertxpos, i0, i2, i1);
        fillFlexFaceTexcoords(
          uvOut,
          cursor - 1,
          texcoordArr,
          texcoordBaseOffset,
          texcoordLength,
          getTexIndex(0, i0),
          getTexIndex(2, i2),
          getTexIndex(1, i1),
        );
      }
    } else if (dim === 3 && shellArr) {
      for (let s = 0; s < shellnum; s += 1) {
        const off = baseShell + s * 3;
        const i0 = shellArr[off + 0] | 0;
        const i1 = shellArr[off + 1] | 0;
        const i2 = shellArr[off + 2] | 0;
        flexMakeSmooth(posOut, nrmOut, cursor++, radius, flgFlat, vertnorm, vertxpos, i0, i1, i2);
        fillFlexFaceTexcoords(uvOut, cursor - 1, texcoordArr, texcoordBaseOffset, texcoordLength, i0, i1, i2);
      }
    }
    if (dim === 2 && shellArr) {
      for (let s = 0; s < shellnum; s += 1) {
        const off = baseShell + s * 2;
        const i0 = shellArr[off + 0] | 0;
        const i1 = shellArr[off + 1] | 0;
        flexMakeSide(posOut, nrmOut, cursor++, radius, vertnorm, vertxpos, i0, i1);
        fillFlexFaceTexcoords(uvOut, cursor - 1, texcoordArr, texcoordBaseOffset, texcoordLength, i0, i1, i1);
        flexMakeSide(posOut, nrmOut, cursor++, -radius, vertnorm, vertxpos, i1, i0);
        fillFlexFaceTexcoords(uvOut, cursor - 1, texcoordArr, texcoordBaseOffset, texcoordLength, i1, i0, i0);
      }
    }
  }

  const geom = entry.faces.geometry;
  geom.setAttribute('position', new THREE.BufferAttribute(posOut, 3));
  geom.setAttribute('normal', new THREE.BufferAttribute(nrmOut, 3));
  geom.setAttribute('uv', new THREE.BufferAttribute(uvOut, 2));
  entry.faces.visible = true;
}

function ensureSkinGroup(ctx) {
  if (!ctx) return null;
  if (!ctx.skinGroup) {
    const group = new THREE.Group();
    group.name = 'base:skins';
    if (ctx.root) ctx.root.add(group);
    ctx.skinGroup = group;
    ctx.skinPool = [];
  }
  return ctx.skinGroup;
}

function hideSkinGroup(ctx) {
  if (!ctx) return;
  const group = ctx.skinGroup || null;
  if (group) group.visible = false;
  if (Array.isArray(ctx.skinPool)) {
    for (const entry of ctx.skinPool) {
      if (entry?.mesh) entry.mesh.visible = false;
    }
  }
}

function ensureSkinEntry(ctx, index, assets, state) {
  const skinAssets = assets?.skins || null;
  const count = skinAssets?.count | 0;
  if (!(count > 0) || index < 0 || index >= count) return null;
  const group = ensureSkinGroup(ctx);
  if (!group) return null;

  const pool = Array.isArray(ctx.skinPool) ? ctx.skinPool : (ctx.skinPool = []);
  const vertnum = skinAssets?.vertnum && index < skinAssets.vertnum.length ? (skinAssets.vertnum[index] | 0) : 0;
  const facenum = skinAssets?.facenum && index < skinAssets.facenum.length ? (skinAssets.facenum[index] | 0) : 0;
  let entry = pool[index] || null;

  const needsRebuild = !entry || entry.vertnum !== vertnum || entry.facenum !== facenum;
  if (needsRebuild) {
    if (entry?.mesh) {
      try { group.remove(entry.mesh); } catch {}
    }
    const geometry = new THREE.BufferGeometry();
    const positions = vertnum > 0 ? new Float32Array(vertnum * 3) : new Float32Array(0);
    const normals = vertnum > 0 ? new Float32Array(vertnum * 3) : new Float32Array(0);
    const positionAttr = new THREE.BufferAttribute(positions, 3);
    const normalAttr = new THREE.BufferAttribute(normals, 3);
    geometry.setAttribute('position', positionAttr);
    geometry.setAttribute('normal', normalAttr);
    const uvArray = vertnum > 0 ? new Float32Array(vertnum * 2) : new Float32Array(0);
    const uvAttr = new THREE.BufferAttribute(uvArray, 2);
    geometry.setAttribute('uv', uvAttr);

    if (facenum > 0 && skinAssets?.face) {
      const faceadr = skinAssets?.faceadr && index < skinAssets.faceadr.length ? (skinAssets.faceadr[index] | 0) : 0;
      const base = Math.max(0, faceadr) * 3;
      const end = base + facenum * 3;
      const src = skinAssets.face;
      if (end <= src.length) {
        const indices = new Uint32Array(facenum * 3);
        for (let i = 0; i < facenum * 3; i += 1) {
          indices[i] = src[base + i] >>> 0;
        }
        geometry.setIndex(new THREE.BufferAttribute(indices, 1));
      }
    }

    const sceneFlags = state?.rendering?.sceneFlags || [];
    const wire = !!sceneFlags[1];
    const material = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.8,
      metalness: 0.0,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 1,
      wireframe: wire,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.frustumCulled = false;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.userData = mesh.userData || {};
    mesh.userData.skinIndex = index;
    group.add(mesh);

    entry = {
      mesh,
      geometry,
      positionAttr,
      normalAttr,
      positions,
      normals,
      vertnum,
      facenum,
      _tmpBindMat: new Float32Array(9),
      _tmpBindInv: new Float32Array(9),
      uvAttr,
      uvs: uvArray,
    };
    pool[index] = entry;
  }

  const sceneFlags = state?.rendering?.sceneFlags || [];
  const wire = !!sceneFlags[1];
  if (entry?.mesh?.material && 'wireframe' in entry.mesh.material) {
    entry.mesh.material.wireframe = wire;
  }

  return entry;
}

function applySkinAppearance(entry, skinIndex, assets, ctx, textureEnabled) {
  if (!entry?.mesh) return;
  const appearance = resolveSkinAppearance(skinIndex, assets || null);
  applyAppearanceToMaterial(entry.mesh, appearance);
  const matIdView = assets?.skins?.matid || null;
  const matId = matIdView && skinIndex < matIdView.length ? (matIdView[skinIndex] | 0) : -1;
  entry.mesh.userData = entry.mesh.userData || {};
  entry.mesh.userData.matId = matId;
  applyMuJoCoTextureToMesh(entry.mesh, matId, ctx, assets, textureEnabled, { texcoordMode: 'explicit' });
}

function quatToMat3(w, x, y, z, out) {
  const x2 = x + x;
  const y2 = y + y;
  const z2 = z + z;
  const xx = x * x2;
  const xy = x * y2;
  const xz = x * z2;
  const yy = y * y2;
  const yz = y * z2;
  const zz = z * z2;
  const wx = w * x2;
  const wy = w * y2;
  const wz = w * z2;
  out[0] = 1 - (yy + zz);
  out[1] = xy - wz;
  out[2] = xz + wy;
  out[3] = xy + wz;
  out[4] = 1 - (xx + zz);
  out[5] = yz - wx;
  out[6] = xz - wy;
  out[7] = yz + wx;
  out[8] = 1 - (xx + yy);
  return out;
}

function updateSkinMesh(entry, skinIndex, snapshot, assets) {
  const skinAssets = assets?.skins || null;
  if (!entry || !skinAssets) return false;
  const bxpos = snapshot?.bxpos || null;
  const bxmat = snapshot?.bxmat || null;
  if (!bxpos || !bxmat) return false;

  const vertadr = skinAssets?.vertadr && skinIndex < skinAssets.vertadr.length ? (skinAssets.vertadr[skinIndex] | 0) : 0;
  const vertnum = entry.vertnum | 0;
  const boneadr = skinAssets?.boneadr && skinIndex < skinAssets.boneadr.length ? (skinAssets.boneadr[skinIndex] | 0) : 0;
  const bonenum = skinAssets?.bonenum && skinIndex < skinAssets.bonenum.length ? (skinAssets.bonenum[skinIndex] | 0) : 0;
  const faceadr = skinAssets?.faceadr && skinIndex < skinAssets.faceadr.length ? (skinAssets.faceadr[skinIndex] | 0) : 0;
  const facenum = entry.facenum | 0;

  const srcVert = skinAssets?.vert || null;
  const srcFace = skinAssets?.face || null;
  const bonevertadr = skinAssets?.bonevertadr || null;
  const bonevertnum = skinAssets?.bonevertnum || null;
  const bonebindpos = skinAssets?.bonebindpos || null;
  const bonebindquat = skinAssets?.bonebindquat || null;
  const bonebodyid = skinAssets?.bonebodyid || null;
  const bonevertid = skinAssets?.bonevertid || null;
  const bonevertweight = skinAssets?.bonevertweight || null;
  if (!srcVert || !srcFace || !bonevertadr || !bonevertnum || !bonebindpos || !bonebindquat || !bonebodyid || !bonevertid || !bonevertweight) {
    return false;
  }

  const positions = entry.positions;
  const normals = entry.normals;
  positions.fill(0);
  normals.fill(0);

  const bindMat = entry._tmpBindMat || (entry._tmpBindMat = new Float32Array(9));
  const bindInv = entry._tmpBindInv || (entry._tmpBindInv = new Float32Array(9));

  for (let j = boneadr; j < boneadr + bonenum; j += 1) {
    const bodyId = bonebodyid[j] | 0;
    const bmatBase = 9 * bodyId;
    const bposBase = 3 * bodyId;

    const bw = bonebindquat[4 * j + 0] || 0;
    const bx = bonebindquat[4 * j + 1] || 0;
    const by = bonebindquat[4 * j + 2] || 0;
    const bz = bonebindquat[4 * j + 3] || 0;
    quatToMat3(bw, bx, by, bz, bindMat);
    // inverse for unit rotation: transpose
    bindInv[0] = bindMat[0]; bindInv[1] = bindMat[3]; bindInv[2] = bindMat[6];
    bindInv[3] = bindMat[1]; bindInv[4] = bindMat[4]; bindInv[5] = bindMat[7];
    bindInv[6] = bindMat[2]; bindInv[7] = bindMat[5]; bindInv[8] = bindMat[8];

    const r00 = bxmat[bmatBase + 0] * bindInv[0] + bxmat[bmatBase + 1] * bindInv[3] + bxmat[bmatBase + 2] * bindInv[6];
    const r01 = bxmat[bmatBase + 0] * bindInv[1] + bxmat[bmatBase + 1] * bindInv[4] + bxmat[bmatBase + 2] * bindInv[7];
    const r02 = bxmat[bmatBase + 0] * bindInv[2] + bxmat[bmatBase + 1] * bindInv[5] + bxmat[bmatBase + 2] * bindInv[8];
    const r10 = bxmat[bmatBase + 3] * bindInv[0] + bxmat[bmatBase + 4] * bindInv[3] + bxmat[bmatBase + 5] * bindInv[6];
    const r11 = bxmat[bmatBase + 3] * bindInv[1] + bxmat[bmatBase + 4] * bindInv[4] + bxmat[bmatBase + 5] * bindInv[7];
    const r12 = bxmat[bmatBase + 3] * bindInv[2] + bxmat[bmatBase + 4] * bindInv[5] + bxmat[bmatBase + 5] * bindInv[8];
    const r20 = bxmat[bmatBase + 6] * bindInv[0] + bxmat[bmatBase + 7] * bindInv[3] + bxmat[bmatBase + 8] * bindInv[6];
    const r21 = bxmat[bmatBase + 6] * bindInv[1] + bxmat[bmatBase + 7] * bindInv[4] + bxmat[bmatBase + 8] * bindInv[7];
    const r22 = bxmat[bmatBase + 6] * bindInv[2] + bxmat[bmatBase + 7] * bindInv[5] + bxmat[bmatBase + 8] * bindInv[8];

    const bindpx = bonebindpos[3 * j + 0] || 0;
    const bindpy = bonebindpos[3 * j + 1] || 0;
    const bindpz = bonebindpos[3 * j + 2] || 0;
    const tx = (bxpos[bposBase + 0] || 0) - (r00 * bindpx + r01 * bindpy + r02 * bindpz);
    const ty = (bxpos[bposBase + 1] || 0) - (r10 * bindpx + r11 * bindpy + r12 * bindpz);
    const tz = (bxpos[bposBase + 2] || 0) - (r20 * bindpx + r21 * bindpy + r22 * bindpz);

    const k0 = bonevertadr[j] | 0;
    const kN = bonevertnum[j] | 0;
    for (let k = k0; k < k0 + kN; k += 1) {
      const vid = bonevertid[k] | 0;
      const wgt = bonevertweight[k] || 0;
      const srcBase = 3 * (vertadr + vid);
      const px = srcVert[srcBase + 0] || 0;
      const py = srcVert[srcBase + 1] || 0;
      const pz = srcVert[srcBase + 2] || 0;
      const px1 = r00 * px + r01 * py + r02 * pz + tx;
      const py1 = r10 * px + r11 * py + r12 * pz + ty;
      const pz1 = r20 * px + r21 * py + r22 * pz + tz;
      const dstBase = 3 * vid;
      positions[dstBase + 0] += wgt * px1;
      positions[dstBase + 1] += wgt * py1;
      positions[dstBase + 2] += wgt * pz1;
    }
  }

  // compute vertex normals from face normals
  const faceBase = Math.max(0, faceadr) * 3;
  const faceEnd = faceBase + facenum * 3;
  for (let k = faceBase; k < faceEnd; k += 3) {
    const a = srcFace[k + 0] | 0;
    const b = srcFace[k + 1] | 0;
    const c = srcFace[k + 2] | 0;
    const ax = positions[3 * a + 0], ay = positions[3 * a + 1], az = positions[3 * a + 2];
    const bx0 = positions[3 * b + 0], by0 = positions[3 * b + 1], bz0 = positions[3 * b + 2];
    const cx0 = positions[3 * c + 0], cy0 = positions[3 * c + 1], cz0 = positions[3 * c + 2];
    const v01x = bx0 - ax, v01y = by0 - ay, v01z = bz0 - az;
    const v02x = cx0 - ax, v02y = cy0 - ay, v02z = cz0 - az;
    const nx = v01y * v02z - v01z * v02y;
    const ny = v01z * v02x - v01x * v02z;
    const nz = v01x * v02y - v01y * v02x;
    normals[3 * a + 0] += nx; normals[3 * a + 1] += ny; normals[3 * a + 2] += nz;
    normals[3 * b + 0] += nx; normals[3 * b + 1] += ny; normals[3 * b + 2] += nz;
    normals[3 * c + 0] += nx; normals[3 * c + 1] += ny; normals[3 * c + 2] += nz;
  }
  for (let i = 0; i < vertnum; i += 1) {
    const nx = normals[3 * i + 0], ny = normals[3 * i + 1], nz = normals[3 * i + 2];
    const inv = normalize3Inv(nx, ny, nz);
    normals[3 * i + 0] = nx * inv;
    normals[3 * i + 1] = ny * inv;
    normals[3 * i + 2] = nz * inv;
  }

  const inflate = skinAssets?.inflate && skinIndex < skinAssets.inflate.length ? (skinAssets.inflate[skinIndex] || 0) : 0;
  if (inflate) {
    for (let i = 0; i < vertnum; i += 1) {
      positions[3 * i + 0] += inflate * normals[3 * i + 0];
      positions[3 * i + 1] += inflate * normals[3 * i + 1];
      positions[3 * i + 2] += inflate * normals[3 * i + 2];
    }
  }

  entry.positionAttr.needsUpdate = true;
  entry.normalAttr.needsUpdate = true;
  const uvAttr = entry.uvAttr;
  const uvArray = entry.uvs;
  const texcoordAdr = skinAssets?.texcoordadr && skinIndex < skinAssets.texcoordadr.length ? (skinAssets.texcoordadr[skinIndex] | 0) : -1;
  const texcoordSrc = skinAssets?.texcoord || null;
  if (uvArray && uvArray.length > 0 && texcoordAdr >= 0 && texcoordSrc) {
    const srcStart = texcoordAdr * 2;
    const available = Math.min(uvArray.length, Math.max(0, texcoordSrc.length - srcStart));
    if (available > 0) {
      uvArray.set(texcoordSrc.subarray(srcStart, srcStart + available));
      if (available < uvArray.length) {
        uvArray.fill(0, available);
      }
    } else {
      uvArray.fill(0);
    }
    if (uvAttr) uvAttr.needsUpdate = true;
  } else if (uvArray && uvAttr) {
    uvArray.fill(0);
    uvAttr.needsUpdate = true;
  }
  return true;
}

function applyMjvSceneSoAGeoms(ctx, snapshot, state, assets, {
  sceneFlags,
  reflectionEnabled,
  hideAllGeometry,
}) {
  const scnNgeom = snapshot?.scn_ngeom | 0;
  if (!(scnNgeom > 0)) return 0;
  const typeView = snapshot?.scn_type || null;
  const posView = snapshot?.scn_pos || null;
  const matView = snapshot?.scn_mat || null;
  const sizeView = snapshot?.scn_size || null;
  const rgbaView = snapshot?.scn_rgba || null;
  const matIdView = snapshot?.scn_matid || null;
  const dataIdView = snapshot?.scn_dataid || null;
  const objTypeView = snapshot?.scn_objtype || null;
  const objIdView = snapshot?.scn_objid || null;
  const categoryView = snapshot?.scn_category || null;
  const geomOrderView = snapshot?.scn_geomorder || null;
  if (!typeView || !posView || !matView || !sizeView || !rgbaView || !matIdView || !dataIdView || !objTypeView || !objIdView || !categoryView) {
    return 0;
  }

  const perfEnabled = isPerfEnabled();
  const tTotalStart = perfEnabled ? perfNow() : 0;
  let meshMs = 0;
  let xformMs = 0;
  let flagsMs = 0;
  let textureMs = 0;
  let ensureCalls = 0;
  let ensureCreated = 0;
  let ensureRebuilt = 0;
  let ensureRebuiltType = 0;
  let ensureRebuiltInfinite = 0;
  let ensureRebuiltDataId = 0;
  let ensureRebuiltSize = 0;
  let ensureRebuiltSizeLine = 0;
  let ensureRebuiltSizeLinebox = 0;
  let ensureRebuiltSizeArrow = 0;
  let ensureRebuiltSizeTriangle = 0;
  let ensureRebuiltSizeCapsule = 0;
  let ensureRebuiltSizeCylinder = 0;
  let ensureRebuiltSizeOtherGtype = 0;
  let ensureRebuiltOther = 0;
  let textureCalls = 0;
  let colorUpdates = 0;
  let opacityUpdates = 0;
  let xformUpdates = 0;
  let infiniteXformUpdates = 0;
  const texPerf = perfEnabled
    ? (ctx._perfSoATexture || (ctx._perfSoATexture = {
      texMapChanged: 0,
      texUvCalls: 0,
      texUvCacheHit: 0,
      texUvRecompute: 0,
      texUvSkip: 0,
    }))
    : null;
  if (texPerf) {
    texPerf.texMapChanged = 0;
    texPerf.texUvCalls = 0;
    texPerf.texUvCacheHit = 0;
    texPerf.texUvRecompute = 0;
    texPerf.texUvSkip = 0;
  }

  const flags = Array.isArray(sceneFlags) ? sceneFlags : state?.rendering?.sceneFlags || [];
  const segmentEnabled = !!flags[SEGMENT_FLAG_INDEX];
  const vopt = Array.isArray(state?.rendering?.voptFlags) ? state.rendering.voptFlags : [];
  const showStatic = voptEnabled(vopt, MJ_VIS.STATIC);
  const transparentDynamic = voptEnabled(vopt, MJ_VIS.TRANSPARENT);
  const alphaScale = transparentDynamic ? clampUnit(Number(state?.model?.vis?.map?.alpha)) : 1;
  const textureEnabled = voptEnabled(vopt, MJ_VIS.TEXTURE);
  const showFlexVert = voptEnabled(vopt, MJ_VIS.FLEXVERT);
  const showFlexEdge = voptEnabled(vopt, MJ_VIS.FLEXEDGE);
  const showFlexFace = voptEnabled(vopt, MJ_VIS.FLEXFACE);
  const showFlexSkin = voptEnabled(vopt, MJ_VIS.FLEXSKIN);
  const showFlexAny = showFlexVert || showFlexEdge || showFlexFace || showFlexSkin;
  const showSkin = voptEnabled(vopt, MJ_VIS.SKIN);
  const flexLayerValue = Number.isFinite(state?.rendering?.flexLayer)
    ? (state.rendering.flexLayer | 0)
    : 0;
  const baseNgeom = snapshot?.ngeom | 0;
  const geomNameSource = state?.model?.geoms || null;
  let geomNameLookup = ctx._geomNameLookup || null;
  if (ctx._geomNameLookupSource !== geomNameSource) {
    geomNameLookup = createGeomNameLookup(geomNameSource);
    ctx._geomNameLookup = geomNameLookup;
    ctx._geomNameLookupSource = geomNameSource;
  }
  if (!geomNameLookup) {
    geomNameLookup = createGeomNameLookup(geomNameSource);
    ctx._geomNameLookup = geomNameLookup;
    ctx._geomNameLookupSource = geomNameSource;
  }
  const geomBodyIdView = state?.model?.geomBodyId || null;
  const weldIdView =
    assets?.bodies?.weldid ||
    snapshot?.renderAssets?.bodies?.weldid ||
    state?.rendering?.assets?.bodies?.weldid ||
    null;
  const mocapIdView =
    assets?.bodies?.mocapid ||
    snapshot?.renderAssets?.bodies?.mocapid ||
    state?.rendering?.assets?.bodies?.mocapid ||
    null;
  const hasBodyCategory =
    !!weldIdView &&
    !!mocapIdView &&
    (ArrayBuffer.isView(weldIdView) || Array.isArray(weldIdView)) &&
    (ArrayBuffer.isView(mocapIdView) || Array.isArray(mocapIdView));
  const isBodyStatic = (bodyId) => {
    if (!hasBodyCategory) return false;
    const bid = bodyId | 0;
    if (bid < 0) return false;
    if (bid >= weldIdView.length || bid >= mocapIdView.length) return false;
    return (weldIdView[bid] | 0) === 0 && (mocapIdView[bid] | 0) === -1;
  };
  const geomMetaCache = ctx._scnGeomMeta || (ctx._scnGeomMeta = []);

  const instancingEnabled = !segmentEnabled && !instancingDisabledByUrl();
  const inst = instancingEnabled ? ensureInstancingRoot(ctx) : null;
  if (inst && inst.batches instanceof Map) {
    for (const batch of inst.batches.values()) {
      if (!batch) continue;
      batch.used = 0;
      batch.orderMin = Number.POSITIVE_INFINITY;
      batch.orderMax = Number.NEGATIVE_INFINITY;
      batch.renderOrder = null;
      batch.transparentBin = -1;
    }
  } else if (!instancingEnabled && ctx?._instancing?.batches instanceof Map) {
    for (const batch of ctx._instancing.batches.values()) {
      if (!batch?.mesh) continue;
      batch.mesh.visible = false;
      batch.mesh.count = 0;
      batch.used = 0;
      batch.orderMin = Number.POSITIVE_INFINITY;
      batch.orderMax = Number.NEGATIVE_INFINITY;
      batch.renderOrder = null;
      batch.transparentBin = -1;
    }
  }

  const transparentBinsRequested = transparentBinsFromUrl(16);
  const transparentSortMode = transparentSortModeFromUrl();
  const transparentBins = transparentSortMode === 'strict' ? 1 : transparentBinsRequested;
  const transparentOrderingEnabled = transparentBins > 0;
  const sortTransparentInstances = transparentOrderingEnabled && transparentSortMode === 'strict';
  const transparentBinningEnabled = transparentBins > 1;

  const camera = ctx?.camera || null;
  const rootMatWorld = ctx?.root?.matrixWorld || null;
  let transparentCameraReady = false;
  if (transparentOrderingEnabled && camera && typeof camera.getWorldDirection === 'function' && typeof camera.getWorldPosition === 'function') {
    camera.getWorldPosition(TRANSPARENT_BIN_CAM_POS);
    camera.getWorldDirection(TRANSPARENT_BIN_CAM_DIR);
    transparentCameraReady = true;
  }

  let transparentBinsUsed = null;
  if (transparentOrderingEnabled && transparentBins > 0) {
    transparentBinsUsed = ctx._transparentBinsUsed || null;
    if (!(transparentBinsUsed instanceof Uint8Array) || transparentBinsUsed.length !== transparentBins) {
      transparentBinsUsed = new Uint8Array(transparentBins);
      ctx._transparentBinsUsed = transparentBinsUsed;
    }
    transparentBinsUsed.fill(0);
  }

  let transparentBinPrev = null;
  let transparentBinMigrations = 0;
  let transparentSortMs = 0;
  let transparentSortedInstances = 0;
  if (transparentOrderingEnabled && baseNgeom > 0) {
    transparentBinPrev = ctx._transparentBinPrev || null;
    if (!(transparentBinPrev instanceof Int16Array) || transparentBinPrev.length !== baseNgeom) {
      transparentBinPrev = new Int16Array(baseNgeom);
      transparentBinPrev.fill(-1);
      ctx._transparentBinPrev = transparentBinPrev;
    }
  }

  let transparentDepthMin = 0;
  let transparentDepthInvSpan = 0;
  let transparentCandidateCount = 0;
  if (transparentOrderingEnabled && transparentCameraReady) {
    let min = 0;
    let max = 0;
    let count = 0;
    for (let si = 0; si < scnNgeom; si += 1) {
      const a0 = Number(rgbaView[si * 4 + 3]) || 0;
      if (!(a0 < 0.999)) continue;
      const posBase = si * 3;
      TRANSPARENT_BIN_WORLD_POS.set(
        posView[posBase + 0] || 0,
        posView[posBase + 1] || 0,
        posView[posBase + 2] || 0,
      );
      if (rootMatWorld) TRANSPARENT_BIN_WORLD_POS.applyMatrix4(rootMatWorld);
      TRANSPARENT_BIN_WORLD_POS.sub(TRANSPARENT_BIN_CAM_POS);
      const depth = TRANSPARENT_BIN_WORLD_POS.dot(TRANSPARENT_BIN_CAM_DIR);
      if (count === 0) {
        min = depth;
        max = depth;
      } else {
        if (depth < min) min = depth;
        if (depth > max) max = depth;
      }
      count += 1;
    }
    transparentCandidateCount = count;
    if (count > 0) {
      if (!Number.isFinite(min) || !Number.isFinite(max)) {
        min = 0;
        max = 1;
      } else if (max - min < 1e-6) {
        max = min + 1;
      }

      const prev = ctx._transparentDepthRange || null;
      const ema = 0.2;
      if (prev && typeof prev.min === 'number' && typeof prev.max === 'number' && Number.isFinite(prev.min) && Number.isFinite(prev.max)) {
        prev.min = prev.min + (min - prev.min) * ema;
        prev.max = prev.max + (max - prev.max) * ema;
        min = prev.min;
        max = prev.max;
      } else {
        ctx._transparentDepthRange = { min, max };
      }

      const span = Math.max(1e-6, max - min);
      const margin = Math.max(1e-3, span * 0.05);
      const minWithMargin = min - margin;
      const maxWithMargin = max + margin;
      transparentDepthMin = minWithMargin;
      transparentDepthInvSpan = 1 / Math.max(1e-6, maxWithMargin - minWithMargin);
    }
  }

  const transparentBatchCapacity = transparentOrderingEnabled
    ? Math.max(32, Math.min(scnNgeom, transparentCandidateCount > 0 ? transparentCandidateCount : scnNgeom))
    : scnNgeom;

  let geomOrderRank = ctx._scnGeomOrderRank || null;
  if (!geomOrderRank || geomOrderRank.length !== scnNgeom) {
    geomOrderRank = new Int32Array(scnNgeom);
    ctx._scnGeomOrderRank = geomOrderRank;
  }
  for (let i = 0; i < scnNgeom; i += 1) {
    geomOrderRank[i] = i;
  }
  if (geomOrderView && geomOrderView.length >= scnNgeom) {
    for (let k = 0; k < scnNgeom; k += 1) {
      const si = geomOrderView[k] | 0;
      if (si >= 0 && si < scnNgeom) geomOrderRank[si] = k;
    }
  }

  let geomToScn = ctx._geomToScn || null;
  if (!geomToScn || geomToScn.length !== Math.max(0, baseNgeom)) {
    geomToScn = new Int32Array(Math.max(0, baseNgeom));
    ctx._geomToScn = geomToScn;
  }
  geomToScn.fill(-1);
  for (let i = 0; i < scnNgeom; i += 1) {
    const objType = objTypeView[i] | 0;
    if (objType !== MJ_OBJ.GEOM) continue;
    const geomId = objIdView[i] | 0;
    if (!(geomId >= 0 && geomId < baseNgeom)) continue;
    if (geomToScn[geomId] === -1) {
      geomToScn[geomId] = i;
    }
  }

  // In scene mode, flex/skin lifetime is driven solely by mjvScene.
  // Hide any stale JS-driven entries and let the scene loop re-enable them.
  hideFlexGroup(ctx);
  hideSkinGroup(ctx);

  // Flex/skin are special: their geometry comes from separate buffers, so they are
  // rendered via their dedicated pools but are still *enumerated* by mjvScene.
  if (!hideAllGeometry && (showFlexAny || showSkin)) {
    if (showFlexAny) {
      const flexAssets = assets?.flexes || null;
      const count = flexAssets?.count | 0;
      if (count > 0) {
        let used = 0;
        const seen = new Set();
        for (let si = 0; si < scnNgeom; si += 1) {
          if ((objTypeView[si] | 0) !== MJ_OBJ.FLEX) continue;
          const flexIndex = objIdView[si] | 0;
          if (flexIndex < 0 || flexIndex >= count) continue;
          if (seen.has(flexIndex)) continue;
          seen.add(flexIndex);
          const entry = ensureFlexEntry(ctx, flexIndex, assets, state);
          if (!entry) continue;
          entry.group.visible = true;
          applyFlexAppearance(entry, flexIndex, assets, ctx, textureEnabled);

          const vertadr = flexAssets.vertadr && flexIndex < flexAssets.vertadr.length ? (flexAssets.vertadr[flexIndex] | 0) : 0;
          const vertnum = entry.vertnum | 0;
          const srcAll = snapshot?.flexvert_xpos || null;
          const base = Math.max(0, vertadr) * 3;
          const end = base + vertnum * 3;
          if (!srcAll || end > srcAll.length) {
            entry.points.visible = false;
            entry.edges.visible = false;
            entry.faces.visible = false;
            continue;
          }
          const vertxpos = srcAll.subarray(base, end);
          if (entry.vertexPositions && entry.vertexPositions.length === vertxpos.length) {
            entry.vertexPositions.set(vertxpos);
            const attr0 = entry.points?.geometry?.attributes?.position;
            if (attr0) attr0.needsUpdate = true;
            const attr1 = entry.edges?.geometry?.attributes?.position;
            if (attr1) attr1.needsUpdate = true;
          }

          entry.points.visible = showFlexVert;
          entry.edges.visible = showFlexEdge;
          if (showFlexSkin) {
            updateFlexFaces(entry, flexIndex, snapshot, state, assets, true, flexLayerValue);
          } else if (showFlexFace) {
            updateFlexFaces(entry, flexIndex, snapshot, state, assets, false, flexLayerValue);
          } else {
            entry.faces.visible = false;
          }
          used += 1;
        }
        const group = ensureFlexGroup(ctx);
        if (group) group.visible = used > 0;
      }
    }

    if (showSkin) {
      const skinAssets = assets?.skins || null;
      const count = skinAssets?.count | 0;
      if (count > 0) {
        let used = 0;
        const seen = new Set();
        for (let si = 0; si < scnNgeom; si += 1) {
          if ((objTypeView[si] | 0) !== MJ_OBJ.SKIN) continue;
          const skinIndex = objIdView[si] | 0;
          if (skinIndex < 0 || skinIndex >= count) continue;
          if (seen.has(skinIndex)) continue;
          seen.add(skinIndex);
          const entry = ensureSkinEntry(ctx, skinIndex, assets, state);
          if (!entry) continue;
          applySkinAppearance(entry, skinIndex, assets, ctx, textureEnabled);
          const ok = updateSkinMesh(entry, skinIndex, snapshot, assets);
          entry.mesh.visible = ok;
          if (ok) used += 1;
        }
        const group = ensureSkinGroup(ctx);
        if (group) group.visible = used > 0;
      }
    }
  }

  ctx.geomState = ctx.geomState || [];
  const safeHide = (meshIndex) => {
    const mesh = Array.isArray(ctx.meshes) ? ctx.meshes[meshIndex] : null;
    if (mesh) mesh.visible = false;
    if (meshIndex >= 0 && inst && Array.isArray(inst.geomRefs)) {
      inst.geomRefs[meshIndex] = null;
    }
  };

  const ensureGeomProxy = (meshIndex) => {
    const index = meshIndex | 0;
    if (!(index >= 0)) return null;
    if (!Array.isArray(ctx.meshes)) ctx.meshes = [];
    const existing = ctx.meshes[index] || null;
    if (existing && existing.userData?.proxy) return existing;
    if (existing && existing.isObject3D) {
      const parent = existing.parent || null;
      if (parent && typeof parent.remove === 'function') {
        parent.remove(existing);
      }
      existing.visible = false;
      existing.userData = existing.userData || {};
      existing.userData.proxy = true;
      return existing;
    }
    const proxy = {
      visible: false,
      material: {
        opacity: 1,
        transparent: false,
        color: new THREE.Color(0xffffff),
        wireframe: false,
        type: 'ProxyMaterial',
      },
      userData: {
        proxy: true,
        geomIndex: index,
      },
    };
    ctx.meshes[index] = proxy;
    return proxy;
  };

  const fillSizeVec = (out, gtype, scnIndex) => {
    const base = (scnIndex | 0) * 3;
    const sx = Number(sizeView[base + 0]) || 0;
    const sy = Number(sizeView[base + 1]) || 0;
    const sz = Number(sizeView[base + 2]) || 0;
    if (
      gtype === MJ_GEOM.CAPSULE ||
      gtype === MJ_GEOM.CYLINDER ||
      gtype === MJ_GEOM.LINE ||
      gtype === MJ_GEOM.ARROW ||
      gtype === MJ_GEOM.ARROW1 ||
      gtype === MJ_GEOM.ARROW2
    ) {
      // mjvGeom stores [radius, radius, halflength] for capsule/cylinder.
      // mjvGeom stores [width,width,length] for connector line/arrow types.
      out[0] = sx;
      out[1] = sz;
      out[2] = 0;
      return out;
    }
    out[0] = sx;
    out[1] = sy;
    out[2] = sz;
    return out;
  };

  const updateOne = (meshIndex, scnIndex, nameHint = null, allowCreate = true) => {
    const si = scnIndex | 0;
    if (si < 0 || si >= scnNgeom) {
      safeHide(meshIndex);
      return false;
    }

    const gtypeRaw = typeView[si] | 0;
    if (gtypeRaw === MJ_GEOM.LABEL || gtypeRaw === MJ_GEOM.NONE) {
      // Labels are rendered via the scene label buffer (mjvGeom.label); no mesh needed.
      safeHide(meshIndex);
      return false;
    }
    const supported =
      gtypeRaw === MJ_GEOM.PLANE ||
      gtypeRaw === MJ_GEOM.HFIELD ||
      gtypeRaw === MJ_GEOM.SPHERE ||
      gtypeRaw === MJ_GEOM.CAPSULE ||
      gtypeRaw === MJ_GEOM.ELLIPSOID ||
      gtypeRaw === MJ_GEOM.CYLINDER ||
      gtypeRaw === MJ_GEOM.BOX ||
      gtypeRaw === MJ_GEOM.MESH ||
      gtypeRaw === MJ_GEOM.SDF ||
      gtypeRaw === MJ_GEOM.LINE ||
      gtypeRaw === MJ_GEOM.LINEBOX ||
      gtypeRaw === MJ_GEOM.ARROW ||
      gtypeRaw === MJ_GEOM.ARROW1 ||
      gtypeRaw === MJ_GEOM.ARROW2 ||
      gtypeRaw === MJ_GEOM.TRIANGLE;
    if (!supported) {
      safeHide(meshIndex);
      return false;
    }

    const rawDataId = dataIdView[si] | 0;
    const meshLike = gtypeRaw === MJ_GEOM.MESH || gtypeRaw === MJ_GEOM.SDF;
    const MESH_DATAID_MASK = 1 << 30;
    const dataId = meshLike && rawDataId >= 0 ? (MESH_DATAID_MASK | rawDataId) : rawDataId;
    const meshModelDataId = meshLike && rawDataId >= 0 ? (rawDataId >> 1) : null;
    const matId = matIdView[si] | 0;

    if (perfEnabled) ensureCalls += 1;
    const existingMesh = Array.isArray(ctx.meshes) ? ctx.meshes[meshIndex] : null;
    const meshBefore = perfEnabled ? existingMesh : null;
    const tEnsureStart = perfEnabled ? perfNow() : 0;

    let geomMeta = geomMetaCache[meshIndex] || null;
    if (!geomMeta) {
      geomMeta = {
        index: meshIndex,
        type: gtypeRaw,
        dataId,
        size: [0, 0, 0],
        name: '',
        matId: -1,
        bodyId: -1,
        groupId: -1,
        rgba: [0, 0, 0, 0],
      };
      geomMetaCache[meshIndex] = geomMeta;
    }
    geomMeta.index = meshIndex;
    geomMeta.type = gtypeRaw;
    geomMeta.dataId = dataId;
    geomMeta.name = nameHint || `SceneGeom ${si}`;
    geomMeta.matId = matId;
    geomMeta.groupId = -1;
    geomMeta.bodyId = geomBodyIdView && meshIndex >= 0 && meshIndex < geomBodyIdView.length
      ? (geomBodyIdView[meshIndex] | 0)
      : -1;

    const sizeVec = geomMeta.size;
    fillSizeVec(sizeVec, gtypeRaw, si);

    const rgba = geomMeta.rgba;
    const rgbaBase = si * 4;
    rgba[0] = rgbaView[rgbaBase + 0];
    rgba[1] = rgbaView[rgbaBase + 1];
    rgba[2] = rgbaView[rgbaBase + 2];
    rgba[3] = rgbaView[rgbaBase + 3];

    const geomState = ensureGeomState(ctx, meshIndex, geomMeta);

    if (inst && meshIndex >= 0 && !segmentEnabled) {
      const view = geomState?.view || null;
      let r = clampUnit(Number(rgba?.[0]) || 0);
      let g = clampUnit(Number(rgba?.[1]) || 0);
      let b = clampUnit(Number(rgba?.[2]) || 0);
      let a = clampUnit(Number(rgba?.[3]) || 0);
      let visible = true;
      if (view) {
        if (view.debugHidden) visible = false;
        if (view.visibleOverride === true) visible = true;
        else if (view.visibleOverride === false) visible = false;
        if (Array.isArray(view.colorOverride) && view.colorOverride.length >= 4) {
          r = clampUnit(Number(view.colorOverride[0]) || 0);
          g = clampUnit(Number(view.colorOverride[1]) || 0);
          b = clampUnit(Number(view.colorOverride[2]) || 0);
          a = clampUnit(Number(view.colorOverride[3]) || 0);
        }
      }
      if (hideAllGeometry) visible = false;
      const bodyId = geomMeta.bodyId | 0;
      const bodyStatic = bodyId >= 0 && isBodyStatic(bodyId);
      if (visible && !showStatic && bodyStatic) visible = false;
      if (transparentDynamic && !bodyStatic && Number.isFinite(alphaScale) && alphaScale > 1e-6 && alphaScale < 0.999) {
        a = clampUnit(a * alphaScale);
      }

      const materialOverrides =
        !!view &&
        (view.roughnessOverride != null ||
          view.metalnessOverride != null ||
          view.envMapIntensityOverride != null ||
          view.emissiveIntensityOverride != null);
      const wantsTexture = !!textureEnabled && !!resolveMaterialTextureDescriptor(matId, assets);
      const opacityQ = Math.max(0, Math.min(1000, quantize1e3(a)));
      const opaque = opacityQ >= 999;
      const isTransparent = opacityQ < 999;

      let transparentBin = isTransparent ? 0 : -1;
      let transparentOrder = 0;
      let transparentDepthNorm = 0;
      if (transparentCameraReady && transparentOrderingEnabled && isTransparent) {
        const posBase = si * 3;
        TRANSPARENT_BIN_WORLD_POS.set(
          posView[posBase + 0] || 0,
          posView[posBase + 1] || 0,
          posView[posBase + 2] || 0,
        );
        if (rootMatWorld) TRANSPARENT_BIN_WORLD_POS.applyMatrix4(rootMatWorld);
        TRANSPARENT_BIN_WORLD_POS.sub(TRANSPARENT_BIN_CAM_POS);
        const depth = TRANSPARENT_BIN_WORLD_POS.dot(TRANSPARENT_BIN_CAM_DIR);
        const depthNorm = transparentDepthInvSpan > 1e-12 ? ((depth - transparentDepthMin) * transparentDepthInvSpan) : 0;
        transparentDepthNorm = Math.max(0, Math.min(1, depthNorm));
        if (transparentBinningEnabled) {
          const k = Math.floor(transparentDepthNorm * transparentBins);
          transparentBin = Math.max(0, Math.min((transparentBins | 0) - 1, k | 0));
        } else {
          transparentBin = 0;
        }
        transparentOrder = (transparentBins | 0) - 1 - (transparentBin | 0);
        if (transparentBinsUsed && transparentBin >= 0 && transparentBin < transparentBinsUsed.length) {
          transparentBinsUsed[transparentBin] = 1;
        }
      }
      const transparentBinKey = (transparentOrderingEnabled && isTransparent) ? (transparentBin | 0) : -1;
      if (transparentBinPrev && meshIndex >= 0 && meshIndex < transparentBinPrev.length) {
        const prevBin = transparentBinPrev[meshIndex] | 0;
        if (prevBin !== transparentBinKey) {
          transparentBinMigrations += 1;
          transparentBinPrev[meshIndex] = transparentBinKey;
        }
      }

      const instancedType =
        gtypeRaw === MJ_GEOM.SPHERE ||
        gtypeRaw === MJ_GEOM.ELLIPSOID ||
        gtypeRaw === MJ_GEOM.CAPSULE ||
        gtypeRaw === MJ_GEOM.CYLINDER ||
        gtypeRaw === MJ_GEOM.BOX;
      const eligibleForInstancing =
        instancedType &&
        (opaque || (transparentOrderingEnabled && isTransparent)) &&
        !materialOverrides &&
        !wantsTexture;
      if (eligibleForInstancing) {
        if (meshIndex >= 0 && meshIndex < baseNgeom) {
          const proxy = ensureGeomProxy(meshIndex);
          if (proxy) {
            proxy.visible = visible;
            proxy.userData = proxy.userData || {};
            proxy.userData.geomIndex = meshIndex;
            proxy.userData.geomBodyId = bodyId;
            proxy.userData.geomName = geomMeta.name;
            proxy.userData.geomOpacity = a;
            let proxyRgba = proxy.userData.geomRgba;
            if (!Array.isArray(proxyRgba) || proxyRgba.length < 4) {
              proxyRgba = [0, 0, 0, 1];
              proxy.userData.geomRgba = proxyRgba;
            }
            proxyRgba[0] = r;
            proxyRgba[1] = g;
            proxyRgba[2] = b;
            proxyRgba[3] = a;
            proxy.userData.infinitePlane = false;
            if (proxy.material && typeof proxy.material === 'object') {
              proxy.material.opacity = a;
              proxy.material.transparent = a < 0.999;
              if (proxy.material.color && typeof proxy.material.color.setRGB === 'function') {
                proxy.material.color.setRGB(r, g, b);
              }
              if (typeof proxy.material.wireframe === 'boolean') {
                proxy.material.wireframe = !!flags?.[1];
              }
            }
          }
        }
        if (!visible) {
          safeHide(meshIndex);
          if (view) view.__dirty = false;
          return false;
        }
      }
      if (visible && eligibleForInstancing) {
        const reflectanceValue = resolveMaterialReflectance(matId, assets);
        const reflectanceQ = quantize1e6(reflectanceValue);
        const wireframe = !!flags?.[1];
        const geometry = ensureInstancedGeometry(inst, gtypeRaw);
        const scnObjType = objTypeView[si] | 0;
        const material = geometry ? ensureInstancedMaterial(inst, reflectanceQ, { wireframe, opacityQ, objType: scnObjType }) : null;
        let depthQ16 = 0;
        if (transparentBinKey >= 0 && sortTransparentInstances) {
          depthQ16 = Math.max(0, Math.min(65535, Math.floor((1 - transparentDepthNorm) * 65535))) | 0;
        }
        const orderRank = (transparentBinKey >= 0)
          ? (sortTransparentInstances ? (((transparentOrder | 0) << 16) | (depthQ16 | 0)) : (transparentOrder | 0))
          : (geomOrderRank ? (geomOrderRank[si] | 0) : si);
        const batchKey = `g${gtypeRaw | 0}:ot${scnObjType}:o${opaque ? 1000 : opacityQ | 0}:r${reflectanceQ | 0}:tb${transparentBinKey | 0}`;
        const batchCapacity = (transparentBinKey >= 0) ? transparentBatchCapacity : scnNgeom;
        const batch = (geometry && material)
          ? ensureInstancedBatch(ctx, inst, batchKey, geometry, material, batchCapacity)
          : null;
        if (batch?.mesh && batch.used < batch.capacity) {
          batch.objType = scnObjType;
          if (transparentBinKey >= 0) {
            batch.transparentBin = transparentBinKey | 0;
            if (batch.mesh.userData) batch.mesh.userData.transparentBin = transparentBinKey | 0;
            if (!sortTransparentInstances) {
              batch.renderOrder = transparentOrder | 0;
            }
          }
          if (Number.isFinite(orderRank)) {
            const lo = Number(batch.orderMin);
            const hi = Number(batch.orderMax);
            if (!Number.isFinite(lo) || orderRank < lo) batch.orderMin = orderRank;
            if (!Number.isFinite(hi) || orderRank > hi) batch.orderMax = orderRank;
          }
          const instanceId = batch.used | 0;
          if (batch.instanceOrderRank && instanceId < batch.instanceOrderRank.length) {
            batch.instanceOrderRank[instanceId] = Number.isFinite(orderRank) ? (orderRank | 0) : (si | 0);
          }
          const posBase = si * 3;
          inst.tmpPos.set(
            posView[posBase + 0] || 0,
            posView[posBase + 1] || 0,
            posView[posBase + 2] || 0,
          );
          const matBase = si * 9;
          setQuatFromMat3(
            inst.tmpQuat,
            matView[matBase + 0],
            matView[matBase + 1],
            matView[matBase + 2],
            matView[matBase + 3],
            matView[matBase + 4],
            matView[matBase + 5],
            matView[matBase + 6],
            matView[matBase + 7],
            matView[matBase + 8],
          );
          const sx0 = Number(sizeVec?.[0]) || 0;
          const sy0 = Number(sizeVec?.[1]) || 0;
          const sz0 = Number(sizeVec?.[2]) || 0;
          switch (gtypeRaw) {
            case MJ_GEOM.SPHERE: {
              const radius = Math.max(1e-6, sx0 || sy0 || sz0 || 0.1);
              inst.tmpScale.set(radius, radius, radius);
              break;
            }
            case MJ_GEOM.ELLIPSOID: {
              const ax = Math.max(1e-6, sx0 || 0.1);
              const ay = Math.max(1e-6, sy0 || ax);
              const az = Math.max(1e-6, sz0 || ax);
              inst.tmpScale.set(ax, ay, az);
              break;
            }
            case MJ_GEOM.CYLINDER: {
              const radius = Math.max(1e-6, sx0 || 0.05);
              const halfLength = Math.max(0, sy0 || 0);
              inst.tmpScale.set(radius, radius, Math.max(1e-6, halfLength));
              break;
            }
            case MJ_GEOM.CAPSULE: {
              const radius = Math.max(1e-6, sx0 || 0.05);
              const halfLength = Math.max(0, sy0 || 0);
              const totalLength = 2 * halfLength + 2 * radius;
              inst.tmpScale.set(radius, radius, Math.max(1e-6, totalLength * 0.25));
              break;
            }
            case MJ_GEOM.BOX:
            default: {
              const bx = Math.max(1e-6, sx0 || 0.1);
              const by = Math.max(1e-6, sy0 || bx);
              const bz = Math.max(1e-6, sz0 || bx);
              inst.tmpScale.set(bx, by, bz);
              break;
            }
          }
          inst.tmpMat4.compose(inst.tmpPos, inst.tmpQuat, inst.tmpScale);
          batch.mesh.setMatrixAt(instanceId, inst.tmpMat4);
          if (batch.mesh.instanceMatrix) batch.mesh.instanceMatrix.needsUpdate = true;
          if (batch.mesh.instanceColor?.array) {
            const colorArr = batch.mesh.instanceColor.array;
            const base = instanceId * 3;
            colorArr[base + 0] = r;
            colorArr[base + 1] = g;
            colorArr[base + 2] = b;
            batch.mesh.instanceColor.needsUpdate = true;
          }
          batch.instanceToGeomIndex[instanceId] = meshIndex;
          batch.used = instanceId + 1;
          batch.mesh.visible = true;
          const existingMesh = Array.isArray(ctx.meshes) ? ctx.meshes[meshIndex] : null;
          if (existingMesh && !existingMesh.userData?.proxy) existingMesh.visible = false;
          let ref = inst.geomRefs?.[meshIndex] || null;
          if (!ref) {
            ref = {};
            inst.geomRefs[meshIndex] = ref;
          }
          ref.kind = 'instance';
          ref.mesh = batch.mesh;
          ref.instanceId = instanceId;
          ref.geomType = gtypeRaw;
          ref.batchKey = batch.key;
          if (view) view.__dirty = false;
          return true;
        }
      }
      if (view) view.__dirty = false;
    }

    if (!allowCreate && !existingMesh) {
      safeHide(meshIndex);
      return false;
    }

    const mesh = ensureGeomMesh(ctx, meshIndex, gtypeRaw, assets, dataId, sizeVec, { geomMeta, dynamicSizeScale: true }, state);
    if (perfEnabled) meshMs += perfNow() - tEnsureStart;
    if (!mesh) return false;
    const scnObjType = objTypeView[si] | 0;
    if (instancingIsOverlayObjType(scnObjType)) {
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const mat of mats) {
        if (!mat || typeof mat !== 'object') continue;
        if (!('toneMapped' in mat)) continue;
        if (mat.toneMapped !== false) {
          mat.toneMapped = false;
          if ('needsUpdate' in mat) mat.needsUpdate = true;
        }
      }
    }
    if (perfEnabled && mesh !== meshBefore) {
      if (meshBefore) {
        ensureRebuilt += 1;
        const beforeUserData = meshBefore.userData || {};
        const beforeType = beforeUserData.geomType;
        const beforeInfinite = !!beforeUserData.infinitePlane;
        const infiniteNow = (gtypeRaw === MJ_GEOM.PLANE) && isInfinitePlaneSize(sizeVec);
        if (beforeType !== gtypeRaw) {
          ensureRebuiltType += 1;
        } else if (beforeInfinite !== infiniteNow) {
          ensureRebuiltInfinite += 1;
        } else if (meshLike && beforeUserData.geomDataId !== dataId) {
          ensureRebuiltDataId += 1;
        } else {
          const needsSizeCheck =
            !infiniteNow &&
            (gtypeRaw !== MJ_GEOM.MESH && gtypeRaw !== MJ_GEOM.SDF);
          if (needsSizeCheck) {
            const sx = Number(sizeVec?.[0]) || 0;
            const sy = Number(sizeVec?.[1]) || 0;
            const sz = Number(sizeVec?.[2]) || 0;
            const hasSizeKeys =
              typeof beforeUserData.geomSizeX === 'number' &&
              typeof beforeUserData.geomSizeY === 'number' &&
              typeof beforeUserData.geomSizeZ === 'number';
            const sizeChanged =
              !hasSizeKeys ||
              Math.abs(beforeUserData.geomSizeX - sx) > 1e-6 ||
              Math.abs(beforeUserData.geomSizeY - sy) > 1e-6 ||
              Math.abs(beforeUserData.geomSizeZ - sz) > 1e-6;
            if (sizeChanged) {
              ensureRebuiltSize += 1;
              switch (gtypeRaw) {
                case MJ_GEOM.LINE:
                  ensureRebuiltSizeLine += 1;
                  break;
                case MJ_GEOM.LINEBOX:
                  ensureRebuiltSizeLinebox += 1;
                  break;
                case MJ_GEOM.ARROW:
                case MJ_GEOM.ARROW1:
                case MJ_GEOM.ARROW2:
                  ensureRebuiltSizeArrow += 1;
                  break;
                case MJ_GEOM.TRIANGLE:
                  ensureRebuiltSizeTriangle += 1;
                  break;
                case MJ_GEOM.CAPSULE:
                  ensureRebuiltSizeCapsule += 1;
                  break;
                case MJ_GEOM.CYLINDER:
                  ensureRebuiltSizeCylinder += 1;
                  break;
                default:
                  ensureRebuiltSizeOtherGtype += 1;
                  break;
              }
            } else {
              ensureRebuiltOther += 1;
            }
          } else {
            ensureRebuiltOther += 1;
          }
        }
      } else {
        ensureCreated += 1;
      }
    }
    if (!mesh.userData?.infinitePlane) {
      mesh.renderOrder = geomOrderRank ? (geomOrderRank[si] | 0) : (mesh.renderOrder || 0);
    }

    const tFlagsStart0 = perfEnabled ? perfNow() : 0;
    const reflectanceValue = resolveMaterialReflectance(matId, assets);
    mesh.userData = mesh.userData || {};
    mesh.userData.matId = matId;
    mesh.userData.scnIndex = si;
    mesh.userData.scnObjType = objTypeView[si] | 0;
    mesh.userData.scnObjId = objIdView[si] | 0;
    mesh.userData.scnCategory = categoryView[si] | 0;
    mesh.userData.scnDataId = rawDataId;
    mesh.userData.geomModelDataId = meshLike ? meshModelDataId : null;
    applyReflectanceToMaterial(mesh, ctx, reflectanceValue, reflectionEnabled);

    if (segmentEnabled) {
      const segMat = ensureSegmentMaterial(mesh, flags);
      if (segMat) {
        const segColor = segmentColorForIndex(mesh.userData?.geomIndex ?? meshIndex);
        segMat.color.setHex(segColor);
        mesh.material = segMat;
      }
    } else {
      restoreSegmentMaterial(mesh);
    }
    if (perfEnabled) flagsMs += perfNow() - tFlagsStart0;

    const tXformStart = perfEnabled ? perfNow() : 0;
    const isInfinitePlane = !!mesh.userData?.infinitePlane;
    if (isInfinitePlane) {
      updateInfinitePlaneFromSceneSoA(mesh, si, snapshot, flags);
      if (perfEnabled) infiniteXformUpdates += 1;
    } else {
      const posBase = si * 3;
      mesh.position.set(
        posView[posBase + 0] || 0,
        posView[posBase + 1] || 0,
        posView[posBase + 2] || 0,
      );
      const matBase = si * 9;
      setQuatFromMat3(
        mesh.quaternion,
        matView[matBase + 0],
        matView[matBase + 1],
        matView[matBase + 2],
        matView[matBase + 3],
        matView[matBase + 4],
        matView[matBase + 5],
        matView[matBase + 6],
        matView[matBase + 7],
        matView[matBase + 8],
      );
      if (isDynamicSizeScaleGeomType(gtypeRaw)) {
        applyDynamicSizeScale(mesh, gtypeRaw, sizeVec);
      } else {
        mesh.scale.set(1, 1, 1);
      }
      if (perfEnabled) xformUpdates += 1;
    }
    if (perfEnabled) xformMs += perfNow() - tXformStart;

    let visible = true;
    if (hideAllGeometry) visible = false;
    if (!segmentEnabled) {
      const tFlagsStart1 = perfEnabled ? perfNow() : 0;
      let r = clampUnit(Number(rgba?.[0]) || 0);
      let g = clampUnit(Number(rgba?.[1]) || 0);
      let b = clampUnit(Number(rgba?.[2]) || 0);
      let a = clampUnit(Number(rgba?.[3]) || 0);
      const view = geomState?.view || null;
      if (view) {
        if (view.debugHidden) visible = false;
        if (view.visibleOverride === true) visible = true;
        else if (view.visibleOverride === false) visible = false;
        if (Array.isArray(view.colorOverride) && view.colorOverride.length >= 4) {
          r = clampUnit(Number(view.colorOverride[0]) || 0);
          g = clampUnit(Number(view.colorOverride[1]) || 0);
          b = clampUnit(Number(view.colorOverride[2]) || 0);
          a = clampUnit(Number(view.colorOverride[3]) || 0);
        }
      }
      if (hideAllGeometry) visible = false;
      const bodyId = geomMeta.bodyId | 0;
      const bodyStatic = bodyId >= 0 && isBodyStatic(bodyId);
      if (visible && !showStatic && bodyStatic) visible = false;
      if (transparentDynamic && !bodyStatic && Number.isFinite(alphaScale) && alphaScale > 1e-6 && alphaScale < 0.999) {
        a = clampUnit(a * alphaScale);
      }

      const mat = mesh.material;
      if (mat && mat.color && typeof mat.color.setRGB === 'function') {
        if ((mat.color.r !== r) || (mat.color.g !== g) || (mat.color.b !== b)) {
          mat.color.setRGB(r, g, b);
          if (perfEnabled) colorUpdates += 1;
        }
      }
      const nextTransparent = a < 0.999;
      if (mat && ('opacity' in mat)) {
        const changedOpacity = mat.opacity !== a;
        const changedTransparent = mat.transparent !== nextTransparent;
        if (changedOpacity) mat.opacity = a;
        if (changedTransparent) mat.transparent = nextTransparent;
        if (perfEnabled && (changedOpacity || changedTransparent)) opacityUpdates += 1;
      }
      if (mat && typeof mat.depthWrite === 'boolean') {
        const nextDepthWrite = !nextTransparent;
        if (mat.depthWrite !== nextDepthWrite) {
          mat.depthWrite = nextDepthWrite;
        }
      }
      const userData = mesh.userData || (mesh.userData = {});
      let transparentBinKey = -1;
      const ignoreTransparentOrdering = !!userData.infinitePlane || !!userData.infiniteGrid;
      if (ignoreTransparentOrdering) {
        userData.transparentBin = -1;
        if (userData.infinitePlane) {
          mesh.renderOrder = RENDER_ORDER.GROUND;
        } else if (userData.infiniteGrid && typeof userData.infiniteGrid === 'object') {
          const ro = userData.infiniteGrid.renderOrder;
          if (Number.isFinite(ro)) mesh.renderOrder = ro;
        }
      } else if (transparentOrderingEnabled && nextTransparent) {
        let bin = 0;
        let order = 0;
        if (transparentCameraReady) {
          const posBase = si * 3;
          TRANSPARENT_BIN_WORLD_POS.set(
            posView[posBase + 0] || 0,
            posView[posBase + 1] || 0,
            posView[posBase + 2] || 0,
          );
          if (rootMatWorld) TRANSPARENT_BIN_WORLD_POS.applyMatrix4(rootMatWorld);
          TRANSPARENT_BIN_WORLD_POS.sub(TRANSPARENT_BIN_CAM_POS);
          const depth = TRANSPARENT_BIN_WORLD_POS.dot(TRANSPARENT_BIN_CAM_DIR);
          const depthNorm = transparentDepthInvSpan > 1e-12 ? ((depth - transparentDepthMin) * transparentDepthInvSpan) : 0;
          const depthNormClamped = Math.max(0, Math.min(1, depthNorm));
          if (transparentBinningEnabled) {
            const k = Math.floor(depthNormClamped * transparentBins);
            bin = Math.max(0, Math.min((transparentBins | 0) - 1, k | 0));
          } else {
            bin = 0;
          }
        }
        transparentBinKey = bin | 0;
        order = (transparentBins | 0) - 1 - transparentBinKey;
        mesh.renderOrder = order | 0;
        userData.transparentBin = transparentBinKey;
        if (transparentBinsUsed && transparentBinKey >= 0 && transparentBinKey < transparentBinsUsed.length) {
          transparentBinsUsed[transparentBinKey] = 1;
        }
      } else {
        userData.transparentBin = -1;
      }
      if (transparentBinPrev && meshIndex >= 0 && meshIndex < transparentBinPrev.length) {
        const prevBin = transparentBinPrev[meshIndex] | 0;
        const nextBin = (!ignoreTransparentOrdering && transparentOrderingEnabled && nextTransparent) ? transparentBinKey : -1;
        if (prevBin !== nextBin) {
          transparentBinMigrations += 1;
          transparentBinPrev[meshIndex] = nextBin;
        }
      }
      let userRgba = userData.geomRgba;
      if (!Array.isArray(userRgba) || userRgba.length < 4) {
        userRgba = [0, 0, 0, 1];
        userData.geomRgba = userRgba;
      }
      userRgba[0] = r;
      userRgba[1] = g;
      userRgba[2] = b;
      userRgba[3] = a;
      userData.geomOpacity = a;
      userData.baseAlpha = a;

      if (view && mat) {
        if (view.roughnessOverride != null && ('roughness' in mat) && mat.roughness !== view.roughnessOverride) {
          mat.roughness = view.roughnessOverride;
        }
        if (view.metalnessOverride != null && ('metalness' in mat) && mat.metalness !== view.metalnessOverride) {
          mat.metalness = view.metalnessOverride;
        }
        if (view.envMapIntensityOverride != null && ('envMapIntensity' in mat) && mat.envMapIntensity !== view.envMapIntensityOverride) {
          mat.envMapIntensity = view.envMapIntensityOverride;
        }
        if (view.emissiveIntensityOverride != null && ('emissiveIntensity' in mat) && mat.emissiveIntensity !== view.emissiveIntensityOverride) {
          mat.emissiveIntensity = view.emissiveIntensityOverride;
        }
      }
      if (view) view.__dirty = false;
      applyMaterialFlags(mesh, meshIndex, state, flags);
      const texcoordMode =
        (gtypeRaw === MJ_GEOM.MESH || gtypeRaw === MJ_GEOM.SDF) && mesh.geometry && typeof mesh.geometry.getAttribute === 'function' && mesh.geometry.getAttribute('uv')
          ? 'explicit'
          : 'generated';
      const textureCompatible =
        gtypeRaw === MJ_GEOM.PLANE ||
        gtypeRaw === MJ_GEOM.HFIELD ||
        gtypeRaw === MJ_GEOM.SPHERE ||
        gtypeRaw === MJ_GEOM.CAPSULE ||
        gtypeRaw === MJ_GEOM.ELLIPSOID ||
        gtypeRaw === MJ_GEOM.CYLINDER ||
        gtypeRaw === MJ_GEOM.BOX ||
        gtypeRaw === MJ_GEOM.MESH ||
        gtypeRaw === MJ_GEOM.SDF;
      if (perfEnabled) flagsMs += perfNow() - tFlagsStart1;
      if (textureCompatible) {
        if (perfEnabled) {
          textureCalls += 1;
          const tTexStart = perfNow();
          applyMuJoCoTextureToMesh(mesh, matId, ctx, assets, textureEnabled, {
            texcoordMode,
            geomType: gtypeRaw,
            geomSize: sizeVec,
            geomDataId: dataId,
            perfOut: texPerf,
          });
          textureMs += perfNow() - tTexStart;
        } else {
          applyMuJoCoTextureToMesh(mesh, matId, ctx, assets, textureEnabled, {
            texcoordMode,
            geomType: gtypeRaw,
            geomSize: sizeVec,
            geomDataId: dataId,
          });
        }
      }
    }

    mesh.visible = visible;
    if (inst && meshIndex >= 0) {
      let ref = inst.geomRefs?.[meshIndex] || null;
      if (!ref) {
        ref = {};
        inst.geomRefs[meshIndex] = ref;
      }
      ref.kind = 'mesh';
      ref.mesh = mesh;
      ref.instanceId = null;
      ref.geomType = gtypeRaw;
      ref.batchKey = null;
    }
    return visible;
  };

  let drawn = 0;
  // Base model geoms: keep indices 0..ngeom-1 stable for picking/controls.
  for (let geomId = 0; geomId < baseNgeom; geomId += 1) {
    const scnIdx = geomToScn[geomId] | 0;
    if (scnIdx < 0) {
      safeHide(geomId);
      continue;
    }
    const name = geomNameFromLookup(geomNameLookup, geomId);
    if (updateOne(geomId, scnIdx, name)) drawn += 1;
  }

  // Extra scene geoms (sites/tendons/etc), appended after base geoms.
  const extras = ctx._scnExtras || (ctx._scnExtras = []);
  extras.length = 0;
  for (let i = 0; i < scnNgeom; i += 1) {
    const objType = objTypeView[i] | 0;
    if (objType === MJ_OBJ.FLEX || objType === MJ_OBJ.SKIN) continue;
    if (objType === MJ_OBJ.GEOM) {
      const geomId = objIdView[i] | 0;
      if (geomId >= 0 && geomId < baseNgeom) continue;
    }
    extras.push(i);
  }

  // Creating hundreds of new Three.js meshes/geometries in a single frame can
  // stall the main thread (especially in headless / SwiftShader runs). Spread
  // extra-geom construction across frames while always updating existing ones.
  const createBudget = 8;
  let createdThisFrame = 0;
  const tCreateStart = (typeof performance !== 'undefined' && performance.now) ? performance.now() : null;
  const createTimeBudgetMs = 6;
  for (let k = 0; k < extras.length; k += 1) {
    const meshIndex = baseNgeom + k;
    const scnIdx = extras[k] | 0;
    const existing = Array.isArray(ctx.meshes) ? ctx.meshes[meshIndex] : null;
    let allowCreate = true;
    if (!existing) {
      if (tCreateStart != null && (performance.now() - tCreateStart) > createTimeBudgetMs) {
        allowCreate = false;
      }
      if (createdThisFrame >= createBudget) {
        allowCreate = false;
      }
    }
    const visible = updateOne(meshIndex, scnIdx, null, allowCreate);
    if (!existing && allowCreate) {
      const created = Array.isArray(ctx.meshes) ? ctx.meshes[meshIndex] : null;
      if (created) createdThisFrame += 1;
    }
    if (visible) drawn += 1;
  }

  // Hide any stale meshes beyond current range.
  const total = baseNgeom + extras.length;
  if (Array.isArray(ctx.meshes) && ctx.meshes.length > total) {
    for (let i = total; i < ctx.meshes.length; i += 1) {
      if (ctx.meshes[i]) ctx.meshes[i].visible = false;
    }
  }

  if (inst && inst.batches instanceof Map) {
    const wireframe = !!flags?.[1];
    let instancedBatches = 0;
    let instancedInstances = 0;
    let transparentInstancedBatches = 0;
    let transparentInstancedInstances = 0;
    for (const batch of inst.batches.values()) {
      if (!batch?.mesh) continue;
      const used = batch.used | 0;
      batch.mesh.count = used;
      batch.mesh.visible = used > 0;
      if (batch.mesh.instanceMatrix) batch.mesh.instanceMatrix.needsUpdate = used > 0;
      if (batch.mesh.instanceColor) batch.mesh.instanceColor.needsUpdate = used > 0;
      if (typeof batch.renderOrder === 'number' && Number.isFinite(batch.renderOrder)) {
        batch.mesh.renderOrder = Number(batch.renderOrder) | 0;
      } else if (Number.isFinite(batch.orderMin)) {
        batch.mesh.renderOrder = Number(batch.orderMin) | 0;
      }
      if (used > 1 && batch.material?.transparent && inst && sortTransparentInstances) {
        const tSort0 = perfEnabled ? perfNow() : 0;
        sortInstancedBatchByOrderRank(inst, batch);
        if (perfEnabled) {
          transparentSortMs += perfNow() - tSort0;
          transparentSortedInstances += used;
        }
      }
      if (batch.material && typeof batch.material.wireframe === 'boolean') {
        batch.material.wireframe = wireframe;
      }
      if (typeof batch.objType === 'number') {
        const overlay = instancingIsOverlayObjType(batch.objType);
        const nextCastShadow = !overlay;
        const nextReceiveShadow = !overlay;
        if (batch.mesh.castShadow !== nextCastShadow) batch.mesh.castShadow = nextCastShadow;
        if (batch.mesh.receiveShadow !== nextReceiveShadow) batch.mesh.receiveShadow = nextReceiveShadow;
      }
      if (batch.material && 'envMapIntensity' in batch.material) {
        const q = batch.material.userData?.reflectanceQ;
        const reflectance = Number.isFinite(q) ? Math.max(0, Number(q)) / 1e6 : 0;
        const mode = ctx?.visualSourceMode || 'model';
        const presetMode = mode === 'preset-sun' || mode === 'preset-moon';
        const baseIntensity = typeof ctx?.envIntensity === 'number' ? ctx.envIntensity : 0;
        const nextEnvIntensity =
          reflectionEnabled && presetMode && baseIntensity > 0 && reflectance > 0
            ? baseIntensity * reflectance
            : 0;
        const current = typeof batch.material.envMapIntensity === 'number' ? batch.material.envMapIntensity : 0;
        if (Math.abs(current - nextEnvIntensity) > 1e-6) {
          batch.material.envMapIntensity = nextEnvIntensity;
        }
      }
      if (typeof batch.prevUsed === 'number' && batch.prevUsed > used && batch.instanceToGeomIndex) {
        batch.instanceToGeomIndex.fill(-1, used, batch.prevUsed);
      }
      batch.prevUsed = used;
      if (used > 0) {
        instancedBatches += 1;
        instancedInstances += used;
        if (batch.material?.transparent) {
          transparentInstancedBatches += 1;
          transparentInstancedInstances += used;
        }
      }
    }
    if (perfEnabled) {
      perfSample('renderer:instancing_batches', instancedBatches);
      perfSample('renderer:instancing_instances', instancedInstances);
      let activeBins = 0;
      if (transparentBinsUsed) {
        for (let i = 0; i < transparentBinsUsed.length; i += 1) {
          if (transparentBinsUsed[i] | 0) activeBins += 1;
        }
      }
      perfSample('renderer:transparent_bins', transparentBins | 0);
      perfSample('renderer:transparent_sort_strict', sortTransparentInstances ? 1 : 0);
      perfSample('renderer:transparent_candidate_count', transparentCandidateCount | 0);
      perfSample('renderer:transparent_bin_count', activeBins);
      perfSample('renderer:transparent_bin_migrations', transparentBinMigrations | 0);
      perfSample('renderer:transparent_instanced_batches', transparentInstancedBatches);
      perfSample('renderer:transparent_instanced_instances', transparentInstancedInstances);
      perfSample('renderer:transparent_sort_ms', transparentSortMs);
      perfSample('renderer:transparent_sorted_instances', transparentSortedInstances);
    }
  }

  if (perfEnabled) {
    const totalMs = perfNow() - tTotalStart;
    const miscMs = Math.max(0, totalMs - meshMs - xformMs - flagsMs - textureMs);
    perfSample('renderer:apply_scene_soa_mesh_ms', meshMs);
    perfSample('renderer:apply_scene_soa_xform_ms', xformMs);
    perfSample('renderer:apply_scene_soa_flags_ms', flagsMs);
    perfSample('renderer:apply_scene_soa_texture_ms', textureMs);
    perfSample('renderer:apply_scene_soa_misc_ms', miscMs);
    perfSample('renderer:apply_scene_soa_ensure_calls', ensureCalls);
    perfSample('renderer:apply_scene_soa_ensure_created', ensureCreated);
    perfSample('renderer:apply_scene_soa_ensure_rebuilt', ensureRebuilt);
    perfSample('renderer:apply_scene_soa_ensure_rebuilt_type', ensureRebuiltType);
    perfSample('renderer:apply_scene_soa_ensure_rebuilt_infinite', ensureRebuiltInfinite);
    perfSample('renderer:apply_scene_soa_ensure_rebuilt_dataid', ensureRebuiltDataId);
    perfSample('renderer:apply_scene_soa_ensure_rebuilt_size', ensureRebuiltSize);
    perfSample('renderer:apply_scene_soa_ensure_rebuilt_size_line', ensureRebuiltSizeLine);
    perfSample('renderer:apply_scene_soa_ensure_rebuilt_size_linebox', ensureRebuiltSizeLinebox);
    perfSample('renderer:apply_scene_soa_ensure_rebuilt_size_arrow', ensureRebuiltSizeArrow);
    perfSample('renderer:apply_scene_soa_ensure_rebuilt_size_triangle', ensureRebuiltSizeTriangle);
    perfSample('renderer:apply_scene_soa_ensure_rebuilt_size_capsule', ensureRebuiltSizeCapsule);
    perfSample('renderer:apply_scene_soa_ensure_rebuilt_size_cylinder', ensureRebuiltSizeCylinder);
    perfSample('renderer:apply_scene_soa_ensure_rebuilt_size_other_gtype', ensureRebuiltSizeOtherGtype);
    perfSample('renderer:apply_scene_soa_ensure_rebuilt_other', ensureRebuiltOther);
    perfSample('renderer:apply_scene_soa_texture_calls', textureCalls);
    perfSample('renderer:apply_scene_soa_color_updates', colorUpdates);
    perfSample('renderer:apply_scene_soa_opacity_updates', opacityUpdates);
    perfSample('renderer:apply_scene_soa_xform_updates', xformUpdates);
    perfSample('renderer:apply_scene_soa_xform_infinite_updates', infiniteXformUpdates);
    if (texPerf) {
      const uvCalls = texPerf.texUvCalls | 0;
      const uvHit = texPerf.texUvCacheHit | 0;
      const uvRecompute = texPerf.texUvRecompute | 0;
      const uvSkip = texPerf.texUvSkip | 0;
      perfSample('renderer:apply_scene_soa_tex_map_changed', texPerf.texMapChanged | 0);
      perfSample('renderer:apply_scene_soa_uv_calls', uvCalls);
      perfSample('renderer:apply_scene_soa_uv_cache_hit', uvHit);
      perfSample('renderer:apply_scene_soa_uv_recompute', uvRecompute);
      perfSample('renderer:apply_scene_soa_uv_skip', uvSkip);
      perfSample('renderer:apply_scene_soa_uv_hit_rate', uvCalls ? uvHit / uvCalls : 0);
      perfSample('renderer:apply_scene_soa_uv_recompute_rate', uvCalls ? uvRecompute / uvCalls : 0);
    }
  }

  return drawn;
}

function createRendererManager({
  canvas,
  renderCtx,
  applyFallbackAppearance,
  ensureEnvIfNeeded,
  hideAllGeometryDefault,
  fallbackEnabledDefault,
  fallbackPresetKey,
  fallbackModeParam,
  debugMode = false,
  setRenderStats = () => {},
}) {
  const ctx = renderCtx;
  if (!ctx) throw new Error('renderCtx is required');
  ctx.cameraTarget = ctx.cameraTarget || new THREE.Vector3(0, 0, 0);
  ctx.meshes = ctx.meshes || [];
  ctx.assetCache = ctx.assetCache || { meshGeometries: new Map() };
  ctx._shadow = ctx._shadow || { lastCenter: null, lastRadius: 0 };
  ctx._frameCounter = ctx._frameCounter || 0;
  ctx.boundsEvery = typeof ctx.boundsEvery === 'number' && ctx.boundsEvery > 0 ? ctx.boundsEvery : 2;
  ctx.currentCameraMode = typeof ctx.currentCameraMode === 'number' ? ctx.currentCameraMode : 0;
  ctx.fixedCameraActive = !!ctx.fixedCameraActive;

  const cleanup = [];
  const tempVecA = new THREE.Vector3();
  const tempVecB = new THREE.Vector3();
  const tempVecC = new THREE.Vector3();
  const tempVecD = new THREE.Vector3();

  // Expose a small helper so other modules (e.g. environment manager)
  // can tweak JS-side geom view state without needing to know where
  // those fields live.
  ctx.setGeomViewProps = (geomIndex, props) => setGeomViewProps(ctx, geomIndex, props || {});
  ctx.resolveGeomWorldMatrix = (geomIndex, outMat4) => resolveGeomWorldMatrix(ctx, geomIndex, outMat4);
  ctx.resolveGeomWorldPose = (geomIndex, outPos, outQuat, outScale) => resolveGeomWorldPose(ctx, geomIndex, outPos, outQuat, outScale);

  function updateRendererViewport() {
    if (!canvas || !ctx.renderer || !ctx.camera) return;
    let width = 1;
    let height = 1;
    if (typeof canvas.getBoundingClientRect === 'function') {
      const rect = canvas.getBoundingClientRect();
      width = Math.max(1, Math.floor(rect.width || canvas.width || 1));
      height = Math.max(1, Math.floor(rect.height || canvas.height || 1));
    } else {
      width = Math.max(1, canvas.width || canvas.clientWidth || 1);
      height = Math.max(1, canvas.height || canvas.clientHeight || 1);
    }
    if (typeof window !== 'undefined') {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      if (typeof ctx.renderer.setPixelRatio === 'function') ctx.renderer.setPixelRatio(dpr);
    }
    ctx.renderer.setSize(width, height, false);
    ctx.camera.aspect = width / height;
    ctx.camera.updateProjectionMatrix();
  }

  function ensureRenderLoop() {
    if (typeof window === 'undefined' || !window.requestAnimationFrame) return;
    if (ctx.loopActive) return;
    ctx.loopActive = true;
    const perfEnabled = isPerfEnabled();
    const step = () => {
      if (!ctx.loopActive) return;
      ctx.frameId = window.requestAnimationFrame(step);
      if (!ctx.initialized || !ctx.renderer || !ctx.sceneWorld || !ctx.camera) return;
      const tDrawStart = perfEnabled ? perfNow() : 0;
      // Background/environment is managed by environment manager (ensureEnvIfNeeded)
      renderWorldScene(ctx, ctx.renderer, { camera: ctx.camera });
      if (perfEnabled) {
        const info = ctx.renderer?.info?.render || null;
        if (info) {
          perfSample('renderer:draw_calls', info.calls | 0);
          perfSample('renderer:draw_triangles', info.triangles | 0);
          const programs = ctx.renderer?.info?.programs;
          if (Array.isArray(programs)) {
            perfSample('renderer:program_count', programs.length | 0);
          }
        }
      }
      if (perfEnabled) {
        perfMarkOnce('play:renderer:first_draw');
        perfSample('renderer:draw_ms', perfNow() - tDrawStart);
      }
      // Expose a simple frame counter for headless readiness checks
      try {
        ctx._frameCounter = (ctx._frameCounter || 0) + 1;
        if (typeof window !== 'undefined') {
          window.__frameCounter = ctx._frameCounter;
        }
      } catch {}
    };
    ctx.frameId = window.requestAnimationFrame(step);
    if (!ctx.loopCleanup) {
      ctx.loopCleanup = () => {
        ctx.loopActive = false;
        if (typeof window !== 'undefined' && window.cancelAnimationFrame && ctx.frameId != null) {
          window.cancelAnimationFrame(ctx.frameId);
        }
        ctx.frameId = null;
        ctx.loopCleanup = null;
      };
      cleanup.push(ctx.loopCleanup);
    }
    if (typeof document !== 'undefined' && !ctx._visibilityInstalled) {
      const visHandler = () => {
        try {
          if (document.hidden) {
            if (ctx.loopActive && ctx.loopCleanup) ctx.loopCleanup();
          } else {
            ensureRenderLoop();
          }
        } catch {}
      };
      document.addEventListener('visibilitychange', visHandler, { capture: true });
      cleanup.push(() => document.removeEventListener('visibilitychange', visHandler, { capture: true }));
      ctx._visibilityInstalled = true;
    }
  }
  function initRenderer() {
    if (ctx.initialized || !canvas) return ctx;

    const wantPreserve = (typeof window !== 'undefined') && (
      window.PLAY_SNAPSHOT_DEBUG === true || window.PLAY_SNAPSHOT_DEBUG === 1 || window.PLAY_SNAPSHOT_DEBUG === '1' ||
      window.__snapshot === 1 || window.__snapshot === true ||
      (typeof window.location?.search === 'string' && window.location.search.includes('snapshot=1'))
    );
    const renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: wantPreserve,
    });
    renderer.autoClear = false;
    renderer.sortObjects = true;
    if (typeof window !== 'undefined') {
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    }
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;
    if ('physicallyCorrectLights' in renderer) {
      renderer.physicallyCorrectLights = true;
    }
    renderer.setClearColor(DEFAULT_CLEAR_HEX, 1);
    ctx.baseClearHex = DEFAULT_CLEAR_HEX;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;

    const sceneWorld = new THREE.Scene();

    const ambient = new THREE.AmbientLight(0xffffff, 0);
    sceneWorld.add(ambient);
    const hemi = new THREE.HemisphereLight(0xffffff, 0x10131c, 0);
    sceneWorld.add(hemi);
    const keyLight = new THREE.DirectionalLight(0xffffff, 2.0);
    keyLight.position.set(6, -8, 8);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.set(4096, 4096);
    keyLight.shadow.camera.near = 0.1;
    keyLight.shadow.camera.far = 200;
    keyLight.shadow.camera.left = -30;
    keyLight.shadow.camera.right = 30;
    keyLight.shadow.camera.top = 30;
    keyLight.shadow.camera.bottom = -30;
    keyLight.shadow.bias = -0.0001;
    if ('normalBias' in keyLight.shadow) {
      keyLight.shadow.normalBias = 0.001;
    }
    const lightTarget = new THREE.Object3D();
    sceneWorld.add(lightTarget);
    keyLight.target = lightTarget;
    sceneWorld.add(keyLight);
    const fill = new THREE.DirectionalLight(0xffffff, 0.25);
    fill.position.set(-6, 6, 3);
    sceneWorld.add(fill);

    const camera = new THREE.PerspectiveCamera(75, 1, 0.01, GROUND_DISTANCE * 20);
    camera.up.set(0, 0, 1);
    camera.position.set(3, -4, 2);
    camera.lookAt(new THREE.Vector3(0, 0, 0));

    const root = new THREE.Group();
    sceneWorld.add(root);

    Object.assign(ctx, {
      initialized: true,
      renderer,
      sceneWorld,
      scene: sceneWorld,
      camera,
      root,
      ground: null,
      grid: null,
      light: keyLight,
      lightTarget,
      fill,
      hemi,
      ambient,
      assetSource: null,
      meshes: [],
      defaultVopt: null,
      alignSeq: 0,
      copySeq: 0,
      autoAligned: false,
      bounds: null,
      pmrem: null,
      envRT: null,
      envFromHDRI: false,
      hdriReady: false,
      hdriLoading: false,
      hdriBackground: null,
      hdriLoadPromise: null,
      hdriFailed: false,
      hdriLoadGen: 0,
      envDirty: true,
      skyMode: null,
      skyBackground: null,
      skyCube: null,
      skyShader: null,
      skyPalette: null,
      skyDebugMode: null,
      skyInit: false,
      _lastPresetMode: null,
      fallback: {
        enabled: fallbackEnabledDefault,
        preset: fallbackPresetKey,
        mode: fallbackModeParam,
      },
    });

    updateRendererViewport();
    if (typeof window !== 'undefined') {
      const resizeListener = () => updateRendererViewport();
      window.addEventListener('resize', resizeListener);
      cleanup.push(() => window.removeEventListener('resize', resizeListener));
      ensureRenderLoop();
    }

    return ctx;
  }
  function renderScene(snapshot, state) {
    if (!snapshot || !state) return;
    const perfEnabled = isPerfEnabled();
    const tRenderStart = perfEnabled ? perfNow() : 0;
    const context = initRenderer();
    if (!context.initialized) return;
    context.visualSourceMode = state.visualSourceMode || 'model';
    if (typeof window !== 'undefined') {
      window.__renderCtx = context;
      window.__envDebug = {
        envIntensity: typeof context.envIntensity === 'number' ? context.envIntensity : null,
        sample: context._envDebugSample || null,
      };
    }
    const renderer = context.renderer;
    const policy = computeScenePolicy(snapshot, state, context);
    const {
      sceneFlags,
      voptFlags,
      segmentEnabled,
      skyboxEnabled,
      shadowEnabled,
      reflectionEnabled,
      fogEnabled,
      hazeEnabled,
      presetMode,
    } = policy;
    context.reflectionActive = reflectionEnabled;

    const assets = state.rendering?.assets || null;
    const tAssetsStart = perfEnabled ? perfNow() : 0;
    syncRendererAssets(context, assets);
    if (perfEnabled) {
      perfSample('renderer:sync_assets_ms', perfNow() - tAssetsStart);
    }
    const geomGroupIds = assets?.geoms?.group || null;
    const geomGroupMask = Array.isArray(state.rendering?.groups?.geom) ? state.rendering.groups.geom : null;
    const flexGroupIds = assets?.flexes?.group || null;
    const flexGroupMask = Array.isArray(state.rendering?.groups?.flex) ? state.rendering.groups.flex : null;
    const skinGroupIds = assets?.skins?.group || null;
    const skinGroupMask = Array.isArray(state.rendering?.groups?.skin) ? state.rendering.groups.skin : null;

    if (typeof ensureEnvIfNeeded === 'function') {
      ensureEnvIfNeeded(context, state, { skyboxEnabled, presetMode });
    }
  if (!segmentEnabled && presetMode && typeof applyFallbackAppearance === 'function') {
      applyFallbackAppearance(context, state);
    }
    const worldScene = getWorldScene(context);
      if (segmentEnabled) {
        if (!context._segmentEnvBackup && worldScene) {
          context._segmentEnvBackup = {
            background: worldScene.background,
            environment: worldScene.environment,
          shadowEnabled: context.renderer?.shadowMap?.enabled ?? null,
          toneExposure: context.renderer?.toneMappingExposure ?? null,
          light: context.light ? context.light.intensity : null,
          fill: context.fill ? context.fill.intensity : null,
          ambient: context.ambient ? context.ambient.intensity : null,
          hemi: context.hemi ? context.hemi.intensity : null,
        };
      }
      if (worldScene) {
        worldScene.environment = null;
        worldScene.background = new THREE.Color(segmentBackgroundColor());
      }
      if (context.sky) context.sky.visible = false;
      if (context.renderer?.shadowMap) context.renderer.shadowMap.enabled = false;
      if (context.light) context.light.intensity = 0;
      if (context.fill) context.fill.intensity = 0;
      if (context.ambient) context.ambient.intensity = 0;
      if (context.hemi) context.hemi.intensity = 0;
      context._segmentEnvBackupApplied = true;
    } else {
      if (context._segmentEnvBackup && worldScene) {
        worldScene.background = context._segmentEnvBackup.background || null;
        worldScene.environment = context._segmentEnvBackup.environment || null;
        if (context.renderer?.shadowMap && context._segmentEnvBackup.shadowEnabled != null) {
          context.renderer.shadowMap.enabled = shadowEnabled && context._segmentEnvBackup.shadowEnabled;
        }
        if (context.light && context._segmentEnvBackup.light != null) {
          context.light.intensity = context._segmentEnvBackup.light;
        }
        if (context.fill && context._segmentEnvBackup.fill != null) {
          context.fill.intensity = context._segmentEnvBackup.fill;
        }
        if (context.ambient && context._segmentEnvBackup.ambient != null) {
          context.ambient.intensity = context._segmentEnvBackup.ambient;
        }
        if (context.hemi && context._segmentEnvBackup.hemi != null) {
          context.hemi.intensity = context._segmentEnvBackup.hemi;
        }
        context._segmentEnvBackup = null;
        context._segmentEnvBackupApplied = false;
      }
      applySkyboxVisibility(context, skyboxEnabled, { useBlackOnDisable: true });
    }
    if (context.grid) {
      context.grid.visible = !segmentEnabled;
    }

    const ground = context.ground;
    const groundData = ground?.userData?.infiniteGround || null;
    const groundUniforms =
      ground?.material?.userData?.infiniteUniforms
      || ground?.material?.uniforms
      || null;
    const baseDistance = Number(groundData?.baseDistance);
    const groundDistance = Number.isFinite(baseDistance) && baseDistance > 0 ? baseDistance : null;
    if (groundUniforms?.uDistance && groundDistance != null) {
      groundUniforms.uDistance.value = groundDistance;
    }
    // Haze-driven fade parameters for the infinite ground. The base cutoff
    // disc is controlled by uQuadDistance and stays active even when haze is
    // disabled; here we only configure the optional fade inside that disc.
    const visStruct = state.model?.vis || null;
    const statStruct = state.model?.stat || null;
    const hazeConfig = resolveHazeConfig(visStruct, statStruct, context.bounds, hazeEnabled);
    const baseRadius =
      (groundUniforms?.uQuadDistance && Number(groundUniforms.uQuadDistance.value))
        || Number(groundData?.baseQuadDistance)
        || groundDistance
        || null;
    if (groundUniforms?.uFadePow) {
      const baseFade = Number(groundData?.baseFadePow);
      const defaultFade = Number.isFinite(baseFade) ? baseFade : 2.5;
      const powValue = hazeConfig.enabled && Number.isFinite(hazeConfig.pow)
        ? hazeConfig.pow
        : (hazeEnabled ? defaultFade : 0.0);
      groundUniforms.uFadePow.value = powValue;
    }
    if (groundUniforms) {
      if (hazeConfig.enabled && baseRadius != null && baseRadius > 0) {
        // Default ground haze: fade region is the outer 30% of the
        // visible disc. The cutoff radius is still controlled by
        // uQuadDistance; haze only shapes transparency inside it.
        const fadeEnd = baseRadius;
        const fadeStart = baseRadius * 0.7;
        if (groundUniforms.uFadeStart) groundUniforms.uFadeStart.value = fadeStart;
        if (groundUniforms.uFadeEnd) groundUniforms.uFadeEnd.value = fadeEnd;
      } else {
        // Disable haze fade while keeping the base cutoff disc active.
        if (groundUniforms.uFadeStart) groundUniforms.uFadeStart.value = 0;
        if (groundUniforms.uFadeEnd) groundUniforms.uFadeEnd.value = 0;
      }
    }
    const fogConfig = resolveFogConfig(visStruct, statStruct, context.bounds, fogEnabled);
    if (fogConfig.enabled && !fogConfig.color) {
      const presetFog = context.fallback && Number.isFinite(context.fallback.fogColor)
        ? context.fallback.fogColor
        : null;
      if (presetFog != null) {
        fogConfig.color = new THREE.Color(presetFog);
      }
    }
    const worldSceneForFog = getWorldScene(context);
    applySceneFog(worldSceneForFog, fogConfig);
    const hazeSummary = {
      mode: 'ground-fade',
      enabled: hazeEnabled && skyboxEnabled,
      reason: hazeEnabled
        ? (skyboxEnabled ? 'enabled' : 'skybox-disabled')
        : 'flag-off',
      fadePow: groundUniforms?.uFadePow?.value ?? null,
      distance: groundDistance,
      fadeStart: groundUniforms?.uFadeStart?.value ?? null,
      fadeEnd: groundUniforms?.uFadeEnd?.value ?? null,
      baseRadius: groundUniforms?.uQuadDistance?.value ?? null,
    };
    if (visStruct && !segmentEnabled) {
      const mode = state.visualSourceMode || 'model';
      const presetMode = mode === 'preset' || mode === 'preset-sun' || mode === 'preset-moon';
      if (!presetMode) {
        applyVisualLighting(context, visStruct);
      }
    }

    if (context.renderer) {
      context.renderer.shadowMap.enabled = shadowEnabled;
      if (context.renderer.shadowMap) {
        context.renderer.shadowMap.type = THREE.PCFShadowMap;
      }
    }
    if (context.light) {
      context.light.castShadow = shadowEnabled;
    }

    const hideAllGeometry = !!hideAllGeometryDefault;

    const ngeom = snapshot.ngeom | 0;
    const nextBounds = ngeom > 0 ? computeBoundsFromSnapshot(snapshot) : null;
    const trackingBounds = ngeom > 0 ? (computeBoundsFromSnapshot(snapshot, { ignoreStatic: true }) || nextBounds) : nextBounds;
    const trackingGeomSelection = Number.isFinite(state.runtime?.trackingGeom) ? (state.runtime.trackingGeom | 0) : -1;
    const trackingOverride = (() => {
      if (!(trackingGeomSelection >= 0) || !(ngeom > 0)) return null;
      if (!snapshot.xpos || trackingGeomSelection >= ngeom) return null;
      const base = trackingGeomSelection * 3;
      const px = Number(snapshot.xpos[base + 0]);
      const py = Number(snapshot.xpos[base + 1]);
      const pz = Number(snapshot.xpos[base + 2]);
      if (!Number.isFinite(px) || !Number.isFinite(py) || !Number.isFinite(pz)) return null;
      let radius = null;
      try {
        const sizeView = snapshot.gsize || null;
        const typeView = snapshot.gtype || null;
        const sx = sizeView ? Number(sizeView[base + 0]) : 0.1;
        const sy = sizeView ? Number(sizeView[base + 1]) : sx;
        const sz = sizeView ? Number(sizeView[base + 2]) : sx;
        const gType = typeView ? (typeView[trackingGeomSelection] ?? MJ_GEOM.BOX) : MJ_GEOM.BOX;
        radius = computeGeomRadius(gType, sx, sy, sz);
      } catch {}
      return {
        index: trackingGeomSelection,
        position: [px, py, pz],
        radius: Number.isFinite(radius) ? radius : null,
      };
    })();
    syncCameraPoseFromMode(
      context,
      state,
      nextBounds,
      { tempVecA, tempVecB, tempVecC, tempVecD },
      { trackingBounds, trackingOverride },
    );
    let drawn = 0;

    const hasSceneSoA =
      (snapshot?.scn_ngeom | 0) > 0 &&
      !!snapshot?.scn_type &&
      !!snapshot?.scn_pos &&
      !!snapshot?.scn_mat &&
      !!snapshot?.scn_size &&
      !!snapshot?.scn_rgba &&
      !!snapshot?.scn_matid &&
      !!snapshot?.scn_dataid &&
      !!snapshot?.scn_objtype &&
      !!snapshot?.scn_objid &&
      !!snapshot?.scn_category;

    const sizeView = snapshot.gsize || assets?.geoms?.size || null;
    const typeView = snapshot.gtype || assets?.geoms?.type || null;
    const dataIdView = snapshot.gdataid || assets?.geoms?.dataid || null;
    const matIdView = snapshot.gmatid || assets?.geoms?.matid || null;
    const bodyIdView = state?.model?.geomBodyId || null;
    // Scene-first: decor/debug visuals come from mjvScene; JS overlay builders removed.
    updateSceneLabelOverlays(context, snapshot, state, { hideAllGeometry });

    // Scene-first: base-layer rendering is driven solely by mjvScene SoA.
    // Legacy JS-side scene construction (geom/site/tendon/flex/skin) is disabled.
    if (hasSceneSoA) {
      const tSceneGeomsStart = perfEnabled ? perfNow() : 0;
      drawn = applyMjvSceneSoAGeoms(context, snapshot, state, assets, {
        sceneFlags,
        reflectionEnabled,
        hideAllGeometry,
      });
      if (perfEnabled) {
        perfSample('renderer:apply_scene_soa_ms', perfNow() - tSceneGeomsStart, {
          ngeom: snapshot?.ngeom | 0,
          scn_ngeom: snapshot?.scn_ngeom | 0,
        });
        perfMarkOnce('play:renderer:first_scene_soa_render_end');
      }
    } else {
      // No fallback: wait for scene to become available (initial frames after load).
      if (!context._missingSceneSoALogged) {
        context._missingSceneSoALogged = true;
        logDebug('[render] mjvScene SoA missing; base-layer rendering disabled until scene arrives', {
          ngeom: snapshot?.ngeom | 0,
          scn_ngeom: snapshot?.scn_ngeom | 0,
        });
      }
      drawn = 0;
      if (Array.isArray(context.meshes)) {
        for (const mesh of context.meshes) {
          if (mesh) mesh.visible = false;
        }
      }
      hideFlexGroup(context);
      hideSkinGroup(context);
    }
    context.ground = null;
    for (let i = 0; i < ngeom; i += 1) {
      const candidate = context.meshes?.[i] || null;
      if (candidate?.userData?.infinitePlane && candidate.visible) {
        context.ground = candidate;
        break;
      }
    }
    if (context.ground && Array.isArray(context.geomState)) {
      const groundIndex = context.ground.userData?.geomIndex;
      if (Number.isFinite(groundIndex)) {
        const presetMode = context._lastPresetMode === true;
        const groundPreset = presetMode ? context.fallback?.ground || null : null;
        if (groundPreset && typeof groundPreset === 'object') {
          setGeomViewProps(context, groundIndex, {
            color: groundPreset.color,
            opacity: groundPreset.opacity,
            roughness: groundPreset.roughness,
            metallic: groundPreset.metallic,
            envIntensity: groundPreset.envIntensity,
            emission: groundPreset.emission,
          });
          // Apply infinite-ground specific tuning when available.
          const infiniteCfg = groundPreset.infinite || null;
          const groundMesh = context.ground;
          const infiniteData = groundMesh?.userData?.infiniteGround || null;
          const uniforms = infiniteData?.uniforms || null;
          if (infiniteCfg && uniforms) {
            const dist = Number(infiniteCfg.distance);
            if (Number.isFinite(dist) && dist > 0) {
              if (uniforms.uDistance) uniforms.uDistance.value = dist;
              if (uniforms.uQuadDistance) uniforms.uQuadDistance.value = dist;
              if (uniforms.uFadeStart && typeof infiniteCfg.fadeStartFactor === 'number') {
                uniforms.uFadeStart.value = dist * infiniteCfg.fadeStartFactor;
              }
              if (uniforms.uFadeEnd) {
                uniforms.uFadeEnd.value = dist;
              }
            }
            if (uniforms.uFadePow && Number.isFinite(infiniteCfg.fadePow)) {
              uniforms.uFadePow.value = infiniteCfg.fadePow;
            }
            if (uniforms.uGridStep && Number.isFinite(infiniteCfg.gridStep)) {
              uniforms.uGridStep.value = infiniteCfg.gridStep;
            }
            if (uniforms.uGridIntensity && Number.isFinite(infiniteCfg.gridIntensity)) {
              uniforms.uGridIntensity.value = Math.max(0, infiniteCfg.gridIntensity);
            }
            if (uniforms.uGridColor && uniforms.uGridColor.value?.set && infiniteCfg.gridColor != null) {
              uniforms.uGridColor.value.set(infiniteCfg.gridColor);
            }
          }
        } else {
          const gs = context.geomState[groundIndex];
          if (gs && gs.view) {
            gs.view.colorOverride = null;
            gs.view.roughnessOverride = null;
            gs.view.metalnessOverride = null;
            gs.view.envMapIntensityOverride = null;
            gs.view.emissiveIntensityOverride = null;
            gs.view.__dirty = true;
          }
        }
      }
    }

    // Selection visuals now rely on mjvScene; JS-side overlays removed.

    const stats = {
      drawn,
      hidden: Math.max(0, ngeom - drawn),
      contacts: snapshot.contacts?.n ?? 0,
      t: typeof snapshot.t === 'number' ? snapshot.t : null,
      frame: ctx._frameCounter | 0,
    };
    setRenderStats(stats);
    if (Array.isArray(context.meshes)) {
      for (const mesh of context.meshes) {
        if (!mesh) continue;
        const refl = Number(mesh.userData?.reflectance) || 0;
        applyReflectanceToMaterial(mesh, context, refl, reflectionEnabled);
      }
    }

    if (context.light && context.bounds) {
      const r = Math.max(0.1, Number(context.bounds.radius) || 1);
      const cam = context.light.shadow && context.light.shadow.camera ? context.light.shadow.camera : null;
      if (cam && typeof cam.left !== 'undefined') {
        const k = 2.2;
        const l = -r * k;
        const rt = r * k;
        cam.left = l;
        cam.right = rt;
        cam.top = r * 1.6;
        cam.bottom = -r * 1.6;
        cam.near = Math.max(0.01, r * 0.03);
        cam.far = Math.max(40, r * 8);
        if (typeof cam.updateProjectionMatrix === 'function') cam.updateProjectionMatrix();
        // Texel snapping stabilization
        const mapSizeX = context.light.shadow?.mapSize?.x || 2048;
        const mapSizeY = context.light.shadow?.mapSize?.y || mapSizeX;
        const texelX = (cam.right - cam.left) / mapSizeX;
        const texelY = (cam.top - cam.bottom) / mapSizeY;
        const desiredCenter = tempVecA.set(
          context.bounds.center[0],
          context.bounds.center[1],
          context.bounds.center[2]
        );
        // Ensure matrices are up to date
        context.light.updateMatrixWorld?.(true);
        context.light.target?.updateMatrixWorld?.(true);
        cam.updateMatrixWorld?.(true);
        const toLight = desiredCenter.clone().applyMatrix4(cam.matrixWorldInverse);
        const snappedLS = toLight.clone();
        snappedLS.x = Math.round(snappedLS.x / texelX) * texelX;
        snappedLS.y = Math.round(snappedLS.y / texelY) * texelY;
        const snappedWS = snappedLS.clone().applyMatrix4(cam.matrixWorld);
        const lastC = context._shadow.lastCenter;
        const needUpdate =
          !lastC ||
          Math.abs(snappedWS.x - lastC.x) > texelX * 0.5 ||
          Math.abs(snappedWS.y - lastC.y) > texelY * 0.5 ||
          Math.abs(r - context._shadow.lastRadius) > r * 0.02;
        if (needUpdate) {
          if (context.lightTarget) {
            context.lightTarget.position.copy(snappedWS);
            context.light.target?.updateMatrixWorld?.();
          }
          context._shadow.lastCenter = snappedWS.clone();
          context._shadow.lastRadius = r;
        }
      }
    }

    const bounds = nextBounds;
    if (bounds) {
      context.bounds = bounds;
      if (
        context.currentCameraMode === 0 &&
        !context.autoAligned &&
        context.camera
      ) {
        const radius = Math.max(bounds.radius || 0, 0.6);
        const focus = tempVecA.set(bounds.center[0], bounds.center[1], bounds.center[2]);
        const offset = tempVecB.set(radius * 2.6, -radius * 2.6, radius * 1.7);
        context.camera.position.copy(focus.clone().add(offset));
        context.camera.lookAt(focus);
        context.cameraTarget.copy(focus);
        const minFar = Math.max(GROUND_DISTANCE * 2.5, 400);
        const desiredFar = Math.max(minFar, Math.max(radius, ctx.trackingRadius || radius) * 10);
        if (context.camera.far < desiredFar) {
          context.camera.far = desiredFar;
          if (typeof context.camera.updateProjectionMatrix === 'function') {
            context.camera.updateProjectionMatrix();
          }
        }
        context.autoAligned = true;
      }
      if (context.currentCameraMode === 0) {
        cacheTrackingPoseFromCurrent(context, bounds);
      }
      if (context.light) {
        const radius = Math.max(bounds.radius || 0, 0.6);
        const focus = tempVecC.set(bounds.center[0], bounds.center[1], bounds.center[2]);
        const horiz = radius * 3.0;
        const alt = Math.tan(20 * Math.PI / 180) * horiz;
        const lightOffset = tempVecD.set(horiz, -horiz * 0.9, Math.max(0.6, alt));
        // If we have a snapped center from previous step, prefer it to reduce jitter
        const baseCenter = context._shadow.lastCenter ? context._shadow.lastCenter : focus;
        context.light.position.copy(baseCenter.clone().add(lightOffset));
        if (context.lightTarget) {
          context.lightTarget.position.copy(baseCenter);
          context.light.target?.updateMatrixWorld?.();
        }
        context.envDirty = true;
      }
      if (context.hemi) {
        const radius = Math.max(bounds.radius || 0, 0.6);
        context.hemi.position.set(
          bounds.center[0],
          bounds.center[1],
          bounds.center[2] + radius * 2.8
        );
      }
    }

    const alignState = state.runtime?.lastAlign;
    if (
      context.currentCameraMode === 0 &&
      alignState &&
      alignState.seq > context.alignSeq
    ) {
      context.alignSeq = alignState.seq;
      const center = alignState.center || [0, 0, 0];
      const radius = Math.max(
        alignState.radius || 0,
        context.bounds?.radius || 0,
        0.6
      );
      const target = tempVecA.set(center[0], center[1], center[2]);
      context.camera.position.copy(
        target.clone().add(new THREE.Vector3(radius * 0.8, -radius * 0.8, radius * 0.6))
      );
      context.camera.lookAt(target);
      context.cameraTarget.copy(target);
      cacheTrackingPoseFromCurrent(context, { radius, center });
    }

    const copyState = state.runtime?.lastCopy;
    if (copyState && copyState.seq > context.copySeq) {
      context.copySeq = copyState.seq;
    }
    if (perfEnabled) {
      perfSample('renderer:renderScene_ms', perfNow() - tRenderStart, {
        ngeom: snapshot?.ngeom | 0,
        scn_ngeom: snapshot?.scn_ngeom | 0,
        drawn,
      });
      perfMarkOnce('play:renderer:first_renderScene_end');
    }
  }

  function setup() {
    initRenderer();
    return ctx;
  }

  function getContext() {
    return ctx && ctx.initialized ? ctx : null;
  }

  function dispose() {
    if (!ctx) return;
    ctx.loopActive = false;
    if (ctx.frameId != null && typeof window !== 'undefined' && window.cancelAnimationFrame) {
      try { window.cancelAnimationFrame(ctx.frameId); } catch {}
      ctx.frameId = null;
    }
    if (ctx.renderer && typeof ctx.renderer.dispose === 'function') {
      try { ctx.renderer.dispose(); } catch {}
    }
  }

  return {
    setup,
    renderScene,
    ensureRenderLoop,
    updateViewport: () => updateRendererViewport(),
    getContext,
    dispose,
  };
}


const FALLBACK_PRESETS = {
  sun: {
    // Bright daytime preset: strong directional light with moderate IBL so
    // shadows remain clearly visible.
    background: 0xdde6f4,
    // Base clear colour used when no skybox/environment is active.
    clearColor: 0xd6dce4,
    exposure: 0.5,
    ambient: { color: 0xf0f4ff, intensity: 0.1 },
    hemi: { sky: 0xf0f4ff, ground: 0x10121a, intensity: 0.18 },
    dir: {
      color: 0xffffff,
      intensity: 4,
      position: [6, -5, 4],
      target: [0, 0, 1],
      shadowBias: -0.0001,
    },
    fill: { color: 0xb6d5ff, intensity: 0.18, position: [-4, 3, 2] },
    shadowBias: -0.00015,
    // Kept deliberately low so HDRI does not wash out shadows.
    envIntensity: 0.35,
    // Preset-specific environment settings
    hdri: 'rustig_koppie_puresky_4k.hdr',
    backgroundBottom: 0x6a8bb3,
    ground: {
      style: 'shadow',
      opacity: 0.95,
      color: 0xffffff,
      metallic: 0,
      infinite: {
        distance: 2000,
        fadePow: 2.5,
        fadeStartFactor: 0.7,
        gridStep: 2.0,
        gridIntensity: 0.2,
        gridColor: 0x3a4250,
      },
    },
    overlays: {
      contactPoint: 0xff8a2b,
      contactForce: 0x4d7cfe,
      selectPoint: 0xff8a2b,
      selectionHighlight: 0x40ff99,
      selectionOverlay: 0x66ffcc,
      perturbRing: 0xff8a2b,
      perturbArrow: 0xffb366,
    },
    fogColor: 0xb3bfd9,
  },
  moon: {
    // Night preset: darker exposure and very weak IBL so forms are defined
    // mostly by a single moon-like directional light.
    background: 0x02030a,
    // Base clear colour for night preset when no skybox/environment is active.
    clearColor: 0x02030a,
    exposure: 0.5,
    ambient: { color: 0xf0f4ff, intensity: 0.2 },
    hemi: { sky: 0x22273a, ground: 0x02030a, intensity: 0.05 },
    dir: {
      color: 0xffffff,
      intensity: 2,
      position: [-2, 3, -1.5],
      target: [0, 1, 1],
      shadowBias: -0.0001,
    },
    fill: { color: 0x182030, intensity: 0.14, position: [-1.5, 1.5, 1] },
    shadowBias: -0.0002,
    envIntensity: 0.08,
    hdri: 'starmap_random_2020_4k_rot.exr',
    backgroundBottom: 0x02030a,
    ground: {
      style: 'shadow',
      opacity: 0.25,
      color: 0xffffff,
      infinite: {
        distance: 2000,
        fadePow: 2.5,
        fadeStartFactor: 0.7,
        gridStep: 2.0,
        gridIntensity: 0.18,
        gridColor: 0x2a2f3c,
      },
    },
    overlays: {
      contactPoint: 0xff8a2b,
      contactForce: 0x4d7cfe,
      selectPoint: 0xff8a2b,
      selectionHighlight: 0x40ff99,
      selectionOverlay: 0x66ffcc,
      perturbRing: 0xff8a2b,
      perturbArrow: 0xffb366,
    },
    fogColor: 0x243040,
  },
};

const FALLBACK_PRESET_ALIASES = {
  'bright-outdoor': 'sun',
  bright: 'sun',
  outdoor: 'sun',
};

const SKY_MODE_NONE = 'none';
const SKY_MODE_PRESET = 'preset-hdri';
const SKY_MODE_MODEL = 'mj-sky';

function ensureSkyCache(ctx) {
  if (!ctx) return null;
  if (!ctx.skyCache) {
    ctx.skyCache = {
      preset: null,
      model: null,
      none: null,
    };
  }
  return ctx.skyCache;
}

function hasModelEnvironment(state) {
  const env = state?.rendering?.environment;
  if (!env) return false;
  if (env.hdr || env.texture || env.color) return true;
  if (Array.isArray(env.sources) && env.sources.length > 0) return true;
  return false;
}

function hasModelLights(state) {
  const lights = state?.rendering?.lights;
  return Array.isArray(lights) && lights.length > 0;
}

function hasModelBackground(state) {
  const bg = state?.rendering?.background;
  if (!bg) return false;
  return bg.color != null || !!bg.texture;
}

function pushSkyDebug(ctx, payload) {
  try {
    const log = ctx?._skyDebug || (ctx._skyDebug = []);
    log.push({ ts: Date.now(), source: 'env', ...payload });
    if (log.length > 40) log.shift();
    if (typeof window !== 'undefined') {
      window.__skyDebug = log;
    }
  } catch {}
}

function detachEnvironment(ctx) {
  const worldScene = getWorldScene(ctx);
  if (worldScene) {
    worldScene.environment = null;
    worldScene.background = null;
  }
  if (ctx.skyShader) ctx.skyShader.visible = false;
  ctx.envIntensity = 0;
  ctx.skyMode = null;
  ctx.skyBackground = null;
  ctx.skyCube = null;
}

function ensureModelGradientEnv(ctx, THREE_NS) {
  const worldScene = getWorldScene(ctx);
  if (!ctx || !ctx.renderer || !worldScene) return null;
  const cache = ensureSkyCache(ctx);
  const cached = cache?.model;
  if (cached?.envRT && cached.background) {
    worldScene.environment = cached.envRT.texture || null;
    worldScene.background = cached.background;
    ctx.envRT = cached.envRT;
    ctx.envIntensity = 1.0;
    ctx.envFromHDRI = false;
    ctx.hdriReady = false;
    ctx.envDirty = false;
    return cached;
  }
  if (!ctx.pmrem) {
    ctx.pmrem = new THREE_NS.PMREMGenerator(ctx.renderer);
  }
  // Use a lightweight gradient as a MuJoCo-like clear sky
  // MuJoCo builtin gradient defaults: rgb1=[0.6,0.8,1], rgb2=[0,0,0]
  const gradTex = createVerticalGradientTexture(THREE_NS, 0x99ccff, 0x000000, 256);
  const envRT = ctx.pmrem.fromEquirectangular(gradTex);
  worldScene.background = gradTex;
  worldScene.environment = envRT?.texture || null;
  ctx.envRT = envRT;
  ctx.envIntensity = 1.0;
  ctx.skyBackground = gradTex;
  ctx.skyMode = 'cube';
  if (ctx.skyShader) ctx.skyShader.visible = false;
  ctx.skyCube = null;
  ctx.envFromHDRI = false;
  ctx.hdriReady = false;
  ctx.envDirty = false;
  if (cache) {
    cache.model = {
      key: 'model-gradient',
      envRT,
      background: gradTex,
      kind: 'gradient',
    };
  }
  return cache?.model || null;
}

let LAST_SKYBOX_TEXTURE = null;
let LAST_SKYBOX_KEY = null;
let LAST_SKYBOX_BUFFER = null;
let WARNED_SKYBOX_BYTES = false;

function readSkyboxTextureFromAssets(state) {
  const textures = state?.rendering?.assets?.textures || null;
  if (!textures || !textures.type || !textures.data) {
    return LAST_SKYBOX_TEXTURE;
  }
  const typeArr = textures.type;
  const adrArr = textures.adr;
  const widthArr = textures.width;
  const heightArr = textures.height;
  const nchanArr = textures.nchannel;
  const data = textures.data;
  const dataLen = typeof data.length === 'number'
    ? data.length
    : (typeof data.byteLength === 'number' ? data.byteLength : 0);
  const count = Array.isArray(typeArr) ? typeArr.length : (typeArr?.length ?? 0);
  for (let i = 0; i < count; i += 1) {
    const t = typeArr[i] ?? 0;
    // MuJoCo: mjtTexture type 2 is skybox (cube)
    if (t !== 2) continue;
    const width = Number(widthArr?.[i]) || 0;
    const height = Number(heightArr?.[i]) || 0;
    const nchan = Number(nchanArr?.[i]) || 0;
    const adr = Number(adrArr?.[i]) || 0;
    if (!(width > 0 && height > 0 && nchan > 0)) continue;
    const texSize = width * height * nchan;
    const nextAdr = i + 1 < count ? Number(adrArr?.[i + 1]) || texSize + adr : texSize + adr;
    const end = Math.min(dataLen, nextAdr);
    const start = Math.max(0, adr);
    if (!(end > start)) continue;
    const hasSAB = typeof SharedArrayBuffer !== 'undefined';
    const src = (data instanceof ArrayBuffer || (hasSAB && data instanceof SharedArrayBuffer))
      ? new Uint8Array(data)
      : data;
    const srcBuffer = (src instanceof ArrayBuffer || (hasSAB && src instanceof SharedArrayBuffer))
      ? src
      : ((src?.buffer instanceof ArrayBuffer || (hasSAB && src?.buffer instanceof SharedArrayBuffer)) ? src.buffer : null);
    if (!srcBuffer) continue;
    const bytesPerElement = src?.BYTES_PER_ELEMENT || 1;
    const baseOffset = src?.byteOffset || 0;
    const byteOffset = baseOffset + start * bytesPerElement;
    const byteLength = (end - start) * bytesPerElement;
    // Prevent runaway allocations for oversized skyboxes. The renderer will
    // fall back to a lightweight gradient environment if we skip this.
    const maxBytes = 128 * 1024 * 1024;
    if (byteLength > maxBytes) {
      if (!WARNED_SKYBOX_BYTES) {
        WARNED_SKYBOX_BYTES = true;
        logWarn('[viewer][skybox] skipping oversized skybox texture', {
          width,
          height,
          nchan,
          byteLength,
          maxBytes,
        });
      }
      return LAST_SKYBOX_TEXTURE;
    }
    const key = `${width}x${height}x${nchan}:${byteOffset}:${byteLength}`;
    if (LAST_SKYBOX_TEXTURE && LAST_SKYBOX_KEY === key && LAST_SKYBOX_BUFFER === srcBuffer) {
      return LAST_SKYBOX_TEXTURE;
    }
    // Keep a view into the latest assets buffer. Copying this data every frame
    // can OOM for high-res skyboxes; holding a view keeps memory stable.
    const uint8 = new Uint8Array(srcBuffer, byteOffset, byteLength);
    const tex = {
      width,
      height,
      nchan,
      data: uint8,
      adr,
    };
    LAST_SKYBOX_TEXTURE = tex;
    LAST_SKYBOX_KEY = key;
    LAST_SKYBOX_BUFFER = srcBuffer;
    return tex;
  }
  return LAST_SKYBOX_TEXTURE;
}

function createCubeTextureFromSkybox(THREE_NS, skyTex) {
  if (!skyTex || !THREE_NS || !skyTex.data) return null;
  const { width, height, nchan, data } = skyTex;
  if (!(width > 0 && height > 0 && nchan > 0)) return null;
  const faces = 6;
  if (height !== width * faces) return null;
  const faceSize = width * width * nchan;
  if (data.length < faceSize * faces) return null;
  const type = THREE_NS.UnsignedByteType;
  const images = [];
  for (let i = 0; i < faces; i += 1) {
    const start = i * faceSize;
    const end = start + faceSize;
    const faceData = data.subarray(start, end);
    // three@0.161 is strict about pixel formats; keep uploads robust by
    // expanding to RGBA on the JS side when the MuJoCo skybox is RGB/gray.
    let rgba = faceData;
    if (nchan !== 4) {
      const out = new Uint8Array(width * width * 4);
      if (nchan === 3) {
        for (let px = 0, srcIdx = 0; px < width * width; px += 1, srcIdx += 3) {
          const dst = px * 4;
          out[dst + 0] = faceData[srcIdx + 0] ?? 0;
          out[dst + 1] = faceData[srcIdx + 1] ?? 0;
          out[dst + 2] = faceData[srcIdx + 2] ?? 0;
          out[dst + 3] = 255;
        }
      } else if (nchan === 2) {
        for (let px = 0, srcIdx = 0; px < width * width; px += 1, srcIdx += 2) {
          const dst = px * 4;
          const lum = faceData[srcIdx + 0] ?? 0;
          out[dst + 0] = lum;
          out[dst + 1] = lum;
          out[dst + 2] = lum;
          out[dst + 3] = faceData[srcIdx + 1] ?? 255;
        }
      } else if (nchan === 1) {
        for (let px = 0; px < width * width; px += 1) {
          const dst = px * 4;
          const lum = faceData[px] ?? 0;
          out[dst + 0] = lum;
          out[dst + 1] = lum;
          out[dst + 2] = lum;
          out[dst + 3] = 255;
        }
      } else {
        for (let dst = 0; dst < out.length; dst += 4) {
          out[dst + 3] = 255;
        }
      }
      rgba = out;
    }
    const tex = new THREE_NS.DataTexture(rgba, width, width, THREE_NS.RGBAFormat, type);
    tex.needsUpdate = true;
    tex.generateMipmaps = false;
    tex.minFilter = THREE_NS.LinearFilter;
    tex.magFilter = THREE_NS.LinearFilter;
    tex.unpackAlignment = 1;
    tex.colorSpace = THREE_NS.SRGBColorSpace || THREE_NS.LinearSRGBColorSpace || undefined;
    images.push(tex);
  }
  const cube = new THREE_NS.CubeTexture(images);
  cube.needsUpdate = true;
  cube.colorSpace = THREE_NS.SRGBColorSpace || THREE_NS.LinearSRGBColorSpace || undefined;
  cube.generateMipmaps = false;
  cube.minFilter = THREE_NS.LinearFilter;
  cube.magFilter = THREE_NS.LinearFilter;
  cube.mapping = THREE_NS.CubeReflectionMapping;
  return cube;
}

function ensureModelSkyFromAssets(ctx, state, THREE_NS, options = {}) {
  const cache = ensureSkyCache(ctx);
  const worldScene = getWorldScene(ctx);
  if (!ctx || !worldScene || !THREE_NS) return false;
  const skyDebugMode = typeof options.skyDebugMode === 'string'
    ? options.skyDebugMode
    : (ctx.skyDebugMode || null);
  const forceCube = skyDebugMode === 'cube' || skyDebugMode === 'off';
  const forceShader = skyDebugMode === 'mj-sky-shader' || skyDebugMode === 'shader';
  const cachedModel = cache?.model;

  if (!forceCube && cachedModel?.envRT && cachedModel?.background && cachedModel.kind === 'shader') {
    const dome = ensureSkyDome(ctx, THREE_NS);
    updateSkyDome(ctx, cachedModel.palette || null, THREE_NS);
    if (dome) dome.visible = true;
    worldScene.environment = cachedModel.envRT.texture || null;
    worldScene.background = cachedModel.background;
    ctx.envRT = cachedModel.envRT;
    ctx.envIntensity = 1.0;
    ctx.skyBackground = cachedModel.background;
    ctx.skyMode = 'shader';
    ctx.skyPalette = cachedModel.palette || null;
    ctx.skyCube = cachedModel.cube || null;
    ctx.envFromHDRI = false;
    ctx.hdriReady = false;
    ctx.envDirty = false;
    pushSkyDebug(ctx, { mode: 'model-sky-shader-cache', stats: cachedModel.stats || null });
    return true;
  }
  if (!forceShader && cachedModel?.envRT && cachedModel?.cube && cachedModel.kind === 'cube') {
    worldScene.environment = cachedModel.envRT.texture || null;
    worldScene.background = cachedModel.cube;
    if (ctx.skyShader) ctx.skyShader.visible = false;
    ctx.envRT = cachedModel.envRT;
    ctx.envIntensity = 1.0;
    ctx.skyBackground = cachedModel.cube;
    ctx.skyMode = 'cube';
    ctx.skyCube = cachedModel.cube;
    ctx.envFromHDRI = false;
    ctx.hdriReady = false;
    ctx.envDirty = false;
    pushSkyDebug(ctx, { mode: 'model-sky-cube-cache', stats: cachedModel.stats || null });
    return true;
  }

  const skyTex = readSkyboxTextureFromAssets(state);
  if (!skyTex) return false;
  if (!ctx.pmrem && ctx.renderer) {
    ctx.pmrem = new THREE_NS.PMREMGenerator(ctx.renderer);
  }
  if (!ctx.pmrem) return false;
  const classification = classifySkyboxTexture(THREE_NS, skyTex);
  const palette = classification.palette || extractMjSkyPalette(THREE_NS, skyTex) || {
    zenith: new THREE_NS.Color(0.6, 0.8, 1),
    horizon: new THREE_NS.Color(0.45, 0.6, 0.8),
    ground: new THREE_NS.Color(0.12, 0.16, 0.22),
    brightness: 0.72,
  };
  const useShader = !forceCube && (forceShader || classification.kind === 'builtin');
  const cube = useShader ? null : createCubeTextureFromSkybox(THREE_NS, skyTex);
  if (!cube && !useShader) return false;
  const envRT = cube && ctx.pmrem ? ctx.pmrem.fromCubemap(cube) : null;

  if (useShader) {
    const dome = ensureSkyDome(ctx, THREE_NS);
    const background = buildSkyBackground(THREE_NS, palette);
    const shaderEnvRT = ctx.pmrem ? ctx.pmrem.fromEquirectangular(background) : null;
    updateSkyDome(ctx, palette, THREE_NS);
    if (dome) dome.visible = true;
    if (worldScene) {
      worldScene.environment = shaderEnvRT?.texture || null;
      worldScene.background = background;
    }
    ctx.envRT = shaderEnvRT || null;
    ctx.envIntensity = 1.0;
    ctx.skyBackground = background;
    ctx.skyMode = 'shader';
    ctx.skyPalette = palette;
    ctx.skyCube = cube || null;
    ctx.envFromHDRI = false;
    ctx.hdriReady = false;
    ctx.envDirty = false;
    ctx.skyInit = true;
    if (cache) {
      cache.model = {
        key: 'model-skybox',
        envRT: shaderEnvRT,
        cube,
        background,
        palette,
        kind: 'shader',
        stats: classification.stats || null,
      };
    }
    pushSkyDebug(ctx, {
      mode: 'model-sky-shader',
      forced: skyDebugMode || null,
      stats: classification.stats || null,
    });
    return true;
  }

  const envTexture = envRT?.texture || null;
  if (worldScene) {
    worldScene.environment = envTexture;
    worldScene.background = cube;
  }
  if (ctx.skyShader) ctx.skyShader.visible = false;
  ctx.envRT = envRT;
  ctx.envIntensity = 1.0;
  ctx.skyBackground = cube;
  ctx.skyMode = 'cube';
  ctx.skyCube = cube;
  ctx.envFromHDRI = false;
  ctx.hdriReady = false;
  ctx.envDirty = false;
  ctx.skyInit = true;
  if (cache) {
    cache.model = {
      key: 'model-skybox',
      envRT,
      cube,
      kind: 'cube',
      stats: classification.stats || null,
    };
  }
  pushSkyDebug(ctx, {
    mode: 'model-sky-cube',
    forced: skyDebugMode || null,
    stats: classification.stats || null,
  });
  return true;
}

function disposeEnvResources(ctx, { resetFlags = true } = {}) {
  const worldScene = getWorldScene(ctx);
  if (worldScene && ctx.envRT && worldScene.environment === ctx.envRT.texture) {
    worldScene.environment = null;
  }
  if (worldScene && ctx.hdriBackground && worldScene.background === ctx.hdriBackground) {
    worldScene.background = null;
  }
  try { ctx.envRT?.dispose?.(); } catch {}
  try { ctx.hdriBackground?.dispose?.(); } catch {}
  ctx.envRT = null;
  ctx.hdriBackground = null;
  if (resetFlags) {
    ctx.envFromHDRI = false;
    ctx.hdriReady = false;
    ctx.hdriLoading = false;
    ctx.hdriLoadPromise = null;
    ctx.hdriLoadGen = ctx.hdriLoadGen || 0;
  }
}

function createVerticalGradientTexture(THREE_NS, topHex, bottomHex, height = 256) {
  const width = 2;
  const h = Math.max(8, height | 0);
  const data = new Uint8Array(width * h * 4);
  const top = new THREE_NS.Color(topHex);
  const bot = new THREE_NS.Color(bottomHex);
  for (let y = 0; y < h; y += 1) {
    const t = y / (h - 1);
    const r = bot.r * t + top.r * (1 - t);
    const g = bot.g * t + top.g * (1 - t);
    const b = bot.b * t + top.b * (1 - t);
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      data[i + 0] = Math.round(r * 255);
      data[i + 1] = Math.round(g * 255);
      data[i + 2] = Math.round(b * 255);
      data[i + 3] = 255;
    }
  }
  const tex = new THREE_NS.DataTexture(data, width, h);
  tex.needsUpdate = true;
  tex.magFilter = THREE_NS.LinearFilter;
  tex.minFilter = THREE_NS.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.colorSpace = THREE_NS.SRGBColorSpace;
  return tex;
}


function colorL1(a, b) {
  if (!a || !b) return 0;
  return Math.abs((a[0] ?? 0) - (b[0] ?? 0))
    + Math.abs((a[1] ?? 0) - (b[1] ?? 0))
    + Math.abs((a[2] ?? 0) - (b[2] ?? 0));
}

function computeRowVariance(skyTex, faceIndex, row, step = 1) {
  const { width, nchan, data } = skyTex;
  const faces = Math.max(1, Math.floor(skyTex.height / width));
  if (faceIndex < 0 || faceIndex >= faces) return 0;
  const faceSize = width * width * nchan;
  const base = faceIndex * faceSize;
  const r = Math.max(0, Math.min(width - 1, Math.floor(row)));
  const stride = Math.max(1, Math.floor(step) || 1);
  let mean = [0, 0, 0];
  let count = 0;
  for (let x = 0; x < width; x += stride) {
    const idx = base + (r * width + x) * nchan;
    if (idx + 2 >= data.length) break;
    mean[0] += data[idx + 0] || 0;
    mean[1] += data[idx + 1] || 0;
    mean[2] += data[idx + 2] || 0;
    count += 1;
  }
  if (count === 0) return 0;
  mean = mean.map((v) => v / count);
  let varSum = 0;
  for (let x = 0; x < width; x += stride) {
    const idx = base + (r * width + x) * nchan;
    if (idx + 2 >= data.length) break;
    varSum += Math.abs((data[idx + 0] || 0) - mean[0]);
    varSum += Math.abs((data[idx + 1] || 0) - mean[1]);
    varSum += Math.abs((data[idx + 2] || 0) - mean[2]);
  }
  const inv = 1 / (count * 255);
  return varSum * inv;
}

function sampleFaceBand(skyTex, faceIndex, rowStart, rowEnd, step = 1) {
  const { width, nchan, data } = skyTex;
  const faces = Math.max(1, Math.floor(skyTex.height / width));
  if (faceIndex < 0 || faceIndex >= faces) return [0.5, 0.5, 0.5];
  const faceSize = width * width * nchan;
  const base = faceIndex * faceSize;
  const startRow = Math.max(0, Math.min(width, Math.floor(rowStart)));
  const endRow = Math.max(startRow + 1, Math.min(width, Math.floor(rowEnd)));
  const stride = Math.max(1, Math.floor(step) || 1);
  let sumR = 0;
  let sumG = 0;
  let sumB = 0;
  let count = 0;
  for (let y = startRow; y < endRow; y += stride) {
    const rowBase = base + y * width * nchan;
    for (let x = 0; x < width; x += stride) {
      const idx = rowBase + x * nchan;
      if (idx + 2 >= data.length) break;
      sumR += data[idx + 0] || 0;
      sumG += data[idx + 1] || 0;
      sumB += data[idx + 2] || 0;
      count += 1;
    }
  }
  if (count === 0) return [0.5, 0.5, 0.5];
  const inv = 1 / (count * 255);
  return [sumR * inv, sumG * inv, sumB * inv].map(clamp01);
}

function extractMjSkyPalette(THREE_NS, skyTex) {
  if (!skyTex || !skyTex.data || !THREE_NS) return null;
  const { width, height, nchan } = skyTex;
  if (!(width > 0 && height >= width && nchan >= 3)) return null;
  const faces = Math.max(1, Math.floor(height / width));
  const step = Math.max(1, Math.floor(width / 64));
  const top = sampleFaceBand(skyTex, 0, 0, Math.max(2, Math.floor(width * 0.16)), step);
  const horizon = sampleFaceBand(skyTex, 0, Math.floor(width * 0.45), Math.floor(width * 0.62), step);
  const ground = sampleFaceBand(skyTex, 0, Math.floor(width * 0.78), width, step);
  const toColor = (arr, fallback) => {
    const [r, g, b] = Array.isArray(arr) && arr.length >= 3 ? arr : fallback || [0.5, 0.6, 0.8];
    return new THREE_NS.Color().setRGB(clamp01(r), clamp01(g), clamp01(b));
  };
  const zenith = toColor(top, [0.6, 0.8, 1]);
  const horizonColor = toColor(horizon, [0.45, 0.6, 0.8]);
  const groundColor = toColor(ground, [0.08, 0.11, 0.18]);
  const brightness = clamp01((horizon[0] + horizon[1] + horizon[2]) / 3);
  return {
    zenith,
    horizon: horizonColor,
    ground: groundColor,
    brightness,
    samples: { top, horizon, ground },
    faces,
  };
}

function classifySkyboxTexture(THREE_NS, skyTex) {
  if (!skyTex || !skyTex.data) return { kind: 'unknown', palette: null, stats: null };
  const { width, height, nchan, data } = skyTex;
  if (!(width > 0 && height > 0 && nchan >= 3)) {
    return { kind: 'unknown', palette: null, stats: null };
  }
  const faces = Math.min(6, Math.max(1, Math.floor(height / width)));
  const faceSize = width * width * nchan;
  const step = Math.max(1, Math.floor(width / 64));
  const faceMeans = [];
  for (let i = 0; i < faces; i += 1) {
    const base = i * faceSize;
    if (base + nchan >= data.length) break;
    faceMeans.push(sampleFaceBand(skyTex, i, 0, width, step));
  }
  let maxFaceDiff = 0;
  for (let i = 0; i < faceMeans.length; i += 1) {
    for (let j = i + 1; j < faceMeans.length; j += 1) {
      maxFaceDiff = Math.max(maxFaceDiff, colorL1(faceMeans[i], faceMeans[j]));
    }
  }
  const palette = extractMjSkyPalette(THREE_NS, skyTex);
  const gradMag = palette?.samples
    ? colorL1(palette.samples.top, palette.samples.ground)
    : 0;
  const uniformFaces = maxFaceDiff < 0.35;
  const rowVar = computeRowVariance(skyTex, 0, width * 0.5, Math.max(1, Math.floor(width / 64)));
  const gradientLike = gradMag > 0.2 && rowVar < 0.02;
  const likelyBuiltin = faces === 6 && (uniformFaces || gradientLike);
  return {
    kind: likelyBuiltin ? 'builtin' : 'file',
    palette,
    stats: {
      faces: faceMeans.length,
      maxFaceDiff,
      gradientMag: gradMag,
      uniformFaces,
      rowVar,
    },
  };
}

function createSkyShaderMaterial(THREE_NS) {
  const uniforms = {
    uZenithColor: { value: new THREE_NS.Color(0.6, 0.8, 1.0) },
    uHorizonColor: { value: new THREE_NS.Color(0.45, 0.6, 0.8) },
    uGroundColor: { value: new THREE_NS.Color(0.08, 0.11, 0.18) },
    uSunDirection: { value: new THREE_NS.Vector3(0.15, 0.35, 0.92) },
    uExposure: { value: 1.0 },
    uGradientPower: { value: 1.1 },
    uHorizonSharpness: { value: 0.6 },
    uEffectStrength: { value: 0.25 },
    uBaseAlpha: { value: 0.04 },
  };
  const vertexShader = `
    varying vec3 vWorldDirection;
    void main() {
      vec4 worldPos = modelMatrix * vec4(position, 1.0);
      vWorldDirection = normalize(worldPos.xyz - cameraPosition);
      gl_Position = projectionMatrix * viewMatrix * worldPos;
    }
  `;
  const fragmentShader = `
    varying vec3 vWorldDirection;
    uniform vec3 uZenithColor;
    uniform vec3 uHorizonColor;
    uniform vec3 uGroundColor;
    uniform vec3 uSunDirection;
    uniform float uExposure;
    uniform float uGradientPower;
    uniform float uHorizonSharpness;
    uniform float uEffectStrength;
    uniform float uBaseAlpha;

    float remapUp(float v) {
      return clamp(v * 0.5 + 0.5, 0.0, 1.0);
    }

    void main() {
      vec3 dir = normalize(vWorldDirection);
      float up = remapUp(dir.z);
      float grad = pow(clamp(up, 0.0, 1.0), uGradientPower);
      // Base vertical gradient between ground and zenith; keep this as close
      // as possible to the MuJoCo strip-derived colors. Horizon color is not
      // mixed into the base so that non-solar regions visually match the
      // underlying gradient/background.
      vec3 base = mix(uGroundColor, uZenithColor, grad);

      // Localised sun highlight; keep most of the sky close to the base gradient
      vec3 sunDir = normalize(uSunDirection);
      float sunAmount = max(dot(sunDir, dir), 0.0);

      // --- Anisotropic halo shape: vertical streak broader than horizontal ---
      vec3 sunHoriz = normalize(vec3(sunDir.x, sunDir.y, 0.0));
      vec3 dirHoriz = normalize(vec3(dir.x, dir.y, 0.0));
      float horizDot = dot(sunHoriz, dirHoriz);
      if (!all(greaterThan(vec3(length(sunHoriz)), vec3(1e-4)))) {
        horizDot = 1.0;
      }
      horizDot = clamp(horizDot, -1.0, 1.0);
      // Horizontal: keep relatively tight around sun azimuth
      float horizMask = smoothstep(0.92, 0.99, horizDot);

      float sunUp = remapUp(sunDir.z);
      float upDiff = abs(up - sunUp);
      // Vertical: allow a noticeably wider band to create a streak
      float vertMask = smoothstep(0.9, -0.05, upDiff);

      float shapeMask = clamp(horizMask * vertMask, 0.0, 1.0);

      // Radial falloff for core and halo
      // - core: sharper highlight very close to the sun
      // - halo: slower decay so the influence extends further but remains subtle
      float glow = pow(sunAmount, 12.0);
      float halo = pow(sunAmount, 1.5);

      // Blend towards brighter/whiter near the sun, but keep base colour visible
      vec3 glowColor = mix(base, vec3(1.0), 0.6);
      vec3 haloColor = mix(base, uZenithColor, 0.4);

      float intensity = uEffectStrength * shapeMask;
      vec3 color = base
        + glowColor * glow * intensity
        + haloColor * halo * (intensity * 0.4);

      // Simple exposure; keep contrast and saturation
      color *= uExposure;
      color = clamp(color, 0.0, 1.0);

      // Angle-dependent alpha: far from the sun we are almost transparent,
      // near the sun we blend in more strongly (matching the halo radius).
      float alphaSun = clamp(intensity + intensity * 0.4 * halo, 0.0, 1.0);
      float alpha = clamp(uBaseAlpha + alphaSun, 0.0, 1.0);
      gl_FragColor = vec4(color, alpha);
    }
  `;
  const material = new THREE_NS.ShaderMaterial({
    uniforms,
    vertexShader,
    fragmentShader,
    side: THREE_NS.BackSide,
    depthWrite: false,
    depthTest: false,
    fog: false,
    toneMapped: false,
    transparent: true,
    blending: THREE_NS.NormalBlending,
  });
  return material;
}

function ensureSkyDome(ctx, THREE_NS) {
  const worldScene = getWorldScene(ctx);
  if (!ctx || !THREE_NS || !worldScene) return null;
  if (ctx.skyShader && ctx.skyShader.material && ctx.skyShader.geometry) return ctx.skyShader;
  const geometry = new THREE_NS.SphereGeometry(1, 48, 32);
  const material = createSkyShaderMaterial(THREE_NS);
  const dome = new THREE_NS.Mesh(geometry, material);
  dome.name = 'mj_sky_shader';
  dome.frustumCulled = false;
  dome.renderOrder = -100;
  worldScene.add(dome);
  ctx.skyShader = dome;
  return dome;
}

function updateSkyDome(ctx, palette, THREE_NS) {
  if (!ctx?.skyShader || !palette) return;
  const mat = ctx.skyShader.material;
  if (!mat || !mat.uniforms) return;
  if (palette.zenith) mat.uniforms.uZenithColor.value.copy(palette.zenith);
  if (palette.horizon) mat.uniforms.uHorizonColor.value.copy(palette.horizon);
  if (palette.ground) mat.uniforms.uGroundColor.value.copy(palette.ground);
  const brightness = clamp01(palette.brightness ?? 0.7);
  // Keep exposure very close to 1 so we stay near the underlying gradient
  mat.uniforms.uExposure.value = 0.95 + brightness * 0.1;          // ~[0.95, 1.05]
  // Gentle tweak of gradient steepness
  mat.uniforms.uGradientPower.value = 1.0 + (0.5 - brightness) * 0.2;
  // Horizon sharpness: dimmer skies get a slightly stronger band, still subtle
  mat.uniforms.uHorizonSharpness.value = 0.5 + (1.0 - brightness) * 0.2;
  // Effect and base alpha: keep very subtle by default; uBaseAlpha can be
  // driven lower if we want the sky layer to be almost invisible away from
  // the sun direction.
  if (mat.uniforms.uEffectStrength) {
    mat.uniforms.uEffectStrength.value = 0.25;
  }
  if (mat.uniforms.uBaseAlpha) {
    mat.uniforms.uBaseAlpha.value = 0.03;
  }
  if (ctx.light) {
    const sun = ctx.light.position.clone().normalize();
    mat.uniforms.uSunDirection.value.copy(sun);
  }
  mat.needsUpdate = true;
  const worldScene = getWorldScene(ctx);
  const far = ctx?.camera && Number.isFinite(ctx.camera.far) && ctx.camera.far > 0 ? ctx.camera.far : 1000;
  const radius = Math.max(50, Math.min(far * 0.9, 120000));
  try { ctx.skyShader.scale.setScalar(radius); } catch {}
  if (worldScene && !ctx.skyShader.parent) {
    worldScene.add(ctx.skyShader);
  }
}

function buildSkyBackground(THREE_NS, palette) {
  const top = palette?.zenith ? palette.zenith.getHex() : 0x99ccff;
  const bottom = palette?.ground ? palette.ground.getHex() : 0x0b1018;
  return createVerticalGradientTexture(THREE_NS, top, bottom, 96);
}

function isPresetMode(state) {
  const mode = state?.visualSourceMode;
  return mode === 'preset-sun' || mode === 'preset-moon';
}

function currentPresetKeyFromState(state) {
  const mode = state?.visualSourceMode;
  if (mode === 'preset-moon') return 'moon';
  if (mode === 'preset-sun') return 'sun';
  // Default to sun when not in an explicit preset mode.
  return 'sun';
}

function ensureBaseLightingCache(ctx) {
  if (!ctx) return;
  if (!ctx._baseLighting) {
    ctx._baseLighting = {
      exposure: ctx.renderer ? ctx.renderer.toneMappingExposure : null,
      ambientIntensity: ctx.ambient ? ctx.ambient.intensity : null,
      ambientColor: ctx.ambient ? ctx.ambient.color.clone() : null,
      hemiIntensity: ctx.hemi ? ctx.hemi.intensity : null,
      hemiSky: ctx.hemi ? ctx.hemi.color.clone() : null,
      hemiGround: ctx.hemi ? ctx.hemi.groundColor.clone() : null,
      lightIntensity: ctx.light ? ctx.light.intensity : null,
      lightColor: ctx.light ? ctx.light.color.clone() : null,
      lightPosition: ctx.light ? ctx.light.position.clone() : null,
      lightTargetPosition: ctx.lightTarget ? ctx.lightTarget.position.clone() : null,
      fillIntensity: ctx.fill ? ctx.fill.intensity : null,
      fillColor: ctx.fill ? ctx.fill.color.clone() : null,
      fillPosition: ctx.fill ? ctx.fill.position.clone() : null,
    };
  }
}

function restoreBaseLighting(ctx) {
  if (!ctx || !ctx._baseLighting) return;
  const base = ctx._baseLighting;
  if (ctx.renderer && base.exposure != null) {
    ctx.renderer.toneMappingExposure = base.exposure;
  }
  if (ctx.ambient) {
    if (base.ambientIntensity != null) ctx.ambient.intensity = base.ambientIntensity;
    if (base.ambientColor) ctx.ambient.color.copy(base.ambientColor);
  }
  if (ctx.hemi) {
    if (base.hemiIntensity != null) ctx.hemi.intensity = base.hemiIntensity;
    if (base.hemiSky) ctx.hemi.color.copy(base.hemiSky);
    if (base.hemiGround) ctx.hemi.groundColor.copy(base.hemiGround);
  }
  if (ctx.light) {
    if (base.lightIntensity != null) ctx.light.intensity = base.lightIntensity;
    if (base.lightColor) ctx.light.color.copy(base.lightColor);
    if (base.lightPosition) ctx.light.position.copy(base.lightPosition);
  }
  if (ctx.lightTarget && base.lightTargetPosition) {
    ctx.lightTarget.position.copy(base.lightTargetPosition);
    ctx.light.target?.updateMatrixWorld?.();
  }
  if (ctx.fill) {
    if (base.fillIntensity != null) ctx.fill.intensity = base.fillIntensity;
    if (base.fillColor) ctx.fill.color.copy(base.fillColor);
    if (base.fillPosition) ctx.fill.position.copy(base.fillPosition);
  }
}

function createEnvironmentManager({
  THREE_NS,
  store,
  skyOffParam,
  fallbackEnabledDefault,
  skyDebugModeParam,
}) {
  function ensureOutdoorSkyEnv(ctx, preset, generation = null, options = {}) {
    const worldScene = getWorldScene(ctx);
    if (!ctx || !ctx.renderer || !worldScene) return;
    const cache = ensureSkyCache(ctx);
    if (typeof skyOffParam !== 'undefined' && skyOffParam) {
      return;
    }
    if (ctx.hdriFailed) {
      return;
    }
    const hdriGen = typeof generation === 'number' ? generation : (ctx.hdriLoadGen ?? 0);
    if (!ctx.pmrem) {
      ctx.pmrem = new THREE_NS.PMREMGenerator(ctx.renderer);
    }
    const allowHDRI = options.allowHDRI !== false;
    // Decide which preset HDRI to use based on viewer state and preset config:
    // - preset.hdri (if provided) has priority
    // - otherwise fall back to built-in sun/moon mapping
    const state = store && typeof store.get === 'function' ? store.get() : null;
    const visualPresetKey = currentPresetKeyFromState(state);
    const defaultUrl = visualPresetKey === 'moon'
      ? 'starmap_random_2020_4k_rot.exr'
      : 'rustig_koppie_puresky_4k.hdr';
    const url = (preset && typeof preset.hdri === 'string' && preset.hdri.length)
      ? preset.hdri
      : defaultUrl;
    const hdrReady =
      ctx.envFromHDRI &&
      ctx.envRT &&
      ctx.hdriReady &&
      ctx.hdriActiveKey === url;
    if (hdrReady) {
      return;
    }
    const cachedPreset = cache?.preset;
    if (
      allowHDRI &&
      cachedPreset?.envRT &&
      cachedPreset.background &&
      cachedPreset.key === url
    ) {
      ctx.envRT = cachedPreset.envRT;
      ctx.hdriBackground = cachedPreset.background;
      ctx.envIntensity = preset?.envIntensity ?? 1.6;
      ctx.envFromHDRI = true;
      ctx.hdriReady = true;
      ctx.hdriActiveKey = cachedPreset.key || null;
      ctx.envDirty = false;
      worldScene.environment = cachedPreset.envRT.texture;
      worldScene.background = cachedPreset.background;
      if ('backgroundIntensity' in worldScene) {
        worldScene.backgroundIntensity = 1.0;
      }
      if ('backgroundBlurriness' in worldScene) {
        worldScene.backgroundBlurriness = 0.0;
      }
      pushSkyDebug(ctx, {
        mode: 'preset-cache',
        presetMode: true,
        allowHDRI: true,
        key: cachedPreset.key || 'cache',
      });
      return;
    }
    if (
      allowHDRI &&
      !ctx.hdriLoading &&
      !ctx.hdriLoadPromise
    ) {
      const tryLoadHDRI = async (hdriUrl, token) => {
        try {
          const urlStr = String(hdriUrl || '');
          const lowered = urlStr.toLowerCase();
          const isEXR = lowered.endsWith('.exr');
          const isHDR = lowered.endsWith('.hdr');
          let loader = null;
          if (isEXR) {
            const mod = await import('three/addons/loaders/EXRLoader.js');
            if (!mod || !mod.EXRLoader) return false;
            loader = new mod.EXRLoader().setDataType(THREE_NS.FloatType);
          } else {
            const mod = await import('three/addons/loaders/RGBELoader.js');
            if (!mod || !mod.RGBELoader) return false;
            loader = new mod.RGBELoader().setDataType(THREE_NS.FloatType);
          }
          ctx.hdriLoading = true;
          const hdr = await new Promise((resolve, reject) =>
            loader.load(hdriUrl, resolve, undefined, reject),
          );
          hdr.mapping = THREE_NS.EquirectangularReflectionMapping;
          const isUByte = hdr.type === THREE_NS.UnsignedByteType;
          if (!isEXR && THREE_NS.SRGBColorSpace && isUByte) {
            hdr.colorSpace = THREE_NS.SRGBColorSpace;
          } else if (THREE_NS.LinearSRGBColorSpace) {
            hdr.colorSpace = THREE_NS.LinearSRGBColorSpace;
          }
          hdr.minFilter = THREE_NS.LinearFilter;
          hdr.magFilter = THREE_NS.LinearFilter;
          hdr.generateMipmaps = false;
          hdr.needsUpdate = true;
          const envRT = ctx.pmrem.fromEquirectangular(hdr);
          const envTexture = envRT.texture;
          if (THREE_NS.LinearSRGBColorSpace && envTexture) {
            envTexture.colorSpace = THREE_NS.LinearSRGBColorSpace;
          }
          if (ctx.hdriLoadGen !== token || !isPresetMode(store.get())) {
            try { envRT?.dispose?.(); } catch {}
            try { hdr?.dispose?.(); } catch {}
            ctx.hdriLoading = false;
            return false;
          }
          const prevEnvRT = ctx.envRT;
          const prevHdr = ctx.hdriBackground;
          ctx.envRT = envRT;
          ctx.hdriBackground = hdr;
          ctx.envFromHDRI = true;
          ctx.hdriReady = true;
          ctx.envDirty = false;
          worldScene.environment = envTexture;
          worldScene.background = hdr;
          if ('backgroundIntensity' in worldScene) {
            worldScene.backgroundIntensity = 1.0;
          }
          if ('backgroundBlurriness' in worldScene) {
            worldScene.backgroundBlurriness = 0.0;
          }
          if (cache) {
            cache.preset = {
              key: hdriUrl,
              envRT,
              background: hdr,
            };
          }
          const intensity = typeof preset?.envIntensity === 'number' ? preset.envIntensity : 1.0;
          ctx.envIntensity = intensity;
          ctx._envDebugPreset = {
            key: visualPresetKey,
            url: hdriUrl,
            envIntensity: intensity,
          };
          ctx.hdriActiveKey = hdriUrl;
          ctx.hdriLoading = false;
          return true;
        } catch (error) {
          ctx.hdriLoading = false;
          ctx.hdriReady = false;
          logWarn('[env] HDRI load failed', { url: hdriUrl, error: String(error) });
          return false;
        }
      };
      const token = hdriGen;
      ctx.hdriLoadPromise = (async () => {
        // Single preset: choose hausdorf or NightSkyHDRI008_4K based on visualPresetKey.
        // eslint-disable-next-line no-await-in-loop
        const ok = await tryLoadHDRI(url, token);
        if (ok) return true;
        ctx.hdriLoading = false;
        if (!ctx.envFromHDRI) {
          ctx.hdriReady = false;
          if (ctx.hdriLoadGen === token) {
            ctx.hdriFailed = true;
          }
        }
        return false;
      })()
        .catch((err) => {
          logWarn('[env] HDRI queue failed', err);
          ctx.hdriLoading = false;
          if (!ctx.envFromHDRI) {
            ctx.hdriReady = false;
            if (ctx.hdriLoadGen === token) {
              ctx.hdriFailed = true;
            }
          }
          return false;
        })
        .finally(() => {
          ctx.hdriLoadPromise = null;
        });
    }
    // Fallback: if HDRI is not ready, reuse the model cache first, otherwise generate a gradient environment.
    if (!ctx.envFromHDRI && !ctx.hdriLoading && !ctx.hdriReady) {
      let envRT = null;
      let background = null;
      const modelCached = cache?.model || null;
      if (modelCached?.envRT && modelCached.background) {
        envRT = modelCached.envRT;
        background = modelCached.background;
      } else {
        const bgTop = preset?.background ?? 0xdde6f4;
        const bgBottom = preset?.backgroundBottom ?? 0x6a8bb3;
        const grad = createVerticalGradientTexture(THREE_NS, bgTop, bgBottom, 256);
        envRT = ctx.pmrem.fromEquirectangular(grad);
        background = grad;
      }
      worldScene.environment = envRT?.texture || null;
      worldScene.background = background;
      ctx.envRT = envRT;
      ctx.envIntensity = typeof preset?.envIntensity === 'number' ? preset.envIntensity : 1.6;
      ctx.hdriBackground = background;
      ctx.envFromHDRI = false;
      ctx.hdriReady = true;
      ctx.envDirty = false;
      if (cache) {
        cache.preset = {
          key: modelCached?.key || 'preset-fallback',
          envRT,
          background,
        };
      }
      pushSkyDebug(ctx, {
        mode: 'preset-gradient-fallback',
        allowHDRI,
        generation: generation || 0,
      });
    }
  }

  function applyFallbackAppearance(ctx, state) {
    const fallback = ctx.fallback || { enabled: fallbackEnabledDefault, preset: 'sun' };
    const renderer = ctx.renderer;
    ensureBaseLightingCache(ctx);
    const presetMode = isPresetMode(state);
    fallback.enabled = fallbackEnabledDefault && presetMode;
    if (!fallback.enabled) {
      restoreBaseLighting(ctx);
      return;
    }
    const stateSnapshot = store && typeof store.get === 'function' ? store.get() : null;
    const visualPresetKey = currentPresetKeyFromState(stateSnapshot);
    const presetKey = visualPresetKey === 'moon' ? 'moon' : 'sun';
    const preset = FALLBACK_PRESETS[presetKey] || FALLBACK_PRESETS.sun;
    if (renderer && preset.exposure != null) {
      renderer.toneMappingExposure = preset.exposure;
    }

    // In preset mode, always apply preset lights, regardless of model-defined lights.
    if (ctx.ambient) {
      const ambientCfg = preset.ambient || {};
      ctx.ambient.color.setHex(ambientCfg.color ?? 0xffffff);
      ctx.ambient.intensity = ambientCfg.intensity ?? 0.2;
    }
    if (ctx.hemi) {
      const hemiCfg = preset.hemi || {};
      ctx.hemi.color.setHex(hemiCfg.sky ?? 0xffffff);
      ctx.hemi.groundColor.setHex(hemiCfg.ground ?? 0x20242f);
      ctx.hemi.intensity = hemiCfg.intensity ?? 0.6;
    }
    if (ctx.light) {
      const dirCfg = preset.dir || {};
      ctx.light.color.setHex(dirCfg.color ?? 0xffffff);
      ctx.light.intensity = dirCfg.intensity ?? 1.8;
      if (Array.isArray(dirCfg.position) && dirCfg.position.length === 3) {
        ctx.light.position.set(dirCfg.position[0], dirCfg.position[1], dirCfg.position[2]);
      }
      if (ctx.lightTarget && Array.isArray(dirCfg.target) && dirCfg.target.length === 3) {
        ctx.lightTarget.position.set(dirCfg.target[0], dirCfg.target[1], dirCfg.target[2]);
        ctx.light.target?.updateMatrixWorld?.();
      }
      if (ctx.light.shadow) {
        ctx.light.shadow.bias =
          dirCfg.shadowBias ?? preset.shadowBias ?? ctx.light.shadow.bias;
      }
    }
    if (ctx.fill) {
      const fillCfg = preset.fill || {};
      ctx.fill.color.setHex(fillCfg.color ?? 0xcfe3ff);
      ctx.fill.intensity = fillCfg.intensity ?? 0.3;
      if (Array.isArray(fillCfg.position) && fillCfg.position.length === 3) {
        ctx.fill.position.set(fillCfg.position[0], fillCfg.position[1], fillCfg.position[2]);
      }
    }
    // Base clear colour for renderer background when skybox/env are disabled.
    const presetClear =
      typeof preset.clearColor === 'number'
        ? preset.clearColor
        : (typeof preset.background === 'number' ? preset.background : null);
    if (presetClear != null) {
      ctx.baseClearHex = presetClear;
    }
    // Expose preset overrides for renderer (ground/infinite + overlays).
    if (ctx.fallback) {
      ctx.fallback.ground = preset.ground || null;
      ctx.fallback.overlays = preset.overlays || null;
      ctx.fallback.fogColor = typeof preset.fogColor === 'number' ? preset.fogColor : null;
    }
  }


  function ensureEnvIfNeeded(ctx, state, options = {}) {
    const presetMode = isPresetMode(state);
    const skyboxEnabled = options.skyboxEnabled !== false;
    const skyDebugMode = typeof options.skyDebugMode === 'string'
      ? options.skyDebugMode
      : skyDebugModeParam || null;
    ctx.skyDebugMode = skyDebugMode;
    const skyMode = !skyboxEnabled
      ? SKY_MODE_NONE
      : (presetMode ? SKY_MODE_PRESET : SKY_MODE_MODEL);
    const modeChanged = ctx._skyMode !== skyMode;
    ctx._skyMode = skyMode;
    ctx._lastPresetMode = presetMode;
    const stateSnapshot = store && typeof store.get === 'function' ? store.get() : null;
    const visualPresetKey = currentPresetKeyFromState(stateSnapshot);
    const presetKey = visualPresetKey === 'moon' ? 'moon' : 'sun';
    const preset = FALLBACK_PRESETS[presetKey] || FALLBACK_PRESETS.sun;
    const cache = ensureSkyCache(ctx);
    if (skyMode === SKY_MODE_PRESET && modeChanged) {
      ctx.hdriFailed = false;
      ctx.hdriLoadGen = (ctx.hdriLoadGen || 0) + 1;
      ctx.envDirty = true;
      // Initialize preset cache: if the model cache exists, clone it as the baseline.
      const modelCached = cache?.model || null;
      if (cache && modelCached && modelCached.envRT && modelCached.background) {
        cache.preset = {
          key: modelCached.key || preset.hdri || presetKey,
          envRT: modelCached.envRT,
          background: modelCached.background,
        };
      }
    }
    if (ctx.fallback) {
      ctx.fallback.ground = preset.ground || null;
      ctx.fallback.overlays = preset.overlays || null;
      ctx.fallback.fogColor = typeof preset.fogColor === 'number' ? preset.fogColor : null;
    }
    const hasEnv = hasModelEnvironment(state);
    const allowHDRI = skyMode === SKY_MODE_PRESET && fallbackEnabledDefault;
    if (skyMode === SKY_MODE_NONE) {
      ctx.envFromHDRI = false;
      ctx.hdriReady = false;
      ctx.envDirty = false;
      detachEnvironment(ctx);
      pushSkyDebug(ctx, {
        mode: 'skip',
        reason: 'skybox-off',
        presetMode,
        hasEnv,
        skyMode,
      });
      return;
    }
    if (skyMode === SKY_MODE_PRESET) {
      // Keep renderer clear colour in sync with the active preset when using HDRI.
      const presetClear =
        typeof preset.clearColor === 'number'
          ? preset.clearColor
          : (typeof preset.background === 'number' ? preset.background : null);
      if (presetClear != null) {
        ctx.baseClearHex = presetClear;
      }
      ensureOutdoorSkyEnv(ctx, preset, ctx.hdriLoadGen || 0, { allowHDRI });
      pushSkyDebug(ctx, {
        mode: 'ensure-preset',
        presetMode: true,
        allowHDRI,
        hasEnv,
        skyMode,
      });
      return;
    }

    // Model mode: prefer MuJoCo-driven sky; clear any HDRI state but keep caches
    ctx.envFromHDRI = false;
    ctx.hdriReady = false;
    const skyOk = ensureModelSkyFromAssets(ctx, state, THREE_NS, { skyDebugMode });
    if (!skyOk) {
      ensureModelGradientEnv(ctx, THREE_NS);
    }
    const worldScene = getWorldScene(ctx);
    if (worldScene && !worldScene.background) {
      worldScene.background = ctx.skyBackground || null;
    }
    pushSkyDebug(ctx, {
      mode: skyOk ? 'ensure-model-sky-tex' : 'ensure-model-sky',
      presetMode: false,
      hasEnv,
      skyMode,
      skyKind: ctx.skyMode || null,
      skyDebugMode,
    });
  }

  return {
    applyFallbackAppearance,
    ensureOutdoorSkyEnv,
    ensureEnvIfNeeded,
    hasModelEnvironment,
    hasModelLights,
    hasModelBackground,
  };
}

function createControlManager({
  store,
  backend,
  applySpecAction,
  readControlValue,
  leftPanel,
  rightPanel,
  cameraPresets = [],
  shortcutRoot = null,
}) {
  const controlById = new Map();
  const controlBindings = new Map();
  const eventCleanup = [];
  let shortcutsInstalled = false;
  const shortcutHandlers = new Map();
  const CAMERA_FALLBACK_PRESETS = ['Free', 'Tracking'];
  const modelLibrary = [];
  let modelSelectEl = null;
  const refreshModelSelectOptions = () => {
    if (!modelSelectEl) return;
    modelSelectEl.innerHTML = '';
    if (modelLibrary.length === 0) {
      const placeholder = document.createElement('option');
      placeholder.value = '';
      placeholder.textContent = 'No models loaded';
      placeholder.disabled = true;
      placeholder.selected = true;
      modelSelectEl.appendChild(placeholder);
      modelSelectEl.disabled = true;
      return;
    }
    modelSelectEl.disabled = false;
    for (let i = 0; i < modelLibrary.length; i += 1) {
      const entry = modelLibrary[i];
      const opt = document.createElement('option');
      opt.value = entry.id;
      opt.textContent = entry.label || `Model ${i + 1}`;
      modelSelectEl.appendChild(opt);
    }
  };

  const addModelEntry = (entry) => {
    const existingIndex = modelLibrary.findIndex((item) => item.id === entry.id);
    if (existingIndex >= 0) {
      modelLibrary[existingIndex] = entry;
    } else {
      modelLibrary.push(entry);
    }
    refreshModelSelectOptions();
    if (modelSelectEl && entry.id) {
      modelSelectEl.value = entry.id;
    }
    const label = entry.label || entry.file || entry.id || '';
    if (label) {
      store.update((draft) => {
        if (!draft.hud) draft.hud = {};
        draft.hud.modelLabel = label;
      });
    }
  };

  async function loadXmlTextAsModel(xmlText, label) {
    const text = typeof xmlText === 'string' ? xmlText : '';
    const name = typeof label === 'string' && label.trim().length ? label.trim() : `Model ${modelLibrary.length + 1}`;
    if (!text.trim()) {
      throw new Error('loadXmlTextAsModel: empty xml text');
    }
    const entry = {
      id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      label: name,
      kind: 'xmlText',
      xmlText: text,
    };
    addModelEntry(entry);
    resetModelFrontendState(store);
    if (typeof backend?.loadXmlText === 'function') {
      await backend.loadXmlText(text);
      pushToast?.(`Loaded model: ${name}`);
    }
  }

  function applyThemeFromColorControl(value) {
    if (typeof document === 'undefined' || !document.body) return;
    const token = String(value ?? '').toLowerCase();
    const isLight =
      token === 'light' ||
      token === '1' ||
      token === 'white' ||
      token === 'default';
    document.body.classList.toggle('theme-light', isLight);
  }

  function applySpacingFromControl(value) {
    if (typeof document === 'undefined' || !document.body) return;
    let isWide = false;
    const raw = value;
    if (typeof raw === 'number' || (typeof raw === 'string' && /^\d+$/.test(raw))) {
      const idx = Number(raw) | 0;
      isWide = idx === 1;
    } else if (typeof raw === 'string') {
      const token = raw.trim().toLowerCase();
      isWide = token.startsWith('wide');
    }
    document.body.classList.toggle('spacing-wide', isWide);
  }

  function applyFontFromControl(value) {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    if (!root || typeof root.style?.setProperty !== 'function') return;
    let scale = 1;
    let panelScale = 1;
    const raw = value;
    if (typeof raw === 'number' || (typeof raw === 'string' && /^\d+$/.test(raw))) {
      const idx = Number(raw) | 0;
      const lookup = [50, 75, 100, 150, 200];
      const pct = lookup[idx] ?? 100;
      if (pct > 0) scale = pct / 100;
      const panelLookup = {
        50: 0.7,
        75: 0.85,
        100: 1.0,
        150: 1.3,
        200: 1.6,
      };
      panelScale = panelLookup[pct] ?? 1.0;
    } else if (typeof raw === 'string') {
      const token = raw.trim().toLowerCase();
      const match = token.match(/(\d+)\s*%/);
      if (match) {
        const pct = Number(match[1]);
        if (Number.isFinite(pct) && pct > 0) {
          scale = pct / 100;
          const panelLookup = {
            50: 0.7,
            75: 0.85,
            100: 1.0,
            150: 1.3,
            200: 1.6,
          };
          panelScale = panelLookup[pct] ?? 1.0;
        }
      }
    }
    if (!Number.isFinite(scale) || scale <= 0) scale = 1;
    if (!Number.isFinite(panelScale) || panelScale <= 0) panelScale = 1;
    root.style.setProperty('--viewer-font-scale', String(scale));
    root.style.setProperty('--viewer_panel_scale', String(panelScale));
  }

  function sanitiseName(name) {
    return (
      String(name ?? '')
        .replace(/\s+/g, '_')
        .replace(/[^A-Za-z0-9._-]/g, '')
        .replace(/_+/g, '_')
        .replace(/^_+|_+$/g, '') || 'item'
    );
  }

  function normaliseOptions(options) {
    if (!options) return [];
    if (Array.isArray(options)) return options;
    return String(options)
      .split(/[\n,]+/)
      .map((token) => token.trim())
      .filter(Boolean);
  }

  const getOptionSupport = () => store.get()?.model?.optSupport ?? { supported: false, pointers: [] };
  const OPTION_BINDING_PREFIX = 'mjOption::';

  function isOptionBinding(control) {
    return typeof control?.binding === 'string' && control.binding.startsWith(OPTION_BINDING_PREFIX);
  }

  function applyOptionAvailability(control, element) {
    if (!element || !isOptionBinding(control)) return;
    const support = getOptionSupport();
    const supported = !!support?.supported;
    if ('disabled' in element) {
      element.disabled = !supported;
    }
    if (element instanceof HTMLElement) {
      const row = element.closest('.control-row');
      if (row) {
        row.classList.toggle('is-disabled', !supported);
      }
    }
  }

function formatNumber(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return '';
  const abs = Math.abs(num);
  if (abs !== 0 && (abs >= 1e6 || abs < 1e-4)) {
    return Number(num.toExponential(4)).toString();
  }
  return Number(num.toPrecision(6)).toString();
}

function formatNumberTrimmed(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return '';
  const fixed = Number(num).toPrecision(6);
  return fixed.replace(/\.?0+$/, '');
}


function attachCommitHandlers(input, binding, commit) {
  input.addEventListener('focus', () => {
    binding.isEditing = true;
  });
  input.addEventListener('blur', () => {
    binding.isEditing = false;
    commit();
  });
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      input.blur();
    }
  });
}

function attachOptionAvailability(control, element, binding) {
  if (!element || !binding) return;
  applyOptionAvailability(control, element);
  appendUpdateOptions(binding, () => {
    applyOptionAvailability(control, element);
  });
}

function appendUpdateOptions(binding, updater) {
  if (!binding || typeof updater !== 'function') return;
  const prev = binding.updateOptions;
  if (typeof prev === 'function') {
    binding.updateOptions = (state) => {
      prev(state);
      updater(state);
    };
  } else {
    binding.updateOptions = updater;
  }
}

function coerceBoolean(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const lowered = value.toLowerCase();
    return lowered === '1' || lowered === 'true' || lowered === 'run' || lowered === 'on' || lowered === 'yes';
  }
  return !!value;
}

function pushToast(message) {
  if (!message) return;
  try {
    store.update((draft) => {
      draft.toast = { message, ts: Date.now() };
    });
  } catch {}
}

  function elementIsEditable(node) {
    if (!node || typeof node !== 'object') return false;
    if (node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement || node instanceof HTMLSelectElement) {
      return !node.disabled && !node.readOnly;
    }
    if (node instanceof HTMLElement) {
      if (node.isContentEditable) return true;
      const role = typeof node.getAttribute === 'function' ? node.getAttribute('role') : null;
      if (role === 'textbox' || role === 'combobox') return true;
    }
    return false;
  }

  function hasEditableFocus(contextRoot) {
    const doc = contextRoot?.ownerDocument || contextRoot?.document || globalThis.document;
    if (!doc) return false;
    let active = doc.activeElement;
    while (active && active.shadowRoot && active.shadowRoot.activeElement) {
      active = active.shadowRoot.activeElement;
    }
    return elementIsEditable(active);
  }

  const dynamicRangeResolvers = {
    'simulation.history_scrubber': () => {
      const hist = store.get()?.history;
      const count = Math.max(1, hist?.count ?? hist?.capacity ?? 1);
      return { min: 1 - count, max: 0, step: 1, absolute: true };
    },
    'simulation.key_slider': () => {
      const keyframes = store.get()?.keyframes;
      const capacity = Math.max(1, keyframes?.capacity ?? 16);
      return { min: 0, max: Math.max(0, capacity - 1), step: 1, absolute: true };
    },
  };

  function parseRange(control) {
    const { range, min, max, step } = control || {};
    const isSlider = typeof control?.type === 'string' && control.type.startsWith('slider');
    const defaultMin = isSlider ? 0 : Number.NEGATIVE_INFINITY;
    const defaultMax = isSlider ? 1 : Number.POSITIVE_INFINITY;
    const out = {
      min: defaultMin,
      max: defaultMax,
      step: control?.type === 'slider_int' ? 1 : 0.01,
      scale: 'lin',
    };
  if (Array.isArray(range) && range.length >= 2) {
    const [rmin, rmax, rstep] = range;
    if (Number.isFinite(Number(rmin))) out.min = Number(rmin);
    if (Number.isFinite(Number(rmax))) out.max = Number(rmax);
    if (Number.isFinite(Number(rstep))) out.step = Number(rstep);
  } else if (typeof range === 'string') {
    const match = range.trim().match(/\[([^\]]+)\]/);
    if (match) {
      const parts = match[1]
        .split(/[,\s]+/)
        .map((token) => Number(token))
        .filter((num) => Number.isFinite(num));
      if (parts.length >= 2) {
        out.min = parts[0];
        out.max = parts[1];
      }
      if (parts.length >= 3) {
        out.step = parts[2];
      }
    }
  } else if (range && typeof range === 'object') {
    if (Number.isFinite(Number(range.min))) out.min = Number(range.min);
    if (Number.isFinite(Number(range.max))) out.max = Number(range.max);
    if (Number.isFinite(Number(range.step))) out.step = Number(range.step);
    if (typeof range.scale === 'string') {
      out.scale = range.scale.toLowerCase() === 'log' ? 'log' : 'lin';
    }
  } else {
    if (Number.isFinite(Number(min))) out.min = Number(min);
    if (Number.isFinite(Number(max))) out.max = Number(max);
    if (Number.isFinite(Number(step))) out.step = Number(step);
  }
  if (!(out.max > out.min)) {
    out.max = out.min + 1;
  }
  if (out.scale === 'log') {
    out.min = Math.max(Number.EPSILON, out.min);
    out.max = Math.max(out.min + Number.EPSILON, out.max);
  }
  if (!(out.step > 0)) {
    out.step = control?.type === 'slider_int' ? 1 : 0.01;
  }
  return out;
}

function normaliseToRange(value, range) {
  const { min, max, scale } = range;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  if (scale === 'log') {
    const logMin = Math.log(min);
    const logMax = Math.log(max);
    const clamped = Math.log(Math.max(min, Math.min(max, numeric)));
    return clamp01((clamped - logMin) / (logMax - logMin));
  }
  return clamp01((numeric - min) / (max - min));
}

function denormaliseFromRange(t, range) {
  const clampedT = clamp01(Number(t));
  const { min, max, scale, step } = range;
  let value;
  if (scale === 'log') {
    const logMin = Math.log(min);
    const logMax = Math.log(max);
    value = Math.exp(logMin + clampedT * (logMax - logMin));
  } else {
    value = min + clampedT * (max - min);
  }
  if (Number.isFinite(step) && step > 0) {
    const steps = Math.round((value - min) / step);
    value = min + steps * step;
  }
  return Math.min(max, Math.max(min, value));
}

function resolveCameraModeEntries() {
  const baseList =
    Array.isArray(cameraPresets) && cameraPresets.length >= CAMERA_FALLBACK_PRESETS.length
      ? cameraPresets
      : CAMERA_FALLBACK_PRESETS;
  const entries = baseList.map((label, idx) => ({
    value: String(idx),
    label: label || `Camera ${idx}`,
  }));
  const modelCameras = store.get()?.model?.cameras || [];
  if (Array.isArray(modelCameras) && modelCameras.length > 0) {
    modelCameras.forEach((cam, idx) => {
      const name =
        typeof cam?.name === 'string' && cam.name.trim().length > 0
          ? cam.name.trim()
          : `Camera ${idx + 1}`;
      entries.push({
        value: String(idx + baseList.length),
        label: name,
      });
    });
  }
  return entries;
}

function syncCameraSelectOptions(select, control) {
  if (!select) return [];
  const entries = resolveCameraModeEntries();
  const prevValue = select.value;
  let dirty = select.options.length !== entries.length;
  if (!dirty) {
    for (let i = 0; i < entries.length; i += 1) {
      const option = select.options[i];
      const entry = entries[i];
      if (!option || option.value !== entry.value || option.textContent !== entry.label) {
        dirty = true;
        break;
      }
    }
  }
  if (dirty) {
    select.innerHTML = '';
    entries.forEach((entry) => {
      const option = document.createElement('option');
      option.value = entry.value;
      option.textContent = entry.label;
      select.appendChild(option);
    });
    if (!entries.some((entry) => entry.value === prevValue)) {
      select.value = entries[0]?.value ?? '0';
    } else if (prevValue) {
      select.value = prevValue;
    }
  }
  control.options = entries.map((entry) => entry.label);
  return entries;
}

function resolveTrackingGeomEntries() {
  const entries = [
    { value: '-1', label: 'Scene center' },
  ];
  try {
    const geoms = store.get()?.model?.geoms || [];
    if (Array.isArray(geoms)) {
      geoms.forEach((geom, idx) => {
        const label =
          typeof geom?.name === 'string' && geom.name.trim().length > 0
            ? geom.name.trim()
            : `Geom ${idx}`;
        const value = Number.isFinite(geom?.index) ? String(geom.index | 0) : String(idx);
        entries.push({ value, label });
      });
    }
  } catch {}
  return entries;
}

function syncTrackingGeomSelectOptions(select, control) {
  if (!select) return [];
  const entries = resolveTrackingGeomEntries();
  const prevValue = select.value;
  let dirty = select.options.length !== entries.length;
  if (!dirty) {
    for (let i = 0; i < entries.length; i += 1) {
      const option = select.options[i];
      const entry = entries[i];
      if (!option || option.value !== entry.value || option.textContent !== entry.label) {
        dirty = true;
        break;
      }
    }
  }
  if (dirty) {
    select.innerHTML = '';
    entries.forEach((entry) => {
      const option = document.createElement('option');
      option.value = entry.value;
      option.textContent = entry.label;
      select.appendChild(option);
    });
    if (!entries.some((entry) => entry.value === prevValue)) {
      select.value = entries[0]?.value ?? '-1';
    } else if (prevValue) {
      select.value = prevValue;
    }
  }
  control.options = entries.map((entry) => entry.label);
  return entries;
}

const MOD_KEYS = new Set(['ctrl', 'control', 'meta', 'cmd', 'win', 'shift', 'alt', 'option']);

function resolveResetValue(control) {
  const def = control?.default;
  if (def === undefined || def === null) return undefined;
  if (typeof def === 'number' || typeof def === 'boolean') return def;
  if (typeof def === 'string') {
    const trimmed = def.trim();
    if (!trimmed) return undefined;
    const lower = trimmed.toLowerCase();
    if (lower === 'true') return true;
    if (lower === 'false') return false;
    const num = Number(trimmed);
    return Number.isFinite(num) ? num : undefined;
  }
  return undefined;
}

function normaliseShortcutSpec(shortcut) {
  const combos = [];
  const addCombo = (tokens) => {
    const canonical = canonicalShortcut(tokens);
    if (canonical) combos.push(canonical);
  };
  if (!shortcut) return combos;
  if (Array.isArray(shortcut)) {
    if (shortcut.every((token) => typeof token === 'string')) {
      addCombo(shortcut);
    } else {
      shortcut.forEach((entry) => {
        if (typeof entry === 'string') addCombo(entry.split('+'));
        else if (Array.isArray(entry)) addCombo(entry);
      });
    }
    return combos;
  }
  if (typeof shortcut === 'string') {
    addCombo(shortcut.split('+'));
  }
  return combos;
}

function canonicalShortcut(tokens) {
  if (!tokens) return null;
  const mods = [];
  let key = null;
  tokens.forEach((token) => {
    if (typeof token !== 'string') return;
    const lower = token.trim().toLowerCase();
    if (!lower) return;
    if (lower === 'ctrl' || lower === 'control') {
      if (!mods.includes('ctrl')) mods.push('ctrl');
      return;
    }
    if (lower === 'shift') {
      if (!mods.includes('shift')) mods.push('shift');
      return;
    }
    if (lower === 'alt' || lower === 'option') {
      if (!mods.includes('alt')) mods.push('alt');
      return;
    }
    if (lower === 'meta' || lower === 'cmd' || lower === 'win') {
      if (!mods.includes('meta')) mods.push('meta');
      return;
    }
    if (MOD_KEYS.has(lower)) return;
    key = normaliseKeyToken(lower);
  });
  if (!key) return null;
  mods.sort();
  return [...mods, key].join('+');
}

function normaliseKeyToken(token) {
  if (!token) return null;
  if (token === ' ') return 'space';
  if (token === 'spacebar') return 'space';
  if (token === 'esc') return 'escape';
  if (token === 'left') return 'arrowleft';
  if (token === 'right') return 'arrowright';
  if (token === 'up') return 'arrowup';
  if (token === 'down') return 'arrowdown';
  if (token.startsWith('key') && token.length === 4) return token.slice(3);
  if (token.startsWith('digit') && token.length === 6) return token.slice(5);
  return token;
}

function shortcutFromEvent(event) {
  if (event.defaultPrevented) return null;
  const tag = event.target?.tagName;
  if (tag && ['INPUT', 'TEXTAREA', 'SELECT'].includes(tag)) return null;
  if (event.target?.isContentEditable) return null;
  const mods = [];
  if (event.ctrlKey) mods.push('ctrl');
  if (event.shiftKey) mods.push('shift');
  if (event.altKey) mods.push('alt');
  if (event.metaKey) mods.push('meta');
  let key = event.key;
  if (!key) return null;
  key = key.toLowerCase();
  if (key === ' ') key = 'space';
  mods.sort();
  return [...mods, key].join('+');
}

  function registerShortcutHandlers(shortcutSpec, handler) {
    const combos = normaliseShortcutSpec(shortcutSpec);
    combos.forEach((combo) => {
      const list = shortcutHandlers.get(combo) || [];
      list.push(handler);
      shortcutHandlers.set(combo, list);
    });
  }
  
  function registerGlobalShortcut(shortcutSpec, handler) {
    if (!shortcutSpec || typeof handler !== 'function') return;
    registerShortcutHandlers(shortcutSpec, handler);
  }
  
  function registerControl(control, binding) {
    controlById.set(control.item_id, control);
    controlBindings.set(control.item_id, binding);
    if (control?.binding) {
      getControlBindingSpec(control);
    }
  }

  function createBinding(control, { getValue, applyValue }) {
    const binding = {
      skip: false,
      isEditing: false,
      getValue,
      setValue: (value) => {
        binding.skip = true;
        applyValue(value);
        binding.skip = false;
      },
    };
    registerControl(control, binding);
    return binding;
  }

  function guardBinding(binding, handler) {
    return (...args) => {
      if (binding?.skip) return undefined;
      return handler(...args);
    };
  }

  function createControlRow(control, options = {}) {
    const row = document.createElement('div');
    row.className = 'control-row';
    if (options.full) row.classList.add('full');
    if (options.half) row.classList.add('half');
    if (control?.item_id) {
      row.dataset.controlId = control.item_id;
    }
    return row;
  }

  function createNamedRow(labelText, options = {}) {
    const row = createControlRow(null, options);
    const label = document.createElement('label');
    label.className = 'control-label';
    label.textContent = labelText ?? '';
    const field = document.createElement('div');
    field.className = 'control-field';
    row.append(label, field);
    return { row, label, field };
  }

  function createFullRow(options = {}) {
    const row = createControlRow(null, { ...options, full: true });
    const field = document.createElement('div');
    field.className = 'control-field';
    row.append(field);
    return { row, field };
  }

  function renderFileSectionExtras(body) {
    const row = createControlRow(null);

    const loadLabel = document.createElement('label');
    loadLabel.className = 'btn-primary btn-file';
    loadLabel.textContent = 'Load xml';
    loadLabel.setAttribute('data-testid', 'file.load_xml_custom');

    const loadInput = document.createElement('input');
    loadInput.type = 'file';
    loadInput.accept = '.xml';
    loadInput.setAttribute('data-testid', 'file.load_xml_input');
    loadLabel.appendChild(loadInput);

    const field = document.createElement('div');
    field.className = 'control-field';

    const select = document.createElement('select');
    select.setAttribute('data-testid', 'file.model_select');

    field.append(select);
    row.append(loadLabel, field);
    body.append(row);

    modelSelectEl = select;
    refreshModelSelectOptions();

    const initialInfo = typeof backend?.getInitialModelInfo === 'function'
      ? backend.getInitialModelInfo()
      : null;
    if (initialInfo && initialInfo.file) {
      const file = initialInfo.file;
      const label = initialInfo.label || file;
      const entry = {
        id: `builtin_${file}`,
        label,
        kind: 'builtinUrl',
        file,
      };
      addModelEntry(entry);
    }

    loadInput.addEventListener('change', async () => {
      const file = loadInput.files && loadInput.files[0];
      if (!file) return;
      try {
        const text = await file.text();
        await loadXmlTextAsModel(text, file.name || null);
      } catch (err) {
        logError('[ui] load xml from file failed', err);
        pushToast?.('Failed to load xml from file');
        throw err;
      } finally {
        loadInput.value = '';
      }
    });

    select.addEventListener('change', async () => {
      const id = select.value;
      if (!id) return;
      const entry = modelLibrary.find((item) => item.id === id);
      if (!entry) return;
      try {
        if (entry.kind === 'xmlText' && entry.xmlText) {
          resetModelFrontendState(store);
          if (typeof backend?.loadXmlText === 'function') {
            await backend.loadXmlText(entry.xmlText);
            pushToast?.(`Loaded model: ${entry.label || id}`);
          }
          return;
        }
        if (entry.kind === 'builtinUrl' && entry.file) {
          const url = new URL(entry.file, import.meta.url);
          const res = await fetch(url, { cache: 'no-store' });
          if (!res.ok) {
            pushToast?.(`Failed to fetch model: ${entry.label || entry.file}`);
            return;
          }
          const text = await res.text();
          entry.kind = 'xmlText';
          entry.xmlText = text;
          resetModelFrontendState(store);
          if (typeof backend?.loadXmlText === 'function') {
            await backend.loadXmlText(text);
            pushToast?.(`Loaded model: ${entry.label || id}`);
          }
        }
      } catch (err) {
        logError('[ui] model select reload failed', err);
        pushToast?.('Failed to load selected model');
        throw err;
      }
    });

    refreshModelSelectOptions();

    const noteRow = createFullRow();
    noteRow.field.classList.add('control-static');
    noteRow.field.textContent = 'Simulate File actions are disabled here.';
    body.append(noteRow.row);
  }

  function createLabeledRow(control) {
    const row = createControlRow(control);
    const label = document.createElement('label');
    label.className = 'control-label';
    label.textContent = control.label ?? control.name ?? control.item_id;
    const field = document.createElement('div');
    field.className = 'control-field';
    row.append(label, field);
    return { row, label, field };
  }

  function expandSection(section) {
    const out = { ...section, items: [] };
    for (const item of section.items ?? []) {
      out.items.push(item);
    }

    function appendGroupedEntries(group) {
      if (!group) return;
      const groupKey = group.group_id ?? group.label ?? section.section_id;
      if (group.label) {
        out.items.push({
          item_id: `${section.section_id}.${sanitiseName(groupKey)}._separator`,
          type: 'separator',
          label: group.label,
        });
      }
      const groupType = typeof group.type === 'string' ? group.type.toLowerCase() : '';
      const fallbackType = groupType.includes('radio')
        ? 'radio'
        : groupType.includes('select')
        ? 'select'
        : groupType.includes('slider')
        ? 'slider'
        : 'checkbox';
      for (const entry of group.entries ?? []) {
        const name = entry.name ?? entry.label ?? entry.binding ?? 'entry';
        const itemIdBase = group.group_id ? String(group.group_id) : `${section.section_id}`;
        const itemId = `${itemIdBase}.${sanitiseName(name)}`;
        out.items.push({
          item_id: itemId,
          type: entry.type ?? fallbackType,
          label: entry.name ?? entry.label ?? name,
          binding: entry.binding,
          name,
          options: entry.options,
          default: entry.default,
          shortcut: entry.shortcut,
        });
      }
    }

    for (const group of section.dynamic_groups ?? []) {
      appendGroupedEntries(group);
    }

    for (const post of section.post_groups ?? []) {
      out.items.push(post);
    }
    for (const trail of section.trail_groups ?? []) {
      appendGroupedEntries(trail);
    }
    return out;
  }

  async function loadUiSpec() {
    const specUrl = new URL('./spec/ui_spec.json', import.meta.url);
    const res = await fetch(specUrl, { cache: 'no-store' });
    if (!res.ok) {
      throw new Error(`Failed to load ui_spec.json (${res.status})`);
    }
    const json = await res.json();
    return {
      left: (json.left_panel ?? []).map(expandSection),
      right: (json.right_panel ?? []).map(expandSection),
    };
  }

    function createBoolToggleElements(control, { disabled = false } = {}) {
      const row = createControlRow(control);
      row.classList.add('bool-row');
      const label = document.createElement('label');
      label.className = 'bool-button bool-label';
      if (disabled) {
        label.classList.add('is-disabled');
      }
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.id = `${sanitiseName(control.item_id)}__checkbox`;
      input.setAttribute('role', 'switch');
      input.setAttribute('data-testid', control.item_id);
      input.setAttribute('aria-checked', 'false');
      if (disabled) {
        input.setAttribute('aria-disabled', 'true');
        input.disabled = true;
      }
      const span = document.createElement('span');
      span.className = 'bool-text';
      span.textContent = control.label ?? control.name ?? control.item_id;
      label.append(input, span);
      row.append(label);
      return { row, label, input, span };
    }

    function renderDisabledCheckbox(container, control) {
      const { row } = createBoolToggleElements(control, { disabled: true });
      container.append(row);
      return row;
    }

  function renderCheckbox(container, control) {
    const { row, label, input } = createBoolToggleElements(control);
    container.append(row);

    let current = false;
    const binding = createBinding(control, {
      getValue: () => current,
      applyValue: (value) => {
        const active = coerceBoolean(value);
        current = active;
        input.checked = !!active;
        input.setAttribute('aria-checked', active ? 'true' : 'false');
        label.classList.toggle('is-active', !!active);
      },
    });

    const commitToggle = guardBinding(binding, async (nextValue) => {
      const active = !!nextValue;
      binding.setValue(active);
      try {
        // eslint-disable-next-line no-console
      } catch {}
      await applySpecAction(store, backend, control, active);
      // UX hint: if enabling Contact Point but there are no contacts yet, show a brief tip
      try {
        if (active && control?.binding === 'mjvOption::flags[14]') {
          const hud = store.get()?.hud || {};
          const n = Number(hud.contacts ?? 0);
          if (!(n > 0)) {
            store.update((draft) => {
              draft.toast = { message: 'No contacts right now', ts: Date.now() };
            });
          }
        }
      } catch {}
    });

    input.addEventListener(
      'change',
      (event) => {
        event.stopPropagation();
        const next = !binding.getValue();
        commitToggle(next);
      },
    );

    label.addEventListener('click', (event) => {
      event.preventDefault();
      const next = !binding.getValue();
      commitToggle(next);
    });

    input.addEventListener('focus', () => {
      label.classList.add('has-focus');
    });
    input.addEventListener('blur', () => {
      label.classList.remove('has-focus');
    });
  }

  function renderRunToggle(container, control) {
    const row = createControlRow(control);
    row.classList.add('run-toggle-row');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'run-toggle';
    button.setAttribute('data-testid', control.item_id);
    button.setAttribute('aria-pressed', 'false');

    const sync = (running) => {
      const active = coerceBoolean(running);
      button.textContent = active ? 'Run' : 'Pause';
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
    };

    const binding = createBinding(control, {
      getValue: () => {
        const current = readControlValue(store.get(), control);
        return coerceBoolean(current);
      },
      applyValue: (value) => {
        const active = coerceBoolean(value);
        sync(active);
      },
    });

    sync(binding.getValue());

    button.addEventListener(
      'click',
      guardBinding(binding, async () => {
        const next = !binding.getValue();
        await applySpecAction(store, backend, control, next);
      }),
    );

    row.append(button);
    container.append(row);
    return row;
  }

  function renderButton(container, control, variant = 'secondary') {
    const row = createControlRow(control);
    row.classList.add('action-row');
    const button = document.createElement('button');
    button.type = 'button';
    const labelText = control.label ?? control.name ?? control.item_id;
    button.textContent = labelText;
    button.setAttribute('data-testid', control.item_id);

    let resolvedVariant = variant;
    if (control.item_id === 'simulation.run') {
      resolvedVariant = 'primary';
    } else if (control.item_id.startsWith('simulation.') || control.item_id.startsWith('file.')) {
      resolvedVariant = 'pill';
    }
    if (variant === 'pill') {
      resolvedVariant = 'pill';
    }

    if (resolvedVariant === 'pill') {
      button.classList.add('btn-pill');
      row.classList.add('pill-row');
    } else if (resolvedVariant === 'primary') {
      button.classList.add('btn-primary');
    } else {
      button.classList.add('btn-secondary');
    }

    row.append(button);
    container.append(row);

    registerControl(control, {
      skip: false,
      getValue: () => true,
      setValue: () => {},
    });

    button.addEventListener('click', async (event) => {
      await applySpecAction(store, backend, control, {
        trigger: 'click',
        shiftKey: !!event.shiftKey,
        ctrlKey: !!event.ctrlKey,
        altKey: !!event.altKey,
        metaKey: !!event.metaKey,
      });
    });
  }

  function resolveColorLabel(value, options) {
    const palette = options.length > 0 ? options : ['Dark', 'Light'];
    let label;
    if (typeof value === 'number' || (typeof value === 'string' && /^\d+$/.test(value))) {
      const idx = Number(value) | 0;
      label = idx === 1 && palette.length > 1 ? palette[1] : palette[0];
    } else {
      const token = String(value ?? '').toLowerCase();
      if (token.startsWith('light')) {
        label =
          palette.find((opt) => String(opt).toLowerCase().startsWith('light')) ??
          palette[1] ??
          palette[0];
      } else if (token.startsWith('dark')) {
        label =
          palette.find((opt) => String(opt).toLowerCase().startsWith('dark')) ??
          palette[0];
      } else {
        label = palette[0];
      }
    }
    if (!palette.includes(label)) {
      label = palette[0];
    }
    return label;
  }

  function resolveSpacingLabel(value, options) {
    const labels = options.length > 0 ? options : ['Tight', 'Wide'];
    let label;
    if (typeof value === 'number' || (typeof value === 'string' && /^\d+$/.test(value))) {
      const idx = Number(value) | 0;
      label = labels[idx] ?? labels[0];
    } else if (typeof value === 'string') {
      const token = value.trim().toLowerCase();
      if (token.startsWith('wide')) {
        label =
          labels.find((opt) => String(opt).toLowerCase().startsWith('wide')) ??
          labels[1] ??
          labels[0];
      } else {
        label = labels[0];
      }
    } else {
      label = labels[0];
    }
    if (!labels.includes(label)) {
      label = labels[0];
    }
    return label;
  }

  function resolveFontLabel(value, options) {
    const labels = options.length > 0 ? options : ['50 %', '100 %', '150 %', '200 %', '250 %', '300 %'];
    let label;
    if (typeof value === 'number' || (typeof value === 'string' && /^\d+$/.test(value))) {
      const idx = Number(value) | 0;
      label = labels[idx] ?? labels[1] ?? labels[0];
    } else if (typeof value === 'string') {
      const token = value.trim().toLowerCase();
      const direct = labels.find((opt) => String(opt).trim().toLowerCase() === token);
      if (direct) {
        label = direct;
      } else {
        const match = token.match(/(\d+)\s*%/);
        if (match) {
          const pct = `${match[1]} %`;
          const exact = labels.find((opt) => String(opt).trim().toLowerCase() === pct.toLowerCase());
          label = exact || labels[0];
        } else {
          label = labels[0];
        }
      }
    } else {
      label = labels[0];
    }
    if (!labels.includes(label)) {
      label = labels[0];
    }
    return label;
  }

  const SELECT_SPECIALS = {
    'option.color': {
      defaultOptions: ['Dark', 'Light'],
      resolveLabel: resolveColorLabel,
      apply: applyThemeFromColorControl,
    },
    'option.spacing': {
      defaultOptions: ['Tight', 'Wide'],
      resolveLabel: resolveSpacingLabel,
      apply: applySpacingFromControl,
    },
    'option.font': {
      defaultOptions: ['50 %', '100 %', '150 %', '200 %', '250 %', '300 %'],
      resolveLabel: resolveFontLabel,
      apply: applyFontFromControl,
    },
  };

  function resolveSelectMeta(control, options) {
    const isCameraModeSelect = control.item_id === 'rendering.camera_mode';
    const isTrackingGeomSelect = control.item_id === 'rendering.tracking_geom';
    const isLabelModeSelect = control.binding === 'mjvOption::label';
    const isFrameModeSelect = control.binding === 'mjvOption::frame';
    const isNumericSelect = isLabelModeSelect || isFrameModeSelect;
    const isMjOptionEnumBinding = isOptionBinding(control);
    const isMjOptionEnumSelect =
      isMjOptionEnumBinding && !isNumericSelect && !isCameraModeSelect && !isTrackingGeomSelect;
    const special = SELECT_SPECIALS[control.item_id] ?? null;
    return {
      options,
      special,
      isCameraModeSelect,
      isTrackingGeomSelect,
      isNumericSelect,
      isMjOptionEnumSelect,
    };
  }

  function syncSelectOptions(select, meta, control) {
    if (meta.isCameraModeSelect) {
      syncCameraSelectOptions(select, control);
      return;
    }
    if (meta.isTrackingGeomSelect) {
      syncTrackingGeomSelectOptions(select, control);
      return;
    }
    meta.options.forEach((opt, idx) => {
      const option = document.createElement('option');
      option.value = meta.isNumericSelect ? String(idx) : opt;
      option.textContent = opt;
      select.appendChild(option);
    });
  }

  function readSelectValue(select, meta, control) {
    if (meta.isCameraModeSelect) {
      syncCameraSelectOptions(select, control);
      return toNumber(select.value);
    }
    if (meta.isTrackingGeomSelect) {
      syncTrackingGeomSelectOptions(select, control);
      return toNumber(select.value);
    }
    if (meta.isNumericSelect) {
      return Math.max(0, Math.trunc(toNumber(select.value)));
    }
    return select.value;
  }

  function applySelectValue(select, meta, control, value) {
    if (meta.special) {
      const label = meta.special.resolveLabel(value, meta.options);
      select.value = label;
      meta.special.apply(select.value);
      return;
    }
    if (meta.isCameraModeSelect) {
      const entries = syncCameraSelectOptions(select, control);
      const numericValue = Math.max(0, Math.trunc(toNumber(value)));
      const match = entries.find((entry) => entry.value === String(numericValue));
      const fallbackValue = entries[0]?.value ?? '0';
      select.value = match ? match.value : fallbackValue;
      return;
    }
    if (meta.isTrackingGeomSelect) {
      const entries = syncTrackingGeomSelectOptions(select, control);
      const numericValue = Math.trunc(toNumber(value));
      const match = entries.find((entry) => entry.value === String(numericValue));
      const fallbackValue = entries[0]?.value ?? '-1';
      select.value = match ? match.value : fallbackValue;
      return;
    }
    if (meta.isNumericSelect) {
      const numericValue = Math.max(0, Math.trunc(toNumber(value)));
      const clamped = Math.min(numericValue, Math.max(0, meta.options.length - 1));
      select.value = String(clamped);
      return;
    }
    if (meta.isMjOptionEnumSelect && (typeof value === 'number' || (typeof value === 'string' && /^\d+$/.test(value)))) {
      const idx = Number(value) | 0;
      const clamped = Math.max(0, Math.min(idx, Math.max(0, meta.options.length - 1)));
      const label = meta.options[clamped] ?? meta.options[0] ?? '';
      if (label) {
        select.value = label;
      }
      return;
    }
    if (value == null) {
      select.value = meta.options[0] ?? '';
      return;
    }
    const next = String(value);
    if (!meta.options.includes(next) && meta.options.length > 0) {
      select.value = meta.options[0];
    } else {
      select.value = next;
    }
  }

  function renderSelect(container, control) {
      const { row, label, field } = createLabeledRow(control);
      const inputId = `${sanitiseName(control.item_id)}__select`;
      label.setAttribute('for', inputId);
      const select = document.createElement('select');
      select.setAttribute('data-testid', control.item_id);
      select.id = inputId;
      const baseOptions = normaliseOptions(control.options);
      const fallbackOptions = SELECT_SPECIALS[control.item_id]?.defaultOptions ?? baseOptions;
      const options = baseOptions.length > 0 ? baseOptions : fallbackOptions;
      const meta = resolveSelectMeta(control, options);
      syncSelectOptions(select, meta, control);
      field.append(select);
      container.append(row);

      const binding = createBinding(control, {
        getValue: () => readSelectValue(select, meta, control),
        applyValue: (value) => applySelectValue(select, meta, control, value),
      });

      attachOptionAvailability(control, select, binding);
      if (control.item_id === 'rendering.tracking_geom') {
        appendUpdateOptions(binding, (state) => {
          const isTracking = (state?.runtime?.cameraIndex | 0) === 1;
          const disabled = !isTracking || select.options.length <= 1;
          select.disabled = disabled;
          row.classList.toggle('is-disabled', disabled);
        });
      }

      select.addEventListener(
        'change',
        guardBinding(binding, async () => {
          const value = readSelectValue(select, meta, control);
          if (meta.special) {
            meta.special.apply(value);
          }
          await applySpecAction(store, backend, control, value);
        }),
      );

      if (meta.special) {
        meta.special.apply(select.value);
      }
    }

  function buildSegmentedOptions(control, group, options) {
    return options.map((option, index) => {
        const key = option?.key ?? String(index);
        const value = option?.value ?? option?.label ?? '';
        const labelText = option?.label ?? value;
        const radioId = `${sanitiseName(control.item_id)}__${key}`;
        const wrapper = document.createElement('label');
        wrapper.className = 'segmented-option';
        const input = document.createElement('input');
        input.type = 'radio';
        input.name = control.item_id;
        input.value = String(value);
        input.id = radioId;
        input.dataset.key = String(key);
        input.dataset.index = String(index);
        const span = document.createElement('span');
        span.textContent = String(labelText);
        wrapper.append(input, span);
        group.append(wrapper);
      return input;
    });
  }

  function createSegmentedGroup(container, control, { options, layout = 'labeled', labelText = null }) {
    let field = null;
    if (layout === 'stacked') {
      const labelRow = createControlRow(control, { full: true });
      const label = document.createElement('label');
      label.className = 'control-label';
      label.textContent = labelText ?? control.label ?? control.name ?? control.item_id;
      labelRow.append(label);
      container.append(labelRow);

      const { row: groupRow, field: groupField } = createFullRow({ full: true });
      groupRow.dataset.controlId = control.item_id;
      field = groupField;
      container.append(groupRow);
    } else {
      const { row, field: groupField } = createLabeledRow(control);
      field = groupField;
      container.append(row);
    }

    const group = document.createElement('div');
    group.className = 'segmented';
    group.setAttribute('data-testid', control.item_id);
    field.append(group);
    const inputs = buildSegmentedOptions(control, group, options);
    return { group, inputs };
  }

  function attachSegmentedHandlers(control, inputs, { getValue, applyValue, onCommit }) {
    const binding = createBinding(control, { getValue, applyValue });
    inputs.forEach((input) => {
      input.addEventListener(
        'change',
        guardBinding(binding, async () => {
          if (!input.checked) return;
          await onCommit(binding, input);
        }),
      );
    });
    return binding;
  }

  function renderVisualSourceControl(container, control) {
      const { inputs } = createSegmentedGroup(container, control, {
        layout: 'stacked',
        options: [
        { key: 'preset-sun', label: 'Preset☀️', value: 'PresetSun' },
        { key: 'preset-moon', label: 'Preset🌙️', value: 'PresetMoon' },
        { key: 'model', label: 'Model', value: 'Model' },
        ],
      });

      let logicalValue = 'PresetSun';

      attachSegmentedHandlers(control, inputs, {
        getValue: () => logicalValue,
        applyValue: (value) => {
          const token = typeof value === 'string' ? value.toLowerCase() : '';
          let targetKey;
          if (token.startsWith('model')) {
            logicalValue = 'Model';
            targetKey = 'model';
          } else if (token.includes('moon')) {
            logicalValue = 'PresetMoon';
            targetKey = 'preset-moon';
          } else {
            logicalValue = 'PresetSun';
            targetKey = 'preset-sun';
          }
          inputs.forEach((input) => {
            const key = input.dataset.key || '';
            const active = key === targetKey;
            input.checked = active;
          });
        },
        onCommit: async (binding, input) => {
          const key = input.dataset.key || '';
          const modeValue = input.value || (key === 'model' ? 'Model' : input.value);
          binding.setValue(modeValue);
          try {
            await applySpecAction(store, backend, control, modeValue);
          } catch (err) {
            logWarn('[ui] visual source toggle failed', err);
          }
        },
      });
    }

    function renderRadio(container, control) {
      const options = normaliseOptions(control.options);
      const { inputs } = createSegmentedGroup(container, control, {
        options: options.map((opt, idx) => ({
          key: String(idx),
          value: String(opt),
          label: String(opt),
        })),
      });

    attachSegmentedHandlers(control, inputs, {
      getValue: () => inputs.find((r) => r.checked)?.value ?? options[0],
      applyValue: (value) => {
        inputs.forEach((radio, idx) => {
          if (value === options[idx] || value === idx || value === radio.value) {
            radio.checked = true;
          }
        });
      },
      onCommit: async (_binding, input) => {
        await applySpecAction(store, backend, control, input.value);
      },
    });
  }

  function renderSlider(container, control) {
    const baseRange = parseRange(control);
    const { row, label, field } = createLabeledRow(control);
    const inputId = `${sanitiseName(control.item_id)}__slider`;
    label.setAttribute('for', inputId);
    const input = document.createElement('input');
    input.type = 'range';
    input.min = '0';
    input.max = '1';
    input.step = '0.001';
    input.setAttribute('data-testid', control.item_id);
    input.id = inputId;
    input.value = '0';

    const valueLabel = document.createElement('span');
    valueLabel.className = 'slider-value';

    field.append(input, valueLabel);
    container.append(row);

    let resolvedRange = { ...baseRange };
    let usesAbsolute = false;
    const resolveRange = () => {
      const range = { ...baseRange };
      const resolver = dynamicRangeResolvers[control.item_id];
      if (typeof resolver === 'function') {
        try {
          const dyn = resolver();
          if (dyn && Number.isFinite(dyn.min) && Number.isFinite(dyn.max)) {
            if (dyn.min === dyn.max) {
              dyn.max = dyn.min + 1;
            }
            Object.assign(range, dyn);
          }
        } catch {}
      }
      if (!(range.max > range.min)) {
        range.max = range.min + 1;
      }
      if (!(range.step > 0)) {
        range.step = input.type === 'range' ? 0.001 : 1;
      }
      resolvedRange = range;
      usesAbsolute = !!range.absolute;
      if (usesAbsolute) {
        input.min = String(range.min);
        input.max = String(range.max);
        input.step = String(range.step);
      } else {
        input.min = '0';
        input.max = '1';
        input.step = '0.001';
      }
      return resolvedRange;
    };

    resolveRange();

    const binding = createBinding(control, {
      getValue: () => {
        resolveRange();
        if (usesAbsolute) {
          return Number(input.value);
        }
        return denormaliseFromRange(Number(input.value), resolvedRange);
      },
      applyValue: (value) => {
        const range = resolveRange();
        const numeric = Number(value ?? range.min);
        const limited = Number.isFinite(numeric) ? Math.min(range.max, Math.max(range.min, numeric)) : range.min;
        if (usesAbsolute) {
          input.value = String(limited);
        } else {
          const t = normaliseToRange(limited, range);
          input.value = String(t);
        }
        valueLabel.textContent = formatNumber(limited);
      },
    });

    const updateAvailability = () => {
      applyOptionAvailability(control, input);
      if (input.disabled) {
        valueLabel.textContent = 'unsupported';
      }
    };
    updateAvailability();
    binding.updateOptions = updateAvailability;

    input.addEventListener(
      'input',
      guardBinding(binding, async () => {
        const range = resolveRange();
        let realValue;
        if (usesAbsolute) {
          const raw = Number(input.value);
          realValue = Number.isFinite(raw) ? raw : range.min;
        } else {
          const t = Number(input.value);
          realValue = denormaliseFromRange(t, range);
        }
        valueLabel.textContent = formatNumber(realValue);
        await applySpecAction(store, backend, control, realValue);
      }),
    );
    if (usesAbsolute) {
      valueLabel.textContent = formatNumber(Number(input.value) || resolvedRange.min);
    } else {
      valueLabel.textContent = formatNumber(denormaliseFromRange(Number(input.value), resolvedRange));
    }

    const setEditing = (flag) => {
      binding.isEditing = !!flag;
    };
    input.addEventListener('pointerdown', () => setEditing(true));
    input.addEventListener('pointerup', () => setEditing(false));
    input.addEventListener('pointerleave', () => {
      if (binding.isEditing) setEditing(false);
    });
    input.addEventListener('blur', () => setEditing(false));
  }

  function createTextInputField(container, control, { mode = 'text', idSuffix = '__edit' } = {}) {
    const range = mode === 'text' ? null : parseRange(control);
    const { row, label, field } = createLabeledRow(control);
    const inputId = `${sanitiseName(control.item_id)}${idSuffix}`;
    label.setAttribute('for', inputId);
    const input = document.createElement('input');
    input.id = inputId;
    input.setAttribute('data-testid', control.item_id);
    input.autocomplete = 'off';
    input.spellcheck = false;
    if (mode === 'int') {
      input.type = 'number';
      input.step = '1';
      input.inputMode = 'numeric';
    } else if (mode === 'float') {
      input.type = 'number';
      input.step = '0.001';
      input.inputMode = 'decimal';
    } else {
      input.type = 'text';
    }
    return { row, input, field, range };
  }

  function renderEditInput(container, control, mode = 'text') {
    const { row, input, field, range } = createTextInputField(container, control, { mode });
    field.append(input);
    container.append(row);

    const binding = createBinding(control, {
      getValue: () => {
        if (mode === 'text') return input.value;
        const value = Number(input.value);
        return Number.isFinite(value) ? value : 0;
      },
      applyValue: (value) => {
        if (value === undefined || value === null) return;
        if (mode === 'text') {
          input.value = value == null ? '' : String(value);
          return;
        }
        const numeric = Number(value);
        if (!Number.isFinite(numeric)) {
          input.value = '';
          return;
        }
        const clamped = Math.min(range.max, Math.max(range.min, numeric));
        if (mode === 'int') {
          input.value = String(clamped | 0);
        } else if (mode === 'float') {
          input.value = formatNumber(clamped);
        } else {
          input.value = String(clamped);
        }
      },
    });

    attachOptionAvailability(control, input, binding);

    // Seed with current state value if present; fallback to default only when the state is empty.
    const current = readControlValue(store.get(), control);
    if (current !== undefined && current !== null) {
      binding.setValue(current);
    } else if (control.default !== undefined) {
      if (mode === 'text' && typeof control.default === 'string') {
        input.placeholder = String(control.default);
      } else if (typeof control.default === 'number') {
        binding.setValue(control.default);
      }
    }

    const commit = guardBinding(binding, async () => {
      let raw;
      if (mode === 'text') {
        raw = input.value;
      } else {
        const numeric = Number(input.value);
        raw = Number.isFinite(numeric) ? Math.min(range.max, Math.max(range.min, numeric)) : range.min;
        if (mode === 'float') {
          input.value = formatNumber(raw);
        } else if (mode === 'int') {
          input.value = String(raw | 0);
        } else {
          input.value = String(raw);
        }
      }
      await applySpecAction(store, backend, control, raw);
    });

    attachCommitHandlers(input, binding, commit);
  }

  function renderVectorInputBase(container, control, {
    expectedLength,
    idSuffix,
    formatValue,
    allowDefaultPlaceholder = true,
  }) {
    const { row, input, field } = createTextInputField(container, control, {
      mode: 'text',
      idSuffix,
    });
    field.append(input);
    container.append(row);

    const targetLength = Math.max(1, expectedLength | 0);
    let lastValidText = '';
    const formatVector = (vector) => vector.map(formatValue).join(' ');

    const setInputText = (text) => {
      input.value = text;
      input.classList.remove('is-invalid');
    };

    const binding = createBinding(control, {
      getValue: () => lastValidText || input.value,
      applyValue: (value) => {
        if (value === undefined || value === null) return;
        const parsed = parseVector(value, targetLength);
        if (parsed) {
          lastValidText = formatVector(parsed);
          setInputText(lastValidText);
          return;
        }
        const text = typeof value === 'string' ? value.trim() : String(value ?? '');
        setInputText(text);
      },
    });

    attachOptionAvailability(control, input, binding);

    const currentVector = readControlValue(store.get(), control);
    if (currentVector !== undefined && currentVector !== null) {
      binding.setValue(currentVector);
    } else if (control.default !== undefined) {
      if (typeof control.default === 'string' && allowDefaultPlaceholder) {
        input.placeholder = control.default;
      } else if (Array.isArray(control.default)) {
        binding.setValue(control.default);
      }
    }

    const showInvalid = () => {
      input.classList.add('is-invalid');
      const labelText = control?.label || control?.name || control?.item_id || 'vector';
      pushToast(`[${labelText}] invalid vector input (expected ${targetLength})`);
      if (input._invalidTimer) {
        clearTimeout(input._invalidTimer);
      }
      input._invalidTimer = setTimeout(() => {
        input.classList.remove('is-invalid');
      }, 1200);
      if (lastValidText) {
        input.value = lastValidText;
      } else {
        input.value = '';
      }
    };

    const commit = guardBinding(binding, async () => {
      const parsed = parseVector(input.value, targetLength);
      if (parsed) {
        lastValidText = formatVector(parsed);
        setInputText(lastValidText);
        await applySpecAction(store, backend, control, parsed);
        return;
      }
      showInvalid();
    });

    attachCommitHandlers(input, binding, commit);
  }

  function renderVectorInput(container, control, expectedLength) {
    renderVectorInputBase(container, control, {
      expectedLength,
      idSuffix: '__vector',
      formatValue: formatNumber,
      allowDefaultPlaceholder: true,
    });
  }

  function renderVec3StringInput(container, control) {
    renderVectorInputBase(container, control, {
      expectedLength: 3,
      idSuffix: '__vec3str',
      formatValue: formatNumberTrimmed,
      allowDefaultPlaceholder: false,
    });
  }

  function renderStatic(container, control) {
    if (control?.binding) {
      const { row, label, field } = createLabeledRow(control);
      const valueEl = document.createElement('span');
      valueEl.className = 'static-value';
      valueEl.textContent = '—';
      field.append(valueEl);
      container.append(row);
      const binding = createBinding(control, {
        getValue: () => valueEl.textContent,
        applyValue: (value) => {
          if (value === undefined || value === null || value === '') {
            valueEl.textContent = '—';
            valueEl.classList.add('is-muted');
            return;
          }
          valueEl.classList.remove('is-muted');
          valueEl.textContent = String(value);
        },
      });
      if (control.default !== undefined) {
        binding.setValue(control.default);
      }
      return;
    }
    const row = createControlRow(control, { full: true });
    row.classList.add('control-static');
    row.textContent = control.label ?? control.name ?? '';
    row.setAttribute('data-testid', control.item_id);
    container.append(row);
  }

  function renderWatchField(container, control) {
    const { row, input, field } = createTextInputField(container, control, {
      mode: 'text',
      idSuffix: '__watch',
    });
    input.placeholder = 'qpos';
    const datalist = document.createElement('datalist');
    datalist.id = `${input.id}__options`;
    input.setAttribute('list', datalist.id);
    field.append(input, datalist);
    container.append(row);

    const syncOptions = (state) => {
      const sources = state?.watch?.sources || {};
      datalist.innerHTML = '';
      Object.entries(sources).forEach(([key, meta]) => {
        const option = document.createElement('option');
        option.value = key;
        const len = Number(meta?.length) || 0;
        const labelText = meta?.label || (len ? `${key} (${len})` : key);
        option.label = labelText;
        datalist.append(option);
      });
    };

    const binding = createBinding(control, {
      getValue: () => input.value,
      applyValue: (value) => {
        input.value = value == null ? '' : String(value);
      },
    });

    binding.updateOptions = syncOptions;
    syncOptions(store.get());

    const commit = guardBinding(binding, async () => {
      const token = input.value.trim();
      await applySpecAction(store, backend, control, token);
    });

    attachCommitHandlers(input, binding, commit);
  }

  function renderKeyframeSelect(container, control) {
    const { row, label, field } = createLabeledRow(control);
    const selectId = `${sanitiseName(control.item_id)}__select`;
    label.setAttribute('for', selectId);
    const select = document.createElement('select');
    select.id = selectId;
    select.setAttribute('data-testid', control.item_id);
    field.append(select);
    container.append(row);

    let binding = null;
    const syncOptions = (state) => {
      const keyframes = state?.keyframes;
      const slots = Array.isArray(keyframes?.slots) && keyframes.slots.length
        ? keyframes.slots
        : (Array.isArray(keyframes?.labels)
            ? keyframes.labels.map((label, idx) => ({ index: idx, label, available: true, kind: 'user' }))
            : []);
      select.innerHTML = '';
      if (!slots.length) {
        const option = document.createElement('option');
        option.value = '-1';
        option.textContent = 'No keyframes';
        option.disabled = true;
        select.append(option);
        select.disabled = true;
        return;
      }
      select.disabled = false;
      slots.forEach((slot, idx) => {
        const option = document.createElement('option');
        const index = Number.isFinite(slot.index) ? slot.index : idx;
        option.value = String(index);
        const baseLabel = typeof slot.label === 'string' ? slot.label : `Key ${index}`;
        option.textContent = slot.available ? baseLabel : `${baseLabel} (empty)`;
        option.dataset.kind = slot.kind || 'user';
        option.dataset.available = slot.available ? '1' : '0';
        select.append(option);
      });
      const current = String(binding?.getValue?.() ?? -1);
      const hasValue = Array.from(select.options).some((opt) => opt.value === current);
      select.value = hasValue ? current : select.options[0].value;
    };

    binding = createBinding(control, {
      getValue: () => store.get()?.simulation?.keyIndex ?? -1,
      applyValue: (value) => {
        const token = String(Number.isFinite(value) ? value : -1);
        const hasValue = Array.from(select.options).some((opt) => opt.value === token);
        select.value = hasValue ? token : (select.options[0]?.value ?? '-1');
      },
    });

    binding.updateOptions = syncOptions;
    syncOptions(store.get());

    select.addEventListener(
      'change',
      guardBinding(binding, async () => {
        const nextIndex = Number(select.value);
        await applySpecAction(store, backend, control, Number.isFinite(nextIndex) ? nextIndex : 0);
      }),
    );

    return row;
  }

  function renderSimulationNoiseNotice(container) {
    const row = createControlRow(null, { full: true });
    const field = document.createElement('div');
    field.className = 'control-field';
    const notice = document.createElement('div');
    notice.className = 'control-static';
    notice.textContent = 'Noise controls are disabled in this build.';
    field.append(notice);
    row.append(field);
    container.append(row);
  }

  function renderSeparator(container, control) {
    const row = createControlRow(control, { full: true });
    const sep = document.createElement('div');
    sep.className = 'control-separator';
    sep.textContent = control.label ?? '';
    sep.setAttribute('data-testid', control.item_id);
    row.append(sep);
    container.append(row);
  }

  const CONTROL_RENDERERS = {
    checkbox: renderCheckbox,
    toggle: renderCheckbox,
    button: renderButton,
    'button-secondary': (container, control) => renderButton(container, control, 'secondary'),
    'button-primary': (container, control) => renderButton(container, control, 'primary'),
    'button-pill': (container, control) => renderButton(container, control, 'pill'),
    radio: renderRadio,
    select: renderSelect,
    slider: renderSlider,
    slider_int: renderSlider,
    slider_float: renderSlider,
    slider_num: renderSlider,
    slidernum: renderSlider,
    edit_int: (container, control) => renderEditInput(container, control, 'int'),
    edit_float: (container, control) => renderEditInput(container, control, 'float'),
    edit_text: (container, control) => renderEditInput(container, control, 'text'),
    edit_vec2: (container, control) => renderVectorInput(container, control, 2),
    edit_vec3: (container, control) => renderVec3StringInput(container, control),
    edit_vec3_string: (container, control) => renderVec3StringInput(container, control),
    edit_vec5: (container, control) => renderVectorInput(container, control, 5),
    edit_rgba: (container, control) => renderVectorInput(container, control, 4),
    static: renderStatic,
    separator: renderSeparator,
  };

  const CONTROL_OVERRIDES = {
    'simulation.run': renderRunToggle,
    'watch.field': renderWatchField,
    'option.visual_source': renderVisualSourceControl,
    'simulation.key_slider': renderKeyframeSelect,
    'option.profiler': renderDisabledCheckbox,
    'option.sensor': renderDisabledCheckbox,
  };
  const DISABLED_SHORTCUT_IDS = new Set(['option.profiler', 'option.sensor']);

  function renderControl(container, control) {
    const type = typeof control.type === 'string' ? control.type.toLowerCase() : 'static';
    const itemId = control?.item_id ?? '';
    if (control?.shortcut && !DISABLED_SHORTCUT_IDS.has(itemId)) {
      registerShortcutHandlers(control.shortcut, async (event) => {
        event?.preventDefault?.();
        if (type.startsWith('button')) {
          await applySpecAction(store, backend, control, {
            trigger: 'shortcut',
            shiftKey: !!event?.shiftKey,
            ctrlKey: !!event?.ctrlKey,
            altKey: !!event?.altKey,
            metaKey: !!event?.metaKey,
          });
          return;
        }
        await toggleControl(control.item_id);
      });
    }
    const override = CONTROL_OVERRIDES[itemId];
    if (override) {
      return override(container, control);
    }
    const renderer = CONTROL_RENDERERS[type] || renderStatic;
    return renderer(container, control);
  }

  function renderSection(container, section) {
    const sectionEl = document.createElement('section');
    sectionEl.className = 'ui-section';
    sectionEl.dataset.sectionId = section.section_id;
    sectionEl.setAttribute('data-testid', `section-${section.section_id}`);

    const header = document.createElement('div');
    header.className = 'section-header';

    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'section-toggle';
    toggle.textContent = section.title ?? section.section_id;

    const actions = document.createElement('div');
    actions.className = 'section-actions';
    const reset = document.createElement('button');
    reset.type = 'button';
    reset.className = 'section-reset';
    reset.title = 'Reset to defaults';
    reset.textContent = '?';
    reset.disabled = true;
    const chevron = document.createElement('span');
    chevron.className = 'section-chevron';
    chevron.setAttribute('aria-hidden', 'true');

    actions.append(reset, chevron);
    header.append(toggle, actions);

    const body = document.createElement('div');
    body.className = 'section-body';

    const setCollapsed = (collapsed) => {
      sectionEl.classList.toggle('is-collapsed', collapsed);
      toggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    };

    const initialCollapsed = false;
    setCollapsed(initialCollapsed);

    const toggleCollapsed = () => {
      const next = !sectionEl.classList.contains('is-collapsed');
      setCollapsed(next);
    };

    if (section?.shortcut) {
      registerShortcutHandlers(section.shortcut, (event) => {
        event?.preventDefault?.();
        toggleCollapsed();
      });
    }

    toggle.addEventListener('click', () => {
      toggleCollapsed();
    });
    header.addEventListener('click', (event) => {
      if (event.target === reset) return;
      if (event.target !== toggle) {
        toggleCollapsed();
      }
    });

    header.addEventListener('dblclick', (event) => {
      if (event.target === reset) return;
      event.preventDefault();
      event.stopPropagation();
      const sections = Array.from(container.querySelectorAll('.ui-section'));
      if (sections.length === 0) return;
      const allCollapsed = sections.every((sec) => sec.classList.contains('is-collapsed'));
      const collapseAll = !allCollapsed;
      sections.forEach((sec) => {
        sec.classList.toggle('is-collapsed', collapseAll);
        const btn = sec.querySelector('.section-toggle');
        if (btn) {
          btn.setAttribute('aria-expanded', collapseAll ? 'false' : 'true');
        }
      });
    });

    sectionEl.append(header, body);

    const resetTargets = [];
    if (section.section_id === 'file') {
      renderFileSectionExtras(body);
    } else {
      for (const item of section.items ?? []) {
        renderControl(body, item);
        if (section.section_id === 'simulation' && item?.item_id === 'simulation.save_key') {
          renderSimulationNoiseNotice(body);
        }
        if (!item?.item_id) continue;
        const resetValue = resolveResetValue(item);
        if (resetValue !== undefined) {
          resetTargets.push({ id: item.item_id, value: resetValue });
        }
      }
    }

    if (resetTargets.length > 0) {
      reset.disabled = false;
      reset.addEventListener('click', async (event) => {
        event.preventDefault();
        for (const target of resetTargets) {
          const control = controlById.get(target.id);
          if (!control) continue;
          try {
            const type = typeof control.type === 'string' ? control.type.toLowerCase() : '';
            let value = target.value;
            if (type === 'checkbox' || type === 'toggle') {
              value = coerceBoolean(value);
            }
            await applySpecAction(store, backend, control, value);
          } catch (error) {
            logWarn('[ui] reset failed', target.id, error);
          }
        }
      });
    } else {
      reset.disabled = true;
    }

    container.append(sectionEl);
  }

  function ensureDynamicList({
    sectionId,
    dynamicKey,
    items,
    className = '',
    marginTop = null,
    updateExisting,
    buildItem,
  }) {
    if (!rightPanel || !Array.isArray(items)) return;
    const section = rightPanel.querySelector(`[data-section-id="${sectionId}"]`);
    if (!section) return;
    const body = section.querySelector('.section-body');
    if (!body) return;
    let container = body.querySelector(`[data-dynamic="${dynamicKey}"]`);
    if (!container) {
      container = document.createElement('div');
      container.setAttribute('data-dynamic', dynamicKey);
      if (className) container.className = className;
      if (marginTop !== null) container.style.marginTop = marginTop;
      body.appendChild(container);
    }
    if (items.length === 0) {
      container.innerHTML = '';
      container.setAttribute('data-count', '0');
      return;
    }
    const prevCount = Number(container.getAttribute('data-count') || '0');
    if (prevCount === items.length && container.childElementCount > 0) {
      if (typeof updateExisting === 'function') {
        updateExisting(container, items);
      }
      return;
    }
    container.innerHTML = '';
    items.forEach((item, index) => {
      buildItem(container, item, index);
    });
    container.setAttribute('data-count', String(items.length));
  }

  function resolveListIndex(item, fallback) {
    const idx = Number(item?.index);
    return Number.isFinite(idx) ? idx : fallback;
  }

  function ensureDynamicSliders({
    sectionId,
    dynamicKey,
    items,
    itemIdPrefix,
    dataAttr,
    getIndex,
    getLabel,
    getRange,
    getValue,
    updateRange = false,
    onInput,
  }) {
    ensureDynamicList({
      sectionId,
      dynamicKey,
      items,
      marginTop: '8px',
      updateExisting: (containerEl, entries) => {
        for (let fallback = 0; fallback < entries.length; fallback += 1) {
          const item = entries[fallback];
          const index = getIndex(item, fallback);
          const slider = containerEl.querySelector(`input[type="range"][${dataAttr}="${index}"]`);
          if (!slider) continue;
          if (!slider.dataset.editing) slider.dataset.editing = '0';
          if (slider.dataset.editing === '1') continue;
          if (updateRange) {
            const range = getRange(item, fallback);
            if (Number(slider.min) !== range.min) slider.min = String(range.min);
            if (Number(slider.max) !== range.max) slider.max = String(range.max);
          }
          const nextValue = getValue(item, fallback);
          if (nextValue == null) continue;
          const numeric = Number(nextValue);
          if (!Number.isFinite(numeric)) continue;
          if (Number(slider.value) !== numeric) slider.value = String(numeric);
        }
      },
      buildItem: (containerEl, item, fallback) => {
        const index = getIndex(item, fallback);
        const row = createControlRow({ item_id: `${itemIdPrefix}${index}` });
        row.classList.add('half');
        const label = document.createElement('label');
        label.className = 'control-label';
        label.textContent = getLabel(item, fallback);
        const field = document.createElement('div');
        field.className = 'control-field';
        const input = document.createElement('input');
        input.type = 'range';
        const range = getRange(item, fallback);
        input.min = String(range.min);
        input.max = String(range.max);
        input.step = String(range.step);
        const initial = getValue(item, fallback);
        const initialValue = Number.isFinite(Number(initial)) ? Number(initial) : 0;
        input.value = String(initialValue);
        input.setAttribute(dataAttr, String(index));
        input.setAttribute('data-testid', `${itemIdPrefix}${index}`);
        input.dataset.editing = '0';
        input.addEventListener('focus', () => {
          input.dataset.editing = '1';
        });
        const clearEditing = () => {
          input.dataset.editing = '0';
        };
        input.addEventListener('blur', clearEditing);
        input.addEventListener('pointerup', clearEditing);
        input.addEventListener('pointerleave', clearEditing);
        field.appendChild(input);
        row.append(label, field);
        containerEl.appendChild(row);
        input.addEventListener('input', async () => {
          const idx = Number(index) | 0;
          const v = Number(input.value) || 0;
          await onInput({ index: idx, value: v, item, range });
        });
      },
    });
  }

  function renderPanels(spec) {
    if (!leftPanel || !rightPanel) return;
    controlById.clear();
    controlBindings.clear();
    shortcutHandlers.clear();
    leftPanel.innerHTML = '';
    rightPanel.innerHTML = '';
    for (const section of spec.left) {
      renderSection(leftPanel, section);
    }
    for (const section of spec.right) {
      renderSection(rightPanel, section);
    }
    installShortcuts();
  }

  function updateControls(state, { dirtyIds = null } = {}) {
    const hasDirty = Array.isArray(dirtyIds) && dirtyIds.length > 0;
    for (const [id, binding] of controlBindings.entries()) {
      if (hasDirty && !dirtyIds.includes(id)) continue;
      if (!binding || !binding.setValue) continue;
      if (typeof binding.updateOptions === 'function') {
        try {
          binding.updateOptions(state);
        } catch {}
      }
      if (binding.isEditing) continue;
      const control = controlById.get(id);
      if (!control) continue;
      const value = readControlValue(state, control);
      binding.setValue?.(value);
    }
  }

  async function toggleControl(id, overrideValue) {
    const control = controlById.get(id);
    if (!control) return;
    const current = readControlValue(store.get(), control);
    let next = overrideValue;

    if (next === undefined) {
      if (control.type === 'radio' && Array.isArray(control.options)) {
        const options = normaliseOptions(control.options);
        const currentLabel = typeof current === 'string' ? current : options[0];
        const currentIndex = options.findIndex((opt) => opt === currentLabel);
        const nextIndex = currentIndex === 0 ? 1 : 0;
        next = options[nextIndex] ?? options[0];
      } else if (control.type === 'select') {
        const options = normaliseOptions(control.options);
        const currentLabel = typeof current === 'string' ? current : options[0];
        const currentIndex = options.findIndex((opt) => opt === currentLabel);
        const nextIndex = (currentIndex + 1) % (options.length || 1);
        next = options[nextIndex] ?? options[0];
      } else {
        next = !coerceBoolean(current);
      }
    }

    await applySpecAction(store, backend, control, next);
  }

  async function cycleCamera(delta) {
    const control = controlById.get('rendering.camera_mode');
    if (!control) return;
    const current = store.get().runtime.cameraIndex | 0;
    const total = getCameraModeCount();
    const next = (current + delta + total) % total;
    await applySpecAction(store, backend, control, next);
  }

  function installShortcuts() {
    if (shortcutsInstalled) return;
    const root = shortcutRoot || leftPanel?.ownerDocument?.body || rightPanel?.ownerDocument?.body;
    if (!root || typeof root.addEventListener !== 'function') return;
    const handler = (event) => {
      const target = event?.target;
      if (elementIsEditable(target)) return;
      if (hasEditableFocus(root)) return;
      const combo = shortcutFromEvent(event);
      if (!combo) return;
      const list = shortcutHandlers.get(combo);
      if (!list || list.length === 0) return;
      for (const fn of list) {
        try {
          const result = fn(event);
          if (result && typeof result.then === 'function') {
            result.catch?.((error) => logWarn('[ui] shortcut handler error', error));
          }
        } catch (error) {
          logWarn('[ui] shortcut handler error', error);
        }
      }
    };
    root.addEventListener('keydown', handler, { capture: true });
    eventCleanup.push(() => {
      try {
        root.removeEventListener('keydown', handler, { capture: true });
      } catch {}
      shortcutsInstalled = false;
    });
    shortcutsInstalled = true;
  }

    function dispose() {
      while (eventCleanup.length) {
        const fn = eventCleanup.pop();
        try {
          fn();
      } catch {}
    }
    controlById.clear();
    controlBindings.clear();
    shortcutHandlers.clear();
    shortcutsInstalled = false;
  }

  return {
    loadUiSpec,
    renderPanels,
    updateControls,
      toggleControl,
      cycleCamera,
      loadXmlTextAsModel,
      getBinding: (id) => controlBindings.get(id) ?? null,
      registerGlobalShortcut,
      listIds: (prefix) => {
      const ids = Array.from(controlById.keys()).sort();
      if (!prefix) return ids;
      return ids.filter((id) => id.startsWith(prefix));
    },
    getControl: (id) => controlById.get(id) ?? null,
      // Dynamic: ensure Actuator sliders exist under right panel 'control' section
    ensureActuatorSliders: (actuators, ctrlValues = []) => {
        try {
          ensureDynamicSliders({
            sectionId: 'control',
            dynamicKey: 'actuators',
            items: actuators,
            itemIdPrefix: 'control.act.',
            dataAttr: 'data-act-index',
            getIndex: (item, fallback) => resolveListIndex(item, fallback),
            getLabel: (item, fallback) => item.name ?? `Act ${resolveListIndex(item, fallback)}`,
            getRange: (item) => ({
              min: Number.isFinite(item.min) ? item.min : -1,
              max: Number.isFinite(item.max) ? item.max : 1,
              step: Number.isFinite(item.step) && item.step > 0 ? item.step : 0.001,
            }),
            getValue: (item, fallback) => {
              const index = resolveListIndex(item, fallback);
              const raw = Array.isArray(ctrlValues) && Number.isFinite(Number(ctrlValues[index]))
                ? Number(ctrlValues[index])
                : (ctrlValues?.[index] ?? null);
              if (raw == null) return null;
              const numeric = Number(raw);
              return Number.isFinite(numeric) ? numeric : null;
            },
            onInput: async ({ index, value }) => {
              try {
                await applySpecAction(store, backend, { item_id: 'control.actuator' }, { index, value });
              } catch (err) {
                logWarn('[ui] set actuator failed', err);
              }
            },
          });
      } catch (err) {
        logWarn('[ui] ensureActuatorSliders error', err);
        }
      },
    // Dynamic: ensure Joint sliders exist under right panel 'joint' section
    ensureJointSliders: (dofs = []) => {
      try {
        ensureDynamicSliders({
          sectionId: 'joint',
          dynamicKey: 'joints',
          items: dofs,
          itemIdPrefix: 'joint.',
          dataAttr: 'data-joint-index',
          getIndex: (item, fallback) => resolveListIndex(item, fallback),
          getLabel: (item, fallback) => item.label || `Joint ${resolveListIndex(item, fallback)}`,
          getRange: (item) => ({
            min: item.min,
            max: item.max,
            step: Number.isFinite(item.step) && item.step > 0
              ? item.step
              : Math.max((item.max - item.min) / 500, 0.0001),
          }),
          getValue: (item) => (Number.isFinite(item.value) ? item.value : 0),
          updateRange: true,
          onInput: async ({ index, value, range }) => {
            try {
              await applySpecAction(store, backend, { item_id: 'joint.slider' }, {
                index,
                value,
                min: range.min,
                max: range.max,
              });
            } catch (err) {
              logWarn('[ui] set joint qpos failed', err);
            }
          },
        });
      } catch (err) {
        logWarn('[ui] ensureJointSliders error', err);
      }
    },
    // Dynamic: ensure Equality toggles exist under right panel 'equality' section
    ensureEqualityToggles: (eqs = []) => {
      try {
        ensureDynamicList({
          sectionId: 'equality',
          dynamicKey: 'equality',
          items: eqs,
          className: 'equality-toggle-container',
          updateExisting: (container, entries) => {
            // Stable update: only sync active state and label,不重建 DOM，避免交互时节点被移除
            for (const eq of entries) {
              const checkbox = container.querySelector(
                `input[type="checkbox"][data-eq-index="${eq.index}"]`,
              );
              if (!checkbox) continue;
              const active = !!eq.active;
              checkbox.checked = active;
              checkbox.setAttribute('aria-checked', active ? 'true' : 'false');
              const labelEl = checkbox.closest('label.bool-button');
              if (labelEl) {
                labelEl.classList.toggle('is-active', active);
              }
              const text = checkbox.nextElementSibling;
              if (text && text.classList.contains('bool-text')) {
                text.textContent = eq.label || `Equality ${eq.index}`;
              }
            }
          },
          buildItem: (container, eq) => {
            const control = { item_id: `equality.${eq.index}`, label: eq.label || `Equality ${eq.index}` };
            const row = createControlRow(control);
            row.classList.add('bool-row');
            const label = document.createElement('label');
            label.className = 'bool-button bool-label';
            const input = document.createElement('input');
            input.type = 'checkbox';
            input.setAttribute('role', 'switch');
            input.setAttribute('data-testid', control.item_id);
            input.setAttribute('data-eq-index', String(eq.index));
            const active = !!eq.active;
            input.checked = active;
            input.setAttribute('aria-checked', active ? 'true' : 'false');
            if (active) label.classList.add('is-active');
            const span = document.createElement('span');
            span.className = 'bool-text';
            span.textContent = control.label;
            label.append(input, span);
            row.append(label);
            container.appendChild(row);
            input.addEventListener('change', async (event) => {
              event.stopPropagation();
              const next = !!input.checked;
              label.classList.toggle('is-active', next);
              const eqName = eq.fullLabel || eq.label || `Eq ${eq.index}`;
              pushToast(`${next ? 'Enabled' : 'Disabled'} equality: ${eqName}`);
              try {
                await applySpecAction(store, backend, { item_id: 'equality.toggle' }, { index: eq.index, active: next });
              } catch (err) {
                logWarn('[ui] equality toggle failed', err);
              }
            });
          },
        });
      } catch (err) {
        logWarn('[ui] ensureEqualityToggles error', err);
      }
    },
    dispose,
  };
  const getCameraModeCount = () => {
    try {
      return Math.max(1, 2 + (store.get()?.model?.cameras?.length || 0));
    } catch {
      return Math.max(1, cameraPresets.length || 1);
    }
  };

}

function createCameraController({
  THREE_NS,
  canvas,
  store,
  backend,
  onGesture,
  renderCtx,
  debugMode = false,
  globalUp = new THREE_NS.Vector3(0, 0, 1),
  // new options (high‑leverage changes)
  minDistance,
  getMinDistance,
  zoomK = 0.35,
  maxWheelStep,
  invertY = false,
  keyRoot = null,
  assertUp = false,
  wheelLineFactor = 16,
  wheelPageFactor = 800,
  minOrthoZoom = 0.05,
  maxOrthoZoom = 200,
}) {
  const pointerState = {
    id: null,
    mode: 'idle',
    lastX: null,
    lastY: null,
    active: false,
  };

  const modifierState = {
    ctrl: false,
    shift: false,
    alt: false,
    meta: false,
  };

  const tempVecA = new THREE_NS.Vector3();
  const tempVecB = new THREE_NS.Vector3();
  const tempVecC = new THREE_NS.Vector3();
  const tempVecD = new THREE_NS.Vector3();
  const tempSpherical = new THREE_NS.Spherical();

  const cleanup = [];
  let initialised = false;
  let upNormalised = new THREE_NS.Vector3().copy(globalUp).normalize();
  let up0 = upNormalised.clone();

  const cameraModeIndex = () => {
    try {
      return store.get()?.runtime?.cameraIndex ?? 0;
    } catch {
      return 0;
    }
  };

  const isInteractiveCamera = () => cameraModeIndex() <= 1;

  function currentCtrl(event) {
    return !!event?.ctrlKey || modifierState.ctrl;
  }

  function currentShift(event) {
    return !!event?.shiftKey || modifierState.shift;
  }

  function resolveGestureMode(event) {
    const btn = typeof event.button === 'number' ? event.button : 0;
    if (currentCtrl(event)) return 'rotate';
    if (currentShift(event)) return 'translate';
    if (btn === 2) return 'translate';
    if (btn === 1) return 'zoom';
    return 'orbit';
  }

  function pointerButtons(event) {
    if (event && typeof event.buttons === 'number') return event.buttons;
    if (event && typeof event.button === 'number') {
      switch (event.button) {
        case 0:
          return 1;
        case 1:
          return 4;
        case 2:
          return 2;
        default:
          return 1 << event.button;
      }
    }
    return 0;
  }

  function computeMinDistance(camera, target) {
    if (Number.isFinite(minDistance)) return Math.max(0.01, Number(minDistance));
    if (typeof getMinDistance === 'function') {
      const v = Number(getMinDistance(camera, target, renderCtx));
      if (Number.isFinite(v) && v > 0) return Math.max(0.01, v);
    }
    return 0.15;
  }

  function applyCameraGesture(mode, dx, dy) {
    const ctx = renderCtx;
    const camera = ctx.camera;
    if (!camera) return;
    if (!ctx.cameraTarget) {
      ctx.cameraTarget = new THREE_NS.Vector3(0, 0, 0);
    }
    const target = ctx.cameraTarget;
    const offset = tempVecA.copy(camera.position).sub(target);
    const distance = offset.length();
    const minDist = computeMinDistance(camera, target);
    if (assertUp && renderCtx?.camera) {
      try {
        const dot = renderCtx.camera.up.clone().normalize().dot(up0);
        if (dot < 0.999) {
          renderCtx.camera.up.copy(upNormalised);
        }
      } catch {}
    }

    const elementWidth = canvas?.clientWidth || (typeof window !== 'undefined' ? window.innerWidth : 1) || 1;
    const elementHeight = canvas?.clientHeight || (typeof window !== 'undefined' ? window.innerHeight : 1) || 1;
    const shortEdge = Math.max(1, Math.min(elementWidth, elementHeight));
    const fovRad = THREE_NS.MathUtils.degToRad(typeof camera.fov === 'number' ? camera.fov : 45);
    const isOrtho = !!camera.isOrthographicCamera;

    switch (mode) {
      case 'translate': {
        const dyEff = invertY ? -dy : dy;
        let moveX = 0;
        let moveY = 0;
        if (isOrtho && typeof camera.zoom === 'number') {
          const zoom = Math.max(1e-6, camera.zoom || 1);
          const widthWorld = Math.abs((camera.right ?? 1) - (camera.left ?? -1)) / zoom;
          const heightWorld = Math.abs((camera.top ?? 1) - (camera.bottom ?? -1)) / zoom;
          moveX = -dx * (widthWorld / elementWidth);
          moveY = dyEff * (heightWorld / elementHeight);
        } else {
          const panScale = distance * Math.tan(fovRad / 2);
          moveX = (-2 * dx * panScale) / shortEdge;
          moveY = (2 * dyEff * panScale) / shortEdge;
        }
        const forward = tempVecB;
        camera.getWorldDirection(forward).normalize();
        const up = tempVecD.copy(upNormalised);
        const right = tempVecC.copy(forward).cross(up).normalize();
        const pan = right.multiplyScalar(moveX).add(up.multiplyScalar(moveY));
        camera.position.add(pan);
        target.add(pan);
        camera.lookAt(target);
        break;
      }
      case 'zoom': {
        if (isOrtho && typeof camera.zoom === 'number') {
          const base = Math.max(1e-6, camera.zoom || 1);
          const factor = Math.exp((dy / shortEdge) * (Number.isFinite(zoomK) ? zoomK * 0.2 : 0.07));
          const nextZoom = THREE_NS.MathUtils.clamp(base * factor, minOrthoZoom, maxOrthoZoom);
          camera.zoom = nextZoom;
          if (typeof camera.updateProjectionMatrix === 'function') camera.updateProjectionMatrix();
        } else {
          const zoomSpeed = distance * 0.002;
          const delta = dy * zoomSpeed;
          const newLen = Math.max(minDist, distance + delta);
          offset.setLength(newLen);
          camera.position.copy(tempVecC.copy(target).add(offset));
          camera.lookAt(target);
        }
        break;
      }
      case 'rotate': {
        let yaw = (1.6 * Math.PI * dx) / elementWidth;
        let pitch = (1.6 * Math.PI * (invertY ? -dy : dy)) / elementHeight;
        if (distance <= minDist * 1.05) {
          yaw *= 0.35;
          pitch *= 0.35;
        }
        const up = tempVecD.copy(upNormalised);
        const forward = tempVecB.copy(target).sub(camera.position).normalize();
        const right = tempVecC.copy(forward).cross(up).normalize();
        forward.applyAxisAngle(up, -yaw);
        forward.applyAxisAngle(right, -pitch);
        forward.normalize();
        const nextTarget = tempVecA.copy(camera.position).add(forward.multiplyScalar(distance));
        target.copy(nextTarget);
        camera.lookAt(target);
        break;
      }
      case 'orbit':
      default: {
        const dyEff = invertY ? -dy : dy;
        const radiansPerPixel = Math.PI / shortEdge;
        const thetaDelta = -dx * radiansPerPixel;
        const phiDelta = -dyEff * radiansPerPixel;
        tempSpherical.setFromVector3(offset);
        tempSpherical.theta += thetaDelta;
        tempSpherical.phi += phiDelta;
        tempSpherical.makeSafe();
        tempSpherical.radius = Math.max(minDist, tempSpherical.radius);
        offset.setFromSpherical(tempSpherical);
        camera.position.copy(tempVecC.copy(target).add(offset));
        camera.lookAt(target);
        break;
      }
    }
  }

  function handlePointerDown(event) {
    if (!event || !isInteractiveCamera()) return;
    const mode = resolveGestureMode(event);
    pointerState.id = event.pointerId ?? event.pointerId === 0 ? event.pointerId : 'mouse';
    pointerState.active = true;
    pointerState.mode = mode;
    pointerState.lastX = event.clientX;
    pointerState.lastY = event.clientY;
    if (canvas && typeof canvas.setPointerCapture === 'function' && event.pointerId != null) {
      try { canvas.setPointerCapture(event.pointerId); } catch {}
    }
    if (typeof onGesture === 'function') {
      onGesture({ mode, phase: 'start', pointer: event });
    }
  }

  function handlePointerMove(event) {
    if (!event || !pointerState.active) return;
    if (pointerState.id !== (event.pointerId ?? pointerState.id)) return;
    const dx = (event.clientX ?? 0) - (pointerState.lastX ?? event.clientX ?? 0);
    const dy = (event.clientY ?? 0) - (pointerState.lastY ?? event.clientY ?? 0);
    pointerState.lastX = event.clientX;
    pointerState.lastY = event.clientY;
    if (!dx && !dy) return;
    applyCameraGesture(pointerState.mode, dx, dy);
    if (typeof onGesture === 'function') {
      onGesture({ mode: pointerState.mode, phase: 'update', pointer: event, drag: { dx, dy } });
    }
  }

  function handlePointerUp(event) {
    if (!event || !pointerState.active) return;
    if (pointerState.id !== (event.pointerId ?? pointerState.id)) return;
    if (typeof onGesture === 'function') {
      onGesture({ mode: pointerState.mode, phase: 'end', pointer: event });
    }
    pointerState.active = false;
    pointerState.id = null;
    pointerState.mode = 'idle';
    pointerState.lastX = null;
    pointerState.lastY = null;
    if (canvas && typeof canvas.releasePointerCapture === 'function' && event.pointerId != null) {
      try { canvas.releasePointerCapture(event.pointerId); } catch {}
    }
  }

  function handleWheel(event) {
    if (!event || !isInteractiveCamera()) return;
    if (typeof event.preventDefault === 'function') event.preventDefault();
    let dy = event.deltaY;
    if (event.deltaMode === 1) dy *= wheelLineFactor;
    if (event.deltaMode === 2) dy *= wheelPageFactor;
    if (Number.isFinite(maxWheelStep)) {
      dy = Math.max(-maxWheelStep, Math.min(maxWheelStep, dy));
    }
    applyCameraGesture('zoom', 0, dy);
    if (typeof onGesture === 'function') {
      onGesture({ mode: 'zoom', phase: 'update', pointer: event, drag: { dx: 0, dy } });
    }
  }

  function handleKey(event, nextState) {
    if (!event) return;
    if (typeof event.key !== 'string') return;
    const key = event.key.toLowerCase();
    if (key === 'control') modifierState.ctrl = nextState;
    if (key === 'shift') modifierState.shift = nextState;
    if (key === 'alt') modifierState.alt = nextState;
    if (key === 'meta') modifierState.meta = nextState;
  }

  function install() {
    if (initialised) return;
    initialised = true;
    if (!canvas) return;
    const root = keyRoot || canvas;
    const onPointerDown = (event) => handlePointerDown(event);
    const onPointerMove = (event) => handlePointerMove(event);
    const onPointerUp = (event) => handlePointerUp(event);
    const onWheel = (event) => handleWheel(event);
    const onKeyDown = (event) => handleKey(event, true);
    const onKeyUp = (event) => handleKey(event, false);
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerUp);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    if (root) {
      root.addEventListener('keydown', onKeyDown);
      root.addEventListener('keyup', onKeyUp);
    }
    cleanup.push(() => {
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerUp);
      canvas.removeEventListener('wheel', onWheel);
      if (root) {
        root.removeEventListener('keydown', onKeyDown);
        root.removeEventListener('keyup', onKeyUp);
      }
    });
  }

  function dispose() {
    while (cleanup.length) {
      const fn = cleanup.pop();
      try { fn(); } catch {}
    }
  }

  return {
    install,
    setup: install,
    dispose,
    applyGesture: applyCameraGesture,
    getModifierState: () => ({ ...modifierState }),
    isInteractiveCamera,
  };
}

function defaultSelection() {
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

const PERTURB_LABEL = {
  translate: 'perturb-translate',
  rotate: 'perturb-rotate',
};

const STATIC_PICK_BLOCK = { blocked: 'static' };

function createPickingController({
  THREE_NS = THREE,
  canvas,
  store,
  backend,
  renderCtx,
  debugMode = false,
  globalUp = new THREE_NS.Vector3(0, 0, 1),
  getSnapshot = null,
} = {}) {
  if (!canvas || !store || !backend || !renderCtx) {
    throw new Error('Picking controller requires canvas, store, backend, and renderCtx.');
  }
  const raycaster = new THREE_NS.Raycaster();
  const pointerNdc = new THREE_NS.Vector2();
  const normalMatrix = new THREE_NS.Matrix3();
  const tempQuat = new THREE_NS.Quaternion();
  const tempMat4 = new THREE_NS.Matrix4();
  const tempMat4B = new THREE_NS.Matrix4();
  const tempVecA = new THREE_NS.Vector3();
  const dragState = {
    active: false,
    pointerId: null,
    mode: 'idle',
    lastX: 0,
    lastY: 0,
    shiftKey: false,
    anchorLocal: new THREE_NS.Vector3(),
    bodyId: -1,
  };
  const cleanup = [];
  const tempBodyPos = new THREE_NS.Vector3();
  const tempBodyCom = new THREE_NS.Vector3();
  const tempBodyRot = new Float64Array(9);
  const tempVecLocal = new THREE_NS.Vector3();
  const tempVecWorld = new THREE_NS.Vector3();
  const tempCameraOffset = new THREE_NS.Vector3();
  let lastRightDownTime = 0;
  let lastRightDownCtrl = false;

  function hasSelection() {
    const sel = store.get()?.runtime?.selection;
    return !!sel && Number.isInteger(sel.geom) && sel.geom >= 0;
  }

  function currentSelection() {
    return store.get()?.runtime?.selection || null;
  }

  function selectionSeq(nextSeq) {
    return Number.isFinite(nextSeq) ? nextSeq : (currentSelection()?.seq || 0) + 1;
  }

  function clearSelection({ toast = false } = {}) {
    store.update((draft) => {
      if (!draft.runtime) draft.runtime = {};
      const prevSeq = (draft.runtime.selection?.seq || 0) + 1;
      draft.runtime.selection = { ...defaultSelection(), seq: prevSeq, timestamp: Date.now() };
      draft.runtime.lastAction = 'select-none';
      if (toast) {
        draft.toast = { message: 'Selection cleared', ts: Date.now() };
      }
    });
    dragState.bodyId = -1;
  }

  function showToast(message) {
    if (!message) return;
    const ts = Date.now();
    store.update((draft) => {
      draft.toast = { message, ts };
    });
  }

  function updateSelection(pick) {
    if (!pick) return;
    const ts = Date.now();
    store.update((draft) => {
      if (!draft.runtime) draft.runtime = {};
      const seq = (draft.runtime.selection?.seq || 0) + 1;
      draft.runtime.selection = {
        geom: pick.geomIndex,
        body: pick.bodyId,
        joint: pick.jointId,
        name: pick.geomName,
        kind: 'geom',
        point: [pick.worldPoint.x, pick.worldPoint.y, pick.worldPoint.z],
        localPoint: [pick.localPoint.x, pick.localPoint.y, pick.localPoint.z],
        normal: [pick.worldNormal.x, pick.worldNormal.y, pick.worldNormal.z],
        seq,
        timestamp: ts,
      };
      draft.runtime.lastAction = 'select';
      draft.toast = { message: `Selected ${pick.geomName}`, ts };
    });
    if (pick.bodyId >= 0) {
      dragState.bodyId = pick.bodyId;
      setAnchorLocalFromWorld(pick.bodyId, pick.worldPoint);
    }
  }

  function getMeshList() {
    const list = [];
    const batches = renderCtx?._instancing?.batches || null;
    if (batches instanceof Map) {
      for (const batch of batches.values()) {
        const mesh = batch?.mesh || null;
        const count = typeof mesh?.count === 'number' ? (mesh.count | 0) : 0;
        if (mesh && mesh.visible !== false && count > 0) {
          list.push(mesh);
        }
      }
    }
    if (Array.isArray(renderCtx.meshes)) {
      for (const mesh of renderCtx.meshes) {
        if (mesh && mesh.visible !== false) list.push(mesh);
      }
    }
    return list;
  }

  function projectPointer(event) {
    const rect = canvas.getBoundingClientRect();
    const width = Math.max(1, rect.width);
    const height = Math.max(1, rect.height);
    pointerNdc.x = ((event.clientX - rect.left) / width) * 2 - 1;
    pointerNdc.y = -(((event.clientY - rect.top) / height) * 2 - 1);
    return { width, height };
  }

  function resolveGeomMesh(object) {
    let current = object;
    while (current) {
      if (typeof current.userData?.geomIndex === 'number') {
        return current;
      }
      current = current.parent;
    }
    return null;
  }

  function geomNameFor(index) {
    const mesh = Array.isArray(renderCtx.meshes) ? renderCtx.meshes[index] : null;
    if (mesh?.userData?.geomName) {
      return mesh.userData.geomName;
    }
    const state = store.get();
    const geoms = Array.isArray(state?.model?.geoms) ? state.model.geoms : [];
    for (const geom of geoms) {
      if ((geom?.index | 0) === index) {
        return (geom?.name || `Geom ${index}`).trim();
      }
    }
    return `Geom ${index}`;
  }

  function bodyIdFor(index) {
    const mesh = Array.isArray(renderCtx.meshes) ? renderCtx.meshes[index] : null;
    if (Number.isFinite(mesh?.userData?.geomBodyId)) {
      return mesh.userData.geomBodyId | 0;
    }
    const state = store.get();
    const arr = state?.model?.geomBodyId;
    if (!arr) return -1;
    try {
      return arr[index] ?? -1;
    } catch {
      return -1;
    }
  }

  function jointIdFor(bodyId) {
    if (!(bodyId >= 0)) return -1;
    const state = store.get();
    const bodyAdr = state?.model?.bodyJntAdr;
    const bodyNum = state?.model?.bodyJntNum;
    const jtype = state?.model?.jntType;
    if (!bodyAdr || !bodyNum || !jtype) return -1;
    const base = bodyAdr[bodyId] ?? -1;
    const num = bodyNum[bodyId] ?? 0;
    if (!(num > 0)) return -1;
    const j = base >= 0 ? (base | 0) : -1;
    if (j < 0 || j >= jtype.length) return -1;
    return j;
  }

  function applySelectionFromPick(pick, event = null) {
    updateSelection(pick);
    if (!event) return;
    if (event.shiftKey) {
      store.update((draft) => {
        if (!draft.runtime) draft.runtime = {};
        draft.runtime.trackingGeom = pick.geomIndex;
      });
      const trackingCtrl = { item_id: 'simulation.tracking_geom', type: 'select' };
      const cameraCtrl = { item_id: 'simulation.camera', type: 'select' };
      Promise.resolve(
        applySpecAction(store, backend, trackingCtrl, pick.geomIndex),
      )
        .then(() => applySpecAction(store, backend, cameraCtrl, 1))
        .catch(() => {});
    }
  }

  function resolveDragMode(event) {
    if (event.ctrlKey) return 'rotate';
    if (event.shiftKey) return 'translate';
    if (event.button === 2) return 'translate';
    return 'rotate';
  }

  function selectionAsBody() {
    const sel = currentSelection();
    if (!sel || sel.body < 0) return null;
    return sel.body;
  }

  function updateAnchorFromSelection() {
    const sel = currentSelection();
    if (!sel || sel.body < 0 || !sel.point) return;
    tempVecA.set(sel.point[0], sel.point[1], sel.point[2]);
    setAnchorLocalFromWorld(sel.body, tempVecA);
  }

  function setAnchorLocalFromWorld(bodyId, worldPoint) {
    const snapshot = typeof getSnapshot === 'function' ? getSnapshot() : null;
    if (!snapshot || !snapshot.body_xpos || !snapshot.body_xmat) return;
    const base = bodyId * 3;
    const baseMat = bodyId * 9;
    if (!snapshot.body_xpos || !snapshot.body_xmat) return;
    tempBodyPos.set(
      snapshot.body_xpos[base + 0] ?? 0,
      snapshot.body_xpos[base + 1] ?? 0,
      snapshot.body_xpos[base + 2] ?? 0,
    );
    tempBodyRot.set([
      snapshot.body_xmat[baseMat + 0] ?? 1,
      snapshot.body_xmat[baseMat + 1] ?? 0,
      snapshot.body_xmat[baseMat + 2] ?? 0,
      snapshot.body_xmat[baseMat + 3] ?? 0,
      snapshot.body_xmat[baseMat + 4] ?? 1,
      snapshot.body_xmat[baseMat + 5] ?? 0,
      snapshot.body_xmat[baseMat + 6] ?? 0,
      snapshot.body_xmat[baseMat + 7] ?? 0,
      snapshot.body_xmat[baseMat + 8] ?? 1,
    ]);
    tempQuat.setFromRotationMatrix(tempMat4.set(
      tempBodyRot[0], tempBodyRot[1], tempBodyRot[2], 0,
      tempBodyRot[3], tempBodyRot[4], tempBodyRot[5], 0,
      tempBodyRot[6], tempBodyRot[7], tempBodyRot[8], 0,
      0, 0, 0, 1,
    ));
    tempVecLocal.copy(worldPoint).sub(tempBodyPos);
    tempVecLocal.applyQuaternion(tempQuat.invert());
    dragState.anchorLocal.copy(tempVecLocal);
  }

  function readBodyPose(bodyId, outPos, outRot) {
    const snapshot = typeof getSnapshot === 'function' ? getSnapshot() : null;
    if (!snapshot || !snapshot.body_xpos || !snapshot.body_xmat) return false;
    const base = bodyId * 3;
    const baseMat = bodyId * 9;
    outPos.set(
      snapshot.body_xpos[base + 0] ?? 0,
      snapshot.body_xpos[base + 1] ?? 0,
      snapshot.body_xpos[base + 2] ?? 0,
    );
    outRot.set([
      snapshot.body_xmat[baseMat + 0] ?? 1,
      snapshot.body_xmat[baseMat + 1] ?? 0,
      snapshot.body_xmat[baseMat + 2] ?? 0,
      snapshot.body_xmat[baseMat + 3] ?? 0,
      snapshot.body_xmat[baseMat + 4] ?? 1,
      snapshot.body_xmat[baseMat + 5] ?? 0,
      snapshot.body_xmat[baseMat + 6] ?? 0,
      snapshot.body_xmat[baseMat + 7] ?? 0,
      snapshot.body_xmat[baseMat + 8] ?? 1,
    ]);
    return true;
  }

  function resolvePick(event) {
    const { width, height } = projectPointer(event);
    const camera = renderCtx.camera;
    if (!camera) return null;
    raycaster.setFromCamera(pointerNdc, camera);
    const list = getMeshList();
    if (!list.length) return null;
    const hits = raycaster.intersectObjects(list, true);
    if (!hits.length) return null;
    const hit = hits.find((entry) => entry?.object && entry?.point);
    if (!hit) return null;
    const mesh = resolveGeomMesh(hit.object);
    if (!mesh) return null;
    const geomIndex = mesh.userData?.geomIndex ?? -1;
    if (!(geomIndex >= 0)) return null;
    const geomName = mesh.userData?.geomName || geomNameFor(geomIndex);
    const bodyId = bodyIdFor(geomIndex);
    if (mesh.userData?.geomStatic) {
      return { blocked: 'static', geomIndex, geomName };
    }
    const normal = hit.face?.normal || null;
    if (!normal) return null;
    const worldNormal = normal.clone().applyMatrix3(normalMatrix.getNormalMatrix(hit.object.matrixWorld)).normalize();
    const localPoint = hit.point.clone();
    hit.object.worldToLocal(localPoint);
    return {
      geomIndex,
      geomName,
      bodyId,
      jointId: jointIdFor(bodyId),
      worldPoint: hit.point.clone(),
      localPoint,
      worldNormal,
      screen: { width, height },
    };
  }

  function selectionFromPick(pick, event) {
    if (!pick) return null;
    if (pick.blocked === 'static') return STATIC_PICK_BLOCK;
    if (!Number.isFinite(pick.geomIndex) || pick.geomIndex < 0) return null;
    applySelectionFromPick(pick, event);
    return pick;
  }

  function updatePerturb(pointWorld, mode) {
    const bodyId = dragState.bodyId;
    if (!(bodyId >= 0)) return;
    const outPos = tempBodyPos;
    if (!readBodyPose(bodyId, outPos, tempBodyRot)) return;
    tempQuat.setFromRotationMatrix(tempMat4.set(
      tempBodyRot[0], tempBodyRot[1], tempBodyRot[2], 0,
      tempBodyRot[3], tempBodyRot[4], tempBodyRot[5], 0,
      tempBodyRot[6], tempBodyRot[7], tempBodyRot[8], 0,
      0, 0, 0, 1,
    ));
    const anchorWorld = dragState.anchorLocal.clone().applyQuaternion(tempQuat).add(outPos);
    const action = mode === 'translate' ? 'translate' : 'rotate';
    const payload = {
      kind: 'gesture',
      mode: action,
      phase: 'update',
      pointer: {
        x: 0,
        y: 0,
        dx: 0,
        dy: 0,
      },
      drag: {
        dx: pointWorld.x - anchorWorld.x,
        dy: pointWorld.y - anchorWorld.y,
        dz: pointWorld.z - anchorWorld.z,
      },
      target: {
        body: bodyId,
        anchor: [anchorWorld.x, anchorWorld.y, anchorWorld.z],
      },
    };
    backend.apply?.(payload);
    store.update((draft) => {
      if (!draft.runtime) draft.runtime = {};
      if (!draft.runtime.perturb) {
        draft.runtime.perturb = { mode: 'idle', active: false };
      }
      draft.runtime.perturb.mode = mode;
      draft.runtime.perturb.active = true;
      draft.runtime.lastAction = action;
    });
  }

  function onPointerDown(event) {
    if (!event) return;
    if (event.button === 2) {
      lastRightDownTime = Date.now();
      lastRightDownCtrl = !!event.ctrlKey;
    }
  }

  function onPointerUp(event) {
    if (!event) return;
    if (event.button === 2) {
      const dt = Date.now() - lastRightDownTime;
      if (dt < 260 && lastRightDownCtrl && hasSelection()) {
        clearSelection({ toast: true });
        return;
      }
    }
  }

  function onClick(event) {
    if (!event) return;
    if (event.button !== 0) return;
    const pick = resolvePick(event);
    if (pick === STATIC_PICK_BLOCK) {
      showToast('Selection blocked (static geom)');
      return;
    }
    selectionFromPick(pick, event);
  }

  function onDoubleClick(event) {
    if (!event) return;
    const pick = resolvePick(event);
    if (pick === STATIC_PICK_BLOCK) {
      showToast('Selection blocked (static geom)');
      return;
    }
    const result = selectionFromPick(pick, event);
    if (!result || !result.geomIndex) return;
    updateAnchorFromSelection();
  }

  function onPointerMove(event) {
    if (!dragState.active || dragState.pointerId !== event.pointerId) return;
    const pick = resolvePick(event);
    if (!pick || pick.blocked) return;
    const point = pick.worldPoint;
    dragState.lastX = event.clientX;
    dragState.lastY = event.clientY;
    const mode = dragState.mode;
    updatePerturb(point, mode);
  }

  function onPointerDragStart(event) {
    if (!event) return;
    if (!hasSelection()) return;
    dragState.active = true;
    dragState.pointerId = event.pointerId ?? null;
    dragState.mode = resolveDragMode(event);
    dragState.lastX = event.clientX;
    dragState.lastY = event.clientY;
    dragState.shiftKey = !!event.shiftKey;
    updateAnchorFromSelection();
    if (dragState.pointerId != null && canvas?.setPointerCapture) {
      try { canvas.setPointerCapture(dragState.pointerId); } catch {}
    }
  }

  function onPointerDragEnd(event) {
    if (!dragState.active) return;
    dragState.active = false;
    if (dragState.pointerId != null && canvas?.releasePointerCapture) {
      try { canvas.releasePointerCapture(dragState.pointerId); } catch {}
    }
    dragState.pointerId = null;
    store.update((draft) => {
      if (draft.runtime?.perturb) {
        draft.runtime.perturb.active = false;
        draft.runtime.perturb.mode = 'idle';
      }
    });
  }

  function install() {
    const onPointerDownEvt = (event) => {
      if (event.button === 0) {
        onPointerDragStart(event);
      }
      onPointerDown(event);
    };
    const onPointerUpEvt = (event) => {
      if (dragState.active) {
        onPointerDragEnd(event);
      }
      onPointerUp(event);
    };
    canvas.addEventListener('pointerdown', onPointerDownEvt);
    canvas.addEventListener('pointerup', onPointerUpEvt);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('click', onClick);
    canvas.addEventListener('dblclick', onDoubleClick);
    cleanup.push(() => {
      canvas.removeEventListener('pointerdown', onPointerDownEvt);
      canvas.removeEventListener('pointerup', onPointerUpEvt);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('click', onClick);
      canvas.removeEventListener('dblclick', onDoubleClick);
    });
  }

  function dispose() {
    while (cleanup.length) {
      const fn = cleanup.pop();
      try { fn(); } catch {}
    }
  }

  return {
    install,
    setup: install,
    dispose,
    updateSelection,
    clearSelection,
    hasSelection,
    applySelectionFromPick,
    selectionFromPick,
    selectionSeq,
    PERTURB_LABEL,
  };
}

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
const simTimeEl = document.querySelector('[data-testid="sim-time"]');
let viewerStoreRef = null;

let latestSnapshot = null;
let renderStats = { drawn: 0, hidden: 0 };
let fpsEstimate = 0;
let lastFpsFrameSample = 0;
let lastFpsSampleTimeMs = (typeof performance !== 'undefined' && performance.now)
  ? performance.now()
  : Date.now();


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
} = consumeViewerParams();

const dumpBigParam = dumpToken === 'big' || findToken === 'big';
const skyOffParam = skyOverride === true;
// Play UI runs on worker backend only; ignore direct/auto requests for now.
const backend = await createBackend({ model: requestedModel, prepareBindingUpdate });
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

function updateSimTime(state) {
  if (!simTimeEl) return;
  const displayTime = typeof state?.hud?.time === 'number' ? state.hud.time : 0;
  simTimeEl.textContent = `t = ${displayTime.toFixed(3)}`;
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
    const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
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
    updateSimTime(snapshot);
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
  scheduleRenderScene();
  updateOverlay(overlayHelp, state.overlays.help);
  updateOverlay(overlayInfo, state.overlays.info);
  updateOverlay(overlayProfiler, state.overlays.profiler);
  updateOverlay(overlaySensor, state.overlays.sensor);
  updateRealtimeOverlay(state);
  updatePanels(state);

  const leftVisible = !!state.panels?.left;
  const rightVisible = !!state.panels?.right;
  const fullscreen = !!state.overlays?.fullscreen;
  const layoutKey = `${leftVisible ? '1' : '0'}${rightVisible ? '1' : '0'}${fullscreen ? '1' : '0'}`;
  const fontIndex = Number.isFinite(state.theme?.font) ? (state.theme.font | 0) : null;
  if (layoutKey !== lastLayoutKey || fontIndex !== lastFontIndex) {
    lastLayoutKey = layoutKey;
    lastFontIndex = fontIndex;
    queueResizeCanvas();
  }
  scheduleUiUpdate(state);
  // Dynamic: build actuator sliders when metadata arrives
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
  const tDofsStart = perfEnabled ? perfNow() : 0;
  const dofs = deriveJointDofs(latestSnapshot, state);
  if (perfEnabled) {
    perfSample('main:subscriber_deriveJointDofs_ms', perfNow() - tDofsStart, {
      ngeom: typeof latestSnapshot?.ngeom === 'number' ? (latestSnapshot.ngeom | 0) : null,
      hasDofs: Array.isArray(dofs) ? dofs.length : null,
    });
  }
  if (typeof controlManager.ensureJointSliders === 'function') {
    controlManager.ensureJointSliders(dofs);
  }
  const eqs = deriveEqualityList(latestSnapshot);
  if (typeof controlManager.ensureEqualityToggles === 'function') {
    controlManager.ensureEqualityToggles(eqs);
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
