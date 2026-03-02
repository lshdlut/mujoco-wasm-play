// Minimal MuJoCo simulator wrapper for the forge/WASM module.

import { logError, strictCatch } from '../core/viewer_runtime.mjs';
import { computeMeshElementCounts, heapViewF64, heapViewF32, heapViewI32, heapViewU8, readCString, resolveHeapBuffer } from './heap_views.mjs';

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
  try { mod.__forgeModuleId = id; } catch (err) { strictCatch(err, 'bridge:tagForgeModule'); }
  return id;
}

const MJ_STATE_INTEGRATION = 0x1fff;

export class MjSimLite {
  constructor(mod) {
    this.mod = mod;
    this.modId = tagForgeModule(mod);
    this.h = 0;
    this.contactForceScratch = null;
    this._countCache = null;
    this._countCacheHandle = 0;
    this._ptrCache = new Map();
    this._ptrCacheHandle = 0;
    this._sceneNgeomCache = null;
    this._sceneNgeomCacheHandle = 0;
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
      } catch (err) {
        strictCatch(err, 'bridge:registerModule');
      }
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
    // Keep directory creation idempotent and strict: MuJoCo resolves relative file references
    // (e.g. `<model file="humanoid.xml">`) from the entry XML path, so we must not "fall back"
    // to a different entry filename due to swallowed FS errors.
    if (!path) return;
    const FS = this.mod?.FS;
    if (!FS || typeof FS.mkdir !== 'function') {
      throw new Error('FS unavailable');
    }
    const raw = String(path);
    if (!raw) return;

    if (typeof FS.mkdirTree === 'function') {
      try {
        FS.mkdirTree(raw);
      } catch (err) {
        strictCatch(err, 'bridge:mkdirTree');
        throw err;
      }
      return;
    }

    if (typeof FS.analyzePath !== 'function') {
      throw new Error('FS.analyzePath unavailable');
    }
    const parts = raw.split('/').filter(Boolean);
    let cur = '';
    for (const part of parts) {
      cur += `/${part}`;
      const analyzed = FS.analyzePath(cur);
      if (analyzed?.exists) {
        const mode = analyzed.object?.mode;
        if (typeof FS.isDir === 'function' && mode != null && !FS.isDir(mode)) {
          throw new Error(`Expected directory but found file: ${cur}`);
        }
        continue;
      }
      FS.mkdir(cur);
    }
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

  // Strict helper path: write XML + referenced files to FS and call mjwf_helper_make_from_xml.
  initFromXmlStrict(xmlText, options = null){
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

    const files = Array.isArray(options?.files) ? options.files : null;
    if (files && files.length) {
      for (const entry of files) {
        const target = typeof entry?.path === 'string' ? entry.path : String(entry?.path ?? '');
        if (!target || !target.trim()) {
          throw new Error('initFromXmlStrict: file entry missing path');
        }
        const data = entry?.data;
        let bytes = null;
        if (data instanceof ArrayBuffer) {
          bytes = new Uint8Array(data);
        } else if (ArrayBuffer.isView(data) && data.buffer instanceof ArrayBuffer) {
          bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
        } else {
          throw new Error(`initFromXmlStrict: unsupported file payload for ${target}`);
        }
        try {
          if (target.includes('/')) {
            const dir = target.slice(0, target.lastIndexOf('/'));
            if (dir) this._mkdirTree(dir);
          }
          m.FS.writeFile(target, bytes);
        } catch (err) {
          strictCatch(err, 'bridge:write_ref_file', { target });
          throw err;
        }
      }
    }
    // FS path only: write XML to helper targets then call helper wrapper with PATH.
    const xmlStr = String(xmlText);
    const bytes = new TextEncoder().encode(xmlStr);
    const primaryTarget = (typeof options?.xmlPath === 'string' && options.xmlPath.trim().length)
      ? String(options.xmlPath)
      : '';
    const helperTargets = primaryTarget
      ? [primaryTarget]
      : ['/mem/model.xml','/model.xml','model.xml'];
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
      const detail = emsg ? `: ${emsg}` : (eno ? `: errno=${eno}` : '');
      throw new Error(`make_from_xml failed${detail}`);
    }
    this._validateHandleOrThrow(h);
    this.h = h;
    this._invalidateCaches();
  }

  _invalidateCaches(){
    this._countCache = null;
    this._countCacheHandle = 0;
    this._sceneNgeomCache = null;
    this._sceneNgeomCacheHandle = 0;
    this._ptrCacheHandle = 0;
    if (this._ptrCache) this._ptrCache.clear();
    else this._ptrCache = new Map();
    try {
      const state = this.mod?.__heapViewCache;
      if (state?.map instanceof Map) state.map.clear();
    } catch (err) {
      strictCatch(err, 'bridge:invalidate_heapViewCache');
    }
  }

  _ensurePtrCache(){
    const h = this.h | 0;
    if (!(h > 0)) return null;
    if (this._ptrCacheHandle !== h) {
      this._ptrCacheHandle = h;
      if (this._ptrCache) this._ptrCache.clear();
      else this._ptrCache = new Map();
    }
    return this._ptrCache;
  }

  _cachedPtr(fnName){
    const cache = this._ensurePtrCache();
    if (!cache) return 0;
    if (cache.has(fnName)) return cache.get(fnName) | 0;
    const m = this.mod;
    const fn = m?.[fnName];
    const ptr = typeof fn === 'function' ? (fn.call(m, this.h | 0) | 0) : 0;
    cache.set(fnName, ptr);
    return ptr | 0;
  }

  _ensureCountCache(){
    const h = this.h | 0;
    if (!(h > 0)) return null;
    if (this._countCache && this._countCacheHandle === h) return this._countCache;
    const m = this.mod;
    const call = (name) => {
      const fn = m?.[name];
      if (typeof fn !== 'function') return 0;
      return (fn.call(m, h) | 0) || 0;
    };
    const cache = {
      nq: call('_mjwf_model_nq'),
      nv: call('_mjwf_model_nv'),
      nu: call('_mjwf_model_nu'),
      njnt: call('_mjwf_model_njnt'),
      ncam: call('_mjwf_model_ncam'),
      nlight: call('_mjwf_model_nlight'),
      nsite: call('_mjwf_model_nsite'),
      nflex: call('_mjwf_model_nflex'),
      nflexvert: call('_mjwf_model_nflexvert'),
      ntendon: call('_mjwf_model_ntendon'),
      nwrap: call('_mjwf_model_nwrap'),
      nsensor: call('_mjwf_model_nsensor'),
      nsensordata: call('_mjwf_model_nsensordata'),
      neq: call('_mjwf_model_neq'),
      ngeom: call('_mjwf_model_ngeom'),
      nbody: call('_mjwf_model_nbody'),
      nkey: call('_mjwf_model_nkey'),
      nbvh: call('_mjwf_model_nbvh'),
      nbvhdynamic: call('_mjwf_model_nbvhdynamic'),
    };
    this._countCache = cache;
    this._countCacheHandle = h;
    return cache;
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
  nq(){ const c=this._ensureCountCache(); return c ? (c.nq|0) : 0; }
  nv(){ const c=this._ensureCountCache(); return c ? (c.nv|0) : 0; }
  nu(){ const c=this._ensureCountCache(); return c ? (c.nu|0) : 0; }
  njnt(){ const c=this._ensureCountCache(); return c ? (c.njnt|0) : 0; }
  ncam(){ const c=this._ensureCountCache(); return c ? (c.ncam|0) : 0; }
  nlight(){ const c=this._ensureCountCache(); return c ? (c.nlight|0) : 0; }
  nsite(){ const c=this._ensureCountCache(); return c ? (c.nsite|0) : 0; }
  nflex(){ const c=this._ensureCountCache(); return c ? (c.nflex|0) : 0; }
  nflexvert(){ const c=this._ensureCountCache(); return c ? (c.nflexvert|0) : 0; }
  ntendon(){ const c=this._ensureCountCache(); return c ? (c.ntendon|0) : 0; }
  nwrap(){ const c=this._ensureCountCache(); return c ? (c.nwrap|0) : 0; }
  nsensor(){ const c=this._ensureCountCache(); return c ? (c.nsensor|0) : 0; }
  nsensordata(){ const c=this._ensureCountCache(); return c ? (c.nsensordata|0) : 0; }
  neq(){ const c=this._ensureCountCache(); return c ? (c.neq|0) : 0; }

  // --- State views ---
  qposView(){
    const m=this.mod; const n=this.nq(); if(!n)return;
    const p=this._cachedPtr('_mjwf_data_qpos_ptr')|0; if(!p)return;
    return heapViewF64(m,p,n);
  }
  qvelView(){
    const m=this.mod; const n=this.nv(); if(!n)return;
    const p=this._cachedPtr('_mjwf_data_qvel_ptr')|0; if(!p)return;
    return heapViewF64(m,p,n);
  }
  ctrlView(){
    const m=this.mod; const n=this.nu(); if(!n)return;
    const p=this._cachedPtr('_mjwf_data_ctrl_ptr')|0; if(!p)return;
    return heapViewF64(m,p,n);
  }
  actuatorCtrlRangeView(){ const m=this.mod; const n=this.nu(); if(!(n>0)) return; const p=this._cachedPtr('_mjwf_model_actuator_ctrlrange_ptr')|0; if(!p) return; return heapViewF64(m,p,n*2); }
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
  flexvertXposView(){ const m=this.mod; const n=this.nflexvert()|0; if(!(n>0)) return null; const p=this._cachedPtr('_mjwf_data_flexvert_xpos_ptr')|0; if(!p) return null; return heapViewF64(m,p,n*3); }
  sensorTypeView(){ const m=this.mod; const h=this.h|0; const n=this.nsensor()|0; if(!n)return; const d=m._mjwf_model_sensor_type_ptr; if (typeof d!=='function') return; const p=d.call(m,h)|0; if(!p)return; return heapViewI32(m,p,n); }
  sensorObjIdView(){ const m=this.mod; const h=this.h|0; const n=this.nsensor()|0; if(!n)return; const d=m._mjwf_model_sensor_objid_ptr; if (typeof d!=='function') return; const p=d.call(m,h)|0; if(!p)return; return heapViewI32(m,p,n); }
  eqTypeView(){ const m=this.mod; const n=this.neq()|0; if(!n)return; const p=this._cachedPtr('_mjwf_model_eq_type_ptr')|0; if(!p)return; return heapViewI32(m,p,n); }
  eqObj1IdView(){ const m=this.mod; const n=this.neq()|0; if(!n)return; const p=this._cachedPtr('_mjwf_model_eq_obj1id_ptr')|0; if(!p)return; return heapViewI32(m,p,n); }
  eqObj2IdView(){ const m=this.mod; const n=this.neq()|0; if(!n)return; const p=this._cachedPtr('_mjwf_model_eq_obj2id_ptr')|0; if(!p)return; return heapViewI32(m,p,n); }
  eqObjTypeView(){ const m=this.mod; const n=this.neq()|0; if(!n)return; const p=this._cachedPtr('_mjwf_model_eq_objtype_ptr')|0; if(!p)return; return heapViewI32(m,p,n); }
  eqDataView(){ const m=this.mod; const n=this.neq()|0; if(!n)return; const p=this._cachedPtr('_mjwf_model_eq_data_ptr')|0; if(!p)return; return heapViewF64(m,p,n*11); }
  eqActiveView(){ const m=this.mod; const n=this.neq()|0; if(!n)return; const p=this._cachedPtr('_mjwf_data_eq_active_ptr')|0; if(!p)return; return heapViewU8(m,p,n); }
  eqActive0View(){ const m=this.mod; const n=this.neq()|0; if(!n)return; const p=this._cachedPtr('_mjwf_model_eq_active0_ptr')|0; if(!p)return; return heapViewU8(m,p,n); }
  id2name(objtype, objid){ const m=this.mod; const h=this.h|0; const fn = m['_mjwf_mj_id2name']; if (typeof fn!=='function') return ''; const p=fn.call(m,h, objtype|0, objid|0)|0; if(!p) return ''; return this._cstr(p); }
  camXposView(){ const m=this.mod; const h=this.h|0; const n=this.ncam(); if(!(n>0)) return; const d=m._mjwf_data_cam_xpos_ptr; if (typeof d!=='function') return; const p=d.call(m,h)|0; if(!p) return; return heapViewF64(m,p,n*3); }
  camXmatView(){ const m=this.mod; const h=this.h|0; const n=this.ncam(); if(!(n>0)) return; const d=m._mjwf_data_cam_xmat_ptr; if (typeof d!=='function') return; const p=d.call(m,h)|0; if(!p) return; return heapViewF64(m,p,n*9); }
  lightXposView(){ const m=this.mod; const n=this.nlight(); if(!(n>0)) return; const p=this._cachedPtr('_mjwf_data_light_xpos_ptr')|0; if(!p) return; return heapViewF64(m,p,n*3); }
  lightXdirView(){ const m=this.mod; const n=this.nlight(); if(!(n>0)) return; const p=this._cachedPtr('_mjwf_data_light_xdir_ptr')|0; if(!p) return; return heapViewF64(m,p,n*3); }
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
    const c=this._ensureCountCache();
    return c ? (c.nkey|0) : 0;
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

  _readPtr(owner,name){
    const h = this.h | 0;
    if (!(h > 0)) return 0;
    return this._cachedPtr(`_mjwf_${owner}_${name}_ptr`) | 0;
  }
  _readModelPtr(name){ return this._readPtr('model', name); }
  _readDataPtr(name){ return this._readPtr('data', name); }

  _withStack(bytes, cb){
    const mod = this.mod;
    if (!mod) return null;
    if (typeof mod.stackSave === 'function' && typeof mod.stackAlloc === 'function' && typeof mod.stackRestore === 'function') {
      let sp = 0;
      try { sp = mod.stackSave(); } catch (err) { strictCatch(err, 'bridge:stackSave'); sp = 0; }
      let ptr = 0;
      try { ptr = mod.stackAlloc(bytes) | 0; } catch (err) { strictCatch(err, 'bridge:stackAlloc'); ptr = 0; }
      if (!(ptr > 0)) {
        if (sp) {
          try { mod.stackRestore(sp); } catch (err) { strictCatch(err, 'bridge:stackRestore'); }
        }
        return null;
      }
      try {
        return cb(ptr | 0);
      } finally {
        try { mod.stackRestore(sp); } catch (err) { strictCatch(err, 'bridge:stackRestore'); }
      }
    }
    if (typeof mod._malloc === 'function' && typeof mod._free === 'function') {
      let ptr = 0;
      try { ptr = mod._malloc(bytes) | 0; } catch (err) { strictCatch(err, 'bridge:malloc'); ptr = 0; }
      if (!(ptr > 0)) return null;
      try {
        return cb(ptr | 0);
      } finally {
        try { mod._free(ptr); } catch (err) { strictCatch(err, 'bridge:free'); }
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
    try { ptr = mod._malloc(bytes) | 0; } catch (err) { strictCatch(err, 'bridge:malloc'); ptr = 0; }
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
      try { sp = mod.stackSave(); } catch (err) { strictCatch(err, 'bridge:stackSave'); sp = 0; }
      let ptr = 0;
      try { ptr = mod.stackAlloc(bytes) | 0; } catch (err) { strictCatch(err, 'bridge:stackAlloc'); ptr = 0; }
      if (!(ptr > 0)) {
        if (sp) {
          try { mod.stackRestore(sp); } catch (err) { strictCatch(err, 'bridge:stackRestore'); }
        }
        return null;
      }
      const view = heapViewF64(mod, ptr, 6);
      if (!view || view.length < 3) {
        try { mod.stackRestore(sp); } catch (err) { strictCatch(err, 'bridge:stackRestore'); }
        return null;
      }
      return {
        ptr,
        view,
        release: () => {
          try { mod.stackRestore(sp); } catch (err) { strictCatch(err, 'bridge:stackRestore'); }
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
      try { mod._free(ptr); } catch (err) { strictCatch(err, 'bridge:free'); }
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
      strictCatch(err, 'bridge:pointerDiagnostics');
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

  ngeom(){ const c=this._ensureCountCache(); return c ? (c.ngeom|0) : 0; }
  nbody(){ const c=this._ensureCountCache(); return c ? (c.nbody|0) : 0; }
  bodyJntAdrView(){ const m=this.mod; const h=this.h|0; const n=this.nbody()|0; if(!(n>0)) return null; const fn=m?._mjwf_model_body_jntadr_ptr; if (typeof fn!=='function') return null; const ptr=fn.call(m,h)|0; if(!(ptr>0)) return null; return heapViewI32(m, ptr, n); }
  bodyJntNumView(){ const m=this.mod; const h=this.h|0; const n=this.nbody()|0; if(!(n>0)) return null; const fn=m?._mjwf_model_body_jntnum_ptr; if (typeof fn!=='function') return null; const ptr=fn.call(m,h)|0; if(!(ptr>0)) return null; return heapViewI32(m, ptr, n); }
  bodyParentIdView(){ const m=this.mod; const h=this.h|0; const n=this.nbody()|0; if(!(n>0)) return null; const fn=m?._mjwf_model_body_parentid_ptr; if (typeof fn!=='function') return null; const ptr=fn.call(m,h)|0; if(!(ptr>0)) return null; return heapViewI32(m, ptr, n); }

  geomXposView(){ const m=this.mod; const n=this.ngeom(); if(!n)return; const p=this._cachedPtr('_mjwf_data_geom_xpos_ptr')|0; if(!p)return; return heapViewF64(m,p,n*3); }
  geomXmatView(){ const m=this.mod; const n=this.ngeom(); if(!n)return; const p=this._cachedPtr('_mjwf_data_geom_xmat_ptr')|0; if(!p)return; return heapViewF64(m,p,n*9); }
  bodyXposView(){ const m=this.mod; const n=this.nbody(); if(!n)return; const p=this._cachedPtr('_mjwf_data_xpos_ptr')|0; if(!p)return; return heapViewF64(m,p,n*3); }
  bodyXmatView(){ const m=this.mod; const n=this.nbody(); if(!n)return; const p=this._cachedPtr('_mjwf_data_xmat_ptr')|0; if(!p)return; return heapViewF64(m,p,n*9); }
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
    const c=this._ensureCountCache();
    return c ? (c.nbvh|0) : 0;
  }
  nbvhdynamic(){
    const c=this._ensureCountCache();
    return c ? (c.nbvhdynamic|0) : 0;
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
      } catch (err) {
        strictCatch(err, 'bridge:quat2Vel');
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
    try { ptr = fn.call(m, this.h | 0) | 0; } catch (err) { strictCatch(err, 'bridge:bodyInertiaScalar_ptr'); ptr = 0; }
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
    } catch (err) {
      strictCatch(err, 'bridge:bodyWorldVelocity_pointers');
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
      } catch (err) {
        strictCatch(err, 'bridge:bodyWorldVelocity_call');
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
    } catch (err) {
      strictCatch(err, 'bridge:bodyLocalMass_pointers');
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
      } catch (err) {
        strictCatch(err, 'bridge:bodyLocalMass_call');
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
  geomSizeView(){ const m=this.mod; const n=this.ngeom(); if(!n)return; const p=this._cachedPtr('_mjwf_model_geom_size_ptr')|0; if(!p)return; return heapViewF64(m,p,n*3); }
  geomTypeView(){ const m=this.mod; const n=this.ngeom(); if(!n)return; const p=this._cachedPtr('_mjwf_model_geom_type_ptr')|0; if(!p)return; return heapViewI32(m,p,n); }
  geomMatIdView(){ const m=this.mod; const n=this.ngeom(); if(!n)return; const p=this._cachedPtr('_mjwf_model_geom_matid_ptr')|0; if(!p)return; return heapViewI32(m,p,n); }
  geomDataidView(){ const m=this.mod; const n=this.ngeom(); if(!n)return; const p=this._cachedPtr('_mjwf_model_geom_dataid_ptr')|0; if(!p)return; return heapViewI32(m,p,n); }
  geomBodyIdView(){ const m=this.mod; const n=this.ngeom()|0; if(!(n>0)) return null; const p=this._cachedPtr('_mjwf_model_geom_bodyid_ptr')|0; if(!(p>0)) return null; return heapViewI32(m, p, n); }
  // mjvScene SoA (forge scene API; SoA packed in wasm, copied by worker)
  sceneUpdateAndPack(catmask = 7){ const m=this.mod; const h=this.h|0; const fn=m?._mjwf_scene_update_and_pack; if (typeof fn!=='function' || !(h>0)) return 0; const out=fn.call(m, h, catmask|0) | 0; this._sceneNgeomCache=null; this._sceneNgeomCacheHandle=0; return out; }
  sceneNgeom(){ const h=this.h|0; if(!(h>0)) return 0; if (this._sceneNgeomCache != null && this._sceneNgeomCacheHandle === h) return this._sceneNgeomCache | 0; const m=this.mod; const fn=m?._mjwf_scene_ngeom; if (typeof fn!=='function') return 0; const out=fn.call(m, h) | 0; this._sceneNgeomCache=out|0; this._sceneNgeomCacheHandle=h; return out | 0; }
  sceneGeomOrderView(){ const m=this.mod; const n=this.sceneNgeom()|0; if(!(n>0)) return null; const ptr=this._cachedPtr('_mjwf_scene_geomorder_ptr')|0; if(!(ptr>0)) return null; return heapViewI32(m, ptr, n); }
  sceneGeomCamDistView(){ const m=this.mod; const n=this.sceneNgeom()|0; if(!(n>0)) return null; const ptr=this._cachedPtr('_mjwf_scene_geoms_camdist_ptr')|0; if(!(ptr>0)) return null; return heapViewF32(m, ptr, n); }
  sceneGeomTypeView(){ const m=this.mod; const n=this.sceneNgeom()|0; if(!(n>0)) return null; const ptr=this._cachedPtr('_mjwf_scene_geoms_type_ptr')|0; if(!(ptr>0)) return null; return heapViewI32(m, ptr, n); }
  sceneGeomPosView(){ const m=this.mod; const n=this.sceneNgeom()|0; if(!(n>0)) return null; const ptr=this._cachedPtr('_mjwf_scene_geoms_pos_ptr')|0; if(!(ptr>0)) return null; return heapViewF32(m, ptr, n*3); }
  sceneGeomMatView(){ const m=this.mod; const n=this.sceneNgeom()|0; if(!(n>0)) return null; const ptr=this._cachedPtr('_mjwf_scene_geoms_mat_ptr')|0; if(!(ptr>0)) return null; return heapViewF32(m, ptr, n*9); }
  sceneGeomSizeView(){ const m=this.mod; const n=this.sceneNgeom()|0; if(!(n>0)) return null; const ptr=this._cachedPtr('_mjwf_scene_geoms_size_ptr')|0; if(!(ptr>0)) return null; return heapViewF32(m, ptr, n*3); }
  sceneGeomRgbaView(){ const m=this.mod; const n=this.sceneNgeom()|0; if(!(n>0)) return null; const ptr=this._cachedPtr('_mjwf_scene_geoms_rgba_ptr')|0; if(!(ptr>0)) return null; return heapViewF32(m, ptr, n*4); }
  sceneGeomMatIdView(){ const m=this.mod; const n=this.sceneNgeom()|0; if(!(n>0)) return null; const ptr=this._cachedPtr('_mjwf_scene_geoms_matid_ptr')|0; if(!(ptr>0)) return null; return heapViewI32(m, ptr, n); }
  sceneGeomDataIdView(){ const m=this.mod; const n=this.sceneNgeom()|0; if(!(n>0)) return null; const ptr=this._cachedPtr('_mjwf_scene_geoms_dataid_ptr')|0; if(!(ptr>0)) return null; return heapViewI32(m, ptr, n); }
  sceneGeomObjTypeView(){ const m=this.mod; const n=this.sceneNgeom()|0; if(!(n>0)) return null; const ptr=this._cachedPtr('_mjwf_scene_geoms_objtype_ptr')|0; if(!(ptr>0)) return null; return heapViewI32(m, ptr, n); }
  sceneGeomObjIdView(){ const m=this.mod; const n=this.sceneNgeom()|0; if(!(n>0)) return null; const ptr=this._cachedPtr('_mjwf_scene_geoms_objid_ptr')|0; if(!(ptr>0)) return null; return heapViewI32(m, ptr, n); }
  sceneGeomCategoryView(){ const m=this.mod; const n=this.sceneNgeom()|0; if(!(n>0)) return null; const ptr=this._cachedPtr('_mjwf_scene_geoms_category_ptr')|0; if(!(ptr>0)) return null; return heapViewI32(m, ptr, n); }
  sceneGeomSegIdView(){ const m=this.mod; const n=this.sceneNgeom()|0; if(!(n>0)) return null; const ptr=this._cachedPtr('_mjwf_scene_geoms_segid_ptr')|0; if(!(ptr>0)) return null; return heapViewI32(m, ptr, n); }
  sceneGeomTransparentView(){ const m=this.mod; const n=this.sceneNgeom()|0; if(!(n>0)) return null; const ptr=this._cachedPtr('_mjwf_scene_geoms_transparent_ptr')|0; if(!(ptr>0)) return null; return heapViewU8(m, ptr, n); }
  sceneGeomLabelView(){ const m=this.mod; const n=this.sceneNgeom()|0; if(!(n>0)) return null; const ptr=this._cachedPtr('_mjwf_scene_geoms_label_ptr')|0; if(!(ptr>0)) return null; const stride=100; return heapViewU8(m, ptr, n*stride); }
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

