(function initPlayRuntimeConfig() {
  const root = document.documentElement;
  const script = document.currentScript;
  const entryVariant =
    script && script.dataset && script.dataset.playEntryVariant === 'pthreads'
      ? 'pthreads'
      : 'single';
  const params = new URLSearchParams(window.location.search || '');
  const repoRootUrl = new URL('../', script?.src || window.location.href);
  const BOOL_TRUE = new Set(['1', 'true', 'yes', 'on']);
  const BOOL_FALSE = new Set(['0', 'false', 'no', 'off']);
  const FONT_PRESETS = Object.freeze([
    Object.freeze({ index: 0, pct: 50, scale: 0.5 }),
    Object.freeze({ index: 1, pct: 75, scale: 0.75 }),
    Object.freeze({ index: 2, pct: 100, scale: 1 }),
    Object.freeze({ index: 3, pct: 150, scale: 1.5 }),
    Object.freeze({ index: 4, pct: 200, scale: 2 }),
  ]);

  function getRaw(name) {
    const raw = params.get(String(name || '').trim());
    return raw == null ? '' : String(raw).trim();
  }

  function getToken(name) {
    return getRaw(name).toLowerCase();
  }

  function readBoolean(keys) {
    const list = Array.isArray(keys) ? keys : [keys];
    for (const key of list) {
      const token = getToken(key);
      if (!token) continue;
      if (BOOL_TRUE.has(token)) return true;
      if (BOOL_FALSE.has(token)) return false;
    }
    return null;
  }

  function readTruthy(keys) {
    return readBoolean(keys) === true;
  }

  function readNumeric(name, defaultValue, options = {}) {
    const raw = getRaw(name);
    if (!raw) return defaultValue;
    const parseFn = typeof options.parser === 'function'
      ? options.parser
      : (value) => Number.parseFloat(value);
    const parsed = parseFn(raw, 10);
    if (!Number.isFinite(parsed)) return defaultValue;
    let result = parsed;
    if (typeof options.min === 'number') result = Math.max(options.min, result);
    if (typeof options.max === 'number') result = Math.min(options.max, result);
    return result;
  }

  function readList(name) {
    const raw = getToken(name);
    if (!raw) return [];
    return raw.split(/[,\s]+/).map((value) => value.trim()).filter(Boolean);
  }

  function readIndexList(name) {
    return readList(name)
      .map((value) => Number.parseInt(value, 10))
      .filter((value) => Number.isFinite(value) && value >= 0);
  }

  function parseTransparentBins(value, fallback = 16) {
    const parsed = Number.parseInt(String(value || ''), 10);
    if (!Number.isFinite(parsed)) return fallback;
    const clamped = Math.max(0, Math.min(16, parsed | 0));
    if (clamped === 0) return 0;
    if (clamped <= 1) return 1;
    if (clamped <= 4) return 4;
    if (clamped <= 8) return 8;
    return 16;
  }

  function parseTransparentSortMode(value) {
    const token = String(value || '').trim().toLowerCase();
    if (token === 'nosort' || token === 'fast') return 'nosort';
    if (token === 'bins') return 'bins';
    return 'strict';
  }

  function resolveFontPreset(token, fallbackIndex = 2) {
    const normalized = String(token || '').trim().toLowerCase().replace(/\s+/g, '').replace(/%$/, '');
    const direct = FONT_PRESETS.find((entry) => String(entry.pct) === normalized);
    return direct || FONT_PRESETS[Math.max(0, Math.min(FONT_PRESETS.length - 1, fallbackIndex | 0))];
  }

  function resolvePluginSpecifier(raw) {
    const value = String(raw || '').trim();
    if (!value) return '';
    const looksLikePath =
      value.startsWith('.') ||
      value.startsWith('/') ||
      value.includes('/') ||
      value.endsWith('.mjs') ||
      value.endsWith('.js');
    if (!looksLikePath) return value;
    return new URL(value, repoRootUrl).href;
  }

  function normaliseUrlBase(raw, fallbackUrl, label) {
    const value = String(raw || '').trim();
    const baseUrl = String(fallbackUrl || '').trim();
    const target = value || baseUrl;
    if (!target) {
      throw new Error(`Missing ${label} base URL`);
    }
    let resolved;
    try {
      resolved = new URL(target, repoRootUrl).href;
    } catch (error) {
      throw new Error(`Invalid ${label} base URL: ${target}`, { cause: error });
    }
    return resolved.endsWith('/') ? resolved : `${resolved}/`;
  }

  function normalisePanelDefaults(source) {
    const input = source && typeof source === 'object' ? source : null;
    return {
      left: typeof input?.left === 'boolean' ? input.left : true,
      right: typeof input?.right === 'boolean' ? input.right : true,
    };
  }

  function normaliseSectionDefaultOpen(source) {
    const target = { left: {}, right: {} };
    if (!source || typeof source !== 'object') return target;
    for (const panel of ['left', 'right']) {
      const input = source[panel];
      if (!input || typeof input !== 'object') continue;
      for (const [sectionId, open] of Object.entries(input)) {
        if (!sectionId || typeof open !== 'boolean') continue;
        target[panel][sectionId] = open;
      }
    }
    return target;
  }

  function normaliseProfileId(raw) {
    const token = String(raw || '').trim().toLowerCase();
    return token || 'play';
  }

  function normaliseBooleanOverride(raw, fallback) {
    if (typeof raw === 'boolean') return raw;
    if (typeof raw === 'number') return raw !== 0;
    const token = String(raw ?? '').trim().toLowerCase();
    if (!token) return fallback;
    if (BOOL_TRUE.has(token)) return true;
    if (BOOL_FALSE.has(token)) return false;
    return fallback;
  }

  function collectPlugins() {
    const entries = [];
    if (Array.isArray(globalThis.PLAY_PLUGINS)) {
      for (const value of globalThis.PLAY_PLUGINS) {
        const resolved = resolvePluginSpecifier(value);
        if (resolved) entries.push(resolved);
      }
    }
    const rawToken = getRaw('plugins');
    if (rawToken) {
      for (const value of rawToken.split(',')) {
        const resolved = resolvePluginSpecifier(value);
        if (resolved) entries.push(resolved);
      }
    }
    return Array.from(new Set(entries));
  }

  function defaultForgeBaseTemplate(variant) {
    return variant === 'pthreads' ? '/forge/dist/{ver}/pthreads/' : '/forge/dist/{ver}/';
  }

  const themeColor =
    getToken('theme') === 'light'
      ? 1
      : (getToken('theme') === 'dark' ? 0 : 0);
  const spacing =
    getToken('spacing') === 'tight'
      ? 0
      : 1;
  const font = resolveFontPreset(getRaw('font'));
  const embedMode = readTruthy('embed');
  const profileId = normaliseProfileId(globalThis.PLAY_UI_PROFILE);
  const storageNamespace =
    String(globalThis.PLAY_UI_STORAGE_NAMESPACE || profileId || 'play').trim()
    || profileId;
  const builtInDefaultOpen = normaliseBooleanOverride(globalThis.PLAY_UI_BUILTIN_DEFAULT_OPEN, true);
  const panelDefaults = normalisePanelDefaults(globalThis.PLAY_UI_PANEL_DEFAULTS);
  const sectionDefaultOpen = normaliseSectionDefaultOpen(globalThis.PLAY_UI_SECTION_DEFAULT_OPEN);
  const hideAllGeometryDefault = readTruthy(['nogeom', 'no_geom', 'no-geom', 'hideall', 'hide_all']);
  const forceBasic = readTruthy('forceBasic');

  let instancingEnabled = !(readTruthy(['noinst']) || getToken('inst') === '0' || getToken('instancing') === '0');
  if (globalThis.PLAY_DISABLE_INSTANCING === true) instancingEnabled = false;
  if (globalThis.PLAY_DISABLE_INSTANCING === false) instancingEnabled = true;

  let transparentBins = parseTransparentBins(getRaw('tbins'), 16);
  let transparentSortMode = parseTransparentSortMode(getRaw('tmode'));
  if (Number.isFinite(globalThis.PLAY_TRANSPARENT_BINS)) {
    transparentBins = parseTransparentBins(globalThis.PLAY_TRANSPARENT_BINS, transparentBins);
  }
  if (
    globalThis.PLAY_TRANSPARENT_SORT_MODE === 'strict' ||
    globalThis.PLAY_TRANSPARENT_SORT_MODE === 'bins' ||
    globalThis.PLAY_TRANSPARENT_SORT_MODE === 'nosort'
  ) {
    transparentSortMode = globalThis.PLAY_TRANSPARENT_SORT_MODE;
  }

  const strictOverride = globalThis.PLAY_STRICT;
  const compatOverride = globalThis.PLAY_COMPAT;
  const verboseOverride = globalThis.PLAY_VERBOSE_DEBUG;
  const strict = strictOverride != null ? !!strictOverride : (readBoolean('strict') === true);
  const compat = compatOverride != null ? !!compatOverride : (readBoolean('compat') === true);
  const logToken = getRaw('log') || getRaw('verbose');
  const verboseDebug = verboseOverride != null ? !!verboseOverride : ['1', 'true', 'yes', 'on', 'debug'].includes(logToken.toLowerCase());
  const snapshotToken = getRaw('snapshot').toLowerCase();
  const snapshotDebug =
    globalThis.PLAY_SNAPSHOT_DEBUG === true ||
    globalThis.PLAY_SNAPSHOT_DEBUG === 1 ||
    globalThis.PLAY_SNAPSHOT_DEBUG === '1' ||
    globalThis.__snapshot === true ||
    globalThis.__snapshot === 1 ||
    snapshotToken === '1' ||
    snapshotToken === 'debug';

  const ver = getRaw('ver') || String(globalThis.PLAY_VER || '').trim();
  const forgeBaseTemplate =
    getRaw('forgeBase') ||
    String(globalThis.__FORGE_DIST_BASE__ || '').trim() ||
    defaultForgeBaseTemplate(entryVariant);
  const forgeBase = ver
    ? (forgeBaseTemplate.replaceAll('{ver}', ver).endsWith('/')
      ? forgeBaseTemplate.replaceAll('{ver}', ver)
      : `${forgeBaseTemplate.replaceAll('{ver}', ver)}/`)
    : '';

  const fallbackMode = (getRaw('fallback') || 'auto').toLowerCase();
  const debugMode = readBoolean('debug') === true;
  const dumpToken = getToken('dump');
  const findToken = getToken('find');
  const hideBigParam = readTruthy(['hide_big', 'hidebig']);
  const bigN = readNumeric('big_n', 8, { parser: (value) => Number.parseInt(value, 10), min: 1, max: 64 });
  const bigFactorRaw = readNumeric('big_factor', 8, {});
  const skyOverride = readBoolean(['nosky', 'sky_off']);
  const skyDebugModeParam = getToken('skydebug') || null;
  const cacheBustMode = ['1', 'true', 'yes', 'on', 'always'].includes(getToken('cacheBust')) ? 'always' : 'none';
  const environmentAssetBase = normaliseUrlBase(
    getRaw('envAssetBase') || globalThis.PLAY_ENV_ASSET_BASE,
    new URL('./assets/env/', repoRootUrl).href,
    'environment asset',
  );
  const uiUpdateIntervalMs = readNumeric('ui_ms', 33, { parser: (value) => Number.parseInt(value, 10), min: 16, max: 2000 });
  const uiSlowUpdateIntervalMs = readNumeric('ui_slow_ms', 1000, { parser: (value) => Number.parseInt(value, 10), min: 200, max: 10000 });
  const snapshotHzMax = readNumeric('snapshot_hz_max', 120, { parser: (value) => Number.parseInt(value, 10), min: 30, max: 120 });
  const plugins = collectPlugins();

  globalThis.__PLAY_RUNTIME_CONFIG__ = {
    startup: {
      entryVariant,
      model: getRaw('model'),
      fallbackMode,
      debugMode,
      dumpToken,
      findToken,
      bigN,
      skyOverride,
      skyDebugMode: skyDebugModeParam || null,
      cacheBustMode,
      ver,
      forgeBaseTemplate,
      strict,
      compat,
      logToken,
    },
    verboseDebug,
    snapshotDebug,
    plugins,
    ui: {
      embedMode,
      themeColor,
      spacing,
      fontIndex: font.index,
      profileId,
      builtInDefaultOpen,
      panelDefaults,
      sectionDefaultOpen,
      storageNamespace,
    },
    timing: {
      uiUpdateIntervalMs,
      uiSlowUpdateIntervalMs,
      snapshotHzMax,
    },
    rendering: {
      environmentAssetBase,
      hideAllGeometryDefault,
      forceBasic,
      instancingEnabled,
      transparentBins,
      transparentSortMode,
    },
  };

  if (themeColor === 1) {
    root.setAttribute('data-play-theme', 'light');
  } else {
    root.removeAttribute('data-play-theme');
  }
  root.style.setProperty('--viewer-font-scale', String(font.scale));
  if (embedMode) {
    root.setAttribute('data-play-embed', '1');
  } else {
    root.removeAttribute('data-play-embed');
  }
})();
