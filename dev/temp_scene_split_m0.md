# TEMP - Single Scene Cleanup (M0)

## Problem
- Legacy dualscene experiment (sceneWorld + sceneBg + layered renders) complicated the renderer, introduced depth inconsistencies, and diverged from MuJoCo semantics.
- We need a deterministic single `THREE.Scene` pipeline so all geometry (including infinite ground / skybox) shares one depth buffer.

## Goals
1. **Only keep `sceneWorld`**. Remove `sceneBg`, layered rendering, background-scene env hooks, and any compat flags.
2. Treat infinite ground/grid as standard meshes (`depthTest = depthWrite = true`) anchored in world space, so the “ground” participates in depth.
3. Bind HDRI / skybox / fallback preset backgrounds directly to `sceneWorld.background` and environments to `sceneWorld.environment`.
4. Rendering loop simplifies to: `renderer.clear(true, true, false); renderer.render(sceneWorld, camera);`

## Constraints / Notes
- Renderer remains `autoClear=false` so we control clear order, but only one render pass executes.
- Keep DOM HUD / overlays separate (unchanged), but all 3D objects (including haze mesh) live in the single scene.
- Environment manager must no longer touch any “backgroundScene”.

## Action Plan
**Stage 0 – Pre-upgrade Experiments**
- Recreate the old post-pass fog pipeline on HEAD and compare against current `scene.fog`; decide which path to keep when porting to 6376283…. Capture before/after screenshots and notes.
- Prototype the infinite ground so that:
  * It behaves as normal geometry for depth (shadow reception and optional reflection support).
  * Viewed from above it looks opaque; from below it appears semi-transparent (matching earlier behavior).
  * Document shader/material tweaks needed.

**Stage 1 – Core Feature Ports (from 6376283...)**
1. Introduce `dev/infinite_grid_helper.mjs` with camera-locked grid/ground shaders (depth-aware, underside fade). Wire it into `viewer_renderer.mjs` (constants `GROUND_DISTANCE`/`RENDER_ORDER`, shadow hooks, render order integration).
2. Add `dev/haze_helper.mjs` + `ensureHazeMesh/applyHazeOverlay` in renderer. This requires infinite plane detection (from scene snapshot) and render order management.
3. Implement MuJoCo fog/haze converters (`resolveFogConfig`, `resolveHazeConfig`, `applySceneFog` or, if Stage 0 chooses post-pass, reintroduce a minimal post-pass fog). Align this with the Stage 0 decision.

**Stage 2 – Renderer Loop**
- Keep single `sceneWorld`; delete layered/background code entirely.
- Initialize renderer with infinite ground + haze overlay; ensure render loop is `clear -> render(sceneWorld)`.
- Integrate Stage 0 fog decision (either use post-pass or `scene.fog`), ensuring infinite ground still interacts with fog/haze correctly.

**Stage 3 – Environment & Lighting**
- Port HDRI fallback loader, presets, and gradient background helpers. Bind directly to `sceneWorld.background/environment`.
- Remove any legacy layered hooks (e.g., `skySuppressed`, `backgroundScene`).

**Stage 4 – Polish & Verification**
- Reapply overlay/selection tweaks, screenshot helpers, etc., as needed.
- Run smoke tests (ground shadows, haze, HDRI toggle, screenshot export).
- Confirm infinite ground receives shadows and optionally reflections; verify underside translucency matches Stage 0 reference.

## Deliverables
- Clean patch on top of `6376283...` containing:
  * `dev/infinite_grid_helper.mjs` and `dev/haze_helper.mjs`.
  * Updated `viewer_renderer.mjs` with single-scene loop, infinite ground, haze overlay, and chosen fog implementation.
  * Updated `viewer_environment.mjs` binding environment/skybox only to `sceneWorld`.
  * Notes from Stage 0 experiments (post-pass fog vs `scene.fog`, ground shadow/reflection tweaks).
- Explicit removal of layered/background/post RT legacy code (no `sceneBg`, `renderSceneWithPost`, etc.).

## Guardrails
- The renderer owns exactly one THREE.Scene (`sceneWorld`).
- `renderLayered` is a thin wrapper that renders `sceneWorld` once (no backgroundScene / post RT).
- No layered/multi-scene/backgroundScene helpers may be added in later stages.
- Fog/Haze experiments stay within the single scene via renderOrder/material controls.
