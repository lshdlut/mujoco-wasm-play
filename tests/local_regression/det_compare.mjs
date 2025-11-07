// Compare end state (qpos/qvel) between two forge versions on the same XML.
// Usage: node tests/local_regression/det_compare.mjs <verA> <verB> [steps] [xmlPath]

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(__dirname, '../../');

const verA = process.argv[2] || '3.3.7';
const verB = process.argv[3] || '3.3.7';
const steps = parseInt(process.argv[4] || '1000', 10);
const xmlPathArg = process.argv[5];
const xmlDefault = path.resolve(repo, 'viewer_backend/demo_box.xml');

const demoXml = `<?xml version='1.0'?>\n<mujoco model='demo'>\n  <option timestep='0.002'/>\n  <worldbody>\n    <geom type='plane' pos='0 0 0' size='2 2 0.1' />\n    <body pos='0 0 0.2'>\n      <joint name='hinge' type='hinge' axis='0 1 0'/>\n      <geom type='box' size='0.03 0.03 0.03'/>\n    </body>\n  </worldbody>\n</mujoco>`;

async function readXmlOrDefault(p) {
  if (!p) return demoXml;
  try { const t = await readFile(p, 'utf8'); return t; } catch { return demoXml; }
}

async function loadModule(ver) {
  const base = path.resolve(repo, `local_tools/forge/dist/${ver}`);
  const js = pathToFileURL(path.join(base, `mujoco-${ver}.js`)).href;
  const create = (await import(js)).default;
  const mod = await create({ locateFile: (p) => (p.endsWith('.wasm') ? pathToFileURL(path.join(base, `mujoco-${ver}.wasm`)).href : p) });
  return mod;
}

async function runOnce(ver, xmlText, nSteps) {
  const { MjSimLite } = await import(pathToFileURL(path.resolve(repo, 'viewer_backend/bridge.mjs')).href);
  const mod = await loadModule(ver);
  const sim = new MjSimLite(mod);
  sim.initFromXmlStrict(xmlText);
  for (let i=0;i<nSteps;i++) sim.step(1);
  const qpos = sim.qposView()?.slice?.() || new Float64Array(0);
  const qvel = sim.qvelView()?.slice?.() || new Float64Array(0);
  sim.term?.();
  return { qpos, qvel };
}

function maxAbsDiff(a, b) {
  const n = Math.min(a.length|0, b.length|0); let m = 0;
  for (let i=0;i<n;i++){ const d = Math.abs((+a[i]||0) - (+b[i]||0)); if (d>m) m=d; }
  return m;
}

async function main(){
  const xml = await readXmlOrDefault(xmlPathArg || xmlDefault);
  const A = await runOnce(verA, xml, steps);
  const B = await runOnce(verB, xml, steps);
  const mQ = maxAbsDiff(A.qpos, B.qpos);
  const mV = maxAbsDiff(A.qvel, B.qvel);
  const ok = (mQ <= 1e-12) && (mV <= 1e-12);
  console.log(`det:${verA} vs ${verB} steps=${steps} max_abs(qpos)=${mQ} max_abs(qvel)=${mV} -> ${ok ? 'PASS' : 'FAIL'}`);
  process.exit(ok ? 0 : 2);
}

main().catch(e=>{ console.error('det_compare error:', e); process.exit(1); });
