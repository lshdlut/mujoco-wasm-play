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
} from '../core/viewer_runtime.mjs';
import { DEFAULT_REALTIME_INDEX, DEFAULT_VOPT_FLAGS, REALTIME_LEVELS, SCENE_FLAG_DEFAULTS } from '../core/viewer_defaults.mjs';
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
} from '../core/viewer_shared.mjs';
import { STAT_FIELD_DESCRIPTORS, VISUAL_FIELD_DESCRIPTORS } from '../core/viewer_structs.mjs';
import { FALLBACK_PRESETS } from '../environment/environment.mjs';
import { buildMuJoCoBundle as buildMuJoCoBundleCore, normaliseMuJoCoVirtualPath, parseMuJoCoDirectFileRefs } from '../core/xml_refs.mjs';
import { getControlBindingSpec, normaliseControlInput, resolveBindingSpec } from './bindings.mjs';

export function clamp01(value) {
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
      // MuJoCo default when no skybox texture exists: clear to black.
      clearColor: 0x000000,
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
  const strictEnabled = isStrictEnabled();
  const snapshotSummary = strictEnabled
    ? (state) => ({
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
      })
    : null;
  const before = snapshotSummary ? snapshotSummary(draft) : null;
  const snapshotKeys = strictEnabled ? Object.keys(snapshot || {}) : null;
  const applied = strictEnabled ? [] : null;
  const structDiffs = strictEnabled ? {} : null;
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
      if (structDiffs) {
        structDiffs.visual = diffStruct(model.vis, nextVisual, VISUAL_FIELD_DESCRIPTORS);
      }
      model.vis = nextVisual;
      lastVisualVersion = visualVersion;
      applied?.push('visual');
    }
  }
  const baselines = ensureVisualCache(draft, 'visualBaselines');
  if (snapshot.visualDefaults) {
    const shouldApplyDefaults =
      !baselines.model || (visualDefaultsVersion != null && visualDefaultsVersion !== lastVisualDefaultsVersion);
    if (shouldApplyDefaults) {
      const nextDefaults = cloneStruct(snapshot.visualDefaults) || {};
      if (structDiffs) {
        structDiffs.visualDefaults = diffStruct(model.visDefaults, nextDefaults, VISUAL_FIELD_DESCRIPTORS);
      }
      model.visDefaults = nextDefaults;
      baselines.model = cloneStruct(nextDefaults);
      baselines.sceneFlagsModel = normaliseSceneFlagArray(snapshot.sceneFlags);
      baselines.presetSun = null;
      baselines.sceneFlagsPresetSun = null;
      baselines.presetMoon = null;
      baselines.sceneFlagsPresetMoon = null;
      lastVisualDefaultsVersion = visualDefaultsVersion;
      applied?.push('visualDefaults');
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
      if (structDiffs) {
        structDiffs.statistic = diffStruct(model.stat, nextStat, STAT_FIELD_DESCRIPTORS);
      }
      model.stat = nextStat;
      lastStatisticVersion = statisticVersion;
      applied?.push('statistic');
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
  if (strictEnabled && snapshotSummary) {
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
        camSyncSeq: payload.camSyncSeq,
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



export {
  DEFAULT_VIEWER_STATE,
  applyGesture,
  applySpecAction,
  createViewerStore,
  mergeBackendSnapshot,
  readControlValue,
  resetModelFrontendState,
};
