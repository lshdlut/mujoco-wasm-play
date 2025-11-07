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

- Direct mode (Simulate UI): `index.html?mode=direct&ver=<ver>&debug=1`
- Worker mode (Simulate UI): `index.html?ver=<ver>&debug=1` (serve from repo root via HTTP)
- If `version.json` contains `sha256/git_sha/mujoco_git_sha`, the loader appends `?v=<sha8>` to `.wasm` for cache-busting.

## Probe (preflight)

- Legacy note: backend modules now live directly at the repo root (e.g. `physics.worker.mjs`); the old `local_tools/viewer_demo/` tree has been removed.
- Node: `node tests/local_regression/probe_groups_node.mjs <ver>` scans loader text for `_mjwf_*` symbols grouped by feature.

## Forge 3.3.7 helper exports

- Forge now emits 1100+ pointer/length helpers following the `mjwf_{owner}_{path}` convention (owner = `model` or `data`, nested struct segments flattened with `_`, pointer functions end in `_ptr`).
- The viewer/worker/bridge now consume that surface directly: handles come from `mjwf_helper_make_from_xml`, pointers from `mjwf_model_*`/`mjwf_data_*`, and simulation control calls `_mjwf_mj_step`, `_mjwf_mj_resetData`, etc.
- `forge_abi_compat.js` still runs, but only to keep pre-3.3.7 artifacts alive; new code paths never rely on the legacy `_mjwf_*` names.
- Helper entrypoints that remain exported by forge: `mjwf_helper_make_from_xml`, `mjwf_helper_free`, `mjwf_helper_valid`, `mjwf_helper_model_ptr`, `mjwf_helper_data_ptr`, the errno/errmsg getters, plus the `_mjwf_mj_*` wrappers around MuJoCo APIs.
- When you need a pointer/length combo, use `mjwf_model_*` or `mjwf_data_*` directly. Example: qpos view = `mjwf_data_qpos_ptr` + `mjwf_model_nq`, geom sizes = `mjwf_model_geom_size_ptr` + `mjwf_model_ngeom`.
- Contact convenience exports were dropped; the viewer currently hides contact overlays until we add a direct `mjContact` parser.
- Option editing no longer relies on `_mjwf_model_opt_ptr`; the viewer writes/reads each field via `mjwf_model_opt_*_ptr` (e.g. `mjwf_model_opt_timestep_ptr`).
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
- `MjSim` writes XML into MEMFS, calls `mjwf_helper_make_from_xml` via `ccall`, caches the model/data pointers, and dispatches simulation control to `_mjwf_mj_step`/`_mjwf_mj_resetData`.
- You can enable the local ForgeShim (export-fallback stubs) by setting `PLAY_FORGE_SHIM=1` in env, or appending `?shim=1` to the browser URL. The shim only fills in missing exports and never overrides real forge symbols.
- `forge_abi_compat.js` still runs automatically so older forge artifacts continue to work, but new code paths never rely on the legacy `_mjwf_*` names.
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

