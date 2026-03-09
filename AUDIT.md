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

Verdict: `Consolidate`

Current shape:

- `app/entry_bootstrap.js` now collects startup inputs and builds
  `__PLAY_RUNTIME_CONFIG__`
- `core/runtime_config.mjs` replays runtime UI state and exposes typed access
- `core/viewer_runtime.mjs` still retains a compatibility-style `params` reader

What is good:

- Runtime input collection is now explicit and centralized at startup
- Sticky UI-facing runtime settings survive model switches and reloads

Current deviation from the ideal:

- The old `params` compatibility mirror remains in `core/viewer_runtime.mjs`
- A small pre-paint duplication remains for font presets across bootstrap and
  runtime config
- Some debug-oriented globals are still accepted as bootstrap inputs

Evidence:

- `app/entry_bootstrap.js`
- `core/runtime_config.mjs`
- `core/viewer_runtime.mjs`

Recommended next action:

- Remove the `params` compatibility layer after the audit guardrails are fixed
- Keep the bootstrap-only preset duplication unless a zero-cost pre-paint
  alternative appears

### Assembly & Main Thread

Verdict: `Split later`

Current shape:

- `app/main.mjs` assembles the application
- It also owns layout shell classes, UI lane scheduling, overlay updates, plugin
  boot, and several debug globals

What is good:

- There is one obvious application entrypoint
- The worker/backend split stays visible from the top level

Current deviation from the ideal:

- `app/main.mjs` is not a thin assembler
- It owns too many side effects and too many “last mile” responsibilities

Evidence:

- `app/main.mjs`

Recommended next action:

- Keep `app/main.mjs` as the entry module, but later split out lane scheduling
  and shell/global registration into explicit submodules

### Backend & Worker

Verdict: `Split later`

Current shape:

- `backend/backend_core.mjs` owns worker spawn, transport, restart, snapshot
  cache, binding routing, and adaptive snapshot scheduling
- `worker/physics.worker.mjs` owns forge loading, XML load/init, step loop,
  snapshot packing, selection, perturbation, alignment, and command dispatch

What is good:

- Main ↔ worker transport is explicit
- Worker-side simulation ownership is structurally correct
- Snapshot delivery is clearly separated from DOM work

Current deviation from the ideal:

- `backend/backend_core.mjs` mixes transport, orchestration, and UI-facing
  semantics
- `worker/physics.worker.mjs` remains a monolith with several internal
  subsystems collapsed into one file

Evidence:

- `backend/backend_core.mjs`
- `worker/physics.worker.mjs`

Recommended next action:

- Backend should later be split into transport/restart + command adapters +
  snapshot adaptation
- Worker should later be split internally into load/init, step/snapshot, and
  interactive command subsystems while keeping one worker entrypoint

### State & UI

Verdict: `Consolidate`

Current shape:

- `ui/state.mjs` owns store state, snapshot merge, actions, and runtime-aware
  reset behavior
- `ui/control_manager.mjs` owns panel DOM rendering, some shell styling side
  effects, and binding-driven widget behavior

What is good:

- Viewer-state reset now has a single explicit baseline source
- Snapshot merge and runtime sticky replay live in the same conceptual area

Current deviation from the ideal:

- `ui/control_manager.mjs` still bundles widget rendering, DOM presentation, and
  shell-facing effects
- DOM side effects are better than before, but still spread across more than one
  module by design

Evidence:

- `ui/state.mjs`
- `ui/control_manager.mjs`
- `ui/file_section.mjs`

Recommended next action:

- Preserve `ui/state.mjs` as the state owner
- Later extract control presentation helpers from `ui/control_manager.mjs`
  without breaking the top-level control manager contract

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

### Duplication

- Bootstrap and runtime config both define font presets for the pre-paint
  boundary; this is currently a bounded, acceptable duplication
- Several npm scripts duplicate the same generate/test invocations in slightly
  different wrappers

### Redundancy

- `app/main.mjs` and `core/viewer_runtime.mjs` both expose debug/report helpers
- The `params` compatibility mirror duplicates part of the typed runtime config
  surface

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

Status: `Stale / blind`

Why:

- It still scans `dev/`, `src/`, `tools/`, and `tests/`
- It does not scan the current runtime directories such as `app/`, `backend/`,
  `bridge/`, `core/`, `environment/`, `renderer/`, `ui/`, and `worker/`
- As a result, `ci:guard` currently misses most of the live runtime tree

Impact:

- The project appears to have a pattern guard, but the current runtime is mostly
  outside its coverage

### `tools/run_checks.mjs`

Status: `Partially trusted`

Why:

- It is a useful wrapper for boundaries, unit tests, and syntax checks
- Its confidence is currently limited by the stale `forbid_patterns` scan roots
- Syntax checks only touch a small set of hot modules

### `package.json` scripts

Status: `Partially trusted`

Why:

- The real project scripts (`dev`, `generate:*`, `smoke`, `spec:lint`,
  `test:e2e`, `ci:guard`, `ci`) are meaningful
- The root placeholders `lint`, `test`, and `build` are stale and misleading

## Minimal trusted check plan

Priority order for future implementation:

1. Fix `tools/forbid_patterns.mjs` scan roots so the live runtime tree is
   actually covered
2. Keep `tools/check_module_boundaries.mjs`, but treat it as a coarse layer
   guard only
3. Replace placeholder `lint` / `test` / `build` scripts with wrappers to real
   commands, or remove them
4. Add a dedicated guard that forbids new runtime input reads outside bootstrap
   and forbids new direct DOM/global writes outside documented ownership

## Recommended next work queue

### Queue A — Guardrail first

- Fix stale guard coverage
- Align docs, scripts, and actual checks
- Add explicit ownership-oriented checks around runtime input and shell side
  effects

### Queue B — Ownership consolidation

- Remove the `params` compatibility layer in `core/viewer_runtime.mjs`
- Keep `core/runtime_config.mjs` as the only runtime input surface
- Reduce debug global sprawl where the host contract already covers the use case

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
