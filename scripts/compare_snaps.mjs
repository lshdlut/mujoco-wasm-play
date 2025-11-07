#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { diffSceneSnaps } from '../snapshots.mjs';

function printUsage() {
  const script = path.basename(process.argv[1] || 'compare_snaps.mjs');
  console.log(`Usage: node ${script} <sim-snapshot.json> <adapter-snapshot.json>`);
  console.log('Compares two SceneSnap JSON dumps and reports topology/hash differences.');
}

function summarise(scene) {
  if (!scene || !Array.isArray(scene.geoms)) {
    return { geoms: 0, types: {} };
  }
  const types = {};
  for (const geom of scene.geoms) {
    const type = geom?.type || 'unknown';
    types[type] = (types[type] || 0) + 1;
  }
  return {
    geoms: scene.geoms.length,
    frame: scene.frame ?? null,
    types,
  };
}

async function readJson(filePath) {
  const abs = path.resolve(process.cwd(), filePath);
  const data = await fs.readFile(abs, 'utf8');
  return JSON.parse(data);
}

async function main() {
  const args = process.argv.slice(2).filter((arg) => !arg.startsWith('--'));
  if (args.length !== 2) {
    printUsage();
    process.exitCode = 1;
    return;
  }

  let simSnap;
  let adapterSnap;
  try {
    simSnap = await readJson(args[0]);
  } catch (err) {
    console.error(`Failed to read sim snapshot "${args[0]}":`, err.message || err);
    process.exitCode = 1;
    return;
  }
  try {
    adapterSnap = await readJson(args[1]);
  } catch (err) {
    console.error(`Failed to read adapter snapshot "${args[1]}":`, err.message || err);
    process.exitCode = 1;
    return;
  }

  const simSummary = summarise(simSnap);
  const adapterSummary = summarise(adapterSnap);
  console.log('[compare] sim summary    ', simSummary);
  console.log('[compare] adapter summary', adapterSummary);

  const diff = diffSceneSnaps(simSnap, adapterSnap);
  if (diff.ok) {
    console.log('[compare] result: OK (topology + hashes match)');
    process.exitCode = 0;
  } else {
    console.warn('[compare] result: mismatch');
    if (diff.differences?.length) {
      for (const line of diff.differences) {
        console.warn(` - ${line}`);
      }
    }
    process.exitCode = 2;
  }
}

main().catch((err) => {
  console.error('[compare] unexpected failure', err);
  process.exitCode = 1;
});
