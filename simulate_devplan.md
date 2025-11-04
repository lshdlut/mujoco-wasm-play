# Simulate Parity Development Plan

## Context
The goals for `mujoco-wasm-play` are to reach feature parity with MuJoCo's desktop *simulate* tool while relying on the WASM artifacts produced by `mujoco-wasm-forge`. The viewer shell, basic renderer and control surface are now in place, but the physics ↔ rendering bridge and many UI bindings remain stubs. This plan captures the remaining work, owner queues, and sequencing.

## Guiding Principles
- Treat MuJoCo's visualization stack as the authoritative “middle layer”: mirror `mjvOption`, `mjvScene`, and `mjvCamera` usage so geometry/state flow matches desktop simulate.
- Prefer extending the forge wrappers (`mjwf_*`) instead of reimplementing model structure decoding in JS.
- Keep the worker/direct backends behaviourally identical – new protocol messages must be implemented on both sides.
- Gate user-visible features behind snapshot/option plumbing and cover them with Playwright smoke tests.

## Status Snapshot (2025-11-03)
| Area | State | Notes |
|------|-------|-------|
| Viewer shell & layout | ✅ | HTML/CSS panels, collapsible sections, dual-column controls complete. |
| Geometry updates | ✅ | `geom_xpos/xmat/size/type`, material colours, contact points streaming. |
| MuJoCo wrappers (`mjwf_*`) | ⚠️ | Core state exported; no mesh / scene exports yet. |
| Backend protocol | ⚠️ | Simulation, option toggles wired; generic `setField` pipeline missing. |
| Rendering parity | ⚠️ | Custom Three.js path; lacks `mjvScene` derived features (labels, frames, mesh refinement). |
| Testing / CI | ⚠️ | Skeleton scripts only; spec validator exists but not enforced. |

## High-Priority Work Queue
1. **Expose MuJoCo rendering scene data** (in progress)  
   - Extend `MjSimLite` backends to materialise middle-layer information (scene options, geom descriptors, mesh buffers).  
   - Publish a `render_assets` payload on model load; synchronise meshes when the model changes.  
   - Ensure worker/direct modes share the same implementation with fallbacks when wrappers are absent.
2. Generalised UI→backend binding  
   - Introduce `setField/setFlag` command family that maps spec bindings (physics, visualization, options).  
   - Implement on worker + direct backends with `mjModel`/`mjData` updates.
3. `mjvScene` driven rendering  
   - Maintain `mjvScene`, `mjvOption`, `mjvCamera`, `mjvPerturb` per snapshot.  
   - Transfer scene geoms (including instancing, label/frame toggles) to Three.js renderer.
4. UI feature closure  
   - Actuator sliders, keyframe buffers, history scrubber, screenshot/save/print flows.
5. Test & release automation  
   - Turn on spec validator (`npm run spec:lint`) and add Playwright parity smoke tests to CI (`npm run ci`).

## Workstreams & Next Actions

### Rendering Asset Capture (P0)
- [x] Add mesh/data views to forge wrappers (`mjwf_*`) – vert/face/normal/texcoord arrays, geom→mesh map.
- [x] Extend `MjSimLite` with `collectRenderAssets()` returning geometry + material + mesh descriptors.
- [x] Emit `render_assets` message from worker/direct backends on successful model load (and on reload).
- [x] Persist assets in viewer state for renderer consumption.

### Backend Field Routing (P1)
- [x] Normalise bindings from `ui_spec.json` into `(target, field, type)` tuples (see `spec/ui_bindings_index.json`).
- [ ] Implement backend commands (`setField`, `setFlag`, `setOption`) and connect to `mjModel`, `mjData`, `mjvOption`.
- [ ] Ensure idempotent updates and snapshot diffs after command execution.

### mjvScene Integration (P1)
- [ ] Maintain `mjvScene` buffer in worker/direct backends and update via `mjv_updateScene`.
- [ ] Stream `mjvScene` geoms (pose, type, appearance) to renderer and replace manual geom handling.
- [ ] Support label/frame/contact visualisation consistent with `mjvScene`.

### UI Feature Closure (P2)
- [ ] Actuator sliders ↔ backend control range clamping.
- [ ] Keyframe load/save, history scrubber hooking into mujoco data.
- [ ] Screenshot/save xml/mjb flows (browser download).

### Testing & Tooling (P2)
- [ ] Enforce spec validation in CI (`npm run spec:lint`).
- [ ] Add Playwright end-to-end smoke that boots viewer, flips key toggles, validates HUD counters.
- [ ] Document developer workflow (building forge artifacts, running worker/direct modes).
- [x] Provide CLI snapshot comparer (`node scripts/compare_snaps.mjs <sim> <adapter>`) for offline diff validation.

## Dependencies & Coordination
- **Forge wrapper updates**: mesh/scene exports require changes in `mujoco-wasm-forge` (`wrappers/official_app_337`). Coordinate before expecting runtime availability.
- **Dev server hosting**: `/dist/<ver>/` must resolve to staged forge artifacts for direct backend fetches.
- **Asset transfers**: large typed arrays should use transferable ArrayBuffers to keep main thread responsive.

## Tracking
- Maintain task status inline (checkboxes) and annotate PRs with `[render-assets]`, `[scene-binding]`, etc.
- Revisit this plan after the render asset milestone lands to reprioritise remaining items.
