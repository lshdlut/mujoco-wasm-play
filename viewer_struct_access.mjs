// General helpers for reading/writing MuJoCo struct fields (mjOption/mjVisual/mjStatistic, etc.)

function pointerName(prefix, pathSegments) {
  const suffix = pathSegments
    .map((segment) => segment.replace(/[^A-Za-z0-9]/g, '_'))
    .join('_');
  return `_mjwf_model_${prefix}_${suffix}_ptr`;
}

function getFieldPtr(mod, handle, prefix, pathSegments) {
  if (!mod || !(handle > 0)) return 0;
  const fnName = pointerName(prefix, pathSegments);
  const fn = typeof mod[fnName] === 'function' ? mod[fnName] : null;
  if (!fn) return 0;
  try {
    return fn.call(mod, handle) | 0;
  } catch {
    return 0;
  }
}

function resolveHeapBuffer(mod) {
  if (!mod) return null;
  if (mod.__heapBuffer instanceof ArrayBuffer) {
    return mod.__heapBuffer;
  }
  try {
    const mem =
      mod.wasmExports?.memory ||
      mod.asm?.memory ||
      mod.asm?.wasmMemory ||
      mod.wasmMemory;
    if (mem?.buffer instanceof ArrayBuffer) {
      mod.__heapBuffer = mem.buffer;
      return mem.buffer;
    }
  } catch {}
  const heaps = [mod.HEAPF64, mod.HEAPF32, mod.HEAP32, mod.HEAPU8];
  for (const view of heaps) {
    if (view?.buffer instanceof ArrayBuffer) {
      mod.__heapBuffer = view.buffer;
      return view.buffer;
    }
  }
  return null;
}

function writeTyped(mod, ptr, ArrayType, count, rawValues, { coerceInt = false } = {}) {
  const buffer = resolveHeapBuffer(mod);
  if (!buffer) return false;
  try {
    const view = new ArrayType(buffer, ptr, count);
    const values = Array.isArray(rawValues) ? rawValues : [rawValues];
    if (values.length < count) return false;
    for (let i = 0; i < count; i += 1) {
      let v = values[i];
      if (coerceInt) {
        const num = Number(v);
        if (!Number.isFinite(num)) return false;
        view[i] = num | 0;
      } else {
        const num = Number(v);
        if (!Number.isFinite(num)) return false;
        view[i] = num;
      }
    }
    return true;
  } catch {
    return false;
  }
}

function readTyped(mod, ptr, ArrayType, count, { coerceInt = false } = {}) {
  const buffer = resolveHeapBuffer(mod);
  if (!buffer) return null;
  try {
    const view = new ArrayType(buffer, ptr, count);
    if (count === 1) {
      const value = view[0];
      return coerceInt ? (value | 0) : Number(value);
    }
    return Array.from(view, (value) => (coerceInt ? (value | 0) : Number(value)));
  } catch {
    return null;
  }
}

function toArrayValue(raw, size, { coerceInt = false } = {}) {
  if (Array.isArray(raw)) {
    const arr = raw.map((entry) => Number(entry));
    if (!arr.every((entry) => Number.isFinite(entry))) return null;
    if (size && arr.length < size) return null;
    return arr.slice(0, size);
  }
  const num = Number(raw);
  if (!Number.isFinite(num)) return null;
  if (!size || size === 1) return [coerceInt ? (num | 0) : num];
  return Array(size).fill(coerceInt ? (num | 0) : num);
}

export function setStructPath(target, pathSegments, value) {
  if (!target || !Array.isArray(pathSegments) || !pathSegments.length) return;
  let cursor = target;
  for (let i = 0; i < pathSegments.length; i += 1) {
    const segment = pathSegments[i];
    const match = segment.match(/^(.*)\[(\d+)\]$/);
    const key = match ? match[1] : segment;
    const hasIndex = !!match;
    const index = hasIndex ? Number(match[2]) : -1;
    if (i === pathSegments.length - 1) {
      if (hasIndex) {
        cursor[key] = Array.isArray(cursor[key]) ? cursor[key] : [];
        cursor[key][index] = value;
      } else {
        cursor[key] = value;
      }
      return;
    }
    if (hasIndex) {
      cursor[key] = Array.isArray(cursor[key]) ? cursor[key] : [];
      cursor[key][index] = cursor[key][index] || {};
      cursor = cursor[key][index];
    } else {
      cursor[key] = cursor[key] || {};
      cursor = cursor[key];
    }
  }
}

export function writeStructField(mod, handle, prefix, pathSegments, kind, size, rawValue) {
  const ptr = getFieldPtr(mod, handle, prefix, pathSegments);
  if (!ptr) return false;
  const count = Math.max(1, Number(size) || 1);
  switch (kind) {
    case 'float':
      return writeTyped(mod, ptr, Float64Array, 1, rawValue);
    case 'float_vec': {
      const values = toArrayValue(rawValue, count);
      if (!values) return false;
      return writeTyped(mod, ptr, Float64Array, count, values);
    }
    case 'int':
    case 'enum': {
      const values = toArrayValue(rawValue, count, { coerceInt: true });
      if (!values) return false;
      return writeTyped(mod, ptr, Int32Array, count, values, { coerceInt: true });
    }
    case 'bool': {
      const values = toArrayValue(rawValue, count, { coerceInt: true });
      if (!values) return false;
      return writeTyped(mod, ptr, Int32Array, count, values, { coerceInt: true });
    }
    default:
      return false;
  }
}

function normaliseReadValue(kind, count, raw) {
  if (raw == null) return null;
  if (count === 1) {
    if (kind === 'bool') return raw ? 1 : 0;
    return raw;
  }
  return Array.isArray(raw) ? raw.slice(0, count) : [raw];
}

export function readStructSnapshot(mod, handle, prefix, descriptors) {
  if (!mod || !(handle > 0)) return null;
  const out = {};
  for (const descriptor of descriptors) {
    const { path, kind, size } = descriptor;
    const ptr = getFieldPtr(mod, handle, prefix, path);
    if (!ptr) continue;
    const count = Math.max(1, Number(size) || 1);
    let raw = null;
    switch (kind) {
      case 'float':
        raw = readTyped(mod, ptr, Float64Array, 1);
        break;
      case 'float_vec':
        raw = readTyped(mod, ptr, Float64Array, count);
        break;
      case 'int':
      case 'enum':
      case 'bool':
        raw = readTyped(mod, ptr, Int32Array, count, { coerceInt: true });
        break;
      default:
        break;
    }
    const value = normaliseReadValue(kind, count, raw);
    if (value != null) {
      setStructPath(out, path, value);
    }
  }
  return out;
}
