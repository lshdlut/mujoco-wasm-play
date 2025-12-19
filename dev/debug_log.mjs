const BOOL_TRUE = new Set(['1', 'true', 'yes', 'on', 'debug']);
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
    flag = token ? BOOL_TRUE.has(token) : false;
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
