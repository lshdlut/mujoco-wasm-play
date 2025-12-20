import { resolveHeapBuffer as resolveSharedHeapBuffer } from './bridge.mjs';

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

function selectArrayConfig(prefix, kind) {
  if (kind === 'int' || kind === 'enum' || kind === 'bool') {
    return { arrayType: Int32Array, coerceInt: true };
  }
  if (prefix === 'vis') {
    return { arrayType: Float32Array, coerceInt: false };
  }
  return { arrayType: Float64Array, coerceInt: false };
}

export function writeStructField(mod, handle, prefix, pathSegments, kind, size, rawValue) {
  const ptr = getFieldPtr(mod, handle, prefix, pathSegments);
  if (!ptr) return false;
  const count = Math.max(1, Number(size) || 1);
  const { arrayType, coerceInt } = selectArrayConfig(prefix, kind);
  switch (kind) {
    case 'float':
    case 'float_vec': {
      const values = toArrayValue(rawValue, count, { coerceInt });
      if (!values) return false;
      return writeTyped(mod, ptr, arrayType, count, values, { coerceInt });
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
    const { arrayType, coerceInt } = selectArrayConfig(prefix, kind);
    switch (kind) {
      case 'float':
      case 'float_vec':
        raw = readTyped(mod, ptr, arrayType, count, { coerceInt });
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


const OPTION_LAYOUT = {
  timestep: { offset: 0, type: 'f64', count: 1 },
  impratio: { offset: 8, type: 'f64', count: 1 },
  tolerance: { offset: 16, type: 'f64', count: 1 },
  ls_tolerance: { offset: 24, type: 'f64', count: 1 },
  noslip_tolerance: { offset: 32, type: 'f64', count: 1 },
  ccd_tolerance: { offset: 40, type: 'f64', count: 1 },
  gravity: { offset: 48, type: 'f64', count: 3 },
  wind: { offset: 72, type: 'f64', count: 3 },
  magnetic: { offset: 96, type: 'f64', count: 3 },
  density: { offset: 120, type: 'f64', count: 1 },
  viscosity: { offset: 128, type: 'f64', count: 1 },
  o_margin: { offset: 136, type: 'f64', count: 1 },
  o_solref: { offset: 144, type: 'f64', count: 2 },
  o_solimp: { offset: 160, type: 'f64', count: 5 },
  o_friction: { offset: 200, type: 'f64', count: 5 },
  integrator: { offset: 240, type: 'i32', count: 1 },
  cone: { offset: 244, type: 'i32', count: 1 },
  jacobian: { offset: 248, type: 'i32', count: 1 },
  solver: { offset: 252, type: 'i32', count: 1 },
  iterations: { offset: 256, type: 'i32', count: 1 },
  ls_iterations: { offset: 260, type: 'i32', count: 1 },
  noslip_iterations: { offset: 264, type: 'i32', count: 1 },
  ccd_iterations: { offset: 268, type: 'i32', count: 1 },
  disableflags: { offset: 272, type: 'i32', count: 1 },
  enableflags: { offset: 276, type: 'i32', count: 1 },
  disableactuator: { offset: 280, type: 'i32', count: 1 },
  sdf_initpoints: { offset: 284, type: 'i32', count: 1 },
  sdf_iterations: { offset: 288, type: 'i32', count: 1 },
};

const FIELD_POINTERS = {
  timestep: '_mjwf_model_opt_timestep_ptr',
  impratio: '_mjwf_model_opt_impratio_ptr',
  tolerance: '_mjwf_model_opt_tolerance_ptr',
  ls_tolerance: '_mjwf_model_opt_ls_tolerance_ptr',
  noslip_tolerance: '_mjwf_model_opt_noslip_tolerance_ptr',
  ccd_tolerance: '_mjwf_model_opt_ccd_tolerance_ptr',
  gravity: '_mjwf_model_opt_gravity_ptr',
  wind: '_mjwf_model_opt_wind_ptr',
  magnetic: '_mjwf_model_opt_magnetic_ptr',
  density: '_mjwf_model_opt_density_ptr',
  viscosity: '_mjwf_model_opt_viscosity_ptr',
  o_margin: '_mjwf_model_opt_o_margin_ptr',
  o_solref: '_mjwf_model_opt_o_solref_ptr',
  o_solimp: '_mjwf_model_opt_o_solimp_ptr',
  o_friction: '_mjwf_model_opt_o_friction_ptr',
  integrator: '_mjwf_model_opt_integrator_ptr',
  cone: '_mjwf_model_opt_cone_ptr',
  jacobian: '_mjwf_model_opt_jacobian_ptr',
  solver: '_mjwf_model_opt_solver_ptr',
  iterations: '_mjwf_model_opt_iterations_ptr',
  ls_iterations: '_mjwf_model_opt_ls_iterations_ptr',
  noslip_iterations: '_mjwf_model_opt_noslip_iterations_ptr',
  ccd_iterations: '_mjwf_model_opt_ccd_iterations_ptr',
  disableflags: '_mjwf_model_opt_disableflags_ptr',
  enableflags: '_mjwf_model_opt_enableflags_ptr',
  disableactuator: '_mjwf_model_opt_disableactuator_ptr',
  sdf_initpoints: '_mjwf_model_opt_sdf_initpoints_ptr',
  sdf_iterations: '_mjwf_model_opt_sdf_iterations_ptr',
};

function resolveOptionHeapBuffer(mod) {
  return resolveSharedHeapBuffer(mod);
}

function getOptionPtr(mod, handle) {
  // Struct-level mjOption pointer is no longer used for edits in play.
  // Forge 3.3.7 recommends per-field pointers (mjwf_model_opt_*_ptr) instead.
  // Keep this helper for potential diagnostics, but always return 0 so the
  // code paths below consistently go through FIELD_POINTERS.
  return 0;
}

function writeFloatValues(mod, ptr, info, rawValues) {
  const buffer = resolveOptionHeapBuffer(mod);
  if (!buffer) return false;
  const view = new Float64Array(buffer, ptr + info.offset, info.count);
  const values = Array.isArray(rawValues) ? rawValues : [rawValues];
  if (values.length < info.count) return false;
  for (let i = 0; i < info.count; i += 1) {
    const num = Number(values[i]);
    if (!Number.isFinite(num)) return false;
    view[i] = num;
  }
  return true;
}

function writeIntValues(mod, ptr, info, rawValues) {
  const buffer = resolveOptionHeapBuffer(mod);
  if (!buffer) return false;
  const view = new Int32Array(buffer, ptr + info.offset, info.count);
  const values = Array.isArray(rawValues) ? rawValues : [rawValues];
  if (values.length < info.count) return false;
  for (let i = 0; i < info.count; i += 1) {
    const num = Number(values[i]);
    if (!Number.isFinite(num)) return false;
    view[i] = num | 0;
  }
  return true;
}

function getOptionFieldPtr(mod, handle, field) {
  if (!mod || !(handle > 0)) return 0;
  const name = FIELD_POINTERS[field];
  if (!name) return 0;
  const fn = mod[name];
  if (typeof fn !== 'function') return 0;
  try {
    return fn.call(mod, handle) | 0;
  } catch {
    return 0;
  }
}

function writeDirect(mod, ptr, info, rawValues) {
  if (info.type === 'f64') {
    return writeArray(mod, ptr, Float64Array, info.count, rawValues, false);
  }
  if (info.type === 'i32') {
    return writeArray(mod, ptr, Int32Array, info.count, rawValues, true);
  }
  return false;
}

function writeArray(mod, ptr, ArrayType, count, rawValues, coerceInt) {
  const buffer = resolveOptionHeapBuffer(mod);
  if (!buffer) return false;
  try {
    const view = new ArrayType(buffer, ptr, count);
    const values = Array.isArray(rawValues) ? rawValues : [rawValues];
    if (values.length < count) return false;
    for (let i = 0; i < count; i += 1) {
      let num = Number(values[i]);
      if (!Number.isFinite(num)) return false;
      if (coerceInt) num = num | 0;
      view[i] = num;
    }
    return true;
  } catch {
    return false;
  }
}

export function writeOptionField(mod, handle, path, _kind, value) {
  if (!mod || !(handle > 0)) return false;
  if (!Array.isArray(path) || path.length === 0) return false;
  const field = path[0];
  const info = OPTION_LAYOUT[field];
  if (!info) return false;
  const ptrName = FIELD_POINTERS[field];
  const fn = ptrName ? mod[ptrName] : null;
  if (typeof fn !== 'function') return false;
  let ptr = 0;
  try {
    ptr = fn.call(mod, handle) | 0;
  } catch {
    ptr = 0;
  }
  if (!(ptr > 0)) return false;
  const buffer = resolveOptionHeapBuffer(mod);
  if (!buffer) return false;
  const count = info.count || 1;
  const values = Array.isArray(value) ? value : [value];
  if (values.length < count) return false;
  try {
    if (info.type === 'f64') {
      const view = new Float64Array(buffer, ptr, count);
      for (let i = 0; i < count; i += 1) {
        const num = Number(values[i]);
        if (!Number.isFinite(num)) return false;
        view[i] = num;
      }
    } else if (info.type === 'i32') {
      const view = new Int32Array(buffer, ptr, count);
      for (let i = 0; i < count; i += 1) {
        let num = Number(values[i]);
        if (!Number.isFinite(num)) return false;
        num = num | 0;
        view[i] = num;
      }
    } else {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

function writeField(mod, handle, field, info, value) {
  const ptr = getOptionFieldPtr(mod, handle, field);
  if (!ptr) return false;
  return writeDirect(mod, ptr, info, value);
}

function readFloatValues(mod, ptr, info) {
  const buffer = resolveOptionHeapBuffer(mod);
  if (!buffer) return null;
  try {
    const view = new Float64Array(buffer, ptr + info.offset, info.count);
    if (info.count === 1) {
      return Number(view[0]);
    }
    return Array.from(view, (v) => Number(v));
  } catch {
    return null;
  }
}

function readIntValues(mod, ptr, info) {
  const buffer = resolveOptionHeapBuffer(mod);
  if (!buffer) return null;
  try {
    const view = new Int32Array(buffer, ptr + info.offset, info.count);
    if (info.count === 1) {
      return view[0] | 0;
    }
    return Array.from(view, (v) => v | 0);
  } catch {
    return null;
  }
}

export function readOptionStruct(mod, handle) {
  if (!mod || !(handle > 0)) return null;
  const buffer = resolveOptionHeapBuffer(mod);
  if (!buffer) return null;
  const result = {};
  for (const [key, info] of Object.entries(OPTION_LAYOUT)) {
    const ptrName = FIELD_POINTERS[key];
    const fn = ptrName ? mod[ptrName] : null;
    if (typeof fn !== 'function') continue;
    let ptr = 0;
    try {
      ptr = fn.call(mod, handle) | 0;
    } catch {
      ptr = 0;
    }
    if (!(ptr > 0)) continue;
    try {
      if (info.type === 'f64') {
        const view = new Float64Array(buffer, ptr, info.count);
        if (info.count === 1) {
          result[key] = Number(view[0]);
        } else {
          result[key] = Array.from(view, (v) => Number(v));
        }
      } else if (info.type === 'i32') {
        const view = new Int32Array(buffer, ptr, info.count);
        if (info.count === 1) {
          result[key] = view[0] | 0;
        } else {
          result[key] = Array.from(view, (v) => v | 0);
        }
      }
    } catch {
      // ignore read failure for this field
    }
  }
  return Object.keys(result).length ? result : null;
}

function readDirect(mod, ptr, info) {
  if (info.type === 'f64') {
    return readArray(mod, ptr, Float64Array, info.count, false);
  }
  if (info.type === 'i32') {
    return readArray(mod, ptr, Int32Array, info.count, true);
  }
  return null;
}

function readArray(mod, ptr, ArrayType, count, coerceInt) {
  const buffer = resolveOptionHeapBuffer(mod);
  if (!buffer) return null;
  try {
    const view = new ArrayType(buffer, ptr, count);
    if (count === 1) {
      return coerceInt ? (view[0] | 0) : Number(view[0]);
    }
    return Array.from(view, (v) => (coerceInt ? (v | 0) : Number(v)));
  } catch {
    return null;
  }
}

export function detectOptionSupport(mod) {
  if (!mod) return { supported: false, pointers: [] };
  const structPtr = typeof mod._mjwf_model_opt_ptr === 'function' ? '_mjwf_model_opt_ptr' : null;
  const fieldPtrs = Object.values(FIELD_POINTERS).filter((name) => typeof mod[name] === 'function');
  const pointers = structPtr ? [structPtr, ...fieldPtrs] : fieldPtrs;
  return {
    supported: pointers.length > 0,
    pointers,
  };
}


export const VISUAL_FIELD_DESCRIPTORS = [
  {
    "path": [
      "global",
      "azimuth"
    ],
    "kind": "float",
    "size": 1
  },
  {
    "path": [
      "global",
      "bvactive"
    ],
    "kind": "enum",
    "size": 1
  },
  {
    "path": [
      "global",
      "elevation"
    ],
    "kind": "float",
    "size": 1
  },
  {
    "path": [
      "global",
      "ellipsoidinertia"
    ],
    "kind": "enum",
    "size": 1
  },
  {
    "path": [
      "global",
      "fovy"
    ],
    "kind": "float",
    "size": 1
  },
  {
    "path": [
      "global",
      "orthographic"
    ],
    "kind": "enum",
    "size": 1
  },
  {
    "path": [
      "headlight",
      "active"
    ],
    "kind": "enum",
    "size": 1
  },
  {
    "path": [
      "headlight",
      "ambient"
    ],
    "kind": "float_vec",
    "size": 3
  },
  {
    "path": [
      "headlight",
      "diffuse"
    ],
    "kind": "float_vec",
    "size": 3
  },
  {
    "path": [
      "headlight",
      "specular"
    ],
    "kind": "float_vec",
    "size": 3
  },
  {
    "path": [
      "map",
      "alpha"
    ],
    "kind": "float",
    "size": 1
  },
  {
    "path": [
      "map",
      "fogend"
    ],
    "kind": "float",
    "size": 1
  },
  {
    "path": [
      "map",
      "fogstart"
    ],
    "kind": "float",
    "size": 1
  },
  {
    "path": [
      "map",
      "force"
    ],
    "kind": "float",
    "size": 1
  },
  {
    "path": [
      "map",
      "haze"
    ],
    "kind": "float",
    "size": 1
  },
  {
    "path": [
      "map",
      "shadowclip"
    ],
    "kind": "float",
    "size": 1
  },
  {
    "path": [
      "map",
      "shadowscale"
    ],
    "kind": "float",
    "size": 1
  },
  {
    "path": [
      "map",
      "stiffness"
    ],
    "kind": "float",
    "size": 1
  },
  {
    "path": [
      "map",
      "stiffnessrot"
    ],
    "kind": "float",
    "size": 1
  },
  {
    "path": [
      "map",
      "torque"
    ],
    "kind": "float",
    "size": 1
  },
  {
    "path": [
      "map",
      "zfar"
    ],
    "kind": "float",
    "size": 1
  },
  {
    "path": [
      "map",
      "znear"
    ],
    "kind": "float",
    "size": 1
  },
  {
    "path": [
      "rgba",
      "actuator"
    ],
    "kind": "float_vec",
    "size": 4
  },
  {
    "path": [
      "rgba",
      "actuatornegative"
    ],
    "kind": "float_vec",
    "size": 4
  },
  {
    "path": [
      "rgba",
      "actuatorpositive"
    ],
    "kind": "float_vec",
    "size": 4
  },
  {
    "path": [
      "rgba",
      "bv"
    ],
    "kind": "float_vec",
    "size": 4
  },
  {
    "path": [
      "rgba",
      "bvactive"
    ],
    "kind": "float_vec",
    "size": 4
  },
  {
    "path": [
      "rgba",
      "camera"
    ],
    "kind": "float_vec",
    "size": 4
  },
  {
    "path": [
      "rgba",
      "com"
    ],
    "kind": "float_vec",
    "size": 4
  },
  {
    "path": [
      "rgba",
      "connect"
    ],
    "kind": "float_vec",
    "size": 4
  },
  {
    "path": [
      "rgba",
      "constraint"
    ],
    "kind": "float_vec",
    "size": 4
  },
  {
    "path": [
      "rgba",
      "contactforce"
    ],
    "kind": "float_vec",
    "size": 4
  },
  {
    "path": [
      "rgba",
      "contactfriction"
    ],
    "kind": "float_vec",
    "size": 4
  },
  {
    "path": [
      "rgba",
      "contactgap"
    ],
    "kind": "float_vec",
    "size": 4
  },
  {
    "path": [
      "rgba",
      "contactpoint"
    ],
    "kind": "float_vec",
    "size": 4
  },
  {
    "path": [
      "rgba",
      "contacttorque"
    ],
    "kind": "float_vec",
    "size": 4
  },
  {
    "path": [
      "rgba",
      "crankbroken"
    ],
    "kind": "float_vec",
    "size": 4
  },
  {
    "path": [
      "rgba",
      "fog"
    ],
    "kind": "float_vec",
    "size": 4
  },
  {
    "path": [
      "rgba",
      "force"
    ],
    "kind": "float_vec",
    "size": 4
  },
  {
    "path": [
      "rgba",
      "frustum"
    ],
    "kind": "float_vec",
    "size": 4
  },
  {
    "path": [
      "rgba",
      "haze"
    ],
    "kind": "float_vec",
    "size": 4
  },
  {
    "path": [
      "rgba",
      "inertia"
    ],
    "kind": "float_vec",
    "size": 4
  },
  {
    "path": [
      "rgba",
      "joint"
    ],
    "kind": "float_vec",
    "size": 4
  },
  {
    "path": [
      "rgba",
      "light"
    ],
    "kind": "float_vec",
    "size": 4
  },
  {
    "path": [
      "rgba",
      "rangefinder"
    ],
    "kind": "float_vec",
    "size": 4
  },
  {
    "path": [
      "rgba",
      "selectpoint"
    ],
    "kind": "float_vec",
    "size": 4
  },
  {
    "path": [
      "rgba",
      "slidercrank"
    ],
    "kind": "float_vec",
    "size": 4
  },
  {
    "path": [
      "scale",
      "actuatorlength"
    ],
    "kind": "float",
    "size": 1
  },
  {
    "path": [
      "scale",
      "actuatorwidth"
    ],
    "kind": "float",
    "size": 1
  },
  {
    "path": [
      "scale",
      "camera"
    ],
    "kind": "float",
    "size": 1
  },
  {
    "path": [
      "scale",
      "com"
    ],
    "kind": "float",
    "size": 1
  },
  {
    "path": [
      "scale",
      "connect"
    ],
    "kind": "float",
    "size": 1
  },
  {
    "path": [
      "scale",
      "constraint"
    ],
    "kind": "float",
    "size": 1
  },
  {
    "path": [
      "scale",
      "contactheight"
    ],
    "kind": "float",
    "size": 1
  },
  {
    "path": [
      "scale",
      "contactwidth"
    ],
    "kind": "float",
    "size": 1
  },
  {
    "path": [
      "scale",
      "forcewidth"
    ],
    "kind": "float",
    "size": 1
  },
  {
    "path": [
      "scale",
      "framelength"
    ],
    "kind": "float",
    "size": 1
  },
  {
    "path": [
      "scale",
      "framewidth"
    ],
    "kind": "float",
    "size": 1
  },
  {
    "path": [
      "scale",
      "jointlength"
    ],
    "kind": "float",
    "size": 1
  },
  {
    "path": [
      "scale",
      "jointwidth"
    ],
    "kind": "float",
    "size": 1
  },
  {
    "path": [
      "scale",
      "light"
    ],
    "kind": "float",
    "size": 1
  },
  {
    "path": [
      "scale",
      "selectpoint"
    ],
    "kind": "float",
    "size": 1
  },
  {
    "path": [
      "scale",
      "slidercrank"
    ],
    "kind": "float",
    "size": 1
  }
];

export function writeVisualField(mod, handle, pathSegments, kind, value, size) {
  return writeStructField(mod, handle, 'vis', pathSegments, kind, size, value);
}

export function readVisualStruct(mod, handle) {
  return readStructSnapshot(mod, handle, 'vis', VISUAL_FIELD_DESCRIPTORS);
}


export const STAT_FIELD_DESCRIPTORS = [
  {
    "path": [
      "center"
    ],
    "kind": "float_vec",
    "size": 3
  },
  {
    "path": [
      "extent"
    ],
    "kind": "float",
    "size": 1
  },
  {
    "path": [
      "meansize"
    ],
    "kind": "float",
    "size": 1
  },
  {
    "path": [
      "meanmass"
    ],
    "kind": "float",
    "size": 1
  }
];

export function writeStatisticField(mod, handle, pathSegments, kind, value, size) {
  return writeStructField(mod, handle, 'stat', pathSegments, kind, size, value);
}

export function readStatisticStruct(mod, handle) {
  return readStructSnapshot(mod, handle, 'stat', STAT_FIELD_DESCRIPTORS);
}
