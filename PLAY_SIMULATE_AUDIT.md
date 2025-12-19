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
           -> bridge.mjs (WASM handle + pointers + ABI compat)
     -> viewer_controls.mjs (UI spec -> DOM -> actions)
     -> viewer_renderer.mjs (three.js scene + overlays)
     -> viewer_camera.mjs / viewer_picking.mjs (input + selection/perturb)
```

## Module Size (Top-Level `dev/`)
- `dev/viewer_renderer.mjs` 11313 LOC
- `dev/viewer_state.mjs` 3664 LOC
- `dev/physics.worker.mjs` 3517 LOC
- `dev/viewer_controls.mjs` 2470 LOC
- `dev/bridge.mjs` 1836 LOC
- `dev/main.nobuild.mjs` 1298 LOC
- `dev/viewer_environment.mjs` 1279 LOC
- Remaining files are < 1k LOC but still contribute to duplication.

## Redundancy and Divergence Findings
- Legacy rendering paths coexist with scene-first pipeline; base-layer legacy builders are disabled but still present (`dev/viewer_renderer.mjs:9262`, `dev/viewer_renderer.mjs:9296`).
- Legacy contact/perturb overlays remain alongside mjvScene overlays (`dev/viewer_renderer.mjs:11721`, `dev/viewer_renderer.mjs:11733`).
- Legacy perturb pipeline is duplicated across worker, picking, and state handling (`dev/physics.worker.mjs:70`, `dev/physics.worker.mjs:3088`, `dev/viewer_picking.mjs:388`, `dev/viewer_picking.mjs:635`, `dev/viewer_state.mjs:3373`).
- Legacy ABI compatibility adds fallback paths that complicate bridge logic (`dev/bridge.mjs:888`, `dev/forge_abi_compat.js`).
- HUD overlay markup is the current UI; no separate legacy HUD container remains after review.
- Shared defaults consolidated into `dev/viewer_defaults.mjs` (scene flags, group counts, vopt defaults).
- Debug-only scene snapshot pipeline removed; worker no longer emits `scene_snapshot`.
- Stale spec docs removed (parity matrix, web mapping).
- Visual source mode mismatch across spec and runtime (spec says Preset/Model, runtime uses preset-sun/preset-moon) (`dev/spec/ui_spec.json:79`, `dev/viewer_state.mjs:234`, `dev/viewer_controls.mjs:1272`).
- Removed unused modules (`dev/sim.ts`, `dev/loader.ts`).

## Web-Only UI Features Detected (Candidates to Preserve)
- HDRI + fallback environment presets (sun/moon, ground/grid tuning) (`dev/viewer_environment.mjs`).
- Visual source presets (preset-sun / preset-moon) and diagnostics (`dev/viewer_state.mjs:234`).
- Infinite grid / infinite ground helpers (`dev/infinite_grid_helper.mjs`).
- Overlay cards + toast UX (help/info/profiler/sensor, download notifications) (`dev/index.html`, `dev/main.nobuild.mjs`).
- Screenshot capture pipeline via WebGL readback (`dev/main.nobuild.mjs`).
- Worker-backed rendering pipeline (WASM in worker, three.js in main).

## Simplification Plan (Draft)
- Phase 0: remove dead/unused assets and stale docs (legacy HUD HTML, unused modules, outdated spec docs); consolidate shared constants into a single module used by worker + state.
- Phase 1: remove legacy perturb pipeline and legacy overlay paths; keep only mjvScene-based overlays and wasm-driven perturbation.
- Phase 2: drop ABI compatibility layers if a single forge ABI is acceptable; simplify bridge and worker initialization.
- Phase 3: align state ownership with simulate flow (backend snapshot as source of truth, UI as projection) and remove duplicated state caches.

## Open Questions
- Is dropping legacy ABI support acceptable (forge 3.3.7+ only)?
- Confirm the must-keep web UI features from the list above.
