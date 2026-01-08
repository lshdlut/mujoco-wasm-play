// Extracted from main.nobuild.mjs (UI + store).
// Keep behaviour identical; changes here should remain audit-friendly.

import {
  isStrictEnabled,
  logDebug,
  logWarn,
  logStatus,
  logError,
  strictCatch,
  strictEnsure,
  strictOverride,
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
import { STAT_FIELD_DESCRIPTORS, VISUAL_FIELD_DESCRIPTORS } from './viewer_structs.mjs';
import { FALLBACK_PRESETS } from './main_environment.mjs';

function clamp01(value) {
  if (!Number.isFinite(value)) return 0;
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

// Lightweight state container and backend helpers for the simulate parity UI.
// Runtime implementation lives in JS so it can be consumed directly by the
// buildless viewer. Type definitions are provided separately in viewer_state_types.ts.

const VISUAL_SOURCE_CACHE_TEMPLATE = {
  model: null,
  presetSun: null,
  presetMoon: null,
  sceneFlagsModel: null,
  sceneFlagsPresetSun: null,
  sceneFlagsPresetMoon: null,
  lightActiveModel: null,
  lightActivePresetSun: null,
  lightActivePresetMoon: null,
  appearanceModel: null,
  appearancePresetSun: null,
  appearancePresetMoon: null,
};

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
        bindingIndex = null;
        bindingIndexPromise = null;
        logError('[bindings] load failed', err);
        strictCatch(err, 'main:bindings_index_load');
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

  if (isStrictEnabled()) {
    const id = control?.item_id ?? control?.name ?? control?.label ?? null;
    const err = new Error(`[bindings] unknown binding: ${raw}${id ? ` (control=${id})` : ''}`);
    err.detail = { binding: raw, controlId: id };
    strictCatch(err, 'main:bindings_unknown');
  } else {
    logWarn('[bindings] unknown binding', raw);
  }
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
    } catch (err) {
      strictCatch(err, 'main:parseVector');
    }
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
    return token === '1' || token === 'true' || token === 'yes' || token === 'on' || token === 'run';
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
    if (isStrictEnabled()) {
      const id = control?.item_id ?? control?.name ?? control?.label ?? null;
      const err = new Error(`[bindings] missing metadata for ${binding}${id ? ` (control=${id})` : ''}`);
      err.detail = { binding, controlId: id };
      strictCatch(err, 'main:bindings_missing_metadata');
    }
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
    keyIndex: -1,
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
  visualBackups: { ...VISUAL_SOURCE_CACHE_TEMPLATE },
  visualBaselines: { ...VISUAL_SOURCE_CACHE_TEMPLATE },
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
    hideAllGeometry: false,
    // JS-side rendering/lighting state that is treated like a "buffer": presets
    // override these values by copying + patching, instead of introducing
    // renderer-only fallback branches.
    appearance: {
      background: null,
      clearColor: 0xd6dce4,
      exposure: 1.1,
      // Model mode should match MuJoCo Simulate (no IBL by default). Presets can
      // opt-in by overriding this via the unified state buffer.
      envIntensity: 0.0,
      hdri: null,
      backgroundBottom: null,
      ambient: { color: 0xffffff, intensity: 0 },
      hemi: { sky: 0xffffff, ground: 0x10131c, intensity: 0 },
      dir: {
        color: 0xffffff,
        intensity: 0,
        position: [6, -8, 8],
        target: [0, 0, 1],
        shadowBias: -0.0001,
      },
      fill: { color: 0xffffff, intensity: 0, position: [-6, 6, 3] },
      // MuJoCo GL3 relies on polygon offset while rendering shadow maps; keep the
      // shadow compare bias near 0. WebGL forward-Z + depth packing can still
      // exhibit self-shadow acne; use a tiny negative bias as a practical default
      // while keeping contact shadows stable. Presets can override this via the
      // unified state buffer.
      shadowBias: -0.00005,
      ground: null,
      overlays: null,
      fogColor: null,
    },
    options: {
      materials: { forceBasic: false },
      instancing: { enabled: true },
      transparency: { bins: 16, sortMode: 'strict' },
    },
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
  history: createDefaultHistoryState(),
  watch: createDefaultWatchState(),
  keyframes: createDefaultKeyframeState(),
});

const CAMERA_BASE_LABELS = ['Free', 'Tracking'];
let latestHudTime = 0;
const TIME_RESET_EPSILON = 1e-6;
const STRUCT_DIFF_SAMPLE_LIMIT = 12;
const VIEWER_STATE_KEYS = Object.keys(DEFAULT_VIEWER_STATE);

let lastVisualVersion = null;
let lastVisualDefaultsVersion = null;
let lastStatisticVersion = null;

function cloneViewerState(source) {
  return cloneStruct(source);
}

function applyViewerStateOverrides(base, overrides) {
  if (!overrides) return base;
  for (const key of VIEWER_STATE_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(overrides, key)) continue;
    base[key] = cloneStruct(overrides[key]);
  }
  return base;
}

function formatStructPath(pathSegments) {
  return pathSegments.join('.');
}

function valuesEqual(a, b) {
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) return false;
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i += 1) {
      if (!valuesEqual(a[i], b[i])) return false;
    }
    return true;
  }
  return Object.is(a, b);
}

function diffStruct(prev, next, descriptors) {
  const sample = [];
  let count = 0;
  for (const descriptor of descriptors) {
    const path = descriptor.path;
    const before = resolveStructPath(prev, path);
    const after = resolveStructPath(next, path);
    if (!valuesEqual(before, after)) {
      count += 1;
      if (sample.length < STRUCT_DIFF_SAMPLE_LIMIT) {
        sample.push(formatStructPath(path));
      }
    }
  }
  return { count, sample };
}

function resetModelFrontendState(store) {
  latestHudTime = 0;
  lastVisualVersion = null;
  lastVisualDefaultsVersion = null;
  lastStatisticVersion = null;
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
  const snapshotSummary = (state) => ({
    hud: {
      time: state?.hud?.time ?? null,
      rate: state?.hud?.rate ?? null,
      measuredSlowdown: state?.hud?.measuredSlowdown ?? null,
      ngeom: state?.hud?.ngeom ?? null,
      contacts: state?.hud?.contacts ?? null,
      pausedSource: state?.hud?.pausedSource ?? null,
      rateSource: state?.hud?.rateSource ?? null,
    },
    simulation: {
      run: state?.simulation?.run ?? null,
      realTimeIndex: state?.simulation?.realTimeIndex ?? null,
      scrubIndex: state?.simulation?.scrubIndex ?? null,
    },
    runtime: {
      gesture: state?.runtime?.gesture ? { ...state.runtime.gesture } : null,
      drag: state?.runtime?.drag ? { ...state.runtime.drag } : null,
      cameraIndex: state?.runtime?.cameraIndex ?? null,
    },
  });
  const before = snapshotSummary(draft);
  const snapshotKeys = Object.keys(snapshot || {});
  const applied = [];
  const structDiffs = {};
  const visualVersion = Number.isFinite(snapshot.visualVersion) ? snapshot.visualVersion : null;
  const visualDefaultsVersion = Number.isFinite(snapshot.visualDefaultsVersion) ? snapshot.visualDefaultsVersion : null;
  const statisticVersion = Number.isFinite(snapshot.statisticVersion) ? snapshot.statisticVersion : null;
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
  if (snapshot.info && typeof snapshot.info === 'object') {
    draft.hud.info = cloneStruct(snapshot.info) || {};
  }
  if (typeof snapshot.paused === 'boolean') {
    draft.simulation.run = !snapshot.paused;
  }
  if (snapshot.gesture) {
    const gesture = snapshot.gesture;
    const current = draft.runtime.gesture ?? {};
    const pointerSource = gesture.pointer ?? current.pointer ?? null;
    const pointer = pointerSource && typeof pointerSource === 'object'
      ? {
          x: Number(pointerSource.x) || 0,
          y: Number(pointerSource.y) || 0,
          dx: Number(pointerSource.dx) || 0,
          dy: Number(pointerSource.dy) || 0,
          buttons: Number(pointerSource.buttons ?? 0),
          pressure: Number(pointerSource.pressure ?? 0),
        }
      : null;
    const modeValue = typeof gesture.mode === 'string'
      ? gesture.mode
      : (typeof current.mode === 'string' ? current.mode : 'idle');
    const phase = typeof gesture.phase === 'string'
      ? gesture.phase
      : (typeof current.phase === 'string' ? current.phase : 'idle');
    draft.runtime.gesture = { mode: modeValue, phase, pointer };
    if (!draft.runtime?.perturb?.active) {
      draft.runtime.lastAction = modeValue !== 'idle' ? modeValue : (draft.runtime.lastAction || 'idle');
    }
  }
  if (snapshot.drag) {
    const current = draft.runtime.drag ?? {};
    const source = snapshot.drag;
    draft.runtime.drag = {
      dx: Number(source.dx ?? current.dx) || 0,
      dy: Number(source.dy ?? current.dy) || 0,
    };
  }
  if (snapshot.selection && typeof snapshot.selection === 'object') {
    const incomingSeq = Number(snapshot.selection.seq) || 0;
    const currentSeq = Number(draft.runtime?.selection?.seq) || 0;
    if (incomingSeq && incomingSeq !== currentSeq) {
      const bodyId = Number(snapshot.selection.bodyId) | 0;
      const geomId = Number(snapshot.selection.geomId) | 0;
      const pointSource = Array.isArray(snapshot.selection.point) ? snapshot.selection.point : null;
      const point = pointSource
        ? [Number(pointSource[0]) || 0, Number(pointSource[1]) || 0, Number(pointSource[2]) || 0]
        : [0, 0, 0];
      const localposSource = Array.isArray(snapshot.selection.localpos) ? snapshot.selection.localpos : null;
      const anchorLocal = localposSource
        ? [Number(localposSource[0]) || 0, Number(localposSource[1]) || 0, Number(localposSource[2]) || 0]
        : [0, 0, 0];
      const ts = Number(snapshot.selection.timestamp) || Date.now();

      if (bodyId > 0) {
        const geoms = Array.isArray(model.geoms) ? model.geoms : [];
        const geomMeta = geomId >= 0
          ? geoms.find((geom) => geom && (geom.index | 0) === geomId)
          : null;
        const name = geomMeta && typeof geomMeta.name === 'string'
          ? geomMeta.name
          : (geomId >= 0 ? `Geom ${geomId}` : `Body ${bodyId}`);

        let joint = -1;
        const bodyAdr = model.bodyJntAdr;
        const bodyNum = model.bodyJntNum;
        const jtype = model.jntType;
        if (bodyAdr && bodyNum && jtype) {
          const base = bodyAdr[bodyId] ?? -1;
          const num = bodyNum[bodyId] ?? 0;
          if ((num | 0) > 0) {
            const j = base >= 0 ? (base | 0) : -1;
            if (j >= 0 && j < jtype.length) {
              joint = j;
            }
          }
        }

        draft.runtime.selection = {
          geom: geomId,
          body: bodyId,
          joint,
          name,
          kind: 'geom',
          point,
          localPoint: [0, 0, 0],
          anchorLocal,
          normal: [0, 0, 1],
          seq: incomingSeq,
          timestamp: ts,
        };
        draft.runtime.lastAction = 'select';
        draft.toast = { message: `Selected ${name}`, ts };
      } else {
        draft.runtime.selection = {
          ...createDefaultSelectionState(),
          seq: incomingSeq,
          timestamp: ts,
        };
        draft.runtime.lastAction = 'select-none';
      }
    }
  }
  if (snapshot.align) {
    const current = draft.runtime.lastAlign || {};
    const centerSource = Array.isArray(snapshot.align.center)
      ? snapshot.align.center
      : (Array.isArray(current.center) ? current.center : null);
    const center = Array.isArray(centerSource)
      ? centerSource.slice(0, 3).map((n) => Number(n) || 0)
      : [0, 0, 0];
    draft.runtime.lastAlign = {
      seq: Number(snapshot.align.seq) || current.seq || 0,
      center,
      radius: Number(snapshot.align.radius) || current.radius || 0,
      timestamp: Number(snapshot.align.timestamp) || Date.now(),
      source: snapshot.align.source || current.source || 'backend',
    };
  }
  if (snapshot.copyState) {
    const current = draft.runtime.lastCopy || {};
    const qposPreview = Array.isArray(snapshot.copyState.qposPreview)
      ? snapshot.copyState.qposPreview.map((n) => Number(n) || 0)
      : (Array.isArray(current.qposPreview) ? current.qposPreview.slice() : []);
    const qvelPreview = Array.isArray(snapshot.copyState.qvelPreview)
      ? snapshot.copyState.qvelPreview.map((n) => Number(n) || 0)
      : (Array.isArray(current.qvelPreview) ? current.qvelPreview.slice() : []);
    draft.runtime.lastCopy = {
      seq: Number(snapshot.copyState.seq) || current.seq || 0,
      precision: snapshot.copyState.precision || current.precision || 'standard',
      nq: Number(snapshot.copyState.nq) || 0,
      nv: Number(snapshot.copyState.nv) || 0,
      timestamp: Number(snapshot.copyState.timestamp) || Date.now(),
      complete: !!snapshot.copyState.complete,
      qposPreview,
      qvelPreview,
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
    watch.sources = {};
    for (const [key, value] of Object.entries(snapshot.watchSources)) {
      watch.sources[key] = value;
    }
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
    const backups = ensureVisualCache(draft, 'visualBackups');
    if (!backups.sceneFlagsModel) {
      backups.sceneFlagsModel = [...flags];
    }
    if (!backups.sceneFlagsPresetSun) {
      backups.sceneFlagsPresetSun = [...flags];
    }
    if (!backups.sceneFlagsPresetMoon) {
      backups.sceneFlagsPresetMoon = [...flags];
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
  if (snapshot.options && typeof snapshot.options === 'object') {
    const opt = model.opt || (model.opt = {});
    for (const [key, value] of Object.entries(snapshot.options)) {
      opt[key] = value;
    }
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
    const shouldApplyVisual = visualVersion == null || visualVersion !== lastVisualVersion;
    if (shouldApplyVisual) {
      const nextVisual = cloneStruct(snapshot.visual) || {};
      structDiffs.visual = diffStruct(model.vis, nextVisual, VISUAL_FIELD_DESCRIPTORS);
      model.vis = nextVisual;
      lastVisualVersion = visualVersion;
      applied.push('visual');
    }
  }
  const baselines = ensureVisualCache(draft, 'visualBaselines');
  if (snapshot.visualDefaults) {
    const shouldApplyDefaults =
      !baselines.model || (visualDefaultsVersion != null && visualDefaultsVersion !== lastVisualDefaultsVersion);
    if (shouldApplyDefaults) {
      const nextDefaults = cloneStruct(snapshot.visualDefaults) || {};
      structDiffs.visualDefaults = diffStruct(model.visDefaults, nextDefaults, VISUAL_FIELD_DESCRIPTORS);
      model.visDefaults = nextDefaults;
      baselines.model = cloneStruct(nextDefaults);
      baselines.sceneFlagsModel = normaliseSceneFlagArray(snapshot.sceneFlags);
      baselines.presetSun = null;
      baselines.sceneFlagsPresetSun = null;
      baselines.presetMoon = null;
      baselines.sceneFlagsPresetMoon = null;
      lastVisualDefaultsVersion = visualDefaultsVersion;
      applied.push('visualDefaults');
    }
  } else if (!baselines.model && snapshot.visual) {
    baselines.model = cloneStruct(snapshot.visual);
    baselines.sceneFlagsModel = normaliseSceneFlagArray(snapshot.sceneFlags);
    baselines.presetSun = null;
    baselines.sceneFlagsPresetSun = null;
    baselines.presetMoon = null;
    baselines.sceneFlagsPresetMoon = null;
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
    const shouldApplyStatistic = statisticVersion == null || statisticVersion !== lastStatisticVersion;
    if (shouldApplyStatistic) {
      const nextStat = cloneStruct(snapshot.statistic) || {};
      structDiffs.statistic = diffStruct(model.stat, nextStat, STAT_FIELD_DESCRIPTORS);
      model.stat = nextStat;
      lastStatisticVersion = statisticVersion;
      applied.push('statistic');
    }
  }
  if (snapshot.optionSupport && typeof snapshot.optionSupport === 'object') {
    const pointers = Array.isArray(snapshot.optionSupport.pointers)
      ? snapshot.optionSupport.pointers.slice()
      : [];
    model.optSupport = {
      supported: !!snapshot.optionSupport.supported,
      pointers,
    };
  }
  if (typeof snapshot.cameraMode === 'number' && Number.isFinite(snapshot.cameraMode)) {
    const mode = snapshot.cameraMode | 0;
    draft.runtime.cameraIndex = mode;
    draft.runtime.cameraLabel = cameraLabelFromIndex(mode, model?.cameras);
  }
  const after = snapshotSummary(draft);
  strictOverride('mergeBackendSnapshot', {
    source: 'backend_snapshot',
    snapshotKeys,
    before,
    after,
    applied,
    structDiffs,
  });
}

function ensureRenderingState(target) {
  let created = false;
  const repairs = [];
  if (!target.rendering) {
    target.rendering = {
      voptFlags: DEFAULT_VOPT_FLAGS.slice(),
      sceneFlags: SCENE_FLAG_DEFAULTS.slice(),
      labelMode: 0,
      frameMode: 0,
      flexLayer: 0,
      bvhDepth: 1,
      groups: createViewerGroupState(true),
      hideAllGeometry: false,
      appearance: cloneStruct(DEFAULT_VIEWER_STATE.rendering.appearance),
      options: cloneStruct(DEFAULT_VIEWER_STATE.rendering.options),
    };
    created = true;
  } else {
    if (!Array.isArray(target.rendering.voptFlags)) {
      target.rendering.voptFlags = DEFAULT_VOPT_FLAGS.slice();
      repairs.push('voptFlags');
    }
    if (!Array.isArray(target.rendering.sceneFlags)) {
      target.rendering.sceneFlags = SCENE_FLAG_DEFAULTS.slice();
      repairs.push('sceneFlags');
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
      repairs.push('sceneFlagsLength');
    }
    if (typeof target.rendering.labelMode !== 'number') {
      target.rendering.labelMode = 0;
      repairs.push('labelMode');
    }
    if (typeof target.rendering.frameMode !== 'number') {
      target.rendering.frameMode = 0;
      repairs.push('frameMode');
    }
    if (typeof target.rendering.flexLayer !== 'number') {
      target.rendering.flexLayer = 0;
      repairs.push('flexLayer');
    }
    if (typeof target.rendering.bvhDepth !== 'number') {
      target.rendering.bvhDepth = 1;
      repairs.push('bvhDepth');
    }
    if (!target.rendering.groups) {
      target.rendering.groups = createViewerGroupState(true);
      repairs.push('groups');
    } else {
      target.rendering.groups = normaliseGroupState(target.rendering.groups);
    }
    if (typeof target.rendering.hideAllGeometry !== 'boolean') {
      target.rendering.hideAllGeometry = false;
      repairs.push('hideAllGeometry');
    }
    if (!target.rendering.appearance || typeof target.rendering.appearance !== 'object') {
      target.rendering.appearance = cloneStruct(DEFAULT_VIEWER_STATE.rendering.appearance);
      repairs.push('appearance');
    }
    if (!target.rendering.options || typeof target.rendering.options !== 'object') {
      target.rendering.options = cloneStruct(DEFAULT_VIEWER_STATE.rendering.options);
      repairs.push('options');
    }
  }
  if (created) {
    strictEnsure('ensureRenderingState', { reason: 'create' });
  }
  if (repairs.length) {
    strictEnsure('ensureRenderingState', { reason: 'repair', fields: repairs });
  }
  return target.rendering;
}

function ensureState(target, key, createFn) {
  if (!target[key]) {
    target[key] = createFn();
    strictEnsure('ensureState', { reason: 'create', key });
  }
  return target[key];
}

const ensureHistoryState = (target) => ensureState(target, 'history', createDefaultHistoryState);
const ensureWatchState = (target) => ensureState(target, 'watch', createDefaultWatchState);
const ensureKeyframeState = (target) => ensureState(target, 'keyframes', createDefaultKeyframeState);

function ensureThemeState(target) {
  let created = false;
  const repairs = [];
  if (!target.theme) {
    target.theme = {
      color: 0,
      spacing: 0,
      font: 0,
    };
    created = true;
  } else {
    if (typeof target.theme.color !== 'number' || !Number.isFinite(target.theme.color)) {
      target.theme.color = 0;
      repairs.push('color');
    }
    if (typeof target.theme.spacing !== 'number' || !Number.isFinite(target.theme.spacing)) {
      target.theme.spacing = 0;
      repairs.push('spacing');
    }
    if (typeof target.theme.font !== 'number' || !Number.isFinite(target.theme.font)) {
      target.theme.font = 0;
      repairs.push('font');
    }
  }
  if (created) {
    strictEnsure('ensureThemeState', { reason: 'create' });
  }
  if (repairs.length) {
    strictEnsure('ensureThemeState', { reason: 'repair', fields: repairs });
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

const BINDING_APPLIERS = {
  overlay: (draft, spec, value) => {
    draft.overlays[spec.key] = bool(value);
    return true;
  },
  theme: (draft, spec, value, control) => {
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
  },
  tracking_geom: (draft, spec, value) => {
    const geomIdx = Math.trunc(toNumber(value));
    draft.runtime.trackingGeom = Number.isFinite(geomIdx) ? geomIdx : -1;
    return true;
  },
};

const BINDING_READERS = {
  overlay: (state, spec) => !!state.overlays?.[spec.key],
  run: (state, spec, control) => {
    if (control && Array.isArray(control.options)) {
      return state.simulation.run ? control.options[1] ?? 'Run' : control.options[0] ?? 'Pause';
    }
    return state.simulation.run;
  },
  camera: (state) => state.runtime.cameraIndex | 0,
  tracking_geom: (state) => (Number.isFinite(state.runtime.trackingGeom) ? state.runtime.trackingGeom : -1),
  scrub_index: (state) => state.simulation.scrubIndex | 0,
  key_index: (state) => state.simulation.keyIndex | 0,
  watch_field: (state) => state.watch?.field ?? 'qpos',
  watch_index: (state) => (Number.isFinite(state.watch?.index) ? state.watch.index | 0 : 0),
  theme: (state, spec) => (Number.isFinite(state.theme?.[spec.key]) ? state.theme[spec.key] | 0 : 0),
  watch_summary: (state) => {
    if (state.watch?.summary) return state.watch.summary;
    if (typeof state.watch?.value === 'number' && Number.isFinite(state.watch.value)) {
      return state.watch.value.toFixed(6);
    }
    return '—';
  },
  group: (state, spec) => {
    const groups = state.rendering?.groups;
    const arr = Array.isArray(groups?.[spec.group]) ? groups[spec.group] : null;
    if (!arr) return true;
    if (spec.index >= 0 && spec.index < arr.length) {
      return !!arr[spec.index];
    }
    return true;
  },
  mask: (state, spec) => {
    const name = spec.name ?? spec.binding ?? '';
    if (spec.mask === 'disable') return !!state.physics.disableFlags[name];
    if (spec.mask === 'enable') return !!state.physics.enableFlags[name];
    if (spec.mask === 'enableactuator') return !!state.physics.actuatorGroups[name];
    return undefined;
  },
  sim_opt: (state, spec) => state.rendering?.[spec.field] ?? 0,
  struct: (state, spec) => {
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
  },
  vopt_flag: (state, spec) => !!state.rendering?.voptFlags?.[spec.index],
  scene_flag: (state, spec) => !!state.rendering?.sceneFlags?.[spec.index],
  label_mode: (state) => state.rendering?.labelMode ?? 0,
  frame_mode: (state) => state.rendering?.frameMode ?? 0,
};

function applyBinding(draft, bindingOrSpec, value, control) {
  const spec = typeof bindingOrSpec === 'string'
    ? resolveBindingSpec(bindingOrSpec, control)
    : bindingOrSpec;
  if (!spec) return false;
  const handler = BINDING_APPLIERS[spec.kind];
  if (!handler) return false;
  return handler(draft, spec, value, control);
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

const CONTROL_TOASTS = {
  'simulation.reset': 'Simulation reset',
  'simulation.reload': 'Model reloaded',
  'simulation.align': 'View aligned',
  'file.quit': 'Quit requested',
};

function applyControl(draft, control, value) {
  if (!control) return false;
  const toastMessage = CONTROL_TOASTS[control.item_id];
  if (toastMessage) {
    draft.toast = { message: toastMessage, ts: Date.now() };
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
  const reader = BINDING_READERS[spec.kind];
  if (!reader) return undefined;
  return reader(state, spec, control);
}

const CONTROL_NULL_VALUE = new Set([
  'simulation.reset',
  'simulation.align',
  'file.quit',
]);

function readControlValue(state, control) {
  if (!control) return undefined;
  if (CONTROL_NULL_VALUE.has(control.item_id)) return null;
  if (control.item_id === 'option.visual_source') {
    const mode = state.visualSourceMode || 'model';
    if (mode === 'model') return 'Model';
    if (mode === 'preset-moon') return 'PresetMoon';
    return 'PresetSun';
  }
  if (control.binding) {
    const spec = getControlBindingSpec(control) || control.binding;
    return readBindingValue(state, spec, control);
  }
  return undefined;
}

const LOCAL_CONTROL_IDS = new Set([
  ...Object.keys(CONTROL_TOASTS),
  'simulation.copy_state',
  'simulation.save_key',
  'simulation.load_key',
  'option.help-toggle',
]);

function createViewerStore(initialState) {
  let state = applyViewerStateOverrides(cloneViewerState(DEFAULT_VIEWER_STATE), initialState);
  latestHudTime = Math.max(0, Number(state?.hud?.time) || 0);
  const listeners = new Set();

  function notify() {
    for (const fn of listeners) {
      try {
        fn(state);
      } catch (err) {
        logError(err);
        strictCatch(err, 'main:store_listener');
      }
    }
  }

  return {
    get() {
      return state;
    },
    replace(next) {
      if (!next) return;
      state = applyViewerStateOverrides(cloneViewerState(DEFAULT_VIEWER_STATE), next);
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
      strictCatch(err, 'main:option_visual_source_switch');
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
      strictCatch(err, 'main:backend_apply');
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
        gestureType: payload.gestureType,
        reldx: payload.reldx,
        reldy: payload.reldy,
        shiftKey: payload.shiftKey,
        cam: payload.cam,
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
        strictCatch(err, 'main:backend_apply_gesture');
      });
  }
}

const VISUAL_OVERRIDE_PRESET = [
  { path: ['global', 'fovy'], kind: 'float', size: 1, value: 70 },
  // Presets should not be lit by MuJoCo headlight/model lights; they use the
  // preset appearance buffer (HDRI + dir/fill/ambient/hemi).
  { path: ['headlight', 'active'], kind: 'enum', size: 1, value: 0 },
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

function applyPresetOverridesToStruct(base, presetLabel) {
  const source = cloneStruct(base) || {};
  const preset = typeof presetLabel === 'string' && presetLabel ? presetLabel : 'preset';
  for (const entry of VISUAL_OVERRIDE_PRESET) {
    const beforeRaw = resolveStructPath(source, entry.path);
    const before = Array.isArray(beforeRaw) ? beforeRaw.slice() : beforeRaw;
    const overrideValue = Array.isArray(entry.value) ? entry.value.slice() : entry.value;
    assignStructPath(source, entry.path, overrideValue);
    strictOverride('applyPresetOverridesToStruct', {
      source: 'visual_preset',
      preset,
      path: Array.isArray(entry.path) ? entry.path.slice() : [],
      kind: entry.kind || null,
      size: entry.size || null,
      before,
      after: Array.isArray(overrideValue) ? overrideValue.slice() : overrideValue,
    });
  }
  return source;
}

function applyAppearancePresetOverrides(base, presetKey) {
  const source = cloneStruct(base) || {};
  const key = presetKey === 'moon' ? 'moon' : 'sun';
  const preset = FALLBACK_PRESETS[key] || FALLBACK_PRESETS.sun;
  for (const [field, value] of Object.entries(preset)) {
    const before = Object.prototype.hasOwnProperty.call(source, field) ? cloneStruct(source[field]) : null;
    source[field] = cloneStruct(value);
    strictOverride('applyAppearancePresetOverrides', {
      source: 'rendering_appearance_preset',
      preset: key,
      field,
      before,
      after: cloneStruct(value),
    });
  }
  return source;
}

function ensureVisualCache(target, key) {
  const existing = target?.[key];
  if (existing) return existing;
  const cache = { ...VISUAL_SOURCE_CACHE_TEMPLATE };
  if (target) target[key] = cache;
  strictEnsure('ensureVisualCache', { reason: 'create', key });
  return cache;
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
  const currentAppearance = cloneStruct(currentState?.rendering?.appearance)
    || cloneStruct(DEFAULT_VIEWER_STATE.rendering.appearance);
  let snapshot;
  try {
    snapshot = await backend.snapshot();
  } catch (err) {
    logError('[visual source switch] snapshot failed', err);
    strictCatch(err, 'main:visual_source_snapshot');
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
  const lightAssets = snapshot.renderAssets?.lights || null;
  const nlight = lightAssets?.count | 0;
  const currentLightActive =
    (nlight > 0 && lightAssets?.active)
      ? Array.from(lightAssets.active).slice(0, nlight)
      : null;
  store.update((draft) => {
    const backups = ensureVisualCache(draft, 'visualBackups');
    const baselines = ensureVisualCache(draft, 'visualBaselines');
    if (!baselines.appearanceModel && currentAppearance) {
      baselines.appearanceModel = cloneStruct(currentAppearance);
    }
    if (!baselines.model && baselineVisual) {
      baselines.model = cloneStruct(baselineVisual);
      baselines.sceneFlagsModel = normaliseSceneFlagArray(snapshot.sceneFlags);
      if (!baselines.lightActiveModel && currentLightActive) {
        baselines.lightActiveModel = currentLightActive.slice();
      }
    }
    const wantsPreset = targetMode === 'preset-sun' || targetMode === 'preset-moon';
    if (wantsPreset && !baselines.presetSun && baselines.model) {
      const presetBase = applyPresetOverridesToStruct(baselines.model, 'preset-sun');
      baselines.presetSun = cloneStruct(presetBase);
      baselines.sceneFlagsPresetSun = baselines.sceneFlagsModel ? [...baselines.sceneFlagsModel] : null;
      if (!baselines.lightActivePresetSun && nlight > 0) {
        baselines.lightActivePresetSun = Array.from({ length: nlight }, () => 0);
      }
    }
    if (wantsPreset && !baselines.appearancePresetSun && baselines.appearanceModel) {
      baselines.appearancePresetSun = applyAppearancePresetOverrides(baselines.appearanceModel, 'sun');
    }
    if (targetMode === 'preset-moon' && !baselines.presetMoon) {
      // Start moon from sun baseline; can diverge over time via backups.
      const moonBase = baselines.presetSun || baselines.model;
      baselines.presetMoon = cloneStruct(moonBase);
      baselines.sceneFlagsPresetMoon = baselines.sceneFlagsPresetSun
        ? [...baselines.sceneFlagsPresetSun]
        : baselines.sceneFlagsModel
        ? [...baselines.sceneFlagsModel]
        : null;
      if (!baselines.lightActivePresetMoon && nlight > 0) {
        baselines.lightActivePresetMoon = Array.from({ length: nlight }, () => 0);
      }
    }
    if (targetMode === 'preset-moon' && !baselines.appearancePresetMoon) {
      const moonBase = baselines.appearancePresetSun || baselines.appearanceModel;
      baselines.appearancePresetMoon = applyAppearancePresetOverrides(moonBase, 'moon');
    }
    if (currentMode === 'preset-sun') {
      backups.presetSun = cloneStruct(currentVisual) || cloneStruct(baselines.presetSun) || null;
      backups.sceneFlagsPresetSun = currentSceneFlags
        ? [...currentSceneFlags]
        : baselines.sceneFlagsPresetSun
        ? [...baselines.sceneFlagsPresetSun]
        : null;
      if (currentLightActive) {
        backups.lightActivePresetSun = currentLightActive.slice();
      }
      backups.appearancePresetSun = cloneStruct(currentAppearance) || cloneStruct(baselines.appearancePresetSun) || null;
    } else if (currentMode === 'preset-moon') {
      backups.presetMoon = cloneStruct(currentVisual) || cloneStruct(baselines.presetMoon) || null;
      backups.sceneFlagsPresetMoon = currentSceneFlags
        ? [...currentSceneFlags]
        : baselines.sceneFlagsPresetMoon
        ? [...baselines.sceneFlagsPresetMoon]
        : null;
      if (currentLightActive) {
        backups.lightActivePresetMoon = currentLightActive.slice();
      }
      backups.appearancePresetMoon = cloneStruct(currentAppearance) || cloneStruct(baselines.appearancePresetMoon) || null;
    } else {
      backups.model = cloneStruct(currentVisual) || cloneStruct(baselines.model) || null;
      backups.sceneFlagsModel = currentSceneFlags
        ? [...currentSceneFlags]
        : baselines.sceneFlagsModel
        ? [...baselines.sceneFlagsModel]
        : null;
      if (currentLightActive) {
        backups.lightActiveModel = currentLightActive.slice();
      }
      backups.appearanceModel = cloneStruct(currentAppearance) || cloneStruct(baselines.appearanceModel) || null;
    }
  });
  const updatedState = store.get();
  const backups = ensureVisualCache(updatedState, 'visualBackups');
  const baselines = ensureVisualCache(updatedState, 'visualBaselines');
  let targetVisual = {};
  let targetSceneFlags = normaliseSceneFlagArray(null);
  let targetLightActive = null;
  let targetAppearance = cloneStruct(DEFAULT_VIEWER_STATE.rendering.appearance);
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
    targetLightActive =
      Array.isArray(backups.lightActivePresetSun) ? backups.lightActivePresetSun.slice()
      : Array.isArray(baselines.lightActivePresetSun) ? baselines.lightActivePresetSun.slice()
      : (nlight > 0 ? Array.from({ length: nlight }, () => 0) : null);
    const appearanceCache = backups.appearancePresetSun;
    const appearanceBase = baselines.appearancePresetSun || baselines.appearanceModel;
    targetAppearance =
      cloneStruct(appearanceCache) || cloneStruct(appearanceBase) || cloneStruct(DEFAULT_VIEWER_STATE.rendering.appearance);
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
    targetLightActive =
      Array.isArray(backups.lightActivePresetMoon) ? backups.lightActivePresetMoon.slice()
      : Array.isArray(baselines.lightActivePresetMoon) ? baselines.lightActivePresetMoon.slice()
      : (nlight > 0 ? Array.from({ length: nlight }, () => 0) : null);
    const appearanceCache = backups.appearancePresetMoon;
    const appearanceBase = baselines.appearancePresetMoon || baselines.appearancePresetSun || baselines.appearanceModel;
    targetAppearance =
      cloneStruct(appearanceCache) || cloneStruct(appearanceBase) || cloneStruct(DEFAULT_VIEWER_STATE.rendering.appearance);
  } else {
    const cache = backups.model;
    const base = baselines.model;
    targetVisual = cloneStruct(cache) || cloneStruct(base) || {};
    if (Array.isArray(backups.sceneFlagsModel)) {
      targetSceneFlags = [...backups.sceneFlagsModel];
    } else if (Array.isArray(baselines.sceneFlagsModel)) {
      targetSceneFlags = [...baselines.sceneFlagsModel];
    }
    targetLightActive =
      Array.isArray(backups.lightActiveModel) ? backups.lightActiveModel.slice()
      : Array.isArray(baselines.lightActiveModel) ? baselines.lightActiveModel.slice()
      : (currentLightActive ? currentLightActive.slice() : null);
    const appearanceCache = backups.appearanceModel;
    const appearanceBase = baselines.appearanceModel;
    targetAppearance =
      cloneStruct(appearanceCache) || cloneStruct(appearanceBase) || cloneStruct(DEFAULT_VIEWER_STATE.rendering.appearance);
  }
  store.update((draft) => {
    draft.visualSourceMode = targetMode;
    if (!draft.model) draft.model = {};
    draft.model.vis = cloneStruct(targetVisual) || {};
    const rendering = ensureRenderingState(draft);
    rendering.sceneFlags = Array.isArray(targetSceneFlags)
      ? targetSceneFlags.slice()
      : SCENE_FLAG_DEFAULTS.slice();
    rendering.appearance = cloneStruct(targetAppearance) || cloneStruct(DEFAULT_VIEWER_STATE.rendering.appearance);
  });
  if (typeof backend.setVisualState === 'function') {
    try {
      await backend.setVisualState({ visual: targetVisual, sceneFlags: targetSceneFlags });
    } catch (err) {
      logError('[visual source switch] apply failed', err);
      strictCatch(err, 'main:visual_source_apply');
    }
  }
  if (typeof backend.setModelLightActive === 'function' && Array.isArray(targetLightActive) && targetLightActive.length) {
    // Keep model lights under the same mj+js buffer override mechanism as other visual fields.
    try {
      await backend.setModelLightActive(targetLightActive, 'visual_source_switch');
    } catch (err) {
      logError('[visual source switch] setModelLightActive failed', err);
      strictCatch(err, 'main:visual_source_light_active_apply');
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

function pushToast(message) {
  if (!message) return;
  try {
    store.update((draft) => {
      draft.toast = { message, ts: Date.now() };
    });
  } catch (err) {
    strictCatch(err, 'main:pushToast');
  }
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

function getCameraModeCount() {
  try {
    const entries = resolveCameraModeEntries();
    return Math.max(1, Array.isArray(entries) ? entries.length : 1);
  } catch (err) {
    strictCatch(err, 'main:getCameraModeCount');
    return Math.max(1, Array.isArray(cameraPresets) ? cameraPresets.length : 1);
  }
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
  } catch (err) {
    strictCatch(err, 'main:tracking_geom_entries');
  }
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
  if (event.altKey) mods.push('alt');
  if (event.metaKey) mods.push('meta');
  let key = event.key;
  const code = event.code;
  if (typeof code === 'string') {
    if (code.startsWith('Key') && code.length === 4) {
      key = code.slice(3);
    } else if (code.startsWith('Digit') && code.length === 6) {
      key = code.slice(5);
    }
  }
  if (!key) return null;
  key = normaliseKeyToken(String(key).toLowerCase());
  if (!key) return null;
  const isSingleChar = key.length === 1;
  const isAlphaNum = isSingleChar && /[a-z0-9]/.test(key);
  const includeShift = !!event.shiftKey && (!isSingleChar || isAlphaNum);
  if (includeShift) mods.push('shift');
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
        strictCatch(err, 'main:ui_load_xml_file');
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
        strictCatch(err, 'main:ui_model_select_reload');
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
          const active = toBoolean(value);
          current = active;
          input.checked = !!active;
          input.setAttribute('aria-checked', active ? 'true' : 'false');
          label.classList.toggle('is-active', !!active);
        },
    });

    const commitToggle = guardBinding(binding, async (nextValue) => {
      const active = !!nextValue;
      binding.setValue(active);
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
      } catch (err) {
        strictCatch(err, 'main:checkbox_contact_toast');
      }
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
      const active = toBoolean(running);
      button.textContent = active ? 'Run' : 'Pause';
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
    };

    const binding = createBinding(control, {
      getValue: () => {
        const current = readControlValue(store.get(), control);
        return toBoolean(current);
      },
      applyValue: (value) => {
        const active = toBoolean(value);
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
    const rawOptions = normaliseOptions(control.options);
    const entries = rawOptions.map((opt) => {
      const token = String(opt ?? '').trim();
      const lower = token.toLowerCase();
      let key = 'model';
      let label = token || 'Model';
      if (lower.startsWith('preset')) {
        if (lower.includes('moon')) {
          key = 'preset-moon';
          label = 'Preset🌙️';
        } else {
          key = 'preset-sun';
          label = 'Preset☀️';
        }
      } else if (lower.startsWith('model')) {
        key = 'model';
        label = 'Model';
      }
      return { key, label, value: token || label };
    });
    const fallbackEntry = entries[0] || { key: 'model', label: 'Model', value: 'Model' };
    const entriesByKey = new Map(entries.map((entry) => [entry.key, entry]));

    const { inputs } = createSegmentedGroup(container, control, {
      layout: 'stacked',
      options: entries.length ? entries : [fallbackEntry],
    });

    let logicalValue = fallbackEntry.value;
    const resolveKey = (value) => {
      const token = String(value ?? '').toLowerCase();
      if (token.startsWith('model')) return 'model';
      if (token.includes('moon')) return 'preset-moon';
      if (token.startsWith('preset')) return 'preset-sun';
      return fallbackEntry.key;
    };

    attachSegmentedHandlers(control, inputs, {
      getValue: () => logicalValue,
      applyValue: (value) => {
        const key = resolveKey(value);
        const entry = entriesByKey.get(key) || fallbackEntry;
        logicalValue = entry.value;
        inputs.forEach((input) => {
          input.checked = (input.dataset.key || '') === key;
        });
      },
      onCommit: async (binding, input) => {
        const modeValue = input.value || fallbackEntry.value;
        binding.setValue(modeValue);
        try {
          await applySpecAction(store, backend, control, modeValue);
        } catch (err) {
          logWarn('[ui] visual source toggle failed', err);
          strictCatch(err, 'main:ui_visual_source_toggle');
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
        } catch (err) {
          strictCatch(err, 'main:dynamic_range_resolver');
        }
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
              value = toBoolean(value);
            }
            await applySpecAction(store, backend, control, value);
          } catch (error) {
            logWarn('[ui] reset failed', target.id, error);
            strictCatch(error, 'main:ui_reset');
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
      strictEnsure('ensureDynamicList', {
        reason: 'create_container',
        sectionId,
        dynamicKey,
      });
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
    strictEnsure('ensureDynamicList', {
      reason: 'rebuild',
      sectionId,
      dynamicKey,
      prevCount,
      count: items.length,
    });
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
        } catch (err) {
          strictCatch(err, 'main:update_options');
        }
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
        next = !toBoolean(current);
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
          strictCatch(error, 'main:ui_shortcut_handler');
        }
      }
    };
    root.addEventListener('keydown', handler, { capture: true });
    eventCleanup.push(() => {
      try {
        root.removeEventListener('keydown', handler, { capture: true });
      } catch (err) {
        strictCatch(err, 'main:shortcut_cleanup');
      }
      shortcutsInstalled = false;
    });
    shortcutsInstalled = true;
  }

    function dispose() {
      while (eventCleanup.length) {
        const fn = eventCleanup.pop();
        try {
          fn();
        } catch (err) {
          strictCatch(err, 'main:event_cleanup');
        }
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
                strictCatch(err, 'main:ui_set_actuator');
              }
            },
          });
      } catch (err) {
        logWarn('[ui] ensureActuatorSliders error', err);
        strictCatch(err, 'main:ui_ensure_actuator_sliders');
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
              strictCatch(err, 'main:ui_set_joint_qpos');
            }
          },
        });
      } catch (err) {
        logWarn('[ui] ensureJointSliders error', err);
        strictCatch(err, 'main:ui_ensure_joint_sliders');
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
            // Stable update: only sync active state + label; do not rebuild DOM to avoid removing nodes mid-interaction.
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
                strictCatch(err, 'main:ui_equality_toggle');
              }
            });
          },
        });
      } catch (err) {
        logWarn('[ui] ensureEqualityToggles error', err);
        strictCatch(err, 'main:ui_ensure_equality_toggles');
      }
    },
    dispose,
  };
}


export {
  DEFAULT_VIEWER_STATE,
  applyGesture,
  applySpecAction,
  createControlManager,
  createViewerStore,
  mergeBackendSnapshot,
  prepareBindingUpdate,
  readControlValue,
};
