// MuJoCo shadow-map parity helpers for three.js.
// Keep behaviour identical; do not swallow errors.

import * as THREE from 'three';

// MuJoCo GL3 shadow rendering disables face culling and uses `glPolygonOffset` while
// writing the shadow map (see `mujoco/src/render/render_gl3.c`). three.js exposes
// polygon offset on materials; apply it to the generated depth materials via
// `onBeforeShadow` for closer Simulate parity without adding a separate pipeline.
//
// NOTE: MuJoCo uses reverse-Z, while three.js uses a conventional forward-Z depth
// range. This requires flipping the polygon-offset sign. The magnitudes are tuned
// for three.js to avoid contact-shadow "peter-panning" (gaps near the ground) while
// still suppressing self-shadow acne.
const MUJOCO_SHADOW_POLYGON_OFFSET_FACTOR = 1.0;
const MUJOCO_SHADOW_POLYGON_OFFSET_UNITS = 4.0;
// MuJoCo renders shadow maps into an inset viewport (1 px border) to avoid
// "infinite" shadowing from clamped edge samples (render_gl3.c). With
// `PCFShadowMap` the filter footprint stays within +/-1 texel, so 1 px matches
// Simulate while maximizing the usable shadow-map area.
const MUJOCO_SHADOW_VIEWPORT_INSET_PX = 1;
const MUJOCO_SHADOW_VIEWPORT_INSET_SENTINEL = Symbol('play:mujoco_shadow_viewport_inset');
const MUJOCO_SHADOW_VIEWPORT_INSET_TMP = new THREE.Vector4();

export function installMuJoCoShadowViewportInset(renderer) {
  if (!renderer?.shadowMap || !renderer?.state) return false;
  const shadowMap = renderer.shadowMap;
  if (shadowMap[MUJOCO_SHADOW_VIEWPORT_INSET_SENTINEL]) return false;
  shadowMap[MUJOCO_SHADOW_VIEWPORT_INSET_SENTINEL] = true;

  const state = renderer.state;
  if (typeof state.viewport !== 'function' || typeof shadowMap.render !== 'function') return false;

  let inShadowPass = false;
  const originalShadowRender = shadowMap.render.bind(shadowMap);
  shadowMap.render = (lights, scene, camera) => {
    inShadowPass = true;
    try {
      return originalShadowRender(lights, scene, camera);
    } finally {
      inShadowPass = false;
    }
  };

  const originalViewport = state.viewport.bind(state);
  state.viewport = (viewport) => {
    if (!inShadowPass || !viewport) return originalViewport(viewport);
    const borderPx = MUJOCO_SHADOW_VIEWPORT_INSET_PX;
    const w = viewport.z;
    const h = viewport.w;
    if (!(w > 2 * borderPx && h > 2 * borderPx)) return originalViewport(viewport);
    MUJOCO_SHADOW_VIEWPORT_INSET_TMP.set(
      viewport.x + borderPx,
      viewport.y + borderPx,
      w - 2 * borderPx,
      h - 2 * borderPx,
    );
    return originalViewport(MUJOCO_SHADOW_VIEWPORT_INSET_TMP);
  };

  return true;
}

export function onBeforeShadowMuJoCo(renderer, object, camera, shadowCamera, geometry, depthMaterial) {
  if (!depthMaterial) return;
  if (depthMaterial.polygonOffset !== true) depthMaterial.polygonOffset = true;
  if (depthMaterial.polygonOffsetFactor !== MUJOCO_SHADOW_POLYGON_OFFSET_FACTOR) {
    depthMaterial.polygonOffsetFactor = MUJOCO_SHADOW_POLYGON_OFFSET_FACTOR;
  }
  if (depthMaterial.polygonOffsetUnits !== MUJOCO_SHADOW_POLYGON_OFFSET_UNITS) {
    depthMaterial.polygonOffsetUnits = MUJOCO_SHADOW_POLYGON_OFFSET_UNITS;
  }
}

