import { prepareBindingUpdate, splitBinding } from './bindings.mjs';

// Lightweight state container and backend helpers for the simulate parity UI.
// Runtime implementation lives in JS so it can be consumed directly by the
// buildless viewer. Type definitions are provided separately in state.ts.

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
    realTimeIndex: 0,
  },
  runtime: {
    cameraIndex: 0,
    cameraLabel: 'Free',
    lastAction: 'idle',
    gesture: {
      mode: 'idle',
      phase: 'idle',
    },
    drag: {
      dx: 0,
      dy: 0,
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
    ctrl: [],
    optSupport: { supported: false, pointers: [] },
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
    voptFlags: Array.from({ length: 32 }, () => false),
    sceneFlags: Array.from({ length: 8 }, () => false),
    labelMode: 0,
    frameMode: 0,
    assets: null,
  },
  hud: {
    time: 0,
    frames: 0,
    fps: 0,
    rate: 1,
    ngeom: 0,
    pausedSource: 'backend',
    rateSource: 'backend',
  },
  toast: null,
  // Optional scene snapshot (mjvScene-like) carried by backend
  scene: null,
});

const CAMERA_PRESETS = ['Free', 'Tracking', 'Fixed 1', 'Fixed 2', 'Fixed 3'];
let latestHudTime = 0;
const TIME_RESET_EPSILON = 1e-6;
const MODEL_ALIASES = {
  demo: 'demo_box.xml',
  box: 'demo_box.xml',
  pendulum: 'pendulum.xml',
  rkob: 'RKOB_simplified_upper_with_marker_CAMS.xml',
};

const SNAPSHOT_DEBUG_FLAG = (() => {
  try {
    if (typeof location !== 'undefined' && location?.href) {
      const url = new URL(location.href);
      return url.searchParams.get('snapshot') === '1';
    }
  } catch {}
  return false;
})();

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
    case 'edit_rgba':
      if (Array.isArray(raw)) {
        return raw.map((value) => String(value ?? '')).join(' ');
      }
      if (raw === null || raw === undefined) return '';
      return String(raw).trim();
    case 'radio':
      if (typeof raw === 'string') return raw;
      if (Array.isArray(control.options) && typeof raw === 'number') {
        return control.options[raw] ?? control.options[0];
      }
      return raw;
    case 'select':
      return raw;
    default:
      return raw;
  }
}

function cameraLabelFromIndex(index) {
  const i = index | 0;
  return CAMERA_PRESETS[i] ?? `Fixed ${i}`;
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
  }
  if (typeof snapshot.ngeom === 'number' && Number.isFinite(snapshot.ngeom)) {
    draft.hud.ngeom = snapshot.ngeom | 0;
  }
  if (typeof snapshot.pausedSource === 'string') {
    draft.hud.pausedSource = snapshot.pausedSource;
  }
  if (typeof snapshot.rateSource === 'string') {
    draft.hud.rateSource = snapshot.rateSource;
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
    if (typeof gesture.mode === 'string' && gesture.mode.length > 0 && gesture.mode !== 'idle') {
      draft.runtime.lastAction = gesture.mode;
    } else if (!draft.runtime.lastAction) {
      draft.runtime.lastAction = 'idle';
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
  if (typeof snapshot.cameraMode === 'number' && Number.isFinite(snapshot.cameraMode)) {
    const idx = snapshot.cameraMode | 0;
    draft.runtime.cameraIndex = idx;
    draft.runtime.cameraLabel = cameraLabelFromIndex(idx);
  }
  if (Array.isArray(snapshot.voptFlags)) {
    const rendering = ensureRenderingState(draft);
    rendering.voptFlags = snapshot.voptFlags.map((flag) => !!flag);
  }
  if (Array.isArray(snapshot.sceneFlags)) {
    const rendering = ensureRenderingState(draft);
    rendering.sceneFlags = snapshot.sceneFlags.map((flag) => !!flag);
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
  if (snapshot.scene) {
    // Persist scene snapshot for diagnostics / external tools
    draft.scene = snapshot.scene;
  }
  if (snapshot.options) {
    if (!draft.model) draft.model = {};
    draft.model.opt = {
      ...(draft.model.opt || {}),
      ...snapshot.options,
    };
  }
  if (snapshot.visual) {
    if (!draft.model) draft.model = {};
    draft.model.vis = deepMerge(draft.model.vis || {}, snapshot.visual);
  }
  if (snapshot.visualDefaults) {
    if (!draft.model) draft.model = {};
    draft.model.visDefaults = deepMerge(draft.model.visDefaults || {}, snapshot.visualDefaults);
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
    draft.runtime.cameraLabel = cameraLabelFromIndex(mode);
  }
}

function ensureRenderingState(target) {
  if (!target.rendering) {
    target.rendering = {
      voptFlags: Array.from({ length: 32 }, () => false),
      sceneFlags: Array.from({ length: 8 }, () => false),
      labelMode: 0,
      frameMode: 0,
    };
  } else {
    if (!Array.isArray(target.rendering.voptFlags)) {
      target.rendering.voptFlags = Array.from({ length: 32 }, () => false);
    }
    if (!Array.isArray(target.rendering.sceneFlags)) {
      target.rendering.sceneFlags = Array.from({ length: 8 }, () => false);
    }
    if (typeof target.rendering.labelMode !== 'number') {
      target.rendering.labelMode = 0;
    }
    if (typeof target.rendering.frameMode !== 'number') {
      target.rendering.frameMode = 0;
    }
  }
  return target.rendering;
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
    case 'Simulate::run': {
      if (typeof value === 'string') {
        draft.simulation.run = value.toLowerCase() !== 'pause';
      } else {
        draft.simulation.run = bool(value);
      }
      return true;
    }
    case 'Simulate::camera': {
      const idx = Math.max(0, Math.trunc(toNumber(value)));
      draft.runtime.cameraIndex = idx;
      draft.runtime.cameraLabel = cameraLabelFromIndex(idx);
      return true;
    }
    case 'Simulate::scrub_index':
      draft.simulation.scrubIndex = Math.trunc(toNumber(value));
      return true;
    case 'Simulate::key':
      draft.simulation.keyIndex = Math.trunc(toNumber(value));
      return true;
    default:
      break;
  }

  if (binding?.startsWith('Simulate::disable[')) {
    const name = control?.label ?? control?.name ?? binding;
    draft.physics.disableFlags[name] = bool(value);
    return true;
  }
  if (binding?.startsWith('Simulate::enable[')) {
    const name = control?.label ?? control?.name ?? binding;
    draft.physics.enableFlags[name] = bool(value);
    return true;
  }
  if (binding?.startsWith('Simulate::enableactuator[')) {
    const name = control?.label ?? control?.name ?? binding;
    draft.physics.actuatorGroups[name] = bool(value);
    return true;
  }
  return false;
}

function applyStructBindingToModel(draft, scope, pathSegments, value) {
  if (!scope || !Array.isArray(pathSegments)) return false;
  if (!draft.model) draft.model = {};
  if (scope === 'mjOption') {
    draft.model.opt = draft.model.opt || {};
    assignStructPath(draft.model.opt, pathSegments, value);
    return true;
  }
  if (scope === 'mjVisual') {
    draft.model.vis = draft.model.vis || {};
    assignStructPath(draft.model.vis, pathSegments, value);
    return true;
  }
  if (scope === 'mjStatistic') {
    draft.model.stat = draft.model.stat || {};
    assignStructPath(draft.model.stat, pathSegments, value);
    return true;
  }
  return false;
}

function applyControl(draft, control, value) {
  if (!control) return false;
  if (control.item_id === 'simulation.reset') {
    latestHudTime = 0;
    draft.simulation.run = false;
    draft.hud.time = 0;
    draft.hud.frames = 0;
    draft.hud.fps = 0;
    draft.toast = { message: 'Simulation reset', ts: Date.now() };
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
  if (control.item_id === 'file.screenshot') {
    draft.toast = { message: 'Screenshot captured', ts: Date.now() };
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
    const voptMatch = binding.match(/^mjvOption::flags\[(\d+)\]$/);
    if (voptMatch) {
      const idx = Number(voptMatch[1]);
      const rendering = ensureRenderingState(draft);
      rendering.voptFlags[idx] = bool(value);
      return true;
    }
    const sceneMatch = binding.match(/^mjvScene::flags\[(\d+)\]$/);
    if (sceneMatch) {
      const idx = Number(sceneMatch[1]);
      const rendering = ensureRenderingState(draft);
      rendering.sceneFlags[idx] = bool(value);
      return true;
    }
    if (binding === 'mjvOption::label') {
      const rendering = ensureRenderingState(draft);
      rendering.labelMode = Math.max(0, Math.trunc(toNumber(value)));
      return true;
    }
    if (binding === 'mjvOption::frame') {
      const rendering = ensureRenderingState(draft);
      rendering.frameMode = Math.max(0, Math.trunc(toNumber(value)));
      return true;
    }
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
    case 'Simulate::scrub_index':
      return state.simulation.scrubIndex | 0;
    case 'Simulate::key':
      return state.simulation.keyIndex | 0;
    default:
      break;
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
  if (control.item_id === 'file.screenshot') return null;
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
        console.error(err);
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
  let snapshot = null;
  if (backend && typeof backend.apply === 'function') {
    try {
      snapshot = await backend.apply({ kind: 'ui', id: control.item_id, value, control });
    } catch (err) {
      console.error('[backend.apply] failed', err);
    }
  }

  store.update((draft) => {
    applyControl(draft, control, value);
    if (prepared) {
      applyStructBindingToModel(draft, prepared.meta.scope, prepared.meta.path, prepared.value);
    }
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
    if (phase !== 'end') {
      draft.runtime.lastAction = mode;
    }
    draft.runtime.gesture = {
      ...(draft.runtime.gesture || {}),
      mode: phase === 'end' ? 'idle' : mode,
      phase,
      pointer,
    };
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
        console.error('[backend.apply gesture] failed', err);
      });
  }
}

const WORKER_URL = new URL('../../physics.worker.mjs', import.meta.url);
const DIRECT_URL = new URL('../../direct_backend.mjs', import.meta.url);

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
    sceneFlags: Array.isArray(state.sceneFlags)
      ? state.sceneFlags.map((flag) => (flag ? 1 : 0))
      : Array.from({ length: 8 }, () => 0),
    labelMode: Number.isFinite(state.labelMode) ? (state.labelMode | 0) : 0,
    frameMode: Number.isFinite(state.frameMode) ? (state.frameMode | 0) : 0,
    cameraMode: Number.isFinite(state.cameraMode) ? (state.cameraMode | 0) : 0,
    actuators: Array.isArray(state.actuators) ? state.actuators.slice() : null,
    scene: state.scene ?? null,
    options: state.options ?? null,
    ctrl: state.ctrl ? Array.from(state.ctrl) : null,
    frameId: Number.isFinite(state.frameId) ? (state.frameId | 0) : null,
    optionSupport: state.optionSupport ? { ...state.optionSupport } : null,
    visual: cloneStruct(state.visual),
    statistic: cloneStruct(state.statistic),
    visualDefaults: cloneStruct(state.visualDefaults),
    xpos: viewOrNull(state.xpos, Float64Array),
    xmat: viewOrNull(state.xmat, Float64Array),
    gsize: viewOrNull(state.gsize, Float64Array),
    gtype: viewOrNull(state.gtype, Int32Array),
    gmatid: viewOrNull(state.gmatid, Int32Array),
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
  };
}

export async function createBackend(options = {}) {
  const mode = options.mode ?? 'auto';
  const debug = !!options.debug;
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
  const listeners = new Set();
  let client = null;
  let kind = 'direct';
  let paused = false;
  let rate = 1;
  let visualOverrideApplied = false;
  let lastSnapshot = {
    t: 0,
    rate: 1,
    paused: false,
    ngeom: 0,
    nq: 0,
    nv: 0,
    pausedSource: 'backend',
    rateSource: 'backend',
    gesture: { mode: 'idle', phase: 'idle', pointer: null },
    drag: { dx: 0, dy: 0 },
    voptFlags: Array.from({ length: 32 }, () => 0),
    sceneFlags: Array.from({ length: 8 }, () => 0),
    labelMode: 0,
    frameMode: 0,
    cameraMode: 0,
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
    scene: null,
    options: null,
    ctrl: null,
    optionSupport: { supported: false, pointers: [] },
    visual: null,
    statistic: null,
    visualDefaults: null,
  };
  let lastFrameId = -1;
  let messageHandler = null;

  async function spawnWorkerBackend() {
    const workerUrl = new URL(WORKER_URL.href);
    if (SNAPSHOT_DEBUG_FLAG) workerUrl.searchParams.set('snapshot', '1');
    workerUrl.searchParams.set('cb', String(Date.now()));
    const worker = new Worker(workerUrl, { type: 'module' });
    return worker;
  }

  async function spawnDirectBackend() {
    const mod = await import(/* @vite-ignore */ DIRECT_URL.href);
    if (typeof mod.createDirectBackend !== 'function') {
      throw new Error('createDirectBackend missing');
    }
    return mod.createDirectBackend({
      ver: options.ver ?? '3.3.7',
      shimParam: options.shimParam ?? 'local',
      debug,
      snapshotDebug,
    });
  }

  async function loadDefaultXml() {
    const fallback = `<?xml version='1.0'?>
<mujoco model='empty'>
  <option timestep='0.002'/>
  <worldbody>
    <body name='box' pos='0 0 0.1'>
      <geom type='box' size='0.05 0.05 0.05' rgba='0.2 0.6 0.9 1'/>
    </body>
  </worldbody>
</mujoco>`;

    const candidates = [];
    const seen = new Set();
    if (modelFile) {
      candidates.push({ file: modelFile, label: modelToken || modelFile });
    }
    candidates.push({ file: 'demo_box.xml', label: 'demo_box.xml' });

    for (const candidate of candidates) {
      const file = candidate.file;
      if (!file || seen.has(file)) continue;
      seen.add(file);
      try {
        const url = new URL(`../../${file}`, import.meta.url);
        const res = await fetch(url, { cache: 'no-store' });
        if (!res.ok) {
          if (debug) console.warn(`[backend] fetch ${file} failed with status ${res.status}`);
          continue;
        }
        const text = await res.text();
        if (text && text.trim().length > 0) {
          if (debug) console.log('[backend] loaded xml', file);
          return text;
        }
      } catch (err) {
        if (debug) console.warn('[backend] failed to fetch xml', { file, err });
      }
    }
    if (debug) console.warn('[backend] falling back to inline demo xml');
    return fallback;
  }

  if (mode === 'worker' || mode === 'auto') {
    try {
      client = await spawnWorkerBackend();
      kind = 'worker';
    } catch (err) {
      if (debug) console.warn('[backend] worker init failed', err);
      if (mode === 'worker') throw err;
    }
  }
  if (!client) {
    client = await spawnDirectBackend();
    kind = 'direct';
  }

  function notifyListeners() {
    lastSnapshot.rate = rate;
    lastSnapshot.paused = paused;
    if (!lastSnapshot.rateSource) lastSnapshot.rateSource = 'backend';
    if (!lastSnapshot.pausedSource) lastSnapshot.pausedSource = 'backend';
    const snapshot = resolveSnapshot(lastSnapshot);
    for (const fn of listeners) {
      try {
        fn(snapshot);
      } catch (err) {
        console.error(err);
      }
    }
    return snapshot;
  }

  function applyOptionSnapshot(data) {
    if (!data || typeof data !== 'object') return;
    if (Array.isArray(data.voptFlags)) {
      lastSnapshot.voptFlags = data.voptFlags.map((flag) => (flag ? 1 : 0));
    }
    if (Array.isArray(data.sceneFlags)) {
      lastSnapshot.sceneFlags = data.sceneFlags.map((flag) => (flag ? 1 : 0));
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
  }

  function applyVisualOverrides() {
    if (visualOverrideApplied || typeof client?.postMessage !== 'function') return;
    for (const entry of VISUAL_OVERRIDE_PRESET) {
      try {
        client.postMessage({
          cmd: 'setField',
          target: 'mjVisual',
          path: entry.path,
          kind: entry.kind,
          size: entry.size,
          value: entry.value,
        });
      } catch (err) {
        if (debug) console.warn('[backend vis override] failed', entry.path, err);
      }
    }
    visualOverrideApplied = true;
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
    lastSnapshot.gsize = makeView(data.gsize, null, Float64Array);
    lastSnapshot.gtype = makeView(data.gtype, null, Int32Array);
    lastSnapshot.gmatid = makeView(data.gmatid, null, Int32Array);
    lastSnapshot.matrgba = makeView(data.matrgba, null, Float32Array);
    lastSnapshot.contacts = data.contacts && typeof data.contacts === 'object' ? data.contacts : null;
  }

  function handleMessage(event) {
    const data = event?.data ?? event;
    if (!data || typeof data !== 'object') return;
    if (debug) {
      const key = '__backendLogCounter';
      handleMessage[key] = handleMessage[key] || { snapshot: 0 };
      if (data.kind === 'snapshot') {
        const info = handleMessage[key];
        if (info.snapshot < 3 || (Date.now() - (info.lastSnapshotTs || 0)) > 5000) {
          console.log('[backend] message', data.kind, { ngeom: data.ngeom, t: data.tSim });
        }
        info.snapshot += 1;
        info.lastSnapshotTs = Date.now();
      } else {
        console.log('[backend] message', data.kind, data);
      }
    }
    switch (data.kind) {
      case 'ready':
        lastFrameId = -1;
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
        applyVisualOverrides();
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
          if (debug) console.warn('[backend] ctrl decode failed', err);
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
        const frameId = Number.isFinite(data.frameId) ? (data.frameId | 0) : null;
        if (frameId !== null) {
          if (frameId <= lastFrameId) {
            if (debug) console.warn('[backend] drop stale snapshot', frameId, lastFrameId);
            break;
          }
          lastFrameId = frameId;
          lastSnapshot.frameId = frameId;
        }
        if (debug) {
          handleMessage.__ctrlLog = handleMessage.__ctrlLog || { count: 0 };
          const info = handleMessage.__ctrlLog;
          if (info.count < 5) {
            const len = data.ctrl && typeof data.ctrl.length === 'number' ? data.ctrl.length : null;
            console.log('[backend] snapshot ctrl len', len);
            info.count += 1;
          }
        }
        if (typeof data.tSim === 'number') lastSnapshot.t = data.tSim;
        if (typeof data.ngeom === 'number') lastSnapshot.ngeom = data.ngeom;
        if (typeof data.nq === 'number') lastSnapshot.nq = data.nq;
        if (typeof data.nv === 'number') lastSnapshot.nv = data.nv;
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
      }
      case 'render_assets':
        if (data.assets) {
          lastSnapshot.renderAssets = data.assets;
          notifyListeners();
        }
        break;
      case 'scene_snapshot': {
        const source = data.source || 'sim';
        if (typeof window !== 'undefined' && data.snap) {
          window.__sceneSnaps = window.__sceneSnaps || {};
          window.__sceneSnaps[source] = data.snap;
        }
        if (data.snap) {
          lastSnapshot.scene = data.snap;
          notifyListeners();
        }
        if (debug) console.log('[snapshot]', source, data.frame ?? null);
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
        lastSnapshot.copyState = {
          seq,
          precision,
          nq: Number(data.nq) || 0,
          nv: Number(data.nv) || 0,
          timestamp: Number(data.timestamp) || Date.now(),
          complete: !!data.complete,
          qposPreview,
          qvelPreview,
        };
        notifyListeners();
        break;
      }
      case 'options':
        applyOptionSnapshot(data);
        notifyListeners();
        break;
      case 'log':
        if (debug) console.log('[backend]', data.message ?? '', data.extra ?? '');
        break;
      case 'error':
        if (debug) console.error('[backend error]', data);
        break;
      default:
        break;
    }
  }

  if (typeof client.addEventListener === 'function') {
    messageHandler = (evt) => handleMessage(evt);
    client.addEventListener('message', messageHandler);
    if (kind === 'worker') {
      client.addEventListener('error', (evt) => console.error('[backend worker error]', evt));
    }
  } else if ('onmessage' in client) {
    messageHandler = (evt) => handleMessage(evt);
    client.onmessage = messageHandler;
  }

  let initialXml = await loadDefaultXml();
  if (typeof client.postMessage === 'function') {
    try {
      visualOverrideApplied = false;
      lastSnapshot.visualDefaults = null;
      client.postMessage({ cmd: 'load', rate, xmlText: initialXml });
      client.postMessage({ cmd: 'snapshot' });
    } catch (err) {
      console.error('[backend load] failed', err);
    }
  }

  async function apply(payload) {
    if (!payload) {
      return resolveSnapshot(lastSnapshot);
    }
    if (payload.kind === 'gesture') {
      const mode = payload.mode ?? payload.gesture?.mode ?? lastSnapshot.gesture?.mode ?? 'idle';
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
      if (!lastSnapshot.gesture) {
        lastSnapshot.gesture = { mode: 'idle', phase: 'idle' };
      }
      lastSnapshot.gesture = {
        ...lastSnapshot.gesture,
        mode: phase === 'end' ? 'idle' : mode,
        phase,
        pointer,
      };
      if (!lastSnapshot.drag) {
        lastSnapshot.drag = { dx: 0, dy: 0 };
      }
      if (dragSource) {
        lastSnapshot.drag = {
          dx: Number(dragSource.dx) || 0,
          dy: Number(dragSource.dy) || 0,
        };
      }
      if (phase === 'end' && !dragSource) {
        lastSnapshot.drag = { dx: 0, dy: 0 };
      }
      try {
        client.postMessage?.({
          cmd: 'gesture',
          gesture: lastSnapshot.gesture,
          pointer,
          drag: lastSnapshot.drag,
        });
      } catch (err) {
        console.error('[backend gesture] failed', err);
      }
      notifyListeners();
      return resolveSnapshot(lastSnapshot);
    }
    if (payload.kind !== 'ui') {
      return resolveSnapshot(lastSnapshot);
    }
    const { id, value, control } = payload;
    const binding = typeof control?.binding === 'string' ? control.binding : null;
    if (binding === 'Simulate::camera') {
      const modeValue = Math.max(0, Math.trunc(toNumber(value)));
      lastSnapshot.cameraMode = modeValue;
      try { client.postMessage?.({ cmd: 'setCameraMode', mode: modeValue }); } catch (err) {
        if (debug) console.warn('[backend camera] post failed', err);
      }
      notifyListeners();
      return resolveSnapshot(lastSnapshot);
    }
    // Generic actuator control (dynamic UI)
    if (id === 'control.actuator') {
      try {
        const idx = Number(value?.index ?? value?.i ?? value?.id);
        const v = Number(value?.value ?? value?.v ?? 0);
        if (Number.isFinite(idx) && idx >= 0) {
          client.postMessage?.({ cmd: 'setCtrl', index: idx | 0, value: v });
          // Optimistically update local copy if present
          if (Array.isArray(lastSnapshot.actuators) && lastSnapshot.actuators[idx|0]) {
            lastSnapshot.actuators[idx|0].value = v;
          }
          notifyListeners();
        }
      } catch (err) {
        if (debug) console.warn('[backend control.actuator] failed', err);
      }
      return resolveSnapshot(lastSnapshot);
    }
    if (id === 'control.clear') {
      try {
        const acts = Array.isArray(lastSnapshot.actuators) ? lastSnapshot.actuators : [];
        for (let i = 0; i < acts.length; i += 1) {
          try { client.postMessage?.({ cmd: 'setCtrl', index: i, value: 0 }); } catch {}
          if (acts[i]) acts[i].value = 0;
        }
      } catch {}
      notifyListeners();
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
      } catch (err) {
        if (debug) console.warn('[backend setField] post failed', err);
      }
      return resolveSnapshot(lastSnapshot);
    }
    const voptMatch = binding?.match(/^mjvOption::flags\[(\d+)\]$/);
    if (voptMatch) {
      const idx = Number(voptMatch[1]);
      const enabled = bool(value);
      if (!Array.isArray(lastSnapshot.voptFlags)) {
        lastSnapshot.voptFlags = Array.from({ length: 32 }, () => 0);
      }
      lastSnapshot.voptFlags[idx] = enabled ? 1 : 0;
      try { client.postMessage?.({ cmd: 'setVoptFlag', index: idx, enabled }); } catch (err) {
        if (debug) console.warn('[backend vopt flag] post failed', err);
      }
      notifyListeners();
      return resolveSnapshot(lastSnapshot);
    }
    const sceneMatch = binding?.match(/^mjvScene::flags\[(\d+)\]$/);
    if (sceneMatch) {
      const idx = Number(sceneMatch[1]);
      const enabled = bool(value);
      if (!Array.isArray(lastSnapshot.sceneFlags)) {
        lastSnapshot.sceneFlags = Array.from({ length: 8 }, () => 0);
      }
      lastSnapshot.sceneFlags[idx] = enabled ? 1 : 0;
      try { client.postMessage?.({ cmd: 'setSceneFlag', index: idx, enabled }); } catch (err) {
        if (debug) console.warn('[backend scene flag] post failed', err);
      }
      notifyListeners();
      return resolveSnapshot(lastSnapshot);
    }
    if (binding === 'mjvOption::label') {
      const mode = Math.max(0, Math.trunc(toNumber(value)));
      lastSnapshot.labelMode = mode;
      try { client.postMessage?.({ cmd: 'setLabelMode', mode }); } catch (err) {
        if (debug) console.warn('[backend label mode] post failed', err);
      }
      notifyListeners();
      return resolveSnapshot(lastSnapshot);
    }
    if (binding === 'mjvOption::frame') {
      const mode = Math.max(0, Math.trunc(toNumber(value)));
      lastSnapshot.frameMode = mode;
      try { client.postMessage?.({ cmd: 'setFrameMode', mode }); } catch (err) {
        if (debug) console.warn('[backend frame mode] post failed', err);
      }
      notifyListeners();
      return resolveSnapshot(lastSnapshot);
    }
    switch (id) {
      case 'simulation.run': {
        const run = value === 'Run' || value === true || value === 1;
        paused = !run;
        client.postMessage?.({ cmd: 'setPaused', paused });
        lastSnapshot.pausedSource = 'ui';
        notifyListeners();
        break;
      }
      case 'simulation.reset':
        client.postMessage?.({ cmd: 'reset' });
        lastSnapshot.pausedSource = 'ui';
        notifyListeners();
        break;
      case 'simulation.align': {
        try {
          client.postMessage?.({ cmd: 'align', source: 'ui' });
        } catch (err) {
          if (debug) console.warn('[backend align] post failed', err);
        }
        break;
      }
      case 'simulation.copy_state': {
        const meta = value && typeof value === 'object' ? value : {};
        const precision = meta.shiftKey ? 'full' : 'standard';
        try {
          client.postMessage?.({ cmd: 'copyState', precision, source: 'ui' });
        } catch (err) {
          if (debug) console.warn('[backend copyState] post failed', err);
        }
        break;
      }
      case 'simulation.noise_rate':
      case 'simulation.noise_scale':
      case 'simulation.history_scrubber':
      case 'simulation.key_slider':
      case 'simulation.key':
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
    const n = Math.max(1, Math.abs(direction | 0) || 1);
    client.postMessage?.({ cmd: 'step', n });
    return resolveSnapshot(lastSnapshot);
  }

  async function setCameraIndex() {
    return resolveSnapshot(lastSnapshot);
  }

  function dispose() {
    if (messageHandler) {
      try { client.removeEventListener?.('message', messageHandler); } catch {}
    }
    if (kind === 'worker' && client?.terminate) {
      client.terminate();
    } else {
      client?.terminate?.();
    }
  }

  return {
    kind,
    apply,
    snapshot,
    subscribe,
    step,
    setCameraIndex,
    dispose,
  };
}

export {
  DEFAULT_VIEWER_STATE,
  applyControl,
  readControlValue,
  cameraLabelFromIndex,
  mergeBackendSnapshot,
};
const VISUAL_OVERRIDE_PRESET = [
  { path: ['headlight', 'active'], kind: 'enum', size: 1, value: 1 },
  { path: ['headlight', 'ambient'], kind: 'float_vec', size: 3, value: [0.1, 0.1, 0.1] },
  { path: ['headlight', 'diffuse'], kind: 'float_vec', size: 3, value: [0.4, 0.4, 0.4] },
  { path: ['headlight', 'specular'], kind: 'float_vec', size: 3, value: [0.5, 0.5, 0.5] },
  { path: ['map', 'stiffness'], kind: 'float', size: 1, value: 100 },
  { path: ['map', 'stiffnessrot'], kind: 'float', size: 1, value: 500 },
  { path: ['map', 'force'], kind: 'float', size: 1, value: 0.005 },
  { path: ['map', 'torque'], kind: 'float', size: 1, value: 0.1 },
  { path: ['map', 'alpha'], kind: 'float', size: 1, value: 0.3 },
  { path: ['map', 'fogstart'], kind: 'float', size: 1, value: 3 },
  { path: ['map', 'fogend'], kind: 'float', size: 1, value: 10 },
  { path: ['map', 'znear'], kind: 'float', size: 1, value: 0.01 },
  { path: ['map', 'zfar'], kind: 'float', size: 1, value: 50 },
  { path: ['map', 'haze'], kind: 'float', size: 1, value: 0.3 },
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
  { path: ['rgba', 'fog'], kind: 'float_vec', size: 4, value: [0, 0, 0, 1] },
  { path: ['rgba', 'haze'], kind: 'float_vec', size: 4, value: [1, 1, 1, 1] },
  { path: ['rgba', 'force'], kind: 'float_vec', size: 4, value: [1, 0.5, 0.5, 1] },
  { path: ['rgba', 'inertia'], kind: 'float_vec', size: 4, value: [0.8, 0.2, 0.2, 0.6] },
  { path: ['rgba', 'joint'], kind: 'float_vec', size: 4, value: [0.2, 0.6, 0.8, 1] },
  { path: ['rgba', 'actuator'], kind: 'float_vec', size: 4, value: [0.2, 0.25, 0.2, 1] },
  { path: ['rgba', 'actuatornegative'], kind: 'float_vec', size: 4, value: [0.2, 0.6, 0.9, 1] },
  { path: ['rgba', 'actuatorpositive'], kind: 'float_vec', size: 4, value: [0.9, 0.4, 0.2, 1] },
  { path: ['rgba', 'com'], kind: 'float_vec', size: 4, value: [0.9, 0.9, 0.9, 1] },
  { path: ['rgba', 'camera'], kind: 'float_vec', size: 4, value: [0.6, 0.9, 0.6, 1] },
  { path: ['rgba', 'light'], kind: 'float_vec', size: 4, value: [0.6, 0.6, 0.9, 1] },
  { path: ['rgba', 'selectpoint'], kind: 'float_vec', size: 4, value: [0.9, 0.9, 0.1, 1] },
];
