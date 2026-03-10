import { getRuntimeConfig } from './runtime_config.mjs';

const LOG_BOOL_TRUE = new Set(['1', 'true', 'yes', 'on', 'debug']);
let cachedVerbose = null;

export function isVerboseDebug() {
  if (cachedVerbose !== null) return cachedVerbose;
  if (typeof document !== 'undefined') {
    cachedVerbose = !!getRuntimeConfig().verboseDebug;
    return cachedVerbose;
  }
  let flag = false;
  if (typeof location !== 'undefined' && location?.href) {
    const url = new URL(location.href);
    const token = String(url.searchParams.get('log') || url.searchParams.get('verbose') || '').trim().toLowerCase();
    flag = token ? LOG_BOOL_TRUE.has(token) : false;
  }
  cachedVerbose = flag;
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

const PARAM_BOOL_TRUE = new Set(['1', 'true', 'yes', 'on']);
const PARAM_BOOL_FALSE = new Set(['0', 'false', 'no', 'off']);

const normaliseKey = (key) => String(key ?? '').trim();

function isParamSource(value) {
  return !!value && typeof value.get === 'function';
}

function resolveDefaultInputSource() {
  if (typeof document === 'undefined' && typeof location !== 'undefined' && location?.href) {
    try {
      return new URL(location.href).searchParams;
    } catch (err) {
      strictCatch(err, 'runtime:worker_default_params', { allow: true });
    }
  }
  return getRuntimeConfig();
}

function readStartupField(source, key, fallback = null) {
  if (isParamSource(source)) return fallback;
  const config = source && typeof source === 'object' ? source : getRuntimeConfig();
  const startup = config.startup && typeof config.startup === 'object' ? config.startup : null;
  return startup && Object.prototype.hasOwnProperty.call(startup, key)
    ? startup[key]
    : fallback;
}

export function getParamToken(key, params = resolveDefaultInputSource()) {
  if (!isParamSource(params)) return '';
  const raw = params.get(normaliseKey(key));
  return (raw ?? '').trim().toLowerCase();
}

export function readBoolean(keys, params = resolveDefaultInputSource()) {
  if (!isParamSource(params)) return null;
  const list = Array.isArray(keys) ? keys : [keys];
  for (const key of list) {
    const token = getParamToken(key, params);
    if (!token) continue;
    if (PARAM_BOOL_TRUE.has(token)) return true;
    if (PARAM_BOOL_FALSE.has(token)) return false;
  }
  return null;
}

export function readTruthyFlag(keys, params = resolveDefaultInputSource()) {
  return readBoolean(keys, params) === true;
}

export function readListParam(name, params = resolveDefaultInputSource()) {
  if (!isParamSource(params)) return [];
  const raw = getParamToken(name, params);
  if (!raw) return [];
  return raw
    .split(/[,\s]+/)
    .map((token) => token.trim())
    .filter(Boolean);
}

export function readIndexSet(name, params = resolveDefaultInputSource()) {
  const values = readListParam(name, params)
    .map((token) => Number.parseInt(token, 10))
    .filter((n) => Number.isFinite(n) && n >= 0);
  return new Set(values);
}

export function readNumericParam(name, defaultValue, options = {}, params = resolveDefaultInputSource()) {
  if (!isParamSource(params)) return defaultValue;
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

const CACHE_BUST_KEY = 'cacheBust';
const CACHE_BUST_ALWAYS_TOKENS = new Set(['1', 'true', 'yes', 'on', 'always']);
const CACHE_BUST_NONE_TOKENS = new Set(['0', 'false', 'no', 'off', 'none']);

function readRuntimeToken(source, key) {
  if (isParamSource(source)) {
    const raw = source.get(normaliseKey(key));
    return (raw ?? '').trim().toLowerCase();
  }
  const value = readStartupField(source, key, '');
  return String(value ?? '').trim().toLowerCase();
}

export function resolveCacheBustMode(source = resolveDefaultInputSource()) {
  const token = isParamSource(source)
    ? getParamToken(CACHE_BUST_KEY, source)
    : readRuntimeToken(source, 'cacheBustMode');
  if (!token) return 'none';
  if (CACHE_BUST_ALWAYS_TOKENS.has(token)) return 'always';
  if (CACHE_BUST_NONE_TOKENS.has(token)) return 'none';
  return 'none';
}

export function isCacheBustAlways(source = resolveDefaultInputSource()) {
  return resolveCacheBustMode(source) === 'always';
}

export function resolveVer(source = resolveDefaultInputSource(), { playVer = '' } = {}) {
  const fromParam = isParamSource(source) ? String(source.get('ver') || '').trim() : '';
  const fromConfig = !isParamSource(source) ? String(readStartupField(source, 'ver', '') || '').trim() : '';
  const token = fromParam || fromConfig || String(playVer || '').trim();
  if (token) return token;
  throw new Error('Missing MuJoCo version: set globalThis.PLAY_VER (via site_config.js) or pass ver=... in the URL.');
}

export function resolveForgeBaseTemplate(source = resolveDefaultInputSource(), { forgeDistBaseOverride = '' } = {}) {
  const fromUrl = isParamSource(source) ? String(source.get('forgeBase') || '').trim() : '';
  if (fromUrl) return fromUrl;
  const fromConfig = !isParamSource(source)
    ? String(readStartupField(source, 'forgeBaseTemplate', '') || '').trim()
    : '';
  if (fromConfig) return fromConfig;
  const fromGlobal = String(forgeDistBaseOverride || '').trim();
  if (fromGlobal) return fromGlobal;
  return '/forge/dist/{ver}/';
}

export function applyVerTemplate(template, ver) {
  const raw = String(template || '');
  const v = String(ver || '').trim();
  if (!raw) return '';
  if (!v) return raw;
  return raw.replaceAll('{ver}', v);
}

export function resolveForgeBase(source = resolveDefaultInputSource(), options = {}) {
  const ver = resolveVer(source, options);
  const template = resolveForgeBaseTemplate(source, options);
  const expanded = applyVerTemplate(template, ver);
  return expanded.endsWith('/') ? expanded : `${expanded}/`;
}

export function withCacheBust(u, mode = resolveCacheBustMode()) {
  if (mode !== 'always') return u;
  try {
    const url = new URL(String(u), location.href);
    url.searchParams.set('cb', String(Date.now()));
    return url.href;
  } catch (err) {
    strictCatch(err, 'runtime:cache_bust', { allow: true });
    return u;
  }
}

export function buildWorkerUrl(baseUrl, source = resolveDefaultInputSource()) {
  const url = baseUrl instanceof URL
    ? new URL(baseUrl.href)
    : new URL(String(baseUrl), typeof location !== 'undefined' ? location.href : 'http://localhost');
  const cacheBustMode = resolveCacheBustMode(source);
  const ver = resolveVer(source);
  const forgeBase = resolveForgeBase(source, { playVer: ver });
  url.searchParams.set('ver', ver);
  url.searchParams.set('forgeBase', forgeBase);
  if (cacheBustMode === 'always') {
    url.searchParams.set(CACHE_BUST_KEY, 'always');
    url.searchParams.set('cb', String(Date.now()));
  }
  const strictMode = isStrictEnabled(source);
  if (strictMode) url.searchParams.set('strict', '1');
  const compatMode = isCompatEnabled(source);
  if (compatMode) url.searchParams.set('compat', '1');
  const logToken = isParamSource(source)
    ? String(source.get('log') || '').trim()
    : String(readStartupField(source, 'logToken', '') || '').trim();
  if (logToken) url.searchParams.set('log', logToken);
  const config = !isParamSource(source) && source && typeof source === 'object' ? source : getRuntimeConfig();
  const verboseToken = isParamSource(source)
    ? String(source.get('verbose') || '').trim()
    : (config.verboseDebug ? '1' : '');
  if (verboseToken) url.searchParams.set('verbose', verboseToken);
  return url;
}

export function normalizeVer(v) {
  const s = String(v || '').trim();
  return s ? s : '';
}

export function getForgeDistBase(ver) {
  const v = normalizeVer(ver);
  if (!v) {
    throw new Error('getForgeDistBase(ver) requires a non-empty version.');
  }
  const template = resolveForgeBaseTemplate(resolveDefaultInputSource());
  const expanded = applyVerTemplate(template, v);
  return expanded.endsWith('/') ? expanded : `${expanded}/`;
}

export async function getVersionInfo(distBase) {
  const url = new URL('version.json', new URL(distBase, location.href));
  try {
    const r = await fetch(url.href, { cache: 'no-store' });
    if (!r.ok) throw new Error('version.json fetch failed');
    return await r.json();
  } catch (err) {
    strictCatch(err, 'runtime:version_info', { allow: true });
    return null;
  }
}

export function withCacheTag(u, vTag) {
  try {
    const url = new URL(u, location.href);
    if (vTag) url.searchParams.set('v', String(vTag));
    else if (isCacheBustAlways()) url.searchParams.set('cb', String(Date.now()));
    return url.href;
  } catch (err) {
    strictCatch(err, 'runtime:cache_tag', { allow: true });
    return u;
  }
}

const STRICT_STATE_KEY = '__PLAY_STRICT_STATE';
const STRICT_CATCH_ALLOWLIST = new Set([]);

function resolveStrictFlag(source = resolveDefaultInputSource()) {
  if (isParamSource(source)) return readBoolean('strict', source) === true;
  return !!readStartupField(source, 'strict', false);
}

export function isStrictEnabled(source = resolveDefaultInputSource()) {
  return resolveStrictFlag(source);
}

function resolveCompatFlag(source = resolveDefaultInputSource()) {
  if (isParamSource(source)) return readBoolean('compat', source) === true;
  return !!readStartupField(source, 'compat', false);
}

export function isCompatEnabled(source = resolveDefaultInputSource()) {
  return resolveCompatFlag(source);
}

function ensureStrictState() {
  if (typeof globalThis === 'undefined') {
    return {
      version: 1,
      enabled: false,
      createdWallMs: Date.now(),
      seq: 0,
      counts: Object.create(null),
      allowlistCounts: Object.create(null),
      events: [],
    };
  }
  const existing = globalThis[STRICT_STATE_KEY];
  if (existing && typeof existing === 'object') {
    existing.enabled = isStrictEnabled();
    return existing;
  }
  const state = {
    version: 1,
    enabled: isStrictEnabled(),
    createdWallMs: Date.now(),
    seq: 0,
    counts: Object.create(null),
    allowlistCounts: Object.create(null),
    events: [],
  };
  globalThis[STRICT_STATE_KEY] = state;
  return state;
}

function recordStrictEvent(kind, name, detail = null, options = {}) {
  const state = ensureStrictState();
  const key = `${kind}:${name}`;
  const entry = state.counts[key] || (state.counts[key] = { kind, name, count: 0, lastDetail: null });
  entry.count += 1;
  entry.lastDetail = detail;
  // Keep strict bookkeeping cheap when strict is disabled. In normal (non-debug)
  // runs we only track counts + lastDetail, avoiding per-event allocations.
  const shouldRecordEvent = state.enabled || isVerboseDebug();
  if (!shouldRecordEvent) {
    if (options.allowlisted) {
      const allowCount = state.allowlistCounts[name] || 0;
      state.allowlistCounts[name] = allowCount + 1;
    }
    return null;
  }
  const record = {
    id: (state.seq += 1),
    kind,
    name,
    t: Date.now(),
    detail,
    allowlisted: !!options.allowlisted,
    stack: options.stack ? new Error().stack : null,
  };
  state.events.push(record);
  if (state.events.length > 500) state.events.shift();
  if (options.allowlisted) {
    const allowCount = state.allowlistCounts[name] || 0;
    state.allowlistCounts[name] = allowCount + 1;
  }
  return record;
}

export function strictFallback(name, detail = null) {
  recordStrictEvent('fallback', name, detail, { stack: true });
  if (isStrictEnabled()) {
    const err = new Error(`[strict:fallback] ${name}`);
    err.detail = detail;
    throw err;
  }
}

export function strictOverride(name, detail = null) {
  const hasSource = !!(detail && detail.source);
  const hasDiff = detail && Object.prototype.hasOwnProperty.call(detail, 'before') &&
    Object.prototype.hasOwnProperty.call(detail, 'after');
  if (isStrictEnabled() && (!hasSource || !hasDiff)) {
    recordStrictEvent('override', name, { ...detail, missing: { source: !hasSource, diff: !hasDiff } }, { stack: true });
    throw new Error(`[strict:override] missing source/diff: ${name}`);
  }
  recordStrictEvent('override', name, detail, { stack: true });
}

export function strictEnsure(name, detail = null) {
  const reason = detail && detail.reason;
  if (isStrictEnabled() && !reason) {
    recordStrictEvent('ensure', name, { ...detail, missing: { reason: true } }, { stack: true });
    throw new Error(`[strict:ensure] missing reason: ${name}`);
  }
  recordStrictEvent('ensure', name, detail, { stack: true });
}

export function strictCatch(err, context, options = {}) {
  const allowlisted = options.allow === true || STRICT_CATCH_ALLOWLIST.has(context);
  recordStrictEvent('catch', context, { error: String(err || ''), allowlisted }, { stack: true, allowlisted });
  logError(`[strict] caught error at ${context}`, err);
  if (isStrictEnabled() && !allowlisted) {
    throw err;
  }
  return err;
}

export function getStrictReport() {
  const state = ensureStrictState();
  return {
    version: state.version,
    enabled: state.enabled,
    createdWallMs: state.createdWallMs,
    counts: Object.values(state.counts),
    allowlistCounts: { ...state.allowlistCounts },
    events: state.events.slice(),
  };
}

export function clearStrictReport() {
  const state = ensureStrictState();
  state.counts = Object.create(null);
  state.allowlistCounts = Object.create(null);
  state.events = [];
  state.seq = 0;
  return true;
}

if (typeof globalThis !== 'undefined') {
  try {
    globalThis.__PLAY_STRICT_REPORT__ = () => getStrictReport();
  } catch (err) {
    strictCatch(err, 'runtime:strict_report_hook', { allow: true });
  }
  try {
    globalThis.__PLAY_STRICT_CLEAR__ = () => clearStrictReport();
  } catch (err) {
    strictCatch(err, 'runtime:strict_clear_hook', { allow: true });
  }
}
