# Play Runtime Architecture

Audit baseline: `2689375ae374f4cd96f1c4767e9b5d38cabd9d6d` (`docs: document embed theme and font URL parameters`)

This document is the runtime entrypoint for future agents. It describes the
current Play system at architecture granularity, not API-inventory granularity.
It intentionally focuses on owners, lifecycle, state boundaries, and allowed
side effects.

## Runtime scope

Included runtime areas:

- `app/`
- `backend/`
- `bridge/`
- `core/`
- `environment/`
- `renderer/`
- `ui/`
- `worker/`

Excluded from runtime scope:

- `tests/`
- `tools/`
- `doc/`
- `assets/`, `model/`, `plugins/` data payloads
- local-only directories such as `node_modules/`, `dist/`, `local_tools/`, `test-results/`

## System layers

The current coarse import DAG enforced by `tools/check_module_boundaries.mjs`
is:

- `base`: shared runtime helpers under `core/`
- `bridge`: forge/WASM heap helpers
- `protocol`: generated worker protocol glue
- `worker`: physics worker runtime
- `backend`: main-thread worker proxy
- `environment`: sky/environment helpers
- `ui`: store and DOM control layer
- `renderer`: Three.js rendering layer
- `entry`: application assembly under `app/`

This DAG is useful but intentionally coarse. It does not prove ownership
correctness, input single-sourcing, or same-layer cohesion.

## Lifecycle

### 1. Boot and runtime input collection

Entry HTML:

- `index.html`
- `pthreads/index.html`

Bootstrap:

- `app/entry_bootstrap.js`
- `app/viewer_shell.js`
- `app/viewer_shell.css`

Responsibilities:

- Reads all startup runtime inputs from URL parameters and pre-module globals
- Derives the entry variant (`single` vs `pthreads`)
- Resolves the effective runtime config buffer
- Applies pre-paint shell state for `embed`, `theme`, and `font`
- Mounts the shared viewer shell and injects the main module after shell setup
- Writes `globalThis.__PLAY_RUNTIME_CONFIG__`

Ownership:

- Runtime input owner: `app/entry_bootstrap.js`
- Runtime config buffer owner: `core/runtime_config.mjs`

Rule:

- No runtime module other than bootstrap may treat URL params or `PLAY_*` /
  `__*` globals as a primary input source.
- Entry HTML pages should stay thin. Shared shell DOM/CSS assets must live in one
  place, not in duplicated inline HTML blocks.

### 2. Main-thread assembly

Main entrypoint:

- `app/main.mjs`

Responsibilities:

- Builds the backend, viewer store, renderer manager, environment manager, and
  control manager
- Wires clock lanes (`onSnapshot`, `onFrame`, `onUiTick`, `onUiControlsTick`,
  `onUiSlowTick`)
- Delegates UI tick scheduling, overlay updates, panel layout updates, and
  toast/info overlay refresh to `app/ui_runtime.mjs`
- Delegates right-panel snapshot-driven controls to
  `app/right_panel_runtime.mjs`, which now reads section expansion from the
  store-backed panel state instead of DOM visibility
- Exposes the public/debug host surfaces
- Drives model load and plugin boot

Ownership:

- Assembly owner: `app/main.mjs`
- UI runtime owner: `app/ui_runtime.mjs`
- Right-panel runtime owner: `app/right_panel_runtime.mjs`
- Public host owner: `app/play_host.mjs` via `window.__PLAY_HOST__`

Current caveat:

- `app/main.mjs` is much narrower than before, but it still owns top-level
  plugin boot, host wiring, and some debug/global registration.

### 3. Backend transport and restart orchestration

Backend:

- `backend/backend_core.mjs`
- `backend/backend_runtime.mjs`

Responsibilities:

- Spawns `worker/physics.worker.mjs`
- Builds the worker URL from normalized runtime config
- Encodes main → worker commands and decodes worker → main events
- Owns the latest main-thread snapshot cache
- Owns worker restart and XML reload orchestration
- Delegates UI-facing command adaptation to `backend/backend_runtime.mjs`
- Adapts snapshot delivery rate and exposes high-level backend methods to UI and
  plugins

Ownership:

- Worker client owner: `backend/backend_core.mjs`
- Main-thread latest snapshot owner: `backend/backend_core.mjs`

Rule:

- The worker receives normalized startup inputs only through the worker URL.

### 4. Worker runtime

Worker:

- `worker/physics.worker.mjs`

Responsibilities:

- Resolves forge dist, loads `mujoco.js` / `mujoco.wasm`, validates ABI
- Creates and owns the MuJoCo/forge runtime handle
- Runs stepping, perturbation, alignment, selection, and snapshot emission
- Posts metadata and high-frequency snapshot events back to the main thread

Ownership:

- MuJoCo runtime owner: `worker/physics.worker.mjs`
- Simulation state owner: `worker/physics.worker.mjs` + `bridge/mj_sim_lite.mjs`

Current caveat:

- The worker file remains a single large control plane containing load/init,
  stepping, snapshot packing, and many command handlers.

### 5. Viewer state and UI

State:

- `ui/state.mjs`
- `ui/panel_state.mjs`
- `ui/viewer_actions.mjs`

DOM control layer:

- `ui/control_manager.mjs`
- `ui/control_widgets.mjs`
- `ui/file_section.mjs`
- `ui/panel_sections.mjs`
- `ui/bindings.mjs`

Responsibilities:

- Defines the viewer store and state transitions
- Owns panel visibility, section collapsed state defaults, app-scoped
  persistence, and section-state initialization in `ui/panel_state.mjs`
- Owns control-driven viewer actions and visual-source switching in
  `ui/viewer_actions.mjs`
- Keeps `ui/control_manager.mjs` as the top-level panel/control orchestrator
- Keeps `ui/control_widgets.mjs` as the coarse widget-rendering and local
  widget-behavior module
- Keeps right-panel dynamic section invalidation driven by store-backed panel
  state, not DOM visibility queries
- Keeps widget-local helper ownership inside `ui/control_widgets.mjs`; the
  factory boundary is intentionally capped to a small injected surface and must
  not grow back into a helper-threading sink
- Owns UI/shell state only; backend snapshot data is read through snapshot
  selectors instead of being mirrored into the store
- Owns shell-local labels such as `shell.modelLabel` for currently selected
  model identity in the UI
- Applies spec-driven control actions and gestures
- Derives the runtime-aware reset baseline for model switches and reloads
- Syncs sticky runtime-facing UI choices back into the runtime config buffer
- Renders DOM panels and control widgets

Ownership:

- Viewer state owner: `ui/state.mjs`
- Panel/section UI state owner: `ui/panel_state.mjs`
- Viewer action owner: `ui/viewer_actions.mjs`
- Sticky UI-facing runtime config sync owner: `ui/state.mjs`

Rules:

- Model switches and XML reloads reset viewer state to a runtime-derived
  baseline, not raw defaults
- Store-backed consumers must only read UI/shell state
- Snapshot-backed consumers must read backend snapshot selectors directly and
  must not reintroduce state/snapshot fallbacks

### 6. Renderer and environment

Renderer:

- `renderer/pipeline.mjs`
- `renderer/controllers.mjs`
- `renderer/scene_soa_geoms.mjs`
- `renderer/overlay3d.mjs`

Environment:

- `environment/environment.mjs`

Responsibilities:

- Consumes backend snapshots plus viewer UI state
- Owns Three.js scene application and frame orchestration
- Owns camera interaction and picking
- Owns environment/sky and renderer-visible debug hooks
- Owns the world-space occlusion contract for packed scene geoms, infinite
  ground, and overlay3d world layers

Ownership:

- Three scene owner: `renderer/pipeline.mjs`
- Environment owner: `environment/environment.mjs`

Current caveat:

- `renderer/pipeline.mjs` still contains more than orchestration. A substantial
  amount of scene/resource policy remains inside the top-level pipeline.
- Labels are a separate screen-space text pass. MuJoCo still owns label
  semantics and 3D anchors; Play only projects anchors and renders Web text
  after the world pass, outside the world-space occlusion contract.

### 7. Plugins and public surface

Public contract:

- `app/play_host.mjs`
- `window.__PLAY_HOST__`

Responsibilities:

- Exposes capability-gated mounts for UI, store, backend, controls, renderer,
  clock, and overlay integration
- Provides a stable extension point for runtime plugins

Rule:

- Plugins should go through the host contract and backend/snapshot streams.
  They should not depend on internal globals or direct forge/WASM access in
  worker mode.

## State ownership matrix

| State / Buffer | Owner | Reset behavior |
| --- | --- | --- |
| Runtime config buffer (`__PLAY_RUNTIME_CONFIG__`) | `app/entry_bootstrap.js` + `core/runtime_config.mjs` | Persists for the page lifetime |
| Latest backend snapshot | `backend/backend_core.mjs` | Reinitialized on worker restart, then refilled from worker |
| Viewer store state (UI/shell only) | `ui/state.mjs` | Rebuilt from runtime-derived baseline on model switch / reload |
| Panel visibility + section collapsed state | `ui/panel_state.mjs` + `ui/state.mjs` | Rebuilt from app profile defaults, then overridden by app-scoped persisted UI state |
| DOM shell state (`theme`, `font`, `embed`, layout classes) | bootstrap + `core/runtime_config.mjs` + `app/main.mjs` + `ui/control_manager.mjs` | Reapplied from runtime config / store |
| MuJoCo sim state | `worker/physics.worker.mjs` | Recreated on worker restart / reload |

## Bridge pointer ownership

Bridge-side forge pointers are split into two classes:

- `stable ptr`: safe to cache per handle via `_cachedPtr()`
- `volatile ptr`: must be re-read on every access via `_directPtr()`

Current volatile family:

- packed scene exports (`_mjwf_scene_geomorder_ptr`, `_mjwf_scene_geoms_*_ptr`)

Rule:

- If an accessor reads from packed scene SoA data or any forge export whose
  address may change without a handle restart, it must be treated as volatile.
- `_cachedPtr()` must reject volatile exports loudly instead of silently
  caching them.

## Runtime inputs vs outputs

### Inputs

Accepted runtime inputs are currently expected to enter through:

- URL parameters read by `app/entry_bootstrap.js`
- Pre-module globals such as `PLAY_VER`, `PLAY_PLUGINS`, `PLAY_STRICT`,
  `PLAY_COMPAT`, `PLAY_VERBOSE_DEBUG`, `PLAY_SNAPSHOT_DEBUG`,
  `PLAY_DISABLE_INSTANCING`, `PLAY_TRANSPARENT_BINS`,
  `PLAY_TRANSPARENT_SORT_MODE`, and `__FORGE_DIST_BASE__`
- Entry variant defaults derived from the HTML shell

### Outputs / debug hooks

These are output/debug surfaces, not configuration inputs:

- `window.__PLAY_HOST__`
- `window.__viewerStore`
- `window.__viewerControls`
- `window.__viewerRenderer`
- `window.__lastSnapshot`

Formal runtime/test physical snapshot entry:

- `window.__PLAY_HOST__.getSnapshot()`

## Snapshot-centric owner contract

Main-thread ownership is intentionally split into three authorities:

- `backend snapshot`: the only physical/model truth on the main thread
- `viewer store`: UI/shell state only
- `runtime config`: sticky runtime preferences only

Consumer rules:

- renderer, overlays, dynamic control panels, and plugin clocks must consume the
  published backend snapshot
- shell/layout/theme/font/panel state must consume the viewer store
- section collapse defaults and persistence must enter through `ui/panel_state.mjs`,
  not direct `localStorage` reads in control rendering
- app-specific panel behavior must be expressed through generic UI profile
  inputs (`profileId`, `storageNamespace`, built-in default policy, section
  overrides), not hard-coded downstream names inside Play
- sticky preferences must be restored from runtime config, not from store-backed
  backend mirrors

Explicit non-goals:

- The store is not a backend snapshot cache
- `window.__lastSnapshot` is not a formal owner
- tests and diagnostics should use `__PLAY_HOST__.getSnapshot()` as the formal
  main-thread physical snapshot entry and treat `window.__lastSnapshot` as
  debug-only
- `app/main.mjs` must not maintain a second snapshot alias
- `ui/control_manager.mjs` must not re-own widget renderer bodies
- `ui/control_widgets.mjs` must stay self-contained enough to avoid
  helper-by-helper injection drift
- `backend/backend_core.mjs` must not re-own UI/binding command adapters

## Allowed side-effect surfaces

Direct DOM writes are currently allowed in:

- `app/entry_bootstrap.js` for pre-paint shell state
- `app/viewer_shell.js` for shared shell mount / pthreads COI failure shell
- `core/runtime_config.mjs` for runtime UI replay
- `app/main.mjs` for layout shell / overlays / debug hookups
- `ui/control_manager.mjs` for control-driven shell updates
- `ui/panel_sections.mjs` for section collapse DOM state

Direct global writes are currently allowed in:

- `app/entry_bootstrap.js` for `__PLAY_RUNTIME_CONFIG__`
- `app/main.mjs` for public and debug host globals
- `renderer/pipeline.mjs` and `environment/environment.mjs` for renderer/env
  debug helpers
- `core/viewer_runtime.mjs` for perf/strict debug helpers
- `bridge/mj_sim_lite.mjs` for forge module debug exposure

Direct worker `postMessage` writes are currently allowed in:

- `backend/backend_core.mjs` (main → worker)
- `worker/physics.worker.mjs` (worker → main)
- `core/viewer_runtime.mjs` only for worker log forwarding

## Architectural invariants for future changes

- Add new runtime inputs in bootstrap only, then consume the normalized runtime
  config everywhere else.
- Treat worker URL fields as the only startup contract between main and worker.
- Keep viewer-state reset semantics explicit and derived from runtime config.
- Keep public integrations on `window.__PLAY_HOST__`, not on ad hoc globals.
- Do not expand direct DOM/global side effects to new modules unless ownership is
  documented here and justified by startup or debug needs.
