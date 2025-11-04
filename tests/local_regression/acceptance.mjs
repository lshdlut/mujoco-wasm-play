// All-in-one local acceptance runner for forge vNEXT vs baseline.
// Usage: node tests/local_regression/acceptance.mjs <vNEXT> [baseline=3.3.7] [steps=1000] [xmlPath]

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(__dirname, '../../');

const vNEXT = process.argv[2];
if (!vNEXT) { console.error('usage: node tests/local_regression/acceptance.mjs <vNEXT> [baseline] [steps] [xml]'); process.exit(1); }
const base = process.argv[3] || '3.3.7';
const steps = parseInt(process.argv[4] || '1000', 10);
const xmlArg = process.argv[5];

const xmlDefault = path.resolve(repo, 'local_tools/tmp_det_model.xml');

const groups = {
  core: ['_mjwf_make_from_xml','_mjwf_step','_mjwf_reset','_mjwf_free','_mjwf_timestep','_mjwf_time'],
  views: ['_mjwf_qpos_ptr','_mjwf_qvel_ptr','_mjwf_nq','_mjwf_nv'],
  geom: ['_mjwf_geom_xpos_ptr','_mjwf_geom_xmat_ptr','_mjwf_ngeom'],
  material: ['_mjwf_geom_type_ptr','_mjwf_geom_size_ptr','_mjwf_geom_matid_ptr','_mjwf_nmat','_mjwf_mat_rgba_ptr'],
  joint: ['_mjwf_njnt','_mjwf_jnt_type_ptr','_mjwf_jnt_qposadr_ptr','_mjwf_jnt_range_ptr','_mjwf_jnt_name_of'],
  act: ['_mjwf_nu','_mjwf_ctrl_ptr','_mjwf_actuator_ctrlrange_ptr','_mjwf_actuator_name_of'],
  contact: ['_mjwf_ncon','_mjwf_contact_pos_ptr','_mjwf_contact_frame_ptr']
};

async function readXml() {
  if (!xmlArg) return await readFile(xmlDefault, 'utf8');
  try { return await readFile(xmlArg, 'utf8'); } catch { return await readFile(xmlDefault, 'utf8'); }
}

async function loadModule(ver) {
  const baseDir = path.resolve(repo, `local_tools/forge/dist/${ver}`);
  const js = pathToFileURL(path.join(baseDir, `mujoco-${ver}.js`)).href;
  const create = (await import(js)).default;
  const Module = await create({ locateFile: (p) => (p.endsWith('.wasm') ? pathToFileURL(path.join(baseDir, `mujoco-${ver}.wasm`)).href : p) });
  return Module;
}

async function probeGroups(ver) {
  const baseDir = path.resolve(repo, `local_tools/forge/dist/${ver}`);
  const jsPath = path.join(baseDir, `mujoco-${ver}.js`);
  const txt = await readFile(jsPath, 'utf8');
  const have = new Set();
  for (const line of txt.split(/\r?\n/)) {
    const m = line.match(/_mjw[f]?_[A-Za-z0-9_]+/g);
    if (m) for (const s of m) have.add(s);
  }
  const ok = {}; const miss = {};
  for (const [g, list] of Object.entries(groups)) {
    ok[g] = list.every(k=> have.has(k) || have.has(k.replace('_mjwf_','_mjw_')) );
    miss[g] = list.filter(k=> !(have.has(k) || have.has(k.replace('_mjwf_','_mjw_'))) );
  }
  return { ok, miss };
}

async function runDetAndPerf(verA, verB, steps, xmlText) {
  const { MjSimLite } = await import(pathToFileURL(path.resolve(repo, 'local_tools/viewer_demo/bridge.mjs')).href);
  async function run(ver, n, perfOnly=false){
    const mod = await loadModule(ver);
    const sim = new MjSimLite(mod);
    sim.initFromXml(xmlText);
    const t0 = performance.now();
    for (let i=0;i<n;i++) sim.step(1);
    const t1 = performance.now();
    const msStep = (t1 - t0) / Math.max(1,n);
    if (perfOnly) return { msStep };
    return { qpos: sim.qposView()?.slice?.() || new Float64Array(0), qvel: sim.qvelView()?.slice?.() || new Float64Array(0), msStep };
  }
  const A = await run(verA, steps);
  const B = await run(verB, steps);
  function maxAbs(a,b){ const n=Math.min(a.length,b.length); let m=0; for(let i=0;i<n;i++){ const d=Math.abs((+a[i]||0)-(+b[i]||0)); if(d>m)m=d; } return m; }
  const mQ = maxAbs(A.qpos, B.qpos);
  const mV = maxAbs(A.qvel, B.qvel);
  // Use a larger perf sample to reduce timer noise on fast runs
  const perfSteps = Math.max(20000, steps * 20);
  const Ap = await run(verA, perfSteps, true);
  const Bp = await run(verB, perfSteps, true);
  const perfDiff = Math.abs(Bp.msStep - Ap.msStep) / Math.max(1e-9, Ap.msStep) * 100;
  return { mQ, mV, baseMs:Ap.msStep, nextMs:Bp.msStep, perfDiff };
}

async function main(){
  const xml = await readXml();
  const pr = await probeGroups(vNEXT);
  const fatalMiss = (!pr.ok.core || !pr.ok.views);
  const probeLine = `probe:${vNEXT} ` + Object.entries(pr.ok).map(([k,v])=>`${k}=${v?'OK':'MISS'}`).join(' ');
  console.log(probeLine);
  if (fatalMiss) { console.error('FATAL: probe fatal groups missing'); process.exit(2); }
  const detPerf = await runDetAndPerf(base, vNEXT, steps, xml);
  const detLine = `det: baseline(${base}) vs ${vNEXT}, steps=${steps}, max_abs(qpos)=${detPerf.mQ}, max_abs(qvel)=${detPerf.mV} -> ${ (detPerf.mQ<=1e-12 && detPerf.mV<=1e-12)?'PASS':'FAIL' }`;
  console.log(detLine);
  const perfLine = `perf: base=${detPerf.baseMs.toFixed(4)} ms/step, next=${detPerf.nextMs.toFixed(4)} ms/step, diff=${detPerf.perfDiff.toFixed(1)}% -> ${ (detPerf.perfDiff<=5.0)?'PASS':'FAIL' }`;
  console.log(perfLine);
  const ok = (detPerf.mQ<=1e-12 && detPerf.mV<=1e-12 && detPerf.perfDiff<=5.0);
  process.exit(ok?0:3);
}

main().catch(e=>{ console.error('acceptance error:', e); process.exit(1); });
