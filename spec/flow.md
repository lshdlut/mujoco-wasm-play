# Simulate Flow Reference

## Main Lifecycle
1. **Startup**
   - `Simulate` constructor copies initial `mjvCamera`, `mjvOption`, `mjvPerturb`, zeroes UI structs, registers callbacks, and pushes static sections (`File`, `Option`, `Simulation`, `Watch`).
   - Platform adapter populates `mjuiState` rectangles using current framebuffer size and installs event/layout handlers.
2. **Render Thread Boot** (`Simulate::RenderLoop`)
   - Sets `mjcb_time`, calls `mjv_default*`, initializes profiler/sensor figures, allocates scene, and enters the `while (!ShouldClose && !exitrequest)` loop.
3. **Per-frame Loop**
   - Locks `Simulate::mtx` via `MutexLock` guard.
   - Handles deferred model loads (`loadrequest`), drag-and-drop, and asset uploads.
   - Runs `Sync(state_only)`:
     - Mirrors joint/actuator/equality arrays between UI-owned buffers and active `mjData`.
     - Applies pending file operations, resets, history loads, keyframe ops, and align requests.
     - Updates overlay flags (`update_profiler`, `update_sensor`) and UI refresh toggles.
   - Releases the mutex and calls `Render()`.
   - Updates FPS estimate every ≥0.2 s.
4. **Shutdown**
   - After loop exits, frees scenes (and passive copies), marks `exitrequest=2`.

## Render() Sequence
1. **Sync Pending Flags**
   - Applies `pending_.ui_update_*` by rerunning `mjui_update` on relevant sections before drawing.
2. **Scene Rendering**
   - Clears buffers (`glClear` via platform adapter), draws main scene with `mjr_render`.
3. **History / Noise / Selection**
   - Applies perturb forces, optionally adds control noise, steps simulation if `run` true and not paused.
4. **Overlays**
   - Computes real-time HUD, renders `ui0`/`ui1` if enabled.
   - Conditionally renders Help, Info, Profiler, Sensor overlays, then user-provided figures/text/images.
5. **Finalize**
   - Processes screenshot requests (read pixels, flip, encode PNG).
   - Swaps buffers.

## Event Dispatch (UiEvent / Platform callbacks)
- Mouse/keyboard events captured by `PlatformUIAdapter` populate `mjuiState` then call `UiEvent`:
  1. Route to `ui0` when drag rect or mouse rect matches left panel.
  2. Execute section-specific handlers (File actions, Option style changes, Simulation pending flags, Physics bitfields, Rendering camera logic, Visualization align, Group updates).
  3. If unhandled, route to `ui1` for Joint/Control/Equality logic.
  4. Remaining keypresses fall through to global switch (space, arrows, camera brackets, Tab, etc.).
  5. Mouse events in 3D viewport (rect 3) implement camera/perturb interactions (see state machines below).

## State Machines
### Viewer Camera & Perturbation
- **States**: `Idle`, `CameraRotate`, `CameraPan`, `CameraZoom`, `PerturbRotate`, `PerturbTranslate`.
- **Transitions**:
  - `Idle` → `CameraRotate` on Left-drag (Shift variance toggles horiz/vert).
  - `Idle` → `CameraPan` on Right-drag (Shift toggles axis).
  - `Idle` → `CameraZoom` on Scroll/Middle drag.
  - `Idle` → `PerturbRotate` on Ctrl+Left drag when `pert.select > 0`.
  - `Idle` → `PerturbTranslate` on Ctrl+Right drag when selection valid.
  - Any drag state → `Idle` on mouse release; perturb states also zero `pending_.newperturb`.
- **Priority**: Perturb states override camera updates (checked first inside `Simulate::RenderLoop`).

### Selection & Tracking
- **Double-click (3D)** → queue `pending_.select` with captured ray + modifiers.
- `pending_.select` resolves inside `Sync`:
  - Left double-click selects body/site/flex/skin, stores ids, and caches local position.
  - Ctrl+Right double-click sets `cam.type = mjCAMERA_TRACKING` with `trackbodyid`.
  - Right double-click recenters `cam.lookat` without changing mode.

### Play Controls & History
- **Run switch**: `simulation.run` radio toggles states `Running` / `Paused`.
- **When Running**: `Simulate::run` true triggers stepping inside `RenderLoop`, `scrub_index` forced to zero.
- **History scrub**: Moving history slider sets `scrub_index < 0`, triggers `pending_.load_from_history`; stepping forward/back updates history buffer via `AddToHistory`.

### Option / Visualization Edits
- UI edits write directly into `mjOption`, `mjVisual`, `mjStatistic`, or `mjvOption` fields.
- `UpdateSettings` reconciles `Simulate::disable`, `enable`, `enableactuator` arrays with current model flags each frame; differences set `pending_.ui_update_*` booleans to refresh widgets.
- Changing actuator group toggles raises `pending_.ui_remake_ctrl` so control sliders regenerate with updated enable/disable state.

## Immediate Application Path
`UI edit → UiEvent (detect section) → write to target struct → set pending flag → mjui_update on next frame → mjv_updateScene/mjrContext refresh`
- Examples:
  - Toggling `Option->Color` updates `ui0.color/ui1.color` then calls `UiModify` to rebuild layout.
  - Changing `Physics->Disable Flags` rewrites `mjOption::disableflags` and marks `pending_.ui_update_physics` for scene sync.
  - Adjusting `Visualization->Scale` directly writes into `m->vis.scale.*`; passive mode mirrors back to driving model via `Sync()`.
