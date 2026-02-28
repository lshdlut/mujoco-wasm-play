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

- ``dev/viewer_backend.mjs``: backend façade (stable import path)
  - implementation: ``dev/backend/backend_core.mjs``
- ``dev/viewer_runtime.mjs``: logging, strict/compat/perf helpers, URL param helpers
- ``dev/main_ui.mjs``: UI façade (stable import path)
  - internals: ``dev/ui/state.mjs`` + ``dev/ui/control_manager.mjs``
- ``dev/main_renderer.mjs``: renderer façade (stable import path)
  - internals: ``dev/renderer/pipeline.mjs`` + ``dev/renderer/controllers.mjs``
- ``dev/bridge.mjs``: bridge façade (stable import path)
  - implementation: ``dev/bridge/bridge_core.mjs``
- ``dev/worker/snapshot_pool.mjs``: worker snapshot pool policy/state

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
