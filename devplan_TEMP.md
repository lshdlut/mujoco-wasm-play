Dev Plan — MuJoCo WASM Play: Simulate Parity Roadmap

Scope
- Goal: Reach near feature parity with MuJoCo “simulate” for interactive viewing and control, running on Forge/WASM 3.3.7.
- Non‑goals: Full native UI replication, offscreen GPU features, persistence/cloud features.

Assumptions
- Forge artifacts available at `local_tools/forge/dist/3.3.7/mujoco-3.3.7.{js,wasm}`.
- Viewer runs from repo root via `scripts/dev_server.py` and Playwright e2e tests.
- Current code paths: Worker or Direct backend, three.js renderer, UI spec‐driven panels/hotkeys.

Milestones & Deliverables
M0 — Baseline (DONE)
- Commit current baseline before plan (tracked).

M1 — Options Editing: mjVisual + mjStatistic write-through
- Add structure layouts for `mjVisual` and `mjStatistic` similar to `viewer_option_struct.mjs`.
- Extend backends (`physics.worker.mjs`, `direct_backend.mjs`) setField to support targets: `mjOption` (existing), `mjVisual`, `mjStatistic`.
- Enable related UI controls: Visualization (global, headlight, map, scale, rgba…), Statistic (center, extent, meansize).
- Tests: e2e edits reflect in backend options snapshot; renderer responds to key toggles.
- As an interim usability aid, allow overriding XML defaults with our preset values (e.g., fog/haze/light) before user tweaks, while renderer continues to reflect the actual struct state.

M2 — Camera Modes: Free / Tracking / Fixed (model cameras)
- Enumerate model cameras from Forge exports; maintain camera list in render context.
- Implement mode switching in backend state and apply in `viewer_renderer.mjs` + `viewer_camera.mjs`.
- Tracking mode targets bounds center; Fixed modes use model‑defined poses.
- Tests: hotkeys/select change camera, HUD reflects mode, image difference tolerances.

M3 — Groups & Visibility
- Wire `mjvOption::*group[]` to renderer visibility: geom/site/joint/tendon/actuator/flex/skin.
- Update renderer to hide/show meshes by group efficiently.
- Tests: toggling groups affects drawn count and pixels.

M4 — Contacts & Debug Overlays
- Render contact points and (optionally) force arrows; draw frame axes and labels based on label/frame modes.
- Use `contacts` payload from backend; add simple geometry pools.
- Tests: enabling contact flags renders primitives; snapshot contains expected overlays.

M5 — Picking & Perturbation
- Raycast to geom; map to joint/body; feed `applyForce`/perturb hooks in backend.
- UI feedback: selection highlight, simple HUD messages.
- Tests: click applies force (state changes), selection toggles.

M6 — History / Keyframe / Watch
- Backend ring buffer of states for scrub; implement key load/save and copy; implement watch value probe (qpos/qvel/… ).
- Tests: scrub freezes time; key save/load changes state deterministically; watch updates live.

M7 — Rendering Polish & Parity Nits
- Environment controls (fog/haze/skybox/reflection), grid policy, light/shadow tuning, PBR export‑quality screenshot.
- Ensure vopt/scene flag defaults match simulate feel.
- Tests: visual toggles flip renderer state; export PNG is consistent.

M8 — E2E Coverage & CI Hooks
- Extend `scripts/e2e/simulate_parity.spec.ts` with new cases (camera modes, contacts, groups, options edits, picking).
- Add golden image sampling for a small stable model with tolerance.

Work Breakdown (File‑level)
- Backends
  - `physics.worker.mjs`: setField support for `mjVisual`/`mjStatistic`; continue posting `options` snapshot; expose camera meta and group flags as needed; keep applyForce.
  - `direct_backend.mjs`: mirror worker behavior for debug mode; keep in‑thread stepping.
  - New: `viewer_visual_struct.mjs`, `viewer_stat_struct.mjs` (pointer maps, read/write helpers like `viewer_option_struct.mjs`).
- Viewer State / Controls
  - `src/viewer/state.mjs`: merge backend snapshots (new `options` fields), handle cameraMode semantics, track group flags.
  - `viewer_controls.mjs`: enable/disable controls based on pointer support; hook radio/select/slider to new setField paths.
- Renderer
  - `viewer_renderer.mjs`:
    - Camera list + switching, tracking camera behavior.
    - Group visibility masking.
    - Contact/force vectors, frame axes, basic labels.
    - Keep pooled materials/geometries; ensure performance.

Test Plan
- Local server: `python scripts/dev_server.py --root . --port 8080`.
- Manual:
  - Worker: `http://localhost:8080/index.html?ver=3.3.7&debug=1`  
  - Direct: `http://localhost:8080/index.html?ver=3.3.7&mode=direct&nofallback=1&debug=1`
- E2E: `npm i && npm run ci` or `npx playwright test --reporter=list --timeout=90000`.
- Worker harness: `python scripts/worker_debug.py --python C:\\Users\\63427\\miniforge3\\envs\\myconda\\python.exe --port 8080 --wait 3`.

Acceptance Checklist (update as we go)
- [x] M1: Edit mjVisual/mjStatistic fields reflect in snapshot and view.
- [x] M2: Camera modes switch with UI and hotkeys; fixed cameras visible.
- [x] M3: Group toggles affect visibility and drawn counts.
- [ ] M4: Contact points/forces/frames render when flags set.
- [ ] M5: Picking applies forces; selection feedback works.
- [ ] M6: History/keyframe/watch operate; scrub stable.
- [ ] M7: Rendering polish: fog/haze/skybox/reflection toggles; screenshot consistent.
- [ ] M8: E2E tests extended; greens locally.

Engineering Notes
- Keep artifacts/logs out of VCS (use `%TEMP%` or `/tmp`).
- Prefer `worker` backend for consistency; ensure `direct` stays functional for debugging.
- Cache bust `.wasm` via `version.json` (sha tag) when present.
- Add instrumentation logs only under debug flags; throttle logs in production.

Risks & Mitigations
- Pointer export variance across Forge builds → gate UI with `optionSupport` and new visual/stat support flags.
- Performance regressions → keep geometry/material pools; avoid per‑frame allocations; batch overlay updates.
- Cross‑browser differences → cap DPR to 2; conservative shadow configs.

Journal (fill as each milestone completes)
- [M0] 2025-11-10 Baseline committed before plan.
- [M1] 2025-11-10 Enabled mjVisual/mjStatistic read/write via viewer_struct_access (worker/direct backends emit struct_state updates, UI now syncs controls). Expected effect: Visualization/Statistic controls update immediately, worker logs show `struct_state` messages, and snapshots carry `visual/statistic` structs. User verification: tweak headlight/map/scale sliders and confirm rendering changes & no console errors. Follow-up: visualization knobs still tricky—stage defaults that override XML via local copy before writing new values, while renderer still reads live struct fields.
- [M2] 2025-11-10 Camera runtime routing now applies Tracking (auto-target bounds) and fixed model cameras inside the renderer. Free mode preserves user gestures, Tracking keeps the last free offset and follows the current bounds center, fixed slots snap to model-authored poses and ignore gestures. Expected effect: switching to Tracking recenters each frame, selecting any model camera snaps to its pose in both worker/direct modes, and returning to Free restores the last manual view instead of jumping. User verification: 1) Load `RKOB_simplified_upper_with_marker_CAMS.xml` via worker (`?ver=3.3.7&debug=1`) and direct backends, cycle the Camera control or `[ / ]` hotkeys and confirm Free is interactive, Tracking glues to the model center, and each named camera matches MuJoCo simulate orientation. 2) While in Tracking/fixed, try dragging or using the wheel—gestures should be ignored; switch back to Free and verify the previous orbit/zoom is restored. Follow-up: inject model camera names into the dropdown/HUD and ensure `cameraMode` snapshots stay in sync with backend selections.
- [M2] 2025-11-11 Tracking mode parity pass: renderer now computes a “dynamic” bounds center that ignores static planes/hfields (so the camera actually follows the moving rig), and the camera controller re-enables orbit/zoom gestures when `cameraIndex` is 0 or 1. We sync the tracking offset after every gesture so user edits persist while the target keeps following the live center. Expected effect: Tracking stays locked on the robot even when the floor spans the whole scene, and you can rotate/zoom just like Free mode while the focus point keeps up with motion. Verification: load the RKOB model, switch to Tracking, walk the simulation forward and confirm the robot stays centered even as it moves in space; drag/scroll to adjust the view and ensure the offset is retained when you pause/resume or step frames. Follow-up: expose a visible “Tracking geom” selector so that Tracking mode can lock onto a specific geom rather than the auto bounds center.
- [M2] 2025-11-11 Tracking geom selector shipped: Rendering panel now includes a `Tracking geom` dropdown populated with every named geom from the loaded model (worker/direct share the same list, sourced from Forge metadata). When `Camera` is set to Free/Fixed we gray this control out; switching to Tracking enables it so you can choose either `Scene center` (legacy auto bounds) or a specific geom to follow. Expected effect: picking a geom snaps the camera target to that geom’s position, and the view continues to follow that geom as it moves. Verification: enter Tracking mode, pick a limb geom (e.g., `forearm`) from the dropdown, step the simulation, and confirm the camera follows that limb; switch back to `Scene center` to regain the auto behavior. Reminder: disabled appearance outside Tracking mode is expected per spec.
- [M3] 2025-11-11 Group toggles now round-trip through the backends: worker/direct expose `mjvOption` group masks (geom/site/joint/tendon/actuator/flex/skin), the Rendering → “Group enable” checkboxes update state immediately, and the renderer hides geoms whose group has been disabled (using `geom_group` metadata pulled from the model). Expected effect: toggling “Geom group 0” (or using the `0`-`5` shortcuts once wired) should hide/show the corresponding geom cohorts; other groups update UI state and will apply once their primitives render in later milestones. Verification: load RKOB, note which geom group indices are used (check XML or toggle one-by-one); flip a group switch and confirm meshes disappear, then re-enable to bring them back. Worker/direct both share the same behavior since the mask is sent via the `options` stream.

Verification Expectations
- After each milestone, I will summarize (a) the expected observable effects and (b) exactly what you need to verify (routes to click, toggles to try, screenshots/logs if needed). Please confirm those after each summary so we keep the devplan truthful.
