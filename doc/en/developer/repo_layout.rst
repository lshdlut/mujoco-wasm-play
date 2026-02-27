Repo layout
===========

Top-level directories
---------------------

- ``dev/``: the static web app (HTML + ESM modules + assets + vendored forge dist)
- ``tools/``: generators and small CI/maintenance scripts
- ``tests/``: Playwright end-to-end tests and tooling
- ``local_tools/``: local-only utilities/artifacts (gitignored)

Key runtime entrypoints
-----------------------

- ``dev/index.html``: static page + import map
- ``dev/main.nobuild.mjs``: main entrypoint (UI + renderer + Worker backend + Host API)
- ``dev/physics.worker.mjs``: Worker entrypoint (loads forge + runs MuJoCo)

Key runtime modules
-------------------

- ``dev/viewer_backend.mjs``: backend façade (spawns Worker, translates UI/gesture actions into commands)
- ``dev/viewer_runtime.mjs``: logging, strict/compat/perf helpers, URL param helpers
- ``dev/main_ui.mjs``: UI spec wiring, store, control manager, section behavior
- ``dev/main_renderer.mjs``: Three.js renderer manager and overlay3d system
- ``dev/bridge.mjs``: forge/WASM bridge helpers (FS writes, typed views, assets)

Generated artifacts (committed)
-------------------------------

Generated files are committed for the static runtime and GitHub Pages.

- Worker protocol:
  - Source: ``tools/worker_protocol.json``
  - Generator: ``tools/generate_worker_protocol.mjs``
  - Outputs: ``dev/protocol.gen.mjs``, ``dev/dispatch.gen.mjs``

- UI artifacts / types:
  - Source: ``dev/spec/ui_spec.json`` (+ schema/index)
  - Generator: ``tools/generate_ui_artifacts.mjs``
  - Outputs (examples): ``dev/viewer_structs.mjs``, ``dev/viewer_state_types.ts``

Forge dist bundles
------------------

This repo may vendor one or more forge bundles under ``dev/dist/<ver>/`` for
local/demo convenience, but the build pipeline for these artifacts lives in the
forge repo (``mujoco-wasm-forge``).

