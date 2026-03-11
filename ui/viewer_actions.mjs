import {
  logError,
  strictCatch,
  strictEnsure,
  strictOverride,
} from '../core/viewer_runtime.mjs';
import {
  assignStructPath,
  bool,
  cloneStruct,
  resolveStructPath,
  toNumber,
} from '../core/viewer_shared.mjs';
import { SCENE_FLAG_DEFAULTS } from '../core/viewer_defaults.mjs';
 import {
  getSnapshotCameraMode,
  getSnapshotFrameMode,
  getSnapshotGroups,
  getSnapshotHistory,
  getSnapshotKeyframes,
  getSnapshotLabelMode,
  getSnapshotMaskState,
  getSnapshotSceneFlags,
  getSnapshotSimOption,
  getSnapshotSimulation,
  getSnapshotStructValue,
  getSnapshotVoptFlags,
  getSnapshotWatch,
} from '../core/snapshot_selectors.mjs';
import { getFallbackPreset } from '../environment/environment.mjs';
import {
  DEFAULT_VIEWER_STATE,
  VISUAL_SOURCE_CACHE_TEMPLATE,
  syncRuntimeConfigFromViewerState,
} from './state.mjs';
import { getControlBindingSpec, normaliseControlInput, resolveBindingSpec } from './bindings.mjs';

function ensureThemeState(draft) {
  if (draft.theme && typeof draft.theme === 'object') return draft.theme;
  draft.theme = cloneStruct(DEFAULT_VIEWER_STATE.theme);
  return draft.theme;
}

function ensureRenderingState(draft) {
  if (draft.rendering && typeof draft.rendering === 'object') return draft.rendering;
  draft.rendering = cloneStruct(DEFAULT_VIEWER_STATE.rendering);
  return draft.rendering;
}

function parseThemeBinary(value, { onTokens = [], offTokens = [] } = {}) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(0, Math.trunc(value));
  }
  if (typeof value === 'string') {
    const token = value.trim().toLowerCase();
    if (/^[01]$/.test(token)) return token === '1' ? 1 : 0;
    if (onTokens.some((entry) => token.startsWith(entry))) return 1;
    if (offTokens.some((entry) => token.startsWith(entry))) return 0;
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
  overlay: (state, snapshot, spec) => !!state.overlays?.[spec.key],
  run: (state, snapshot, spec, control) => {
    const run = !!getSnapshotSimulation(snapshot).run;
    if (control && Array.isArray(control.options)) {
      return run ? control.options[1] ?? 'Run' : control.options[0] ?? 'Pause';
    }
    return run;
  },
  camera: (state, snapshot) => getSnapshotCameraMode(snapshot) ?? 0,
  tracking_geom: (state) => (Number.isFinite(state.runtime.trackingGeom) ? state.runtime.trackingGeom : -1),
  scrub_index: (state, snapshot) => getSnapshotSimulation(snapshot).scrubIndex | 0,
  key_index: (state, snapshot) => getSnapshotSimulation(snapshot).keyIndex | 0,
  watch_field: (state, snapshot) => getSnapshotWatch(snapshot).field ?? 'qpos',
  watch_index: (state, snapshot) => (Number.isFinite(getSnapshotWatch(snapshot).index) ? (getSnapshotWatch(snapshot).index | 0) : 0),
  theme: (state, snapshot, spec) => (Number.isFinite(state.theme?.[spec.key]) ? state.theme[spec.key] | 0 : 0),
  watch_summary: (state, snapshot) => {
    const watch = getSnapshotWatch(snapshot);
    if (watch?.summary) return watch.summary;
    if (typeof watch?.value === 'number' && Number.isFinite(watch.value)) {
      return watch.value.toFixed(6);
    }
    return '—';
  },
  group: (state, snapshot, spec) => {
    const groups = getSnapshotGroups(snapshot);
    const arr = Array.isArray(groups?.[spec.group]) ? groups[spec.group] : null;
    if (!arr) return true;
    if (spec.index >= 0 && spec.index < arr.length) {
      return !!arr[spec.index];
    }
    return true;
  },
  mask: (state, snapshot, spec) => {
    const flags = getSnapshotMaskState(snapshot, spec.mask);
    const name = spec.name ?? spec.binding ?? '';
    return !!flags[name];
  },
  sim_opt: (state, snapshot, spec) => getSnapshotSimOption(snapshot, spec.field) ?? 0,
  struct: (state, snapshot, spec) => getSnapshotStructValue(snapshot, spec.scope, spec.path),
  vopt_flag: (state, snapshot, spec) => !!getSnapshotVoptFlags(snapshot)?.[spec.index],
  scene_flag: (state, snapshot, spec) => !!getSnapshotSceneFlags(snapshot)?.[spec.index],
  label_mode: (state, snapshot) => getSnapshotLabelMode(snapshot) ?? 0,
  frame_mode: (state, snapshot) => getSnapshotFrameMode(snapshot) ?? 0,
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

function formatKeyframeLabelFromSnapshot(snapshot, index) {
  const keyframes = getSnapshotKeyframes(snapshot);
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

function applyControl(draft, control, value, snapshot = null) {
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
    const idx = Number(getSnapshotSimulation(snapshot).keyIndex);
    const label = formatKeyframeLabelFromSnapshot(snapshot, idx);
    draft.toast = { message: `Saved keyframe ${label}`, ts: Date.now() };
    return true;
  }
  if (control.item_id === 'simulation.load_key') {
    const idx = Number(getSnapshotSimulation(snapshot).keyIndex);
    const label = formatKeyframeLabelFromSnapshot(snapshot, idx);
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

function readBindingValue(state, snapshot, bindingOrSpec, control) {
  const spec = typeof bindingOrSpec === 'string'
    ? resolveBindingSpec(bindingOrSpec, control)
    : bindingOrSpec;
  if (!spec) return undefined;
  const reader = BINDING_READERS[spec.kind];
  if (!reader) return undefined;
  return reader(state, snapshot, spec, control);
}

const CONTROL_NULL_VALUE = new Set([
  'simulation.reset',
  'simulation.align',
  'file.quit',
]);

export function readControlValue(state, snapshot, control) {
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
    return readBindingValue(state, snapshot, spec, control);
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

export async function applySpecAction(store, backend, control, rawValue, onSnapshot = null, getSnapshot = null) {
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
      const currentSnapshot = typeof getSnapshot === 'function' ? getSnapshot() : null;
      applyControl(draft, control, value, currentSnapshot);
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
  if (snapshot && typeof onSnapshot === 'function') {
    onSnapshot(snapshot);
  }
  if (shouldApplyLocal) {
    syncRuntimeConfigFromViewerState(store.get());
  }
}

export function applyGesture(store, backend, payload, onSnapshot = null) {
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
        if (snapshot && typeof onSnapshot === 'function') {
          onSnapshot(snapshot);
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
  const preset = getFallbackPreset(key);
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

function normaliseSceneFlagArray(source) {
  const defaults = Array.isArray(SCENE_FLAG_DEFAULTS) ? SCENE_FLAG_DEFAULTS : [];
  const length = defaults.length;
  const arr = [];
  for (let i = 0; i < length; i += 1) {
    if (Array.isArray(source) && source[i] != null) {
      arr[i] = !!source[i];
    } else {
      arr[i] = !!defaults[i];
    }
  }
  return arr;
}

export async function switchVisualSourceMode(store, backend, requestedMode) {
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
    const rendering = ensureRenderingState(draft);
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
