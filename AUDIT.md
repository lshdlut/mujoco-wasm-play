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

## Left Panel Wiring Audit vs MuJoCo Simulate 3.5.0

Baseline:

- Upstream truth: MuJoCo `3.5.0` `simulate/simulate.cc`
  (`MakeRenderingSection`, `MakeVisualizationSection`, `MakeGroupSection`) and
  `src/engine/engine_vis_init.c` (`mjVISSTRING`, `mjRNDSTRING`,
  `mjv_defaultOption`)
- Play truth: `spec/ui_spec.json`, `ui/viewer_actions.mjs`,
  `ui/control_widgets.mjs`, `backend/backend_runtime.mjs`,
  `app/right_panel_runtime.mjs`
- Audited control count:
  - `Rendering`: `50`
  - `Visualization`: `73`
  - `Group enable`: `49`

Presentation note:

- Play expands MuJoCo shortcut tokens such as `AR`, `AV`, `AG`, `S0`, and
  `" 0"` into web-style shortcut displays such as `Alt R`, `Alt V`, `Alt G`,
  `Shift 0`, and `0`.
- Play also packages repeated upstream `mjITEM_CHECKBYTE` rows into shared web
  list controls in a few places (`checkbox_list`), while keeping per-entry
  binding/default/order semantics.
- This audit treats those shell-level packaging/display changes as
  `Intentional extension` unless they also change binding/default/order
  semantics.

Verdict summary:

- `Rendering`: `Partial`
- `Visualization`: `Partial`
- `Group enable`: `Partial`

Critical findings:

1. `rendering.tracking_geom` remains a Play-only extension inserted into the
   `Rendering` section. It must stay explicitly quarantined from the upstream
   MuJoCo core block.
2. `Visualization` now matches upstream label text and binding order, while
   compound vector/color editors remain intentional web widget substitutions
   rather than exact Simulate widget-type parity.
3. `Group enable` defaults now follow `mjv_defaultOption` (`[1,1,1,0,0,0]`)
   instead of fake `model.opt.*group[*]` sources.
4. `jointgroup` and `actuatorgroup` now carry per-item group metadata through
   the snapshot path and drive right-panel filtering/topology rebuild in the
   same coarse way MuJoCo Simulate does.

### Detailed matrix

#### Rendering

- Section / Item: `Rendering` section metadata
  - Upstream: title `Rendering`, shortcut `AR`, order `Camera -> Label -> Frame -> Copy camera -> Model Elements -> flags -> Tree depth -> Flex layer -> OpenGL Effects -> render flags`
  - Play: title `Rendering`, shortcut `Alt R`, same overall section position
  - Status: `Partial`
  - Evidence: `simulate/simulate.cc::MakeRenderingSection`, `spec/ui_spec.json`
  - Required action: Align the internal item order exactly by isolating the
    Play-only `tracking_geom` row from the upstream core block. The shortcut
    display expansion itself is an acceptable shell-level extension.

- Section / Item: `rendering.camera_mode`
  - Upstream: `mjITEM_SELECT`, binding `Simulate::camera`, default `0`, dynamic
    options `Free / Tracking / fixed cameras`
  - Play: `select`, binding `Simulate::camera`, default `0`, dynamic options
    refreshed from snapshot cameras
  - Status: `Exact match`
  - Evidence: `simulate/simulate.cc::MakeRenderingSection`,
    `ui/control_widgets.mjs::syncCameraSelectOptions`,
    `backend/backend_runtime.mjs`
  - Required action: None.

- Section / Item: `rendering.tracking_geom`
  - Upstream: no such control in `Rendering`
  - Play: `select`, binding `Simulate::tracking_geom`, disabled unless camera
    mode is `Tracking`
  - Status: `Intentional extension`
  - Evidence: `spec/ui_spec.json`, `ui/control_widgets.mjs`,
    `ui/viewer_actions.mjs`
  - Required action: Quarantine as a Play extension. Keep it out of the strict
    upstream core order, either by moving it to a clearly marked Play-only block
    under `Rendering` or by documenting it as a non-upstream row.

- Section / Item: `rendering.label_mode`
  - Upstream: `mjITEM_SELECT`, binding `mjvOption::label`, options
    `None/Body/Joint/Geom/Site/Camera/Light/Tendon/Actuator/Constraint/Flex/Skin/Selection/Sel Pnt/Contact/Force/Island`
  - Play: same binding, same options, same default `0`
  - Status: `Exact match`
  - Evidence: `simulate/simulate.cc::MakeRenderingSection`, `spec/ui_spec.json`,
    `ui/viewer_actions.mjs`, `backend/backend_runtime.mjs`
  - Required action: None.

- Section / Item: `rendering.frame_mode`
  - Upstream: `mjITEM_SELECT`, binding `mjvOption::frame`, options
    `None/Body/Geom/Site/Camera/Light/Contact/World`
  - Play: same binding, same options, same default `0`
  - Status: `Exact match`
  - Evidence: `simulate/simulate.cc::MakeRenderingSection`, `spec/ui_spec.json`,
    `ui/viewer_actions.mjs`, `backend/backend_runtime.mjs`
  - Required action: None.

- Section / Item: `rendering.copy_camera`
  - Upstream: `mjITEM_BUTTON`, label `Copy camera`
  - Play: `button`, same label
  - Status: `Exact match`
  - Evidence: `simulate/simulate.cc::MakeRenderingSection`, `spec/ui_spec.json`
  - Required action: None.

- Section / Item: `rendering.model_elements` separator
  - Upstream: separator `Model Elements`
  - Play: same separator
  - Status: `Exact match`
  - Evidence: `simulate/simulate.cc::MakeRenderingSection`, `spec/ui_spec.json`
  - Required action: None.

- Section / Item: `rendering.model_flags` / `mjvOption::flags[0..30]`
  - Upstream: `31` checkboxes from `mjVISSTRING`, with exact labels/defaults
    and shortcuts
  - Play: `31` checkboxes with exact index, label, default, and shortcut
    mapping for every `mjvOption::flags[i]`
  - Status: `Exact match`
  - Evidence: `engine_vis_init.c::mjVISSTRING`, `spec/ui_spec.json`
  - Required action: None.

- Section / Item: `rendering.tree_depth`
  - Upstream: `Tree depth`, `mjITEM_SLIDERINT`, binding `Simulate::opt.bvh_depth`,
    default `1`, range `0..20`
  - Play: `slider_int`, same label, binding, default, and range
  - Status: `Exact match`
  - Evidence: `simulate/simulate.cc::MakeRenderingSection`, `spec/ui_spec.json`,
    `backend/backend_runtime.mjs`
  - Required action: None.

- Section / Item: `rendering.flex_layer`
  - Upstream: `Flex layer`, `mjITEM_SLIDERINT`, binding
    `Simulate::opt.flex_layer`, default `0`, range `0..10`
  - Play: `slider_int`, same label, binding, default, and range
  - Status: `Exact match`
  - Evidence: `simulate/simulate.cc::MakeRenderingSection`, `spec/ui_spec.json`,
    `backend/backend_runtime.mjs`
  - Required action: None.

- Section / Item: `rendering.opengl_sep`
  - Upstream: separator `OpenGL Effects`
  - Play: same separator
  - Status: `Exact match`
  - Evidence: `simulate/simulate.cc::MakeRenderingSection`, `spec/ui_spec.json`
  - Required action: None.

- Section / Item: `mjvScene::flags[0..6]`
  - Upstream: `Shadow / Wireframe / Reflection / Additive / Skybox / Fog / Haze`
  - Play: exact same seven entries with correct defaults and shortcuts
  - Status: `Exact match`
  - Evidence: `engine_vis_init.c::mjRNDSTRING`, `spec/ui_spec.json`
  - Required action: None.

- Section / Item: `mjvScene::flags[7]` (`Depth`)
  - Upstream: `Depth`, default `0`, no shortcut
  - Play: present at the official index and wired through generated scene-flag
    defaults and runtime consumers
  - Status: `Exact match`
  - Evidence: `engine_vis_init.c::mjRNDSTRING`, `spec/ui_spec.json`,
    `core/viewer_defaults.mjs`
  - Required action: None.

- Section / Item: `mjvScene::flags[8]` (`Segment`)
  - Upstream: `Segment`, default `0`, shortcut `,`
  - Play: `Segment` is wired to `mjvScene::flags[8]`
  - Status: `Exact match`
  - Evidence: `engine_vis_init.c::mjRNDSTRING`, `spec/ui_spec.json`,
    `core/viewer_defaults.mjs`, `renderer/pipeline.mjs`
  - Required action: None.

- Section / Item: `mjvScene::flags[9]` (`Id Color`)
  - Upstream: `Id Color`, default `0`
  - Play: `Id Color` is wired to `mjvScene::flags[9]`
  - Status: `Exact match`
  - Evidence: `engine_vis_init.c::mjRNDSTRING`, `spec/ui_spec.json`,
    `core/viewer_defaults.mjs`
  - Required action: None.

- Section / Item: `mjvScene::flags[10]` (`Cull Face`)
  - Upstream: `Cull Face`, default `1`
  - Play: `Cull Face` is wired to `mjvScene::flags[10]`
  - Status: `Exact match`
  - Evidence: `engine_vis_init.c::mjRNDSTRING`, `spec/ui_spec.json`,
    `core/viewer_defaults.mjs`
  - Required action: None.

#### Visualization

- Section / Item: `Visualization` section metadata
  - Upstream: title `Visualization`, shortcut `AV`, section order identical to
    `Headlight -> Free Camera -> Global -> Map -> Scale -> RGBA`
  - Play: same title, shortcut displayed as `Alt V`, same group ordering
  - Status: `Intentional extension`
  - Evidence: `simulate/simulate.cc::MakeVisualizationSection`,
    `spec/ui_spec.json`
  - Required action: None beyond documenting the shortcut presentation layer as
    a web-shell extension.

- Section / Item: `visualization.headlight_sep`, `visualization.freecam_sep`,
  `visualization.global_sep`, `visualization.map_sep`,
  `visualization.scale_sep`, `visualization.rgba_sep`
  - Upstream: same separator titles and order
  - Play: same separator titles and order
  - Status: `Exact match`
  - Evidence: `simulate/simulate.cc::MakeVisualizationSection`,
    `spec/ui_spec.json`
  - Required action: None.

- Section / Item: `visualization.headlight_active`
  - Upstream: `radio`, binding `mjVisual::headlight.active`, options `Off/On`
  - Play: same
  - Status: `Exact match`
  - Evidence: `simulate/simulate.cc::MakeVisualizationSection`,
    `spec/ui_spec.json`, `backend/backend_runtime.mjs`
  - Required action: None.

- Section / Item: `visualization.headlight_ambient`,
  `visualization.headlight_diffuse`, `visualization.headlight_specular`
  - Upstream: `mjITEM_EDITFLOAT` with vector length `3`
  - Play: `edit_vec3_string`
  - Status: `Intentional extension`
  - Evidence: `simulate/simulate.cc::MakeVisualizationSection`,
    `spec/ui_spec.json`, `ui/bindings.mjs`
  - Required action: Quarantine as a control-type extension. Keep the binding,
    order, and labels exact, but explicitly document that Play uses compound
    vector editors instead of repeated float fields.

- Section / Item: `visualization.orthographic`, `visualization.fovy`,
  `visualization.azimuth`, `visualization.elevation`, `visualization.align`,
  `visualization.extent`, `visualization.inertia`, `visualization.bvh`
  - Upstream: same labels, same order, same bindings, same options
  - Play: same
  - Status: `Exact match`
  - Evidence: `simulate/simulate.cc::MakeVisualizationSection`,
    `spec/ui_spec.json`, `backend/backend_runtime.mjs`
  - Required action: None.

- Section / Item: `visualization.center`
  - Upstream: `mjITEM_EDITNUM` with vector length `3`
  - Play: `edit_vec3`
  - Status: `Intentional extension`
  - Evidence: `simulate/simulate.cc::MakeVisualizationSection`,
    `spec/ui_spec.json`
  - Required action: Quarantine as a control-type extension. Do not treat it as
    an exact upstream widget match.

- Section / Item: `visualization.map_stiffness`
  - Upstream: label `Stiffness`
  - Play: label `Stiffness`
  - Status: `Exact match`
  - Evidence: `simulate/simulate.cc::MakeVisualizationSection`,
    `spec/ui_spec.json`
  - Required action: None.

- Section / Item: `visualization.map_stiffnessrot`
  - Upstream: label `Rot stiffness`
  - Play: label `Rot stiffness`
  - Status: `Exact match`
  - Evidence: `simulate/simulate.cc::MakeVisualizationSection`,
    `spec/ui_spec.json`
  - Required action: None.

- Section / Item: `visualization.map_force`,
  `visualization.map_torque`, `visualization.map_alpha`,
  `visualization.map_fogstart`, `visualization.map_fogend`,
  `visualization.map_zfar`, `visualization.map_haze`,
  `visualization.map_shadowclip`, `visualization.map_shadowscale`
  - Upstream: labels `Force`, `Torque`, `Alpha`, `Fog start`, `Fog end`,
    `Z far`, `Haze`, `Shadow clip`, `Shadow scale`
  - Play: bindings, order, and label text now match upstream exactly
  - Status: `Exact match`
  - Evidence: `simulate/simulate.cc::MakeVisualizationSection`,
    `spec/ui_spec.json`
  - Required action: None.

- Section / Item: `visualization.map_znear`
  - Upstream: label `Z near`
  - Play: label `Z near`
  - Status: `Exact match`
  - Evidence: `simulate/simulate.cc::MakeVisualizationSection`,
    `spec/ui_spec.json`
  - Required action: None.

- Section / Item: `visualization.scale_*`
  - Upstream: all `Scale` labels and order match
  - Play: bindings, labels, and order are exact for
    `All (meansize) / Force width / Contact width / Contact height / Connect / Com / Camera / Light / Select point / Joint length / Joint width / Actuator length / Actuator width / Frame length / Frame width / Constraint / Slider-crank`
  - Status: `Exact match`
  - Evidence: `simulate/simulate.cc::MakeVisualizationSection`,
    `spec/ui_spec.json`
  - Required action: None.

- Section / Item: `visualization.rgba_fog` through `visualization.rgba_bvactive`
  - Upstream: `mjITEM_EDITFLOAT` with vector length `4`
  - Play: `edit_rgba`
  - Status: `Intentional extension`
  - Evidence: `simulate/simulate.cc::MakeVisualizationSection`,
    `spec/ui_spec.json`
  - Required action: Quarantine as a control-type extension. Keep binding/order
    parity, but do not treat the widget type as an exact upstream match.

- Section / Item: `visualization.rgba_actuatornegative`,
  `visualization.rgba_actuatorpositive`
  - Upstream: labels `actnegative`, `actpositive`
  - Play: labels `actnegative`, `actpositive`
  - Status: `Exact match`
  - Evidence: `simulate/simulate.cc::MakeVisualizationSection`,
    `spec/ui_spec.json`
  - Required action: None.

- Section / Item: all remaining `visualization.rgba_*`
  - Upstream: label/order/binding match
  - Play: exact same order and bindings; only widget type differs as noted
    above
  - Status: `Exact match`
  - Evidence: `simulate/simulate.cc::MakeVisualizationSection`,
    `spec/ui_spec.json`
  - Required action: None beyond the accepted `edit_rgba` type divergence.

#### Group enable

- Section / Item: `Group enable` section metadata
  - Upstream: title `Group enable`, shortcut `AG`
  - Play: same title, shortcut displayed as `Alt G`
  - Status: `Intentional extension`
  - Evidence: `simulate/simulate.cc::MakeGroupSection`, `spec/ui_spec.json`
  - Required action: None beyond documenting the shortcut presentation layer as
    a web-shell extension.

- Section / Item: `group.geom_separator`, `group.site_separator`,
  `group.joint_separator`, `group.tendon_separator`,
  `group.actuator_separator`, `group.flex_separator`,
  `group.skin_separator`
  - Upstream: same separator titles and order
  - Play: same
  - Status: `Exact match`
  - Evidence: `simulate/simulate.cc::MakeGroupSection`, `spec/ui_spec.json`
  - Required action: None.

- Section / Item: `group.geom[0..5]`
  - Upstream: labels `Geom 0..5`, shortcuts `" 0".." 5"`, defaults from
    `mjv_defaultOption` (`1,1,1,0,0,0`)
  - Play: labels and shortcuts match; spec and generated defaults now also
    match `mjv_defaultOption`
  - Status: `Exact match`
  - Evidence: `simulate/simulate.cc::MakeGroupSection`,
    `engine_vis_init.c::mjv_defaultOption`, `spec/ui_spec.json`
  - Required action: None.

- Section / Item: `group.site[0..5]`
  - Upstream: labels `Site 0..5`, shortcuts `S0..S5`, defaults from
    `mjv_defaultOption` (`1,1,1,0,0,0`)
  - Play: defaults now match `mjv_defaultOption`; shortcut badges remain
    web-style `Shift+0..5` presentation
  - Status: `Intentional extension`
  - Evidence: `simulate/simulate.cc::MakeGroupSection`,
    `engine_vis_init.c::mjv_defaultOption`, `spec/ui_spec.json`
  - Required action: None beyond keeping the shortcut presentation difference
    documented.

- Section / Item: `group.joint[0..5]`, `group.tendon[0..5]`,
  `group.actuator[0..5]`, `group.flex[0..5]`, `group.skin[0..5]`
  - Upstream: labels match, no shortcuts, defaults from `mjv_defaultOption`
    (`1,1,1,0,0,0`)
  - Play: labels, lack of shortcuts, and defaults now match
    `mjv_defaultOption`
  - Status: `Exact match`
  - Evidence: `simulate/simulate.cc::MakeGroupSection`,
    `engine_vis_init.c::mjv_defaultOption`, `spec/ui_spec.json`
  - Required action: None.

### Wiring-specific findings

- Section / Item: `Rendering` and `Visualization` refresh model
  - Upstream: selective `pending_.ui_update_rendering` /
    `pending_.ui_update_visualization`
  - Play: generic snapshot/state-driven `updateControls(...)` tick plus
    per-control option refresh hooks
  - Status: `Intentional extension`
  - Evidence: `simulate/simulate.cc`, `app/ui_runtime.mjs`,
    `ui/control_manager.mjs`, `ui/control_widgets.mjs`
  - Required action: Keep the generic refresh model. It is implementation
    different but semantically acceptable as long as values/options remain
    correct.

- Section / Item: `mjVisual::*` / `mjStatistic::*` edit wiring
  - Upstream: edits mutate live passive/current visual/stat structs and then
    trigger `ui_update_visualization`
  - Play: readers use snapshot selectors; writers use `setField` via
    `prepareBindingUpdate`, then explicitly request a fresh snapshot
  - Status: `Exact match`
  - Evidence: `simulate/simulate.cc`, `ui/viewer_actions.mjs`,
    `backend/backend_runtime.mjs`
  - Required action: None.

- Section / Item: `group.geom[*]` and `group.site[*]` -> rendering behavior
  - Upstream: group toggles update `SECT_GROUP`; world rendering responds via
    `mjvOption`
  - Play: snapshot-backed `groups` are read directly; left panel values refresh
    correctly and renderer consumes group state from snapshot
  - Status: `Exact match`
  - Evidence: `simulate/simulate.cc`, `backend/backend_runtime.mjs`,
    `ui/viewer_actions.mjs`
  - Required action: None.

- Section / Item: `group.joint[*]` -> `Joint` right-panel filtering
  - Upstream: `MakeJointSection` skips each joint whose own model group is
    disabled
  - Play: snapshot meta now carries `jnt_group`, and `deriveJointDofs(...)`
    filters each joint by its actual group
  - Status: `Exact match`
  - Evidence: `simulate/simulate.cc::MakeJointSection`,
    `app/right_panel_runtime.mjs`
  - Required action: None.

- Section / Item: `group.actuator[*]` -> `Control` right-panel filtering/remake
  - Upstream: `MakeControlSection` skips actuators whose model group is
    disabled; actuator-group changes trigger `ui_remake_ctrl`
  - Play: actuator meta now carries per-actuator `group`, and
    `buildActuatorSource(...)` / `deriveVisibleActuators(...)` include actuator
    group topology in both filtering and remake
  - Status: `Exact match`
  - Evidence: `simulate/simulate.cc::MakeControlSection`,
    `simulate.cc` pending logic, `worker/physics.worker.mjs`,
    `app/right_panel_runtime.mjs`
  - Required action: None.

- Section / Item: `rendering.tracking_geom`
  - Upstream: none
  - Play: local store-backed extension with option list derived from snapshot
    geoms
  - Status: `Intentional extension`
  - Evidence: `ui/control_widgets.mjs`, `ui/viewer_actions.mjs`,
    `backend/backend_runtime.mjs`
  - Required action: Quarantine as Play extension and ensure future audits do
    not treat it as an upstream row.

### Implementation status

The planned parity remediation has now been implemented.

Resolved upstream drift:

1. `Rendering` OpenGL flag parity is now exact for MuJoCo `3.5.0`
   - `Depth` is restored at `mjvScene::flags[7]`
   - `Segment`, `Id Color`, and `Cull Face` now live at official indices
   - generated defaults, snapshot serialization, renderer consumers, and tests
     now use the same 11-flag model
2. `Visualization` label text drift is resolved
   - `Stiffness`, `Rot stiffness`, `Force`, `Torque`, `Alpha`, `Fog start`,
     `Fog end`, `Z far`, `Haze`, `Shadow clip`, `Shadow scale`,
     `actnegative`, and `actpositive` now match upstream spelling/casing
3. `Group enable` default metadata is resolved
   - spec defaults now follow `mjv_defaultOption` `[1,1,1,0,0,0]`
   - generated viewer group defaults and runtime normalization match that same
     source of truth
4. `jointgroup` and `actuatorgroup` right-panel behavior is resolved
   - worker meta now carries per-joint and per-actuator group ids
   - `Joint` and `Control` right-panel sections now filter by each item's actual
     group and rebuild on topology changes

Intentional extensions retained:

- `rendering.tracking_geom` remains a Play-only row and is explicitly marked as
  such in spec/docs
- `edit_vec3_string`, `edit_vec3`, and `edit_rgba` remain web widget
  substitutions rather than exact MuJoCo widget-type parity
- shortcut badges such as `Alt R`, `Alt V`, `Alt G`, and `Shift 0..5` remain
  shell-level presentation expansions of MuJoCo shortcut tokens

Current completion criteria:

- `Rendering / Visualization / Group enable` now have exact upstream
  order/text/default/index semantics for the upstream-owned rows
- `mjvScene::flags[*]` indices are identical to MuJoCo `3.5.0`
- `jointgroup` and `actuatorgroup` now drive right-panel filtering/remake in
  the same coarse way MuJoCo Simulate does
- Remaining non-upstream rows and widget substitutions are explicitly marked as
  Play extensions
