// Minimal browser-only bridge: heap views + MjSimLite (no Node deps)
import { logError } from './debug_log.mjs';

let __forgeModuleSeq = 1;
function tagForgeModule(mod) {
  if (!mod || typeof mod !== 'object') return 'unknown';
  if (typeof mod.__forgeModuleId === 'string' && mod.__forgeModuleId.length) {
    return mod.__forgeModuleId;
  }
  const seq = (__forgeModuleSeq += 1);
  const stamp = Date.now().toString(16);
  const rand = Math.floor(Math.random() * 0x10000).toString(16);
  const id = `forge_mod_${stamp}_${seq}_${rand}`;
  try { mod.__forgeModuleId = id; } catch {}
  return id;
}

export function resolveHeapBuffer(mod) {
  if (!mod) return null;
  if (mod.__heapBuffer instanceof ArrayBuffer && mod.__heapBuffer.byteLength > 0) {
    return mod.__heapBuffer;
  }
  try {
    const mem = mod.wasmExports?.memory;
    if (mem?.buffer instanceof ArrayBuffer && mem.buffer.byteLength > 0) {
      mod.__heapBuffer = mem.buffer;
      return mem.buffer;
    }
  } catch {}
  try {
    const heapU8 = mod.HEAPU8;
    if (heapU8?.buffer instanceof ArrayBuffer && heapU8.buffer.byteLength > 0) {
      mod.__heapBuffer = heapU8.buffer;
      return heapU8.buffer;
    }
  } catch {}
  try {
    const heapF64 = mod.HEAPF64;
    if (heapF64?.buffer instanceof ArrayBuffer && heapF64.buffer.byteLength > 0) {
      mod.__heapBuffer = heapF64.buffer;
      return heapF64.buffer;
    }
  } catch {}
  return null;
}

const MJ_STATE_INTEGRATION = 0x1fff;

function createHeapTypedArray(mod, ptr, length, Ctor) {
  const n = length | 0;
  if (!(n > 0) || !(ptr > 0)) {
    return new Ctor(0);
  }
  const buffer = resolveHeapBuffer(mod);
  if (buffer instanceof ArrayBuffer) {
    mod.__heapBuffer = buffer;
    try {
      return new Ctor(buffer, ptr >>> 0, n);
    } catch (err) {
      try {
        const bytes = Ctor.BYTES_PER_ELEMENT * n;
        const src = new Uint8Array(buffer, ptr >>> 0, bytes);
        const copy = new Ctor(n);
        new Uint8Array(copy.buffer).set(src);
        return copy;
      } catch {
        // fall through to HEAP view fallback
      }
    }
  }
  const heapField =
    Ctor === Float64Array ? 'HEAPF64'
      : Ctor === Float32Array ? 'HEAPF32'
        : Ctor === Int32Array ? 'HEAP32'
          : null;
  if (heapField && mod && mod[heapField] && mod[heapField].buffer instanceof ArrayBuffer) {
    const heap = mod[heapField];
    const shift = Math.log2(Ctor.BYTES_PER_ELEMENT) | 0;
    const start = ptr >> shift;
    try {
      return heap.subarray(start, start + n);
    } catch {
      // ignore
    }
  }
  return new Ctor(n);
}

function computeMeshElementCounts(vertAdr, vertNum, faceAdr, faceNum, texcoordAdr, texcoordNum) {
  const safeMax = (adrView, numView, scale) => {
    if (!adrView || !numView || !Number.isFinite(scale) || scale <= 0) return 0;
    const n = Math.min(adrView.length, numView.length) | 0;
    let max = 0;
    for (let i = 0; i < n; i += 1) {
      const base = adrView[i] | 0;
      const count = numView[i] | 0;
      if (base < 0 || count <= 0) continue;
      const end = base + count;
      if (end > max) max = end;
    }
    return max * scale;
  };
  return {
    vert: safeMax(vertAdr, vertNum, 3),
    face: safeMax(faceAdr, faceNum, 3),
    texcoord: safeMax(texcoordAdr, texcoordNum, 2),
  };
}

export function heapViewF64(mod, ptr, length) {
  return createHeapTypedArray(mod, ptr, length, Float64Array);
}
export function heapViewF32(mod, ptr, length) {
  return createHeapTypedArray(mod, ptr, length, Float32Array);
}
export function heapViewI32(mod, ptr, length) {
  return createHeapTypedArray(mod, ptr, length, Int32Array);
}
export function heapViewU8(mod, ptr, length) {
  return createHeapTypedArray(mod, ptr, length, Uint8Array);
}
export function readCString(mod, ptr) {
  if (!ptr) return '';
  const buffer = resolveHeapBuffer(mod);
  if (!buffer) return '';
  const u8 = new Uint8Array(buffer);
  let out = '';
  for (let i = ptr | 0; i < u8.length; i += 1) {
    const ch = u8[i];
    if (!ch) break;
    out += String.fromCharCode(ch);
  }
  return out;
}
function cloneTyped(view, Ctor) {
  if (!view) return null;
  try {
    if (Ctor) return new Ctor(view);
    if (typeof view.slice === 'function') return view.slice();
    return Array.from(view);
  } catch {
    try {
      if (Ctor && typeof Ctor.from === 'function') return Ctor.from(view);
    } catch {}
    try {
      return Array.from(view);
    } catch {
      return null;
    }
  }
}
function readView(mod, fn, handle, length, reader) {
  if (!(handle > 0) || !(length > 0)) return null;
  const ptr = fn.call(mod, handle) | 0;
  if (!ptr) return null;
  return reader(mod, ptr, length);
}
export function collectRenderAssetsFromModule(mod, handle) {
  if (!mod || !(handle > 0)) return null;
  const assets = {
    version: 1,
    geoms: null,
    bodies: null,
    sensors: null,
    sites: null,
    tendons: null,
    actuators: null,
    flexes: null,
    skins: null,
    materials: null,
    meshes: null,
    textures: null,
    bvh: null,
    extras: {},
  };
  const ensureFunc = (name) => {
    const fn = mod?.[name];
    if (typeof fn !== 'function') {
      throw new Error(`[forge] Missing export: ${name}`);
    }
    return fn;
  };
  const ngeom = ensureFunc('_mjwf_model_ngeom').call(mod, handle) | 0;
  if (ngeom > 0) {
    const sizeView = readView(mod, ensureFunc('_mjwf_model_geom_size_ptr'), handle, ngeom * 3, heapViewF64);
    const typeView = readView(mod, ensureFunc('_mjwf_model_geom_type_ptr'), handle, ngeom, heapViewI32);
    const matidView = readView(mod, ensureFunc('_mjwf_model_geom_matid_ptr'), handle, ngeom, heapViewI32);
    const bodyIdView = readView(mod, ensureFunc('_mjwf_model_geom_bodyid_ptr'), handle, ngeom, heapViewI32);
    const dataIdView = readView(mod, ensureFunc('_mjwf_model_geom_dataid_ptr'), handle, ngeom, heapViewI32);
    const groupView = readView(mod, ensureFunc('_mjwf_model_geom_group_ptr'), handle, ngeom, heapViewI32);
    const rgbaView = readView(mod, ensureFunc('_mjwf_model_geom_rgba_ptr'), handle, ngeom * 4, heapViewF32);
    assets.geoms = {
      count: ngeom,
      size: cloneTyped(sizeView, Float64Array),
      type: cloneTyped(typeView, Int32Array),
      matid: cloneTyped(matidView, Int32Array),
      bodyid: cloneTyped(bodyIdView, Int32Array),
      dataid: cloneTyped(dataIdView, Int32Array),
      group: cloneTyped(groupView, Int32Array),
      rgba: cloneTyped(rgbaView, Float32Array),
    };
  }
  const nsite = ensureFunc('_mjwf_model_nsite').call(mod, handle) | 0;
  if (nsite > 0) {
    const sizeFn = ensureFunc('_mjwf_model_site_size_ptr');
    const typeFn = ensureFunc('_mjwf_model_site_type_ptr');
    const matidFn = ensureFunc('_mjwf_model_site_matid_ptr');
    const bodyIdFn = ensureFunc('_mjwf_model_site_bodyid_ptr');
    const groupFn = ensureFunc('_mjwf_model_site_group_ptr');
    const rgbaFn = ensureFunc('_mjwf_model_site_rgba_ptr');
    const sizeView = readView(mod, sizeFn, handle, nsite * 3, heapViewF64);
    const typeView = readView(mod, typeFn, handle, nsite, heapViewI32);
    const matidView = readView(mod, matidFn, handle, nsite, heapViewI32);
    const bodyIdView = readView(mod, bodyIdFn, handle, nsite, heapViewI32);
    const groupView = readView(mod, groupFn, handle, nsite, heapViewI32);
    const rgbaView = readView(mod, rgbaFn, handle, nsite * 4, heapViewF32);
    assets.sites = {
      count: nsite,
      size: cloneTyped(sizeView, Float64Array),
      type: cloneTyped(typeView, Int32Array),
      matid: cloneTyped(matidView, Int32Array),
      bodyid: cloneTyped(bodyIdView, Int32Array),
      group: cloneTyped(groupView, Int32Array),
      rgba: cloneTyped(rgbaView, Float32Array),
    };
  }
  const ntendon = ensureFunc('_mjwf_model_ntendon').call(mod, handle) | 0;
  if (ntendon > 0) {
    const nwrap = ensureFunc('_mjwf_model_nwrap').call(mod, handle) | 0;
    const widthFn = ensureFunc('_mjwf_model_tendon_width_ptr');
    const matidFn = ensureFunc('_mjwf_model_tendon_matid_ptr');
    const groupFn = ensureFunc('_mjwf_model_tendon_group_ptr');
    const rgbaFn = ensureFunc('_mjwf_model_tendon_rgba_ptr');
    const widthView = readView(mod, widthFn, handle, ntendon, heapViewF64);
    const matidView = readView(mod, matidFn, handle, ntendon, heapViewI32);
    const groupView = readView(mod, groupFn, handle, ntendon, heapViewI32);
    const rgbaView = readView(mod, rgbaFn, handle, ntendon * 4, heapViewF32);
    const numView = readView(mod, ensureFunc('_mjwf_model_tendon_num_ptr'), handle, ntendon, heapViewI32);
    const limitedView = readView(mod, ensureFunc('_mjwf_model_tendon_limited_ptr'), handle, ntendon, heapViewU8);
    const stiffnessView = readView(mod, ensureFunc('_mjwf_model_tendon_stiffness_ptr'), handle, ntendon, heapViewF64);
    const dampingView = readView(mod, ensureFunc('_mjwf_model_tendon_damping_ptr'), handle, ntendon, heapViewF64);
    const frictionlossView = readView(mod, ensureFunc('_mjwf_model_tendon_frictionloss_ptr'), handle, ntendon, heapViewF64);
    const rangeView = readView(mod, ensureFunc('_mjwf_model_tendon_range_ptr'), handle, ntendon * 2, heapViewF64);
    const lengthspringView = readView(mod, ensureFunc('_mjwf_model_tendon_lengthspring_ptr'), handle, ntendon * 2, heapViewF64);
    assets.tendons = {
      count: ntendon,
      nwrap,
      width: cloneTyped(widthView, Float64Array),
      matid: cloneTyped(matidView, Int32Array),
      group: cloneTyped(groupView, Int32Array),
      rgba: cloneTyped(rgbaView, Float32Array),
      num: cloneTyped(numView, Int32Array),
      limited: cloneTyped(limitedView, Uint8Array),
      stiffness: cloneTyped(stiffnessView, Float64Array),
      damping: cloneTyped(dampingView, Float64Array),
      frictionloss: cloneTyped(frictionlossView, Float64Array),
      range: cloneTyped(rangeView, Float64Array),
      lengthspring: cloneTyped(lengthspringView, Float64Array),
    };
  }
  const nbody = ensureFunc('_mjwf_model_nbody').call(mod, handle) | 0;
  if (nbody > 0) {
    const weldidView = readView(mod, ensureFunc('_mjwf_model_body_weldid_ptr'), handle, nbody, heapViewI32);
    const mocapidView = readView(mod, ensureFunc('_mjwf_model_body_mocapid_ptr'), handle, nbody, heapViewI32);
    const parentidView = readView(mod, ensureFunc('_mjwf_model_body_parentid_ptr'), handle, nbody, heapViewI32);
    const jntadrView = readView(mod, ensureFunc('_mjwf_model_body_jntadr_ptr'), handle, nbody, heapViewI32);
    const jntnumView = readView(mod, ensureFunc('_mjwf_model_body_jntnum_ptr'), handle, nbody, heapViewI32);
    const dofadrView = readView(mod, ensureFunc('_mjwf_model_body_dofadr_ptr'), handle, nbody, heapViewI32);
    const dofnumView = readView(mod, ensureFunc('_mjwf_model_body_dofnum_ptr'), handle, nbody, heapViewI32);
    const massView = readView(mod, ensureFunc('_mjwf_model_body_mass_ptr'), handle, nbody, heapViewF64);
    const inertiaView = readView(mod, ensureFunc('_mjwf_model_body_inertia_ptr'), handle, nbody * 3, heapViewF64);
    assets.bodies = {
      count: nbody,
      weldid: cloneTyped(weldidView, Int32Array),
      mocapid: cloneTyped(mocapidView, Int32Array),
      parentid: cloneTyped(parentidView, Int32Array),
      jntadr: cloneTyped(jntadrView, Int32Array),
      jntnum: cloneTyped(jntnumView, Int32Array),
      dofadr: cloneTyped(dofadrView, Int32Array),
      dofnum: cloneTyped(dofnumView, Int32Array),
      mass: cloneTyped(massView, Float64Array),
      inertia: cloneTyped(inertiaView, Float64Array),
    };
  }
  const nsensor = ensureFunc('_mjwf_model_nsensor').call(mod, handle) | 0;
  if (nsensor > 0) {
    const typeView = readView(mod, ensureFunc('_mjwf_model_sensor_type_ptr'), handle, nsensor, heapViewI32);
    const objidView = readView(mod, ensureFunc('_mjwf_model_sensor_objid_ptr'), handle, nsensor, heapViewI32);
    const refidView = readView(mod, ensureFunc('_mjwf_model_sensor_refid_ptr'), handle, nsensor, heapViewI32);
    const dimView = readView(mod, ensureFunc('_mjwf_model_sensor_dim_ptr'), handle, nsensor, heapViewI32);
    const adrView = readView(mod, ensureFunc('_mjwf_model_sensor_adr_ptr'), handle, nsensor, heapViewI32);
    assets.sensors = {
      count: nsensor,
      type: cloneTyped(typeView, Int32Array),
      objid: cloneTyped(objidView, Int32Array),
      refid: cloneTyped(refidView, Int32Array),
      dim: cloneTyped(dimView, Int32Array),
      adr: cloneTyped(adrView, Int32Array),
    };
  }
  const nu = ensureFunc('_mjwf_model_nu').call(mod, handle) | 0;
  if (nu > 0) {
    const trnidView = readView(mod, ensureFunc('_mjwf_model_actuator_trnid_ptr'), handle, nu * 2, heapViewI32);
    const trntypeView = readView(mod, ensureFunc('_mjwf_model_actuator_trntype_ptr'), handle, nu, heapViewI32);
    const cranklengthView = readView(mod, ensureFunc('_mjwf_model_actuator_cranklength_ptr'), handle, nu, heapViewF64);
    assets.actuators = {
      count: nu,
      trnid: cloneTyped(trnidView, Int32Array),
      trntype: cloneTyped(trntypeView, Int32Array),
      cranklength: cloneTyped(cranklengthView, Float64Array),
    };
  }
  const nflex = ensureFunc('_mjwf_model_nflex').call(mod, handle) | 0;
  if (nflex > 0) {
    const nflexvert = ensureFunc('_mjwf_model_nflexvert').call(mod, handle) | 0;
    const nflexedge = ensureFunc('_mjwf_model_nflexedge').call(mod, handle) | 0;
    const nflexelem = ensureFunc('_mjwf_model_nflexelem').call(mod, handle) | 0;
    const nflexelemdata = ensureFunc('_mjwf_model_nflexelemdata').call(mod, handle) | 0;
    const nflexshelldata = ensureFunc('_mjwf_model_nflexshelldata').call(mod, handle) | 0;

    const dimView = readView(mod, ensureFunc('_mjwf_model_flex_dim_ptr'), handle, nflex, heapViewI32);
    const radiusView = readView(mod, ensureFunc('_mjwf_model_flex_radius_ptr'), handle, nflex, heapViewF64);
    const matidView = readView(mod, ensureFunc('_mjwf_model_flex_matid_ptr'), handle, nflex, heapViewI32);
    const groupView = readView(mod, ensureFunc('_mjwf_model_flex_group_ptr'), handle, nflex, heapViewI32);
    const rgbaView = readView(mod, ensureFunc('_mjwf_model_flex_rgba_ptr'), handle, nflex * 4, heapViewF32);
    const flatskinView = readView(mod, ensureFunc('_mjwf_model_flex_flatskin_ptr'), handle, nflex, heapViewU8);
    const vertAdrView = readView(mod, ensureFunc('_mjwf_model_flex_vertadr_ptr'), handle, nflex, heapViewI32);
    const vertNumView = readView(mod, ensureFunc('_mjwf_model_flex_vertnum_ptr'), handle, nflex, heapViewI32);
    const edgeAdrView = readView(mod, ensureFunc('_mjwf_model_flex_edgeadr_ptr'), handle, nflex, heapViewI32);
    const edgeNumView = readView(mod, ensureFunc('_mjwf_model_flex_edgenum_ptr'), handle, nflex, heapViewI32);
    const elemAdrView = readView(mod, ensureFunc('_mjwf_model_flex_elemadr_ptr'), handle, nflex, heapViewI32);
    const elemNumView = readView(mod, ensureFunc('_mjwf_model_flex_elemnum_ptr'), handle, nflex, heapViewI32);
    const elemdataAdrView = readView(mod, ensureFunc('_mjwf_model_flex_elemdataadr_ptr'), handle, nflex, heapViewI32);
    const shellNumView = readView(mod, ensureFunc('_mjwf_model_flex_shellnum_ptr'), handle, nflex, heapViewI32);
    const shelldataAdrView = readView(mod, ensureFunc('_mjwf_model_flex_shelldataadr_ptr'), handle, nflex, heapViewI32);
    const nflextexcoord = ensureFunc('_mjwf_model_nflextexcoord').call(mod, handle) | 0;
    const texcoordAdrView = readView(mod, ensureFunc('_mjwf_model_flex_texcoordadr_ptr'), handle, nflex, heapViewI32);
    const texcoordView = readView(
      mod,
      ensureFunc('_mjwf_model_flex_texcoord_ptr'),
      handle,
      nflextexcoord * 2,
      heapViewF32,
    );
    const elemTexcoordView = readView(
      mod,
      ensureFunc('_mjwf_model_flex_elemtexcoord_ptr'),
      handle,
      nflexelemdata,
      heapViewI32,
    );

    const edgeView = readView(
      mod,
      ensureFunc('_mjwf_model_flex_edge_ptr'),
      handle,
      nflexedge * 2,
      heapViewI32,
    );
    const elemView = readView(
      mod,
      ensureFunc('_mjwf_model_flex_elem_ptr'),
      handle,
      nflexelemdata,
      heapViewI32,
    );
    const elemlayerView = readView(
      mod,
      ensureFunc('_mjwf_model_flex_elemlayer_ptr'),
      handle,
      nflexelem,
      heapViewI32,
    );
    const shellView = readView(
      mod,
      ensureFunc('_mjwf_model_flex_shell_ptr'),
      handle,
      nflexshelldata,
      heapViewI32,
    );

    assets.flexes = {
      count: nflex,
      nflexvert,
      nflexedge,
      nflexelem,
      nflexelemdata,
      nflexshelldata,
      dim: cloneTyped(dimView, Int32Array),
      radius: cloneTyped(radiusView, Float64Array),
      matid: cloneTyped(matidView, Int32Array),
      group: cloneTyped(groupView, Int32Array),
      rgba: cloneTyped(rgbaView, Float32Array),
      flatskin: cloneTyped(flatskinView, Uint8Array),
      vertadr: cloneTyped(vertAdrView, Int32Array),
      vertnum: cloneTyped(vertNumView, Int32Array),
      edgeadr: cloneTyped(edgeAdrView, Int32Array),
      edgenum: cloneTyped(edgeNumView, Int32Array),
      elemadr: cloneTyped(elemAdrView, Int32Array),
      elemnum: cloneTyped(elemNumView, Int32Array),
      elemdataadr: cloneTyped(elemdataAdrView, Int32Array),
      shellnum: cloneTyped(shellNumView, Int32Array),
      shelldataadr: cloneTyped(shelldataAdrView, Int32Array),
      texcoordadr: cloneTyped(texcoordAdrView, Int32Array),
      texcoord: cloneTyped(texcoordView, Float32Array),
      elemtexcoord: cloneTyped(elemTexcoordView, Int32Array),
      nflextexcoord,
      edge: cloneTyped(edgeView, Int32Array),
      elem: cloneTyped(elemView, Int32Array),
      elemlayer: cloneTyped(elemlayerView, Int32Array),
      shell: cloneTyped(shellView, Int32Array),
    };
  }
  const nskin = ensureFunc('_mjwf_model_nskin').call(mod, handle) | 0;
  if (nskin > 0) {
    const nskinvert = ensureFunc('_mjwf_model_nskinvert').call(mod, handle) | 0;
    const nskinface = ensureFunc('_mjwf_model_nskinface').call(mod, handle) | 0;
    const nskinbone = ensureFunc('_mjwf_model_nskinbone').call(mod, handle) | 0;
    const nskinbonevert = ensureFunc('_mjwf_model_nskinbonevert').call(mod, handle) | 0;

    const matidView = readView(mod, ensureFunc('_mjwf_model_skin_matid_ptr'), handle, nskin, heapViewI32);
    const groupView = readView(mod, ensureFunc('_mjwf_model_skin_group_ptr'), handle, nskin, heapViewI32);
    const rgbaView = readView(mod, ensureFunc('_mjwf_model_skin_rgba_ptr'), handle, nskin * 4, heapViewF32);
    const inflateView = readView(mod, ensureFunc('_mjwf_model_skin_inflate_ptr'), handle, nskin, heapViewF32);
    const vertAdrView = readView(mod, ensureFunc('_mjwf_model_skin_vertadr_ptr'), handle, nskin, heapViewI32);
    const vertNumView = readView(mod, ensureFunc('_mjwf_model_skin_vertnum_ptr'), handle, nskin, heapViewI32);
    const faceAdrView = readView(mod, ensureFunc('_mjwf_model_skin_faceadr_ptr'), handle, nskin, heapViewI32);
    const faceNumView = readView(mod, ensureFunc('_mjwf_model_skin_facenum_ptr'), handle, nskin, heapViewI32);
    const boneAdrView = readView(mod, ensureFunc('_mjwf_model_skin_boneadr_ptr'), handle, nskin, heapViewI32);
    const boneNumView = readView(mod, ensureFunc('_mjwf_model_skin_bonenum_ptr'), handle, nskin, heapViewI32);
    const nskintexvert = ensureFunc('_mjwf_model_nskintexvert').call(mod, handle) | 0;
    const skinTexcoordAdrView = readView(
      mod,
      ensureFunc('_mjwf_model_skin_texcoordadr_ptr'),
      handle,
      nskin,
      heapViewI32,
    );
    const skinTexcoordView = readView(
      mod,
      ensureFunc('_mjwf_model_skin_texcoord_ptr'),
      handle,
      nskintexvert * 2,
      heapViewF32,
    );

    const vertView = readView(
      mod,
      ensureFunc('_mjwf_model_skin_vert_ptr'),
      handle,
      nskinvert * 3,
      heapViewF32,
    );
    const faceView = readView(
      mod,
      ensureFunc('_mjwf_model_skin_face_ptr'),
      handle,
      nskinface * 3,
      heapViewI32,
    );

    const boneVertAdrView = readView(
      mod,
      ensureFunc('_mjwf_model_skin_bonevertadr_ptr'),
      handle,
      nskinbone,
      heapViewI32,
    );
    const boneVertNumView = readView(
      mod,
      ensureFunc('_mjwf_model_skin_bonevertnum_ptr'),
      handle,
      nskinbone,
      heapViewI32,
    );
    const boneBindPosView = readView(
      mod,
      ensureFunc('_mjwf_model_skin_bonebindpos_ptr'),
      handle,
      nskinbone * 3,
      heapViewF32,
    );
    const boneBindQuatView = readView(
      mod,
      ensureFunc('_mjwf_model_skin_bonebindquat_ptr'),
      handle,
      nskinbone * 4,
      heapViewF32,
    );
    const boneBodyIdView = readView(
      mod,
      ensureFunc('_mjwf_model_skin_bonebodyid_ptr'),
      handle,
      nskinbone,
      heapViewI32,
    );
    const boneVertIdView = readView(
      mod,
      ensureFunc('_mjwf_model_skin_bonevertid_ptr'),
      handle,
      nskinbonevert,
      heapViewI32,
    );
    const boneVertWeightView = readView(
      mod,
      ensureFunc('_mjwf_model_skin_bonevertweight_ptr'),
      handle,
      nskinbonevert,
      heapViewF32,
    );

    assets.skins = {
      count: nskin,
      nskinvert,
      nskinface,
      nskinbone,
      nskinbonevert,
      matid: cloneTyped(matidView, Int32Array),
      group: cloneTyped(groupView, Int32Array),
      rgba: cloneTyped(rgbaView, Float32Array),
      inflate: cloneTyped(inflateView, Float32Array),
      vertadr: cloneTyped(vertAdrView, Int32Array),
      vertnum: cloneTyped(vertNumView, Int32Array),
      faceadr: cloneTyped(faceAdrView, Int32Array),
      facenum: cloneTyped(faceNumView, Int32Array),
      boneadr: cloneTyped(boneAdrView, Int32Array),
      bonenum: cloneTyped(boneNumView, Int32Array),
      vert: cloneTyped(vertView, Float32Array),
      face: cloneTyped(faceView, Int32Array),
      bonevertadr: cloneTyped(boneVertAdrView, Int32Array),
      bonevertnum: cloneTyped(boneVertNumView, Int32Array),
      bonebindpos: cloneTyped(boneBindPosView, Float32Array),
      bonebindquat: cloneTyped(boneBindQuatView, Float32Array),
      bonebodyid: cloneTyped(boneBodyIdView, Int32Array),
      bonevertid: cloneTyped(boneVertIdView, Int32Array),
      bonevertweight: cloneTyped(boneVertWeightView, Float32Array),
      texcoordadr: cloneTyped(skinTexcoordAdrView, Int32Array),
      texcoord: cloneTyped(skinTexcoordView, Float32Array),
      nskintexvert,
    };
  }
  const nmat = ensureFunc('_mjwf_model_nmat').call(mod, handle) | 0;
  if (nmat > 0) {
    const rgbaView = readView(mod, ensureFunc('_mjwf_model_mat_rgba_ptr'), handle, nmat * 4, heapViewF32);
    const reflectanceView = readView(mod, ensureFunc('_mjwf_model_mat_reflectance_ptr'), handle, nmat, heapViewF64);
    const emissionView = readView(mod, ensureFunc('_mjwf_model_mat_emission_ptr'), handle, nmat, heapViewF64);
    const specularView = readView(mod, ensureFunc('_mjwf_model_mat_specular_ptr'), handle, nmat, heapViewF64);
    const shininessView = readView(mod, ensureFunc('_mjwf_model_mat_shininess_ptr'), handle, nmat, heapViewF64);
    const metallicView = readView(mod, ensureFunc('_mjwf_model_mat_metallic_ptr'), handle, nmat, heapViewF64);
    const roughnessView = readView(mod, ensureFunc('_mjwf_model_mat_roughness_ptr'), handle, nmat, heapViewF64);
    // mjModel.mat_texid is (nmat x mjNTEXROLE). Simulate uses mjTEXROLE_RGB for
    // regular textures, so we need all roles.
    const texidView = readView(mod, ensureFunc('_mjwf_model_mat_texid_ptr'), handle, nmat * 10, heapViewI32);
    const texrepeatView = readView(mod, ensureFunc('_mjwf_model_mat_texrepeat_ptr'), handle, nmat * 2, heapViewF64);
    const texuniformView = readView(mod, ensureFunc('_mjwf_model_mat_texuniform_ptr'), handle, nmat, heapViewI32);
    assets.materials = {
      count: nmat,
      rgba: cloneTyped(rgbaView, Float32Array),
      reflectance: cloneTyped(reflectanceView, Float64Array),
      emission: cloneTyped(emissionView, Float64Array),
      specular: cloneTyped(specularView, Float64Array),
      shininess: cloneTyped(shininessView, Float64Array),
      metallic: cloneTyped(metallicView, Float64Array),
      roughness: cloneTyped(roughnessView, Float64Array),
      texid: cloneTyped(texidView, Int32Array),
      texrepeat: cloneTyped(texrepeatView, Float64Array),
      texuniform: cloneTyped(texuniformView, Int32Array),
    };
  }
  const nmesh = ensureFunc('_mjwf_model_nmesh').call(mod, handle) | 0;
  if (nmesh > 0) {
    const vertAdr = readView(mod, ensureFunc('_mjwf_model_mesh_vertadr_ptr'), handle, nmesh, heapViewI32);
    const vertNum = readView(mod, ensureFunc('_mjwf_model_mesh_vertnum_ptr'), handle, nmesh, heapViewI32);
    const faceAdr = readView(mod, ensureFunc('_mjwf_model_mesh_faceadr_ptr'), handle, nmesh, heapViewI32);
    const faceNum = readView(mod, ensureFunc('_mjwf_model_mesh_facenum_ptr'), handle, nmesh, heapViewI32);
    const texCoordAdr = readView(
      mod,
      ensureFunc('_mjwf_model_mesh_texcoordadr_ptr'),
      handle,
      nmesh,
      heapViewI32,
    );
    const texCoordNum = readView(
      mod,
      ensureFunc('_mjwf_model_mesh_texcoordnum_ptr'),
      handle,
      nmesh,
      heapViewI32,
    );
    const vertCountFn = typeof mod._mjwf_mesh_vert_count === 'function' ? mod._mjwf_mesh_vert_count : null;
    const faceCountFn = typeof mod._mjwf_mesh_face_count === 'function' ? mod._mjwf_mesh_face_count : null;
    const texcoordCountFn = typeof mod._mjwf_mesh_texcoord_count === 'function' ? mod._mjwf_mesh_texcoord_count : null;
    let vertElemCount = 0;
    let faceElemCount = 0;
    let texcoordElemCount = 0;
    if (vertCountFn) {
      const v = vertCountFn.call(mod, handle) | 0;
      if (v > 0) vertElemCount = v * 3;
    }
    if (faceCountFn) {
      const f = faceCountFn.call(mod, handle) | 0;
      if (f > 0) faceElemCount = f * 3;
    }
    if (texcoordCountFn) {
      const t = texcoordCountFn.call(mod, handle) | 0;
      if (t > 0) texcoordElemCount = t * 2;
    }
    if (!(vertElemCount > 0) || !(faceElemCount > 0) || !(texcoordElemCount > 0)) {
      const counts = computeMeshElementCounts(
        vertAdr,
        vertNum,
        faceAdr,
        faceNum,
        texCoordAdr,
        texCoordNum,
      );
      if (!(vertElemCount > 0)) vertElemCount = counts.vert | 0;
      if (!(faceElemCount > 0)) faceElemCount = counts.face | 0;
      if (!(texcoordElemCount > 0)) texcoordElemCount = counts.texcoord | 0;
    }
    const vertView = readView(mod, ensureFunc('_mjwf_model_mesh_vert_ptr'), handle, Math.max(0, vertElemCount), heapViewF32);
    const faceView = readView(mod, ensureFunc('_mjwf_model_mesh_face_ptr'), handle, Math.max(0, faceElemCount), heapViewI32);
    const normalView = readView(
      mod,
      ensureFunc('_mjwf_model_mesh_normal_ptr'),
      handle,
      Math.max(0, vertElemCount),
      heapViewF32,
    );
    const texcoordView = readView(
      mod,
      ensureFunc('_mjwf_model_mesh_texcoord_ptr'),
      handle,
      Math.max(0, texcoordElemCount),
      heapViewF32,
    );
    const nmeshgraph = ensureFunc('_mjwf_model_nmeshgraph').call(mod, handle) | 0;
    const graphAdrView = readView(
      mod,
      ensureFunc('_mjwf_model_mesh_graphadr_ptr'),
      handle,
      nmesh,
      heapViewI32,
    );
    const graphView = readView(
      mod,
      ensureFunc('_mjwf_model_mesh_graph_ptr'),
      handle,
      nmeshgraph,
      heapViewI32,
    );
    const nmeshpoly = ensureFunc('_mjwf_model_nmeshpoly').call(mod, handle) | 0;
    const nmeshpolyvert = ensureFunc('_mjwf_model_nmeshpolyvert').call(mod, handle) | 0;
    const polyNumView = readView(
      mod,
      ensureFunc('_mjwf_model_mesh_polynum_ptr'),
      handle,
      nmesh,
      heapViewI32,
    );
    const polyAdrView = readView(
      mod,
      ensureFunc('_mjwf_model_mesh_polyadr_ptr'),
      handle,
      nmesh,
      heapViewI32,
    );
    const polyNormalView = readView(
      mod,
      ensureFunc('_mjwf_model_mesh_polynormal_ptr'),
      handle,
      nmeshpoly * 3,
      heapViewF64,
    );
    const polyVertAdrView = readView(
      mod,
      ensureFunc('_mjwf_model_mesh_polyvertadr_ptr'),
      handle,
      nmeshpoly,
      heapViewI32,
    );
    const polyVertNumView = readView(
      mod,
      ensureFunc('_mjwf_model_mesh_polyvertnum_ptr'),
      handle,
      nmeshpoly,
      heapViewI32,
    );
    const polyVertView = readView(
      mod,
      ensureFunc('_mjwf_model_mesh_polyvert_ptr'),
      handle,
      nmeshpolyvert,
      heapViewI32,
    );
    assets.meshes = {
      count: nmesh,
      nmeshgraph,
      nmeshpoly,
      nmeshpolyvert,
      vertadr: cloneTyped(vertAdr, Int32Array),
      vertnum: cloneTyped(vertNum, Int32Array),
      faceadr: cloneTyped(faceAdr, Int32Array),
      facenum: cloneTyped(faceNum, Int32Array),
      texcoordadr: cloneTyped(texCoordAdr, Int32Array),
      texcoordnum: cloneTyped(texCoordNum, Int32Array),
      vert: cloneTyped(vertView, Float32Array),
      face: cloneTyped(faceView, Int32Array),
      normal: cloneTyped(normalView, Float32Array),
      texcoord: cloneTyped(texcoordView, Float32Array),
      graphadr: cloneTyped(graphAdrView, Int32Array),
      graph: cloneTyped(graphView, Int32Array),
      polynum: cloneTyped(polyNumView, Int32Array),
      polyadr: cloneTyped(polyAdrView, Int32Array),
      polynormal: cloneTyped(polyNormalView, Float64Array),
      polyvertadr: cloneTyped(polyVertAdrView, Int32Array),
      polyvertnum: cloneTyped(polyVertNumView, Int32Array),
      polyvert: cloneTyped(polyVertView, Int32Array),
    };
  }
  const nbvh = ensureFunc('_mjwf_model_nbvh').call(mod, handle) | 0;
  if (nbvh > 0) {
    const nbvhstatic = ensureFunc('_mjwf_model_nbvhstatic').call(mod, handle) | 0;
    const nbvhdynamic = ensureFunc('_mjwf_model_nbvhdynamic').call(mod, handle) | 0;
    const bvhAabbView = readView(mod, ensureFunc('_mjwf_model_bvh_aabb_ptr'), handle, nbvh * 6, heapViewF64);
    const bvhChildView = readView(mod, ensureFunc('_mjwf_model_bvh_child_ptr'), handle, nbvh * 2, heapViewI32);
    const bvhDepthView = readView(mod, ensureFunc('_mjwf_model_bvh_depth_ptr'), handle, nbvh, heapViewI32);
    const bvhNodeIdView = readView(mod, ensureFunc('_mjwf_model_bvh_nodeid_ptr'), handle, nbvh, heapViewI32);
    const geomAabbView = ngeom > 0
      ? readView(mod, ensureFunc('_mjwf_model_geom_aabb_ptr'), handle, ngeom * 6, heapViewF64)
      : null;
    const bodyBvhAdrView = nbody > 0
      ? readView(mod, ensureFunc('_mjwf_model_body_bvhadr_ptr'), handle, nbody, heapViewI32)
      : null;
    const bodyBvhNumView = nbody > 0
      ? readView(mod, ensureFunc('_mjwf_model_body_bvhnum_ptr'), handle, nbody, heapViewI32)
      : null;
    const flexCount = assets.flexes?.count | 0;
    const flexBvhAdrView = flexCount > 0
      ? readView(mod, ensureFunc('_mjwf_model_flex_bvhadr_ptr'), handle, flexCount, heapViewI32)
      : null;
    const flexBvhNumView = flexCount > 0
      ? readView(mod, ensureFunc('_mjwf_model_flex_bvhnum_ptr'), handle, flexCount, heapViewI32)
      : null;
    const meshBvhAdrView = nmesh > 0
      ? readView(mod, ensureFunc('_mjwf_model_mesh_bvhadr_ptr'), handle, nmesh, heapViewI32)
      : null;
    const meshBvhNumView = nmesh > 0
      ? readView(mod, ensureFunc('_mjwf_model_mesh_bvhnum_ptr'), handle, nmesh, heapViewI32)
      : null;
    const meshOctAdrView = nmesh > 0
      ? readView(mod, ensureFunc('_mjwf_model_mesh_octadr_ptr'), handle, nmesh, heapViewI32)
      : null;
    const meshOctNumView = nmesh > 0
      ? readView(mod, ensureFunc('_mjwf_model_mesh_octnum_ptr'), handle, nmesh, heapViewI32)
      : null;
    const noct = ensureFunc('_mjwf_model_noct').call(mod, handle) | 0;
    const octDepthView = noct > 0
      ? readView(mod, ensureFunc('_mjwf_model_oct_depth_ptr'), handle, noct, heapViewI32)
      : null;
    const octAabbView = noct > 0
      ? readView(mod, ensureFunc('_mjwf_model_oct_aabb_ptr'), handle, noct * 6, heapViewF64)
      : null;
    assets.bvh = {
      count: nbvh,
      nbvhstatic,
      nbvhdynamic,
      aabb: cloneTyped(bvhAabbView, Float64Array),
      child: cloneTyped(bvhChildView, Int32Array),
      depth: cloneTyped(bvhDepthView, Int32Array),
      nodeid: cloneTyped(bvhNodeIdView, Int32Array),
      geom_aabb: cloneTyped(geomAabbView, Float64Array),
      body_bvhadr: cloneTyped(bodyBvhAdrView, Int32Array),
      body_bvhnum: cloneTyped(bodyBvhNumView, Int32Array),
      flex_bvhadr: cloneTyped(flexBvhAdrView, Int32Array),
      flex_bvhnum: cloneTyped(flexBvhNumView, Int32Array),
      mesh_bvhadr: cloneTyped(meshBvhAdrView, Int32Array),
      mesh_bvhnum: cloneTyped(meshBvhNumView, Int32Array),
      mesh_octadr: cloneTyped(meshOctAdrView, Int32Array),
      mesh_octnum: cloneTyped(meshOctNumView, Int32Array),
      noct,
      oct_depth: cloneTyped(octDepthView, Int32Array),
      oct_aabb: cloneTyped(octAabbView, Float64Array),
    };
  }
  const ntex = ensureFunc('_mjwf_model_ntex').call(mod, handle) | 0;
  if (ntex > 0) {
    const texTypeView = readView(mod, ensureFunc('_mjwf_model_tex_type_ptr'), handle, ntex, heapViewI32);
    const texWidthView = readView(mod, ensureFunc('_mjwf_model_tex_width_ptr'), handle, ntex, heapViewI32);
    const texHeightView = readView(mod, ensureFunc('_mjwf_model_tex_height_ptr'), handle, ntex, heapViewI32);
    const texNChannelView = readView(mod, ensureFunc('_mjwf_model_tex_nchannel_ptr'), handle, ntex, heapViewI32);
    const texAdrView = readView(mod, ensureFunc('_mjwf_model_tex_adr_ptr'), handle, ntex, heapViewI32);
    const texColorspaceView = readView(mod, ensureFunc('_mjwf_model_tex_colorspace_ptr'), handle, ntex, heapViewI32);
    const dataLen = ensureFunc('_mjwf_model_ntexdata').call(mod, handle) | 0;
    const dataPtr = ensureFunc('_mjwf_model_tex_data_ptr').call(mod, handle) | 0;
    const texData = (dataLen > 0 && dataPtr > 0) ? heapViewU8(mod, dataPtr, dataLen) : null;
    assets.textures = {
      count: ntex,
      type: cloneTyped(texTypeView, Int32Array),
      width: cloneTyped(texWidthView, Int32Array),
      height: cloneTyped(texHeightView, Int32Array),
      nchannel: cloneTyped(texNChannelView, Int32Array),
      adr: cloneTyped(texAdrView, Int32Array),
      colorspace: cloneTyped(texColorspaceView, Int32Array),
      data: cloneTyped(texData, Uint8Array),
    };
  }
  return assets;
}

export class MjSimLite {
  constructor(mod) {
    this.mod = mod;
    this.modId = tagForgeModule(mod);
    this.h = 0;
    this.contactForceScratch = null;
    const heapBuf = resolveHeapBuffer(mod);
    if (heapBuf) {
      mod.__heapBuffer = heapBuf;
    }
    if (typeof window !== 'undefined') {
      try {
        window.__forgeModules = window.__forgeModules || [];
        if (!window.__forgeModules.includes(mod)) {
          window.__forgeModules.push(mod);
        }
        window.__forgeModule = mod;
      } catch {}
    }
  }

  async maybeInstallShimFromQuery() {
    // Shim injection is no longer supported; keep as a no-op placeholder.
  }

  // Helpers
  _cstr(ptr){
    return readCString(this.mod, ptr);
  }

  _mkdirTree(path){
    try { if (!path) return; const FS=this.mod.FS; const parts = String(path).split('/').filter(Boolean); let cur='';
      for (const p of parts){ cur += '/' + p; try { FS.mkdir(cur); } catch {} }
    } catch {}
  }

  _tryHelperMakeFromXml(paths){
    const m = this.mod;
    if (!m) return 0;
    const list = Array.isArray(paths) ? paths : [paths];
    if (typeof m.ccall === 'function') {
      for (const target of list) {
        if (!target) continue;
        const h = m.ccall(
          'mjwf_helper_make_from_xml',
          'number',
          ['string'],
          [String(target)],
        ) | 0;
        if (h > 0) return h;
      }
      return 0;
    }
    const helper = m._mjwf_helper_make_from_xml;
    if (typeof helper !== 'function') {
      throw new Error('Required mjwf helper missing: mjwf_helper_make_from_xml');
    }
    if (
      typeof m.lengthBytesUTF8 === 'function' &&
      typeof m.stringToUTF8 === 'function' &&
      typeof m._malloc === 'function' &&
      typeof m._free === 'function'
    ) {
      for (const target of list) {
        if (!target) continue;
        const text = String(target);
        const bytes = (m.lengthBytesUTF8(text) | 0) + 1;
        const ptr = m._malloc(bytes) | 0;
        if (!(ptr > 0)) {
          throw new Error('Failed to allocate C-string for XML path');
        }
        try {
          m.stringToUTF8(text, ptr, bytes);
          const h = helper.call(m, ptr) | 0;
          if (h > 0) return h;
        } finally {
          m._free(ptr);
        }
      }
      return 0;
    }
    const encoder = new TextEncoder();
    for (const target of list) {
      if (!target) continue;
      const encoded = encoder.encode(String(target));
      const bytes = encoded.length + 1;
      const h = this._withStack(bytes, (ptr) => {
        const buffer = resolveHeapBuffer(m);
        if (!(buffer instanceof ArrayBuffer)) {
          throw new Error('WASM heap unavailable');
        }
        const heap = new Uint8Array(buffer);
        heap.set(encoded, ptr);
        heap[ptr + encoded.length] = 0;
        return helper.call(m, ptr) | 0;
      });
      if (h == null) {
        throw new Error('Failed to allocate C-string for XML path');
      }
      if (h > 0) return h;
    }
    return 0;
  }

  _validateHandleOrThrow(h){
    const m = this.mod;
    if (!(h > 0)) {
      throw new Error('handle missing');
    }
    const fn = m._mjwf_helper_valid;
    if (typeof fn !== 'function') {
      throw new Error('Required mjwf helper missing: mjwf_helper_valid');
    }
    const ok = fn.call(m, h) | 0;
    if (ok !== 1) {
      const eno = typeof m._mjwf_helper_errno_last === 'function'
        ? (m._mjwf_helper_errno_last(h) | 0)
        : 0;
      const emsg = typeof m._mjwf_helper_errmsg_last === 'function'
        ? this._cstr(m._mjwf_helper_errmsg_last(h) | 0)
        : '';
      throw new Error(`handle invalid: eno=${eno} ${emsg}`);
    }
  }

  // Strict helper path: write XML to FS and call mjwf_helper_make_from_xml.
  initFromXmlStrict(xmlText){
    const m = this.mod;
    const required = [
      '_mjwf_helper_make_from_xml',
      '_mjwf_helper_free',
      '_mjwf_helper_model_ptr',
      '_mjwf_helper_data_ptr',
      '_mjwf_mj_step',
    ];
    const missing = required.filter((name) => typeof m?.[name] !== 'function');
    if (missing.length) {
      throw new Error(`Required mjwf functions missing: ${missing.join(', ')}`);
    }
    // FS path only: write XML to helper targets then call helper wrapper with PATH.
    const xmlStr = String(xmlText);
    const bytes = new TextEncoder().encode(xmlStr);
    const helperTargets = ['/mem/model.xml','/model.xml','model.xml'];
    for (const target of helperTargets) {
      if (target.includes('/')) {
        const dir = target.slice(0, target.lastIndexOf('/'));
        if (dir) this._mkdirTree(dir);
      }
      m.FS.writeFile(target, bytes);
    }
    const h = this._tryHelperMakeFromXml(helperTargets);
    if (!(h > 0)) {
      const eno = typeof m._mjwf_helper_errno_last_global === 'function'
        ? (m._mjwf_helper_errno_last_global() | 0)
        : 0;
      const emsg = typeof m._mjwf_helper_errmsg_last_global === 'function'
        ? this._cstr(m._mjwf_helper_errmsg_last_global() | 0)
        : '';
      logError('make_from_xml failed', { eno, emsg });
      throw new Error('make_from_xml failed');
    }
    this._validateHandleOrThrow(h);
    this.h = h;
  }

  ensurePointers(){
    const m = this.mod;
    if (!m || !(this.h > 0)) throw new Error('handle missing');
    if (!this.modelPtr){
      if (typeof m._mjwf_helper_model_ptr !== 'function') {
        throw new Error('Required mjwf helper missing: mjwf_helper_model_ptr');
      }
      this.modelPtr = m._mjwf_helper_model_ptr(this.h|0) | 0;
    }
    if (!this.dataPtr){
      if (typeof m._mjwf_helper_data_ptr !== 'function') {
        throw new Error('Required mjwf helper missing: mjwf_helper_data_ptr');
      }
      this.dataPtr = m._mjwf_helper_data_ptr(this.h|0) | 0;
    }
    if (!(this.modelPtr && this.dataPtr)) {
      throw new Error('helper pointers unavailable');
    }
    return { modelPtr: this.modelPtr, dataPtr: this.dataPtr };
  }

  // --- Basic counts ---
  nq(){ const m=this.mod; const h=this.h|0; const d=m['_mjwf_model_nq']; if (typeof d!=='function') return 0; return (d.call(m,h)|0)||0; }
  nv(){ const m=this.mod; const h=this.h|0; const d=m['_mjwf_model_nv']; if (typeof d!=='function') return 0; return (d.call(m,h)|0)||0; }
  nu(){ const m=this.mod; const h=this.h|0; const d=m['_mjwf_model_nu']; if (typeof d!=='function') return 0; return (d.call(m,h)|0)||0; }
  njnt(){ const m=this.mod; const h=this.h|0; const d=m._mjwf_model_njnt; if (typeof d==='function') return (d.call(m,h)|0)||0; return 0; }
  ncam(){ const m=this.mod; const h=this.h|0; const d=m._mjwf_model_ncam; if (typeof d==='function') return (d.call(m,h)|0)||0; return 0; }
  nlight(){ const m=this.mod; const h=this.h|0; const d=m._mjwf_model_nlight; if (typeof d==='function') return (d.call(m,h)|0)||0; return 0; }
  nsite(){ const m=this.mod; const h=this.h|0; const d=m._mjwf_model_nsite; if (typeof d==='function') return (d.call(m,h)|0)||0; return 0; }
  nflex(){ const m=this.mod; const h=this.h|0; const d=m['_mjwf_model_nflex']; if (typeof d!=='function') return 0; return (d.call(m,h)|0)||0; }
  nflexvert(){ const m=this.mod; const h=this.h|0; const d=m['_mjwf_model_nflexvert']; if (typeof d!=='function') return 0; return (d.call(m,h)|0)||0; }
  ntendon(){ const m=this.mod; const h=this.h|0; const d=m._mjwf_model_ntendon; if (typeof d!=='function') return 0; return (d.call(m,h)|0)||0; }
  nwrap(){ const m=this.mod; const h=this.h|0; const d=m._mjwf_model_nwrap; if (typeof d!=='function') return 0; return (d.call(m,h)|0)||0; }
  nsensor(){ const m=this.mod; const h=this.h|0; const d=m._mjwf_model_nsensor; if (typeof d==='function') return (d.call(m,h)|0)||0; return 0; }
  nsensordata(){ const m=this.mod; const h=this.h|0; const d=m._mjwf_model_nsensordata; if (typeof d==='function') return (d.call(m,h)|0)||0; return 0; }
  neq(){ const m=this.mod; const h=this.h|0; const d=m._mjwf_model_neq; if (typeof d==='function') return (d.call(m,h)|0)||0; return 0; }

  // --- State views ---
  qposView(){
    const m=this.mod; const h=this.h|0; const n=this.nq(); if(!n)return;
    const d=m._mjwf_data_qpos_ptr;
    if (typeof d!=='function') return;
    const p=d.call(m,h)|0; if(!p)return;
    return heapViewF64(m,p,n);
  }
  qvelView(){
    const m=this.mod; const h=this.h|0; const n=this.nv(); if(!n)return;
    const d=m._mjwf_data_qvel_ptr;
    if (typeof d!=='function') return;
    const p=d.call(m,h)|0; if(!p)return;
    return heapViewF64(m,p,n);
  }
  ctrlView(){
    const m=this.mod; const h=this.h|0; const n=this.nu(); if(!n)return;
    const d=m._mjwf_data_ctrl_ptr;
    if (typeof d!=='function') return;
    const p=d.call(m,h)|0; if(!p)return;
    return heapViewF64(m,p,n);
  }
  actuatorCtrlRangeView(){ const m=this.mod; const h=this.h|0; const n=this.nu(); if(!(n>0)) return; const d=m._mjwf_model_actuator_ctrlrange_ptr; if (typeof d!=='function') return; const p=d.call(m,h)|0; if(!p) return; return heapViewF64(m,p,n*2); }
  jntQposAdrView(){ const m=this.mod; const h=this.h|0; const d=m._mjwf_model_jnt_qposadr_ptr; if (typeof d!=='function') return; const nj=this.njnt()|0; if(!nj)return; const p=d.call(m,h)|0; if(!p)return; return heapViewI32(m,p,nj); }
  jntRangeView(){ const m=this.mod; const h=this.h|0; const d=m._mjwf_model_jnt_range_ptr; if (typeof d!=='function') return; const nj=this.njnt()|0; if(!nj)return; const p=d.call(m,h)|0; if(!p)return; return heapViewF64(m,p,nj*2); }
  jntTypeView(){ const m=this.mod; const h=this.h|0; const d=m._mjwf_model_jnt_type_ptr; if (typeof d!=='function') return; const nj=this.njnt()|0; if(!nj)return; const p=d.call(m,h)|0; if(!p)return; return heapViewI32(m,p,nj); }
  jntNameOf(i){
    return this._nameFromAdr(i, '_mjwf_model_name_jntadr_ptr', '_mjwf_model_njnt') || '';
  }
  jntPosView(){ const m=this.mod; const h=this.h|0; const d=m._mjwf_model_jnt_pos_ptr; if (typeof d!=='function') return; const nj=this.njnt()|0; if(!nj)return; const p=d.call(m,h)|0; if(!p)return; return heapViewF64(m,p,nj*3); }
  jntAxisView(){ const m=this.mod; const h=this.h|0; const d=m._mjwf_model_jnt_axis_ptr; if (typeof d!=='function') return; const nj=this.njnt()|0; if(!nj)return; const p=d.call(m,h)|0; if(!p)return; return heapViewF64(m,p,nj*3); }
  jntBodyIdView(){ const m=this.mod; const h=this.h|0; const d=m._mjwf_model_jnt_bodyid_ptr; if (typeof d!=='function') return; const nj=this.njnt()|0; if(!nj)return; const p=d.call(m,h)|0; if(!p)return; return heapViewI32(m,p,nj); }
  actuatorTrnidView(){ const m=this.mod; const h=this.h|0; const d=m._mjwf_model_actuator_trnid_ptr; if (typeof d!=='function') return; const n=this.nu()|0; if(!n)return; const p=d.call(m,h)|0; if(!p)return; return heapViewI32(m,p,n*2); }
  actuatorTrntypeView(){ const m=this.mod; const h=this.h|0; const d=m._mjwf_model_actuator_trntype_ptr; if (typeof d!=='function') return; const n=this.nu()|0; if(!n)return; const p=d.call(m,h)|0; if(!p)return; return heapViewI32(m,p,n); }
  actuatorCranklengthView(){ const m=this.mod; const h=this.h|0; const d=m._mjwf_model_actuator_cranklength_ptr; if (typeof d!=='function') return; const n=this.nu()|0; if(!n)return; const p=d.call(m,h)|0; if(!p)return; return heapViewF64(m,p,n); }
  siteXposView(){ const m=this.mod; const h=this.h|0; const n=this.nsite()|0; if(!n)return; const d=m._mjwf_data_site_xpos_ptr; if (typeof d!=='function') return; const p=d.call(m,h)|0; if(!p)return; return heapViewF64(m,p,n*3); }
  siteXmatView(){ const m=this.mod; const h=this.h|0; const n=this.nsite()|0; if(!n)return; const d=m._mjwf_data_site_xmat_ptr; if (typeof d!=='function') return; const p=d.call(m,h)|0; if(!p)return; return heapViewF64(m,p,n*9); }
  tenWrapAdrView(){ const m=this.mod; const h=this.h|0; const n=this.ntendon()|0; if(!(n>0)) return null; const d=m['_mjwf_data_ten_wrapadr_ptr']; if (typeof d!=='function') return null; const p=d.call(m,h)|0; if(!p) return null; return heapViewI32(m,p,n); }
  tenWrapNumView(){ const m=this.mod; const h=this.h|0; const n=this.ntendon()|0; if(!(n>0)) return null; const d=m['_mjwf_data_ten_wrapnum_ptr']; if (typeof d!=='function') return null; const p=d.call(m,h)|0; if(!p) return null; return heapViewI32(m,p,n); }
  wrapObjView(){ const m=this.mod; const h=this.h|0; const n=this.nwrap()|0; if(!(n>0)) return null; const d=m['_mjwf_data_wrap_obj_ptr']; if (typeof d!=='function') return null; const p=d.call(m,h)|0; if(!p) return null; return heapViewI32(m,p,n*2); }
  wrapXposView(){ const m=this.mod; const h=this.h|0; const n=this.nwrap()|0; if(!(n>0)) return null; const d=m['_mjwf_data_wrap_xpos_ptr']; if (typeof d!=='function') return null; const p=d.call(m,h)|0; if(!p) return null; return heapViewF64(m,p,n*6); }
  flexvertXposView(){ const m=this.mod; const h=this.h|0; const n=this.nflexvert()|0; if(!(n>0)) return null; const d=m['_mjwf_data_flexvert_xpos_ptr']; if (typeof d!=='function') return null; const p=d.call(m,h)|0; if(!p) return null; return heapViewF64(m,p,n*3); }
  sensorTypeView(){ const m=this.mod; const h=this.h|0; const n=this.nsensor()|0; if(!n)return; const d=m._mjwf_model_sensor_type_ptr; if (typeof d!=='function') return; const p=d.call(m,h)|0; if(!p)return; return heapViewI32(m,p,n); }
  sensorObjIdView(){ const m=this.mod; const h=this.h|0; const n=this.nsensor()|0; if(!n)return; const d=m._mjwf_model_sensor_objid_ptr; if (typeof d!=='function') return; const p=d.call(m,h)|0; if(!p)return; return heapViewI32(m,p,n); }
  eqTypeView(){ const m=this.mod; const h=this.h|0; const n=this.neq()|0; if(!n)return; const d=m._mjwf_model_eq_type_ptr; if (typeof d!=='function') return; const p=d.call(m,h)|0; if(!p)return; return heapViewI32(m,p,n); }
  eqObj1IdView(){ const m=this.mod; const h=this.h|0; const n=this.neq()|0; if(!n)return; const d=m._mjwf_model_eq_obj1id_ptr; if (typeof d!=='function') return; const p=d.call(m,h)|0; if(!p)return; return heapViewI32(m,p,n); }
  eqObj2IdView(){ const m=this.mod; const h=this.h|0; const n=this.neq()|0; if(!n)return; const d=m._mjwf_model_eq_obj2id_ptr; if (typeof d!=='function') return; const p=d.call(m,h)|0; if(!p)return; return heapViewI32(m,p,n); }
  eqObjTypeView(){ const m=this.mod; const h=this.h|0; const n=this.neq()|0; if(!n)return; const d=m._mjwf_model_eq_objtype_ptr; if (typeof d!=='function') return; const p=d.call(m,h)|0; if(!p)return; return heapViewI32(m,p,n); }
  eqDataView(){ const m=this.mod; const h=this.h|0; const n=this.neq()|0; if(!n)return; const d=m._mjwf_model_eq_data_ptr; if (typeof d!=='function') return; const p=d.call(m,h)|0; if(!p)return; return heapViewF64(m,p,n*11); }
  eqActiveView(){ const m=this.mod; const h=this.h|0; const n=this.neq()|0; if(!n)return; const d=m['_mjwf_data_eq_active_ptr']; if (typeof d!=='function') return; const p=d.call(m,h)|0; if(!p)return; return heapViewU8(m,p,n); }
  eqActive0View(){ const m=this.mod; const h=this.h|0; const n=this.neq()|0; if(!n)return; const d=m._mjwf_model_eq_active0_ptr; if (typeof d!=='function') return; const p=d.call(m,h)|0; if(!p)return; return heapViewU8(m,p,n); }
  id2name(objtype, objid){ const m=this.mod; const h=this.h|0; const fn = m['_mjwf_mj_id2name']; if (typeof fn!=='function') return ''; const p=fn.call(m,h, objtype|0, objid|0)|0; if(!p) return ''; return this._cstr(p); }
  camXposView(){ const m=this.mod; const h=this.h|0; const n=this.ncam(); if(!(n>0)) return; const d=m._mjwf_data_cam_xpos_ptr; if (typeof d!=='function') return; const p=d.call(m,h)|0; if(!p) return; return heapViewF64(m,p,n*3); }
  camXmatView(){ const m=this.mod; const h=this.h|0; const n=this.ncam(); if(!(n>0)) return; const d=m._mjwf_data_cam_xmat_ptr; if (typeof d!=='function') return; const p=d.call(m,h)|0; if(!p) return; return heapViewF64(m,p,n*9); }
  lightXposView(){ const m=this.mod; const h=this.h|0; const n=this.nlight(); if(!(n>0)) return; const d=m._mjwf_data_light_xpos_ptr; if (typeof d!=='function') return; const p=d.call(m,h)|0; if(!p) return; return heapViewF64(m,p,n*3); }
  lightXdirView(){ const m=this.mod; const h=this.h|0; const n=this.nlight(); if(!(n>0)) return; const d=m._mjwf_data_light_xdir_ptr; if (typeof d!=='function') return; const p=d.call(m,h)|0; if(!p) return; return heapViewF64(m,p,n*3); }
  stateSize(sig = MJ_STATE_INTEGRATION){
    const mod = this.mod;
    if (!mod) return 0;
    const fn = mod._mjwf_mj_stateSize;
    if (typeof fn !== 'function') return 0;
    const { modelPtr } = this.ensurePointers();
    return fn.call(mod, modelPtr | 0, sig >>> 0) | 0;
  }
  captureState(target = null, sig = MJ_STATE_INTEGRATION){
    const size = this.stateSize(sig);
    if (!(size > 0)) {
      return target instanceof Float64Array ? target : new Float64Array(0);
    }
    const out = target instanceof Float64Array && target.length >= size ? target : new Float64Array(size);
    const mod = this.mod;
    if (!mod) return out;
    const fn = mod._mjwf_mj_getState;
    if (typeof fn !== 'function') return out;
    const bytes = size * Float64Array.BYTES_PER_ELEMENT;
    this.ensurePointers();
    this._withStack(bytes, (ptr) => {
      const view = heapViewF64(mod, ptr, size);
      fn.call(mod, this.modelPtr | 0, this.dataPtr | 0, ptr | 0, sig >>> 0);
      out.set(view);
    });
    return out;
  }
  applyState(source, sig = MJ_STATE_INTEGRATION){
    if (!source) return false;
    const mod = this.mod;
    if (!mod) return false;
    const fn = mod._mjwf_mj_setState;
    if (typeof fn !== 'function') return false;
    const ary = source instanceof Float64Array ? source : Float64Array.from(source);
    const size = this.stateSize(sig);
    if (!(size > 0) || ary.length < size) return false;
    const bytes = size * Float64Array.BYTES_PER_ELEMENT;
    this.ensurePointers();
    let ok = false;
    this._withStack(bytes, (ptr) => {
      const view = heapViewF64(mod, ptr, size);
      view.set(ary.subarray ? ary.subarray(0, size) : Array.from(ary).slice(0, size));
      fn.call(mod, this.modelPtr | 0, this.dataPtr | 0, ptr | 0, sig >>> 0);
      ok = true;
    });
    if (ok) {
      this.forward();
      return true;
    }
    return false;
  }
  nkey(){
    const m = this.mod;
    const h = this.h | 0;
    const fn = m?._mjwf_model_nkey;
    if (typeof fn !== 'function') return 0;
    return (fn.call(m, h) | 0) || 0;
  }
  setKeyframe(index){
    const m = this.mod;
    if (!m) return false;
    const fn = m._mjwf_mj_setKeyframe;
    if (typeof fn !== 'function') return false;
    this.ensurePointers();
    fn.call(m, this.modelPtr | 0, this.dataPtr | 0, index | 0);
    return true;
  }
  resetKeyframe(index){
    const m = this.mod;
    if (!m) return false;
    const fn = m._mjwf_mj_resetDataKeyframe;
    if (typeof fn !== 'function') return false;
    this.ensurePointers();
    fn.call(m, this.modelPtr | 0, this.dataPtr | 0, index | 0);
    this.forward();
    return true;
  }

  forward(){
    const m = this.mod;
    const fn = m?._mjwf_mj_forward;
    if (typeof fn !== 'function') {
      throw new Error('Required mjwf function missing: mjwf_mj_forward');
    }
    this.ensurePointers();
    fn.call(m, this.modelPtr | 0, this.dataPtr | 0);
  }
  setQpos(i, val){ const v=this.qposView(); if (!v) return false; const idx=i|0; if (idx<0 || idx>=v.length) return false; v[idx] = +val||0; this.forward(); return true; }
  setCtrl(i, val){
    const v=this.ctrlView(); if (!v) return false; const idx=i|0; if (idx<0 || idx>=v.length) return false;
    let x=+val||0;
    const rng=this.actuatorCtrlRangeView?.();
    if (rng && (2*idx+1)<rng.length) {
      const lo=rng[2*idx]; const hi=rng[2*idx+1];
      const valid = Number.isFinite(lo) && Number.isFinite(hi) && (hi - lo) > 1e-12;
      if (valid) { x = Math.max(Math.min(hi, x), lo); }
    }
    v[idx]=x; return true;
  }

  step(n) {
    const m = this.mod;
    const count = Math.max(1, n|0);
    const mjStep = m?._mjwf_mj_step;
    if (typeof mjStep !== 'function') {
      throw new Error('Required mjwf function missing: mjwf_mj_step');
    }
    this.ensurePointers();
    const modelPtr = this.modelPtr | 0;
    const dataPtr = this.dataPtr | 0;
    if (!(modelPtr && dataPtr)) throw new Error('mj_step pointers missing');
    for (let i = 0; i < count; i += 1) {
      mjStep.call(m, modelPtr, dataPtr);
    }
  }

  timestep(){
    const m=this.mod;
    const ptr = this._readPtr('model','opt_timestep');
    if (ptr) {
      const view = heapViewF64(m, ptr, 1);
      if (view && view.length) return +view[0] || 0.002;
    }
    return 0.002;
  }
  time(){
    const m=this.mod;
    const ptr = this._readPtr('data','time');
    if (ptr) {
      const view = heapViewF64(m, ptr, 1);
      if (view && view.length) return +view[0] || 0;
    }
    return 0;
  }

  _readPtr(owner,name){ const m=this.mod; const h=this.h|0; const fn=m && m[`_mjwf_${owner}_${name}_ptr`]; if (typeof fn!=='function') return 0; return fn.call(m,h)|0; }
  _readModelPtr(name){ return this._readPtr('model', name); }
  _readDataPtr(name){ return this._readPtr('data', name); }

  _withStack(bytes, cb){
    const mod = this.mod;
    if (!mod) return null;
    if (typeof mod.stackSave === 'function' && typeof mod.stackAlloc === 'function' && typeof mod.stackRestore === 'function') {
      let sp = 0;
      try { sp = mod.stackSave(); } catch { sp = 0; }
      let ptr = 0;
      try { ptr = mod.stackAlloc(bytes) | 0; } catch { ptr = 0; }
      if (!(ptr > 0)) {
        if (sp) {
          try { mod.stackRestore(sp); } catch {}
        }
        return null;
      }
      try {
        return cb(ptr | 0);
      } finally {
        try { mod.stackRestore(sp); } catch {}
      }
    }
    if (typeof mod._malloc === 'function' && typeof mod._free === 'function') {
      let ptr = 0;
      try { ptr = mod._malloc(bytes) | 0; } catch { ptr = 0; }
      if (!(ptr > 0)) return null;
      try {
        return cb(ptr | 0);
      } finally {
        try { mod._free(ptr); } catch {}
      }
    }
    return null;
  }

  _ensureContactForceScratch(){
    if (this.contactForceScratch?.ptr) return this.contactForceScratch;
    const mod = this.mod;
    if (!mod || typeof mod._malloc !== 'function') return null;
    const bytes = 6 * Float64Array.BYTES_PER_ELEMENT;
    let ptr = 0;
    try { ptr = mod._malloc(bytes) | 0; } catch { ptr = 0; }
    if (!(ptr > 0)) return null;
    this.contactForceScratch = { ptr, bytes, view: null };
    return this.contactForceScratch;
  }

  _acquireContactForceScratch(){
    const mod = this.mod;
    if (!mod) return null;
    const owned = this._ensureContactForceScratch();
    if (owned?.ptr) {
      if (!owned.view || owned.view.length < 3) {
        owned.view = heapViewF64(mod, owned.ptr, 6);
      }
      if (!owned.view || owned.view.length < 3) return null;
      return { ptr: owned.ptr | 0, view: owned.view, release: () => {} };
    }
    if (typeof mod.stackSave === 'function' && typeof mod.stackAlloc === 'function' && typeof mod.stackRestore === 'function') {
      const bytes = 6 * Float64Array.BYTES_PER_ELEMENT;
      let sp = 0;
      try { sp = mod.stackSave(); } catch { sp = 0; }
      let ptr = 0;
      try { ptr = mod.stackAlloc(bytes) | 0; } catch { ptr = 0; }
      if (!(ptr > 0)) {
        if (sp) {
          try { mod.stackRestore(sp); } catch {}
        }
        return null;
      }
      const view = heapViewF64(mod, ptr, 6);
      if (!view || view.length < 3) {
        try { mod.stackRestore(sp); } catch {}
        return null;
      }
      return {
        ptr,
        view,
        release: () => {
          try { mod.stackRestore(sp); } catch {}
        },
      };
    }
    return null;
  }

  _freeContactForceScratch(){
    if (!this.contactForceScratch) return;
    const mod = this.mod;
    const ptr = this.contactForceScratch.ptr | 0;
    if (ptr && mod && typeof mod._free === 'function') {
      try { mod._free(ptr); } catch {}
    }
    this.contactForceScratch = null;
  }

  _nameFromAdr(index, adrExport, countExport){
    const m=this.mod; const h=this.h|0;
    const namesPtrFn = m?._mjwf_model_names_ptr;
    const adrFn = m?.[adrExport];
    const countFn = m?.[countExport];
    if (typeof namesPtrFn!=='function' || typeof adrFn!=='function' || typeof countFn!=='function') return '';
    const count = countFn.call(m,h)|0;
    const idx = index|0;
    if (!(count>0) || idx<0 || idx>=count) return '';
    const namesPtr = namesPtrFn.call(m,h)|0;
    const adrPtr = adrFn.call(m,h)|0;
    if (!(namesPtr>0) || !(adrPtr>0)) return '';
    const offsets = heapViewI32(m, adrPtr, count+1);
    if (!offsets || idx>=offsets.length) return '';
    const rel = offsets[idx]|0;
    if (!(rel>=0)) return '';
    return this._cstr(namesPtr + rel);
  }

  pointerDiagnostics(tag=''){
    const diag = {
      tag,
      moduleId: this.modId || null,
      handle: this.h|0,
      modelPtr: this.modelPtr|0,
      dataPtr: this.dataPtr|0,
      timePtr: 0,
      timestepPtr: 0,
      time: null,
      timestep: null,
      heapBytes: 0,
    };
    try {
      this.ensurePointers();
      diag.modelPtr = this.modelPtr|0;
      diag.dataPtr = this.dataPtr|0;
    } catch (err) {
      diag.error = String(err||'');
      return diag;
    }
    const m=this.mod;
    const readScalar=(ptr)=>{ if(!(ptr>0)) return null; const view=heapViewF64(m,ptr,1); if(!view||!view.length) return null; return +view[0]; };
    diag.timePtr = this._readPtr('data','time') | 0;
    diag.timestepPtr = this._readPtr('model','opt_timestep') | 0;
    diag.time = readScalar(diag.timePtr);
    diag.timestep = readScalar(diag.timestepPtr);
    const heapBuf = resolveHeapBuffer(m);
    if (heapBuf instanceof ArrayBuffer) {
      diag.heapBytes = heapBuf.byteLength >>> 0;
    }
    return diag;
  }

  ngeom(){ const m=this.mod; const h=this.h|0; const d=m._mjwf_model_ngeom; if (typeof d!=='function') return 0; return (d.call(m,h)|0)||0; }
  nbody(){ const m=this.mod; const h=this.h|0; const d=m._mjwf_model_nbody; if (typeof d!=='function') return 0; return (d.call(m,h)|0)||0; }
  bodyJntAdrView(){ const m=this.mod; const h=this.h|0; const n=this.nbody()|0; if(!(n>0)) return null; const fn=m?._mjwf_model_body_jntadr_ptr; if (typeof fn!=='function') return null; const ptr=fn.call(m,h)|0; if(!(ptr>0)) return null; return heapViewI32(m, ptr, n); }
  bodyJntNumView(){ const m=this.mod; const h=this.h|0; const n=this.nbody()|0; if(!(n>0)) return null; const fn=m?._mjwf_model_body_jntnum_ptr; if (typeof fn!=='function') return null; const ptr=fn.call(m,h)|0; if(!(ptr>0)) return null; return heapViewI32(m, ptr, n); }
  bodyParentIdView(){ const m=this.mod; const h=this.h|0; const n=this.nbody()|0; if(!(n>0)) return null; const fn=m?._mjwf_model_body_parentid_ptr; if (typeof fn!=='function') return null; const ptr=fn.call(m,h)|0; if(!(ptr>0)) return null; return heapViewI32(m, ptr, n); }

  geomXposView(){ const m=this.mod; const h=this.h|0; const n=this.ngeom(); if(!n)return; const d=m._mjwf_data_geom_xpos_ptr; if (typeof d!=='function') return; const p=d.call(m,h)|0; if(!p)return; return heapViewF64(m,p,n*3); }
  geomXmatView(){ const m=this.mod; const h=this.h|0; const n=this.ngeom(); if(!n)return; const d=m._mjwf_data_geom_xmat_ptr; if (typeof d!=='function') return; const p=d.call(m,h)|0; if(!p)return; return heapViewF64(m,p,n*9); }
  bodyXposView(){ const m=this.mod; const h=this.h|0; const n=this.nbody(); if(!n)return; const d=m._mjwf_data_xpos_ptr; if (typeof d!=='function') return; const p=d.call(m,h)|0; if(!p)return; return heapViewF64(m,p,n*3); }
  bodyXmatView(){ const m=this.mod; const h=this.h|0; const n=this.nbody(); if(!n)return; const d=m._mjwf_data_xmat_ptr; if (typeof d!=='function') return; const p=d.call(m,h)|0; if(!p)return; return heapViewF64(m,p,n*9); }
  bodyXiposView(){
    const m=this.mod; const h=this.h|0; const n=this.nbody(); if(!n)return;
    const d = m._mjwf_data_xipos_ptr;
    if (typeof d!=='function') return;
    const p=d.call(m,h)|0;
    if(!p)return;
    return heapViewF64(m,p,n*3);
  }
  bodyXimatView(){
    const m=this.mod; const h=this.h|0; const n=this.nbody(); if(!n)return;
    const d = m._mjwf_data_ximat_ptr;
    if (typeof d!=='function') return;
    const p=d.call(m,h)|0;
    if(!p)return;
    return heapViewF64(m,p,n*9);
  }
  xanchorView(){
    const m=this.mod; const h=this.h|0; const nj=this.njnt()|0; if(!(nj>0)) return;
    const d = m._mjwf_data_xanchor_ptr;
    if (typeof d!=='function') return;
    const p=d.call(m,h)|0;
    if(!p)return;
    return heapViewF64(m,p,nj*3);
  }
  dofIslandView(){
    const m=this.mod; const h=this.h|0; const nv=this.nv()|0; if(!(nv>0)) return;
    const d = m._mjwf_data_dof_island_ptr;
    if (typeof d!=='function') return;
    const p=d.call(m,h)|0;
    if(!p)return;
    return heapViewI32(m,p,nv);
  }
  nisland(){
    const m=this.mod; const h=this.h|0;
    const d = m._mjwf_data_nisland;
    if (typeof d!=='function') return 0;
    return d.call(m,h)|0;
  }
  nbvh(){
    const m=this.mod; const h=this.h|0;
    const d = m._mjwf_model_nbvh;
    if (typeof d!=='function') return 0;
    return d.call(m,h)|0;
  }
  nbvhdynamic(){
    const m=this.mod; const h=this.h|0;
    const d = m._mjwf_model_nbvhdynamic;
    if (typeof d!=='function') return 0;
    return d.call(m,h)|0;
  }
  bvhActiveView(){
    const m=this.mod; const h=this.h|0; const nbvh=this.nbvh()|0; if(!(nbvh>0)) return;
    const d = m._mjwf_data_bvh_active_ptr;
    if (typeof d!=='function') return;
    const p=d.call(m,h)|0;
    if(!p)return;
    return heapViewU8(m,p,nbvh);
  }
  bvhAabbDynView(){
    const m=this.mod; const h=this.h|0; const ndyn=this.nbvhdynamic()|0; if(!(ndyn>0)) return;
    const d = m._mjwf_data_bvh_aabb_dyn_ptr;
    if (typeof d!=='function') return;
    const p=d.call(m,h)|0;
    if(!p)return;
    return heapViewF64(m,p,ndyn*6);
  }
  bodyCvelView(){ const m=this.mod; const h=this.h|0; const n=this.nbody(); if(!n)return; const d=m._mjwf_data_cvel_ptr; if (typeof d!=='function') return; const p=d.call(m,h)|0; if(!p)return; return heapViewF64(m,p,n*6); }
  bodyXquatView(){
    const m=this.mod; const h=this.h|0; const n=this.nbody(); if(!n)return;
    const d = m._mjwf_data_xquat_ptr;
    if (typeof d!=='function') return;
    const p=d.call(m,h)|0;
    if(!p)return;
    return heapViewF64(m,p,n*4);
  }
  quat2Vel(quat, dt, target){
    const m = this.mod;
    if (!m) return null;
    const fn = m._mjwf_mju_quat2Vel;
    if (typeof fn !== 'function') return null;
    const out = target instanceof Float64Array && target.length >= 3 ? target : new Float64Array(3);
    const q = Array.isArray(quat) || ArrayBuffer.isView(quat) ? quat : null;
    if (!q || q.length < 4) return null;
    const dtVal = Number(dt) || 0;
    const bytes = (3 + 4) * Float64Array.BYTES_PER_ELEMENT;
    this._withStack(bytes, (ptr) => {
      if (!(ptr > 0)) return null;
      const resPtr = ptr | 0;
      const quatPtr = (ptr + 3 * Float64Array.BYTES_PER_ELEMENT) | 0;
      const quatView = heapViewF64(m, quatPtr, 4);
      if (!quatView || quatView.length < 4) return null;
      quatView[0] = Number(q[0]) || 0;
      quatView[1] = Number(q[1]) || 0;
      quatView[2] = Number(q[2]) || 0;
      quatView[3] = Number(q[3]) || 0;
      try {
        fn.call(m, resPtr | 0, quatPtr | 0, dtVal);
      } catch {
        return null;
      }
      const resView = heapViewF64(m, resPtr, 3);
      if (!resView || resView.length < 3) return null;
      out[0] = Number(resView[0]) || 0;
      out[1] = Number(resView[1]) || 0;
      out[2] = Number(resView[2]) || 0;
      return null;
    });
    return out;
  }
  bodyInertiaScalar(bodyIndex){
    const body = bodyIndex|0;
    const m = this.mod;
    if (!m || !(body >= 0)) return null;
    const nbody = this.nbody()|0;
    if (!(nbody > 0 && body < nbody)) return null;
    const fn = m._mjwf_model_body_invweight0_ptr;
    if (typeof fn !== 'function') return null;
    let ptr = 0;
    try { ptr = fn.call(m, this.h | 0) | 0; } catch { ptr = 0; }
    if (!(ptr > 0)) return null;
    const view = heapViewF64(m, ptr, 2 * nbody);
    if (!view || view.length < (2 * nbody)) return null;
    const idx = 2 * body + 1;
    const invweight = Number(view[idx]) || 0;
    if (!Number.isFinite(invweight)) return null;
    if (invweight === 0) return 1;
    const MJ_MINVAL = 1e-15;
    const denom = Math.max(invweight, MJ_MINVAL);
    if (!(denom > 0)) return null;
    return 1.0 / denom;
  }
  bodyWorldVelocity(bodyIndex, target){
    const body = bodyIndex|0;
    const m = this.mod;
    if (!m || !(body >= 0)) return null;
    const nbody = this.nbody()|0;
    if (!(nbody > 0 && body < nbody)) return null;
    try {
      this.ensurePointers();
    } catch {
      return null;
    }
    const modelPtr = this.modelPtr|0;
    const dataPtr = this.dataPtr|0;
    if (!(modelPtr > 0 && dataPtr > 0)) return null;
    const fn = m._mjwf_mj_objectVelocity;
    if (typeof fn !== 'function') return null;
    const out = target instanceof Float64Array && target.length >= 6 ? target : new Float64Array(6);
    const bytes = 6 * Float64Array.BYTES_PER_ELEMENT;
    this._withStack(bytes, (ptr) => {
      if (!(ptr > 0)) return null;
      const view = heapViewF64(m, ptr, 6);
      if (!view || view.length < 6) return null;
      try {
        fn.call(m, modelPtr, dataPtr, 1, body, ptr | 0, 0);
      } catch {
        return null;
      }
      for (let i = 0; i < 6; i += 1) {
        out[i] = Number(view[i]) || 0;
      }
      return null;
    });
    return out;
  }
  bodyLocalMassAtPoint(bodyIndex, worldPoint){
    const body = bodyIndex|0;
    if (!(body >= 0)) return null;
    const m = this.mod;
    if (!m) return null;
    const nv = this.nv()|0;
    const nbody = this.nbody()|0;
    if (!(nv > 0 && nbody > 0 && body < nbody)) return null;
    try {
      this.ensurePointers();
    } catch {
      return null;
    }
    const modelPtr = this.modelPtr|0;
    const dataPtr = this.dataPtr|0;
    if (!(modelPtr > 0 && dataPtr > 0)) return null;
    const qLDiagPtr = this._readDataPtr('qLDiagInv') | 0;
    if (!(qLDiagPtr > 0)) return null;
    const qLDiagView = heapViewF64(m, qLDiagPtr, nv);
    if (!qLDiagView || qLDiagView.length < nv) return null;
    const jacFn = m._mjwf_mj_jac;
    const solveFn = m._mjwf_mj_solveM2;
    if (typeof jacFn !== 'function' || typeof solveFn !== 'function') return null;
    const MJ_MINVAL = 1e-15;
    const anchor = worldPoint || [0, 0, 0];
    const ax = +anchor[0] || 0;
    const ay = +anchor[1] || 0;
    const az = +anchor[2] || 0;
    const count = (6*nv + nv + 3);
    const bytes = count * Float64Array.BYTES_PER_ELEMENT;
    const result = this._withStack(bytes, (ptr) => {
      if (!(ptr > 0)) return null;
      const base = ptr>>>0;
      const jacPtr = base;
      const jacM2Ptr = base + (3*nv)*Float64Array.BYTES_PER_ELEMENT;
      const sqrtPtr = base + (6*nv)*Float64Array.BYTES_PER_ELEMENT;
      const selPtr = base + (7*nv)*Float64Array.BYTES_PER_ELEMENT;
      const jacView = heapViewF64(m, jacPtr, 3*nv);
      const jacM2View = heapViewF64(m, jacM2Ptr, 3*nv);
      const sqrtView = heapViewF64(m, sqrtPtr, nv);
      const selView = heapViewF64(m, selPtr, 3);
      if (!jacView || !jacM2View || !sqrtView || !selView) return null;
      selView[0] = ax;
      selView[1] = ay;
      selView[2] = az;
      for (let i=0; i<nv; i+=1) {
        const inv = qLDiagView[i] || 0;
        sqrtView[i] = inv > 0 ? Math.sqrt(inv) : 0;
      }
      try {
        jacFn.call(m, modelPtr, dataPtr, jacPtr, 0, selPtr, body);
        solveFn.call(m, modelPtr, dataPtr, jacM2Ptr, jacPtr, sqrtPtr, 3);
      } catch {
        return null;
      }
      let invmass = 0;
      for (let row=0; row<3; row+=1) {
        const rowBase = row*nv;
        let sum = 0;
        for (let j=0; j<nv; j+=1) {
          const v = jacM2View[rowBase + j] || 0;
          sum += v*v;
        }
        invmass += sum;
      }
      if (!Number.isFinite(invmass)) return null;
      if (invmass === 0) return 1;
      const denom = Math.max(invmass, MJ_MINVAL);
      if (!(denom > 0)) return null;
      return 3.0/denom;
    });
    return (typeof result === 'number' && result > 0 && Number.isFinite(result)) ? result : null;
  }
  // Optional getters: direct exports only.
  geomSizeView(){ const m=this.mod; const h=this.h|0; const n=this.ngeom(); if(!n)return; const d=m._mjwf_model_geom_size_ptr; if (typeof d!=='function') return; const p=d.call(m,h)|0; if(!p)return; return heapViewF64(m,p,n*3); }
  geomTypeView(){ const m=this.mod; const h=this.h|0; const n=this.ngeom(); if(!n)return; const d=m._mjwf_model_geom_type_ptr; if (typeof d!=='function') return; const p=d.call(m,h)|0; if(!p)return; return heapViewI32(m,p,n); }
  geomMatIdView(){ const m=this.mod; const h=this.h|0; const n=this.ngeom(); if(!n)return; const d=m._mjwf_model_geom_matid_ptr; if (typeof d!=='function') return; const p=d.call(m,h)|0; if(!p)return; return heapViewI32(m,p,n); }
  geomDataidView(){ const m=this.mod; const h=this.h|0; const n=this.ngeom(); if(!n)return; const d=m._mjwf_model_geom_dataid_ptr; if (typeof d!=='function') return; const p=d.call(m,h)|0; if(!p)return; return heapViewI32(m,p,n); }
  geomBodyIdView(){ const m=this.mod; const h=this.h|0; const n=this.ngeom()|0; if(!(n>0)) return null; const fn=m?._mjwf_model_geom_bodyid_ptr; if (typeof fn!=='function') return null; const ptr=fn.call(m,h)|0; if(!(ptr>0)) return null; return heapViewI32(m, ptr, n); }
  // mjvScene SoA (forge scene API; SoA packed in wasm, copied by worker)
  sceneUpdateAndPack(catmask = 7){ const m=this.mod; const h=this.h|0; const fn=m?._mjwf_scene_update_and_pack; if (typeof fn!=='function' || !(h>0)) return 0; return fn.call(m, h, catmask|0) | 0; }
  sceneNgeom(){ const m=this.mod; const h=this.h|0; const fn=m?._mjwf_scene_ngeom; if (typeof fn!=='function' || !(h>0)) return 0; return fn.call(m, h) | 0; }
  sceneGeomOrderView(){ const m=this.mod; const h=this.h|0; const n=this.sceneNgeom()|0; if(!(n>0)) return null; const fn=m?._mjwf_scene_geomorder_ptr; if (typeof fn!=='function') return null; const ptr=fn.call(m,h)|0; if(!(ptr>0)) return null; return heapViewI32(m, ptr, n); }
  sceneGeomCamDistView(){ const m=this.mod; const h=this.h|0; const n=this.sceneNgeom()|0; if(!(n>0)) return null; const fn=m?._mjwf_scene_geoms_camdist_ptr; if (typeof fn!=='function') return null; const ptr=fn.call(m,h)|0; if(!(ptr>0)) return null; return heapViewF32(m, ptr, n); }
  sceneGeomTypeView(){ const m=this.mod; const h=this.h|0; const n=this.sceneNgeom()|0; if(!(n>0)) return null; const fn=m?._mjwf_scene_geoms_type_ptr; if (typeof fn!=='function') return null; const ptr=fn.call(m,h)|0; if(!(ptr>0)) return null; return heapViewI32(m, ptr, n); }
  sceneGeomPosView(){ const m=this.mod; const h=this.h|0; const n=this.sceneNgeom()|0; if(!(n>0)) return null; const fn=m?._mjwf_scene_geoms_pos_ptr; if (typeof fn!=='function') return null; const ptr=fn.call(m,h)|0; if(!(ptr>0)) return null; return heapViewF32(m, ptr, n*3); }
  sceneGeomMatView(){ const m=this.mod; const h=this.h|0; const n=this.sceneNgeom()|0; if(!(n>0)) return null; const fn=m?._mjwf_scene_geoms_mat_ptr; if (typeof fn!=='function') return null; const ptr=fn.call(m,h)|0; if(!(ptr>0)) return null; return heapViewF32(m, ptr, n*9); }
  sceneGeomSizeView(){ const m=this.mod; const h=this.h|0; const n=this.sceneNgeom()|0; if(!(n>0)) return null; const fn=m?._mjwf_scene_geoms_size_ptr; if (typeof fn!=='function') return null; const ptr=fn.call(m,h)|0; if(!(ptr>0)) return null; return heapViewF32(m, ptr, n*3); }
  sceneGeomRgbaView(){ const m=this.mod; const h=this.h|0; const n=this.sceneNgeom()|0; if(!(n>0)) return null; const fn=m?._mjwf_scene_geoms_rgba_ptr; if (typeof fn!=='function') return null; const ptr=fn.call(m,h)|0; if(!(ptr>0)) return null; return heapViewF32(m, ptr, n*4); }
  sceneGeomMatIdView(){ const m=this.mod; const h=this.h|0; const n=this.sceneNgeom()|0; if(!(n>0)) return null; const fn=m?._mjwf_scene_geoms_matid_ptr; if (typeof fn!=='function') return null; const ptr=fn.call(m,h)|0; if(!(ptr>0)) return null; return heapViewI32(m, ptr, n); }
  sceneGeomDataIdView(){ const m=this.mod; const h=this.h|0; const n=this.sceneNgeom()|0; if(!(n>0)) return null; const fn=m?._mjwf_scene_geoms_dataid_ptr; if (typeof fn!=='function') return null; const ptr=fn.call(m,h)|0; if(!(ptr>0)) return null; return heapViewI32(m, ptr, n); }
  sceneGeomObjTypeView(){ const m=this.mod; const h=this.h|0; const n=this.sceneNgeom()|0; if(!(n>0)) return null; const fn=m?._mjwf_scene_geoms_objtype_ptr; if (typeof fn!=='function') return null; const ptr=fn.call(m,h)|0; if(!(ptr>0)) return null; return heapViewI32(m, ptr, n); }
  sceneGeomObjIdView(){ const m=this.mod; const h=this.h|0; const n=this.sceneNgeom()|0; if(!(n>0)) return null; const fn=m?._mjwf_scene_geoms_objid_ptr; if (typeof fn!=='function') return null; const ptr=fn.call(m,h)|0; if(!(ptr>0)) return null; return heapViewI32(m, ptr, n); }
  sceneGeomCategoryView(){ const m=this.mod; const h=this.h|0; const n=this.sceneNgeom()|0; if(!(n>0)) return null; const fn=m?._mjwf_scene_geoms_category_ptr; if (typeof fn!=='function') return null; const ptr=fn.call(m,h)|0; if(!(ptr>0)) return null; return heapViewI32(m, ptr, n); }
  sceneGeomSegIdView(){ const m=this.mod; const h=this.h|0; const n=this.sceneNgeom()|0; if(!(n>0)) return null; const fn=m?._mjwf_scene_geoms_segid_ptr; if (typeof fn!=='function') return null; const ptr=fn.call(m,h)|0; if(!(ptr>0)) return null; return heapViewI32(m, ptr, n); }
  sceneGeomTransparentView(){ const m=this.mod; const h=this.h|0; const n=this.sceneNgeom()|0; if(!(n>0)) return null; const fn=m?._mjwf_scene_geoms_transparent_ptr; if (typeof fn!=='function') return null; const ptr=fn.call(m,h)|0; if(!(ptr>0)) return null; return heapViewU8(m, ptr, n); }
  sceneGeomLabelView(){ const m=this.mod; const h=this.h|0; const n=this.sceneNgeom()|0; if(!(n>0)) return null; const fn=m?._mjwf_scene_geoms_label_ptr; if (typeof fn!=='function') return null; const ptr=fn.call(m,h)|0; if(!(ptr>0)) return null; const stride=100; return heapViewU8(m, ptr, n*stride); }
  // mjvOption views (writeable)
  voptFlagsPtrView(){ const m=this.mod; const h=this.h|0; const fn=m?._mjwf_vopt_flags_ptr; if (typeof fn!=='function' || !(h>0)) return null; const ptr=fn.call(m,h)|0; if(!(ptr>0)) return null; return heapViewU8(m, ptr, 31); }
  voptLabelPtrView(){ const m=this.mod; const h=this.h|0; const fn=m?._mjwf_vopt_label_ptr; if (typeof fn!=='function' || !(h>0)) return null; const ptr=fn.call(m,h)|0; if(!(ptr>0)) return null; return heapViewI32(m, ptr, 1); }
  voptFramePtrView(){ const m=this.mod; const h=this.h|0; const fn=m?._mjwf_vopt_frame_ptr; if (typeof fn!=='function' || !(h>0)) return null; const ptr=fn.call(m,h)|0; if(!(ptr>0)) return null; return heapViewI32(m, ptr, 1); }
  voptFlexLayerPtrView(){ const m=this.mod; const h=this.h|0; const fn=m?._mjwf_vopt_flex_layer_ptr; if (typeof fn!=='function' || !(h>0)) return null; const ptr=fn.call(m,h)|0; if(!(ptr>0)) return null; return heapViewI32(m, ptr, 1); }
  voptBvhDepthPtrView(){ const m=this.mod; const h=this.h|0; const fn=m?._mjwf_vopt_bvh_depth_ptr; if (typeof fn!=='function' || !(h>0)) return null; const ptr=fn.call(m,h)|0; if(!(ptr>0)) return null; return heapViewI32(m, ptr, 1); }
  voptGeomGroupView(){ const m=this.mod; const h=this.h|0; const fn=m?._mjwf_vopt_geomgroup_ptr; if (typeof fn!=='function' || !(h>0)) return null; const ptr=fn.call(m,h)|0; if(!(ptr>0)) return null; return heapViewU8(m, ptr, 6); }
  voptSiteGroupView(){ const m=this.mod; const h=this.h|0; const fn=m?._mjwf_vopt_sitegroup_ptr; if (typeof fn!=='function' || !(h>0)) return null; const ptr=fn.call(m,h)|0; if(!(ptr>0)) return null; return heapViewU8(m, ptr, 6); }
  voptTendonGroupView(){ const m=this.mod; const h=this.h|0; const fn=m?._mjwf_vopt_tendongroup_ptr; if (typeof fn!=='function' || !(h>0)) return null; const ptr=fn.call(m,h)|0; if(!(ptr>0)) return null; return heapViewU8(m, ptr, 6); }
  voptJointGroupView(){ const m=this.mod; const h=this.h|0; const fn=m?._mjwf_vopt_jointgroup_ptr; if (typeof fn!=='function' || !(h>0)) return null; const ptr=fn.call(m,h)|0; if(!(ptr>0)) return null; return heapViewU8(m, ptr, 6); }
  voptActuatorGroupView(){ const m=this.mod; const h=this.h|0; const fn=m?._mjwf_vopt_actuatorgroup_ptr; if (typeof fn!=='function' || !(h>0)) return null; const ptr=fn.call(m,h)|0; if(!(ptr>0)) return null; return heapViewU8(m, ptr, 6); }
  voptFlexGroupView(){ const m=this.mod; const h=this.h|0; const fn=m?._mjwf_vopt_flexgroup_ptr; if (typeof fn!=='function' || !(h>0)) return null; const ptr=fn.call(m,h)|0; if(!(ptr>0)) return null; return heapViewU8(m, ptr, 6); }
  voptSkinGroupView(){ const m=this.mod; const h=this.h|0; const fn=m?._mjwf_vopt_skingroup_ptr; if (typeof fn!=='function' || !(h>0)) return null; const ptr=fn.call(m,h)|0; if(!(ptr>0)) return null; return heapViewU8(m, ptr, 6); }

  // Viewer camera/scene/perturb pointers (forge viewer ABI).
  scenePtr(){ const m=this.mod; const h=this.h|0; const fn=m?._mjwf_scene_maxgeom_ptr; if (typeof fn!=='function' || !(h>0)) return 0; return fn.call(m, h) | 0; }
  camTypePtrView(){ const m=this.mod; const h=this.h|0; const fn=m?._mjwf_cam_type_ptr; if (typeof fn!=='function' || !(h>0)) return null; const ptr=fn.call(m,h)|0; if(!(ptr>0)) return null; return heapViewI32(m, ptr, 1); }
  camLookatPtrView(){ const m=this.mod; const h=this.h|0; const fn=m?._mjwf_cam_lookat_ptr; if (typeof fn!=='function' || !(h>0)) return null; const ptr=fn.call(m,h)|0; if(!(ptr>0)) return null; return heapViewF64(m, ptr, 3); }
  camDistancePtrView(){ const m=this.mod; const h=this.h|0; const fn=m?._mjwf_cam_distance_ptr; if (typeof fn!=='function' || !(h>0)) return null; const ptr=fn.call(m,h)|0; if(!(ptr>0)) return null; return heapViewF64(m, ptr, 1); }
  camAzimuthPtrView(){ const m=this.mod; const h=this.h|0; const fn=m?._mjwf_cam_azimuth_ptr; if (typeof fn!=='function' || !(h>0)) return null; const ptr=fn.call(m,h)|0; if(!(ptr>0)) return null; return heapViewF64(m, ptr, 1); }
  camElevationPtrView(){ const m=this.mod; const h=this.h|0; const fn=m?._mjwf_cam_elevation_ptr; if (typeof fn!=='function' || !(h>0)) return null; const ptr=fn.call(m,h)|0; if(!(ptr>0)) return null; return heapViewF64(m, ptr, 1); }
  camOrthographicPtrView(){ const m=this.mod; const h=this.h|0; const fn=m?._mjwf_cam_orthographic_ptr; if (typeof fn!=='function' || !(h>0)) return null; const ptr=fn.call(m,h)|0; if(!(ptr>0)) return null; return heapViewI32(m, ptr, 1); }
  camFixedcamidPtrView(){ const m=this.mod; const h=this.h|0; const fn=m?._mjwf_cam_fixedcamid_ptr; if (typeof fn!=='function' || !(h>0)) return null; const ptr=fn.call(m,h)|0; if(!(ptr>0)) return null; return heapViewI32(m, ptr, 1); }
  camTrackbodyidPtrView(){ const m=this.mod; const h=this.h|0; const fn=m?._mjwf_cam_trackbodyid_ptr; if (typeof fn!=='function' || !(h>0)) return null; const ptr=fn.call(m,h)|0; if(!(ptr>0)) return null; return heapViewI32(m, ptr, 1); }

  pertPtr(){ const m=this.mod; const h=this.h|0; const fn=m?._mjwf_pert_select_ptr; if (typeof fn!=='function' || !(h>0)) return 0; return fn.call(m, h) | 0; }
  pertSelectPtrView(){ const m=this.mod; const h=this.h|0; const fn=m?._mjwf_pert_select_ptr; if (typeof fn!=='function' || !(h>0)) return null; const ptr=fn.call(m,h)|0; if(!(ptr>0)) return null; return heapViewI32(m, ptr, 1); }
  pertActivePtrView(){ const m=this.mod; const h=this.h|0; const fn=m?._mjwf_pert_active_ptr; if (typeof fn!=='function' || !(h>0)) return null; const ptr=fn.call(m,h)|0; if(!(ptr>0)) return null; return heapViewI32(m, ptr, 1); }
  pertActive2PtrView(){ const m=this.mod; const h=this.h|0; const fn=m?._mjwf_pert_active2_ptr; if (typeof fn!=='function' || !(h>0)) return null; const ptr=fn.call(m,h)|0; if(!(ptr>0)) return null; return heapViewI32(m, ptr, 1); }
  pertLocalposPtrView(){ const m=this.mod; const h=this.h|0; const fn=m?._mjwf_pert_localpos_ptr; if (typeof fn!=='function' || !(h>0)) return null; const ptr=fn.call(m,h)|0; if(!(ptr>0)) return null; return heapViewF64(m, ptr, 3); }
  pertScalePtrView(){ const m=this.mod; const h=this.h|0; const fn=m?._mjwf_pert_scale_ptr; if (typeof fn!=='function' || !(h>0)) return null; const ptr=fn.call(m,h)|0; if(!(ptr>0)) return null; return heapViewF64(m, ptr, 1); }
  pertFlexselectPtrView(){ const m=this.mod; const h=this.h|0; const fn=m?._mjwf_pert_flexselect_ptr; if (typeof fn!=='function' || !(h>0)) return null; const ptr=fn.call(m,h)|0; if(!(ptr>0)) return null; return heapViewI32(m, ptr, 1); }
  pertSkinselectPtrView(){ const m=this.mod; const h=this.h|0; const fn=m?._mjwf_pert_skinselect_ptr; if (typeof fn!=='function' || !(h>0)) return null; const ptr=fn.call(m,h)|0; if(!(ptr>0)) return null; return heapViewI32(m, ptr, 1); }
  nmat(){ const m=this.mod; const h=this.h|0; const d=m._mjwf_model_nmat; if (typeof d!=='function') return 0; return (d.call(m,h)|0)||0; }
  matRgbaView(){ const m=this.mod; const h=this.h|0; const nm=this.nmat(); if(!nm)return; const d=m._mjwf_model_mat_rgba_ptr; if (typeof d!=='function') return; const p=d.call(m,h)|0; if(!p)return; return heapViewF32(m,p,nm*4); }
  nmesh(){ const m=this.mod; const h=this.h|0; const d=m._mjwf_model_nmesh; if (typeof d!=='function') return 0; return (d.call(m,h)|0)||0; }
  meshVertAdrView(){ const m=this.mod; const h=this.h|0; const n=this.nmesh(); if(!n)return; const d=m._mjwf_model_mesh_vertadr_ptr; if (typeof d!=='function') return; const p=d.call(m,h)|0; if(!p)return; return heapViewI32(m,p,n); }
  meshVertNumView(){ const m=this.mod; const h=this.h|0; const n=this.nmesh(); if(!n)return; const d=m._mjwf_model_mesh_vertnum_ptr; if (typeof d!=='function') return; const p=d.call(m,h)|0; if(!p)return; return heapViewI32(m,p,n); }
  meshFaceAdrView(){ const m=this.mod; const h=this.h|0; const n=this.nmesh(); if(!n)return; const d=m._mjwf_model_mesh_faceadr_ptr; if (typeof d!=='function') return; const p=d.call(m,h)|0; if(!p)return; return heapViewI32(m,p,n); }
  meshFaceNumView(){ const m=this.mod; const h=this.h|0; const n=this.nmesh(); if(!n)return; const d=m._mjwf_model_mesh_facenum_ptr; if (typeof d!=='function') return; const p=d.call(m,h)|0; if(!p)return; return heapViewI32(m,p,n); }
  meshVertView(){
    const m=this.mod; const h=this.h|0; const n=this.nmesh(); if(!n)return;
    const d=m._mjwf_model_mesh_vert_ptr; if (typeof d!=='function') return;
    let elemCount = 0;
    const cntFn=m._mjwf_mesh_vert_count;
    if (typeof cntFn==='function') {
      const v = cntFn.call(m,h)|0;
      if (v>0) elemCount = v*3;
    }
    if (!(elemCount>0)) {
      const adrView = this.meshVertAdrView?.();
      const numView = this.meshVertNumView?.();
      const counts = computeMeshElementCounts(adrView, numView, null, null, null, null);
      elemCount = counts.vert|0;
    }
    if (!(elemCount>0)) return;
    const ptr=d.call(m,h)|0; if(!ptr)return;
    return heapViewF32(m,ptr,elemCount);
  }
  meshNormalView(){
    const m=this.mod; const h=this.h|0; const n=this.nmesh(); if(!n)return;
    const d=m._mjwf_model_mesh_normal_ptr; if (typeof d!=='function') return;
    let elemCount = 0;
    const cntFn=m._mjwf_mesh_vert_count;
    if (typeof cntFn==='function') {
      const v = cntFn.call(m,h)|0;
      if (v>0) elemCount = v*3;
    }
    if (!(elemCount>0)) {
      const adrView = this.meshVertAdrView?.();
      const numView = this.meshVertNumView?.();
      const counts = computeMeshElementCounts(adrView, numView, null, null, null, null);
      elemCount = counts.vert|0;
    }
    if (!(elemCount>0)) return;
    const ptr=d.call(m,h)|0; if(!ptr)return;
    return heapViewF32(m,ptr,elemCount);
  }
  meshFaceView(){
    const m=this.mod; const h=this.h|0; const n=this.nmesh(); if(!n)return;
    const d=m._mjwf_model_mesh_face_ptr; if (typeof d!=='function') return;
    let elemCount = 0;
    const cntFn=m._mjwf_mesh_face_count;
    if (typeof cntFn==='function') {
      const f = cntFn.call(m,h)|0;
      if (f>0) elemCount = f*3;
    }
    if (!(elemCount>0)) {
      const adrView = this.meshFaceAdrView?.();
      const numView = this.meshFaceNumView?.();
      const counts = computeMeshElementCounts(null, null, adrView, numView, null, null);
      elemCount = counts.face|0;
    }
    if (!(elemCount>0)) return;
    const ptr=d.call(m,h)|0; if(!ptr)return;
    return heapViewI32(m,ptr,elemCount);
  }
  meshTexcoordView(){
    const m=this.mod; const h=this.h|0; const n=this.nmesh(); if(!n)return;
    const d=m._mjwf_model_mesh_texcoord_ptr; if (typeof d!=='function') return;
    let elemCount = 0;
    const cntFn=m._mjwf_mesh_texcoord_count;
    if (typeof cntFn==='function') {
      const t = cntFn.call(m,h)|0;
      if (t>0) elemCount = t*2;
    }
    if (!(elemCount>0)) {
      const adrView = this.meshTexcoordAdrView?.();
      const numView = this.meshTexcoordNumView?.();
      const counts = computeMeshElementCounts(null, null, null, null, adrView, numView);
      elemCount = counts.texcoord|0;
    }
    if (!(elemCount>0)) return;
    const ptr=d.call(m,h)|0; if(!ptr)return;
    return heapViewF32(m,ptr,elemCount);
  }
  meshTexcoordAdrView(){ const m=this.mod; const h=this.h|0; const n=this.nmesh(); if(!n)return; const d=m._mjwf_model_mesh_texcoordadr_ptr; if (typeof d!=='function') return; const p=d.call(m,h)|0; if(!p)return; return heapViewI32(m,p,n); }
  meshTexcoordNumView(){ const m=this.mod; const h=this.h|0; const n=this.nmesh(); if(!n)return; const d=m._mjwf_model_mesh_texcoordnum_ptr; if (typeof d!=='function') return; const p=d.call(m,h)|0; if(!p)return; return heapViewI32(m,p,n); }
  collectRenderAssets() {
    return collectRenderAssetsFromModule(this.mod, this.h | 0);
  }

  // --- Contacts (optional) ---
  ncon(){ const m=this.mod; const h=this.h|0; const d=m._mjwf_data_ncon; if (typeof d!=='function') return 0; return (d.call(m,h)|0)||0; }
  _contactFieldView(offsetBytes, countPerContact){
    const m=this.mod; const h=this.h|0; const n=this.ncon(); if(!(n>0)) return;
    const contactPtrFn = m._mjwf_data_contact_ptr;
    if (typeof contactPtrFn !== 'function') return;
    const base = contactPtrFn.call(m, h) | 0;
    if (!base) return;
    const buffer = resolveHeapBuffer(m);
    if (!buffer) return;
    const strideBytes = 576;
    const strideD = strideBytes >>> 3;
    const startD = (base + (offsetBytes|0)) >>> 3;
    const view = new Float64Array(buffer);
    const out = new Float64Array(n * countPerContact);
    let outIndex = 0;
    for (let i = 0; i < n; i += 1) {
      const idx = startD + i * strideD;
      for (let j = 0; j < countPerContact; j += 1) {
        out[outIndex++] = view[idx + j];
      }
    }
    return out;
  }
  contactPosView(){ const n=this.ncon(); if(!(n>0)) return; return this._contactFieldView(8, 3); }
  contactFrameView(){ const n=this.ncon(); if(!(n>0)) return; return this._contactFieldView(32, 9); }
  contactGeom1View(){ const m=this.mod; const h=this.h|0; const n=this.ncon(); if(!(n>0)) return; const d=m._mjwf_data_contact_geom1_ptr; if(typeof d!=='function') return; const p=d.call(m,h)|0; if(!p) return; return heapViewI32(m,p,n); }
  contactGeom2View(){ const m=this.mod; const h=this.h|0; const n=this.ncon(); if(!(n>0)) return; const d=m._mjwf_data_contact_geom2_ptr; if(typeof d!=='function') return; const p=d.call(m,h)|0; if(!p) return; return heapViewI32(m,p,n); }
  contactDistView(){ const n=this.ncon(); if(!(n>0)) return; return this._contactFieldView(0, 1); }
  contactFrictionView(){ const n=this.ncon(); if(!(n>0)) return; return this._contactFieldView(112, 5); }
  contactForceBuffer(target){
    const m=this.mod;
    const n=this.ncon();
    if (!(m && (n>0))) return null;
    const d=m._mjwf_mj_contactForce;
    if(typeof d!=='function') return null;
    const scratch=this._acquireContactForceScratch();
    if(!scratch) return null;
    this.ensurePointers();
    const scratchView=scratch.view;
    const length=3*n;
    const out = target instanceof Float64Array && target.length>=length ? target : new Float64Array(length);
    for(let i=0;i<n;i+=1){
      d.call(m,this.modelPtr|0,this.dataPtr|0,i|0,scratch.ptr|0);
      const base=3*i;
      out[base+0]=Number(scratchView[0])||0;
      out[base+1]=Number(scratchView[1])||0;
      out[base+2]=Number(scratchView[2])||0;
    }
    if (typeof scratch.release === 'function') {
      scratch.release();
    }
    return out;
  }

  // --- Actuator metadata (optional) ---
  actuatorNameOf(i){
    const m=this.mod; const h=this.h|0; const idx=i|0;
    return this._nameFromAdr(idx, '_mjwf_model_name_actuatoradr_ptr', '_mjwf_model_nu') || '';
  }
  cameraNameOf(i){
    return this._nameFromAdr(i, '_mjwf_model_name_camadr_ptr', '_mjwf_model_ncam') || '';
  }
  geomNameOf(i){
    return this._nameFromAdr(i, '_mjwf_model_name_geomadr_ptr', '_mjwf_model_ngeom') || '';
  }
  
  // --- Apply/clear external force (xfrc_applied) ---
  applyXfrcByGeom(geomIndex, force3, torque3, point3){
    const m=this.mod; const h=this.h|0; const gi=geomIndex|0;
    const fx=+force3?.[0]||0, fy=+force3?.[1]||0, fz=+force3?.[2]||0;
    const tx=+torque3?.[0]||0, ty=+torque3?.[1]||0, tz=+torque3?.[2]||0;
    const px=+point3?.[0]||0, py=+point3?.[1]||0, pz=+point3?.[2]||0;
    const gbFn = m._mjwf_model_geom_bodyid_ptr;
    const xfFn = m._mjwf_data_xfrc_applied_ptr;
    if (typeof gbFn !== 'function' || typeof xfFn !== 'function') return false;
    const gbPtr = gbFn.call(m, h) | 0;
    const xfPtr = xfFn.call(m, h) | 0;
    const nbody = this.nbody();
    if (gbPtr && xfPtr && nbody>0) {
      const bodyId = heapViewI32(m, gbPtr, this.ngeom()|0)[gi|0]|0;
      if (bodyId>=0) {
        const H = heapViewF64(m, xfPtr, nbody*6);
        const off = 6*bodyId;
        H[off+0]=fx; H[off+1]=fy; H[off+2]=fz; H[off+3]=tx; H[off+4]=ty; H[off+5]=tz;
        return true;
      }
    }
    return false;
  }
  applyXfrcByBody(bodyIndex, force3, torque3){
    const m=this.mod; const h=this.h|0; const body=bodyIndex|0;
    const fx=+force3?.[0]||0, fy=+force3?.[1]||0, fz=+force3?.[2]||0;
    const tx=+torque3?.[0]||0, ty=+torque3?.[1]||0, tz=+torque3?.[2]||0;
    const xfFn = m._mjwf_data_xfrc_applied_ptr;
    if (typeof xfFn !== 'function') return false;
    const xfPtr = xfFn.call(m, h) | 0;
    const nbody = this.nbody();
    if (xfPtr && nbody>0 && body>=0 && body < nbody) {
      const H = heapViewF64(m, xfPtr, nbody*6);
      const off = 6*body;
      H[off+0]=fx; H[off+1]=fy; H[off+2]=fz; H[off+3]=tx; H[off+4]=ty; H[off+5]=tz;
      return true;
    }
    return false;
  }

  clearAllXfrc(){ const m=this.mod; const h=this.h|0; const nbody = this.nbody(); const xfFn = m._mjwf_data_xfrc_applied_ptr; if (typeof xfFn !== 'function') return false; const xfPtr = xfFn.call(m, h) | 0; if (xfPtr && nbody>0) { const H = heapViewF64(m, xfPtr, nbody*6); H.fill(0); return true; } return false; }
  reset(){
    const m = this.mod;
    const mjReset = m._mjwf_mj_resetData;
    if (typeof mjReset !== 'function') {
      throw new Error('Required mjwf function missing: mjwf_mj_resetData');
    }
    this.ensurePointers();
    mjReset.call(m, this.modelPtr | 0, this.dataPtr | 0);
    this.forward();
    return true;
  }
  term(){
    const m=this.mod; const h=this.h|0;
    this._freeContactForceScratch();
    if (h) {
      const fn = m?._mjwf_helper_free;
      if (typeof fn !== 'function') {
        throw new Error('Required mjwf helper missing: mjwf_helper_free');
      }
      fn.call(m, h);
    }
    this.h=0;
    this.modelPtr=0;
    this.dataPtr=0;
  }
}

// Local in-memory shim module has been removed; forge module must load correctly.
