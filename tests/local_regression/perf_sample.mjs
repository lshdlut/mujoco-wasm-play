// Measure ms/step and rough FPS for a given version and XML.
// Usage: node tests/local_regression/perf_sample.mjs <ver> [steps] [xmlPath]

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(__dirname, '../../');

const ver = process.argv[2] || '3.3.7';
const steps = parseInt(process.argv[3] || '2000', 10);
const xmlPathArg = process.argv[4];
const xmlDefault = path.resolve(repo, 'local_tools/viewer_demo/demo_box.xml');

const demoXml = `<?xml version='1.0'?>\n<mujoco model='demo'><worldbody/></mujoco>`;

async function readXmlOrDefault(p) { try { return p ? await readFile(p, 'utf8') : await readFile(xmlDefault, 'utf8'); } catch { return demoXml; } }

async function loadModule(ver) {
  const base = path.resolve(repo, `local_tools/forge/dist/${ver}`);
  const js = pathToFileURL(path.join(base, `mujoco-${ver}.js`)).href;
  const create = (await import(js)).default;
  const mod = await create({ locateFile: (p) => (p.endsWith('.wasm') ? pathToFileURL(path.join(base, `mujoco-${ver}.wasm`)).href : p) });
  return mod;
}

async function main(){
  const { MjSimLite } = await import(pathToFileURL(path.resolve(repo, 'local_tools/viewer_demo/bridge.mjs')).href);
  const xml = await readXmlOrDefault(xmlPathArg);
  const mod = await loadModule(ver);
  const sim = new MjSimLite(mod);
  sim.initFromXmlStrict(xml);
  const t0 = performance.now();
  for (let i=0;i<steps;i++) sim.step(1);
  const t1 = performance.now();
  const msStep = (t1 - t0) / Math.max(1, steps);
  const fps = 1000 / Math.max(1e-6, msStep);
  console.log(`perf:${ver} steps=${steps} ms/step=${msStep.toFixed(4)} fps~${fps.toFixed(1)}`);
}

main().catch(e=>{ console.error('perf_sample error:', e); process.exit(1); });

