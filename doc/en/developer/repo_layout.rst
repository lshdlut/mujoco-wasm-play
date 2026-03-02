Repo layout
===========

Top-level directories
---------------------

- ``app/``: main-thread entrypoint + Host contract wiring
- ``backend/``: Worker backend wrapper (spawns the Worker, exposes a UI/plugin-friendly surface)
- ``bridge/``: forge/WASM bridge helpers (heap views, ``MjSimLite``)
- ``core/``: shared runtime defaults/types/URL param helpers/logging helpers
- ``environment/``: sky/environment manager
- ``renderer/``: renderer pipeline + controllers + overlays
- ``ui/``: UI store/state/actions + control manager + panels/sections
- ``worker/``: module Worker entrypoint + generated protocol/dispatch
- ``assets/``: static assets (e.g., HDRIs)
- ``model/``: built-in demo models
- ``plugins/``: built-in demo plugins
- ``tools/``: generators and small CI/maintenance scripts
- ``tests/``: tests and tooling (unit: ``tests/unit/``, Playwright: ``tests/e2e/``)
- ``local_tools/``: local-only utilities/artifacts (gitignored)

Key runtime entrypoints
-----------------------

- ``index.html``: static page + import map
- ``app/main.mjs``: main entrypoint (UI + renderer + Worker backend + Host API)
- ``worker/physics.worker.mjs``: Worker entrypoint (loads forge + runs MuJoCo)

Key runtime modules
-------------------

- ``backend/backend_core.mjs``: backend (``createBackend(...)``; wraps the Worker protocol)
- ``core/viewer_runtime.mjs``: logging, strict/compat/perf helpers, URL param helpers
- ``ui/state.mjs``: viewer store/state/actions + snapshot merge
- ``ui/control_manager.mjs``: DOM wiring + UI panels/controls
- ``renderer/pipeline.mjs``: renderer pipeline + ``createRendererManager(...)``
- ``renderer/controllers.mjs``: camera + picking controllers
- ``environment/environment.mjs``: sky/environment presets + runtime manager
- ``bridge/heap_views.mjs`` / ``bridge/mj_sim_lite.mjs``: forge/WASM bridge helpers
- ``worker/snapshot_pool.mjs``: worker snapshot pool policy/state

Generated artifacts
-------------------------------

Generated files are committed for the static runtime and GitHub Pages.

- Worker protocol:
  - Source: ``tools/worker_protocol.json``
  - Generator: ``tools/generate_worker_protocol.mjs``
  - Outputs: ``worker/protocol.gen.mjs``, ``worker/dispatch.gen.mjs``

- UI artifacts / types:
  - Source: ``spec/ui_spec.json`` (+ schema/index)
  - Generator: ``tools/generate_ui_artifacts.mjs``
  - Outputs (examples): ``core/viewer_structs.mjs``, ``core/viewer_state_types.ts``

Forge dist bundles
------------------

This repo may vendor one or more forge bundles under ``dist/<ver>/`` for
local/demo convenience, but the build pipeline for these artifacts lives in the
forge repo (``mujoco-wasm-forge``).
