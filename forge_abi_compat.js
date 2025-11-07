// Forge ABI compatibility helpers.
// Exposes legacy `_mjwf_*` entrypoints by aliasing or wrapping the new helper/pointer exports.

const HANDLE_CACHE_KEY = '__forgeHandleCache';

const POINTER_ALIASES = {
  _mjwf_actuator_ctrlrange_ptr: '_mjwf_model_actuator_ctrlrange_ptr',
  _mjwf_body_jntadr_ptr: '_mjwf_model_body_jntadr_ptr',
  _mjwf_body_jntnum_ptr: '_mjwf_model_body_jntnum_ptr',
  _mjwf_geom_bodyid_ptr: '_mjwf_model_geom_bodyid_ptr',
  _mjwf_geom_dataid_ptr: '_mjwf_model_geom_dataid_ptr',
  _mjwf_geom_matid_ptr: '_mjwf_model_geom_matid_ptr',
  _mjwf_geom_size_ptr: '_mjwf_model_geom_size_ptr',
  _mjwf_geom_type_ptr: '_mjwf_model_geom_type_ptr',
  _mjwf_geom_xmat_ptr: '_mjwf_data_geom_xmat_ptr',
  _mjwf_geom_xpos_ptr: '_mjwf_data_geom_xpos_ptr',
  _mjwf_mat_rgba_ptr: '_mjwf_model_mat_rgba_ptr',
  _mjwf_mat_texid_ptr: '_mjwf_model_mat_texid_ptr',
  _mjwf_mat_texrepeat_ptr: '_mjwf_model_mat_texrepeat_ptr',
  _mjwf_mat_texuniform_ptr: '_mjwf_model_mat_texuniform_ptr',
  _mjwf_mesh_face_ptr: '_mjwf_model_mesh_face_ptr',
  _mjwf_mesh_faceadr_ptr: '_mjwf_model_mesh_faceadr_ptr',
  _mjwf_mesh_facenum_ptr: '_mjwf_model_mesh_facenum_ptr',
  _mjwf_mesh_normal_ptr: '_mjwf_model_mesh_normal_ptr',
  _mjwf_mesh_texcoord_ptr: '_mjwf_model_mesh_texcoord_ptr',
  _mjwf_mesh_texcoordadr_ptr: '_mjwf_model_mesh_texcoordadr_ptr',
  _mjwf_mesh_texcoordnum_ptr: '_mjwf_model_mesh_texcoordnum_ptr',
  _mjwf_mesh_vert_ptr: '_mjwf_model_mesh_vert_ptr',
  _mjwf_mesh_vertadr_ptr: '_mjwf_model_mesh_vertadr_ptr',
  _mjwf_mesh_vertnum_ptr: '_mjwf_model_mesh_vertnum_ptr',
  _mjwf_qpos_ptr: '_mjwf_data_qpos_ptr',
  _mjwf_qvel_ptr: '_mjwf_data_qvel_ptr',
  _mjwf_ctrl_ptr: '_mjwf_data_ctrl_ptr',
  _mjwf_xfrc_applied_ptr: '_mjwf_data_xfrc_applied_ptr',
  _mjwf_body_jntadr_ptr: '_mjwf_model_body_jntadr_ptr',
  _mjwf_body_jntnum_ptr: '_mjwf_model_body_jntnum_ptr',
  _mjwf_jnt_qposadr_ptr: '_mjwf_model_jnt_qposadr_ptr',
  _mjwf_jnt_range_ptr: '_mjwf_model_jnt_range_ptr',
  _mjwf_jnt_type_ptr: '_mjwf_model_jnt_type_ptr',
};

const COUNT_ALIASES = {
  _mjwf_nbody: '_mjwf_model_nbody',
  _mjwf_ncon: '_mjwf_data_ncon',
  _mjwf_ngeom: '_mjwf_model_ngeom',
  _mjwf_njnt: '_mjwf_model_njnt',
  _mjwf_nmat: '_mjwf_model_nmat',
  _mjwf_nmesh: '_mjwf_model_nmesh',
  _mjwf_nq: '_mjwf_model_nq',
  _mjwf_nu: '_mjwf_model_nu',
  _mjwf_nv: '_mjwf_model_nv',
  _mjwf_mesh_vert_count: '_mjwf_model_mesh_vert_count',
  _mjwf_mesh_face_count: '_mjwf_model_mesh_face_count',
  _mjwf_mesh_texcoord_count: '_mjwf_model_mesh_texcoord_count',
};

const NAME_RULES = [
  {
    legacy: '_mjwf_actuator_name_of',
    adrExport: '_mjwf_model_name_actuatoradr_ptr',
    countExport: '_mjwf_model_nu',
  },
  {
    legacy: '_mjwf_jnt_name_of',
    adrExport: '_mjwf_model_name_jntadr_ptr',
    countExport: '_mjwf_model_njnt',
  },
  {
    legacy: '_mjwf_joint_name_of',
    adrExport: '_mjwf_model_name_jntadr_ptr',
    countExport: '_mjwf_model_njnt',
  },
];

function aliasFunctions(mod, mapping) {
  for (const [legacy, modern] of Object.entries(mapping)) {
    if (typeof mod[legacy] === 'function') continue;
    if (typeof mod[modern] === 'function') {
      mod[legacy] = mod[modern];
    }
  }
}

function getHandleEntry(mod, handle) {
  if (!(handle > 0)) return null;
  if (!mod[HANDLE_CACHE_KEY]) {
    Object.defineProperty(mod, HANDLE_CACHE_KEY, {
      value: new Map(),
      enumerable: false,
      configurable: false,
      writable: false,
    });
  }
  const cache = mod[HANDLE_CACHE_KEY];
  if (!cache.has(handle)) {
    cache.set(handle, { model: 0, data: 0 });
  }
  return cache.get(handle);
}

function ensurePointers(mod, handle) {
  const entry = getHandleEntry(mod, handle);
  if (!entry) return null;
  if (!entry.model && typeof mod._mjwf_helper_model_ptr === 'function') {
    try { entry.model = mod._mjwf_helper_model_ptr(handle) | 0; } catch {}
  }
  if (!entry.data && typeof mod._mjwf_helper_data_ptr === 'function') {
    try { entry.data = mod._mjwf_helper_data_ptr(handle) | 0; } catch {}
  }
  if (entry.model && entry.data) return entry;
  return null;
}

function getOfficial(mod, name, returnType = null, argTypes = []) {
  // Try direct export e.g. _mjwf_mj_step, _mjwf_mj_forward, etc.
  const candidates = [
    `_${name}`,               // rarely present
    `_mjwf_${name}`,          // forge wrapper naming for official APIs
  ];
  for (const c of candidates) {
    const fn = mod?.[c];
    if (typeof fn === 'function') {
      return (...args) => fn.apply(mod, args);
    }
  }
  // As a last resort, try cwrap on the wrapper name to avoid aborting on missing raw symbol
  if (typeof mod.cwrap === 'function') {
    const wrapNames = [name, `mjwf_${name}`];
    for (const nm of wrapNames) {
      const cacheKey = `__forge_cwrap_${nm}`;
      if (!mod[cacheKey]) {
        try { mod[cacheKey] = mod.cwrap(nm, returnType, argTypes); } catch { mod[cacheKey] = null; }
      }
      const fn = mod[cacheKey];
      if (typeof fn === 'function') {
        return (...args) => fn(...args);
      }
    }
  }
  return null;
}

function resolveHeapBuffer(mod) {
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
  const heaps = [mod.HEAPU8, mod.HEAPF64, mod.HEAP32];
  for (const heap of heaps) {
    if (heap?.buffer instanceof ArrayBuffer) {
      mod.__heapBuffer = heap.buffer;
      return heap.buffer;
    }
  }
  return null;
}

function readScalar(mod, ptr, type) {
  if (!(ptr > 0)) return 0;
  const buffer = resolveHeapBuffer(mod);
  if (!buffer) return 0;
  try {
    if (type === 'f64') {
      const view = new Float64Array(buffer, ptr >>> 0, 1);
      return Number(view[0]) || 0;
    }
    if (type === 'i32') {
      const view = new Int32Array(buffer, ptr >>> 0, 1);
      return view[0] | 0;
    }
  } catch {}
  return 0;
}

function installNameAccessors(mod) {
  const namesPtrFn = mod._mjwf_model_names_ptr;
  if (typeof namesPtrFn !== 'function') return;
  const buffer = () => resolveHeapBuffer(mod);
  for (const rule of NAME_RULES) {
    if (typeof mod[rule.legacy] === 'function') continue;
    const adrFn = mod[rule.adrExport];
    const countFn = mod[rule.countExport];
    if (typeof adrFn !== 'function' || typeof countFn !== 'function') continue;
    mod[rule.legacy] = function legacyNameOf(handle, index) {
      const namesPtr = namesPtrFn.call(mod, handle) | 0;
      const adrPtr = adrFn.call(mod, handle) | 0;
      const count = countFn.call(mod, handle) | 0;
      if (!(namesPtr > 0) || !(adrPtr > 0) || !(count > 0)) return 0;
      const buf = buffer();
      if (!buf) return 0;
      try {
        const view = new Int32Array(buf, adrPtr >>> 0, count);
        const idx = index | 0;
        if (idx < 0 || idx >= view.length) return 0;
        const offset = view[idx] | 0;
        if (!(offset >= 0)) return 0;
        return namesPtr + offset;
      } catch {
        return 0;
      }
    };
  }
}

function installErrnoAliases(mod) {
  if (typeof mod._mjwf_errno_last !== 'function' && typeof mod._mjwf_helper_errno_last === 'function') {
    mod._mjwf_errno_last = function errnoLegacy(handle) {
      try { return mod._mjwf_helper_errno_last(handle) | 0; } catch { return 0; }
    };
  }
  if (typeof mod._mjwf_errmsg_last !== 'function' && typeof mod._mjwf_helper_errmsg_last === 'function') {
    mod._mjwf_errmsg_last = function errmsgLegacy(handle) {
      try { return mod._mjwf_helper_errmsg_last(handle) | 0; } catch { return 0; }
    };
  }
  if (typeof mod._mjwf_errmsg_last_global !== 'function' && typeof mod._mjwf_helper_errmsg_last_global === 'function') {
    mod._mjwf_errmsg_last_global = function errmsgGlobalLegacy() {
      try { return mod._mjwf_helper_errmsg_last_global() | 0; } catch { return 0; }
    };
  }
  if (typeof mod._mjwf_errno_last_global !== 'function' && typeof mod._mjwf_helper_errno_last_global === 'function') {
    mod._mjwf_errno_last_global = function errnoGlobalLegacy() {
      try { return mod._mjwf_helper_errno_last_global() | 0; } catch { return 0; }
    };
  }
}

function installLifecycleWrappers(mod) {
  if (typeof mod._mjwf_make_from_xml !== 'function' && typeof mod._mjwf_helper_make_from_xml === 'function') {
    mod._mjwf_make_from_xml = function makeLegacy(path) {
      return mod._mjwf_helper_make_from_xml(String(path || '')) | 0;
    };
  }
  if (typeof mod._mjwf_free !== 'function' && typeof mod._mjwf_helper_free === 'function') {
    mod._mjwf_free = function freeLegacy(handle) {
      try { mod._mjwf_helper_free(handle | 0); } catch {}
    };
  }
  if (typeof mod._mjwf_valid !== 'function' && typeof mod._mjwf_helper_valid === 'function') {
    mod._mjwf_valid = function validLegacy(handle) {
      try { return mod._mjwf_helper_valid(handle | 0) | 0; } catch { return 0; }
    };
  }
}

function installMjCallWrapper(mod, legacyName, officialName, hasCountArg = false) {
  if (typeof mod[legacyName] === 'function') return;
  const fn = getOfficial(mod, officialName, null, ['number', 'number']);
  if (typeof fn !== 'function') return;
  mod[legacyName] = function legacy(handle, count = 1) {
    const ptrs = ensurePointers(mod, handle | 0);
    if (!ptrs) return 0;
    if (hasCountArg) {
      const n = Math.max(1, count | 0);
      for (let i = 0; i < n; i += 1) {
        fn(ptrs.model, ptrs.data);
      }
    } else {
      fn(ptrs.model, ptrs.data);
    }
    return 1;
  };
}

function installTimeWrappers(mod) {
  if (typeof mod._mjwf_time !== 'function' && typeof mod._mjwf_data_time_ptr === 'function') {
    mod._mjwf_time = function timeLegacy(handle) {
      const ptr = mod._mjwf_data_time_ptr(handle | 0) | 0;
      return readScalar(mod, ptr, 'f64');
    };
  }
  if (typeof mod._mjwf_timestep !== 'function' && typeof mod._mjwf_model_opt_timestep_ptr === 'function') {
    mod._mjwf_timestep = function timestepLegacy(handle) {
      const ptr = mod._mjwf_model_opt_timestep_ptr(handle | 0) | 0;
      return readScalar(mod, ptr, 'f64');
    };
  }
}

export function installForgeAbiCompat(mod) {
  if (!mod || mod.__forgeAbiCompatInstalled) return;
  mod.__forgeAbiCompatInstalled = true;

  aliasFunctions(mod, POINTER_ALIASES);
  aliasFunctions(mod, COUNT_ALIASES);
  installErrnoAliases(mod);
  installLifecycleWrappers(mod);
  installNameAccessors(mod);
  installTimeWrappers(mod);

  installMjCallWrapper(mod, '_mjwf_step', 'mj_step', true);
  installMjCallWrapper(mod, '_mjwf_reset', 'mj_resetData', false);
  installMjCallWrapper(mod, '_mjwf_resetData', 'mj_resetData', false);
  installMjCallWrapper(mod, '_mjwf_forward', 'mj_forward', false);
}

export default installForgeAbiCompat;
