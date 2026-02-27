Runtime lifecycle (end-to-end)
==============================

This page ties Play's runtime "processes" to concrete code locations. It is
intended to reduce hand-wavy architecture discussions by pointing at the
functions/modules that implement each step.

Entry points
------------

Main thread:

- ``dev/index.html``: static HTML shell + import map + mount elements.
- ``dev/main.nobuild.mjs``: main entrypoint (UI wiring + renderer + backend +
  plugin host exposure).

Worker:

- ``dev/physics.worker.mjs``: module Worker entrypoint (forge/WASM load + MuJoCo
  stepping + snapshots).

Backend façade:

- ``dev/viewer_backend.mjs``: exports ``createBackend(...)`` which spawns the
  Worker and provides a higher-level API to the UI/plugins.

Boot sequence
-------------

1. **HTML loads** ``dev/main.nobuild.mjs`` (ESM).
2. **URL/global config is consumed**:

   - URL helpers live in ``dev/viewer_runtime.mjs`` (``consumeViewerParams(...)``,
     ``buildWorkerUrl(...)``, strict/verbose toggles, etc).
3. **Backend is created**:

   - ``dev/main.nobuild.mjs`` calls ``createBackend(...)`` from
     ``dev/viewer_backend.mjs``.
   - The backend spawns ``dev/physics.worker.mjs`` as a **module Worker** and
     begins the command/event handshake.
4. **Forge dist is resolved and loaded in the Worker**:

   - The Worker resolves a forge ``dist/<ver>/`` base (from ``forgeBase=...`` or
     local fallbacks).
   - It dynamically imports ``mujoco.js`` and loads ``mujoco.wasm``.
5. **Ready**:

   - The Worker emits ``ready``.
   - The main thread finishes UI wiring and starts the render loop.

Command/event transport
-----------------------

The main thread and the Worker communicate via ``postMessage``:

- Commands: main → worker, shaped like ``{ cmd: string, ...payload }``.
- Events: worker → main, shaped like ``{ kind: string, ...payload }``.

Protocol source of truth:

- ``tools/worker_protocol.json`` (IDL).
- Generated runtime helpers:

  - ``dev/protocol.gen.mjs`` (lists + field specs + transfer fields)
  - ``dev/dispatch.gen.mjs`` (encode/decode/dispatch)

See :doc:`/api_reference/worker_messages`.

Snapshot pipeline (Worker → Main)
---------------------------------

High-frequency state is delivered via the ``snapshot`` event.

Worker side:

- Runs stepping internally (MuJoCo/WASM).
- Emits ``snapshot`` events that often contain TypedArray views and uses
  transfer lists to avoid copies.

Main thread side:

- Receives snapshots via the backend subscription API.
- Merges snapshot fields into the viewer store:

  - ``mergeBackendSnapshot(...)`` is implemented/exported by ``dev/main_ui.mjs``.
  - ``dev/main.nobuild.mjs`` also keeps a ``latestSnapshot`` for quick access
    (and exposes it as ``window.__lastSnapshot`` for debugging).

UI ticks and "lanes"
--------------------

Play intentionally decouples:

- Worker stepping
- snapshot delivery (adaptive, worker-driven)
- UI updates (throttled lanes for DOM work)

The main entrypoint installs a small clock/subscription system that provides:

- ``onSnapshot``: snapshot-aligned work (state derivation)
- ``onFrame``: render-frame barrier (overlay commits / per-frame animation)
- ``onUiTick`` / ``onUiMainTick``: normal DOM updates (default ~30Hz)
- ``onUiControlsTick``: slower lane for expensive control syncing
- ``onUiSlowTick``: slow lane for heavy cards/tables

These hooks are exposed to plugins via the Host API (see :doc:`/reference/plugin_contract`).

Rendering pipeline
------------------

Rendering runs on the main thread and is driven by snapshots + viewer state.

Key modules:

- ``dev/main_renderer.mjs`` exports:

  - ``createRendererManager(...)`` (scene + render loop)
  - ``createCameraController(...)`` (camera interaction and sync)
  - ``createPickingController(...)`` (picking/selection)
- ``dev/main_environment.mjs`` exports ``createEnvironmentManager(...)`` for sky
  / environment handling.

The renderer:

- Consumes snapshots (poses, scene SoA fields, render assets, etc).
- Updates Three.js scene objects and materials.
- Flushes overlay3d commits at the render-frame barrier to keep overlays in sync
  with the MuJoCo scene.

Model loading (end-user vs developer)
-------------------------------------

End-user:

- Use ``model=...`` to select a builtin alias or a path under ``dev/``.

Developer:

- Use ``host.backend.loadXmlText(...)`` for raw XML strings.
- Use ``host.backend.loadXmlBundle(...)`` to provide XML + referenced assets as
  explicit files.

Related utilities:

- ``dev/xml_refs.mjs`` contains helpers for parsing MJCF file references and
  building virtual bundles.
- ``dev/bridge.mjs`` contains forge/WASM FS helpers and a small ``MjSimLite``
  wrapper for interacting with the module heap.

Plugin lifecycle (main thread)
------------------------------

Plugins are dynamically imported ESM modules and are expected to export
``registerPlayPlugin(host)`` (or a default export).

Loading sources:

- URL query parameter: ``plugins=...``
- Global: ``globalThis.PLAY_PLUGINS = [...]`` (must be set before the main
  module runs)

See :doc:`/reference/plugin_contract` for mounts, UI injection, overlay3d, and
Worker boundary constraints.

Strict mode and diagnostics
---------------------------

Strict/verbose/perf helpers live in ``dev/viewer_runtime.mjs``:

- ``strictCatch(...)`` / ``strictEnsure(...)`` / ``strictOverride(...)``
- ``perfMark(...)`` / ``perfSample(...)`` / ``perfSummary()``
- logging helpers (``logStatus``, ``logWarn``, ``logError``)

For developer-facing debug globals, see :doc:`/reference/configuration`.
