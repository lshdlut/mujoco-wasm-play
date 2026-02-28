Internal modules (by file)
==========================

This page is an index of important runtime modules and their exported surfaces.
For a mechanically-complete list of exports and declarations (file-scope +
nested) across the repo, see :doc:`code_inventory`.

Core runtime modules (dev/)
---------------------------

``dev/main.nobuild.mjs``
  Main entrypoint. Wires UI/store, spawns the backend, installs clock lanes,
  and drives rendering. Also exposes ``window.__PLAY_HOST__``.

``dev/viewer_backend.mjs``
  Backend façade. Exports ``createBackend(...)`` and wraps the Worker protocol
  with a friendlier API used by UI and plugins.

  - Implementation: ``dev/backend/backend_core.mjs``

``dev/physics.worker.mjs``
  Worker runtime: resolves forge dist, loads MuJoCo/WASM, validates required
  forge exports, runs stepping, and emits events/snapshots.

  - Internal helpers: ``dev/worker/snapshot_pool.mjs``

``dev/viewer_runtime.mjs``
  Shared runtime helpers used in both main and worker:

  - URL parameter parsing (``consumeViewerParams(...)`` and readers)
  - strict/compat/verbose/perf helpers (``strictCatch``/``perfSample``/etc)
  - logging helpers

``dev/main_ui.mjs``
  UI and state wiring. Exports:

  - ``createViewerStore(...)`` (viewer store)
  - ``createControlManager(...)`` (UI spec bindings)
  - ``applySpecAction(...)`` / ``applyGesture(...)`` (UI → backend commands)
  - ``mergeBackendSnapshot(...)`` (snapshot → store merge)

  This is a façade entrypoint kept stable for imports. Internals live under
  ``dev/ui/``.

``dev/main_renderer.mjs``
  Three.js renderer and controllers. Exports:

  - ``createRendererManager(...)``
  - ``createCameraController(...)``
  - ``createPickingController(...)``

  This is a façade entrypoint kept stable for imports. Internals live under
  ``dev/renderer/``.

``dev/main_environment.mjs``
  Environment/sky management. Exports:

  - ``createEnvironmentManager(...)``
  - ``pushSkyDebug(...)`` (developer/debug helper)

``dev/bridge.mjs``
  forge/WASM bridge helpers and a small simulator wrapper:

  - heap view helpers (``heapViewF64``/``heapViewF32``/etc)
  - ``collectRenderAssetsFromModule(...)``
  - ``MjSimLite`` (minimal helper wrapper)

  - Implementation: ``dev/bridge/bridge_core.mjs``

Split runtime modules (dev submodules)
--------------------------------------

The repo keeps stable façade entrypoints in ``dev/*.mjs`` while splitting large
modules into smaller submodules under ``dev/**``.

UI internals
  - ``dev/ui/ui_core.mjs``: aggregator
  - ``dev/ui/state.mjs``: store/state/actions/snapshot merge
  - ``dev/ui/control_manager.mjs``: DOM wiring + UI panels

Renderer internals
  - ``dev/renderer/renderer_core.mjs``: aggregator
  - ``dev/renderer/pipeline.mjs``: Three.js renderer pipeline + renderer manager
  - ``dev/renderer/controllers.mjs``: camera + picking controllers

Backend internals
  - ``dev/backend/backend_core.mjs``: backend implementation

Bridge internals
  - ``dev/bridge/bridge_core.mjs``: forge/WASM bridge implementation

Worker internals
  - ``dev/worker/snapshot_pool.mjs``: snapshot pool policy/state

Module dependency direction (enforced)
--------------------------------------

Play's runtime is intentionally layered. ``tools/check_module_boundaries.mjs``
(run via ``node tools/run_checks.mjs``) enforces a coarse dependency DAG:

- ``base``: shared runtime utilities (``dev/viewer_*.mjs``, ``dev/xml_refs.mjs``,
  ``dev/fallbacks.mjs``)
- ``bridge``: low-level forge/WASM helpers (``dev/bridge*.mjs``)
- ``protocol``: generated worker protocol glue (``dev/protocol.gen.mjs``,
  ``dev/dispatch.gen.mjs``)
- ``worker``: physics worker (``dev/physics.worker.mjs``, ``dev/worker/**``)
- ``backend``: main-thread backend wrapper (``dev/viewer_backend.mjs``,
  ``dev/backend/**``)
- ``environment``: presets + sky helpers (``dev/main_environment.mjs``)
- ``ui``: store + UI (``dev/main_ui.mjs``, ``dev/ui/**``)
- ``renderer``: Three.js renderer + controllers (``dev/main_renderer.mjs``,
  ``dev/renderer/**``)
- ``entry``: application assembly (``dev/main.nobuild.mjs``)

The intent is to keep worker/backend semantics isolated and prevent UI/renderer
from becoming mutually dependent (renderer no longer imports UI).

Protocol and generated helpers
------------------------------

``tools/worker_protocol.json``
  Command/event IDL for main ↔ worker messages.

``dev/protocol.gen.mjs``
  Generated protocol catalogs and snapshot transfer helpers.

``dev/dispatch.gen.mjs``
  Generated encode/decode/dispatch helpers. Used to validate message shapes and
  reject unknown commands/events.

``dev/spec/ui_spec.json``
  UI spec contract (control ids, fields, bindings).

``dev/viewer_state_types.ts``
  TypeScript definition of the viewer store state (a complete field list).

``dev/viewer_structs.mjs`` / ``dev/viewer_shared.mjs`` / ``dev/viewer_defaults.mjs``
  Generated/utility helpers for struct layouts, defaults, and shared state
  operations.

Other utilities
---------------

``dev/xml_refs.mjs``
  MJCF XML file reference parsing and bundle building (used by
  ``loadXmlBundle(...)`` style flows).

``dev/dev_server.py``
  Small Python dev server that serves static files and ensures correct MIME
  types for ESM and WASM.
