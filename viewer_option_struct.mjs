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
  const fn =
    mod._mjwf_model_opt_ptr ||
    mod._mjwf_opt_ptr ||
    mod._mjwf_option_ptr ||
    null;
  if (typeof fn !== 'function') return 0;
  try {
    return fn.call(mod, handle) | 0;
  } catch {
    return 0;
  }
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

export function writeOptionField(mod, handle, path, _kind, value) {
  if (!Array.isArray(path) || path.length === 0) return false;
  const field = path[0];
  const info = OPTION_LAYOUT[field];
  if (!info) return false;
  const optPtr = getOptionPtr(mod, handle);
  if (!optPtr) return false;
  if (info.type === 'f64') {
    return writeFloatValues(mod, optPtr, info, value);
  }
  if (info.type === 'i32') {
    return writeIntValues(mod, optPtr, info, value);
  }
  return false;
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
  if (!optPtr) return null;
  const result = {};
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
