// Versioned, capability-driven host contract for Play plugins.

const HOST_API_VERSION = 1;

function freezeIfObject(value) {
  if (!value || typeof value !== 'object') return value;
  if (Object.isFrozen(value)) return value;
  try {
    return Object.freeze(value);
  } catch {
    return value;
  }
}

export function createPlayHost({
  mounts = {},
  ui = null,
  store = null,
  backend = null,
  controls = null,
  renderer = null,
  getSnapshot = () => null,
  clock = {},
  logStatus = () => {},
  logWarn = () => {},
  logError = () => {},
  strictCatch = () => {},
  capabilities = null,
} = {}) {
  const defaultCapabilities = {
    mounts: true,
    ui: true,
    store: true,
    backend: true,
    controls: true,
    renderer: true,
    clock: true,
    overlay3d: true,
  };
  const caps = freezeIfObject(capabilities || defaultCapabilities);

  const host = {
    apiVersion: HOST_API_VERSION,
    contract: freezeIfObject({ apiVersion: HOST_API_VERSION }),
    capabilities: caps,
    getCapability: (name) => !!caps?.[String(name || '').trim()],
    extensions: Object.create(null),

    mounts: freezeIfObject(mounts),
    ui,
    store,
    backend,
    controls,
    renderer,
    getSnapshot: typeof getSnapshot === 'function' ? getSnapshot : (() => null),
    clock: freezeIfObject(clock),
    logStatus,
    logWarn,
    logError,
    strictCatch,
  };

  return freezeIfObject(host);
}

