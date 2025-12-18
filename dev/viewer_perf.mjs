const GLOBAL_KEY = '__PLAY_PERF';
const BOOL_TRUE = new Set(['1', 'true', 'yes', 'on', 'debug']);
let cachedEnabled = null;

function readPerfFlagFromLocation() {
  try {
    const href = typeof location !== 'undefined' && location?.href ? String(location.href) : '';
    if (!href) return null;
    const url = new URL(href);
    const token = String(url.searchParams.get('perf') || '').trim().toLowerCase();
    if (!token) return null;
    return BOOL_TRUE.has(token);
  } catch (err) {
    // If query parsing fails, surface the error; perf gate should not hide it.
    throw err;
  }
}

export function isPerfEnabled() {
  if (cachedEnabled !== null) return cachedEnabled;
  const explicit = (() => {
    try {
      if (typeof globalThis !== 'undefined' && globalThis.PLAY_PERF_DEBUG != null) {
        return !!globalThis.PLAY_PERF_DEBUG;
      }
    } catch (err) {
      throw err;
    }
    return null;
  })();
  if (explicit !== null) {
    cachedEnabled = explicit;
    return cachedEnabled;
  }
  const flag = readPerfFlagFromLocation();
  cachedEnabled = flag === true;
  try {
    if (typeof globalThis !== 'undefined') {
      globalThis.PLAY_PERF_DEBUG = cachedEnabled;
    }
  } catch (err) {
    throw err;
  }
  return cachedEnabled;
}

export function perfNow() {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') return performance.now();
  return Date.now();
}

function ensureState() {
  if (typeof globalThis === 'undefined') throw new Error('perf state requires globalThis');
  const existing = globalThis[GLOBAL_KEY];
  if (existing && typeof existing === 'object') return existing;
  const state = {
    version: 1,
    enabled: true,
    createdWallMs: Date.now(),
    marks: [],
    firstMarks: Object.create(null),
    samples: Object.create(null),
  };
  globalThis[GLOBAL_KEY] = state;
  return state;
}

export function perfMark(name, detail = null) {
  if (!isPerfEnabled()) return null;
  const state = ensureState();
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
  const state = ensureState();
  const key = String(name || '');
  if (state.firstMarks[key]) return state.firstMarks[key];
  return perfMark(key, detail);
}

export function perfSample(bucket, value, detail = null, { cap = 600 } = {}) {
  if (!isPerfEnabled()) return null;
  const state = ensureState();
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
  const state = ensureState();
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
  const state = ensureState();
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

// Convenience: expose summary helper for Playwright + console poking.
if (typeof globalThis !== 'undefined') {
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
