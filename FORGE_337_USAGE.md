# Using Forge 3.3.7 Artifacts in this repo

This repo consumes MuJoCo WASM artifacts built by `mujoco-wasm-forge` (default version 3.3.7). The loader and wrappers expect the versioned artifacts at:

- `local_tools/forge/dist/<ver>/mujoco-<ver>.js`
- `local_tools/forge/dist/<ver>/mujoco-<ver>.wasm`

Nothing in `local_tools/` is version-controlled here. Keep artifacts local-only.

## Getting the artifacts

Option A — download from release:

1) Create directory

```
PowerShell> New-Item -Force -ItemType Directory local_tools/forge/dist/3.3.7
```

2) Download files

```
PowerShell> curl -L -o local_tools/forge/dist/3.3.7/mujoco-3.3.7.js   https://github.com/lshdlut/mujoco-wasm-forge/releases/download/forge-3.3.7-r1/mujoco-3.3.7.js
PowerShell> curl -L -o local_tools/forge/dist/3.3.7/mujoco-3.3.7.wasm https://github.com/lshdlut/mujoco-wasm-forge/releases/download/forge-3.3.7-r1/mujoco-3.3.7.wasm
```

Option B — stage from local forge build:

```
PowerShell (in ../mujoco-wasm-forge)> pwsh scripts/stage_local.ps1
```

Then copy `forge/dist/<ver>/*` to `mujoco-wasm-play/local_tools/forge/dist/<ver>/`.

## Switching versions in the viewer

- Direct mode: `local_tools/viewer_demo/index.html?direct=1&nofallback=1&ver=<ver>`
- Worker mode: `local_tools/viewer_demo/index.html?ver=<ver>` (serve from repo root via HTTP)
- If `version.json` contains `sha256/git_sha/mujoco_git_sha`, the loader appends `?v=<sha8>` to `.wasm` for cache-busting.

## Probe (preflight)

- Browser: open `local_tools/viewer_demo/probe.html?ver=<ver>` and click Probe → console prints `probe:<ver> core=OK ...`
- Node: `node tests/local_regression/probe_groups_node.mjs <ver>` scans loader text for `_mjwf_*` symbols grouped by feature.

## Load and step (Node ESM)

```
import { loadForge337 } from './src/wasm/loader.js';
import { MjSim } from './src/api/sim.js';

const xml = "<?xml version='1.0'?><mujoco model='empty'><worldbody/></mujoco>";
const mod = await loadForge337();
const sim = new MjSim(mod);
sim.initFromXml(xml);
sim.step(100);
console.log('nq =', sim.nq());
sim.term();
```

Notes:
- The loader wires `locateFile` so the `.wasm` resolves from the expected folder.
- `MjSim` auto-detects the handle-based `mjwf_*` surface (preferred) and falls back to the legacy demo symbols if present.
- You can enable the local ForgeShim (export-fallback stubs) by setting `PLAY_FORGE_SHIM=1` in env, or appending `?shim=1` to the browser URL. The shim only fills in missing exports and never overrides real forge symbols.

## Tests

- Install dev deps and run tests:

```
PowerShell> npm i
PowerShell> npm test
```

- Tests are skipped automatically if artifacts are not present locally.

## Smoke script (manual)

- `npm run smoke` executes `local_tools/tmp_smoke.mjs`, which loads the module directly and steps a tiny model.

## Policy

- Artifacts come exclusively from `mujoco-wasm-forge` builds or releases.
- Do not check artifacts into version control. `local_tools/` is ignored.
