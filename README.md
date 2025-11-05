# mujoco-wasm-play

Glue-layer and playground for consuming MuJoCo WASM artifacts produced by 'mujoco-wasm-forge'.

- Status: scaffolded; TODO: add JS/TS API, zero-copy typed array accessors, and examples.
- Upstream artifacts: see Releases of mujoco-wasm-forge (forge-<ver>-r<rev>).

## Legacy UI Notice

- The old demo UI under `local_tools/viewer_demo/` is deprecated and not used for development or debugging.
- It is kept only as historical reference while the Simulate-like UI at `index.html` evolves.
- The debug script `scripts/worker_debug.py` now launches the main entry (`/index.html`).
- Small utilities such as `local_tools/viewer_demo/snapshots.mjs` may remain referenced temporarily; they are not part of the legacy UI surface.

## TODO
- Define stable JS/TS API surface
- Add TypeScript types / d.ts
- Implement XML-in-memory loader (no FS)
- Add zero-copy HEAP views (qpos/qvel/...)
- Multi-instance handles (no globals)
