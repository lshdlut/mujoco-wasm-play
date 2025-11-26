let bindingIndex = null;
let bindingIndexPromise = null;

async function ensureBindingIndex() {
  if (bindingIndex) return bindingIndex;
  if (!bindingIndexPromise) {
    // Struct/binding index lives under dev/spec/; resolve relative to the
    // viewer module so both local dev (dev/) and GitHub Pages
    // (/mujoco-wasm-play/dev/) layouts work.
    const url = new URL('./spec/ui_bindings_index.json', import.meta.url);
    bindingIndexPromise = fetch(url, { cache: 'no-store' })
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to load ui_bindings_index.json (${res.status})`);
        return res.json();
      })
      .catch((err) => {
        console.warn('[bindings] load failed', err);
        return {};
      });
  }
  bindingIndex = await bindingIndexPromise;
  return bindingIndex;
}

export function splitBinding(binding) {
  if (!binding || typeof binding !== 'string') return null;
  const [scope, rest] = binding.split('::');
  if (!scope || !rest) return null;
  const path = rest.split('.');
  return { scope, path };
}

function parseNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function parseVector(value, length) {
  if (Array.isArray(value)) {
    const arr = value.map((v) => Number(v));
    return arr.every((n) => Number.isFinite(n)) && (!length || arr.length === length) ? arr : null;
  }
  if (typeof value === 'string') {
    const tokens = value.trim().split(/\s+/).filter(Boolean);
    if (length && tokens.length !== length) return null;
    const arr = tokens.map((token) => Number(token));
    return arr.every((n) => Number.isFinite(n)) ? arr : null;
  }
  if (value && typeof value === 'object') {
    try {
      const arr = Array.from(value, (v) => Number(v));
      if (arr.every((n) => Number.isFinite(n)) && (!length || arr.length === length)) {
        return arr;
      }
    } catch {}
  }
  const numeric = parseNumber(value);
  if (numeric == null) return null;
  const arr = [numeric];
  return length && length !== 1 ? null : arr;
}

function toBoolean(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const token = value.trim().toLowerCase();
    return token === '1' || token === 'true' || token === 'yes' || token === 'on';
  }
  if (value && typeof value === 'object') {
    if ('checked' in value) return !!value.checked;
    if ('value' in value) return toBoolean(value.value);
  }
  return !!value;
}

function normaliseEnumValue(control, rawValue) {
  if (!control) return null;
  const options = Array.isArray(control.options)
    ? control.options.map((opt) => String(opt))
    : [];
  if (typeof rawValue === 'number' && Number.isFinite(rawValue)) {
    return rawValue | 0;
  }
  const token = String(rawValue ?? '').trim();
  const idx = options.findIndex((opt) => opt === token);
  if (idx >= 0) return idx;
  if (token) {
    const numeric = Number(token);
    if (Number.isFinite(numeric)) return numeric | 0;
  }
  return null;
}

function normaliseValueByKind(kind, size, rawValue, control) {
  switch (kind) {
    case 'float':
      return parseNumber(rawValue);
    case 'float_vec':
      return parseVector(rawValue, size);
    case 'int':
      const intVal = parseNumber(rawValue);
      return intVal != null ? intVal | 0 : null;
    case 'enum':
      return normaliseEnumValue(control, rawValue);
    case 'bool':
      return toBoolean(rawValue);
    case 'string':
      return rawValue == null ? '' : String(rawValue);
    default:
      return null;
  }
}

export async function prepareBindingUpdate(control, rawValue) {
  const bindingRaw = control?.binding;
  const binding = typeof bindingRaw === 'string' ? bindingRaw.trim() : bindingRaw;
  if (!binding || typeof binding !== 'string') return null;
  if (binding === 'Simulate::run') return null;
  const meta = await ensureBindingIndex();
  const entry = meta?.[binding];
  if (!entry || !entry.value) return null;
  const bindingParts = splitBinding(binding);
  if (!bindingParts) return null;
  if (bindingParts.scope === 'mjvOption' || bindingParts.scope === 'mjvScene') {
    return null;
  }
  const { scope, path } = bindingParts;
  const kind = entry.value.kind || 'float';
  const size = entry.value.size || 1;
  if (kind === 'static') return null;
  const normalised = normaliseValueByKind(kind, size, rawValue, control);
  if (normalised == null) {
    console.warn('[bindings] unable to normalise value for', binding, rawValue);
    if (control && typeof control.binding === 'string' && control.binding.startsWith('mjVisual::headlight.')) {
      try {
        addToast(`[${control.label || 'headlight'}] invalid vector input`);
      } catch {}
    }
    return null;
  }
  return {
    meta: {
      scope,
      path,
      kind,
      size,
    },
    value: normalised,
  };
}
