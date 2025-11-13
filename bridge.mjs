// Minimal browser-only bridge: heap views + MjSimLite (no Node deps)

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

export function heapViewF64(mod, ptr, length) {
  return createHeapTypedArray(mod, ptr, length, Float64Array);
}
export function heapViewF32(mod, ptr, length) {
  return createHeapTypedArray(mod, ptr, length, Float32Array);
}
export function heapViewI32(mod, ptr, length) {
  return createHeapTypedArray(mod, ptr, length, Int32Array);
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
  if (typeof fn !== 'function' || !(handle > 0) || !(length > 0)) return null;
  try {
    const ptr = fn.call(mod, handle) | 0;
    if (!ptr) return null;
    return reader(mod, ptr, length);
  } catch {
    return null;
  }
}
export function collectRenderAssetsFromModule(mod, handle) {
  if (!mod || !(handle > 0)) return null;
  const assets = {
    version: 1,
    geoms: null,
    materials: null,
    meshes: null,
    extras: {},
  };
  const diagnostics = {
    missingFuncs: [],
    zeroPointers: [],
  };
  const ensureFunc = (name) => {
    const fn = mod?.[name];
    if (typeof fn !== 'function') {
      if (!diagnostics.missingFuncs.includes(name)) {
        diagnostics.missingFuncs.push(name);
      }
      return null;
    }
    return fn;
  };
  const ngeom = typeof mod._mjwf_ngeom === 'function' ? (mod._mjwf_ngeom(handle) | 0) : 0;
  if (ngeom > 0) {
    const sizeView = readView(mod, ensureFunc('_mjwf_geom_size_ptr'), handle, ngeom * 3, heapViewF64);
    const typeView = readView(mod, ensureFunc('_mjwf_geom_type_ptr'), handle, ngeom, heapViewI32);
    const matidView = readView(mod, ensureFunc('_mjwf_geom_matid_ptr'), handle, ngeom, heapViewI32);
    const bodyIdView = readView(mod, ensureFunc('_mjwf_geom_bodyid_ptr'), handle, ngeom, heapViewI32);
    const dataIdView = readView(mod, ensureFunc('_mjwf_geom_dataid_ptr'), handle, ngeom, heapViewI32);
    const groupView = readView(mod, ensureFunc('_mjwf_geom_group_ptr'), handle, ngeom, heapViewI32);
    assets.geoms = {
      count: ngeom,
      size: cloneTyped(sizeView, Float64Array),
      type: cloneTyped(typeView, Int32Array),
      matid: cloneTyped(matidView, Int32Array),
      bodyid: cloneTyped(bodyIdView, Int32Array),
      dataid: cloneTyped(dataIdView, Int32Array),
      group: cloneTyped(groupView, Int32Array),
    };
  }
  const nmat = typeof mod._mjwf_nmat === 'function' ? (mod._mjwf_nmat(handle) | 0) : 0;
  if (nmat > 0) {
    const rgbaView = readView(mod, mod._mjwf_mat_rgba_ptr, handle, nmat * 4, heapViewF32);
    assets.materials = {
      count: nmat,
      rgba: cloneTyped(rgbaView, Float32Array),
    };
  }
  const nmesh = typeof mod._mjwf_nmesh === 'function' ? (mod._mjwf_nmesh(handle) | 0) : 0;
  if (nmesh > 0) {
    const vertAdr = readView(mod, ensureFunc('_mjwf_mesh_vertadr_ptr'), handle, nmesh, heapViewI32);
    const vertNum = readView(mod, ensureFunc('_mjwf_mesh_vertnum_ptr'), handle, nmesh, heapViewI32);
    const faceAdr = readView(mod, ensureFunc('_mjwf_mesh_faceadr_ptr'), handle, nmesh, heapViewI32);
    const faceNum = readView(mod, ensureFunc('_mjwf_mesh_facenum_ptr'), handle, nmesh, heapViewI32);
    const texCoordAdr = ensureFunc('_mjwf_mesh_texcoordadr_ptr')
      ? readView(mod, mod._mjwf_mesh_texcoordadr_ptr, handle, nmesh, heapViewI32)
      : null;
    const texCoordNum = ensureFunc('_mjwf_mesh_texcoordnum_ptr')
      ? readView(mod, mod._mjwf_mesh_texcoordnum_ptr, handle, nmesh, heapViewI32)
      : null;
    const vertCountFn = ensureFunc('_mjwf_mesh_vert_count');
    const faceCountFn = ensureFunc('_mjwf_mesh_face_count');
    const texcoordCountFn = ensureFunc('_mjwf_mesh_texcoord_count');
    const vertCount = vertCountFn ? (vertCountFn.call(mod, handle) | 0) : 0;
    const faceCount = faceCountFn ? (faceCountFn.call(mod, handle) | 0) : 0;
    const texcoordCount = texcoordCountFn ? (texcoordCountFn.call(mod, handle) | 0) : 0;
    const vertView = readView(mod, ensureFunc('_mjwf_mesh_vert_ptr'), handle, Math.max(0, vertCount * 3), heapViewF32);
    const faceView = readView(mod, ensureFunc('_mjwf_mesh_face_ptr'), handle, Math.max(0, faceCount * 3), heapViewI32);
    const normalView = ensureFunc('_mjwf_mesh_normal_ptr')
      ? readView(mod, mod._mjwf_mesh_normal_ptr, handle, Math.max(0, vertCount * 3), heapViewF32)
      : null;
    const texcoordView = ensureFunc('_mjwf_mesh_texcoord_ptr')
      ? readView(mod, mod._mjwf_mesh_texcoord_ptr, handle, Math.max(0, texcoordCount * 2), heapViewF32)
      : null;
    assets.meshes = {
      count: nmesh,
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
    };
  }
  if (diagnostics.missingFuncs.length || diagnostics.zeroPointers.length) {
    assets.extras.diagnostics = diagnostics;
    const globalKey = '__renderAssetDiagLogged';
    const shouldLog = (() => {
      if (typeof window !== 'undefined') {
        window[globalKey] = window[globalKey] || { count: 0, lastTs: 0 };
        const ref = window[globalKey];
        const now = Date.now();
        if (ref.count === 0 || (now - ref.lastTs) > 5000) {
          ref.count += 1;
          ref.lastTs = now;
          return true;
        }
        return false;
      }
      if (!collectRenderAssetsFromModule.__diagLogged || (Date.now() - collectRenderAssetsFromModule.__diagLogged) > 5000) {
        collectRenderAssetsFromModule.__diagLogged = Date.now();
        return true;
      }
      return false;
    })();
    if (shouldLog && typeof console !== 'undefined') {
      console.warn('[render-assets] diagnostics', diagnostics);
    }
  }
  return assets;
}

export class MjSimLite {
  constructor(mod) {
    this.mod = mod;
    this.modId = tagForgeModule(mod);
    this.h = 0;
    this.pref = null;
    this.mode = 'handle';
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
    try {
      if (typeof location !== 'undefined') {
        // Forbid shim injection when nofallback=1 is present
        if (location.search.includes('nofallback=1')) return;
        if (location.search.includes('shim=1')) {
          const shim = await import(/* @vite-ignore */ '/dist/src/forge_shim.js');
          shim.installForgeShim?.(this.mod);
        }
      }
    } catch {}
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
    for (const target of list){
      if (!target) continue;
      let h = 0;
      if (typeof m._mjwf_helper_make_from_xml === 'function'){
        try { h = m._mjwf_helper_make_from_xml.call(m, target) | 0; } catch { h = 0; }
        if (h > 0) return h;
      }
      if (typeof m.ccall === 'function'){
        try { h = m.ccall('mjwf_helper_make_from_xml','number',['string'],[target]) | 0; } catch { h = 0; }
        if (h > 0) return h;
      }
    }
    return 0;
  }

  _validateHandleOrThrow(h){
    const m = this.mod;
    if (!(h > 0)) {
      throw new Error('handle missing');
    }
    const validators = ['_mjwf_helper_valid', '_mjwf_valid'];
    for (const name of validators){
      const fn = typeof m[name] === 'function' ? m[name] : null;
      if (!fn) continue;
      let ok = 1;
      try { ok = fn.call(m, h) | 0; } catch { ok = 0; }
      if (ok !== 1){
        let eno = 0, emsg = '';
        try { if (typeof m._mjwf_helper_errno_last === 'function') eno = m._mjwf_helper_errno_last(h) | 0; } catch {}
        try { if (typeof m._mjwf_helper_errmsg_last === 'function') emsg = this._cstr(m._mjwf_helper_errmsg_last(h) | 0); } catch {}
        if (!emsg) {
          try { if (typeof m._mjwf_errmsg_last === 'function') emsg = this._cstr(m._mjwf_errmsg_last() | 0); } catch {}
        }
        throw new Error(`handle invalid (${name}): eno=${eno} ${emsg}`);
      }
    }
  }

  initFromXml(xmlText, path='/model.xml') {
    const m = this.mod; const bytes = new TextEncoder().encode(xmlText);
    const allTargets = Array.from(new Set(
      ['/model.xml','model.xml', path].filter((p) => typeof p === 'string' && p.length)
    ));
    for (const target of allTargets){
      try {
        if (target.includes('/')){
          this._mkdirTree(target.slice(0, target.lastIndexOf('/')));
        }
      } catch {}
      try { m.FS.writeFile(target, bytes); } catch {}
    }
    const helperHandle = this._tryHelperMakeFromXml(allTargets);
    if (helperHandle > 0){
      this.pref = 'mjwf';
      this.h = helperHandle | 0;
      this.mode='handle';
      return;
    }
    const hasMjwf = (typeof m._mjwf_make_from_xml === 'function') || (typeof m._mjwf_abi_version === 'function') || (typeof m._mjwf_ngeom === 'function');
    const hasMjw  = (typeof m._mjw_make_from_xml  === 'function') || (typeof m._mjw_init === 'function') || (typeof m._mjw_nq === 'function');
    const order = hasMjwf ? ['mjwf'] : (hasMjw ? ['mjw'] : ['mjwf']);
    const tryMake = (pref, p) => {
      // Only attempt ccall when we tentatively chose this pref; never probe unknown names to avoid Emscripten abort spam.
      try {
        const direct = m['_' + pref + '_make_from_xml'];
        if (typeof direct === 'function') return (direct.call(m, p)|0);
      } catch {}
      try { return (m.ccall(pref + '_make_from_xml','number',['string'],[p])|0); } catch { return 0; }
    };
    for (const pref of order) {
      for (const p of allTargets) {
        const h = tryMake(pref, p);
        if (h > 0) { this.pref = pref; this.h = h|0; this.mode='handle'; return; }
      }
    }
    if (hasMjw) {
      // Legacy fallback: mjw_init (returns 1 on success; no handle API)
      try {
        for (const p of allTargets) {
          let ok = 0;
          if (typeof m._mjw_init === 'function') ok = m._mjw_init(p)|0; else try { ok = m.ccall('mjw_init','number',['string'],[p])|0; } catch { ok = 0; }
          if (ok === 1) { this.pref = 'mjw'; this.h = 1; this.mode = 'legacy'; return; }
        }
      } catch {}
    }
    throw new Error('make_from_xml failed');
  }

  // Strict direct-mjwf path: pass XML as C-string on HEAP, never ccall, never use mjw*
  initFromXmlStrict(xmlText){
    const m = this.mod; this.pref = 'mjwf'; this.mode = 'handle';
    try { if (typeof m._mjwf_init === 'function') m._mjwf_init(); } catch {}
    try { if (typeof m._mjwf_abi_version==='function') console.log('mjwf abi:', m._mjwf_abi_version()|0); } catch {}
    try { if (typeof m._mjwf_version_string==='function') console.log('mjwf ver:', this._cstr(m._mjwf_version_string()|0)); } catch {}
    const required = ['_mjwf_make_from_xml','_mjwf_step','_mjwf_reset','_mjwf_free'];
    console.log('mjwf required present:', required.every(k=>typeof m[k]==='function'));
    // FS path only: write XML to /mem/model.xml then call helper wrapper with PATH
    const xmlStr = String(xmlText);
    this._mkdirTree('/mem');
    try { m.FS.writeFile('/mem/model.xml', new TextEncoder().encode(xmlStr)); } catch {}
    // Set working dir if wrapper exposes it
    try {
      if (typeof m._mjwf_set_workdir === 'function' && typeof m.ccall === 'function') {
        try { m.ccall('mjwf_set_workdir','number',['string'],['/mem']); } catch {}
      } else if (typeof m._mjwf_chdir === 'function' && typeof m.ccall === 'function') {
        try { m.ccall('mjwf_chdir','number',['string'],['/mem']); } catch {}
      }
    } catch {}
    const helperTargets = ['/mem/model.xml','/model.xml','model.xml'];
    let h = this._tryHelperMakeFromXml(helperTargets);
    if (!(h > 0) && typeof m.ccall === 'function' && typeof m._mjwf_make_from_xml === 'function') {
      try { h = m.ccall('mjwf_make_from_xml','number',['string'],['/mem/model.xml'])|0; } catch { h = 0; }
    }
    if (!(h>0)) {
      let eno = 0, emsg = '';
      try { if (typeof m._mjwf_errno_last==='function') eno = m._mjwf_errno_last()|0; } catch {}
      try { if (typeof m._mjwf_errmsg_last==='function') emsg = this._cstr(m._mjwf_errmsg_last()|0); } catch {}
      console.error('make_from_xml strict failed', { eno, emsg });
      throw new Error('make_from_xml failed');
    }
    this._validateHandleOrThrow(h);
    this.h = h;
    // Second-stage init (if present)
    const stage = ['_mjwf_make_data','_mjwf_bind','_mjwf_attach','_mjwf_finalize','_mjwf_forward','_mjwf_reset','_mjwf_resetData'];
    const called = [];
    for (const fn of stage){ try { if (typeof m[fn] === 'function') { m[fn](h); called.push(fn); } } catch {}
    }
    if (called.length) console.log('second-stage called:', called);

    // Counts (prefer model_* when available)
    const readInt = (name)=> (typeof m[name]==='function') ? (m[name](h)|0) : 0;
    let nq = readInt('_mjwf_model_nq') || readInt('_mjwf_nq');
    let nv = readInt('_mjwf_model_nv') || readInt('_mjwf_nv');
    let ng = readInt('_mjwf_model_ngeom') || readInt('_mjwf_ngeom');
    if ((nq|0)===0 && (nv|0)===0 && (ng|0)===0) {
      let eno = 0, emsg = '';
      try { if (typeof m._mjwf_errno_last==='function') eno = m._mjwf_errno_last()|0; } catch {}
      try { if (typeof m._mjwf_errmsg_last==='function') emsg = this._cstr(m._mjwf_errmsg_last()|0); } catch {}
      console.error('loaded counts all zero', { eno, emsg });
      throw new Error('model empty');
    }
    console.log('loaded counts', { h, nq, nv, ngeom: ng });
    // Regression self-check: require nq>0 && nv>0 && ngeom>2
    if (!((nq|0) > 0 && (nv|0) > 0 && (ng|0) > 2)) {
      throw new Error(`counts assertion failed: nq=${nq}, nv=${nv}, ngeom=${ng}`);
    }
  }

  ensurePointers(){
    const m = this.mod;
    if (!m || !(this.h > 0)) throw new Error('handle missing');
    if (!this.modelPtr){
      if (typeof m._mjwf_helper_model_ptr === 'function') {
        try { this.modelPtr = m._mjwf_helper_model_ptr(this.h|0) | 0; } catch { this.modelPtr = 0; }
      }
      if (!this.modelPtr && typeof m.ccall === 'function'){
        try { this.modelPtr = m.ccall('mjwf_helper_model_ptr','number',['number'],[this.h|0]) | 0; } catch { this.modelPtr = 0; }
      }
    }
    if (!this.dataPtr){
      if (typeof m._mjwf_helper_data_ptr === 'function') {
        try { this.dataPtr = m._mjwf_helper_data_ptr(this.h|0) | 0; } catch { this.dataPtr = 0; }
      }
      if (!this.dataPtr && typeof m.ccall === 'function'){
        try { this.dataPtr = m.ccall('mjwf_helper_data_ptr','number',['number'],[this.h|0]) | 0; } catch { this.dataPtr = 0; }
      }
    }
    if (!(this.modelPtr && this.dataPtr)) {
      throw new Error('helper pointers unavailable');
    }
    return { modelPtr: this.modelPtr, dataPtr: this.dataPtr };
  }

  // --- Basic counts ---
  nq(){ const m=this.mod; const h=this.h|0; const pref=this.pref||'mjwf'; const d=m['_' + pref + '_nq']; if (typeof d==='function') return (d.call(m,h)|0)||0; try{ return (m.ccall(pref+'_nq','number',['number'],[h])|0)||0;}catch{return 0;} }
  nv(){ const m=this.mod; const h=this.h|0; const pref=this.pref||'mjwf'; const d=m['_' + pref + '_nv']; if (typeof d==='function') return (d.call(m,h)|0)||0; try{ return (m.ccall(pref+'_nv','number',['number'],[h])|0)||0;}catch{return 0;} }
  nu(){ const m=this.mod; const h=this.h|0; const pref=this.pref||'mjwf'; const d=m['_' + pref + '_nu']; if (typeof d==='function') return (d.call(m,h)|0)||0; try{ return (m.ccall(pref+'_nu','number',['number'],[h])|0)||0;}catch{return 0;} }
  njnt(){ const m=this.mod; const h=this.h|0; const d=m['_mjwf_njnt']; if (typeof d==='function') return (d.call(m,h)|0)||0; return 0; }
  ncam(){ const m=this.mod; const h=this.h|0; const d=m['_mjwf_ncam']; if (typeof d==='function') return (d.call(m,h)|0)||0; return 0; }

  // --- State views ---
  qposView(){ const m=this.mod; const h=this.h|0; const n=this.nq(); if(!n)return; const pref=this.pref||'mjwf'; const d=m['_' + pref + '_qpos_ptr']; let p=0; if (typeof d==='function') p=d.call(m,h)|0; else { try{ p=m.ccall(pref+'_qpos_ptr','number',['number'],[h])|0; }catch{ p=0; } } if(!p)return; return heapViewF64(m,p,n); }
  qvelView(){ const m=this.mod; const h=this.h|0; const n=this.nv(); if(!n)return; const pref=this.pref||'mjwf'; const d=m['_' + pref + '_qvel_ptr']; let p=0; if (typeof d==='function') p=d.call(m,h)|0; else { try{ p=m.ccall(pref+'_qvel_ptr','number',['number'],[h])|0; }catch{ p=0; } } if(!p)return; return heapViewF64(m,p,n); }
  ctrlView(){ const m=this.mod; const h=this.h|0; const n=this.nu(); if(!n)return; const pref=this.pref||'mjwf'; const d=m['_' + pref + '_ctrl_ptr']; let p=0; if (typeof d==='function') p=d.call(m,h)|0; else { try{ p=m.ccall(pref+'_ctrl_ptr','number',['number'],[h])|0; }catch{ p=0; } } if(!p)return; return heapViewF64(m,p,n); }
  actuatorCtrlRangeView(){ const m=this.mod; const h=this.h|0; const n=this.nu(); if(!(n>0)) return; const d=m['_mjwf_actuator_ctrlrange_ptr']; if (typeof d!=='function') return; const p=d.call(m,h)|0; if(!p) return; return heapViewF64(m,p,n*2); }
  jntQposAdrView(){ const m=this.mod; const h=this.h|0; const d=m['_mjwf_jnt_qposadr_ptr']; if (typeof d!=='function') return; const nj=this.njnt()|0; if(!nj)return; const p=d.call(m,h)|0; if(!p)return; return heapViewI32(m,p,nj); }
  jntRangeView(){ const m=this.mod; const h=this.h|0; const d=m['_mjwf_jnt_range_ptr']; if (typeof d!=='function') return; const nj=this.njnt()|0; if(!nj)return; const p=d.call(m,h)|0; if(!p)return; return heapViewF64(m,p,nj*2); }
  jntTypeView(){ const m=this.mod; const h=this.h|0; const d=m['_mjwf_jnt_type_ptr']; if (typeof d!=='function') return; const nj=this.njnt()|0; if(!nj)return; const p=d.call(m,h)|0; if(!p)return; return heapViewI32(m,p,nj); }
  jntNameOf(i){ const m=this.mod; const h=this.h|0; const d=m['_mjwf_jnt_name_of']||m['_mjwf_joint_name_of']; if (typeof d!=='function') return ''; try { const p=d.call(m,h,(i|0))|0; return this._cstr(p); } catch { return ''; } }

  forward(){ const m=this.mod; const h=this.h|0; const d=m['_mjwf_forward']; if (typeof d==='function') { try { d.call(m,h); } catch {} } }
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
    const m = this.mod; const h = this.h|0; const pref = this.pref || 'mjwf';
    const count = Math.max(1, n|0);
    if (this.mode === 'legacy') {
      // minimal.c style demo step function
      if (typeof m._mjw_step_demo === 'function') { m._mjw_step_demo(count); return; }
      try { m.ccall('mjw_step_demo', null, ['number'], [count]); return; } catch {}
      throw new Error('step failed');
    } else {
      const mjStep = typeof m._mjwf_mj_step === 'function' ? m._mjwf_mj_step : null;
      if (mjStep) {
        this.ensurePointers();
        const modelPtr = this.modelPtr | 0;
        const dataPtr = this.dataPtr | 0;
        if (!(modelPtr && dataPtr)) throw new Error('mj_step pointers missing');
        for (let i = 0; i < count; i += 1) {
          mjStep.call(m, modelPtr, dataPtr);
        }
        return;
      }
      const direct = m['_' + pref + '_step'];
      let r = 0;
      if (typeof direct === 'function') { r = (direct.call(m, h, count)|0); }
      else { try { r = (m.ccall(pref + '_step','number',['number','number'],[h,count])|0); } catch { r = 0; } }
      if (r !== 1) throw new Error('step failed');
    }
  }

  timestep(){
    const m=this.mod; const h=this.h|0; if(this.mode==='legacy'){ return 0.002; }
    const ptr = this._readPtr('model','opt_timestep');
    if (ptr) {
      const view = heapViewF64(m, ptr, 1);
      if (view && view.length) return +view[0] || 0.002;
    }
    const pref=this.pref||'mjwf'; const d=m['_' + pref + '_timestep']; if (typeof d==='function') return +d.call(m,h)||0.002; return 0.002;
  }
  time(){
    const m=this.mod; const h=this.h|0; if(this.mode==='legacy'){ return 0; }
    const ptr = this._readPtr('data','time');
    if (ptr) {
      const view = heapViewF64(m, ptr, 1);
      if (view && view.length) return +view[0] || 0;
    }
    const pref=this.pref||'mjwf'; const d=m['_' + pref + '_time']; if (typeof d==='function') return +d.call(m,h)||0; return 0;
  }

  _readPtr(owner,name){ const m=this.mod; const h=this.h|0; const fn=m && m[`_mjwf_${owner}_${name}_ptr`]; if (typeof fn!=='function') return 0; try { return fn.call(m,h)|0; } catch { return 0; } }
  _readModelPtr(name){ return this._readPtr('model', name); }
  _readDataPtr(name){ return this._readPtr('data', name); }

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
      mode: this.mode,
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

  ngeom(){ const m=this.mod; const h=this.h|0; const pref=this.pref||'mjwf'; const d=m['_' + pref + '_ngeom']; if (typeof d==='function') return (d.call(m,h)|0)||0; try{ return (m.ccall(pref+'_ngeom','number',['number'],[h])|0)||0;}catch{return 0;} }
  nbody(){ const m=this.mod; const h=this.h|0; const pref=this.pref||'mjwf'; const d=m['_' + pref + '_nbody']; if (typeof d==='function') return (d.call(m,h)|0)||0; try{ return (m.ccall(pref+'_nbody','number',['number'],[h])|0)||0;}catch{return 0;} }
  bodyJntAdrView(){ const m=this.mod; const h=this.h|0; const n=this.nbody()|0; if(!(n>0)) return null; const fn=m?._mjwf_model_body_jntadr_ptr; if (typeof fn!=='function') return null; const ptr=fn.call(m,h)|0; if(!(ptr>0)) return null; return heapViewI32(m, ptr, n); }
  bodyJntNumView(){ const m=this.mod; const h=this.h|0; const n=this.nbody()|0; if(!(n>0)) return null; const fn=m?._mjwf_model_body_jntnum_ptr; if (typeof fn!=='function') return null; const ptr=fn.call(m,h)|0; if(!(ptr>0)) return null; return heapViewI32(m, ptr, n); }

  geomXposView(){ const m=this.mod; const h=this.h|0; const n=this.ngeom(); if(!n)return; const pref=this.mode==='legacy' ? 'mjwf' : (this.pref||'mjwf'); const d=m['_' + pref + '_geom_xpos_ptr']; let p=0; if (typeof d==='function') p=d.call(m,h)|0; else { try{ p=m.ccall(pref+'_geom_xpos_ptr','number',['number'],[h])|0; }catch{ p=0; } } if(!p)return; return heapViewF64(m,p,n*3); }
  geomXmatView(){ const m=this.mod; const h=this.h|0; const n=this.ngeom(); if(!n)return; const pref=this.mode==='legacy' ? 'mjwf' : (this.pref||'mjwf'); const d=m['_' + pref + '_geom_xmat_ptr']; let p=0; if (typeof d==='function') p=d.call(m,h)|0; else { try{ p=m.ccall(pref+'_geom_xmat_ptr','number',['number'],[h])|0; }catch{ p=0; } } if(!p)return; return heapViewF64(m,p,n*9); }
  bodyXposView(){ const m=this.mod; const h=this.h|0; const n=this.nbody(); if(!n)return; const pref=this.mode==='legacy' ? 'mjwf' : (this.pref||'mjwf'); let d=m['_' + pref + '_body_xpos_ptr']; if (typeof d!=='function') { d = m['_' + pref + '_xpos_ptr'] || m['_' + pref + '_xipos_ptr']; } if (typeof d!=='function') return; let p=0; try{ p=d.call(m,h)|0; }catch{ p=0; } if(!p)return; return heapViewF64(m,p,n*3); }
  bodyXmatView(){ const m=this.mod; const h=this.h|0; const n=this.nbody(); if(!n)return; const pref=this.mode==='legacy' ? 'mjwf' : (this.pref||'mjwf'); const d=m['_' + pref + '_body_xmat_ptr']; if (typeof d!=='function') return; let p=0; try{ p=d.call(m,h)|0; }catch{ p=0; } if(!p)return; return heapViewF64(m,p,n*9); }
  bodyXiposView(){ const m=this.mod; const h=this.h|0; const n=this.nbody(); if(!n)return; const pref=this.mode==='legacy' ? 'mjwf' : (this.pref||'mjwf'); const d=m['_' + pref + '_xipos_ptr']; if (typeof d!=='function') return; let p=0; try{ p=d.call(m,h)|0; }catch{ p=0; } if(!p)return; return heapViewF64(m,p,n*3); }
  // Optional getters: never call ccall for unknown symbols — only use direct exports
  geomSizeView(){ const m=this.mod; const h=this.h|0; const n=this.ngeom(); if(!n)return; const pref=this.pref||'mjwf'; const d=m['_' + pref + '_geom_size_ptr']; if (typeof d!=='function') return; const p=d.call(m,h)|0; if(!p)return; return heapViewF64(m,p,n*3); }
  geomTypeView(){ const m=this.mod; const h=this.h|0; const n=this.ngeom(); if(!n)return; const pref=this.pref||'mjwf'; const d=m['_' + pref + '_geom_type_ptr']; if (typeof d!=='function') return; const p=d.call(m,h)|0; if(!p)return; return heapViewI32(m,p,n); }
  geomMatIdView(){ const m=this.mod; const h=this.h|0; const n=this.ngeom(); if(!n)return; const pref=this.pref||'mjwf'; const d=m['_' + pref + '_geom_matid_ptr']; if (typeof d!=='function') return; const p=d.call(m,h)|0; if(!p)return; return heapViewI32(m,p,n); }
  geomDataidView(){ const m=this.mod; const h=this.h|0; const n=this.ngeom(); if(!n)return; const pref=this.pref||'mjwf'; const d=m['_' + pref + '_geom_dataid_ptr']; if (typeof d!=='function') return; const p=d.call(m,h)|0; if(!p)return; return heapViewI32(m,p,n); }
  geomBodyIdView(){ const m=this.mod; const h=this.h|0; const n=this.ngeom()|0; if(!(n>0)) return null; const fn=m?._mjwf_model_geom_bodyid_ptr; if (typeof fn!=='function') return null; const ptr=fn.call(m,h)|0; if(!(ptr>0)) return null; return heapViewI32(m, ptr, n); }
  nmat(){ const m=this.mod; const h=this.h|0; const pref=this.pref||'mjwf'; const d=m['_' + pref + '_nmat']; if (typeof d!=='function') return 0; return (d.call(m,h)|0)||0; }
  matRgbaView(){ const m=this.mod; const h=this.h|0; const nm=this.nmat(); if(!nm)return; const pref=this.pref||'mjwf'; const d=m['_' + pref + '_mat_rgba_ptr']; if (typeof d!=='function') return; const p=d.call(m,h)|0; if(!p)return; return heapViewF32(m,p,nm*4); }
  nmesh(){ const m=this.mod; const h=this.h|0; const d=m._mjwf_nmesh; if (typeof d!=='function') return 0; try { return (d.call(m,h)|0)||0; } catch { return 0; } }
  meshVertAdrView(){ const m=this.mod; const h=this.h|0; const n=this.nmesh(); if(!n)return; const d=m._mjwf_mesh_vertadr_ptr; if (typeof d!=='function') return; const p=d.call(m,h)|0; if(!p)return; return heapViewI32(m,p,n); }
  meshVertNumView(){ const m=this.mod; const h=this.h|0; const n=this.nmesh(); if(!n)return; const d=m._mjwf_mesh_vertnum_ptr; if (typeof d!=='function') return; const p=d.call(m,h)|0; if(!p)return; return heapViewI32(m,p,n); }
  meshFaceAdrView(){ const m=this.mod; const h=this.h|0; const n=this.nmesh(); if(!n)return; const d=m._mjwf_mesh_faceadr_ptr; if (typeof d!=='function') return; const p=d.call(m,h)|0; if(!p)return; return heapViewI32(m,p,n); }
  meshFaceNumView(){ const m=this.mod; const h=this.h|0; const n=this.nmesh(); if(!n)return; const d=m._mjwf_mesh_facenum_ptr; if (typeof d!=='function') return; const p=d.call(m,h)|0; if(!p)return; return heapViewI32(m,p,n); }
  meshVertView(){ const m=this.mod; const h=this.h|0; if(!this.nmesh())return; const cntFn=m._mjwf_mesh_vert_count; const d=m._mjwf_mesh_vert_ptr; if (typeof d!=='function') return; const count = typeof cntFn==='function' ? (cntFn.call(m,h)|0) : 0; const ptr=d.call(m,h)|0; if(!ptr)return; const len = count>0? count*3 : 0; return len>0 ? heapViewF32(m,ptr,len) : null; }
  meshNormalView(){ const m=this.mod; const h=this.h|0; if(!this.nmesh())return; const cntFn=m._mjwf_mesh_vert_count; const d=m._mjwf_mesh_normal_ptr; if (typeof d!=='function') return; const count = typeof cntFn==='function' ? (cntFn.call(m,h)|0) : 0; const ptr=d.call(m,h)|0; if(!ptr)return; const len = count>0? count*3 : 0; return len>0 ? heapViewF32(m,ptr,len) : null; }
  meshFaceView(){ const m=this.mod; const h=this.h|0; if(!this.nmesh())return; const cntFn=m._mjwf_mesh_face_count; const d=m._mjwf_mesh_face_ptr; if (typeof d!=='function') return; const count = typeof cntFn==='function' ? (cntFn.call(m,h)|0) : 0; const ptr=d.call(m,h)|0; if(!ptr)return; const len = count>0? count*3 : 0; return len>0 ? heapViewI32(m,ptr,len) : null; }
  meshTexcoordView(){ const m=this.mod; const h=this.h|0; if(!this.nmesh())return; const cntFn=m._mjwf_mesh_texcoord_count; const d=m._mjwf_mesh_texcoord_ptr; if (typeof d!=='function') return; const count = typeof cntFn==='function' ? (cntFn.call(m,h)|0) : 0; const ptr=d.call(m,h)|0; if(!ptr)return; const len = count>0? count*2 : 0; return len>0 ? heapViewF32(m,ptr,len) : null; }
  meshTexcoordAdrView(){ const m=this.mod; const h=this.h|0; const n=this.nmesh(); if(!n)return; const d=m._mjwf_mesh_texcoordadr_ptr; if (typeof d!=='function') return; const p=d.call(m,h)|0; if(!p)return; return heapViewI32(m,p,n); }
  meshTexcoordNumView(){ const m=this.mod; const h=this.h|0; const n=this.nmesh(); if(!n)return; const d=m._mjwf_mesh_texcoordnum_ptr; if (typeof d!=='function') return; const p=d.call(m,h)|0; if(!p)return; return heapViewI32(m,p,n); }
  collectRenderAssets() {
    return collectRenderAssetsFromModule(this.mod, this.h | 0);
  }

  // --- Contacts (optional) ---
  ncon(){ const m=this.mod; const h=this.h|0; const d=m['_mjwf_ncon']; if (typeof d!=='function') return 0; return (d.call(m,h)|0)||0; }
  _resolveFn(names){ const m=this.mod; for(const name of names){ const fn=m[name]; if(typeof fn==='function') return fn; } return null; }
  contactPosView(){ const m=this.mod; const h=this.h|0; const n=this.ncon(); if(!(n>0)) return; const d=this._resolveFn(['_mjwf_contact_pos_ptr','_mjwf_data_contact_pos_ptr','_mjw_contact_pos_ptr','_mjw_data_contact_pos_ptr']); if(!d) return; const p=d.call(m,h)|0; if(!p) return; return heapViewF64(m,p,n*3); }
  contactFrameView(){ const m=this.mod; const h=this.h|0; const n=this.ncon(); if(!(n>0)) return; const d=this._resolveFn(['_mjwf_contact_frame_ptr','_mjwf_data_contact_frame_ptr','_mjw_contact_frame_ptr','_mjw_data_contact_frame_ptr']); if(!d) return; const p=d.call(m,h)|0; if(!p) return; return heapViewF64(m,p,n*9); }
  contactGeom1View(){ const m=this.mod; const h=this.h|0; const n=this.ncon(); if(!(n>0)) return; const d=this._resolveFn(['_mjwf_contact_geom1_ptr','_mjwf_data_contact_geom1_ptr','_mjw_contact_geom1_ptr']); if(!d) return; const p=d.call(m,h)|0; if(!p) return; return heapViewI32(m,p,n); }
  contactGeom2View(){ const m=this.mod; const h=this.h|0; const n=this.ncon(); if(!(n>0)) return; const d=this._resolveFn(['_mjwf_contact_geom2_ptr','_mjwf_data_contact_geom2_ptr','_mjw_contact_geom2_ptr']); if(!d) return; const p=d.call(m,h)|0; if(!p) return; return heapViewI32(m,p,n); }
  contactDistView(){ const m=this.mod; const h=this.h|0; const n=this.ncon(); if(!(n>0)) return; const d=this._resolveFn(['_mjwf_contact_dist_ptr','_mjwf_data_contact_dist_ptr']); if(!d) return; const p=d.call(m,h)|0; if(!p) return; return heapViewF64(m,p,n); }
  contactFrictionView(){ const m=this.mod; const h=this.h|0; const n=this.ncon(); if(!(n>0)) return; const d=this._resolveFn(['_mjwf_contact_friction_ptr','_mjwf_data_contact_friction_ptr']); if(!d) return; const p=d.call(m,h)|0; if(!p) return; return heapViewF64(m,p,n*5); }
  contactForceBuffer(target){
    const m=this.mod;
    const n=this.ncon();
    if (!(m && (n>0))) return null;
    const d=this._resolveFn(['_mjwf_mj_contactForce','_mjw_mj_contactForce','_mj_contactForce']);
    if(!d) return null;
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
    const legacy = m['_mjwf_actuator_name_of'];
    if (typeof legacy === 'function') {
      try {
        const p = legacy.call(m,h,idx)|0;
        if (p) return this._cstr(p);
      } catch {}
    }
    return this._nameFromAdr(idx, '_mjwf_model_name_actuatoradr_ptr', '_mjwf_model_nu') || '';
  }
  cameraNameOf(i){
    return this._nameFromAdr(i, '_mjwf_model_name_camadr_ptr', '_mjwf_ncam') || '';
  }
  geomNameOf(i){
    return this._nameFromAdr(i, '_mjwf_model_name_geomadr_ptr', '_mjwf_ngeom') || '';
  }
  
  // --- Apply/clear external force (xfrc_applied) ---
  applyXfrcByGeom(geomIndex, force3, torque3, point3){
    const m=this.mod; const h=this.h|0; const gi=geomIndex|0;
    const fx=+force3?.[0]||0, fy=+force3?.[1]||0, fz=+force3?.[2]||0;
    const tx=+torque3?.[0]||0, ty=+torque3?.[1]||0, tz=+torque3?.[2]||0;
    const px=+point3?.[0]||0, py=+point3?.[1]||0, pz=+point3?.[2]||0;
    if (typeof m._mjwf_apply_xfrc === 'function') { try { m._mjwf_apply_xfrc(h, gi, fx,fy,fz, tx,ty,tz, px,py,pz); return true; } catch {}
    }
    // Fallback: write to xfrc_applied for the owning body
    try {
      const gbPtr = typeof m._mjwf_geom_bodyid_ptr === 'function' ? (m._mjwf_geom_bodyid_ptr(h)|0) : 0;
      const xfPtr = typeof m._mjwf_xfrc_applied_ptr === 'function' ? (m._mjwf_xfrc_applied_ptr(h)|0) : 0;
      const nbody = typeof m._mjwf_nbody === 'function' ? (m._mjwf_nbody(h)|0) : 0;
      if (gbPtr && xfPtr && nbody>0) {
        const bodyId = heapViewI32(m, gbPtr, this.ngeom()|0)[gi|0]|0;
        if (bodyId>=0) {
          const H = heapViewF64(m, xfPtr, nbody*6);
          const off = 6*bodyId;
          H[off+0]=fx; H[off+1]=fy; H[off+2]=fz; H[off+3]=tx; H[off+4]=ty; H[off+5]=tz;
          return true;
        }
      }
    } catch {}
    return false;
  }
  applyXfrcByBody(bodyIndex, force3, torque3){
    const m=this.mod; const h=this.h|0; const body=bodyIndex|0;
    const fx=+force3?.[0]||0, fy=+force3?.[1]||0, fz=+force3?.[2]||0;
    const tx=+torque3?.[0]||0, ty=+torque3?.[1]||0, tz=+torque3?.[2]||0;
    try {
      const xfPtr = typeof m._mjwf_xfrc_applied_ptr === 'function' ? (m._mjwf_xfrc_applied_ptr(h)|0) : 0;
      const nbody = this.nbody();
      if (xfPtr && nbody>0 && body>=0 && body < nbody) {
        const H = heapViewF64(m, xfPtr, nbody*6);
        const off = 6*body;
        H[off+0]=fx; H[off+1]=fy; H[off+2]=fz; H[off+3]=tx; H[off+4]=ty; H[off+5]=tz;
        return true;
      }
    } catch {}
    return false;
  }

  clearAllXfrc(){ const m=this.mod; const h=this.h|0; try { const nbody = typeof m._mjwf_nbody === 'function' ? (m._mjwf_nbody(h)|0) : 0; const xfPtr = typeof m._mjwf_xfrc_applied_ptr === 'function' ? (m._mjwf_xfrc_applied_ptr(h)|0) : 0; if (xfPtr && nbody>0) { const H = heapViewF64(m, xfPtr, nbody*6); H.fill(0); return true; } } catch {} return false; }
  reset(){ const m=this.mod; const h=this.h|0; const pref=this.pref||'mjwf'; const d=m['_' + pref + '_reset']; if (typeof d==='function') return ((d.call(m,h)|0)===1); try{ return ((m.ccall(pref+'_reset','number',['number'],[h])|0)===1);}catch{return false;} }
  term(){
    const m=this.mod; const h=this.h|0; const pref=this.pref||'mjwf';
    this._freeContactForceScratch();
    if (h) {
      if (typeof m?._mjwf_helper_free === 'function') {
        try { m._mjwf_helper_free(h); } catch {}
      } else {
        try {
          const d=m && m['_' + pref + '_free'];
          if (typeof d==='function') d.call(m,h);
          else if (typeof m?.ccall === 'function') m.ccall(pref+'_free', null, ['number'], [h]);
        } catch {}
      }
    }
    this.h=0;
    this.modelPtr=0;
    this.dataPtr=0;
  }
}

// Build a minimal in-memory module and attach a tiny shim with 2 geoms.
export function createLocalModule() {
  const MEM_BYTES = 4 * 1024 * 1024;
  const buf = new ArrayBuffer(MEM_BYTES);
  const HEAPU8 = new Uint8Array(buf);
  const HEAPF64 = new Float64Array(buf);
  let brk = 1024; // simple bump allocator
  function _malloc(n) { n = (n|0); if (n<=0) return 0; const align = 8; brk = (brk + (align-1)) & ~(align-1); if (brk + n >= MEM_BYTES) return 0; const p = brk; brk += n; return p; }
  function _free(_p) {}
  const files = new Map();
  const FS = { writeFile: (p,d)=>files.set(String(p), d instanceof Uint8Array ? d : new TextEncoder().encode(String(d))), readFile:(p)=>files.get(String(p))||new Uint8Array(0) };
  const mod = { __heapBuffer: buf, HEAPU8, HEAPF64, _malloc, _free, FS };
  mod.ccall = (name, _ret, _argt, args) => { const fn = mod['_' + name] || mod[name]; if (typeof fn==='function') return fn.apply(mod, args||[]); return 0; };
  // Install tiny local shim
  try {
    const f64 = mod.HEAPF64;
    function alloc(n){ const p = mod._malloc(n|0); new Uint8Array(mod.__heapBuffer, p, n).fill(0); return p; }
    function writeF64(p,arr){ const off=p>>>3; for(let i=0;i<arr.length;i++) f64[off+i]=+arr[i]||0; }
    const state = { h:1, dt:0.002, t:0, ngeom:2, geomXpos:0, geomXmat:0 };
    state.geomXpos = alloc(2*3*8); state.geomXmat = alloc(2*9*8);
    writeF64(state.geomXpos,[0,0,0.05, 0.2,0,0.08]);
    writeF64(state.geomXmat,[1,0,0,0,1,0,0,0,1, 1,0,0,0,1,0,0,0,1]);
    mod._mjwf_abi_version = () => 337;
    mod._mjwf_make_from_xml = () => state.h;
    mod._mjwf_free = () => {};
    mod._mjwf_timestep = () => state.dt;
    mod._mjwf_time = () => state.t;
    mod._mjwf_step = (_h,n)=>{ state.t += (n|0)*state.dt; return 1; };
    mod._mjwf_reset = ()=>{ state.t=0; return 1; };
    mod._mjwf_ngeom = ()=> state.ngeom;
    mod._mjwf_nu = ()=> 0;
    mod._mjwf_geom_xpos_ptr = ()=> state.geomXpos;
    mod._mjwf_geom_xmat_ptr = ()=> state.geomXmat;
    mod.__localShimState = state;
  } catch {}
  return mod;
}
