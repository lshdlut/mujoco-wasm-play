# Play Runtime Audit

Audit baseline: `2689375ae374f4cd96f1c4767e9b5d38cabd9d6d` (`docs: document embed theme and font URL parameters`)

This document is the first-pass architecture audit for future agents. It is
deliberately scoped to runtime behavior and system organization, not to
function-level cleanup.

## Repo snapshot

- Approximate code volume under runtime + tests + tools: `35905` lines
- Runtime-heavy areas:
  - `renderer/`: `9427`
  - `ui/`: `5089`
  - `worker/`: `3790`
  - `core/`: `2607`
  - `bridge/`: `2238`
  - `backend/`: `2132`
  - `app/`: `2074`
- Largest runtime files:
  - `renderer/pipeline.mjs`
  - `worker/physics.worker.mjs`
  - `ui/control_manager.mjs`
  - `renderer/scene_soa_geoms.mjs`
  - `app/main.mjs`
  - `backend/backend_core.mjs`
  - `ui/state.mjs`

Interpretation:

- Play is no longer a lightweight demo shell. It is a medium-sized browser
  application with a real backend/worker/runtime split.
- The dominant risk is not raw LOC. The dominant risk is ownership drift and
  weak guardrails across a growing set of large modules.

## Lifecycle verdicts

### Boot & Config

Verdict: `Keep as-is`

Current shape:

- `app/entry_bootstrap.js` collects startup inputs and builds
  `__PLAY_RUNTIME_CONFIG__`
- `core/runtime_config.mjs` owns the sticky runtime config buffer and DOM replay
- `core/viewer_runtime.mjs` has been reduced to runtime helpers
  (logging/perf/strict/cache-bust/worker URL helpers)

What is good:

- Runtime input collection is now explicit and centralized at startup
- Sticky UI-facing runtime settings survive model switches and reloads
- Runtime modules no longer consume `consumeViewerParams()` or a startup
  `params` mirror

Current deviation from the ideal:

- A small pre-paint duplication remains for font presets across bootstrap and
  runtime config
- Some debug-oriented globals are still accepted as bootstrap inputs
- The shared HTML shell used to be duplicated between `index.html` and
  `pthreads/index.html`; this should stay centralized in one shared shell mount
  instead of drifting back into inline page copies

Evidence:

- `app/entry_bootstrap.js`
- `core/runtime_config.mjs`
- `core/viewer_runtime.mjs`

Recommended next action:

- Keep the bootstrap-only preset duplication unless a zero-cost pre-paint
  alternative appears
- Keep bootstrap as the only input ingress and resist reintroducing direct URL /
  global reads elsewhere

### Assembly & Main Thread

Verdict: `Consolidate`

Current shape:

- `app/main.mjs` assembles the application
- `app/ui_runtime.mjs` now owns UI tick scheduling, overlays, toast/info, and
  panel layout updates
- `app/right_panel_runtime.mjs` now owns snapshot-driven right-panel controls

What is good:

- There is one obvious application entrypoint
- The worker/backend split stays visible from the top level
- `app/main.mjs` is now materially smaller and closer to a real assembler

Current deviation from the ideal:

- `app/main.mjs` still owns plugin boot, host wiring, and a noticeable amount of
  top-level orchestration/debug hookup
- The new coarse runtime modules are correct in shape, but they still depend on
  `app/main.mjs` for lifecycle ownership

Evidence:

- `app/main.mjs`
- `app/ui_runtime.mjs`
- `app/right_panel_runtime.mjs`

Recommended next action:

- Keep the current coarse split
- Only split further if a full lifecycle owner can move with the code, not just
  a few helpers

### Backend & Worker

Verdict: `Consolidate`

Current shape:

- `backend/backend_core.mjs` owns worker spawn, transport, restart, snapshot
  cache, binding routing, and adaptive snapshot scheduling
- `backend/backend_runtime.mjs` now owns UI-facing command adaptation and
  binding-side routing
- `worker/physics.worker.mjs` owns forge loading, XML load/init, step loop,
  snapshot packing, selection, perturbation, alignment, and command dispatch

What is good:

- Main ↔ worker transport is explicit
- Worker-side simulation ownership is structurally correct
- Snapshot delivery is clearly separated from DOM work
- `backend/backend_core.mjs` now exposes one published canonical snapshot to main-thread consumers

Current deviation from the ideal:

- `backend/backend_core.mjs` is narrower, but worker event handling and some
  payload-specific helpers still live beside transport/restart ownership
- `worker/physics.worker.mjs` remains a monolith with several internal
  subsystems collapsed into one file

Evidence:

- `backend/backend_core.mjs`
- `worker/physics.worker.mjs`

Recommended next action:

- Backend should stay the sole main-thread physical owner; later cleanup should
  split transport/restart from command adapters and snapshot adaptation without
  reintroducing second snapshot holders
- Worker should later be split internally into load/init, step/snapshot, and
  interactive command subsystems while keeping one worker entrypoint

### State & UI

Verdict: `Consolidate`

Current shape:

- `ui/state.mjs` owns store state, snapshot merge, actions, and runtime-aware
  reset behavior
- `ui/panel_state.mjs` now owns panel visibility, section collapsed state
  defaults, app-scoped persistence, and section initialization policy
- `ui/viewer_actions.mjs` now owns binding readers/appliers, spec actions,
  gestures, and visual-source switching
- `ui/control_widgets.mjs` now owns the coarse widget-rendering and local
  widget-behavior layer
- `ui/control_manager.mjs` owns panel DOM rendering, some shell styling side
  effects, and binding-driven widget behavior
- `app/right_panel_runtime.mjs` now derives dynamic section visibility from the
  store-backed panel state rather than asking the DOM for section expansion

What is good:

- Viewer-state reset now has a single explicit baseline source
- Panel visibility and section collapsed state now have a single app-scoped
  owner instead of being split across store, DOM, and shared localStorage keys
- Runtime sticky replay no longer rides on the general store subscription path
- Dynamic controls and renderer consumers now read backend-owned values from
  snapshot selectors instead of store mirrors
- `ui/state.mjs` is now substantially narrower and closer to a real store owner
- `ui/control_widgets.mjs` now owns widget-local helper behavior directly
  instead of accepting dozens of threaded helpers from `ui/control_manager.mjs`

Current deviation from the ideal:

- `ui/control_manager.mjs` is narrower, but still owns panel orchestration plus
  some shell-facing DOM effects
- `ui/control_widgets.mjs` is now the coarse widget layer, but it still needs
  long-term cleanup to stay cohesive instead of becoming another kitchen-sink
  module
- The store is now materially narrower, but visual-source preset caches still
  live inside the store and need to stay explicitly documented as JS-only local
  buffers

Evidence:

- `ui/state.mjs`
- `ui/panel_state.mjs`
- `ui/viewer_actions.mjs`
- `ui/control_manager.mjs`
- `ui/control_widgets.mjs`
- `ui/file_section.mjs`

Recommended next action:

- Preserve `ui/state.mjs` as the UI/shell owner only
- Preserve `ui/viewer_actions.mjs` as the coarse action layer instead of pushing
  that logic back into the store
- Keep `ui/control_manager.mjs` as the orchestrator and `ui/control_widgets.mjs`
  as the widget layer; only split again if a whole ownership slice can move
- Keep the store narrow and explicitly document the remaining JS-only preset
  buffers as local rendering state, not backend mirrors

### Renderer & Environment

Verdict: `Split later`

Current shape:

- `renderer/pipeline.mjs` still owns a large amount of render orchestration and
  scene/resource policy
- Several lower-level helpers already exist under `renderer/`

What is good:

- A meaningful amount of renderer logic has already been pushed into focused
  helper modules
- The renderer no longer directly depends on UI modules

Current deviation from the ideal:

- `renderer/pipeline.mjs` is still too broad for long-term maintainability
- Environment and renderer debug outputs are still ad hoc globals
- World-space occlusion is now unified for world objects. Labels remain
  intentionally separate, but they no longer ride the world scene as sprites;
  they are rendered in a dedicated screen-space text pass from MuJoCo-provided
  anchors and text.

Evidence:

- `renderer/pipeline.mjs`
- `renderer/scene_soa_geoms.mjs`
- `environment/environment.mjs`

Recommended next action:

- Do not split for the sake of line count alone
- The next renderer split should only happen if it cleanly isolates frame
  orchestration from scene/resource policy

### Plugins & Public Surface

Verdict: `Keep as-is`

Current shape:

- `app/play_host.mjs` exposes a frozen capability-oriented host surface
- Plugins are loaded dynamically and are expected to go through host-provided
  mounts and clock lanes

What is good:

- The public host contract is simpler and cleaner than many internal modules
- Capability gating is already present

Current deviation from the ideal:

- Debug globals still exist in parallel with the host surface
- Agents need a stronger rule that plugins should not depend on those globals

Evidence:

- `app/play_host.mjs`
- `app/main.mjs`

Recommended next action:

- Keep the host design
- Tighten documentation and guardrails around what counts as public vs debug-only

## Problem categories

### Implicit behavior

- Runtime behavior still relies on compatibility helpers in `core/viewer_runtime.mjs`
  that present the old parameter model as if it were still the primary source
- Debug globals and public globals coexist, which weakens the “single contract”
  mental model
- Reload semantics are now better than before, but are still encoded across
  `app/main.mjs`, `backend/backend_core.mjs`, and `ui/state.mjs`
- UI panel/section state is now centralized, but app profiles and plugin
  section fallbacks still rely on a documented contract rather than a stronger
  schema guard
- Downstream-specific names must not leak into Play runtime logic; UI profiles
  should stay generic and data-driven
- Visual-source switching still carries compatibility-style local caches inside
  store state even though published snapshot data is the formal renderer truth

### Duplication

- Bootstrap and runtime config both define font presets for the pre-paint
  boundary; this is currently a bounded, acceptable duplication
- Several npm scripts duplicate the same generate/test invocations in slightly
  different wrappers

### Redundancy

- `app/main.mjs`, `app/ui_runtime.mjs`, and `core/viewer_runtime.mjs` still
  expose debug/report helpers from different ownership layers
- Some visual-source preset caches still duplicate backend visual structs on the
  JS side by design; they should remain clearly scoped to preset switching only

### Inefficiency

- The main inefficiency is maintenance inefficiency, not obvious frame-time cost:
  large files, mixed ownership, and more than one path to inspect for resets,
  globals, or runtime behavior
- Test coverage is heavily e2e-weighted, which is good for regressions but weak
  for proving ownership and configuration rules

### Weak guardrails

- Some guardrails are real but coarse
- One guardrail is materially stale and currently blind to the real runtime tree

### Drifted docs and scripts

- Root npm placeholders (`lint`, `test`, `build`) do not reflect the actual
  workflows
- Some docs accurately describe the architecture, but readers can still assume
  the current guardrail suite is stronger than it actually is

### Oversized modules

- `renderer/pipeline.mjs`
- `worker/physics.worker.mjs`
- `ui/control_manager.mjs`
- `app/main.mjs`
- `backend/backend_core.mjs`
- `ui/state.mjs`

These are not all equally urgent. Oversize alone is not enough to justify a
split. Ownership width is the stronger signal.

## Guardrail audit

### `tools/check_module_boundaries.mjs`

Status: `Partially trusted`

Why:

- It enforces a real coarse import DAG over tracked and untracked code files
- It already reflects the current top-level runtime directories
- It does not reason about globals, runtime input sources, DOM side effects, or
  same-layer cohesion

### `tools/forbid_patterns.mjs`

Status: `Partially trusted`

Why:

- It now scans the live runtime tree (`app/`, `backend/`, `bridge/`, `core/`,
  `environment/`, `renderer/`, `ui/`, `worker/`) instead of the removed
  `dev/` / `src/` tree
- It now blocks two ownership regressions explicitly:
  - `latestSnapshot`-style duplicate snapshot holders
  - direct `snapshot || state.runtime.selection` fallback patterns
- It now also blocks:
  - runtime use of `consumeViewerParams`
  - runtime reads of `location.search`, `new URLSearchParams(...)`, and
    `PLAY_*` globals outside bootstrap
  - runtime reads of `window.__lastSnapshot`
- It now also adds coarse ownership checks for:
  - widget renderer bodies drifting back into `ui/control_manager.mjs`
  - widget-local helper bodies drifting back into `ui/control_manager.mjs`
  - binding/ui command adapters drifting back into `backend/backend_core.mjs`
- `tools/run_checks.mjs` now enforces a hard cap on factory injection surface:
  - `createControlWidgetsRuntime(...) <= 12`
  - `createBackendRuntime(...) <= 12`
- It now also blocks reintroducing viewer-store reads for backend-owned
  categories such as `state.simulation`, `state.hud`, `state.history`,
  `state.watch`, `state.keyframes`, `state.rendering.assets`,
  `state.rendering.voptFlags`, `state.rendering.sceneFlags`, and
  `state.model.vis`
- It is still pattern-based and therefore cannot prove full ownership
  correctness by itself

Impact:

- The project now has a minimally credible runtime pattern guard again, but it
  remains a coarse backstop rather than a full architecture proof
- The bridge still needs explicit pointer-ownership policy review whenever new
  forge pointer exports are added, because volatility is a semantic property,
  not something pattern checks can infer automatically

### `tools/run_checks.mjs`

Status: `Partially trusted`

Why:

- It is a useful wrapper for boundaries, unit tests, and syntax checks
- Its confidence is now limited by the coarseness of the underlying checks, not
  by stale scan roots
- Syntax checks only touch a small set of hot modules

### `package.json` scripts

Status: `Partially trusted`

Why:

- The real project scripts (`dev`, `generate:*`, `smoke`, `spec:lint`,
  `test:e2e`, `ci:guard`, `ci`) are meaningful
- The root placeholders `lint`, `test`, and `build` are stale and misleading

## Minimal trusted check plan

Priority order for future implementation:

1. Keep `tools/check_module_boundaries.mjs`, but treat it as a coarse layer
   guard only
2. Replace placeholder `lint` / `test` / `build` scripts with wrappers to real
   commands, or remove them
3. Add a dedicated guard that forbids new runtime input reads outside bootstrap
   and forbids new direct DOM/global writes outside documented ownership
4. Add a selector-usage guard for new snapshot consumers if the current
   coarse-pattern approach starts regressing again

## Recommended next work queue

### Queue A — Guardrail first

- Align docs, scripts, and actual checks
- Add explicit ownership-oriented checks around shell side effects and new
  snapshot-consumer patterns
- Keep the live runtime-tree coverage in `tools/forbid_patterns.mjs`
- Keep tests on the formal snapshot contract (`__PLAY_HOST__.getSnapshot()`)
  instead of reviving `window.__lastSnapshot` as a fallback path

### Queue B — Ownership consolidation

- Keep `core/runtime_config.mjs` as the only runtime input surface
- Reduce debug global sprawl where the host contract already covers the use case
- Continue moving snapshot-backed reads behind coarse selectors where it
  meaningfully reduces ownership ambiguity

### Queue C — Module reshaping

- `backend/backend_core.mjs`: split by responsibility, not by arbitrary size
- `app/main.mjs`: move non-assembly concerns out
- `ui/control_manager.mjs`: separate widget/presentation helpers from the
  top-level manager
- `renderer/pipeline.mjs`: only after a clean orchestration/resource-policy cut
  is identified

### Queue D — Deeper second-pass audits

- Worker internals (`physics.worker.mjs`) after guardrails are trustworthy
- Renderer scene/resource ownership after the backend and state layers are
  cleaner
- Plugin contract tightening after the runtime/public boundary is fully
  explicit
