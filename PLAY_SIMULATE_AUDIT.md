# Play vs Simulate Audit

## Scope
- Baseline: `local_tools/mujoco/simulate` (MuJoCo simulate, ~3k LOC).
- Target: `dev/` (play UI + worker + renderer).
- Goal: Simulate parity, keep explicit web-only UI additions, remove redundancy.

## Baseline (Simulate) Flow Summary
- Init: `main.cc` constructs `Simulate`, spawns physics thread, enters `RenderLoop`.
- Physics: `PhysicsLoop` steps `mj_step`, manages real-time sync, history, noise.
- Sync/UI: `Simulate::Sync` applies pending actions and mirrors UI buffers into `mjData`.
- Render: `Simulate::Render` updates UI sections, renders `mjvScene` + overlays.

## Play Flow Summary
```
index.html
  -> main.nobuild.mjs (init, store, renderer, UI, overlays)
     -> viewer_state.mjs (store + backend API + snapshot merge)
        -> physics.worker.mjs (simulation loop, snapshot emit)
           -> bridge.mjs (WASM handle + pointers, helper-only ABI)
     -> viewer_controls.mjs (UI spec -> DOM -> actions)
     -> viewer_renderer.mjs (three.js scene + overlays)
     -> viewer_interaction.mjs (input + selection/perturb)
```

## Module Size (Top-Level `dev/`)
- `dev/viewer_renderer.mjs` 7834 LOC
- `dev/viewer_renderer.mjs` 8202 LOC
- `dev/viewer_state.mjs` 3646 LOC
- `dev/physics.worker.mjs` 2810 LOC
- `dev/viewer_controls.mjs` 2634 LOC
- `dev/bridge.mjs` 1884 LOC
- `dev/main.nobuild.mjs` 1146 LOC
- Remaining files are < 1k LOC but still contribute to duplication.

## Redundancy and Divergence Findings
- Legacy rendering paths coexist with scene-first pipeline; base-layer legacy builders are disabled but still present (`dev/viewer_renderer.mjs:9262`, `dev/viewer_renderer.mjs:9296`).
- Legacy JS overlay builders removed; overlays now rely on mjvScene SoA + wasm state.
- Perturb pipeline now uses wasm mjv helpers only; JS-side perturb viz removed.
- Legacy ABI compatibility removed; bridge/worker now assume forge helper exports (3.3.7+).
- HUD overlay markup is the current UI; no separate legacy HUD container remains after review.
- Shared defaults consolidated into `dev/viewer_defaults.mjs` (scene flags, group counts, vopt defaults).
- Binding normalization and visual field groups now live in `dev/viewer_state.mjs` (previously `dev/viewer_bindings.mjs` and `dev/visual_field_groups.mjs`).
- Debug-only scene snapshot pipeline removed; worker no longer emits `scene_snapshot`.
- Stale spec docs removed (parity matrix, web mapping).
- Visual source mode mismatch across spec and runtime (spec says Preset/Model, runtime uses preset-sun/preset-moon) (`dev/spec/ui_spec.json:79`, `dev/viewer_state.mjs:234`, `dev/viewer_controls.mjs:1272`).
- Removed unused modules (`dev/sim.ts`, `dev/loader.ts`).

## Web-Only UI Features Detected (Candidates to Preserve)
- HDRI + fallback environment presets (sun/moon, ground/grid tuning) (`dev/viewer_renderer.mjs`).
- Visual source presets (preset-sun / preset-moon) and diagnostics (`dev/viewer_state.mjs:234`).
- Infinite grid / infinite ground helpers (`dev/viewer_renderer.mjs`).
- Overlay cards + toast UX (help/info/profiler/sensor, download notifications) (`dev/index.html`, `dev/main.nobuild.mjs`).
- Worker-backed rendering pipeline (WASM in worker, three.js in main).
- Screenshot capture pipeline removed; rely on browser/OS capture tooling.

## Simplification Plan (Draft)
- Phase 0 (done): remove dead/unused assets and stale docs; consolidate shared constants into a single module used by worker + state.
- Phase 1 (done): remove legacy perturb pipeline and legacy overlay paths; keep only mjvScene-based overlays and wasm-driven perturbation.
- Phase 2 (done): drop ABI compatibility layers; simplify bridge/worker init around forge helper exports.
- Phase 3 (done): backend snapshots are the single source of truth; main-thread backend adapter no longer applies optimistic state updates. UI-only state is limited to overlays/panels/theme/tracking geom, and history/watch updates are driven by worker messages.
- Phase 4 (done): remove legacy JS-side geom descriptor rendering path; scene debug now reports only SoA-derived stats, with flex/skin driven solely by mjvScene.

## Open Questions
- Confirm the must-keep web UI features from the list above.
