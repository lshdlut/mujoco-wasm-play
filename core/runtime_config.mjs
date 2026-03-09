const RUNTIME_CONFIG_KEY = '__PLAY_RUNTIME_CONFIG__';
const EMPTY_PARAMS = Object.freeze({});
const EMPTY_PLUGINS = Object.freeze([]);
const EMPTY_RUNTIME_CONFIG = Object.freeze({
  params: EMPTY_PARAMS,
  verboseDebug: false,
  snapshotDebug: false,
  plugins: EMPTY_PLUGINS,
  ui: Object.freeze({
    embedMode: false,
    themeColor: 0,
    spacing: 0,
    fontIndex: 2,
  }),
  timing: Object.freeze({
    uiUpdateIntervalMs: 33,
    uiSlowUpdateIntervalMs: 1000,
    snapshotHzMax: 120,
  }),
  rendering: Object.freeze({
    hideAllGeometryDefault: false,
    forceBasic: false,
    instancingEnabled: true,
    transparentBins: 16,
    transparentSortMode: 'strict',
  }),
});

const FONT_PRESET_LOOKUP = Object.freeze([
  Object.freeze({ index: 0, pct: 50, scale: 0.5, panelScale: 0.7 }),
  Object.freeze({ index: 1, pct: 75, scale: 0.75, panelScale: 0.85 }),
  Object.freeze({ index: 2, pct: 100, scale: 1, panelScale: 1 }),
  Object.freeze({ index: 3, pct: 150, scale: 1.5, panelScale: 1.3 }),
  Object.freeze({ index: 4, pct: 200, scale: 2, panelScale: 1.6 }),
]);

function readRuntimeConfigObject() {
  if (typeof globalThis === 'undefined') return EMPTY_RUNTIME_CONFIG;
  const config = globalThis[RUNTIME_CONFIG_KEY];
  return (config && typeof config === 'object') ? config : EMPTY_RUNTIME_CONFIG;
}

export function getRuntimeConfig() {
  return readRuntimeConfigObject();
}

export function updateRuntimeConfig(mutator) {
  const config = readRuntimeConfigObject();
  if (config === EMPTY_RUNTIME_CONFIG) {
    throw new Error('Missing __PLAY_RUNTIME_CONFIG__');
  }
  mutator(config);
  return config;
}

export function getRuntimeParamValue(name) {
  const key = String(name ?? '').trim();
  if (!key) return null;
  const params = readRuntimeConfigObject().params;
  const value = params && Object.prototype.hasOwnProperty.call(params, key)
    ? params[key]
    : null;
  return value == null ? null : String(value);
}

const RUNTIME_PARAM_SOURCE = Object.freeze({
  get(name) {
    return getRuntimeParamValue(name);
  },
});

export function getRuntimeParamSource() {
  return RUNTIME_PARAM_SOURCE;
}

export function getFontPresetByIndex(index) {
  const raw = Number.isFinite(index) ? Math.trunc(index) : 2;
  const clamped = Math.max(0, Math.min(FONT_PRESET_LOOKUP.length - 1, raw));
  return FONT_PRESET_LOOKUP[clamped];
}

export function resolveFontPresetValue(value, fallbackIndex = 2) {
  if (Number.isFinite(value)) {
    return getFontPresetByIndex(value);
  }
  const token = String(value ?? '').trim().toLowerCase();
  if (!token) return getFontPresetByIndex(fallbackIndex);
  if (/^\d+$/.test(token)) {
    const numeric = Number.parseInt(token, 10);
    const byIndex = getFontPresetByIndex(numeric);
    if (String(byIndex.index) === token) return byIndex;
    const byPct = FONT_PRESET_LOOKUP.find((entry) => String(entry.pct) === token);
    return byPct || byIndex;
  }
  const match = token.match(/(\d+)\s*%/);
  if (match) {
    const byPct = FONT_PRESET_LOOKUP.find((entry) => String(entry.pct) === match[1]);
    if (byPct) return byPct;
  }
  return getFontPresetByIndex(fallbackIndex);
}

export function applyRuntimeUiToDocument(doc = document, options = {}) {
  if (!doc) return;
  const root = doc.documentElement;
  const body = doc.body;
  const config = readRuntimeConfigObject();
  const ui = config.ui || EMPTY_RUNTIME_CONFIG.ui;
  const themeColor = Number.isFinite(ui.themeColor) ? (ui.themeColor | 0) : 0;
  const spacing = Number.isFinite(ui.spacing) ? (ui.spacing | 0) : 0;
  const font = getFontPresetByIndex(ui.fontIndex);

  if (root?.style?.setProperty) {
    root.style.setProperty('--viewer-font-scale', String(font.scale));
    root.style.setProperty('--viewer_panel_scale', String(font.panelScale));
  }
  if (body?.classList) {
    body.classList.toggle('theme-light', themeColor === 1);
    body.classList.toggle('spacing-wide', spacing === 1);
  }
  if (root) {
    if (ui.embedMode) {
      root.setAttribute('data-play-embed', '1');
    } else {
      root.removeAttribute('data-play-embed');
    }
    if (options.clearPrepaintThemeAttr) {
      root.removeAttribute('data-play-theme');
    }
  }
}
