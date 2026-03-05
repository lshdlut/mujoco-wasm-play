// Render-asset extraction from forge modules (CPU-side snapshot of model assets).

import { strictCatch } from '../core/viewer_runtime.mjs';
import { computeMeshElementCounts, heapViewF64, heapViewF32, heapViewI32, heapViewI64, heapViewU8 } from './heap_views.mjs';
import { MJMODEL_TEX_ADR_ELEMENT_KIND_BY_VER } from './forge_abi_snapshot.gen.mjs';

function cloneTyped(view, Ctor) {
  if (!view) return null;
  try {
    if (Ctor) return new Ctor(view);
    if (typeof view.slice === 'function') return view.slice();
    return Array.from(view);
  } catch (err) {
    strictCatch(err, 'bridge:cloneTyped_ctor');
    try {
      if (Ctor && typeof Ctor.from === 'function') return Ctor.from(view);
    } catch (innerErr) {
      strictCatch(innerErr, 'bridge:cloneTyped_from');
    }
    try {
      return Array.from(view);
    } catch (innerErr) {
      strictCatch(innerErr, 'bridge:cloneTyped_array');
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

function validateTextureAdrLayout({ adrView, widthView, heightView, nchannelView, dataLen }) {
  if (!adrView || !widthView || !heightView || !nchannelView) return false;
  const ntex = Math.min(adrView.length, widthView.length, heightView.length, nchannelView.length) | 0;
  if (!(ntex > 0) || !(dataLen > 0)) return false;
  const ranges = [];
  for (let i = 0; i < ntex; i += 1) {
    const w = widthView[i] | 0;
    const h = heightView[i] | 0;
    const ch = nchannelView[i] | 0;
    if (!(w > 0) || !(h > 0) || !(ch > 0)) continue;
    const start = Number(adrView[i]);
    if (!(Number.isFinite(start) && start >= 0)) return false;
    const byteLen = w * h * ch;
    const end = start + byteLen;
    if (!(end >= start && end <= dataLen)) return false;
    ranges.push([start, end]);
  }
  ranges.sort((a, b) => a[0] - b[0]);
  let prevEnd = -1;
  for (const [start, end] of ranges) {
    if (start < prevEnd) return false;
    prevEnd = end;
  }
  return true;
}

function cloneI64ToI32(view, count, { name = 'value' } = {}) {
  if (!view) return null;
  const n = count | 0;
  if (!(n > 0) || view.length < n) return null;
  const out = new Int32Array(n);
  for (let i = 0; i < n; i += 1) {
    const v = view[i];
    const num = Number(v);
    if (!Number.isFinite(num) || !Number.isSafeInteger(num) || !(num >= 0) || num > 0x7fffffff) {
      throw new Error(`[forge] ${name} out of int32 range at index ${i}: ${String(v)}`);
    }
    out[i] = num | 0;
  }
  return out;
}
export function collectRenderAssetsFromModule(mod, handle) {
  if (!mod || !(handle > 0)) return null;
  const ver = String(mod?.__mujocoVer || '');
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
    lights: null,
    materials: null,
    meshes: null,
    hfields: null,
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
  const nlight = ensureFunc('_mjwf_model_nlight').call(mod, handle) | 0;
  if (nlight > 0) {
    const typeView = readView(mod, ensureFunc('_mjwf_model_light_type_ptr'), handle, nlight, heapViewI32);
    const texidView = readView(mod, ensureFunc('_mjwf_model_light_texid_ptr'), handle, nlight, heapViewI32);
    const activeView = readView(mod, ensureFunc('_mjwf_model_light_active_ptr'), handle, nlight, heapViewU8);
    const castshadowView = readView(mod, ensureFunc('_mjwf_model_light_castshadow_ptr'), handle, nlight, heapViewU8);
    const bulbradiusView = readView(mod, ensureFunc('_mjwf_model_light_bulbradius_ptr'), handle, nlight, heapViewF32);
    const intensityView = readView(mod, ensureFunc('_mjwf_model_light_intensity_ptr'), handle, nlight, heapViewF32);
    const rangeView = readView(mod, ensureFunc('_mjwf_model_light_range_ptr'), handle, nlight, heapViewF32);
    const attenuationView = readView(mod, ensureFunc('_mjwf_model_light_attenuation_ptr'), handle, nlight * 3, heapViewF32);
    const cutoffView = readView(mod, ensureFunc('_mjwf_model_light_cutoff_ptr'), handle, nlight, heapViewF32);
    const exponentView = readView(mod, ensureFunc('_mjwf_model_light_exponent_ptr'), handle, nlight, heapViewF32);
    const ambientView = readView(mod, ensureFunc('_mjwf_model_light_ambient_ptr'), handle, nlight * 3, heapViewF32);
    const diffuseView = readView(mod, ensureFunc('_mjwf_model_light_diffuse_ptr'), handle, nlight * 3, heapViewF32);
    const specularView = readView(mod, ensureFunc('_mjwf_model_light_specular_ptr'), handle, nlight * 3, heapViewF32);

    assets.lights = {
      count: nlight,
      type: cloneTyped(typeView, Int32Array),
      texid: cloneTyped(texidView, Int32Array),
      active: cloneTyped(activeView, Uint8Array),
      castshadow: cloneTyped(castshadowView, Uint8Array),
      bulbradius: cloneTyped(bulbradiusView, Float32Array),
      intensity: cloneTyped(intensityView, Float32Array),
      range: cloneTyped(rangeView, Float32Array),
      attenuation: cloneTyped(attenuationView, Float32Array),
      cutoff: cloneTyped(cutoffView, Float32Array),
      exponent: cloneTyped(exponentView, Float32Array),
      ambient: cloneTyped(ambientView, Float32Array),
      diffuse: cloneTyped(diffuseView, Float32Array),
      specular: cloneTyped(specularView, Float32Array),
    };
  }
  const nmat = ensureFunc('_mjwf_model_nmat').call(mod, handle) | 0;
  if (nmat > 0) {
    const rgbaView = readView(mod, ensureFunc('_mjwf_model_mat_rgba_ptr'), handle, nmat * 4, heapViewF32);
    // mjModel material scalar fields are floats (not mjtNum); keep types aligned
    // with mjmodel.h to avoid mis-reading float32 as float64.
    const reflectanceView = readView(mod, ensureFunc('_mjwf_model_mat_reflectance_ptr'), handle, nmat, heapViewF32);
    const emissionView = readView(mod, ensureFunc('_mjwf_model_mat_emission_ptr'), handle, nmat, heapViewF32);
    const specularView = readView(mod, ensureFunc('_mjwf_model_mat_specular_ptr'), handle, nmat, heapViewF32);
    const shininessView = readView(mod, ensureFunc('_mjwf_model_mat_shininess_ptr'), handle, nmat, heapViewF32);
    const metallicView = readView(mod, ensureFunc('_mjwf_model_mat_metallic_ptr'), handle, nmat, heapViewF32);
    const roughnessView = readView(mod, ensureFunc('_mjwf_model_mat_roughness_ptr'), handle, nmat, heapViewF32);
    // mjModel.mat_texid is (nmat x mjNTEXROLE). Simulate uses mjTEXROLE_RGB for
    // regular textures, so we need all roles.
    const texidView = readView(mod, ensureFunc('_mjwf_model_mat_texid_ptr'), handle, nmat * 10, heapViewI32);
    const texrepeatView = readView(mod, ensureFunc('_mjwf_model_mat_texrepeat_ptr'), handle, nmat * 2, heapViewF32);
    const texuniformView = readView(mod, ensureFunc('_mjwf_model_mat_texuniform_ptr'), handle, nmat, heapViewU8);
    assets.materials = {
      count: nmat,
      rgba: cloneTyped(rgbaView, Float32Array),
      reflectance: cloneTyped(reflectanceView, Float32Array),
      emission: cloneTyped(emissionView, Float32Array),
      specular: cloneTyped(specularView, Float32Array),
      shininess: cloneTyped(shininessView, Float32Array),
      metallic: cloneTyped(metallicView, Float32Array),
      roughness: cloneTyped(roughnessView, Float32Array),
      texid: cloneTyped(texidView, Int32Array),
      texrepeat: cloneTyped(texrepeatView, Float32Array),
      texuniform: cloneTyped(texuniformView, Uint8Array),
    };
  }
  const nmesh = ensureFunc('_mjwf_model_nmesh').call(mod, handle) | 0;
  if (nmesh > 0) {
    const vertAdr = readView(mod, ensureFunc('_mjwf_model_mesh_vertadr_ptr'), handle, nmesh, heapViewI32);
    const vertNum = readView(mod, ensureFunc('_mjwf_model_mesh_vertnum_ptr'), handle, nmesh, heapViewI32);
    const faceAdr = readView(mod, ensureFunc('_mjwf_model_mesh_faceadr_ptr'), handle, nmesh, heapViewI32);
    const faceNum = readView(mod, ensureFunc('_mjwf_model_mesh_facenum_ptr'), handle, nmesh, heapViewI32);
    const normalAdr = readView(mod, ensureFunc('_mjwf_model_mesh_normaladr_ptr'), handle, nmesh, heapViewI32);
    const normalNum = readView(mod, ensureFunc('_mjwf_model_mesh_normalnum_ptr'), handle, nmesh, heapViewI32);
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
    let normalElemCount = 0;
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
    if (!(vertElemCount > 0) || !(faceElemCount > 0) || !(texcoordElemCount > 0) || !(normalElemCount > 0)) {
      const counts = computeMeshElementCounts(
        vertAdr,
        vertNum,
        faceAdr,
        faceNum,
        texCoordAdr,
        texCoordNum,
        normalAdr,
        normalNum,
      );
      if (!(vertElemCount > 0)) vertElemCount = counts.vert | 0;
      if (!(faceElemCount > 0)) faceElemCount = counts.face | 0;
      if (!(texcoordElemCount > 0)) texcoordElemCount = counts.texcoord | 0;
      if (!(normalElemCount > 0)) normalElemCount = counts.normal | 0;
    }
    const vertView = readView(mod, ensureFunc('_mjwf_model_mesh_vert_ptr'), handle, Math.max(0, vertElemCount), heapViewF32);
    const faceView = readView(mod, ensureFunc('_mjwf_model_mesh_face_ptr'), handle, Math.max(0, faceElemCount), heapViewI32);
    const normalView = readView(
      mod,
      ensureFunc('_mjwf_model_mesh_normal_ptr'),
      handle,
      Math.max(0, normalElemCount > 0 ? normalElemCount : vertElemCount),
      heapViewF32,
    );
    const faceNormalView = readView(
      mod,
      ensureFunc('_mjwf_model_mesh_facenormal_ptr'),
      handle,
      Math.max(0, faceElemCount),
      heapViewI32,
    );
    const texcoordView = readView(
      mod,
      ensureFunc('_mjwf_model_mesh_texcoord_ptr'),
      handle,
      Math.max(0, texcoordElemCount),
      heapViewF32,
    );
    const faceTexcoordView = readView(
      mod,
      ensureFunc('_mjwf_model_mesh_facetexcoord_ptr'),
      handle,
      Math.max(0, faceElemCount),
      heapViewI32,
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
      normaladr: cloneTyped(normalAdr, Int32Array),
      normalnum: cloneTyped(normalNum, Int32Array),
      texcoordadr: cloneTyped(texCoordAdr, Int32Array),
      texcoordnum: cloneTyped(texCoordNum, Int32Array),
      vert: cloneTyped(vertView, Float32Array),
      face: cloneTyped(faceView, Int32Array),
      normal: cloneTyped(normalView, Float32Array),
      facenormal: cloneTyped(faceNormalView, Int32Array),
      texcoord: cloneTyped(texcoordView, Float32Array),
      facetexcoord: cloneTyped(faceTexcoordView, Int32Array),
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
  const nhfield = ensureFunc('_mjwf_model_nhfield').call(mod, handle) | 0;
  if (nhfield > 0) {
    const sizeView = readView(mod, ensureFunc('_mjwf_model_hfield_size_ptr'), handle, nhfield * 4, heapViewF64);
    const nrowView = readView(mod, ensureFunc('_mjwf_model_hfield_nrow_ptr'), handle, nhfield, heapViewI32);
    const ncolView = readView(mod, ensureFunc('_mjwf_model_hfield_ncol_ptr'), handle, nhfield, heapViewI32);
    const adrView = readView(mod, ensureFunc('_mjwf_model_hfield_adr_ptr'), handle, nhfield, heapViewI32);
    const dataLen = ensureFunc('_mjwf_model_nhfielddata').call(mod, handle) | 0;
    const dataView = dataLen > 0
      ? readView(mod, ensureFunc('_mjwf_model_hfield_data_ptr'), handle, dataLen, heapViewF32)
      : null;
    assets.hfields = {
      count: nhfield,
      size: cloneTyped(sizeView, Float64Array),
      nrow: cloneTyped(nrowView, Int32Array),
      ncol: cloneTyped(ncolView, Int32Array),
      adr: cloneTyped(adrView, Int32Array),
      data: cloneTyped(dataView, Float32Array),
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
    const texColorspaceView = readView(mod, ensureFunc('_mjwf_model_tex_colorspace_ptr'), handle, ntex, heapViewI32);
    const dataLen = ensureFunc('_mjwf_model_ntexdata').call(mod, handle) | 0;
    const dataPtr = ensureFunc('_mjwf_model_tex_data_ptr').call(mod, handle) | 0;
    const texData = (dataLen > 0 && dataPtr > 0) ? heapViewU8(mod, dataPtr, dataLen) : null;

    const kind = MJMODEL_TEX_ADR_ELEMENT_KIND_BY_VER?.[ver] || '';
    if (!kind) {
      throw new Error(
        `[forge] Unsupported MuJoCo version for mjModel.tex_adr ABI: ${ver || '<missing>'}. ` +
        `Regenerate bridge/forge_abi_snapshot.gen.mjs via tools/generate_forge_abi_snapshot.mjs.`,
      );
    }
    let texAdrOut = null;
    if (kind === 'i64') {
      const texAdrViewI64 = readView(mod, ensureFunc('_mjwf_model_tex_adr_ptr'), handle, ntex, heapViewI64);
      texAdrOut = cloneI64ToI32(texAdrViewI64, ntex, { name: 'tex_adr(mjtSize)' });
    } else if (kind === 'i32') {
      const texAdrViewI32 = readView(mod, ensureFunc('_mjwf_model_tex_adr_ptr'), handle, ntex, heapViewI32);
      texAdrOut = cloneTyped(texAdrViewI32, Int32Array);
    } else {
      throw new Error(`[forge] Unsupported tex_adr element kind: ${kind}`);
    }

    const adrOk = validateTextureAdrLayout({
      adrView: texAdrOut,
      widthView: texWidthView,
      heightView: texHeightView,
      nchannelView: texNChannelView,
      dataLen,
    });
    if (!adrOk) {
      throw new Error('[forge] Invalid tex_adr layout: cannot map textures into tex_data buffer');
    }
    assets.textures = {
      count: ntex,
      type: cloneTyped(texTypeView, Int32Array),
      width: cloneTyped(texWidthView, Int32Array),
      height: cloneTyped(texHeightView, Int32Array),
      nchannel: cloneTyped(texNChannelView, Int32Array),
      adr: texAdrOut,
      colorspace: cloneTyped(texColorspaceView, Int32Array),
      data: cloneTyped(texData, Uint8Array),
    };
  }
  return assets;
}

