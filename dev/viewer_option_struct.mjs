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

function resolveHeapBuffer(mod) {
  if (!mod) return null;
  if (mod.__heapBuffer instanceof ArrayBuffer) {
    return mod.__heapBuffer;
  }
  try {
    const mem = mod.wasmExports?.memory
      || mod.asm?.memory
      || mod.asm?.wasmMemory
      || mod.wasmMemory;
    if (mem?.buffer instanceof ArrayBuffer) {
      mod.__heapBuffer = mem.buffer;
      return mem.buffer;
    }
  } catch {}
  if (mod.__heapBuffer instanceof ArrayBuffer) return mod.__heapBuffer;
  const heaps = [mod.HEAPU8, mod.HEAPF64];
  for (const view of heaps) {
    if (view && view.buffer instanceof ArrayBuffer) {
      mod.__heapBuffer = view.buffer;
      return view.buffer;
    }
  }
  return null;
}

function getOptionPtr(mod, handle) {
  if (!mod || !(handle > 0)) return 0;
  const fn = mod._mjwf_model_opt_ptr;
  if (typeof fn !== 'function') return 0;
  try { return fn.call(mod, handle) | 0; } catch { return 0; }
}

function writeFloatValues(mod, ptr, info, rawValues) {
  const buffer = resolveHeapBuffer(mod);
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
  const buffer = resolveHeapBuffer(mod);
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

function getFieldPtr(mod, handle, field) {
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
  const buffer = resolveHeapBuffer(mod);
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
  if (!Array.isArray(path) || path.length === 0) return false;
  const field = path[0];
  const info = OPTION_LAYOUT[field];
  if (!info) return false;
  const optPtr = getOptionPtr(mod, handle);
  if (optPtr) {
    if (info.type === 'f64') {
      return writeFloatValues(mod, optPtr, info, value);
    }
    if (info.type === 'i32') {
      return writeIntValues(mod, optPtr, info, value);
    }
    return false;
  }
  return writeField(mod, handle, field, info, value);
}

function writeField(mod, handle, field, info, value) {
  const ptr = getFieldPtr(mod, handle, field);
  if (!ptr) return false;
  return writeDirect(mod, ptr, info, value);
}

function readFloatValues(mod, ptr, info) {
  const buffer = resolveHeapBuffer(mod);
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
  const buffer = resolveHeapBuffer(mod);
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
  const optPtr = getOptionPtr(mod, handle);
  const result = {};
  if (optPtr) {
    for (const [key, info] of Object.entries(OPTION_LAYOUT)) {
      let value = null;
      if (info.type === 'f64') {
        value = readFloatValues(mod, optPtr, info);
      } else if (info.type === 'i32') {
        value = readIntValues(mod, optPtr, info);
      }
      if (value != null) {
        result[key] = value;
      }
    }
    return result;
  }
  // Fallback: per-field pointers
  for (const [key, info] of Object.entries(OPTION_LAYOUT)) {
    const ptr = getFieldPtr(mod, handle, key);
    if (!ptr) continue;
    const value = readDirect(mod, ptr, info);
    if (value != null) result[key] = value;
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
  const buffer = resolveHeapBuffer(mod);
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
