# mujoco-wasm-play

Glue-layer and playground for consuming MuJoCo WASM artifacts produced by 'mujoco-wasm-forge'.

- Target core: Forge/WASM 3.3.7
- Status: P0 in progress (WASM loader + smoke test scaffold)

## Quick Start (3.3.7)

- Get Forge artifacts (3.3.7) into `local_tools/forge/dist/3.3.7/`:

  PowerShell:

  - Create folder: `New-Item -Force -ItemType Directory local_tools/forge/dist/3.3.7` 
  - Option A (from release):
    - `curl -L -o local_tools/forge/dist/3.3.7/mujoco-3.3.7.js https://github.com/lshdlut/mujoco-wasm-forge/releases/download/forge-3.3.7-r1/mujoco-3.3.7.js`
    - `curl -L -o local_tools/forge/dist/3.3.7/mujoco-3.3.7.wasm https://github.com/lshdlut/mujoco-wasm-forge/releases/download/forge-3.3.7-r1/mujoco-3.3.7.wasm`
  - Option B (from local forge build):
    - In forge repo: `pwsh scripts/stage_local.ps1` then copy `forge/dist/3.3.7/*` here

- Run tests:

  - `npm i`
  - `npm test`

The smoke test looks for the local artifacts and will be skipped if not present.

## P1 XML Init (using MEMFS)

- Example (Node/ESM):

  ```ts
  import { loadForge337 } from './src/wasm/loader.js';
  import { MjSim } from './src/api/sim.js';
  const xml = '<mujoco model="empty"><worldbody/></mujoco>';
  const mod = await loadForge337();
  const sim = new MjSim(mod);
  sim.initFromXml(xml); // writes /model.xml to MEMFS then calls mjw_init('/model.xml')
  sim.step(200);
  console.log('nq=', sim.nq(), 'qpos0=', sim.qpos0Scalar());
  sim.term();
  ```

Notes:
- Forge exports `FS` and `cwrap`, so you can also call `mod.FS.writeFile` + `mod.cwrap(...)` directly.
- The handle-based surface is prefixed `mjwf_` (MuJoCo WASM Forge) and is auto-detected by MjSim. Legacy `mjw_` symbols have been fully removed to avoid conflicts with MJWarp.

## Structure

- `src/wasm/loader.ts`: ESM loader for Forge 3.3.7, with `locateFile` wiring and typed memory helpers.
- `src/api/sim.ts`: Minimal demo wrapper (init/step/term, qpos/qvel views).
- `tests/p0.smoke.test.ts`: Loads module and steps a built-in demo.
- `tests/fixtures/pendulum.xml`: Minimal XML fixture (for P1 tests).

## Roadmap

- P0: Loader + smoke test (done once artifacts present)
- P1: Minimal wrappers for XML-in-memory init, step/reset, typed views + tests
- P2: Add getters for rendering surfaces
- P3: Viewer MVP (three.js)

Policy
- WASM build source: use mujoco-wasm-forge exclusively. Do not introduce or maintain alternative/legacy WASM build scripts or outputs in this repo. All artifacts should come from forge releases or its local build/staging scripts.
