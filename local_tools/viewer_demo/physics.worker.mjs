// Physics worker: loads MuJoCo WASM (dynamically), advances simulation at fixed rate,
// and posts Float64Array snapshots (xpos/xmat) back to the main thread.
import { collectRenderAssetsFromModule, heapViewF64, heapViewF32, heapViewI32, readCString } from './bridge.mjs';
import { writeOptionField, readOptionStruct } from '../../viewer_option_struct.mjs';
import { createSceneSnap } from './snapshots.mjs';
// Minimal local getView to avoid path issues in buildless mode
function getView(mod, ptr, dtype, len) {
  if (!ptr || !len) {
    if (dtype === 'f64') return new Float64Array(0);
    if (dtype === 'f32') return new Float32Array(0);
    return new Int32Array(0);
  }
  switch (dtype) {
    case 'f64':
      return heapViewF64(mod, ptr, len);
    case 'f32':
      return heapViewF32(mod, ptr, len);
    case 'i32':
      return heapViewI32(mod, ptr, len);
    default:
      return new Float64Array(0);
  }
}

let mod = null;
let h = 0;
let dt = 0.002;
let rate = 1.0;
let running = true;
let ngeom = 0;
let nu = 0;
let pendingCtrl = new Map(); // index -> value (clamped later)
let gestureState = { mode: 'idle', phase: 'idle', pointer: null };
let dragState = { dx: 0, dy: 0 };
let voptFlags = Array.from({ length: 32 }, () => 0);
let sceneFlags = Array.from({ length: 8 }, () => 0);
let labelMode = 0;
let frameMode = 0;
let cameraMode = 0;
let lastBounds = { center: [0, 0, 0], radius: 0 };
let alignSeq = 0;
let copySeq = 0;
let renderAssets = null;

const snapshotDebug = (() => {
  if (typeof self !== 'undefined') {
    const flag = self.PLAY_SNAPSHOT_DEBUG;
    if (flag === true || flag === 1 || flag === '1') return true;
  }
  try {
    const url = new URL(import.meta.url);
    return url.searchParams.get('snapshot') === '1';
  } catch {}
  return false;
})();

const snapshotState = { frame: 0, lastSim: null };

function wasmUrl(rel) { return new URL(rel, import.meta.url).href; }

// Boot log for diagnostics
try { postMessage({ kind:'log', message:'worker: boot' }); } catch {}

function cstr(modRef, ptr) {
  return readCString(modRef, ptr);
}

function logHandleFailure(stage, info) {
  let eno = 0;
  let emsg = '';
  try { if (mod && typeof mod._mjwf_errno_last === 'function') eno = mod._mjwf_errno_last() | 0; } catch {}
  try {
    if (mod && typeof mod._mjwf_errmsg_last === 'function') {
      emsg = cstr(mod, mod._mjwf_errmsg_last() | 0);
    } else if (mod && typeof mod._mjwf_errmsg_last_global === 'function') {
      emsg = cstr(mod, mod._mjwf_errmsg_last_global() | 0);
    }
  } catch {}
  try {
    postMessage({
      kind: 'log',
      message: `worker: handle failure (${stage})`,
      errno: eno,
      errmsg: emsg,
      extra: info ?? null,
    });
  } catch {}
}

function computeBoundsFromPositions(arr, n) {
  if (!arr || !n) {
    return { center: [0, 0, 0], radius: 0 };
  }
  let minx = Infinity;
  let miny = Infinity;
  let minz = Infinity;
  let maxx = -Infinity;
  let maxy = -Infinity;
  let maxz = -Infinity;
  for (let i = 0; i < n; i++) {
    const ix = 3 * i;
    const x = Number(arr[ix + 0]) || 0;
    const y = Number(arr[ix + 1]) || 0;
    const z = Number(arr[ix + 2]) || 0;
    if (x < minx) minx = x;
    if (y < miny) miny = y;
    if (z < minz) minz = z;
    if (x > maxx) maxx = x;
    if (y > maxy) maxy = y;
    if (z > maxz) maxz = z;
  }
  if (!Number.isFinite(minx) || !Number.isFinite(maxx)) {
    return { center: [0, 0, 0], radius: 0 };
  }
  const cx = (minx + maxx) / 2;
  const cy = (miny + maxy) / 2;
  const cz = (minz + maxz) / 2;
  const dx = maxx - minx;
  const dy = maxy - miny;
  const dz = maxz - minz;
  let radius = Math.max(dx, dy, dz) / 2;
  if (!Number.isFinite(radius) || radius <= 0) {
    radius = Math.max(0.1, Math.max(Math.abs(cx), Math.abs(cy), Math.abs(cz)));
  }
  return {
    center: [cx, cy, cz],
    radius,
  };
}

function captureBounds() {
  const n =
    (mod && mod.__localShimState)
      ? (mod.__localShimState.ngeom | 0)
      : (mod && typeof mod._mjwf_ngeom === 'function'
          ? (mod._mjwf_ngeom(h) | 0)
          : (ngeom | 0));
  if (!mod || !h || !(n > 0)) {
    return { center: [0, 0, 0], radius: 0 };
  }
  const ptr = typeof mod._mjwf_geom_xpos_ptr === 'function' ? (mod._mjwf_geom_xpos_ptr(h) | 0) : 0;
  if (!ptr) {
    return { center: [0, 0, 0], radius: 0 };
  }
  const view = getView(mod, ptr, 'f64', n * 3);
  return computeBoundsFromPositions(view, n);
}

function captureCopyState(precision) {
  const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const nq = mod && typeof mod._mjwf_nq === 'function' ? (mod._mjwf_nq(h) | 0) : 0;
  const nv = mod && typeof mod._mjwf_nv === 'function' ? (mod._mjwf_nv(h) | 0) : 0;
  const tSim = (mod && mod.__localShimState)
    ? mod.__localShimState.t
    : (mod && typeof mod._mjwf_time === 'function'
        ? mod._mjwf_time(h)
        : mod?.ccall?.('mjwf_time', 'number', ['number'], [h]) || 0);
  const payload = {
    kind: 'copyState',
    seq: ++copySeq,
    precision,
    nq,
    nv,
    timestamp: now,
    tSim,
    qposPreview: [],
    qvelPreview: [],
    complete: false,
  };
  if (nq > 0) {
    const ptr = mod && typeof mod._mjwf_qpos_ptr === 'function' ? (mod._mjwf_qpos_ptr(h) | 0) : 0;
    if (ptr) {
      const view = getView(mod, ptr, 'f64', nq);
      const limit = precision === 'full' ? nq : Math.min(nq, 8);
      for (let i = 0; i < limit; i++) {
        payload.qposPreview.push(Number(view[i]) || 0);
      }
      if (precision === 'full' && nq <= 128) {
        payload.qpos = Array.from(view);
        payload.complete = true;
      }
    }
  }
  if (nv > 0) {
    const ptr = mod && typeof mod._mjwf_qvel_ptr === 'function' ? (mod._mjwf_qvel_ptr(h) | 0) : 0;
    if (ptr) {
      const view = getView(mod, ptr, 'f64', nv);
      const limit = precision === 'full' ? nv : Math.min(nv, 8);
      for (let i = 0; i < limit; i++) {
        payload.qvelPreview.push(Number(view[i]) || 0);
      }
      if (precision === 'full' && nv <= 128) {
        payload.qvel = Array.from(view);
        payload.complete = payload.complete && nv <= 128;
      }
    }
  }
  return payload;
}

async function loadModule() {
  // If explicitly forced to local shim, build a minimal module and return immediately.
  try {
    const u = new URL(import.meta.url);
    const s = (u.searchParams.get('shim') || '').toLowerCase();
    if (s === 'local') {
      mod = createLocalModule();
      installLocalShim(mod);
      try { postMessage({ kind:'log', message:'Local shim installed (forced)' }); } catch {}
      return mod;
    }
  } catch {}
  try { postMessage({ kind:'log', message:'worker: loading forge module...' }); } catch {}
  // Build absolute URLs and import dynamically to avoid ref path/caching pitfalls
  // Versioned dist base from worker URL (?ver=...)
  let ver = '3.3.7';
  try { const urlSelf = new URL(import.meta.url); const v = urlSelf.searchParams.get('ver'); if (v) ver = v; } catch {}
  const distBase = new URL(`../../dist/${ver}/`, import.meta.url);
  const jsAbs = new URL(`mujoco.js`, distBase);
  const wasmAbs = new URL(`mujoco.wasm`, distBase);
  // Optional cache tag from version.json (sha8) to avoid stale caching
  let vTag = '';
  try { const vinfoUrl = new URL('version.json', distBase); vinfoUrl.searchParams.set('cb', String(Date.now())); const r = await fetch(vinfoUrl.href, { cache:'no-store' }); if (r.ok) { const j = await r.json(); const s = String(j.sha256||j.git_sha||j.mujoco_git_sha||''); vTag = s.slice(0,8); } } catch {}
  try {
    const loaderMod = await import(/* @vite-ignore */ jsAbs.href);
    const load_mujoco = loaderMod.default;
    const wasmUrl = new URL(wasmAbs.href);
    if (vTag) wasmUrl.searchParams.set('v', vTag); else wasmUrl.searchParams.set('cb', String(Date.now()));
    mod = await load_mujoco({ locateFile: (p) => (p.endsWith('.wasm') ? wasmUrl.href : p) });
  } catch (e) {
    // If forge import fails, fallback to a local in-memory shim so model still shows
    mod = createLocalModule();
    installLocalShim(mod);
    try { postMessage({ kind:'log', message:'Local shim installed (forge import failed)' }); } catch {}
    return mod;
  }
  // Optional: install ForgeShim when enabled
  try {
    const url = new URL(import.meta.url);
    const shimParam = url.searchParams.get('shim');
    const wantShim = (shimParam !== null) || (typeof self !== 'undefined' && (self.PLAY_FORGE_SHIM === 1 || self.PLAY_FORGE_SHIM === '1')) || (typeof process !== 'undefined' && process.env && process.env.PLAY_FORGE_SHIM === '1');
    const forceLocal = (shimParam && shimParam.toLowerCase() === 'local');
    const needShim = !(typeof (mod)._mjwf_make_from_xml === 'function' || typeof (mod).mjwf_make_from_xml === 'function');
    if (forceLocal) {
      installLocalShim(mod);
      postMessage({ kind: 'log', message: 'Local shim installed (forced)' });
    } else if (wantShim || needShim) {
      const shimAbs = new URL('../../dist/src/forge_shim.js', import.meta.url);
      try {
        const modShim = await import(/* @vite-ignore */ shimAbs.href);
        if (typeof modShim.installForgeShim === 'function') {
          modShim.installForgeShim(mod);
          postMessage({ kind: 'log', message: 'ForgeShim installed' });
        }
      } catch (e) {
        postMessage({ kind: 'log', message: 'ForgeShim unavailable, skipping shim install', extra: String(e || '') });
      }
    }
  } catch {}
  try {
    postMessage({
      kind:'log',
      message:'worker: forge module ready',
      extra: {
        hasMake: typeof (mod)._mjwf_make_from_xml === 'function',
        hasCcall: typeof mod.ccall === 'function'
      }
    });
    const geomKeys = Object.keys(mod || {}).filter((k) => k.includes('_geom_')).slice(0, 16);
    postMessage({ kind: 'log', message: 'worker: geom export sample', extra: geomKeys });
  } catch {}
  return mod;
}

function createLocalModule() {
  const MEM_BYTES = 4 * 1024 * 1024;
  const buf = new ArrayBuffer(MEM_BYTES);
  const HEAPU8 = new Uint8Array(buf);
  const HEAPF64 = new Float64Array(buf);
  let brk = 1024; // simple bump allocator
  function _malloc(n) { n = (n|0); if (n<=0) return 0; const align = 8; brk = (brk + (align-1)) & ~(align-1); if (brk + n >= MEM_BYTES) return 0; const p = brk; brk += n; return p; }
  function _free(_p) {}
  const files = new Map();
  const FS = {
    writeFile: (path, data) => { files.set(String(path), (data instanceof Uint8Array) ? data : new TextEncoder().encode(String(data))); },
    readFile: (path) => files.get(String(path)) || new Uint8Array(0),
  };
  const modLocal = { HEAPU8, HEAPF64, _malloc, _free, FS };
  modLocal.ccall = (name, _ret, _argt, args) => {
    const fn = modLocal['_' + name] || modLocal[name];
    if (typeof fn === 'function') return fn.apply(modLocal, args || []);
    return 0;
  };
  return modLocal;
}

function installLocalShim(mod) {
  try {
    const malloc = mod._malloc?.bind(mod);
    if (!malloc) return;
    const buffer =
      (mod.__heapBuffer instanceof ArrayBuffer && mod.__heapBuffer) ||
      mod.wasmExports?.memory?.buffer ||
      mod.wasmMemory?.buffer ||
      mod.asm?.memory?.buffer ||
      mod.asm?.wasmMemory?.buffer;
    if (!(buffer instanceof ArrayBuffer)) return;
    mod.__heapBuffer = buffer;
    const u8view = new Uint8Array(buffer);
    const f64view = new Float64Array(buffer);
    function alloc(n){ const p = malloc(n|0); new Uint8Array(buffer, p, n).fill(0); return p; }
    function writeF64(p,arr){ const off=p>>>3; for(let i=0;i<arr.length;i++) f64view[off+i]=+arr[i]||0; }
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
    // Mark local shim state
    mod.__localShimState = state;
  } catch {}
}

function tryMakeHandle(xmlText) {
  try { if (mod && typeof mod._mjwf_init === 'function') mod._mjwf_init(); } catch {}
  try {
    if (mod && typeof mod._mjwf_set_workdir === 'function') mod._mjwf_set_workdir('/');
    else if (mod && typeof mod._mjwf_chdir === 'function') mod._mjwf_chdir('/');
  } catch {}
  const candidates = ['/model.xml', 'model.xml'];
  const bytes = new TextEncoder().encode(xmlText || '');
  const pathExists = {};
  for (const path of candidates) {
    try { mod.FS.writeFile(path, bytes); } catch {}
    try { pathExists[path] = !!mod.FS.analyzePath(path).exists; } catch { pathExists[path] = false; }
  }
  const abi = ((mod)._mjwf_abi_version ? (mod)._mjwf_abi_version() : mod.ccall('mjwf_abi_version','number',[],[]))|0;
  for (const path of candidates) {
    const handle = mod.ccall('mjwf_make_from_xml','number',['string'],[path])|0;
    if (handle > 0) return { ok:true, abi, handle };
    logHandleFailure('tryMakeHandle_fail', { abi, len: xmlText ? xmlText.length : 0, path, exists: pathExists[path] });
  }
  return { ok:false, abi };
}

async function loadXmlWithFallback(xmlText) {
  try {
    if (!mod) await loadModule();
    const r = tryMakeHandle(xmlText);
    if (r.ok) return r;
  } catch (e) {
    logHandleFailure('primary_exception', e && String(e));
  }
  // Fallback: demo_box.xml (local)
  try {
    if (!mod) await loadModule();
    const res = await fetch(wasmUrl('./demo_box.xml'));
    const demo = await res.text();
    const r2 = tryMakeHandle(demo);
    if (r2.ok) return r2;
    logHandleFailure('demo_box_failed', { status: res.status });
  } catch (e) {
    logHandleFailure('demo_box_exception', e && String(e));
  }
  // Fallback: empty model inline
  const empty = `<?xml version='1.0'?>\n<mujoco model='empty'><option timestep='0.002'/><worldbody/></mujoco>`;
  if (!mod) await loadModule();
  const r3 = tryMakeHandle(empty);
  if (r3.ok) {
    try { postMessage({ kind:'log', message:'worker: empty model fallback succeeded' }); } catch {}
    return r3;
  }
  throw new Error('Unable to create handle');
}



function snapshot() {
  const tSim = (mod && mod.__localShimState) ? (mod.__localShimState.t) : ((mod)._mjwf_time ? (mod)._mjwf_time(h) : (mod.ccall('mjwf_time','number',['number'],[h])||0));
  const n = (mod && mod.__localShimState) ? (mod.__localShimState.ngeom|0) : (ngeom|0);
  let xpos = new Float64Array(0);
  let xmat = new Float64Array(0);
  // Optional contacts
  let contacts = null;
  let gsize = null; // Float64Array length n*3
  let gtype = null; // Int32Array length n
  let gmatid = null; // Int32Array length n
  let gdataid = null; // Int32Array length n
  let matrgba = null; // Float32Array length nmat*4
  let ctrl = null;
  let scenePayload = null;
  if (n > 0) {
    const pPtr = (mod)._mjwf_geom_xpos_ptr ? (mod)._mjwf_geom_xpos_ptr(h)|0 : mod.ccall('mjwf_geom_xpos_ptr','number',['number'],[h])|0;
    const mPtr = (mod)._mjwf_geom_xmat_ptr ? (mod)._mjwf_geom_xmat_ptr(h)|0 : mod.ccall('mjwf_geom_xmat_ptr','number',['number'],[h])|0;
    const vPos = getView(mod, pPtr, 'f64', n*3);
    const vMat = getView(mod, mPtr, 'f64', n*9);
    xpos = new Float64Array(vPos);
    xmat = new Float64Array(vMat);

    // Optional: geom size/type/matid and material rgba (feature-detect without ccall to avoid aborts)
    const sizePtr = typeof mod._mjwf_geom_size_ptr === 'function' ? (mod._mjwf_geom_size_ptr(h)|0) : 0;
    if (sizePtr) gsize = new Float64Array(getView(mod, sizePtr, 'f64', n*3));
    const typePtr = typeof mod._mjwf_geom_type_ptr === 'function' ? (mod._mjwf_geom_type_ptr(h)|0) : 0;
    if (typePtr) gtype = new Int32Array(getView(mod, typePtr, 'i32', n));
    const matidPtr = typeof mod._mjwf_geom_matid_ptr === 'function' ? (mod._mjwf_geom_matid_ptr(h)|0) : 0;
    if (matidPtr) gmatid = new Int32Array(getView(mod, matidPtr, 'i32', n));
    const dataidPtr = typeof mod._mjwf_geom_dataid_ptr === 'function' ? (mod._mjwf_geom_dataid_ptr(h)|0) : 0;
    if (dataidPtr) gdataid = new Int32Array(getView(mod, dataidPtr, 'i32', n));
    const nmat = typeof mod._mjwf_nmat === 'function' ? (mod._mjwf_nmat(h)|0) : 0;
    const mrgbaPtr = typeof mod._mjwf_mat_rgba_ptr === 'function' ? (mod._mjwf_mat_rgba_ptr(h)|0) : 0;
    if (nmat > 0 && mrgbaPtr) matrgba = new Float32Array(getView(mod, mrgbaPtr, 'f32', nmat*4));
    try {
      scenePayload = createSceneSnap({
        frame: snapshotState.frame,
        ngeom: n,
        gtype,
        gsize,
        gmatid,
        matrgba,
        gdataid,
        xpos,
        xmat,
        mesh: null,
      });
    } catch (err) {
      if (snapshotDebug) {
        try { postMessage({ kind: 'log', message: 'worker: scene snapshot prep failed', extra: String(err) }); } catch {}
      }
    }
    if (snapshotState) {
      snapshotState.lastSim = scenePayload ?? null;
      snapshotState.frame += 1;
    }
  }
  lastBounds = computeBoundsFromPositions(xpos, n);
  const nq = mod && typeof mod._mjwf_nq === 'function' ? (mod._mjwf_nq(h) | 0) : 0;
  const nv = mod && typeof mod._mjwf_nv === 'function' ? (mod._mjwf_nv(h) | 0) : 0;
  const nu = mod && typeof mod._mjwf_nu === 'function' ? (mod._mjwf_nu(h) | 0) : 0;
  if (nu > 0) {
    const ctrlPtr = typeof mod._mjwf_ctrl_ptr === 'function' ? (mod._mjwf_ctrl_ptr(h) | 0) : 0;
    if (ctrlPtr) {
      const view = getView(mod, ctrlPtr, 'f64', nu);
      ctrl = new Float64Array(view);
    }
  }
  // Contacts (feature-detect)
  try {
    const ncon = typeof mod._mjwf_ncon === 'function' ? (mod._mjwf_ncon(h)|0) : 0;
    const cposPtr = typeof mod._mjwf_contact_pos_ptr === 'function' ? (mod._mjwf_contact_pos_ptr(h)|0) : 0;
    const cfrmPtr = typeof mod._mjwf_contact_frame_ptr === 'function' ? (mod._mjwf_contact_frame_ptr(h)|0) : 0;
    const g1Ptr = typeof mod._mjwf_contact_geom1_ptr === 'function' ? (mod._mjwf_contact_geom1_ptr(h)|0) : 0;
    const g2Ptr = typeof mod._mjwf_contact_geom2_ptr === 'function' ? (mod._mjwf_contact_geom2_ptr(h)|0) : 0;
    const cdPtr = typeof mod._mjwf_contact_dist_ptr === 'function' ? (mod._mjwf_contact_dist_ptr(h)|0) : 0;
    const cfPtr = typeof mod._mjwf_contact_friction_ptr === 'function' ? (mod._mjwf_contact_friction_ptr(h)|0) : 0;
    if (ncon > 0 && cposPtr) {
      const pos = new Float64Array(getView(mod, cposPtr, 'f64', ncon*3));
      const data = { n:ncon, pos };
      if (cfrmPtr) {
        data.frame = new Float64Array(getView(mod, cfrmPtr, 'f64', ncon*9));
      }
      if (g1Ptr && g2Ptr) {
        data.geom1 = new Int32Array(getView(mod, g1Ptr, 'i32', ncon));
        data.geom2 = new Int32Array(getView(mod, g2Ptr, 'i32', ncon));
      }
      if (cdPtr) {
        data.dist = new Float64Array(getView(mod, cdPtr, 'f64', ncon));
      }
      if (cfPtr) {
        data.fric = new Float64Array(getView(mod, cfPtr, 'f64', ncon*5));
      }
      contacts = data;
    }
  } catch {}

  const gesture = gestureState
    ? {
        mode: gestureState.mode,
        phase: gestureState.phase,
        pointer: gestureState.pointer
          ? {
              x: Number(gestureState.pointer.x) || 0,
              y: Number(gestureState.pointer.y) || 0,
              dx: Number(gestureState.pointer.dx) || 0,
              dy: Number(gestureState.pointer.dy) || 0,
              buttons: Number(gestureState.pointer.buttons ?? 0),
              pressure: Number(gestureState.pointer.pressure ?? 0),
            }
          : null,
      }
    : { mode: 'idle', phase: 'idle', pointer: null };
  const drag = dragState
    ? { dx: Number(dragState.dx) || 0, dy: Number(dragState.dy) || 0 }
    : { dx: 0, dy: 0 };
  const msg = {
    kind: 'snapshot',
    tSim,
    ngeom: n,
    nq,
    nv,
    xpos,
    xmat,
    gesture,
    drag,
    voptFlags: Array.isArray(voptFlags) ? [...voptFlags] : [],
    sceneFlags: Array.isArray(sceneFlags) ? [...sceneFlags] : [],
    labelMode,
    frameMode,
    cameraMode,
  };
  const optionsStruct = readOptionStruct(mod, h);
  if (optionsStruct) {
    msg.options = optionsStruct;
  }
  const transfers = [xpos.buffer, xmat.buffer];
  if (contacts) { msg.contacts = contacts; transfers.push(contacts.pos.buffer); }
  if (gsize) { msg.gsize = gsize; transfers.push(gsize.buffer); }
  if (gtype) { msg.gtype = gtype; transfers.push(gtype.buffer); }
  if (gmatid) { msg.gmatid = gmatid; transfers.push(gmatid.buffer); }
  if (gdataid) { msg.gdataid = gdataid; transfers.push(gdataid.buffer); }
  if (matrgba) { msg.matrgba = matrgba; transfers.push(matrgba.buffer); }
  if (ctrl) { msg.ctrl = ctrl; transfers.push(ctrl.buffer); }
  postMessage(msg, transfers);

  if (scenePayload) {
    try {
      postMessage({ kind: 'scene_snapshot', source: 'sim', frame: scenePayload.frame ?? 0, snap: scenePayload });
    } catch (err) {
      if (snapshotDebug) {
        try { postMessage({ kind: 'log', message: 'worker: scene snapshot emit failed', extra: String(err) }); } catch {}
      }
    }
  }
}

function emitRenderAssets() {
  if (!mod || !(h > 0)) return;
  try {
    const assets = collectRenderAssetsFromModule(mod, h);
    if (!assets) return;
    renderAssets = assets;
    const transfers = collectAssetBuffersForTransfer(assets);
    try {
      postMessage({ kind: 'render_assets', assets }, transfers);
    } catch (err) {
      postMessage({ kind: 'log', message: 'worker: render_assets post failed', extra: String(err) });
    }
  } catch (err) {
    try {
      postMessage({ kind: 'log', message: 'worker: collectRenderAssets failed', extra: String(err) });
    } catch {}
  }
}

function collectAssetBuffersForTransfer(assets) {
  const buffers = [];
  const seen = new Set();
  const push = (arr) => {
    if (!arr || !arr.buffer || !(arr.buffer instanceof ArrayBuffer)) return;
    if (seen.has(arr.buffer)) return;
    seen.add(arr.buffer);
    buffers.push(arr.buffer);
  };
  if (assets?.geoms) {
    push(assets.geoms.size);
    push(assets.geoms.type);
    push(assets.geoms.matid);
    push(assets.geoms.bodyid);
  }
  if (assets?.materials) {
    push(assets.materials.rgba);
  }
  if (assets?.meshes) {
    push(assets.meshes.vertadr);
    push(assets.meshes.vertnum);
    push(assets.meshes.faceadr);
    push(assets.meshes.facenum);
    push(assets.meshes.texcoordadr);
    push(assets.meshes.texcoordnum);
    push(assets.meshes.vert);
    push(assets.meshes.face);
    push(assets.meshes.normal);
    push(assets.meshes.texcoord);
  }
  return buffers;
}

// Physics fixed-step timer (decoupled from render)
let lastSimNow = performance.now();
setInterval(() => {
  if (!mod || !h || !running) return;
  // Flush pending control writes (coalesce burst updates)
  try {
    if (pendingCtrl.size) {
      const cptr = typeof mod._mjwf_ctrl_ptr === 'function' ? (mod._mjwf_ctrl_ptr(h)|0) : 0;
      const crPtr = typeof mod._mjwf_actuator_ctrlrange_ptr === 'function' ? (mod._mjwf_actuator_ctrlrange_ptr(h)|0) : 0;
      if (nu>0 && cptr) {
        const ctrlView = getView(mod, cptr, 'f64', nu);
        const rangeView = crPtr ? (getView(mod, crPtr, 'f64', nu*2)) : undefined;
        for (const [i,v] of pendingCtrl.entries()) {
          let vv = +v||0;
          if (rangeView) {
            const lo = +rangeView[2*(i|0)]; const hi = +rangeView[2*(i|0)+1];
            const valid = Number.isFinite(lo) && Number.isFinite(hi) && (hi - lo) > 1e-12;
            if (valid) vv = Math.max(Math.min(hi, vv), lo);
          }
          ctrlView[i|0] = vv;
        }
        pendingCtrl.clear();
      }
    }
  } catch {}
  const now = performance.now();
  let acc = Math.min(0.1, (now - lastSimNow) / 1000) * rate;
  lastSimNow = now;
  let guard = 0;
  while (acc >= dt && guard < 1000) {
    if ((mod)._mjwf_step) (mod)._mjwf_step(h,1); else mod.ccall('mjwf_step','number',['number','number'],[h,1]);
    acc -= dt;
    guard++;
  }
}, 8);

// Snapshot timer at ~60Hz
setInterval(() => { if (mod && h) snapshot(); }, 16);

onmessage = async (ev) => {
  const msg = ev.data || {};
  try {
    if (msg.cmd === 'load') {
      // Dispose previous handle
      if (mod && h) { try { mod.ccall('mjwf_free', null, ['number'], [h]); } catch{} h = 0; }
      const { ok, abi, handle } = await loadXmlWithFallback(msg.xmlText || '');
      h = handle|0;
      dt = (mod && mod.__localShimState) ? mod.__localShimState.dt : ((mod)._mjwf_timestep ? (mod)._mjwf_timestep(h) : (mod.ccall('mjwf_timestep','number',['number'],[h])||0.002));
      ngeom = (mod && mod.__localShimState) ? (mod.__localShimState.ngeom|0) : ((mod)._mjwf_ngeom ? (mod)._mjwf_ngeom(h)|0 : (mod.ccall('mjwf_ngeom','number',['number'],[h])|0));
      nu = (typeof mod._mjwf_nu === 'function') ? (mod._mjwf_nu(h)|0) : (mod.ccall('mjwf_nu','number',['number'],[h])|0);
      running = true;
      rate = typeof msg.rate === 'number' ? msg.rate : 1.0;
      gestureState = { mode: 'idle', phase: 'idle', pointer: null };
      dragState = { dx: 0, dy: 0 };
      voptFlags = Array.from({ length: 32 }, () => 0);
      sceneFlags = Array.from({ length: 8 }, () => 0);
      labelMode = 0;
      frameMode = 0;
      cameraMode = 0;
      postMessage({ kind:'ready', abi, dt, ngeom });
      try { postMessage({ kind: 'options', voptFlags: [...voptFlags], sceneFlags: [...sceneFlags], labelMode, frameMode, cameraMode }); } catch {}
      // Send joint/geom mapping meta for picking->joint association (optional)
      try {
        const nj = typeof mod._mjwf_njnt === 'function' ? (mod._mjwf_njnt(h)|0) : 0;
        const gbidPtr = typeof mod._mjwf_geom_bodyid_ptr === 'function' ? (mod._mjwf_geom_bodyid_ptr(h)|0) : 0;
        const bjadrPtr = typeof mod._mjwf_body_jntadr_ptr === 'function' ? (mod._mjwf_body_jntadr_ptr(h)|0) : 0;
        const bjnumPtr = typeof mod._mjwf_body_jntnum_ptr === 'function' ? (mod._mjwf_body_jntnum_ptr(h)|0) : 0;
        const jtypePtr = typeof mod._mjwf_jnt_type_ptr === 'function' ? (mod._mjwf_jnt_type_ptr(h)|0) : 0;
        let geom_bodyid = null, body_jntadr = null, body_jntnum = null, jtype = null;
        if (ngeom>0 && gbidPtr) geom_bodyid = new Int32Array(getView(mod, gbidPtr, 'i32', ngeom));
        const nbody = typeof mod._mjwf_nbody === 'function' ? (mod._mjwf_nbody(h)|0) : 0;
        if (nbody>0 && bjadrPtr) body_jntadr = new Int32Array(getView(mod, bjadrPtr, 'i32', nbody));
        if (nbody>0 && bjnumPtr) body_jntnum = new Int32Array(getView(mod, bjnumPtr, 'i32', nbody));
        if (nj>0 && jtypePtr) jtype = new Int32Array(getView(mod, jtypePtr, 'i32', nj));
        postMessage({ kind:'meta_joints', ngeom, nbody, njnt: nj, geom_bodyid, body_jntadr, body_jntnum, jtype },
          [geom_bodyid?.buffer, body_jntadr?.buffer, body_jntnum?.buffer, jtype?.buffer].filter(Boolean));
      } catch {}
      // Send meta for control panel (always). If nu==0, send empty to clear UI.
      try {
        const acts = [];
        if (nu > 0) {
          const crPtr = typeof mod._mjwf_actuator_ctrlrange_ptr === 'function' ? (mod._mjwf_actuator_ctrlrange_ptr(h)|0) : 0;
          const crView = crPtr ? (getView(mod, crPtr, 'f64', nu*2)) : undefined;
          for (let i=0;i<nu;i++) {
            let name = `act ${i}`;
            try {
              const nptr = typeof mod._mjwf_actuator_name_of === 'function' ? (mod._mjwf_actuator_name_of(h,i)|0) : 0;
              if (nptr) {
                const s = readCString(mod, nptr);
                if (s) name = s;
              }
            } catch {}
            const rawLo = crView ? (+crView[2*i]) : NaN;
            const rawHi = crView ? (+crView[2*i+1]) : NaN;
            const valid = Number.isFinite(rawLo) && Number.isFinite(rawHi) && (rawHi - rawLo) > 1e-12;
            const lo = valid ? rawLo : -1;
            const hi = valid ? rawHi : 1;
            acts.push({ index:i, name, min: lo, max: hi, step: 0.001, value: 0 });
          }
        }
        postMessage({ kind:'meta', actuators: acts });
      } catch {}
      snapshot();
      emitRenderAssets();
    } else if (msg.cmd === 'reset') {
      if (mod && h) {
        const ok = mod.ccall('mjwf_reset','number',['number'],[h])|0;
        if (ok === 1) {
          gestureState = { mode: 'idle', phase: 'idle', pointer: null };
          dragState = { dx: 0, dy: 0 };
          voptFlags = Array.from({ length: 32 }, () => 0);
          sceneFlags = Array.from({ length: 8 }, () => 0);
          labelMode = 0;
          frameMode = 0;
          cameraMode = 0;
          snapshot();
          emitRenderAssets();
        }
      }
    } else if (msg.cmd === 'step') {
      if (mod && h) {
        const n = Math.max(1, Math.min(10000, (msg.n|0) || 1));
        if ((mod)._mjwf_step) (mod)._mjwf_step(h,n); else mod.ccall('mjwf_step','number',['number','number'],[h,n]);
        snapshot();
      }
    } else if (msg.cmd === 'gesture') {
      const sourceGesture = msg.gesture || {};
      const mode = typeof msg.mode === 'string' ? msg.mode : sourceGesture.mode;
      const phase = typeof msg.phase === 'string' ? msg.phase : sourceGesture.phase;
      const pointerSource = msg.pointer ?? sourceGesture.pointer ?? null;
      const pointer = pointerSource
        ? {
            x: Number(pointerSource.x) || 0,
            y: Number(pointerSource.y) || 0,
            dx: Number(pointerSource.dx) || 0,
            dy: Number(pointerSource.dy) || 0,
            buttons: Number(pointerSource.buttons ?? 0),
            pressure: Number(pointerSource.pressure ?? 0),
          }
        : null;
      const dragSource = msg.drag ?? (pointer ? { dx: pointer.dx, dy: pointer.dy } : null);
      gestureState = {
        mode: phase === 'end' ? 'idle' : (mode ?? gestureState.mode ?? 'idle'),
        phase: phase ?? gestureState.phase ?? 'update',
        pointer,
      };
      if (dragSource) {
        dragState = {
          dx: Number(dragSource.dx) || 0,
          dy: Number(dragSource.dy) || 0,
        };
      } else if (gestureState.phase === 'end') {
        dragState = { dx: 0, dy: 0 };
      }
      try { postMessage({ kind: 'gesture', gesture: gestureState, drag: dragState }); } catch {}
    } else if (msg.cmd === 'setVoptFlag') {
      const idx = Number(msg.index) | 0;
      const enabled = !!msg.enabled;
      if (!Array.isArray(voptFlags)) voptFlags = Array.from({ length: 32 }, () => 0);
      if (idx >= 0 && idx < voptFlags.length) {
        voptFlags[idx] = enabled ? 1 : 0;
        try { postMessage({ kind: 'options', voptFlags: [...voptFlags], sceneFlags: [...sceneFlags], labelMode, frameMode, cameraMode }); } catch {}
      }
    } else if (msg.cmd === 'setSceneFlag') {
      const idx = Number(msg.index) | 0;
      const enabled = !!msg.enabled;
      if (!Array.isArray(sceneFlags)) sceneFlags = Array.from({ length: 8 }, () => 0);
      if (idx >= 0 && idx < sceneFlags.length) {
        sceneFlags[idx] = enabled ? 1 : 0;
        try { postMessage({ kind: 'options', voptFlags: [...voptFlags], sceneFlags: [...sceneFlags], labelMode, frameMode, cameraMode }); } catch {}
      }
    } else if (msg.cmd === 'setLabelMode') {
      const modeVal = Number(msg.mode) || 0;
      labelMode = modeVal | 0;
      try { postMessage({ kind: 'options', voptFlags: [...voptFlags], sceneFlags: [...sceneFlags], labelMode, frameMode, cameraMode }); } catch {}
    } else if (msg.cmd === 'setFrameMode') {
      const modeVal = Number(msg.mode) || 0;
      frameMode = modeVal | 0;
      try { postMessage({ kind: 'options', voptFlags: [...voptFlags], sceneFlags: [...sceneFlags], labelMode, frameMode, cameraMode }); } catch {}
    } else if (msg.cmd === 'setCameraMode') {
      const modeVal = Number(msg.mode) || 0;
      cameraMode = modeVal | 0;
      try { postMessage({ kind: 'options', voptFlags: [...voptFlags], sceneFlags: [...sceneFlags], labelMode, frameMode, cameraMode }); } catch {}
    } else if (msg.cmd === 'setField') {
      const target = msg.target;
      if (target === 'mjOption') {
        try {
          const ok = writeOptionField(mod, h, Array.isArray(msg.path) ? msg.path : [], msg.kind, msg.value);
          if (ok) {
            snapshot();
          } else if (snapshotDebug) {
            postMessage({ kind: 'log', message: 'worker: setField (mjOption) unsupported', extra: String(msg.path || []) });
          }
        } catch (err) {
          postMessage({ kind: 'log', message: 'worker: setField (mjOption) failed', extra: String(err) });
        }
      }
    } else if (msg.cmd === 'applyForce') {
      // Expected: { geomIndex, force:[fx,fy,fz], torque:[tx,ty,tz], point:[x,y,z] }
      try {
        const fx=+msg.force?.[0]||0, fy=+msg.force?.[1]||0, fz=+msg.force?.[2]||0;
        const tx=+msg.torque?.[0]||0, ty=+msg.torque?.[1]||0, tz=+msg.torque?.[2]||0;
        const px=+msg.point?.[0]||0, py=+msg.point?.[1]||0, pz=+msg.point?.[2]||0;
        const gi=msg.geomIndex|0;
        if (typeof mod._mjwf_apply_xfrc === 'function') {
          mod._mjwf_apply_xfrc(h, gi, fx,fy,fz, tx,ty,tz, px,py,pz);
        } else {
          // Fallback: write to xfrc_applied for the owning body if pointers exist
          const bodyIdPtr = typeof mod._mjwf_geom_bodyid_ptr === 'function' ? (mod._mjwf_geom_bodyid_ptr(h)|0) : 0;
          const xfrcPtr = typeof mod._mjwf_xfrc_applied_ptr === 'function' ? (mod._mjwf_xfrc_applied_ptr(h)|0) : 0;
          if (bodyIdPtr && xfrcPtr) {
            const bodyIdView = getView(mod, bodyIdPtr, 'i32', ngeom);
            const H = getView(mod, xfrcPtr, 'f64', (typeof mod._mjwf_nbody==='function' ? (mod._mjwf_nbody(h)|0) : 0)*6);
            const bid = bodyIdView[gi|0]|0;
            if (bid >= 0 && H && (6*bid+5) < H.length) {
              H[6*bid+0]+=fx; H[6*bid+1]+=fy; H[6*bid+2]+=fz; H[6*bid+3]+=tx; H[6*bid+4]+=ty; H[6*bid+5]+=tz;
            }
          }
        }
      } catch {}
    } else if (msg.cmd === 'align') {
      const info = captureBounds();
      if (info) lastBounds = info;
      const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
      try {
        postMessage({
          kind: 'align',
          seq: ++alignSeq,
          center: (info && info.center) || [0, 0, 0],
          radius: (info && info.radius) || 0,
          timestamp: now,
          source: msg.source || 'backend',
        });
      } catch {}
    } else if (msg.cmd === 'copyState') {
      const precision = msg.precision === 'full' ? 'full' : 'standard';
      const payload = captureCopyState(precision);
      payload.source = msg.source || 'backend';
      try { postMessage(payload); } catch {}
    } else if (msg.cmd === 'setCtrl') {
      // Write a single actuator control value if pointers available
      try { const i = msg.index|0; pendingCtrl.set(i, +msg.value||0); } catch {}
    } else if (msg.cmd === 'setRate') {
      rate = Math.max(0.0625, Math.min(16, +msg.rate || 1));
    } else if (msg.cmd === 'setPaused') {
      running = !msg.paused;
    } else if (msg.cmd === 'snapshot') {
      if (mod && h) snapshot();
    }
  } catch (e) {
    try { postMessage({ kind:'error', message: String(e) }); } catch {}
  }
};
