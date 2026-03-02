Internal modules
==========================

This page is an index of important runtime modules and their exported surfaces.
For a mechanically-complete list of exports and declarations across the repo,
including file-scope and nested declarations, see :doc:`code_inventory`.

Core runtime modules
--------------------

``app/main.mjs``
  Main entrypoint. Wires UI/store, spawns the backend, installs clock lanes,
  and drives rendering. Also exposes ``window.__PLAY_HOST__``.

  - Host contract helper: ``app/play_host.mjs``

``backend/backend_core.mjs``
  Backend on the main thread. Exports ``createBackend(...)`` and wraps the Worker
  protocol with a friendlier API used by UI and plugins.

``worker/physics.worker.mjs``
  Worker runtime: resolves forge dist, loads MuJoCo/WASM, validates required
  forge exports, runs stepping, and emits events/snapshots.

  - Internal helpers:
    - ``worker/snapshot_pool.mjs``

``core/viewer_runtime.mjs``
  Shared runtime helpers used in both main and worker:

  - URL parameter parsing: ``consumeViewerParams(...)`` and readers
  - strict/compat/verbose/perf helpers: ``strictCatch``/``perfSample``/etc
  - logging helpers

``ui/state.mjs``
  Viewer store/state/actions and snapshot merge. Exports:

  - ``createViewerStore(...)``: viewer store
  - ``applySpecAction(...)`` / ``applyGesture(...)``: UI → backend commands
  - ``mergeBackendSnapshot(...)``: snapshot → store merge

``ui/control_manager.mjs``
  DOM wiring and control/panel rendering. Exports ``createControlManager(...)``.

  - File/model section helpers: ``ui/file_section.mjs``

``renderer/pipeline.mjs``
  Three.js renderer pipeline and renderer manager. Exports
  ``createRendererManager(...)`` and a few shared camera helpers.

  - Scene-SoA geometry/instancing/material helpers: ``renderer/scene_soa_geoms.mjs``

``renderer/controllers.mjs``
  Input controllers: camera and picking. Exports:

  - ``createCameraController(...)``
  - ``createPickingController(...)``

``environment/environment.mjs``
  Environment/sky management. Exports:

  - ``createEnvironmentManager(...)``
  - ``pushSkyDebug(...)``: developer/debug helper

``bridge/``
  forge/WASM bridge helpers and a small simulator wrapper live under the
  ``bridge/`` directory:

  - heap view helpers: ``heapViewF64``/``heapViewF32``/etc
  - ``collectRenderAssetsFromModule(...)``
  - ``MjSimLite``: minimal helper wrapper

Split runtime modules
---------------------

The repo splits large runtime modules into smaller submodules under
their respective top-level directories. The main entrypoint imports these
submodules directly.

UI internals
  - ``ui/state.mjs``: store/state/actions/snapshot merge
  - ``ui/bindings.mjs``: binding spec parsing + value normalisation helpers
  - ``ui/panel_sections.mjs``: section collapse persistence + DOM helpers
  - ``ui/file_section.mjs``: file/model loading + model picker UI
  - ``ui/control_manager.mjs``: DOM wiring + UI panels

Renderer internals
  - ``renderer/pipeline.mjs``: Three.js renderer pipeline + renderer manager
  - ``renderer/controllers.mjs``: camera + picking controllers
  - ``renderer/overlay3d.mjs``: overlay3d manager: scopes and batches
  - ``renderer/three_helpers.mjs``: shared Three.js helpers: dispose, bounds, scene
  - ``renderer/depth_sort.mjs``: depth/transparency sorting helpers
  - ``renderer/mujoco_shadows.mjs``: MuJoCo shadow-map parity helpers
  - ``renderer/mujoco_constants.mjs``: MuJoCo enums/constants
  - ``renderer/mujoco_textures.mjs``: MuJoCo textures + generated texcoords helpers
  - ``renderer/deformables.mjs``: flex/skin mesh helpers
  - ``renderer/scene_soa_geoms.mjs``: Scene-SoA geoms/instancing/material helpers, extracted from pipeline

Backend internals
  - ``backend/backend_core.mjs``: backend implementation
  - ``backend/snapshot_utils.mjs``: backend snapshot helper functions
  - ``backend/model_candidates.mjs``: builtin model aliases + candidate resolution

Bridge internals
  - ``bridge/heap_views.mjs``: typed heap views and C-string helpers
  - ``bridge/render_assets_collect.mjs``: render-assets extraction from forge module
  - ``bridge/mj_sim_lite.mjs``: ``MjSimLite`` wrapper

Worker internals
  - ``worker/snapshot_pool.mjs``: snapshot pool policy/state

Module dependency direction
--------------------------------------

Play's runtime is intentionally layered. ``tools/check_module_boundaries.mjs``
enforces a coarse dependency DAG. Run via ``node tools/run_checks.mjs``:

- ``base``: shared runtime utilities. ``core/viewer_*.mjs``, ``core/xml_refs.mjs``, ``core/fallbacks.mjs``, ``app/play_host.mjs``
- ``bridge``: low-level forge/WASM helpers. ``bridge/*.mjs``
- ``protocol``: generated worker protocol glue. ``worker/protocol.gen.mjs``, ``worker/dispatch.gen.mjs``
- ``worker``: physics worker. ``worker/physics.worker.mjs``, ``worker/**``
- ``backend``: main-thread backend. ``backend/**``
- ``environment``: presets and sky helpers. ``environment/environment.mjs``
- ``ui``: store and UI. ``ui/**``
- ``renderer``: Three.js renderer and controllers. ``renderer/**``
- ``entry``: application assembly. ``app/main.mjs``

The intent is to keep worker/backend semantics isolated and prevent UI/renderer
from becoming mutually dependent. Renderer no longer imports UI.

Protocol and generated helpers
------------------------------

``tools/worker_protocol.json``
  Command/event IDL for main ↔ worker messages.

``worker/protocol.gen.mjs``
  Generated protocol catalogs and snapshot transfer helpers.

``worker/dispatch.gen.mjs``
  Generated encode/decode/dispatch helpers. Used to validate message shapes and
  reject unknown commands/events.

``spec/ui_spec.json``
  UI spec contract: control ids, fields, bindings.

``core/viewer_state_types.ts``
  TypeScript definition of the viewer store state. This is the complete field list.

``core/viewer_structs.mjs`` / ``core/viewer_shared.mjs`` / ``core/viewer_defaults.mjs``
  Generated/utility helpers for struct layouts, defaults, and shared state
  operations.

Other utilities
---------------

``core/xml_refs.mjs``
  MJCF XML file reference parsing and bundle building. Used by
  ``loadXmlBundle(...)`` style flows.

``tools/dev_server.py``
  Small Python dev server that serves static files and ensures correct MIME
  types for ESM and WASM.
