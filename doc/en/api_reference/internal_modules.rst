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

``dev/physics.worker.mjs``
  Worker runtime: resolves forge dist, loads MuJoCo/WASM, validates required
  forge exports, runs stepping, and emits events/snapshots.

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

``dev/main_renderer.mjs``
  Three.js renderer and controllers. Exports:

  - ``createRendererManager(...)``
  - ``createCameraController(...)``
  - ``createPickingController(...)``

``dev/main_environment.mjs``
  Environment/sky management. Exports:

  - ``createEnvironmentManager(...)``
  - ``pushSkyDebug(...)`` (developer/debug helper)

``dev/bridge.mjs``
  forge/WASM bridge helpers and a small simulator wrapper:

  - heap view helpers (``heapViewF64``/``heapViewF32``/etc)
  - ``collectRenderAssetsFromModule(...)``
  - ``MjSimLite`` (minimal helper wrapper)

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
