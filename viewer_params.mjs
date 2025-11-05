const viewerSearchParams =
  typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : new URLSearchParams();

const BOOL_TRUE = new Set(['1', 'true', 'yes', 'on']);
const BOOL_FALSE = new Set(['0', 'false', 'no', 'off']);

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
    if (BOOL_TRUE.has(token)) return true;
    if (BOOL_FALSE.has(token)) return false;
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

// parseDeg was only used for environment rotation, which is removed.

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
    hdriParam: params.get('hdri'),
  };
}

export { viewerSearchParams };
