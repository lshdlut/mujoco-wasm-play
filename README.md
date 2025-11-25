# mujoco-wasm-play

Glue-layer and playground for consuming MuJoCo WASM artifacts produced by 'mujoco-wasm-forge'.

- Status: scaffolded; TODO: add JS/TS API, zero-copy typed array accessors, and examples.
- Upstream artifacts: see Releases of mujoco-wasm-forge (forge-<ver>-r<rev>).

## Legacy UI Notice

- Runtime backend is worker-only (`physics.worker.mjs` plus `bridge.mjs` helpers); there is no standalone legacy UI under `local_tools/viewer_demo/`.
- Use the Simulate-like UI at `index.html` for every workflow (worker backend).
- The debug script `scripts/worker_debug.py` now launches the main entry (`/index.html`).
- Shared utilities such as `snapshots.mjs` are common to both backends and do not represent a separate UI surface.

## TODO
- Define stable JS/TS API surface
- Add TypeScript types / d.ts
- Implement XML-in-memory loader (no FS)
- Add zero-copy HEAP views (qpos/qvel/...)
- Multi-instance handles (no globals)
