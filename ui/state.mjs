import {
  logError,
  strictCatch,
} from '../core/viewer_runtime.mjs';
import { cloneStruct } from '../core/viewer_shared.mjs';
import {
  getFontPresetByIndex,
  getRuntimeConfig,
  updateRuntimeConfig,
} from '../core/runtime_config.mjs';
import { getSnapshotGeoms } from '../core/snapshot_selectors.mjs';

export function clamp01(value) {
  if (!Number.isFinite(value)) return 0;
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

export const VISUAL_SOURCE_CACHE_TEMPLATE = Object.freeze({
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
});

export const DEFAULT_VIEWER_STATE = Object.freeze({
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
  runtime: {
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
    perturb: {
      mode: 'idle',
      active: false,
    },
  },
  theme: {
    color: 0,
    spacing: 0,
    font: 2,
  },
  visualSourceMode: 'model',
  visualBackups: { ...VISUAL_SOURCE_CACHE_TEMPLATE },
  visualBaselines: { ...VISUAL_SOURCE_CACHE_TEMPLATE },
  panels: {
    left: true,
    right: true,
  },
  sectionsCollapsed: {
    left: {},
    right: {},
  },
  shell: {
    modelLabel: '',
  },
  rendering: {
    hideAllGeometry: false,
    appearance: {
      background: null,
      clearColor: 0x000000,
      exposure: 1.1,
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
  toast: null,
});

const VIEWER_STATE_KEYS = Object.keys(DEFAULT_VIEWER_STATE);

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

function applyRuntimeConfigState(target, runtimeConfig) {
  const config = runtimeConfig && typeof runtimeConfig === 'object' ? runtimeConfig : null;
  if (!config) return target;
  const ui = config.ui && typeof config.ui === 'object' ? config.ui : null;
  const rendering = config.rendering && typeof config.rendering === 'object' ? config.rendering : null;
  if (ui) {
    const panelDefaults = ui.panelDefaults && typeof ui.panelDefaults === 'object' ? ui.panelDefaults : null;
    target.theme = {
      ...target.theme,
      color: Number.isFinite(ui.themeColor) ? (ui.themeColor | 0) : target.theme.color,
      spacing: Number.isFinite(ui.spacing) ? (ui.spacing | 0) : target.theme.spacing,
      font: getFontPresetByIndex(ui.fontIndex).index,
    };
    if (panelDefaults) {
      target.panels = {
        left: typeof panelDefaults.left === 'boolean' ? panelDefaults.left : target.panels.left,
        right: typeof panelDefaults.right === 'boolean' ? panelDefaults.right : target.panels.right,
      };
    }
  }
  if (rendering) {
    target.rendering = {
      ...target.rendering,
      hideAllGeometry: !!rendering.hideAllGeometryDefault,
      options: {
        ...cloneStruct(target.rendering.options),
        materials: {
          ...cloneStruct(target.rendering.options?.materials),
          forceBasic: !!rendering.forceBasic,
        },
        instancing: {
          ...cloneStruct(target.rendering.options?.instancing),
          enabled: !!rendering.instancingEnabled,
        },
        transparency: {
          ...cloneStruct(target.rendering.options?.transparency),
          bins: Number.isFinite(rendering.transparentBins)
            ? Math.max(0, Math.trunc(rendering.transparentBins))
            : DEFAULT_VIEWER_STATE.rendering.options.transparency.bins,
          sortMode: typeof rendering.transparentSortMode === 'string'
            ? rendering.transparentSortMode
            : DEFAULT_VIEWER_STATE.rendering.options.transparency.sortMode,
        },
      },
    };
  }
  return target;
}

function createRuntimeViewerState() {
  const runtimeConfig = getRuntimeConfig();
  const base = cloneViewerState(DEFAULT_VIEWER_STATE);
  return applyRuntimeConfigState(base, runtimeConfig);
}

export function resetModelFrontendState(store) {
  if (!store || typeof store.replace !== 'function') return;
  const next = createRuntimeViewerState();
  const current = typeof store.get === 'function' ? store.get() : null;
  if (current?.panels && typeof current.panels === 'object') {
    next.panels = cloneStruct(current.panels);
  }
  if (current?.sectionsCollapsed && typeof current.sectionsCollapsed === 'object') {
    next.sectionsCollapsed = cloneStruct(current.sectionsCollapsed);
  }
  store.replace(next);
}

export function syncRuntimeConfigFromViewerState(state) {
  if (!state || typeof state !== 'object') return;
  const theme = state.theme && typeof state.theme === 'object' ? state.theme : DEFAULT_VIEWER_STATE.theme;
  const rendering = state.rendering && typeof state.rendering === 'object' ? state.rendering : DEFAULT_VIEWER_STATE.rendering;
  const renderingOptions = rendering.options && typeof rendering.options === 'object'
    ? rendering.options
    : DEFAULT_VIEWER_STATE.rendering.options;
  const font = getFontPresetByIndex(theme.font);

  updateRuntimeConfig((config) => {
    config.ui.themeColor = Number.isFinite(theme.color) ? (theme.color | 0) : 0;
    config.ui.spacing = Number.isFinite(theme.spacing) ? (theme.spacing | 0) : 0;
    config.ui.fontIndex = font.index;
    config.rendering.hideAllGeometryDefault = !!rendering.hideAllGeometry;
    config.rendering.forceBasic = !!renderingOptions?.materials?.forceBasic;
    config.rendering.instancingEnabled = !!renderingOptions?.instancing?.enabled;
    config.rendering.transparentBins = Number.isFinite(renderingOptions?.transparency?.bins)
      ? Math.max(0, Math.trunc(renderingOptions.transparency.bins))
      : DEFAULT_VIEWER_STATE.rendering.options.transparency.bins;
    config.rendering.transparentSortMode = typeof renderingOptions?.transparency?.sortMode === 'string'
      ? renderingOptions.transparency.sortMode
      : DEFAULT_VIEWER_STATE.rendering.options.transparency.sortMode;
  });
}

export function mergeBackendSnapshot(draft, snapshot) {
  if (!snapshot || !draft) return;
  const geoms = getSnapshotGeoms(snapshot);
  if (Array.isArray(geoms) && geoms.length) {
    const maxGeom = geoms.length - 1;
    const trackingGeom = Number(draft.runtime?.trackingGeom);
    if (Number.isFinite(trackingGeom) && trackingGeom > maxGeom) {
      draft.runtime.trackingGeom = maxGeom >= 0 ? maxGeom : -1;
    }
  } else if (Number(draft.runtime?.trackingGeom) >= 0) {
    draft.runtime.trackingGeom = -1;
  }
}

export function createViewerStore(initialState) {
  let state = applyViewerStateOverrides(createRuntimeViewerState(), initialState);
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
      state = applyViewerStateOverrides(createRuntimeViewerState(), next);
      notify();
    },
    update(mutator) {
      mutator(state);
      notify();
    },
    subscribe(fn) {
      listeners.add(fn);
      fn(state);
      return () => listeners.delete(fn);
    },
  };
}
