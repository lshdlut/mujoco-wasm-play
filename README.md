# mujoco-wasm-play

Glue-layer and playground for consuming MuJoCo WASM artifacts produced by 'mujoco-wasm-forge'.

- Status: scaffolded; TODO: add JS/TS API, zero-copy typed array accessors, and examples.
- Upstream artifacts: see Releases of mujoco-wasm-forge (forge-<ver>-r<rev>).

## Online Demo / Forge Dist

- This repo does not ship forge `dist/` artifacts; it expects a MuJoCo WASM bundle provided by `mujoco-wasm-forge`.
- At runtime, `paths.mjs#getForgeDistBase(ver)` resolves the dist base either as:
  - a local path `/dist/<ver>/` (same origin), or
  - an override from `window.__FORGE_DIST_BASE__` or the `forgeBase` query parameter, both treated as templates where `{ver}` is replaced by the normalized version (for example `3.3.7`).
- A typical remote base template (for jsDelivr + forge tag) looks like:
  - `https://cdn.jsdelivr.net/gh/lshdlut/mujoco-wasm-forge@forge-{ver}-r1/dist/{ver}/`
- When sharing a public demo link (for example from GitHub Pages), include a `forgeBase=` parameter pointing at your forge dist base so the viewer can fetch `mujoco.wasm`, `mujoco.js`, `version.json`, and ABI JSON directly from the forge release.

### Example URLs

- Local dev (serve from `dev/` with `dev_server.py` on port 4173):
  - `http://127.0.0.1:4173/index.html?model=pendulum.xml&mode=worker`
- Public demo (GitHub Pages, stable MuJoCo 3.3.7):
  - `https://lshdlut.github.io/mujoco-wasm-play/dev/index.html?model=pendulum.xml&mode=worker&forgeBase=https://cdn.jsdelivr.net/gh/lshdlut/mujoco-wasm-forge@forge-3.3.7-r1/dist/3.3.7/`
- Optional prerelease demo (MuJoCo 3.3.8-alpha):
  - `https://lshdlut.github.io/mujoco-wasm-play/dev/index.html?model=pendulum.xml&mode=worker&forgeBase=https://cdn.jsdelivr.net/gh/lshdlut/mujoco-wasm-forge@forge-3.3.8-alpha1/dist/3.3.8-alpha/`

For the full upstream surface and version/tag mapping, see `lshdlut/mujoco-wasm-forge/docs/forge_dist_contract.md`.

## HDRI / Environment Maps

- Forge does not currently ship HDRI environment maps; they are not part of the `dist/<ver>/` contract.
- The viewer accepts an `hdri` query parameter pointing at an equirectangular `.hdr` texture, resolved relative to the page origin (for example `hdri=dist/assets/env/autumn_field_puresky_4k.hdr`).
- If `hdri` is omitted, the viewer falls back to a built-in gradient “bright-outdoor” preset and does not require any HDRI files.
- For public demos, host your own HDRI files alongside the static site and pass an explicit `hdri=` URL; do not rely on forge to provide these assets.

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
