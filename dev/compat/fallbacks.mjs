import { isCompatEnabled, strictFallback } from '../viewer_runtime.mjs';

// Compat fallbacks are centralized here so fallback behavior is explicit and auditable.
// Keeping the allowlist in one module avoids scattered ad-hoc decisions across main/worker code paths.
// This keeps strict mode default behavior (throw) while still allowing targeted compatibility toggles.

const COMPAT_FALLBACK_ALLOWLIST = new Set([
  'forgeBase.malformed',
  'loadXmlWithFallback',
  'mesh.convex_hull_missing',
  'environment.hdri_fallback',
]);

export function compatFallback(name, detail = null, fallbackFn = null) {
  if (!COMPAT_FALLBACK_ALLOWLIST.has(name)) {
    const err = new Error(`[compat] fallback not allowlisted: ${name}`);
    err.detail = detail;
    throw err;
  }
  strictFallback(name, detail);
  if (!isCompatEnabled()) {
    const err = new Error(`[compat] disabled fallback: ${name}`);
    err.detail = detail;
    throw err;
  }
  return typeof fallbackFn === 'function' ? fallbackFn() : null;
}
