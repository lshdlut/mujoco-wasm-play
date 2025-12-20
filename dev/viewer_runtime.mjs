const LOG_BOOL_TRUE = new Set(['1', 'true', 'yes', 'on', 'debug']);
let cachedVerbose = null;

export function isVerboseDebug() {
  if (cachedVerbose !== null) return cachedVerbose;
  if (typeof globalThis !== 'undefined' && globalThis.PLAY_VERBOSE_DEBUG != null) {
    cachedVerbose = !!globalThis.PLAY_VERBOSE_DEBUG;
    return cachedVerbose;
  }
  let flag = false;
  if (typeof location !== 'undefined' && location?.href) {
    const url = new URL(location.href);
    const token = String(url.searchParams.get('log') || url.searchParams.get('verbose') || '').trim().toLowerCase();
    flag = token ? LOG_BOOL_TRUE.has(token) : false;
  }
  cachedVerbose = flag;
  if (typeof globalThis !== 'undefined') {
    globalThis.PLAY_VERBOSE_DEBUG = cachedVerbose;
  }
  return cachedVerbose;
}

function isWorkerContext() {
  return typeof document === 'undefined' && typeof postMessage === 'function';
}

function postWorkerLog(message, extra) {
  postMessage({ kind: 'log', message, extra: extra ?? null });
}

export function logStatus(message, extra = null) {
  if (isWorkerContext()) {
    postWorkerLog(message, extra);
    return;
  }
  if (extra != null) {
    console.log(message, extra);
    return;
  }
  console.log(message);
}

export function logWarn(message, extra = null) {
  if (extra != null) {
    console.warn(message, extra);
    return;
  }
  console.warn(message);
}

export function logError(message, extra = null) {
  if (extra != null) {
    console.error(message, extra);
    return;
  }
  console.error(message);
}

export function logDebug(message, extra = null) {
  if (!isVerboseDebug()) return;
  if (isWorkerContext()) {
    postWorkerLog(message, extra);
    return;
  }
  if (extra != null) {
    console.log(message, extra);
    return;
  }
  console.log(message);
}

const PERF_GLOBAL_KEY = '__PLAY_PERF';
let cachedPerfEnabled = null;

export function isPerfEnabled() {
  if (cachedPerfEnabled !== null) return cachedPerfEnabled;
  cachedPerfEnabled = isVerboseDebug();
  return cachedPerfEnabled;
}

export function perfNow() {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') return performance.now();
  return Date.now();
}

function ensurePerfState() {
  if (typeof globalThis === 'undefined') throw new Error('perf state requires globalThis');
  const existing = globalThis[PERF_GLOBAL_KEY];
  if (existing && typeof existing === 'object') return existing;
  const state = {
    version: 1,
    enabled: true,
    createdWallMs: Date.now(),
    marks: [],
    firstMarks: Object.create(null),
    samples: Object.create(null),
  };
  globalThis[PERF_GLOBAL_KEY] = state;
  return state;
}

export function perfMark(name, detail = null) {
  if (!isPerfEnabled()) return null;
  const state = ensurePerfState();
  const entry = {
    name: String(name || ''),
    t: perfNow(),
    wallMs: Date.now(),
    detail: detail && typeof detail === 'object' ? detail : (detail == null ? null : { value: detail }),
  };
  state.marks.push(entry);
  if (!state.firstMarks[entry.name]) state.firstMarks[entry.name] = entry;
  return entry;
}

export function perfMarkOnce(name, detail = null) {
  if (!isPerfEnabled()) return null;
  const state = ensurePerfState();
  const key = String(name || '');
  if (state.firstMarks[key]) return state.firstMarks[key];
  return perfMark(key, detail);
}

export function perfSample(bucket, value, detail = null, { cap = 600 } = {}) {
  if (!isPerfEnabled()) return null;
  const state = ensurePerfState();
  const key = String(bucket || '');
  const samples = state.samples[key] || (state.samples[key] = []);
  const v = Number(value);
  if (!Number.isFinite(v)) return null;
  const entry = {
    t: perfNow(),
    wallMs: Date.now(),
    v,
    detail: detail && typeof detail === 'object' ? detail : (detail == null ? null : { value: detail }),
  };
  samples.push(entry);
  if (samples.length > cap) samples.splice(0, samples.length - cap);
  return entry;
}

export function perfClearSamples() {
  if (!isPerfEnabled()) return false;
  const state = ensurePerfState();
  state.samples = Object.create(null);
  state.sampleClearedWallMs = Date.now();
  state.sampleClearedPerfMs = perfNow();
  return true;
}

function quantile(sorted, q) {
  if (!sorted.length) return null;
  const clamped = Math.max(0, Math.min(1, q));
  const idx = (sorted.length - 1) * clamped;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  const t = idx - lo;
  return sorted[lo] * (1 - t) + sorted[hi] * t;
}

function summarizeValues(values) {
  const n = values.length;
  if (!n) return { n: 0 };
  const sorted = values.slice().sort((a, b) => a - b);
  let sum = 0;
  let min = sorted[0];
  let max = sorted[n - 1];
  for (const v of sorted) sum += v;
  return {
    n,
    min,
    max,
    mean: sum / n,
    p50: quantile(sorted, 0.5),
    p90: quantile(sorted, 0.9),
    p95: quantile(sorted, 0.95),
    p99: quantile(sorted, 0.99),
  };
}

function phaseMs(firstMarks, a, b) {
  const ma = firstMarks[a];
  const mb = firstMarks[b];
  if (!ma || !mb) return null;
  const dt = Number(mb.t) - Number(ma.t);
  return Number.isFinite(dt) ? dt : null;
}

export function perfSummary() {
  if (!isPerfEnabled()) return null;
  const state = ensurePerfState();
  const firstMarks = state.firstMarks || {};
  const sampleStats = {};
  for (const [key, entries] of Object.entries(state.samples || {})) {
    const values = Array.isArray(entries) ? entries.map((e) => Number(e?.v)).filter(Number.isFinite) : [];
    sampleStats[key] = summarizeValues(values);
  }
  const phases = {
    'main->worker_ready_ms': phaseMs(firstMarks, 'play:main:start', 'play:backend:worker_ready'),
    'main->render_assets_ms': phaseMs(firstMarks, 'play:main:start', 'play:backend:render_assets'),
    'main->first_snapshot_ms': phaseMs(firstMarks, 'play:main:start', 'play:backend:first_snapshot'),
    'main->first_scene_snapshot_ms': phaseMs(firstMarks, 'play:main:start', 'play:backend:first_scene_snapshot'),
    'worker_ready->first_scene_snapshot_ms': phaseMs(firstMarks, 'play:backend:worker_ready', 'play:backend:first_scene_snapshot'),
    'first_snapshot->first_scene_soa_render_end_ms': phaseMs(firstMarks, 'play:backend:first_snapshot', 'play:renderer:first_scene_soa_render_end'),
    'main->first_scene_soa_render_end_ms': phaseMs(firstMarks, 'play:main:start', 'play:renderer:first_scene_soa_render_end'),
    'main->first_draw_ms': phaseMs(firstMarks, 'play:main:start', 'play:renderer:first_draw'),
  };
  return {
    version: state.version,
    enabled: state.enabled,
    createdWallMs: state.createdWallMs,
    sampleClearedWallMs: state.sampleClearedWallMs || null,
    sampleClearedPerfMs: state.sampleClearedPerfMs || null,
    firstMarks,
    phases,
    sampleStats,
  };
}

if (typeof globalThis !== 'undefined' && isPerfEnabled()) {
  try {
    globalThis.__PLAY_PERF_SUMMARY = () => perfSummary();
  } catch (err) {
    throw err;
  }
  try {
    globalThis.__PLAY_PERF_CLEAR_SAMPLES = () => perfClearSamples();
  } catch (err) {
    throw err;
  }
}

const viewerSearchParams =
  typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : new URLSearchParams();

const PARAM_BOOL_TRUE = new Set(['1', 'true', 'yes', 'on']);
const PARAM_BOOL_FALSE = new Set(['0', 'false', 'no', 'off']);

const normaliseKey = (key) => String(key ?? '').trim();

export function getParamToken(key, params = viewerSearchParams) {
  const raw = params.get(normaliseKey(key));
  return (raw ?? '').trim().toLowerCase();
}

export function readBoolean(keys, params = viewerSearchParams) {
  const list = Array.isArray(keys) ? keys : [keys];
  for (const key of list) {
    const token = getParamToken(key, params);
    if (!token) continue;
    if (PARAM_BOOL_TRUE.has(token)) return true;
    if (PARAM_BOOL_FALSE.has(token)) return false;
  }
  return null;
}

export function readTruthyFlag(keys, params = viewerSearchParams) {
  return readBoolean(keys, params) === true;
}

export function readListParam(name, params = viewerSearchParams) {
  const raw = getParamToken(name, params);
  if (!raw) return [];
  return raw
    .split(/[,\s]+/)
    .map((token) => token.trim())
    .filter(Boolean);
}

export function readIndexSet(name, params = viewerSearchParams) {
  const values = readListParam(name, params)
    .map((token) => Number.parseInt(token, 10))
    .filter((n) => Number.isFinite(n) && n >= 0);
  return new Set(values);
}

export function readNumericParam(name, defaultValue, options = {}, params = viewerSearchParams) {
  const raw = params.get(normaliseKey(name));
  if (raw == null || raw === '') return defaultValue;
  const parseFn =
    typeof options.parser === 'function'
      ? options.parser
      : (value) => Number.parseFloat(value);
  const parsed = parseFn(raw, 10);
  if (!Number.isFinite(parsed)) return defaultValue;
  let result = parsed;
  if (typeof options.min === 'number') result = Math.max(options.min, result);
  if (typeof options.max === 'number') result = Math.min(options.max, result);
  return result;
}

export function consumeViewerParams(params = viewerSearchParams) {
  const requestedMode = params.get('mode');
  const fallbackModeParam = (params.get('fallback') || 'auto').toLowerCase();
  const presetParam = (params.get('preset') || 'bright-outdoor').toLowerCase();

  return {
    requestedMode,
    fallbackModeParam,
    presetParam,
    debugMode: readBoolean('debug', params) === true,
    hideAllGeometryDefault: readTruthyFlag(
      ['nogeom', 'no_geom', 'no-geom', 'hideall', 'hide_all'],
      params
    ),
    hiddenTypeTokens: readListParam('hide', params),
    dumpToken: getParamToken('dump', params),
    findToken: getParamToken('find', params),
    hideBigParam: readTruthyFlag(['hide_big', 'hidebig'], params),
    bigN: readNumericParam(
      'big_n',
      8,
      { parser: (value) => Number.parseInt(value, 10), min: 1, max: 64 },
      params
    ),
    bigFactorRaw: readNumericParam('big_factor', 8, {}, params),
    hiddenIndexSet: readIndexSet('hide_index', params),
    skyOverride: readBoolean(['nosky', 'sky_off'], params),
    requestedModel: params.get('model'),
    skyDebugModeParam: getParamToken('skydebug', params) || null,
  };
}

export { viewerSearchParams };

export function buildWorkerUrl(baseUrl, params = viewerSearchParams) {
  const url = baseUrl instanceof URL
    ? new URL(baseUrl.href)
    : new URL(String(baseUrl), typeof location !== 'undefined' ? location.href : 'http://localhost');
  const forgeBase = params.get('forgeBase');
  if (forgeBase) url.searchParams.set('forgeBase', forgeBase);
  const logToken = params.get('log');
  if (logToken) url.searchParams.set('log', logToken);
  const verboseToken = params.get('verbose');
  if (verboseToken) url.searchParams.set('verbose', verboseToken);
  url.searchParams.set('cb', String(Date.now()));
  return url;
}

export function normalizeVer(v) {
  const s = String(v || '').trim();
  return s ? s : '3.3.7';
}

export function getForgeDistBase(ver) {
  const v = normalizeVer(ver);
  const override = resolveForgeDistBaseOverride(v);
  if (override) return override;
  return `/dist/${v}/`;
}

function resolveForgeDistBaseOverride(v) {
  if (typeof window !== 'undefined' && typeof window.__FORGE_DIST_BASE__ === 'string' && window.__FORGE_DIST_BASE__) {
    return window.__FORGE_DIST_BASE__.replace('{ver}', v);
  }
  if (typeof location !== 'undefined') {
    const search = typeof location.search === 'string' ? location.search : '';
    const params = new URLSearchParams(search);
    const tpl = params.get('forgeBase');
    if (tpl) return tpl.replace('{ver}', v);
  }
  return null;
}

export async function getVersionInfo(distBase) {
  const url = new URL('version.json', new URL(distBase, location.href));
  url.searchParams.set('cb', String(Date.now()));
  try {
    const r = await fetch(url.href, { cache: 'no-store' });
    if (!r.ok) throw new Error('version.json fetch failed');
    return await r.json();
  } catch {
    return null;
  }
}

export function withCacheTag(u, vTag) {
  try {
    const url = new URL(u, location.href);
    if (vTag) url.searchParams.set('v', String(vTag));
    else url.searchParams.set('cb', String(Date.now()));
    return url.href;
  } catch {
    return u;
  }
}
