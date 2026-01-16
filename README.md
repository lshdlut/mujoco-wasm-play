# mujoco-wasm-play

[**Live Demo (Rajagopal2015, MuJoCo 3.3.7)**](https://lshdlut.github.io/mujoco-wasm-play/dev/index.html?model=raj&mode=worker&forgeBase=https://cdn.jsdelivr.net/gh/lshdlut/mujoco-wasm-forge@forge-3.3.7-r1/dist/3.3.7/)

> Active development: APIs, query parameters, and file layout may change without notice; expect breaking changes between revisions.

Glue-layer and playground for consuming MuJoCo WASM artifacts produced by 'mujoco-wasm-forge'.

- Status: scaffolded; TODO: add JS/TS API, zero-copy typed array accessors, and examples.
- Upstream artifacts: see Releases of mujoco-wasm-forge (forge-<ver>-r<rev>).
- Note: `dev/package.json` scripts reference `../tests/...`, but `tests/` is intentionally local-only (ignored and not tracked). If you do not have a local `tests/` folder, those scripts will fail.

## Online Demo / Forge Dist

- This repo does not ship forge `dist/` artifacts; it expects a MuJoCo WASM bundle provided by `mujoco-wasm-forge`.
- At runtime, `viewer_runtime.mjs#getForgeDistBase(ver)` resolves the dist base either as:
  - a local path `/dist/<ver>/` (same origin), or
  - an override from `window.__FORGE_DIST_BASE__` or the `forgeBase` query parameter. These strings are treated as templates: if they include `{ver}`, it is replaced by the normalized version (for example `3.3.7`).
- A typical remote base template (for jsDelivr + forge tag) looks like:
  - `https://cdn.jsdelivr.net/gh/lshdlut/mujoco-wasm-forge@forge-{ver}-r1/dist/{ver}/`
- When sharing a public demo link (for example from GitHub Pages), include a `forgeBase=` parameter pointing at your forge dist base so the viewer can fetch `mujoco.js`, `mujoco.wasm`, and `version.json` directly from the forge release.

### Example URLs

- Local dev (serve from `dev/` with `dev_server.py` on port 4173):
  - `python dev/dev_server.py --root dev --port 4173`
  - `http://127.0.0.1:4173/index.html?model=raj&mode=worker&forgeBase=https://cdn.jsdelivr.net/gh/lshdlut/mujoco-wasm-forge@forge-3.3.7-r1/dist/3.3.7/`
- Public demo (GitHub Pages, stable MuJoCo 3.3.7, Rajagopal2015 model):
  - `https://lshdlut.github.io/mujoco-wasm-play/dev/index.html?model=raj&mode=worker&forgeBase=https://cdn.jsdelivr.net/gh/lshdlut/mujoco-wasm-forge@forge-3.3.7-r1/dist/3.3.7/`
- Optional prerelease demo (MuJoCo 3.3.8-alpha, Rajagopal2015 model):
  - `https://lshdlut.github.io/mujoco-wasm-play/dev/index.html?model=raj&mode=worker&forgeBase=https://cdn.jsdelivr.net/gh/lshdlut/mujoco-wasm-forge@forge-3.3.8-alpha1/dist/3.3.8-alpha/`

For the full upstream surface and version/tag mapping, see `https://github.com/lshdlut/mujoco-wasm-forge`.

## HDRI / Environment Maps

- Forge does not currently ship HDRI environment maps; they are not part of the `dist/<ver>/` contract.
- HDRI is controlled by the UI "visual source" presets (`preset-sun` / `preset-moon`). Default mode is `model` (MuJoCo-driven skybox/lights) and does not require any HDRI files.
- Preset HDRIs are served as static assets alongside the page (for example `dev/rustig_koppie_puresky_4k.hdr`, `dev/starmap_random_2020_4k_rot.exr`).

## Built-in Models

- `model=` accepts either a `.xml` path under `dev/` or one of: `raj`, `humanoid`, `humanoid100`, `cards`, `sensor`.

## TODO
- Define stable JS/TS API surface
- Add TypeScript types / d.ts
- Implement XML-in-memory loader (no FS)
- Add zero-copy HEAP views (qpos/qvel/...)
- Multi-instance handles (no globals)
