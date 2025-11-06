#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

const ver = process.argv[2] || '3.3.7';
const distDir = path.join(repoRoot, 'dist', ver);
const jsPath = path.join(distDir, 'mujoco.js');
const wasmPath = path.join(distDir, 'mujoco.wasm');

async function loadModule() {
  const factory = (await import(pathToFileURL(jsPath))).default;
  if (typeof factory !== 'function') {
    throw new Error('mujoco.js missing default export');
  }
  return factory({
    locateFile: (p) => (p.endsWith('.wasm') ? wasmPath : p),
  });
}

function groupByPrefix(symbols, prefix = '_mjwf_') {
  return symbols
    .filter((name) => name.startsWith(prefix))
    .sort();
}

function detectOptionPtr(mod) {
  const candidates = [
    '_mjwf_model_opt_ptr',
    '_mjwf_opt_ptr',
    '_mjwf_option_ptr',
  ];
  return candidates.filter((name) => typeof mod[name] === 'function');
}

function dumpSummary(mod) {
  const allSymbols = Object.keys(mod || {});
  const forgeSymbols = groupByPrefix(allSymbols);
  const optionPtrs = detectOptionPtr(mod);
  return {
    totalSymbols: allSymbols.length,
    mjwfCount: forgeSymbols.length,
    optionPtrCandidates: optionPtrs,
    sample: forgeSymbols.slice(0, 50),
  };
}

async function main() {
  try {
    const mod = await loadModule();
    const summary = dumpSummary(mod);
    console.log(JSON.stringify(summary, null, 2));
  } catch (err) {
    console.error('[probe_exports] failed:', err);
    process.exit(1);
  }
}

main();
