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
    textures: null,
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
    const rgbaView = readView(mod, ensureFunc('_mjwf_geom_rgba_ptr'), handle, ngeom * 4, heapViewF32);
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
  const nmat = typeof mod._mjwf_nmat === 'function' ? (mod._mjwf_nmat(handle) | 0) : 0;
  if (nmat > 0) {
    const rgbaView = readView(mod, mod._mjwf_mat_rgba_ptr, handle, nmat * 4, heapViewF32);
    const reflectanceView = readView(mod, ensureFunc('_mjwf_mat_reflectance_ptr'), handle, nmat, heapViewF64);
    assets.materials = {
      count: nmat,
      rgba: cloneTyped(rgbaView, Float32Array),
      reflectance: cloneTyped(reflectanceView, Float64Array),
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
    const vertView = readView(mod, ensureFunc('_mjwf_mesh_vert_ptr'), handle, Math.max(0, vertElemCount), heapViewF32);
    const faceView = readView(mod, ensureFunc('_mjwf_mesh_face_ptr'), handle, Math.max(0, faceElemCount), heapViewI32);
    const normalView = ensureFunc('_mjwf_mesh_normal_ptr')
      ? readView(mod, mod._mjwf_mesh_normal_ptr, handle, Math.max(0, vertElemCount), heapViewF32)
      : null;
    const texcoordView = ensureFunc('_mjwf_mesh_texcoord_ptr')
      ? readView(mod, mod._mjwf_mesh_texcoord_ptr, handle, Math.max(0, texcoordElemCount), heapViewF32)
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
  const ntex = typeof mod._mjwf_ntex === 'function' ? (mod._mjwf_ntex(handle) | 0) : 0;
  if (ntex > 0) {
    const texTypeView = readView(mod, ensureFunc('_mjwf_tex_type_ptr'), handle, ntex, heapViewI32);
    const texWidthView = readView(mod, ensureFunc('_mjwf_tex_width_ptr'), handle, ntex, heapViewI32);
    const texHeightView = readView(mod, ensureFunc('_mjwf_tex_height_ptr'), handle, ntex, heapViewI32);
    const texNChannelView = readView(mod, ensureFunc('_mjwf_tex_nchannel_ptr'), handle, ntex, heapViewI32);
    const texAdrView = readView(mod, ensureFunc('_mjwf_tex_adr_ptr'), handle, ntex, heapViewI32);
    const texColorspaceView = readView(mod, ensureFunc('_mjwf_tex_colorspace_ptr'), handle, ntex, heapViewI32);
    const ntexdataFn = ensureFunc('_mjwf_ntexdata');
    const texDataPtrFn = ensureFunc('_mjwf_tex_data_ptr');
    let texData = null;
    if (texDataPtrFn && ntexdataFn) {
      const dataLen = ntexdataFn.call(mod, handle) | 0;
      const dataPtr = texDataPtrFn.call(mod, handle) | 0;
      texData = heapViewU8(mod, dataPtr, dataLen);
      if (!texData || texData.length <= 0) {
        diagnostics.zeroPointers.push('_mjwf_tex_data_ptr');
      }
    } else {
      diagnostics.missingFuncs.push('_mjwf_tex_data_ptr or _mjwf_ntexdata');
    }
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
    const required = ['_mjwf_make_from_xml','_mjwf_step','_mjwf_reset','_mjwf_free'];
    const requiredOk = required.every((name) => typeof m[name] === 'function');
    if (!requiredOk) {
      throw new Error('Required mjwf functions missing');
    }
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
    // Second-stage init (if present). Keep this lightweight: avoid mj_resetData
    // here to prevent large one-off workspace allocations on heavy models.
    const stage = ['_mjwf_make_data','_mjwf_bind','_mjwf_attach','_mjwf_finalize','_mjwf_forward'];
    const called = [];
    for (const fn of stage){ try { if (typeof m[fn] === 'function') { m[fn](h); called.push(fn); } } catch {}
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
  nlight(){ const m=this.mod; const h=this.h|0; const d=m['_mjwf_nlight']; if (typeof d==='function') return (d.call(m,h)|0)||0; return 0; }
  nsite(){ const m=this.mod; const h=this.h|0; const d=m['_mjwf_nsite']; if (typeof d==='function') return (d.call(m,h)|0)||0; return 0; }
  nsensor(){ const m=this.mod; const h=this.h|0; const d=m['_mjwf_nsensor']; if (typeof d==='function') return (d.call(m,h)|0)||0; return 0; }
  neq(){ const m=this.mod; const h=this.h|0; const d=m['_mjwf_neq']; if (typeof d==='function') return (d.call(m,h)|0)||0; return 0; }

  // --- State views ---
  qposView(){ const m=this.mod; const h=this.h|0; const n=this.nq(); if(!n)return; const pref=this.pref||'mjwf'; const d=m['_' + pref + '_qpos_ptr']; let p=0; if (typeof d==='function') p=d.call(m,h)|0; else { try{ p=m.ccall(pref+'_qpos_ptr','number',['number'],[h])|0; }catch{ p=0; } } if(!p)return; return heapViewF64(m,p,n); }
  qvelView(){ const m=this.mod; const h=this.h|0; const n=this.nv(); if(!n)return; const pref=this.pref||'mjwf'; const d=m['_' + pref + '_qvel_ptr']; let p=0; if (typeof d==='function') p=d.call(m,h)|0; else { try{ p=m.ccall(pref+'_qvel_ptr','number',['number'],[h])|0; }catch{ p=0; } } if(!p)return; return heapViewF64(m,p,n); }
  ctrlView(){ const m=this.mod; const h=this.h|0; const n=this.nu(); if(!n)return; const pref=this.pref||'mjwf'; const d=m['_' + pref + '_ctrl_ptr']; let p=0; if (typeof d==='function') p=d.call(m,h)|0; else { try{ p=m.ccall(pref+'_ctrl_ptr','number',['number'],[h])|0; }catch{ p=0; } } if(!p)return; return heapViewF64(m,p,n); }
  actuatorCtrlRangeView(){ const m=this.mod; const h=this.h|0; const n=this.nu(); if(!(n>0)) return; const d=m['_mjwf_actuator_ctrlrange_ptr']; if (typeof d!=='function') return; const p=d.call(m,h)|0; if(!p) return; return heapViewF64(m,p,n*2); }
  jntQposAdrView(){ const m=this.mod; const h=this.h|0; const d=m['_mjwf_jnt_qposadr_ptr']; if (typeof d!=='function') return; const nj=this.njnt()|0; if(!nj)return; const p=d.call(m,h)|0; if(!p)return; return heapViewI32(m,p,nj); }
  jntRangeView(){ const m=this.mod; const h=this.h|0; const d=m['_mjwf_jnt_range_ptr']; if (typeof d!=='function') return; const nj=this.njnt()|0; if(!nj)return; const p=d.call(m,h)|0; if(!p)return; return heapViewF64(m,p,nj*2); }
  jntTypeView(){ const m=this.mod; const h=this.h|0; const d=m['_mjwf_jnt_type_ptr']; if (typeof d!=='function') return; const nj=this.njnt()|0; if(!nj)return; const p=d.call(m,h)|0; if(!p)return; return heapViewI32(m,p,nj); }
  jntNameOf(i){ const m=this.mod; const h=this.h|0; const d=m['_mjwf_jnt_name_of']||m['_mjwf_joint_name_of']; if (typeof d!=='function') return ''; try { const p=d.call(m,h,(i|0))|0; return this._cstr(p); } catch { return ''; } }
  jntPosView(){ const m=this.mod; const { modelPtr } = this.ensurePointers(); const h=this.h|0; const d=m['_mjwf_jnt_pos_ptr']||m['_mjwf_model_jnt_pos_ptr']; if (typeof d!=='function') return; const nj=this.njnt()|0; if(!nj)return; let p=0; try{ p=d.call(m,h|0)|0; }catch{ p=0; } if(!(p>0) && modelPtr){ try{ p=d.call(m,modelPtr|0)|0; }catch{ p=0; } } if(!(p>0)) return; return heapViewF64(m,p,nj*3); }
  jntAxisView(){ const m=this.mod; const { modelPtr } = this.ensurePointers(); const h=this.h|0; const d=m['_mjwf_jnt_axis_ptr']||m['_mjwf_model_jnt_axis_ptr']; if (typeof d!=='function') return; const nj=this.njnt()|0; if(!nj)return; let p=0; try{ p=d.call(m,h|0)|0; }catch{ p=0; } if(!(p>0) && modelPtr){ try{ p=d.call(m,modelPtr|0)|0; }catch{ p=0; } } if(!(p>0)) return; return heapViewF64(m,p,nj*3); }
  jntBodyIdView(){ const m=this.mod; const { modelPtr } = this.ensurePointers(); const h=this.h|0; let d=m['_mjwf_jnt_bodyid_ptr'] || m['_mjwf_jnt_bodyid'] || m['_mjwf_model_jnt_bodyid_ptr']; if (typeof d!=='function') return; const nj=this.njnt()|0; if(!nj)return; let p=0; try{ p=d.call(m,h|0)|0; }catch{ p=0; } if(!(p>0) && modelPtr){ try{ p=d.call(m,modelPtr|0)|0; }catch{ p=0; } } if(!p)return; return heapViewI32(m,p,nj); }
  actuatorTrnidView(){ const m=this.mod; const h=this.h|0; const d=m['_mjwf_actuator_trnid_ptr']; if (typeof d!=='function') return; const n=this.nu()|0; if(!n)return; const p=d.call(m,h)|0; if(!p)return; return heapViewI32(m,p,n*2); }
  actuatorTrntypeView(){ const m=this.mod; const h=this.h|0; const d=m['_mjwf_actuator_trntype_ptr']; if (typeof d!=='function') return; const n=this.nu()|0; if(!n)return; const p=d.call(m,h)|0; if(!p)return; return heapViewI32(m,p,n); }
  actuatorCranklengthView(){ const m=this.mod; const h=this.h|0; const d=m['_mjwf_actuator_cranklength_ptr']; if (typeof d!=='function') return; const n=this.nu()|0; if(!n)return; const p=d.call(m,h)|0; if(!p)return; return heapViewF64(m,p,n); }
  siteXposView(){ const m=this.mod; const h=this.h|0; const n=this.nsite()|0; if(!n)return; const d=m['_mjwf_data_site_xpos_ptr']||m['_mjwf_site_xpos_ptr']; if (typeof d!=='function') return; let p=0; try{ p=d.call(m,h)|0; }catch{ p=0; } if(!p)return; return heapViewF64(m,p,n*3); }
  siteXmatView(){ const m=this.mod; const h=this.h|0; const n=this.nsite()|0; if(!n)return; const d=m['_mjwf_data_site_xmat_ptr']||m['_mjwf_site_xmat_ptr']; if (typeof d!=='function') return; let p=0; try{ p=d.call(m,h)|0; }catch{ p=0; } if(!p)return; return heapViewF64(m,p,n*9); }
  sensorTypeView(){ const m=this.mod; const h=this.h|0; const n=this.nsensor()|0; if(!n)return; const d=m['_mjwf_sensor_type_ptr']; if (typeof d!=='function') return; let p=0; try{ p=d.call(m,h)|0; }catch{ p=0; } if(!p)return; return heapViewI32(m,p,n); }
  sensorObjIdView(){ const m=this.mod; const h=this.h|0; const n=this.nsensor()|0; if(!n)return; const d=m['_mjwf_sensor_objid_ptr']; if (typeof d!=='function') return; let p=0; try{ p=d.call(m,h)|0; }catch{ p=0; } if(!p)return; return heapViewI32(m,p,n); }
  eqTypeView(){ const m=this.mod; const h=this.h|0; const n=this.neq()|0; if(!n)return; const d=m['_mjwf_eq_type_ptr']; if (typeof d!=='function') return; let p=0; try{ p=d.call(m,h)|0; }catch{ p=0; } if(!p)return; return heapViewI32(m,p,n); }
  eqObj1IdView(){ const m=this.mod; const h=this.h|0; const n=this.neq()|0; if(!n)return; const d=m['_mjwf_eq_obj1id_ptr']; if (typeof d!=='function') return; let p=0; try{ p=d.call(m,h)|0; }catch{ p=0; } if(!p)return; return heapViewI32(m,p,n); }
  eqObj2IdView(){ const m=this.mod; const h=this.h|0; const n=this.neq()|0; if(!n)return; const d=m['_mjwf_eq_obj2id_ptr']; if (typeof d!=='function') return; let p=0; try{ p=d.call(m,h)|0; }catch{ p=0; } if(!p)return; return heapViewI32(m,p,n); }
  eqObjTypeView(){ const m=this.mod; const h=this.h|0; const n=this.neq()|0; if(!n)return; const d=m['_mjwf_eq_objtype_ptr']; if (typeof d!=='function') return; let p=0; try{ p=d.call(m,h)|0; }catch{ p=0; } if(!p)return; return heapViewI32(m,p,n); }
  eqDataView(){ const m=this.mod; const h=this.h|0; const n=this.neq()|0; if(!n)return; const d=m['_mjwf_eq_data_ptr']; if (typeof d!=='function') return; let p=0; try{ p=d.call(m,h)|0; }catch{ p=0; } if(!p)return; return heapViewF64(m,p,n*11); }
  eqActiveView(){ const m=this.mod; const h=this.h|0; const n=this.neq()|0; if(!n)return; const d=m['_mjwf_data_eq_active_ptr']; if (typeof d!=='function') return; let p=0; try{ p=d.call(m,h)|0; }catch{ p=0; } if(!p)return; return heapViewU8(m,p,n); }
  eqActive0View(){ const m=this.mod; const h=this.h|0; const n=this.neq()|0; if(!n)return; const d=m['_mjwf_eq_active0_ptr']||m['_mjwf_model_eq_active0_ptr']; if (typeof d!=='function') return; let p=0; try{ p=d.call(m,h)|0; }catch{ p=0; } if(!p)return; return heapViewU8(m,p,n); }
  id2name(objtype, objid){ const m=this.mod; const h=this.h|0; const fn = m['_mjwf_mj_id2name']; if (typeof fn!=='function') return ''; try{ const p=fn.call(m,h, objtype|0, objid|0)|0; if(!p) return ''; return this._cstr(p); }catch{ return ''; } }
  camXposView(){ const m=this.mod; const h=this.h|0; const n=this.ncam(); if(!(n>0)) return; const d=m['_mjwf_data_cam_xpos_ptr'] || m['_mjwf_cam_xpos_ptr']; if (typeof d!=='function') return; let p=0; try { p=d.call(m,h)|0; } catch { p=0; } if(!p) return; return heapViewF64(m,p,n*3); }
  camXmatView(){ const m=this.mod; const h=this.h|0; const n=this.ncam(); if(!(n>0)) return; const d=m['_mjwf_data_cam_xmat_ptr'] || m['_mjwf_cam_xmat_ptr']; if (typeof d!=='function') return; let p=0; try { p=d.call(m,h)|0; } catch { p=0; } if(!p) return; return heapViewF64(m,p,n*9); }
  lightXposView(){ const m=this.mod; const h=this.h|0; const n=this.nlight(); if(!(n>0)) return; const d=m['_mjwf_data_light_xpos_ptr'] || m['_mjwf_light_xpos_ptr']; if (typeof d!=='function') return; let p=0; try { p=d.call(m,h)|0; } catch { p=0; } if(!p) return; return heapViewF64(m,p,n*3); }
  lightXdirView(){ const m=this.mod; const h=this.h|0; const n=this.nlight(); if(!(n>0)) return; const d=m['_mjwf_data_light_xdir_ptr'] || m['_mjwf_light_xdir_ptr']; if (typeof d!=='function') return; let p=0; try { p=d.call(m,h)|0; } catch { p=0; } if(!p) return; return heapViewF64(m,p,n*3); }
  stateSize(sig = MJ_STATE_INTEGRATION){
    const mod = this.mod;
    if (!mod) return 0;
    const fn = mod._mjwf_mj_stateSize;
    if (typeof fn !== 'function') return 0;
    try {
      const { modelPtr } = this.ensurePointers();
      if (!(modelPtr > 0)) return 0;
      return fn.call(mod, modelPtr | 0, sig >>> 0) | 0;
    } catch {
      return 0;
    }
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
      try { fn.call(mod, this.modelPtr | 0, this.dataPtr | 0, ptr | 0, sig >>> 0); } catch {}
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
      try {
        fn.call(mod, this.modelPtr | 0, this.dataPtr | 0, ptr | 0, sig >>> 0);
        ok = true;
      } catch {}
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
    try { return fn.call(m, h) | 0; } catch { return 0; }
  }
  setKeyframe(index){
    const m = this.mod;
    if (!m) return false;
    const fn = m._mjwf_mj_setKeyframe;
    if (typeof fn !== 'function') return false;
    this.ensurePointers();
    try {
      fn.call(m, this.modelPtr | 0, this.dataPtr | 0, index | 0);
      return true;
    } catch {
      return false;
    }
  }
  resetKeyframe(index){
    const m = this.mod;
    if (!m) return false;
    const fn = m._mjwf_mj_resetDataKeyframe;
    if (typeof fn !== 'function') return false;
    this.ensurePointers();
    try {
      fn.call(m, this.modelPtr | 0, this.dataPtr | 0, index | 0);
      this.forward();
      return true;
    } catch {
      return false;
    }
  }

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
  bodyParentIdView(){ const m=this.mod; const h=this.h|0; const n=this.nbody()|0; if(!(n>0)) return null; const fn=m?._mjwf_model_body_parentid_ptr; if (typeof fn!=='function') return null; const ptr=fn.call(m,h)|0; if(!(ptr>0)) return null; return heapViewI32(m, ptr, n); }

  geomXposView(){ const m=this.mod; const h=this.h|0; const n=this.ngeom(); if(!n)return; const pref=this.mode==='legacy' ? 'mjwf' : (this.pref||'mjwf'); const d=m['_' + pref + '_geom_xpos_ptr']; let p=0; if (typeof d==='function') p=d.call(m,h)|0; else { try{ p=m.ccall(pref+'_geom_xpos_ptr','number',['number'],[h])|0; }catch{ p=0; } } if(!p)return; return heapViewF64(m,p,n*3); }
  geomXmatView(){ const m=this.mod; const h=this.h|0; const n=this.ngeom(); if(!n)return; const pref=this.mode==='legacy' ? 'mjwf' : (this.pref||'mjwf'); const d=m['_' + pref + '_geom_xmat_ptr']; let p=0; if (typeof d==='function') p=d.call(m,h)|0; else { try{ p=m.ccall(pref+'_geom_xmat_ptr','number',['number'],[h])|0; }catch{ p=0; } } if(!p)return; return heapViewF64(m,p,n*9); }
  bodyXposView(){ const m=this.mod; const h=this.h|0; const n=this.nbody(); if(!n)return; const pref=this.mode==='legacy' ? 'mjwf' : (this.pref||'mjwf'); let d=m['_' + pref + '_body_xpos_ptr']; if (typeof d!=='function') { d = m['_' + pref + '_xpos_ptr'] || m['_' + pref + '_xipos_ptr'] || m['_' + pref + '_data_xpos_ptr']; } if (typeof d!=='function') return; let p=0; try{ p=d.call(m,h)|0; }catch{ p=0; } if(!p)return; return heapViewF64(m,p,n*3); }
  bodyXmatView(){ const m=this.mod; const h=this.h|0; const n=this.nbody(); if(!n)return; const pref=this.mode==='legacy' ? 'mjwf' : (this.pref||'mjwf'); let d=m['_' + pref + '_body_xmat_ptr']; if (typeof d!=='function') { d = m['_' + pref + '_xmat_ptr'] || m['_' + pref + '_data_xmat_ptr']; } if (typeof d!=='function') return; let p=0; try{ p=d.call(m,h)|0; }catch{ p=0; } if(!p)return; return heapViewF64(m,p,n*9); }
  bodyXiposView(){
    const m=this.mod; const h=this.h|0; const n=this.nbody(); if(!n)return;
    const pref=this.mode==='legacy' ? 'mjwf' : (this.pref||'mjwf');
    let d = m['_' + pref + '_body_xipos_ptr'];
    if (typeof d!=='function') {
      d = m['_' + pref + '_xipos_ptr'] || m['_' + pref + '_data_xipos_ptr'];
    }
    if (typeof d!=='function') return;
    let p=0; try{ p=d.call(m,h)|0; }catch{ p=0; }
    if(!p)return;
    return heapViewF64(m,p,n*3);
  }
  bodyCvelView(){ const m=this.mod; const h=this.h|0; const n=this.nbody(); if(!n)return; const d=m._mjwf_data_cvel_ptr || m._mjwf_cvel_ptr; if (typeof d!=='function') return; let p=0; try{ p=d.call(m,h)|0; }catch{ p=0; } if(!p)return; return heapViewF64(m,p,n*6); }
  bodyXquatView(){
    const m=this.mod; const h=this.h|0; const n=this.nbody(); if(!n)return;
    const d = m._mjwf_data_xquat_ptr;
    if (typeof d!=='function') return;
    let p=0; try{ p=d.call(m,h)|0; }catch{ p=0; }
    if(!p)return;
    return heapViewF64(m,p,n*4);
  }
  quat2Vel(quat, dt, target){
    const m = this.mod;
    if (!m) return null;
    const fn = m._mjwf_mju_quat2Vel || m.mju_quat2Vel;
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
  meshVertView(){
    const m=this.mod; const h=this.h|0; const n=this.nmesh(); if(!n)return;
    const d=m._mjwf_mesh_vert_ptr; if (typeof d!=='function') return;
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
    const d=m._mjwf_mesh_normal_ptr; if (typeof d!=='function') return;
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
    const d=m._mjwf_mesh_face_ptr; if (typeof d!=='function') return;
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
    const d=m._mjwf_mesh_texcoord_ptr; if (typeof d!=='function') return;
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
  meshTexcoordAdrView(){ const m=this.mod; const h=this.h|0; const n=this.nmesh(); if(!n)return; const d=m._mjwf_mesh_texcoordadr_ptr; if (typeof d!=='function') return; const p=d.call(m,h)|0; if(!p)return; return heapViewI32(m,p,n); }
  meshTexcoordNumView(){ const m=this.mod; const h=this.h|0; const n=this.nmesh(); if(!n)return; const d=m._mjwf_mesh_texcoordnum_ptr; if (typeof d!=='function') return; const p=d.call(m,h)|0; if(!p)return; return heapViewI32(m,p,n); }
  collectRenderAssets() {
    return collectRenderAssetsFromModule(this.mod, this.h | 0);
  }

  // --- Contacts (optional) ---
  ncon(){ const m=this.mod; const h=this.h|0; const d=m['_mjwf_ncon']; if (typeof d!=='function') return 0; return (d.call(m,h)|0)||0; }
  _resolveFn(names){ const m=this.mod; for(const name of names){ const fn=m[name]; if(typeof fn==='function') return fn; } return null; }
  contactPosView(){ const m=this.mod; const h=this.h|0; const n=this.ncon(); if(!(n>0)) return; const d=this._resolveFn(['_mjwf_data_contact_pos_ptr','_mjwf_contact_pos_ptr','_mjw_data_contact_pos_ptr','_mjw_contact_pos_ptr']); if(!d) return; const p=d.call(m,h)|0; if(!p) return; return heapViewF64(m,p,n*3); }
  contactFrameView(){ const m=this.mod; const h=this.h|0; const n=this.ncon(); if(!(n>0)) return; const d=this._resolveFn(['_mjwf_data_contact_frame_ptr','_mjwf_contact_frame_ptr','_mjw_data_contact_frame_ptr','_mjw_contact_frame_ptr']); if(!d) return; const p=d.call(m,h)|0; if(!p) return; return heapViewF64(m,p,n*9); }
  contactGeom1View(){ const m=this.mod; const h=this.h|0; const n=this.ncon(); if(!(n>0)) return; const d=this._resolveFn(['_mjwf_data_contact_geom1_ptr','_mjwf_contact_geom1_ptr','_mjw_data_contact_geom1_ptr','_mjw_contact_geom1_ptr']); if(!d) return; const p=d.call(m,h)|0; if(!p) return; return heapViewI32(m,p,n); }
  contactGeom2View(){ const m=this.mod; const h=this.h|0; const n=this.ncon(); if(!(n>0)) return; const d=this._resolveFn(['_mjwf_data_contact_geom2_ptr','_mjwf_contact_geom2_ptr','_mjw_data_contact_geom2_ptr','_mjw_contact_geom2_ptr']); if(!d) return; const p=d.call(m,h)|0; if(!p) return; return heapViewI32(m,p,n); }
  contactDistView(){ const m=this.mod; const h=this.h|0; const n=this.ncon(); if(!(n>0)) return; const d=this._resolveFn(['_mjwf_data_contact_dist_ptr','_mjwf_contact_dist_ptr']); if(!d) return; const p=d.call(m,h)|0; if(!p) return; return heapViewF64(m,p,n); }
  contactFrictionView(){ const m=this.mod; const h=this.h|0; const n=this.ncon(); if(!(n>0)) return; const d=this._resolveFn(['_mjwf_data_contact_friction_ptr','_mjwf_contact_friction_ptr']); if(!d) return; const p=d.call(m,h)|0; if(!p) return; return heapViewF64(m,p,n*5); }
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

// Local in-memory shim module has been removed; forge module must load correctly.
