// Extracted from main.nobuild.mjs (renderer + camera/picking controllers).
// Keep behaviour identical; do not swallow errors.

import * as THREE from 'three';
import {
  consumeViewerParams,
  isPerfEnabled,
  isStrictEnabled,
  perfMarkOnce,
  perfNow,
  perfSample,
  logDebug,
  logWarn,
  logStatus,
  logError,
  strictCatch,
  strictEnsure,
  strictOverride,
} from './viewer_runtime.mjs';
import { compatFallback } from './fallbacks.mjs';
import { pushSkyDebug } from './main_environment.mjs';
import { applySpecAction } from './main_ui.mjs';

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
function installMuJoCoShadowViewportInset(renderer) {
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
function onBeforeShadowMuJoCo(renderer, object, camera, shadowCamera, geometry, depthMaterial) {
  if (!depthMaterial) return;
  if (depthMaterial.polygonOffset !== true) depthMaterial.polygonOffset = true;
  if (depthMaterial.polygonOffsetFactor !== MUJOCO_SHADOW_POLYGON_OFFSET_FACTOR) {
    depthMaterial.polygonOffsetFactor = MUJOCO_SHADOW_POLYGON_OFFSET_FACTOR;
  }
  if (depthMaterial.polygonOffsetUnits !== MUJOCO_SHADOW_POLYGON_OFFSET_UNITS) {
    depthMaterial.polygonOffsetUnits = MUJOCO_SHADOW_POLYGON_OFFSET_UNITS;
  }
}

function createInfiniteGroundHelper({
  color = 0xffffff,
  distance = 2000.0,
  renderOrder = -10,
} = {}) {
  const colorObj = color instanceof THREE.Color ? color.clone() : new THREE.Color(color);
  const geometry = new THREE.PlaneGeometry(2, 2, 1, 1);
  const material = new THREE.MeshStandardMaterial({
    color: colorObj,
    roughness: 0.9,
    metalness: 0,
    transparent: true,
    opacity: 1,
    side: THREE.DoubleSide,
  });
  const uniforms = {
    uMuJoCoTexEnabled: { value: 0 },
    uMuJoCoMap: { value: null },
    uMuJoCoTexScl: { value: new THREE.Vector2(1, 1) },
    uDistance: { value: distance },
    uFadeStart: { value: distance * 0.9 },
    uFadeEnd: { value: distance },
    uQuadDistance: { value: distance },
    uFadePow: { value: 2.5 },
    uPlaneOrigin: { value: new THREE.Vector3(0, 0, 0) },
    uPlaneAxisU: { value: new THREE.Vector3(1, 0, 0) },
    uPlaneAxisV: { value: new THREE.Vector3(0, 1, 0) },
    uPlaneNormal: { value: new THREE.Vector3(0, 0, 1) },
    uGridStep: { value: 2.0 },
    uGridColor: { value: colorObj.clone() },
    // Model mode should be driven by MuJoCo materials/textures. Presets can
    // opt-in to extra ground grid overlays by overriding these uniforms.
    uGridIntensity: { value: 0.0 },
  };
  material.extensions = material.extensions || {};
  material.extensions.derivatives = true;
  material.userData.infiniteUniforms = uniforms;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uMuJoCoTexEnabled = uniforms.uMuJoCoTexEnabled;
    shader.uniforms.uMuJoCoMap = uniforms.uMuJoCoMap;
    shader.uniforms.uMuJoCoTexScl = uniforms.uMuJoCoTexScl;
    shader.uniforms.uDistance = uniforms.uDistance;
    shader.uniforms.uFadeStart = uniforms.uFadeStart;
    shader.uniforms.uFadeEnd = uniforms.uFadeEnd;
    shader.uniforms.uQuadDistance = uniforms.uQuadDistance;
    shader.uniforms.uFadePow = uniforms.uFadePow;
    shader.uniforms.uPlaneOrigin = uniforms.uPlaneOrigin;
    shader.uniforms.uPlaneAxisU = uniforms.uPlaneAxisU;
    shader.uniforms.uPlaneAxisV = uniforms.uPlaneAxisV;
    shader.uniforms.uPlaneNormal = uniforms.uPlaneNormal;
    shader.uniforms.uGridStep = uniforms.uGridStep;
    shader.uniforms.uGridColor = uniforms.uGridColor;
    shader.uniforms.uGridIntensity = uniforms.uGridIntensity;
    shader.vertexShader = `
varying vec3 vInfiniteWorldPosition;
varying vec2 vPlaneCoord;
varying float vCameraSide;
uniform vec3 uPlaneOrigin;
uniform vec3 uPlaneAxisU;
uniform vec3 uPlaneAxisV;
uniform vec3 uPlaneNormal;
uniform float uDistance;
uniform float uQuadDistance;
${shader.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
      vec3 camVec = cameraPosition - uPlaneOrigin;
      float camSide = dot(camVec, uPlaneNormal);
      vec3 camProjected = cameraPosition - camSide * uPlaneNormal;
      float quadScale = uQuadDistance;
      if (quadScale <= 0.0) quadScale = uDistance;
      vec3 span = position.x * quadScale * uPlaneAxisU + position.y * quadScale * uPlaneAxisV;
      transformed = camProjected + span;
      vPlaneCoord = vec2(dot(transformed - uPlaneOrigin, uPlaneAxisU), dot(transformed - uPlaneOrigin, uPlaneAxisV));
      vCameraSide = camSide;`
    )}`.replace(
      '#include <worldpos_vertex>',
      `#include <worldpos_vertex>
      vec4 infiniteWorldPosition = modelMatrix * vec4(transformed, 1.0);
      vInfiniteWorldPosition = infiniteWorldPosition.xyz;`
    );
    shader.fragmentShader = `
varying vec3 vInfiniteWorldPosition;
varying vec2 vPlaneCoord;
varying float vCameraSide;
uniform float uMuJoCoTexEnabled;
uniform sampler2D uMuJoCoMap;
uniform vec2 uMuJoCoTexScl;
uniform float uDistance;
uniform float uFadeStart;
uniform float uFadeEnd;
uniform float uQuadDistance;
uniform float uFadePow;
uniform vec3 uPlaneOrigin;
uniform vec3 uPlaneAxisU;
uniform vec3 uPlaneAxisV;
uniform vec3 uPlaneNormal;
uniform float uGridStep;
uniform vec3 uGridColor;
uniform float uGridIntensity;
${shader.fragmentShader.replace(
      '#include <map_fragment>',
      `#include <map_fragment>

      // Match MuJoCo's generated 2D texture coords (see engine_vis_visualize.c):
      // u = 0.5 * repeatX * x - 0.5, v = -0.5 * repeatY * y - 0.5.
      if (uMuJoCoTexEnabled > 0.5) {
        vec2 scl = uMuJoCoTexScl;
        vec2 uv = vec2(
          0.5 * vPlaneCoord.x * scl.x - 0.5,
          -0.5 * vPlaneCoord.y * scl.y - 0.5
        );
        vec4 texColor = texture2D(uMuJoCoMap, uv);
        diffuseColor.rgb *= texColor.rgb;
      }`
    ).replace(
      '#include <dithering_fragment>',
      `
      vec3 camVec = cameraPosition - uPlaneOrigin;
      vec2 camCoord = vec2(dot(camVec, uPlaneAxisU), dot(camVec, uPlaneAxisV));
      float planarDist = length(camCoord - vPlaneCoord);

      float baseRadius = max(1e-4, uQuadDistance);
      if (planarDist >= baseRadius) discard;

      float alpha = 1.0;

      float fadeStart = max(0.0, uFadeStart);
      float fadeEnd = max(fadeStart, uFadeEnd);
      if (fadeEnd > fadeStart + 1e-4 && uFadePow > 1e-5) {
        float t = clamp((planarDist - fadeStart) / max(fadeEnd - fadeStart, 1e-6), 0.0, 1.0);
        float hazeAlpha = pow(1.0 - t, uFadePow);
        alpha *= hazeAlpha;
      }

      float edge = smoothstep(baseRadius * 0.9, baseRadius, planarDist);
      alpha *= (1.0 - edge);

      if (vCameraSide < -0.01) {
        alpha *= 0.25;
      }
      if (alpha <= 0.0) discard;
      vec3 baseColor = gl_FragColor.rgb;
      if (uGridStep > 1e-6 && uGridIntensity > 1e-6) {
        vec2 r = vPlaneCoord / max(uGridStep, 1e-6);
        vec2 grid = abs(fract(r - 0.5) - 0.5) / fwidth(r);
        float line = min(grid.x, grid.y);
        float gridStrength = 1.0 - min(line, 1.0);
        float mixAmt = clamp(gridStrength * uGridIntensity, 0.0, 1.0);
        gl_FragColor.rgb = mix(baseColor, uGridColor, mixAmt);
      } else {
      gl_FragColor.rgb = baseColor;
      }
      gl_FragColor.a = alpha;
      #include <dithering_fragment>`
    )}`;
    material.userData.shader = shader;
  };
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = renderOrder;
  mesh.receiveShadow = true;
  mesh.matrixAutoUpdate = false;
  mesh.matrix.identity();
  mesh.updateMatrix();
  mesh.userData.infiniteGround = { uniforms };
  return mesh;
}

const MJ_GEOM = {
  PLANE: 0,
  HFIELD: 1,
  SPHERE: 2,
  CAPSULE: 3,
  ELLIPSOID: 4,
  CYLINDER: 5,
  BOX: 6,
  MESH: 7,
  SDF: 8,
  // rendering-only geom types (from mjmodel_tmp.h:mjtGeom)
  ARROW: 100,
  ARROW1: 101,
  ARROW2: 102,
  LINE: 103,
  LINEBOX: 104,
  FLEX: 105,
  SKIN: 106,
  LABEL: 107,
  TRIANGLE: 108,
  NONE: 1001,
};
const FIXED_CAMERA_OFFSET = 2;
const MJ_VIS = {
  CONVEXHULL: 0,
  TEXTURE: 1,
  JOINT: 2,
  CAMERA: 3,
  ACTUATOR: 4,
  ACTIVATION: 5,
  LIGHT: 6,
  TENDON: 7,
  RANGEFINDER: 8,
  CONSTRAINT: 9,
  INERTIA: 10,
  SCLINERTIA: 11,
  PERTFORCE: 12,
  PERTOBJ: 13,
  CONTACTPOINT: 14,
  ISLAND: 15,
  CONTACTFORCE: 16,
  CONTACTSPLIT: 17,
  TRANSPARENT: 18,
  AUTOCONNECT: 19,
  COM: 20,
  SELECT: 21,
  STATIC: 22,
  SKIN: 23,
  FLEXVERT: 24,
  FLEXEDGE: 25,
  FLEXFACE: 26,
  FLEXSKIN: 27,
  BODYBVH: 28,
  MESHBVH: 29,
  SDFITER: 30,
};
const MJ_OBJ = {
  UNKNOWN: 0,
  BODY: 1,
  XBODY: 2,
  JOINT: 3,
  DOF: 4,
  GEOM: 5,
  SITE: 6,
  CAMERA: 7,
  LIGHT: 8,
  FLEX: 9,
  MESH: 10,
  SKIN: 11,
  HFIELD: 12,
  TEXTURE: 13,
  MATERIAL: 14,
  PAIR: 15,
  EXCLUDE: 16,
  EQUALITY: 17,
  TENDON: 18,
  ACTUATOR: 19,
  SENSOR: 20,
  NUMERIC: 21,
  TEXT: 22,
  TUPLE: 23,
  KEY: 24,
  PLUGIN: 25,
  FRAME: 100,
  DEFAULT: 101,
  MODEL: 102,
};
const MJ_LIGHT_TYPE = {
  SPOT: 0,
  DIRECTIONAL: 1,
  POINT: 2,
  IMAGE: 3,
};
const MJ_MAXLIGHT = 128;
const LABEL_TEXTURE_CACHE = new Map();
const LABEL_TEXTURE_VERSION = 3;
const LABEL_TEXTURE_CACHE_LIMIT = 256;
const LABEL_DEFAULT_HEIGHT = 0.08;
const LABEL_DEFAULT_OFFSET = 0.04;
const MJ_LABEL_STRIDE = 100;
const MJ_LABEL_DECODER = (typeof TextDecoder !== 'undefined') ? new TextDecoder('utf-8') : null;
const LABEL_LOD_NEAR = 2.0;
const LABEL_LOD_MID = 4.5;
const LABEL_LOD_FACTORS = { near: 2, mid: 1.4, far: 1 };
const __TMP_VEC3 = new THREE.Vector3();
const __TMP_VEC3_A = new THREE.Vector3();
const __TMP_VEC3_B = new THREE.Vector3();
const __TMP_VEC3_C = new THREE.Vector3();
const __TMP_QUAT_A = new THREE.Quaternion();

// MuJoCo uses `mju_round` (half away from zero), which differs from
// `Math.round` for negative half-values.
function mjuRound(value) {
  const v = Number(value);
  if (!Number.isFinite(v)) return 0;
  return v >= 0 ? Math.floor(v + 0.5) : Math.ceil(v - 0.5);
}

// MuJoCo constant from mjmodel.h; used by engine_vis_visualize.c when
// re-centering infinite planes.
const MJ_MAXPLANEGRID = 11;
const LABEL_DPR_CAP = 2;
const LABEL_GEOM_LIMIT = 120;
const DEFAULT_CLEAR_HEX = 0xd6dce4;
const DEFAULT_CLEAR_COLOR = new THREE.Color(DEFAULT_CLEAR_HEX);
const GROUND_DISTANCE = 2000;
const PLANE_SIZE_EPS = 1e-9;
const RENDER_ORDER = Object.freeze({
  GROUND: -50,
});
const TRANSPARENT_BIN_CAM_POS = new THREE.Vector3();
const TRANSPARENT_BIN_CAM_DIR = new THREE.Vector3();

function depthFromSoAPos(posView, posBase, rootElements, camX, camY, camZ, dirX, dirY, dirZ) {
  const lx = posView[posBase + 0] || 0;
  const ly = posView[posBase + 1] || 0;
  const lz = posView[posBase + 2] || 0;
  let wx = lx;
  let wy = ly;
  let wz = lz;
  if (rootElements) {
    wx = rootElements[0] * lx + rootElements[4] * ly + rootElements[8] * lz + rootElements[12];
    wy = rootElements[1] * lx + rootElements[5] * ly + rootElements[9] * lz + rootElements[13];
    wz = rootElements[2] * lx + rootElements[6] * ly + rootElements[10] * lz + rootElements[14];
  }
  const dx = wx - camX;
  const dy = wy - camY;
  const dz = wz - camZ;
  return dx * dirX + dy * dirY + dz * dirZ;
}

function transparentDepthNorm01(depth, depthMin, depthInvSpan) {
  const depthNorm = depthInvSpan > 1e-12 ? ((depth - depthMin) * depthInvSpan) : 0;
  return Math.max(0, Math.min(1, depthNorm));
}

function transparentBinFromDepthNorm(depthNorm, transparentBins) {
  const bins = transparentBins | 0;
  if (bins <= 1) return 0;
  const k = Math.floor(depthNorm * transparentBins);
  return Math.max(0, Math.min(bins - 1, k | 0));
}

function getWorldScene(ctx, override = null) {
  if (override) return override;
  if (ctx?.sceneWorld) return ctx.sceneWorld;
  if (ctx?.scene) return ctx.scene;
  return null;
}

function renderWorldScene(ctx, renderer, options = {}) {
  if (!ctx || !renderer) return;
  const camera = options.camera || ctx.camera;
  const worldScene = getWorldScene(ctx, options.sceneWorld);
  if (!camera || !worldScene) return;
  const target = options.target ?? null;
  if (typeof renderer.setRenderTarget === 'function') {
    renderer.setRenderTarget(target);
  }
  if (options.clearColor !== undefined) {
    const alpha = options.clearAlpha ?? 1;
    renderer.setClearColor(options.clearColor, alpha);
  }
  renderer.clear(true, true, false);
  renderer.render(worldScene, camera);
  if (target) {
    renderer.setRenderTarget(null);
  }
}

function createGeomNameLookup(sourceList) {
  const lookup = new Map();
  if (!Array.isArray(sourceList)) return lookup;
  for (const entry of sourceList) {
    const idx = Number(entry?.index);
    if (!Number.isFinite(idx)) continue;
    const label = typeof entry?.name === 'string' ? entry.name.trim() : '';
    lookup.set(idx, label || `Geom ${idx}`);
  }
  return lookup;
}

function getOrCreateGeomNameLookup(ctx, sourceList) {
  if (!ctx) return createGeomNameLookup(sourceList);
  const nextSource = sourceList || null;
  let lookup = ctx._geomNameLookup || null;
  if (ctx._geomNameLookupSource !== nextSource || !lookup) {
    lookup = createGeomNameLookup(nextSource);
    ctx._geomNameLookup = lookup;
    ctx._geomNameLookupSource = nextSource;
  }
  return lookup;
}

function geomNameFromLookup(lookup, index) {
  return lookup?.get(index) ?? `Geom ${index}`;
}

function isInfinitePlaneSize(sizeVec) {
  if (!Array.isArray(sizeVec) || sizeVec.length < 2) return false;
  const sx = Math.abs(Number(sizeVec[0]) || 0);
  const sy = Math.abs(Number(sizeVec[1]) || 0);
  return sx <= PLANE_SIZE_EPS || sy <= PLANE_SIZE_EPS;
}

function applyGeomMetadata(mesh, meta) {
  if (!mesh || !meta) return;
  const userData = mesh.userData || (mesh.userData = {});
  if (meta.index != null) {
    userData.geomIndex = meta.index;
  }
  if (meta.type != null) {
    userData.geomType = meta.type;
  }
  if (meta.dataId != null) {
    userData.geomDataId = meta.dataId;
  }
  if (meta.size) {
    const src = meta.size;
    let geomSize = userData.geomSize;
    if (!Array.isArray(geomSize) || geomSize.length < 3) {
      geomSize = [0, 0, 0];
      userData.geomSize = geomSize;
    }
    geomSize[0] = Number(src[0]) || 0;
    geomSize[1] = Number(src[1]) || 0;
    geomSize[2] = Number(src[2]) || 0;
  }
  if (meta.grid != null) {
    userData.geomGrid = meta.grid;
  }
  if (meta.name) {
    userData.geomName = meta.name;
    mesh.name = meta.name;
  }
  if (meta.bodyId != null) {
    userData.geomBodyId = meta.bodyId;
  }
  if (meta.groupId != null) {
    userData.geomGroupId = meta.groupId;
    userData.geomGroup = meta.groupId;
  }
  if (meta.matId != null) {
    userData.geomMatId = meta.matId;
    userData.matId = meta.matId;
  }
  if (meta.rgba) {
    const src = meta.rgba;
    let geomRgba = userData.geomRgba;
    if (!Array.isArray(geomRgba) || geomRgba.length < 4) {
      geomRgba = [0, 0, 0, 1];
      userData.geomRgba = geomRgba;
    }
    geomRgba[0] = Number(src[0]) || 0;
    geomRgba[1] = Number(src[1]) || 0;
    geomRgba[2] = Number(src[2]) || 0;
    geomRgba[3] = Number(src[3]) || 0;
  }
  const md = userData.geomMetadata || (userData.geomMetadata = {});
  md.index = meta.index;
  md.type = meta.type;
  md.name = meta.name;
  md.bodyId = meta.bodyId;
  md.matId = meta.matId;
  md.dataId = meta.dataId;
  md.size = userData.geomSize || meta.size || null;
  md.grid = meta.grid;
  md.groupId = meta.groupId;
  md.rgba = userData.geomRgba || meta.rgba || null;
}

function applySkyboxVisibility(ctx, enabled, options = {}) {
  if (!ctx) return;
  const worldScene = getWorldScene(ctx);
  if (!worldScene) return;
  const useBlackBackground = options.useBlackOnDisable !== false;
  const baseClear = typeof ctx.baseClearHex === 'number' ? ctx.baseClearHex : DEFAULT_CLEAR_HEX;
  const setSolidBackground = (hex) => {
    let bgColor = ctx._solidBackgroundColor || null;
    if (!bgColor) {
      bgColor = new THREE.Color(hex);
      ctx._solidBackgroundColor = bgColor;
    } else {
      bgColor.setHex(hex);
    }
    worldScene.background = bgColor;
  };
  const skyEnabled = enabled !== false;
  if (!skyEnabled) {
    if (ctx.skyShader) ctx.skyShader.visible = false;
    worldScene.environment = null;
    setSolidBackground(useBlackBackground ? 0x000000 : baseClear);
    pushSkyDebug(ctx, { mode: 'disable', useBlack: useBlackBackground });
    return;
  }
  ctx.envDirty = true;
  if (ctx.envFromHDRI && ctx.envRT && ctx.envRT.texture) {
    worldScene.environment = ctx.envRT.texture;
    if (ctx.hdriBackground) {
      worldScene.background = ctx.hdriBackground;
    }
    if (ctx.skyShader) ctx.skyShader.visible = false;
    pushSkyDebug(ctx, { mode: 'hdri', envRT: !!ctx.envRT, background: !!ctx.hdriBackground });
    return;
  }
  if (ctx.skyMode === 'shader' && ctx.skyShader) {
    ctx.skyShader.visible = true;
    worldScene.background = ctx.skyBackground || null;
    pushSkyDebug(ctx, { mode: 'sky-dome', skyVisible: true, background: !!ctx.skyBackground });
    return;
  }
  if (ctx.skyMode === 'cube') {
    worldScene.background = ctx.skyBackground || ctx.skyCube || null;
    if (ctx.skyShader) ctx.skyShader.visible = false;
    pushSkyDebug(ctx, { mode: 'sky-cube', background: !!worldScene.background });
    return;
  }
  // If no sky resources exist, match MuJoCo model-mode behavior: when there is
  // no skybox texture, sky rendering is skipped and the clear color shows
  // through (no explicit background).
  worldScene.environment = null;
  if (ctx._skyMode === 'mj-sky') {
    worldScene.background = null;
    if (ctx.skyShader) ctx.skyShader.visible = false;
    pushSkyDebug(ctx, { mode: 'model-none' });
    return;
  }
  // Preset fallback: keep a solid background so the scene is readable even if
  // HDRI/sky resources are unavailable.
  setSolidBackground(baseClear);
  pushSkyDebug(ctx, { mode: 'fallback' });
}

function setQuatFromMat3(out, m00, m01, m02, m10, m11, m12, m20, m21, m22) {
  if (!out || typeof out.set !== 'function') return;
  const t = m00 + m11 + m22;
  let w = 1;
  let x = 0;
  let y = 0;
  let z = 0;
  if (t > 0) {
    const s = Math.sqrt(t + 1.0) * 2;
    w = 0.25 * s;
    x = (m21 - m12) / s;
    y = (m02 - m20) / s;
    z = (m10 - m01) / s;
  } else if (m00 > m11 && m00 > m22) {
    const s = Math.sqrt(1.0 + m00 - m11 - m22) * 2;
    w = (m21 - m12) / s;
    x = 0.25 * s;
    y = (m01 + m10) / s;
    z = (m02 + m20) / s;
  } else if (m11 > m22) {
    const s = Math.sqrt(1.0 + m11 - m00 - m22) * 2;
    w = (m02 - m20) / s;
    x = (m01 + m10) / s;
    y = 0.25 * s;
    z = (m12 + m21) / s;
  } else {
    const s = Math.sqrt(1.0 + m22 - m00 - m11) * 2;
    w = (m10 - m01) / s;
    x = (m02 + m20) / s;
    y = (m12 + m21) / s;
    z = 0.25 * s;
  }
  out.set(x, y, z, w);
}

function computeGeomRadius(type, sx, sy, sz) {
  const s1 = Math.abs(sx) || 0;
  const s2 = Math.abs(sy) || 0;
  const s3 = Math.abs(sz) || 0;
  switch (type) {
    case MJ_GEOM.SPHERE:
    case MJ_GEOM.ELLIPSOID:
      return Math.max(s1, s2, s3, 1e-3);
    case MJ_GEOM.CAPSULE:
      return Math.max(s1 + s2, 1e-3);
    case MJ_GEOM.CYLINDER:
      return Math.max(Math.sqrt(s1 * s1 + s2 * s2), 1e-3);
    case MJ_GEOM.BOX:
      return Math.max(Math.sqrt(s1 * s1 + s2 * s2 + s3 * s3), 1e-3);
    case MJ_GEOM.PLANE:
    case MJ_GEOM.HFIELD:
      return Math.max(s1, s2, 5);
    default:
      return Math.max(Math.sqrt(s1 * s1 + s2 * s2 + s3 * s3), 0.15);
  }
}

function clampUnit(value) {
  if (!Number.isFinite(value)) return 0;
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

function parseVectorLike(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    const tokens = value
      .trim()
      .split(/[\s,]+/)
      .map((token) => Number(token))
      .filter((num) => Number.isFinite(num));
    return tokens.length ? tokens : null;
  }
  if (value && typeof value === 'object') {
    try {
      const arr = Array.from(value, (v) => Number(v));
      return arr.every((n) => Number.isFinite(n)) ? arr : null;
    } catch (err) {
      strictCatch(err, 'main:parseVectorLike');
    }
  }
  return null;
}

function rgbFromArray(arr, fallback = [1, 1, 1]) {
  const source = parseVectorLike(arr);
  if (Array.isArray(source) && source.length >= 3) {
    return [
      clampUnit(Number(source[0])),
      clampUnit(Number(source[1])),
      clampUnit(Number(source[2])),
    ];
  }
  return fallback.slice();
}

function applyAppearanceToMaterial(mesh, appearance) {
  if (!mesh || !mesh.material || !appearance) return;
  const mat = mesh.material;
  const r = Number(appearance.r) || 0;
  const g = Number(appearance.g) || 0;
  const b = Number(appearance.b) || 0;
  const a = Number(appearance.a) || 0;
  if (mat.color && typeof mat.color.setRGB === 'function') {
    if ((mat.color.r !== r) || (mat.color.g !== g) || (mat.color.b !== b)) {
      mat.color.setRGB(r, g, b);
    }
  }
  if ('opacity' in mat) {
    const nextOpacity = a;
    const nextTransparent = nextOpacity < 0.999;
    if (mat.opacity !== nextOpacity) mat.opacity = nextOpacity;
    if (mat.transparent !== nextTransparent) mat.transparent = nextTransparent;
  }
  const userData = mesh.userData || (mesh.userData = {});
  if (Number.isFinite(r) && Number.isFinite(g) && Number.isFinite(b) && Number.isFinite(a)) {
    let rgba = userData.geomRgba;
    if (!Array.isArray(rgba) || rgba.length < 4) {
      rgba = [0, 0, 0, 1];
      userData.geomRgba = rgba;
    }
    rgba[0] = r;
    rgba[1] = g;
    rgba[2] = b;
    rgba[3] = a;
    userData.geomOpacity = a;
  }
}

function resolveIndexedRgbaAppearance(index, group, materials) {
  const matIdView = group?.matid || null;
  const matIndex = matIdView && index < matIdView.length ? (matIdView[index] | 0) : -1;
  const matRgbaView = materials?.rgba || null;
  if (matIndex >= 0 && matRgbaView && matRgbaView.length >= (matIndex * 4 + 4)) {
    const base = matIndex * 4;
    return {
      r: clampUnit(Number(matRgbaView[base + 0]) || 0),
      g: clampUnit(Number(matRgbaView[base + 1]) || 0),
      b: clampUnit(Number(matRgbaView[base + 2]) || 0),
      a: clampUnit(Number(matRgbaView[base + 3]) || 0),
    };
  }
  const rgbaView = group?.rgba || null;
  if (matIndex < 0 && rgbaView && rgbaView.length >= (index * 4 + 4)) {
    const base = index * 4;
    return {
      r: clampUnit(Number(rgbaView[base + 0]) || 0),
      g: clampUnit(Number(rgbaView[base + 1]) || 0),
      b: clampUnit(Number(rgbaView[base + 2]) || 0),
      a: clampUnit(Number(rgbaView[base + 3]) || 0),
    };
  }
  return null;
}

function resolveFlexAppearance(index, assets) {
  return resolveIndexedRgbaAppearance(index, assets?.flexes || null, assets?.materials || null);
}

function resolveSkinAppearance(index, assets) {
  return resolveIndexedRgbaAppearance(index, assets?.skins || null, assets?.materials || null);
}

function resolveMaterialTextureDescriptor(matId, assets) {
  const materials = assets?.materials || null;
  const texIdView = materials?.texid || null;
  if (!texIdView || !(matId >= 0) || matId >= texIdView.length) return null;
  const matCount = materials?.count | 0;
  const stride =
    matCount > 0 && texIdView.length >= matCount && texIdView.length % matCount === 0
      ? texIdView.length / matCount
      : 1;
  // Simulate uses mjTEXROLE_RGB (1) as the regular albedo texture source.
  const rolePreferred = stride > 1 ? 1 : 0;
  const idxPreferred = matId * stride + rolePreferred;
  const idxFallback = matId * stride;
  let texid = idxPreferred >= 0 && idxPreferred < texIdView.length ? (texIdView[idxPreferred] | 0) : -1;
  if (texid < 0 && idxFallback >= 0 && idxFallback < texIdView.length) {
    texid = texIdView[idxFallback] | 0;
  }
  if (!(texid >= 0)) return null;
  const repeatView = materials?.texrepeat || null;
  let repeatX = 1;
  let repeatY = 1;
  if (repeatView && repeatView.length >= (matId * 2 + 2)) {
    const rx = Number(repeatView[matId * 2 + 0]);
    const ry = Number(repeatView[matId * 2 + 1]);
    repeatX = Number.isFinite(rx) ? rx : 0;
    repeatY = Number.isFinite(ry) ? ry : 0;
    // MuJoCo XML allows `texrepeat="x"` (single scalar). The unused component is
    // stored as 0 in `mjModel.mat_texrepeat`, but the renderer treats it as
    // "copy the other axis" rather than disabling repetition.
    if (repeatX === 0 && repeatY === 0) {
      repeatX = 1;
      repeatY = 1;
    } else if (repeatX === 0) {
      repeatX = repeatY;
    } else if (repeatY === 0) {
      repeatY = repeatX;
    }
  } else {
    repeatX = 1;
    repeatY = 1;
  }
  const uniformView = materials?.texuniform || null;
  const uniform = !!(uniformView && matId < uniformView.length && uniformView[matId]);
  return { texid, repeatX, repeatY, uniform };
}

function getMuJoCoTextureCache(ctx) {
  if (!ctx) return null;
  ctx.assetCache = ctx.assetCache || {};
  ctx.assetCache.mjTextures = ctx.assetCache.mjTextures || new Map();
  return ctx.assetCache.mjTextures;
}

function createMuJoCoDataTexture(THREE, pixels, width, height, nchannel, colorspace = 0) {
  if (!pixels || !(width > 0) || !(height > 0) || !(nchannel > 0)) return null;
  const src = pixels;
  const ch = nchannel | 0;
  let rgbaPixels = src;
  if (ch !== 4) {
    const count = width * height;
    const out = new Uint8Array(count * 4);
    if (ch === 3) {
      for (let i = 0, j = 0; i < count; i += 1, j += 3) {
        const o = i * 4;
        out[o + 0] = src[j + 0] ?? 0;
        out[o + 1] = src[j + 1] ?? 0;
        out[o + 2] = src[j + 2] ?? 0;
        out[o + 3] = 255;
      }
    } else if (ch === 2) {
      // Interpret as luminance-alpha (r==g==b==L, a==A).
      for (let i = 0, j = 0; i < count; i += 1, j += 2) {
        const o = i * 4;
        const lum = src[j + 0] ?? 0;
        out[o + 0] = lum;
        out[o + 1] = lum;
        out[o + 2] = lum;
        out[o + 3] = src[j + 1] ?? 255;
      }
    } else if (ch === 1) {
      for (let i = 0; i < count; i += 1) {
        const o = i * 4;
        const lum = src[i] ?? 0;
        out[o + 0] = lum;
        out[o + 1] = lum;
        out[o + 2] = lum;
        out[o + 3] = 255;
      }
    } else {
      for (let i = 0; i < out.length; i += 4) {
        out[i + 3] = 255;
      }
    }
    rgbaPixels = out;
  }

  const tex = new THREE.DataTexture(rgbaPixels, width, height, THREE.RGBAFormat);
  // MuJoCo's GL renderer uses mipmaps for power-of-two textures; without them,
  // high-frequency textures (e.g., playing cards) shimmer heavily when minified.
  // Keep NPOT textures mipmap-free for broader WebGL compatibility.
  const isPow2 = (n) => {
    const v = n | 0;
    return v > 0 && (v & (v - 1)) === 0;
  };
  const canMipmap = isPow2(width) && isPow2(height);
  tex.generateMipmaps = canMipmap;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = canMipmap ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  // MuJoCo's `tex_data` is stored in image row order (top-to-bottom), but MuJoCo
  // mesh texcoords are already V-flipped (v = 1 - v) relative to OBJ/PNG image
  // conventions. Keep `flipY=false` to avoid double-flipping and match simulate.
  tex.flipY = false;
  tex.unpackAlignment = 1;
  // Follow MuJoCo's resolved m->tex_colorspace: only promote to sRGB when the
  // model requests it (mjCOLORSPACE_SRGB = 2). AUTO/LINEAR stay linear.
  applyMuJoCoTextureColorspace(THREE, tex, colorspace);
  tex.needsUpdate = true;
  return tex;
}

function applyMuJoCoTextureColorspace(THREE, texture, colorspace = 0) {
  if (!texture) return;
  const isSrgb = (colorspace | 0) === 2;
  if (!isSrgb) return;
  if ('colorSpace' in texture && typeof THREE.SRGBColorSpace === 'string') {
    texture.colorSpace = THREE.SRGBColorSpace;
  } else if ('encoding' in texture && typeof THREE.sRGBEncoding === 'number') {
    texture.encoding = THREE.sRGBEncoding;
  }
}

function createMuJoCoCubeTexture(THREE, pixels, width, height, nchannel, colorspace = 0) {
  if (!pixels || !(width > 0) || !(height > 0) || !(nchannel > 0)) return null;
  const faceHeight = width;
  const faces = [];
  const faceByteStride = width * faceHeight * nchannel;
  if (height === faceHeight && pixels.length >= faceByteStride) {
    const facePixels = pixels.subarray(0, faceByteStride);
    for (let i = 0; i < 6; i += 1) {
      const faceTex = createMuJoCoDataTexture(THREE, facePixels, width, faceHeight, nchannel, colorspace);
      if (!faceTex) return null;
      faceTex.flipY = false;
      faces.push(faceTex);
    }
  } else if (height >= 6 * faceHeight) {
    for (let i = 0; i < 6; i += 1) {
      const start = i * faceByteStride;
      const end = start + faceByteStride;
      if (end > pixels.length) return null;
      const facePixels = pixels.subarray(start, end);
      const faceTex = createMuJoCoDataTexture(THREE, facePixels, width, faceHeight, nchannel, colorspace);
      if (!faceTex) return null;
      faceTex.flipY = false;
      faces.push(faceTex);
    }
  } else {
    return null;
  }
  const cube = new THREE.CubeTexture(faces);
  cube.generateMipmaps = false;
  cube.magFilter = THREE.LinearFilter;
  cube.minFilter = THREE.LinearFilter;
  cube.wrapS = THREE.ClampToEdgeWrapping;
  cube.wrapT = THREE.ClampToEdgeWrapping;
  cube.flipY = false;
  cube.unpackAlignment = 1;
  applyMuJoCoTextureColorspace(THREE, cube, colorspace);
  cube.needsUpdate = true;
  return cube;
}

function getOrCreateMuJoCoTexture(ctx, assets, descriptor) {
  if (!ctx || !assets || !descriptor) return null;
  const cache = getMuJoCoTextureCache(ctx);
  if (!cache) return null;
  const texid = descriptor.texid | 0;
  const key = `2d:${texid}`;
  if (cache.has(key)) return cache.get(key) || null;

  const texAssets = assets?.textures || null;
  const typeView = texAssets?.type || null;
  const widthView = texAssets?.width || null;
  const heightView = texAssets?.height || null;
  const nchannelView = texAssets?.nchannel || null;
  const adrView = texAssets?.adr || null;
  const colorspaceView = texAssets?.colorspace || null;
  const data = texAssets?.data || null;
  if (!widthView || !heightView || !nchannelView || !adrView || !data) return null;
  if (texid < 0 || texid >= widthView.length || texid >= heightView.length || texid >= nchannelView.length || texid >= adrView.length) {
    return null;
  }
  const texType = typeView && texid < typeView.length ? (typeView[texid] | 0) : 0;
  const baseWidth = widthView[texid] | 0;
  const baseHeight = heightView[texid] | 0;
  const width = baseWidth;
  // MuJoCo stores cube textures either as a single square face (height==width)
  // or as 6 faces packed back-to-back (often height==6*width). For now we take
  // the first face so textured materials at least render deterministically.
  const height = texType === 0 ? baseHeight : baseWidth;
  const nchannel = nchannelView[texid] | 0;
  const adr = adrView[texid] | 0;
  if (!(width > 0) || !(height > 0) || !(nchannel > 0) || !(adr >= 0)) return null;
  const byteLen = width * height * nchannel;
  const end = adr + byteLen;
  if (end > data.length) return null;

  const pixels = data.subarray(adr, end);
  const colorspace = colorspaceView && texid < colorspaceView.length ? (colorspaceView[texid] | 0) : 0;
  const texture = createMuJoCoDataTexture(THREE, pixels, width, height, nchannel, colorspace);
  if (!texture) return null;
  texture.repeat.set(1, 1);
  // WebGL tends to show stronger minification shimmer on oblique surfaces than
  // MuJoCo's desktop GL viewer. Use a conservative anisotropy setting to reduce
  // directional aliasing without introducing any new mapping logic.
  if (texture.generateMipmaps && ctx?.renderer?.capabilities?.getMaxAnisotropy) {
    const max = ctx.renderer.capabilities.getMaxAnisotropy() | 0;
    // Cap for perf predictability: cards.xml loads many 512x512 textures.
    const target = Math.max(1, Math.min(max > 0 ? max : 1, 8));
    if ('anisotropy' in texture) texture.anisotropy = target;
  }
  cache.set(key, texture);
  return texture;
}

function getOrCreateMuJoCoCubeTexture(ctx, assets, descriptor) {
  if (!ctx || !assets || !descriptor) return null;
  const cache = getMuJoCoTextureCache(ctx);
  if (!cache) return null;
  const texid = descriptor.texid | 0;
  const key = `cube:${texid}`;
  if (cache.has(key)) return cache.get(key) || null;

  const texAssets = assets?.textures || null;
  const widthView = texAssets?.width || null;
  const heightView = texAssets?.height || null;
  const nchannelView = texAssets?.nchannel || null;
  const adrView = texAssets?.adr || null;
  const colorspaceView = texAssets?.colorspace || null;
  const data = texAssets?.data || null;
  if (!widthView || !heightView || !nchannelView || !adrView || !data) return null;
  if (texid < 0 || texid >= widthView.length || texid >= heightView.length || texid >= nchannelView.length || texid >= adrView.length) {
    return null;
  }
  const width = widthView[texid] | 0;
  const height = heightView[texid] | 0;
  const nchannel = nchannelView[texid] | 0;
  const adr = adrView[texid] | 0;
  if (!(width > 0) || !(height > 0) || !(nchannel > 0) || !(adr >= 0)) return null;
  const byteLen = width * height * nchannel;
  const end = adr + byteLen;
  if (end > data.length) return null;
  const pixels = data.subarray(adr, end);
  const colorspace = colorspaceView && texid < colorspaceView.length ? (colorspaceView[texid] | 0) : 0;
  const cube = createMuJoCoCubeTexture(THREE, pixels, width, height, nchannel, colorspace);
  if (!cube) return null;
  cache.set(key, cube);
  return cube;
}

const MJ_MINVAL = 1e-12;
const MJ_TEXTURE = {
  TEX2D: 0,
};

function resolveMuJoCoTextureType(assets, texid) {
  const typeView = assets?.textures?.type || null;
  if (!typeView || !(texid >= 0) || texid >= typeView.length) return -1;
  return typeView[texid] | 0;
}

const TMP_TEX_SCALE3 = { scaleX: 1, scaleY: 1, scaleZ: 1 };
function quantize1e6(value) {
  const v = Number(value);
  if (!Number.isFinite(v)) return 0;
  return Math.round(v * 1e6);
}

function quantize1e3(value) {
  const v = Number(value);
  if (!Number.isFinite(v)) return 0;
  return Math.round(v * 1e3);
}

function resolveMuJoCoTexcoordScale3(geomType, geomSize, out = null) {
  const sx = Math.abs(Number(geomSize?.[0]) || 0);
  const sy = Math.abs(Number(geomSize?.[1]) || 0);
  const sz = Math.abs(Number(geomSize?.[2]) || 0);
  const scaleX = Math.max(MJ_MINVAL, sx);
  const scaleY = Math.max(MJ_MINVAL, sy);
  const scaleZ = Math.max(MJ_MINVAL, sz);
  if (out && typeof out === 'object') {
    out.scaleX = scaleX;
    out.scaleY = scaleY;
    out.scaleZ = scaleZ;
    return out;
  }
  switch (geomType | 0) {
    case MJ_GEOM.PLANE:
    case MJ_GEOM.HFIELD:
    case MJ_GEOM.BOX:
    case MJ_GEOM.SPHERE:
    case MJ_GEOM.ELLIPSOID:
    case MJ_GEOM.CYLINDER:
    case MJ_GEOM.CAPSULE:
      return { scaleX, scaleY, scaleZ };
    default:
      return { scaleX, scaleY, scaleZ };
  }
}

function ensureMuJoCo2DGeneratedTexcoords(mesh, geomType, geomSize, geomDataId, matId, descriptor) {
  if (!mesh || !mesh.geometry) return 0;
  let geometry = mesh.geometry;
  let positionAttr = geometry.getAttribute?.('position') || null;
  if (!positionAttr || !(positionAttr.count > 0)) return 0;

  const repeatX = Number.isFinite(descriptor?.repeatX) ? descriptor.repeatX : 1;
  const repeatY = Number.isFinite(descriptor?.repeatY) ? descriptor.repeatY : 1;
  const uniform = !!descriptor?.uniform;
  const size0 = Number(geomSize?.[0]) || 0;
  const size1 = Number(geomSize?.[1]) || 0;

  let scl0 = repeatX;
  let scl1 = repeatY;
  const did = geomDataId | 0;
  if (did >= 0) {
    if (size0 > 0) {
      scl0 /= Math.max(MJ_MINVAL, size0);
    }
    if (size1 > 0) {
      scl1 /= Math.max(MJ_MINVAL, size1);
    }
  }
  if (uniform) {
    if (size0 > 0) {
      scl0 *= size0;
    }
    if (size1 > 0) {
      scl1 *= size1;
    }
  }

  resolveMuJoCoTexcoordScale3(geomType, geomSize, TMP_TEX_SCALE3);
  const scaleX = TMP_TEX_SCALE3.scaleX;
  const scaleY = TMP_TEX_SCALE3.scaleY;
  // MuJoCo render_gl3.c uses `geom->dataid >= 0` to detect pre-scaled displaylists
  // (e.g. planes/meshes). Match that by using raw vertex coordinates for those
  // geoms and normalized coordinates (divide by geom size) for others.
  const prescaled = did >= 0;
  const invScaleX = prescaled ? 1 : (1 / scaleX);
  const invScaleY = prescaled ? 1 : (1 / scaleY);
  const vcount = positionAttr.count | 0;
  const matKey = matId | 0;
  const geomTypeKey = geomType | 0;
  const qScl0 = quantize1e6(scl0);
  const qScl1 = quantize1e6(scl1);
  const qScaleX = quantize1e6(scaleX);
  const qScaleY = quantize1e6(scaleY);

  const userData = mesh.userData || (mesh.userData = {});
  if (
    userData.mj2dMatId === matKey &&
    userData.mj2dGeomType === geomTypeKey &&
    userData.mj2dDataId === did &&
    userData.mj2dVcount === vcount &&
    userData.mj2dScl0Q === qScl0 &&
    userData.mj2dScl1Q === qScl1 &&
    userData.mj2dScaleXQ === qScaleX &&
    userData.mj2dScaleYQ === qScaleY
  ) {
    return 1;
  }
  userData.mj2dMatId = matKey;
  userData.mj2dGeomType = geomTypeKey;
  userData.mj2dDataId = did;
  userData.mj2dVcount = vcount;
  userData.mj2dScl0Q = qScl0;
  userData.mj2dScl1Q = qScl1;
  userData.mj2dScaleXQ = qScaleX;
  userData.mj2dScaleYQ = qScaleY;
  if ('mj2dTexcoordKey' in userData) userData.mj2dTexcoordKey = null;

  if (userData.ownGeometry === false) {
    const cloned = geometry.clone();
    mesh.geometry = cloned;
    userData.ownGeometry = true;
    geometry = cloned;
    positionAttr = geometry.getAttribute?.('position') || null;
    if (!positionAttr || !(positionAttr.count > 0)) return 0;
  }

  let uvAttr = geometry.getAttribute?.('uv') || null;
  let uv = uvAttr?.array instanceof Float32Array ? uvAttr.array : null;
  if (!uv || uv.length !== vcount * 2) {
    uv = new Float32Array(vcount * 2);
    uvAttr = new THREE.BufferAttribute(uv, 2);
    geometry.setAttribute('uv', uvAttr);
  }
  const posArray = positionAttr?.array || null;
  const stride = positionAttr?.itemSize | 0;
  if (posArray && stride >= 2 && !positionAttr.isInterleavedBufferAttribute) {
    for (let i = 0, p = 0, u = 0; i < vcount; i += 1, p += stride, u += 2) {
      const x0 = (posArray[p + 0] || 0) * invScaleX;
      const y0 = (posArray[p + 1] || 0) * invScaleY;
      uv[u + 0] = 0.5 * scl0 * x0 - 0.5;
      uv[u + 1] = -0.5 * scl1 * y0 - 0.5;
    }
  } else {
    for (let i = 0; i < vcount; i += 1) {
      const x0 = (positionAttr.getX(i) || 0) * invScaleX;
      const y0 = (positionAttr.getY(i) || 0) * invScaleY;
      uv[i * 2 + 0] = 0.5 * scl0 * x0 - 0.5;
      uv[i * 2 + 1] = -0.5 * scl1 * y0 - 0.5;
    }
  }
  if (uvAttr) uvAttr.needsUpdate = true;
  strictEnsure('ensureMuJoCo2DGeneratedTexcoords', {
    reason: 'generated_texcoords',
    geomType: geomType | 0,
    geomDataId: geomDataId | 0,
    matId: matId | 0,
    vcount,
  });
  return 2;
}

function ensureMuJoCoCubeAlbedoHooks(material) {
  if (!material) return;
  material.userData = material.userData || {};
  if (material.userData.mjCubeAlbedoHooks) return;
  const previous = typeof material.onBeforeCompile === 'function' ? material.onBeforeCompile : null;
  material.onBeforeCompile = (shader, renderer) => {
    if (previous) previous(shader, renderer);
    shader.uniforms.mjCubeMap = { value: null };
    shader.uniforms.mjCubeScale = { value: new THREE.Vector3(1, 1, 1) };
    shader.uniforms.mjCubeEnabled = { value: 0 };
    material.userData.mjCubeShader = shader;

    if (!shader.vertexShader.includes('varying vec3 vMjObjPos')) {
      shader.vertexShader = `varying vec3 vMjObjPos;\n${shader.vertexShader}`;
      shader.vertexShader = shader.vertexShader.replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\n      vMjObjPos = transformed;'
      );
    }
    if (!shader.fragmentShader.includes('uniform samplerCube mjCubeMap')) {
      shader.fragmentShader = `uniform samplerCube mjCubeMap;\nuniform vec3 mjCubeScale;\nuniform float mjCubeEnabled;\nvarying vec3 vMjObjPos;\n${shader.fragmentShader}`;
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <map_fragment>',
        `#include <map_fragment>

      if (mjCubeEnabled > 0.5) {
        vec3 dir = normalize(vMjObjPos * mjCubeScale);
        vec4 cubeColor = textureCube(mjCubeMap, dir);
        diffuseColor *= cubeColor;
      }`
      );
    }
  };
  material.userData.mjCubeAlbedoHooks = true;
  material.needsUpdate = true;
  strictEnsure('ensureMuJoCoCubeAlbedoHooks', {
    reason: 'install_hooks',
    materialType: material.type || null,
  });
}

function applyMuJoCoCubeAlbedo(mesh, cubeTexture, scaleVec3, enabled) {
  if (!mesh || !mesh.material) return;
  const material = mesh.material;
  if (!enabled) {
    const shader = material.userData?.mjCubeShader;
    if (shader?.uniforms?.mjCubeEnabled) {
      shader.uniforms.mjCubeEnabled.value = 0;
    }
    material.userData.mjCubeEnabled = 0;
    return;
  }
  ensureMuJoCoCubeAlbedoHooks(material);
  material.userData.mjCubeEnabled = 1;
  material.userData.mjCubeTexture = cubeTexture;
  material.userData.mjCubeScale = scaleVec3;
  const shader = material.userData.mjCubeShader;
  if (shader?.uniforms?.mjCubeEnabled) shader.uniforms.mjCubeEnabled.value = 1;
  if (shader?.uniforms?.mjCubeMap) shader.uniforms.mjCubeMap.value = cubeTexture;
  if (shader?.uniforms?.mjCubeScale && scaleVec3) shader.uniforms.mjCubeScale.value.copy(scaleVec3);
}

function applyMuJoCoTextureToMesh(mesh, matId, ctx, assets, textureEnabled, options = {}) {
  if (!mesh || !mesh.material || !ctx) return;
  const material = mesh.material;
  if (!('map' in material)) return;
  const perfOut = options?.perfOut || null;
  const isInfinitePlane = !!mesh.userData?.infinitePlane;
  if (isInfinitePlane) {
    const uniforms =
      mesh.userData?.infiniteGround?.uniforms ||
      material.userData?.infiniteUniforms ||
      null;
    if (material.map) {
      material.map = null;
      material.needsUpdate = true;
      if (perfOut) perfOut.texMapChanged = (perfOut.texMapChanged | 0) + 1;
    }
    if (!uniforms) return;
    if (!uniforms.uMuJoCoTexEnabled) uniforms.uMuJoCoTexEnabled = { value: 0 };
    if (!uniforms.uMuJoCoMap) uniforms.uMuJoCoMap = { value: null };
    if (!uniforms.uMuJoCoTexScl) uniforms.uMuJoCoTexScl = { value: new THREE.Vector2(1, 1) };

    if (!textureEnabled || !(matId >= 0) || !assets) {
      uniforms.uMuJoCoTexEnabled.value = 0;
      uniforms.uMuJoCoMap.value = null;
      return;
    }

    const desc = resolveMaterialTextureDescriptor(matId, assets);
    const texType = desc ? resolveMuJoCoTextureType(assets, desc.texid) : -1;
    const isCube = texType !== -1 && texType !== MJ_TEXTURE.TEX2D;
    const texture = desc && !isCube ? getOrCreateMuJoCoTexture(ctx, assets, desc) : null;
    if (!texture) {
      uniforms.uMuJoCoTexEnabled.value = 0;
      uniforms.uMuJoCoMap.value = null;
      return;
    }

    const repeatX = Number.isFinite(desc?.repeatX) ? desc.repeatX : 1;
    const repeatY = Number.isFinite(desc?.repeatY) ? desc.repeatY : 1;
    const scl = uniforms.uMuJoCoTexScl.value;
    if (scl?.set) {
      scl.set(repeatX, repeatY);
    }
    uniforms.uMuJoCoMap.value = texture;
    uniforms.uMuJoCoTexEnabled.value = 1;
    return;
  }
  if (!textureEnabled || !(matId >= 0)) {
    if (material.map) {
      material.map = null;
      material.needsUpdate = true;
      if (perfOut) perfOut.texMapChanged = (perfOut.texMapChanged | 0) + 1;
    }
    return;
  }
  if (!assets) {
    if (material.map) {
      material.map = null;
      material.needsUpdate = true;
      if (perfOut) perfOut.texMapChanged = (perfOut.texMapChanged | 0) + 1;
    }
    return;
  }
  const desc = resolveMaterialTextureDescriptor(matId, assets);
  const texType = desc ? resolveMuJoCoTextureType(assets, desc.texid) : -1;
  const isCube = texType !== -1 && texType !== MJ_TEXTURE.TEX2D;
  const texture = desc && !isCube ? getOrCreateMuJoCoTexture(ctx, assets, desc) : null;
  const nextMap = texture || null;
  if (material.map !== nextMap) {
    material.map = nextMap;
    material.needsUpdate = true;
    if (perfOut) perfOut.texMapChanged = (perfOut.texMapChanged | 0) + 1;
  }

  if (!desc) return;
  const texcoordMode = options?.texcoordMode || 'explicit';
  if (texType === MJ_TEXTURE.TEX2D && texcoordMode === 'generated') {
    const geomType = options?.geomType ?? (mesh.userData?.geomType ?? MJ_GEOM.BOX);
    const geomSize = options?.geomSize ?? (mesh.userData?.geomSize ?? null);
    const geomDataId = options?.geomDataId ?? (mesh.userData?.geomDataId ?? -1);
    if (Array.isArray(geomSize) && geomSize.length >= 2) {
      const uvStatus = ensureMuJoCo2DGeneratedTexcoords(mesh, geomType, geomSize, geomDataId, matId, desc);
      if (perfOut) {
        perfOut.texUvCalls = (perfOut.texUvCalls | 0) + 1;
        if (uvStatus === 1) perfOut.texUvCacheHit = (perfOut.texUvCacheHit | 0) + 1;
        else if (uvStatus === 2) perfOut.texUvRecompute = (perfOut.texUvRecompute | 0) + 1;
        else perfOut.texUvSkip = (perfOut.texUvSkip | 0) + 1;
      }
    }
  }

  if (!isCube) {
    applyMuJoCoCubeAlbedo(mesh, null, null, false);
    return;
  }
  const cube = getOrCreateMuJoCoCubeTexture(ctx, assets, desc);
  if (!cube) {
    applyMuJoCoCubeAlbedo(mesh, null, null, false);
    return;
  }
  const geomType = options?.geomType ?? (mesh.userData?.geomType ?? MJ_GEOM.BOX);
  const geomSize = options?.geomSize ?? (mesh.userData?.geomSize ?? null);
  resolveMuJoCoTexcoordScale3(geomType, geomSize, TMP_TEX_SCALE3);
  const scaleX = TMP_TEX_SCALE3.scaleX;
  const scaleY = TMP_TEX_SCALE3.scaleY;
  const scaleZ = TMP_TEX_SCALE3.scaleZ;
  const uniform = !!desc.uniform;
  const size0 = Number(geomSize?.[0]) || 0;
  const size1 = Number(geomSize?.[1]) || 0;
  const size2 = Number(geomSize?.[2]) || 0;
  const factorX = uniform ? size0 : 1;
  const factorY = uniform ? size1 : 1;
  const factorZ = uniform ? size2 : 1;
  const meshUserData = mesh.userData || (mesh.userData = {});
  const matKey = matId | 0;
  const uniformKey = uniform ? 1 : 0;
  const qFactorX = quantize1e6(factorX);
  const qFactorY = quantize1e6(factorY);
  const qFactorZ = quantize1e6(factorZ);
  const qScaleX = quantize1e6(scaleX);
  const qScaleY = quantize1e6(scaleY);
  const qScaleZ = quantize1e6(scaleZ);
  let scaleVec = meshUserData.mjCubeScaleVec;
  if (!scaleVec) {
    scaleVec = new THREE.Vector3(1, 1, 1);
    meshUserData.mjCubeScaleVec = scaleVec;
    meshUserData.mjCubeMatId = null;
    meshUserData.mjCubeUniform = null;
  }
  if (
    meshUserData.mjCubeMatId !== matKey ||
    meshUserData.mjCubeUniform !== uniformKey ||
    meshUserData.mjCubeFactorXQ !== qFactorX ||
    meshUserData.mjCubeFactorYQ !== qFactorY ||
    meshUserData.mjCubeFactorZQ !== qFactorZ ||
    meshUserData.mjCubeScaleXQ !== qScaleX ||
    meshUserData.mjCubeScaleYQ !== qScaleY ||
    meshUserData.mjCubeScaleZQ !== qScaleZ
  ) {
    scaleVec.set(factorX / scaleX, factorY / scaleY, factorZ / scaleZ);
    meshUserData.mjCubeMatId = matKey;
    meshUserData.mjCubeUniform = uniformKey;
    meshUserData.mjCubeFactorXQ = qFactorX;
    meshUserData.mjCubeFactorYQ = qFactorY;
    meshUserData.mjCubeFactorZQ = qFactorZ;
    meshUserData.mjCubeScaleXQ = qScaleX;
    meshUserData.mjCubeScaleYQ = qScaleY;
    meshUserData.mjCubeScaleZQ = qScaleZ;
    if ('mjCubeScaleKey' in meshUserData) meshUserData.mjCubeScaleKey = null;
  }
  applyMuJoCoCubeAlbedo(mesh, cube, scaleVec, true);
}

function computeSceneExtent(bounds, statStruct) {
  const fromBounds = Number(bounds?.radius);
  const fromStat = Number(statStruct?.extent);
  if (Number.isFinite(fromBounds) && fromBounds > 0) return fromBounds;
  if (Number.isFinite(fromStat) && fromStat > 0) return fromStat;
  return 1;
}

function resolveFogConfig(vis, statStruct, bounds, enabled, ctx = null) {
  if (!enabled || !vis?.map) {
    return { enabled: false };
  }
  const start = Number(vis.map.fogstart);
  const end = Number(vis.map.fogend);
  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    return { enabled: false };
  }
  const extent = computeSceneExtent(bounds, statStruct);
  const fogStart = Math.max(0, start) * extent;
  const fogEnd = Math.max(fogStart + 0.1, end * extent);
  // Fog colour:
  // - primary source: model vis.rgba.fog (if present)
  // - otherwise: viewer/preset fallback decides, see render loop.
  let fogColor = null;
  if (vis?.rgba?.fog != null) {
    const colorArr = rgbFromArray(vis.rgba.fog);
    if (ctx) {
      fogColor = ctx._fogColor || (ctx._fogColor = new THREE.Color());
      fogColor.setRGB(colorArr[0], colorArr[1], colorArr[2]);
    } else {
      fogColor = new THREE.Color().setRGB(colorArr[0], colorArr[1], colorArr[2]);
    }
  }
  return {
    enabled: true,
    start: fogStart,
    end: fogEnd,
    color: fogColor,
    bgStrength: 0.65,
  };
}

function resolveHazeConfig(vis, statStruct, bounds, enabled) {
  if (!enabled || !vis) {
    return { enabled: false };
  }
  const map = vis.map || {};
  const hazeAmount = Number(map.haze);
  if (!Number.isFinite(hazeAmount) || hazeAmount <= 0) {
    return { enabled: false };
  }
  // Interpret map.haze as a generic intensity scalar; radius/region
  // are left to individual consumers (e.g. infinite ground) so they
  // can tie fade to their own geometry.
  const extent = computeSceneExtent(bounds, statStruct);
  const baseScale = Math.max(1e-3, extent);
  const intensity = Math.max(0.0, hazeAmount);
  const pow = 2.5;
  return {
    enabled: true,
    intensity,
    baseScale,
    pow,
  };
}

function applySceneFog(scene, config) {
  if (!scene) return;
  if (!config?.enabled) {
    scene.fog = null;
    return;
  }
  const fogColor = config.color || DEFAULT_CLEAR_COLOR;
  const fogNear = Math.max(0, config.start ?? 10);
  const fogFar = Math.max(fogNear + 0.1, config.end ?? fogNear + 30);
  if (!scene.fog || !scene.fog.isFog) {
    scene.fog = new THREE.Fog(fogColor.getHex(), fogNear, fogFar);
  } else {
    scene.fog.near = fogNear;
    scene.fog.far = fogFar;
    if (scene.fog.color && typeof scene.fog.color.copy === 'function') {
      scene.fog.color.copy(fogColor);
    }
  }
}

function ensureCameraTarget(ctx) {
  if (!ctx) return null;
  if (!ctx.cameraTarget) {
    ctx.cameraTarget = new THREE.Vector3(0, 0, 0);
    strictEnsure('ensureCameraTarget', { reason: 'create' });
  }
  return ctx.cameraTarget;
}

const CAMERA_RAD_PER_DEG = Math.PI / 180;
const CAMERA_DEG_PER_RAD = 180 / Math.PI;

function resolveTrackingBodyId(state) {
  const selectionBody = Number(state?.runtime?.selection?.body);
  if (Number.isFinite(selectionBody) && selectionBody >= 0) return selectionBody | 0;
  const geomIndex = Number(state?.runtime?.trackingGeom);
  const geomBodyIds = state?.model?.geomBodyId;
  if (
    Number.isFinite(geomIndex)
    && geomIndex >= 0
    && ArrayBuffer.isView(geomBodyIds)
    && geomIndex < geomBodyIds.length
  ) {
    const bodyId = geomBodyIds[geomIndex] | 0;
    if (bodyId >= 0) return bodyId;
  }
  return 0;
}

function buildViewerCameraPayload(ctx, state, scratchVec = null) {
  if (!ctx?.camera) return null;
  const target = ensureCameraTarget(ctx);
  if (!target) return null;
  const camera = ctx.camera;
  const forward = scratchVec || new THREE.Vector3();
  forward.copy(target).sub(camera.position);
  const distance = forward.length();
  if (!Number.isFinite(distance) || distance <= 1e-9) return null;
  forward.multiplyScalar(1 / distance);
  const azimuth = Math.atan2(forward.y, forward.x) * CAMERA_DEG_PER_RAD;
  const elevation = Math.asin(Math.max(-1, Math.min(1, forward.z))) * CAMERA_DEG_PER_RAD;
  const payload = {
    lookat: [target.x, target.y, target.z],
    distance,
    azimuth,
    elevation,
    orthographic: !!camera.isOrthographicCamera,
  };
  const mode = Number(state?.runtime?.cameraIndex ?? 0) | 0;
  if (mode === 1) {
    payload.type = 1;
    payload.trackbodyid = resolveTrackingBodyId(state);
  } else if (mode === 0) {
    payload.type = 0;
    payload.trackbodyid = -1;
  }
  return payload;
}

function sendViewerCameraSync(backend, ctx, state, scratchVec = null) {
  if (!ctx || !backend || typeof backend.apply !== 'function') return;
  const payload = buildViewerCameraPayload(ctx, state, scratchVec);
  if (!payload) return;
  ctx.viewerCameraSynced = true;
  ctx.viewerCameraTrackId = Number.isFinite(payload.trackbodyid) ? (payload.trackbodyid | 0) : null;
  backend.apply({
    kind: 'gesture',
    gestureType: 'camera',
    phase: 'sync',
    cam: payload,
  });
}

function ensureFreeCameraPose(ctx) {
  if (!ctx) return null;
  if (!ctx.freeCameraPose) {
    ctx.freeCameraPose = {
      position: new THREE.Vector3(),
      target: new THREE.Vector3(),
      up: new THREE.Vector3(0, 0, 1),
      valid: false,
      autoAligned: false,
    };
    strictEnsure('ensureFreeCameraPose', { reason: 'create' });
  }
  ensureCameraTarget(ctx);
  return ctx.freeCameraPose;
}

function cacheTrackingPoseFromCurrent(ctx, bounds) {
  if (!ctx?.camera) return;
  const target = ensureCameraTarget(ctx);
  if (!ctx.trackingOffset) {
    ctx.trackingOffset = new THREE.Vector3();
  }
  ctx.trackingOffset.copy(ctx.camera.position).sub(target);
  const radiusSource =
    bounds?.radius ??
    ctx.bounds?.radius ??
    ctx.trackingRadius ??
    Math.max(0.6, target.length());
  ctx.trackingRadius = Math.max(0.1, Number(radiusSource) || 0.6);
}

function rememberFreeCameraPose(ctx, bounds) {
  if (!ctx?.camera) return;
  const pose = ensureFreeCameraPose(ctx);
  const target = ensureCameraTarget(ctx);
  pose.position.copy(ctx.camera.position);
  pose.target.copy(target);
  pose.up.copy(ctx.camera.up);
  pose.valid = true;
  pose.autoAligned = !!ctx.autoAligned;
  cacheTrackingPoseFromCurrent(ctx, bounds);
}

function restoreFreeCameraPose(ctx) {
  if (!ctx?.camera || !ctx.freeCameraPose || !ctx.freeCameraPose.valid) return false;
  const pose = ctx.freeCameraPose;
  const target = ensureCameraTarget(ctx);
  ctx.camera.position.copy(pose.position);
  target.copy(pose.target);
  ctx.camera.lookAt(target);
  ctx.camera.up.copy(pose.up);
  if (pose.autoAligned) {
    ctx.autoAligned = true;
  }
  cacheTrackingPoseFromCurrent(ctx, ctx.bounds || null);
  ctx.fixedCameraActive = false;
  return true;
}

function applyTrackingCamera(ctx, bounds, { tempVecA, tempVecB }, trackingOverride = null) {
  if (!ctx?.camera) return false;
  const target = ensureCameraTarget(ctx);
  const sourceBounds = bounds || ctx.bounds || null;
  const center = trackingOverride?.position
    ? tempVecA.set(
        Number(trackingOverride.position[0]) || 0,
        Number(trackingOverride.position[1]) || 0,
        Number(trackingOverride.position[2]) || 0,
      )
    : tempVecA.set(
        Number(sourceBounds?.center?.[0] ?? target.x) || 0,
        Number(sourceBounds?.center?.[1] ?? target.y) || 0,
        Number(sourceBounds?.center?.[2] ?? target.z) || 0,
      );
  const baseRadius = Number.isFinite(trackingOverride?.radius) ? Number(trackingOverride.radius) : null;
  const fallbackRadius = Number(sourceBounds?.radius) || ctx.trackingRadius || 0.6;
  const radius = Math.max(baseRadius != null ? baseRadius : fallbackRadius, 0.6);
  if (!ctx.trackingOffset) {
    ctx.trackingOffset = new THREE.Vector3(radius * 2.6, -radius * 2.6, radius * 1.2);
    ctx.trackingRadius = ctx.trackingOffset.length();
  }
  ctx.camera.position.copy(center).add(ctx.trackingOffset);
  ctx.trackingRadius = ctx.trackingOffset.length();
  ctx.camera.lookAt(center);
  target.copy(center);
  ctx.trackingRadius = ctx.trackingOffset.length();
  ctx.fixedCameraActive = false;
  const minFar = Math.max(GROUND_DISTANCE * 2.5, 400);
  const desiredFar = Math.max(minFar, Math.max(radius, ctx.trackingRadius || radius) * 10);
  if (ctx.camera.far < desiredFar) {
    ctx.camera.far = desiredFar;
    if (typeof ctx.camera.updateProjectionMatrix === 'function') {
      ctx.camera.updateProjectionMatrix();
    }
  }
  return true;
}

  function syncCameraPoseFromMode(backend, ctx, state, bounds, helpers, trackingCtx = {}) {
    if (!ctx?.camera || !state) return;
    const runtimeMode = Number(state.runtime?.cameraIndex ?? 0) | 0;
  const cameraList = Array.isArray(state.model?.cameras) ? state.model.cameras : [];
  const maxMode = FIXED_CAMERA_OFFSET + cameraList.length - 1;
  const desired = Math.max(
    0,
    maxMode >= 0 ? Math.min(runtimeMode, Math.max(0, maxMode)) : runtimeMode
  );
  const previous =
    typeof ctx.currentCameraMode === 'number' ? ctx.currentCameraMode : 0;
    if (desired !== previous) {
      if (previous === 0) {
        rememberFreeCameraPose(ctx, bounds);
      }
      // When returning from fixed cameras, restore the saved free pose.
      // When returning from tracking (mode 1), keep the current camera pose
      // and simply stop tracking so the transition stays lightweight.
      if (desired === 0 && previous >= FIXED_CAMERA_OFFSET) {
        restoreFreeCameraPose(ctx);
      }
      ctx.currentCameraMode = desired;
      ctx.viewerCameraSynced = false;
      ctx.viewerCameraTrackId = null;
      if (desired <= 1) {
        sendViewerCameraSync(backend, ctx, state, helpers.tempVecA);
      }
    }
  if (desired >= FIXED_CAMERA_OFFSET) {
    if (!applyFixedCameraPreset(ctx, state, helpers)) {
      ctx.fixedCameraActive = false;
    }
    return;
  }
  if (desired === 1) {
    const trackingBodyId = resolveTrackingBodyId(state);
    if (Number.isFinite(trackingBodyId) && trackingBodyId !== ctx.viewerCameraTrackId) {
      ctx.viewerCameraSynced = false;
      sendViewerCameraSync(backend, ctx, state, helpers.tempVecA);
    }
    applyTrackingCamera(ctx, trackingCtx.trackingBounds || bounds, helpers, trackingCtx.trackingOverride || null);
    return;
  }
  ctx.fixedCameraActive = false;
}

function ensureMjLightRig(ctx) {
  if (!ctx) return null;
  const rig = ctx._mjLightRig;
  if (rig?.group && Array.isArray(rig.slots) && rig.ambient) return rig;

  const group = new THREE.Group();
  group.name = 'mjLights';
  const ambient = new THREE.AmbientLight(0xffffff, 0);
  ambient.name = 'mjAmbient';
  group.add(ambient);

  const nextRig = {
    group,
    ambient,
    slots: [],
    tmpPos: new THREE.Vector3(),
    tmpDir: new THREE.Vector3(),
  };
  ctx._mjLightRig = nextRig;
  const world = getWorldScene(ctx) || ctx.sceneWorld || ctx.scene;
  if (world) world.add(group);
  return nextRig;
}

function removeMjLightSlot(rig, slot) {
  if (!rig?.group || !slot?.light) return;
  rig.group.remove(slot.light);
  if (slot.target) rig.group.remove(slot.target);
}

function createMjLightSlot(rig, kind) {
  const group = rig.group;
  let light = null;
  let target = null;
  if (kind === 'directional') {
    light = new THREE.DirectionalLight(0xffffff, 0);
    target = new THREE.Object3D();
    light.target = target;
    group.add(target);
    group.add(light);
  } else if (kind === 'spot') {
    light = new THREE.SpotLight(0xffffff, 0);
    target = new THREE.Object3D();
    light.target = target;
    light.angle = Math.PI / 4;
    light.penumbra = 0;
    group.add(target);
    group.add(light);
  } else {
    light = new THREE.PointLight(0xffffff, 0);
    group.add(light);
  }
  light.visible = false;
  light.castShadow = false;
  return { kind, light, target };
}

function ensureMjLightSlot(rig, slotIndex, kind) {
  const slots = rig.slots;
  const existing = slots[slotIndex];
  if (existing?.light && existing.kind === kind) return existing;
  if (existing) {
    removeMjLightSlot(rig, existing);
  }
  const created = createMjLightSlot(rig, kind);
  slots[slotIndex] = created;
  return created;
}

function disableMjLightSlot(slot) {
  if (!slot?.light) return;
  slot.light.visible = false;
  slot.light.intensity = 0;
  slot.light.castShadow = false;
}

function updateMjLightRig(ctx, snapshot, state, assets, options = {}) {
  const rig = ensureMjLightRig(ctx);
  if (!rig) return 0;
  const enabled = options.enabled !== false;
  const shadowEnabled = options.shadowEnabled !== false;
  const bounds = options.bounds || null;
  rig.group.visible = enabled;
  if (!enabled) {
    rig.ambient.intensity = 0;
    for (const slot of rig.slots) disableMjLightSlot(slot);
    return 0;
  }

  if (state?.rendering?.options?.materials?.forceBasic === true && !ctx._mjLightForceBasicWarned) {
    ctx._mjLightForceBasicWarned = true;
    logWarn('[lights] forceBasic disables lighting (MeshBasicMaterial); disable it to see mj lights');
  }

  const camera = ctx?.camera || null;
  const headlight = state?.model?.vis?.headlight || null;
  const headActive = !!camera && headlight && ((headlight.active ?? 1) !== 0);
  const headDiffuse = rgbFromArray(headlight?.diffuse, [1, 1, 1]);
  const headAmbient = rgbFromArray(headlight?.ambient, [0.2, 0.2, 0.2]);

  let ambientR = headActive ? headAmbient[0] : 0;
  let ambientG = headActive ? headAmbient[1] : 0;
  let ambientB = headActive ? headAmbient[2] : 0;

  // Slot 0: headlight (id=-1 in mjv_makeLights). In MuJoCo GL3, directional
  // lights are consumed as `-dir`; in three.js this is achieved by setting the
  // target point as `pos + dir` (shader uses `position - target`).
  const headSlot = ensureMjLightSlot(rig, 0, 'directional');
  if (headActive) {
    camera.updateMatrixWorld?.(true);
    camera.getWorldPosition(rig.tmpPos);
    camera.getWorldDirection(rig.tmpDir);
    const px = rig.tmpPos.x;
    const py = rig.tmpPos.y;
    const pz = rig.tmpPos.z;
    const dx = rig.tmpDir.x;
    const dy = rig.tmpDir.y;
    const dz = rig.tmpDir.z;
    headSlot.light.visible = true;
    headSlot.light.intensity = 1;
    headSlot.light.color.setRGB(headDiffuse[0], headDiffuse[1], headDiffuse[2]);
    headSlot.light.position.set(px, py, pz);
    if (headSlot.target) {
      headSlot.target.position.set(px + dx, py + dy, pz + dz);
      headSlot.light.target?.updateMatrixWorld?.();
    }
  } else {
    disableMjLightSlot(headSlot);
  }

  const lightAssets = assets?.lights || snapshot?.renderAssets?.lights || null;
  const xpos = snapshot?.light_xpos || null;
  const xdir = snapshot?.light_xdir || null;
  const nlight = lightAssets?.count | 0;
  const typeView = lightAssets?.type || null;
  const activeView = lightAssets?.active || null;
  const ambientView = lightAssets?.ambient || null;
  const diffuseView = lightAssets?.diffuse || null;
  const intensityView = lightAssets?.intensity || null;
  const rangeView = lightAssets?.range || null;
  const castshadowView = lightAssets?.castshadow || null;
  const cutoffView = lightAssets?.cutoff || null;
  const exponentView = lightAssets?.exponent || null;

  let slotCursor = 1;
  let shadowCasters = 0;
  if (nlight > 0 && xpos && xdir) {
    const statExtent = Number(state?.model?.stat?.extent);
    const extentFallback = Number.isFinite(statExtent) && statExtent > 1e-6
      ? statExtent
      : Math.max(0.1, Number(bounds?.radius) || 1);
    const shadowclipFactor = Number(state?.model?.vis?.map?.shadowclip);
    const shadowClip = extentFallback * (Number.isFinite(shadowclipFactor) && shadowclipFactor > 1e-6 ? shadowclipFactor : 1);
    const znearFactor = Number(state?.model?.vis?.map?.znear);
    const zfarFactor = Number(state?.model?.vis?.map?.zfar);
    const frustumNear = Math.max(0.01, (Number.isFinite(znearFactor) && znearFactor > 1e-6 ? znearFactor : 0.01) * extentFallback);
    const frustumFar = Math.max(frustumNear + 0.1, (Number.isFinite(zfarFactor) && zfarFactor > 0 ? zfarFactor : 50) * extentFallback);
    const shadowscale = Number(state?.model?.vis?.map?.shadowscale);
    const shadowScale = Number.isFinite(shadowscale) && shadowscale > 1e-6 ? shadowscale : 0.6;
    const max = Math.min(nlight, Math.floor(xpos.length / 3), Math.floor(xdir.length / 3));
    for (let i = 0; i < max && slotCursor < MJ_MAXLIGHT; i += 1) {
      const isActive = activeView ? ((activeView[i] ?? 0) !== 0) : true;
      if (!isActive) continue;
      const lightType = typeView ? (typeView[i] | 0) : MJ_LIGHT_TYPE.POINT;
      if (lightType === MJ_LIGHT_TYPE.IMAGE) continue;
      const kind =
        lightType === MJ_LIGHT_TYPE.DIRECTIONAL
          ? 'directional'
          : (lightType === MJ_LIGHT_TYPE.SPOT ? 'spot' : 'point');
      const slot = ensureMjLightSlot(rig, slotCursor, kind);
      slotCursor += 1;

      const base = i * 3;
      const px = Number(xpos[base + 0]) || 0;
      const py = Number(xpos[base + 1]) || 0;
      const pz = Number(xpos[base + 2]) || 0;
      let dx = Number(xdir[base + 0]) || 0;
      let dy = Number(xdir[base + 1]) || 0;
      let dz = Number(xdir[base + 2]) || 0;
      const dlen = Math.hypot(dx, dy, dz);
      if (dlen > 1e-12) {
        dx /= dlen;
        dy /= dlen;
        dz /= dlen;
      }

      const colBase = i * 3;
      const cr = diffuseView ? (Number(diffuseView[colBase + 0]) || 0) : 1;
      const cg = diffuseView ? (Number(diffuseView[colBase + 1]) || 0) : 1;
      const cb = diffuseView ? (Number(diffuseView[colBase + 2]) || 0) : 1;
      const mjIntensity = intensityView ? Number(intensityView[i]) : 0;
      // MuJoCo's legacy OpenGL lighting uses `light_{ambient,diffuse,specular}` as the
      // effective per-channel strength, and many built-in models keep `light_intensity == 0`.
      // Treat non-positive intensity as "legacy" (i.e. multiplier 1) so that model lights
      // remain visible and match Simulate's behavior.
      const intensity = (Number.isFinite(mjIntensity) && mjIntensity > 0) ? mjIntensity : 1;
      const range = rangeView ? (Number(rangeView[i]) || 0) : 0;

      if (ambientView && ambientView.length >= (colBase + 3)) {
        ambientR += (Number(ambientView[colBase + 0]) || 0) * intensity;
        ambientG += (Number(ambientView[colBase + 1]) || 0) * intensity;
        ambientB += (Number(ambientView[colBase + 2]) || 0) * intensity;
      }

      slot.light.visible = true;
      slot.light.color.setRGB(cr, cg, cb);
      slot.light.intensity = intensity;
      slot.light.position.set(px, py, pz);

      const wantsShadow = shadowEnabled && ((castshadowView?.[i] ?? 0) !== 0);
      const supportsShadow = kind !== 'point';
      const shouldCastShadow = wantsShadow && supportsShadow;
      if (slot.light.castShadow !== shouldCastShadow) slot.light.castShadow = shouldCastShadow;
      if (wantsShadow && !supportsShadow && !ctx._mjLightPointShadowWarned) {
        ctx._mjLightPointShadowWarned = true;
        logWarn('[lights] ignoring castshadow on unsupported point light (MuJoCo only supports directional/spot shadows)');
      }

      if (shouldCastShadow) {
        shadowCasters += 1;
        const shadow = slot.light.shadow || null;
        const modelShadowSize = Number(state?.model?.vis?.quality?.shadowsize);
        const desiredShadowSize = (Number.isFinite(modelShadowSize) && modelShadowSize > 0)
          ? Math.max(16, modelShadowSize | 0)
          : 2048;
        if (shadow && shadow.mapSize?.set) {
          if (shadow.mapSize.x !== desiredShadowSize || shadow.mapSize.y !== desiredShadowSize) {
            shadow.mapSize.set(desiredShadowSize, desiredShadowSize);
          }
        }
        const bias = Number(state?.rendering?.appearance?.shadowBias);
        if (shadow && Number.isFinite(bias) && shadow.bias !== bias) {
          shadow.bias = bias;
        }
        if (shadow && 'normalBias' in shadow) {
          // MuJoCo applies polygon offset while *rendering the shadow map*.
          // three.js' `normalBias` offsets the *receiver* position instead and
          // can cause contact shadows to "peter pan" (crescent-shaped gaps) on
          // near-ground geometry. Keep it disabled; use `shadow.bias` only.
          const desired = 0;
          if (shadow.normalBias !== desired) shadow.normalBias = desired;
        }
        if (shadow && 'radius' in shadow) {
          // MuJoCo uses linear filtering on shadow maps (PCF-like). Keep a
          // non-zero radius so three.js applies percentage-closer filtering.
          const desiredRadius = 1;
          if (shadow.radius !== desiredRadius) {
            shadow.radius = desiredRadius;
          }
        }
        if (shadow?.camera) {
          const cam = shadow.camera;
          // MuJoCo's renderer uses `mjr_orthoVec` to pick a stable up-vector for the
          // light view matrix. three.js' shadow cameras default to `up=(0,1,0)` which
          // becomes ill-conditioned when the light direction is near +/-Y; this
          // manifests as shadow map "rolling" and flickering cutoffs (notably for
          // the humanoid spotlight). Mirror MuJoCo's basis choice to keep shadows
          // stable.
          if (cam.up?.set) {
            // cross(dir, [-1, 0, 0])
            cam.up.set(0, -dz, dy);
            const upLen2 = cam.up.x * cam.up.x + cam.up.y * cam.up.y + cam.up.z * cam.up.z;
            if (!(upLen2 > 0.01)) {
              // cross(dir, [0, 1, 0])
              cam.up.set(-dz, 0, dx);
            }
            cam.up.normalize();
          }
          if (kind === 'directional' && typeof cam.left !== 'undefined') {
            // MuJoCo GL3: glOrtho(-shadowClip, shadowClip, -shadowClip, shadowClip, frustumNear, frustumFar)
            cam.left = -shadowClip;
            cam.right = shadowClip;
            cam.top = shadowClip;
            cam.bottom = -shadowClip;
            cam.near = frustumNear;
            cam.far = frustumFar;
            cam.updateProjectionMatrix?.();
          } else if (kind === 'spot' && typeof cam.fov === 'number') {
            // MuJoCo GL3: perspective(min(2*cutoff*shadowScale, 160), 1, frustumNear, frustumFar).
            // three.js uses shadow.focus to scale the shadow camera FOV relative to light.angle.
            shadow.focus = shadowScale;
            // MuJoCo uses reverse-Z + GEQUAL for shadow rendering, keeping good depth
            // precision even when the viewer frustum spans a large range. three.js
            // uses a conventional forward-Z depth buffer; with very small `near`
            // values this can lead to contact-shadow dropouts near the ground.
            // Clamp the shadow camera near plane to a small fraction of the far
            // range (and light range when available) to preserve precision.
            let desiredNear = frustumNear;
            const ratioNear = frustumFar / 1000;
            if (Number.isFinite(ratioNear) && ratioNear > desiredNear) desiredNear = ratioNear;
            const rangeNear = range > 0 ? (range * 0.01) : 0;
            if (Number.isFinite(rangeNear) && rangeNear > desiredNear) desiredNear = rangeNear;
            if (desiredNear > frustumFar - 0.1) desiredNear = Math.max(frustumNear, frustumFar - 0.1);
            cam.near = desiredNear;
            cam.far = frustumFar;
            cam.updateProjectionMatrix?.();
          }
        }
      }

      if (kind === 'directional') {
        if (slot.target) {
          // Use the current light position (may be repositioned for shadows).
          const lp = slot.light.position;
          slot.target.position.set(lp.x + dx, lp.y + dy, lp.z + dz);
          slot.light.target?.updateMatrixWorld?.();
        }
      } else if (kind === 'spot') {
        // MuJoCo's GL renderer uses the legacy OpenGL spotlight model
        // (`attenuation`, `exponent`, `cutoff`) rather than inverse-square falloff.
        // With three.js `physicallyCorrectLights`, `decay` controls the inverse-distance
        // term. Keep `decay=0` to avoid darkening model lights; `distance` still provides
        // a smooth cutoff near `range` in three.js' physically-correct shader.
        // IMPORTANT: SpotLightShadow.updateMatrices() forces shadow camera far to
        // `light.distance` when non-zero. MuJoCo's shadow frustum uses the viewer
        // camera clip planes (mjv_cameraFrustum), so keep `distance=0` when
        // casting shadows to avoid clipping/popping at the range boundary.
        if (shouldCastShadow) {
          slot.light.distance = 0;
        } else {
          slot.light.distance = range > 0 ? range : 0;
        }
        slot.light.decay = 0;
        if (slot.target) {
          slot.target.position.set(px + dx, py + dy, pz + dz);
          slot.light.target?.updateMatrixWorld?.();
        }
        const cutoffDeg = cutoffView ? Number(cutoffView[i]) : null;
        let outerAngle = slot.light.angle;
        if (Number.isFinite(cutoffDeg) && cutoffDeg > 0) {
          const rad = Math.min(Math.max((cutoffDeg * Math.PI) / 180, 1e-3), Math.PI / 2);
          outerAngle = rad;
          slot.light.angle = rad;
        }

        const exponent = exponentView ? Number(exponentView[i]) : 0;
        // Approximate OpenGL spotlight exponent (pow(cos(theta), exponent)) using
        // three.js' penumbra model by choosing an "inner cone" where the MuJoCo
        // falloff is still near full strength, then fading to zero at cutoff.
        const exp = Number.isFinite(exponent) ? Math.max(0, exponent) : 0;
        let penumbra = 0;
        if (exp > 0 && Number.isFinite(outerAngle) && outerAngle > 1e-6) {
          const nearFull = 0.95;
          const cosInner = Math.pow(nearFull, 1 / exp);
          const innerAngle = Math.acos(Math.max(-1, Math.min(1, cosInner)));
          penumbra = clampUnit(1 - innerAngle / outerAngle);
        }
        if (typeof slot.light.penumbra === 'number' && slot.light.penumbra !== penumbra) {
          slot.light.penumbra = penumbra;
        }
      } else {
        // See note above: avoid inverse-square falloff for MuJoCo model lights.
        slot.light.distance = range > 0 ? range : 0;
        slot.light.decay = 0;
      }
    }
  } else if (nlight > 0 && !ctx._mjLightMissingDynWarned) {
    ctx._mjLightMissingDynWarned = true;
    logWarn('[lights] missing light_xpos/light_xdir snapshot; model lights disabled until available', {
      nlight,
      hasXpos: !!xpos,
      hasXdir: !!xdir,
    });
  }

  rig.ambient.color.setRGB(ambientR, ambientG, ambientB);
  rig.ambient.intensity = (ambientR || ambientG || ambientB) ? 1 : 0;

  for (let i = slotCursor; i < rig.slots.length; i += 1) {
    disableMjLightSlot(rig.slots[i]);
  }
  return shadowCasters;
}

function applyFixedCameraPreset(ctx, state, { tempVecA, tempVecB, tempVecC, tempVecD }) {
  if (!ctx || !ctx.camera) return false;
  const mode = state.runtime?.cameraIndex | 0;
  if (mode < FIXED_CAMERA_OFFSET) {
    ctx.fixedCameraActive = false;
    return false;
  }
  const list = Array.isArray(state.model?.cameras) ? state.model.cameras : [];
  const preset = list[mode - FIXED_CAMERA_OFFSET];
  if (!preset || !Array.isArray(preset.pos) || preset.pos.length < 3) {
    ctx.fixedCameraActive = false;
    return false;
  }
  tempVecA.set(
    Number(preset.pos[0]) || 0,
    Number(preset.pos[1]) || 0,
    Number(preset.pos[2]) || 0,
  );
  ctx.camera.position.copy(tempVecA);
  const up = Array.isArray(preset.up) ? preset.up : (Array.isArray(preset.mat) ? [preset.mat[3], preset.mat[4], preset.mat[5]] : null);
  if (up) {
    tempVecB.set(Number(up[0]) || 0, Number(up[1]) || 0, Number(up[2]) || 1);
    if (tempVecB.lengthSq() > 1e-9) {
      ctx.camera.up.copy(tempVecB.normalize());
    }
  }
  const forward = Array.isArray(preset.forward)
    ? preset.forward
    : (Array.isArray(preset.mat) ? [preset.mat[6], preset.mat[7], preset.mat[8]] : null);
  tempVecC.set(
    Number(forward?.[0]) || 0,
    Number(forward?.[1]) || 0,
    Number(forward?.[2]) || -1,
  );
  if (tempVecC.lengthSq() < 1e-9) tempVecC.set(0, 0, -1);
  tempVecC.normalize();
  const target = tempVecD.copy(ctx.camera.position).add(tempVecC);
  ctx.camera.lookAt(target);
  ensureCameraTarget(ctx)?.copy(target);
  const fovy = Number(preset.fovy);
  if (Number.isFinite(fovy) && ctx.camera.fov !== fovy) {
    ctx.camera.fov = fovy;
    ctx.camera.updateProjectionMatrix();
  }
  ctx.fixedCameraActive = true;
  return true;
}

function applyViewerCameraSnapshot(ctx, snapshot, state, bounds, { tempVecA, tempVecB }) {
  if (!ctx?.camera) return false;
  const mode = state?.runtime?.cameraIndex | 0;
  if (mode > 1) return false;
  // Keep THREE projection aligned with MuJoCo frustum math:
  // `mjv_updateCamera` uses `mjVisual.global.fovy` for free/tracking cameras.
  const fovy = Number(state?.model?.vis?.global?.fovy);
  if (Number.isFinite(fovy) && fovy > 0 && ctx.camera.fov !== fovy) {
    ctx.camera.fov = fovy;
    if (typeof ctx.camera.updateProjectionMatrix === 'function') {
      ctx.camera.updateProjectionMatrix();
    }
  }
  if (!ctx.viewerCameraSynced) return false;
  const cam = snapshot?.viewerCamera;
  if (!cam || !Array.isArray(cam.lookat) || cam.lookat.length < 3) return false;
  const dist = Number(cam.distance);
  const az = Number(cam.azimuth);
  const el = Number(cam.elevation);
  if (!Number.isFinite(dist) || dist <= 0) return false;
  if (!Number.isFinite(az) || !Number.isFinite(el)) return false;
  const azRad = az * CAMERA_RAD_PER_DEG;
  const elRad = el * CAMERA_RAD_PER_DEG;
  const ca = Math.cos(azRad);
  const sa = Math.sin(azRad);
  const ce = Math.cos(elRad);
  const se = Math.sin(elRad);
  const lookat = tempVecA.set(
    Number(cam.lookat[0]) || 0,
    Number(cam.lookat[1]) || 0,
    Number(cam.lookat[2]) || 0,
  );
  const forward = tempVecB.set(ce * ca, ce * sa, se);
  ctx.camera.position.copy(forward).multiplyScalar(-dist).add(lookat);
  ctx.camera.up.set(-se * ca, -se * sa, ce);
  ctx.camera.lookAt(lookat);
  ensureCameraTarget(ctx)?.copy(lookat);
  ctx.fixedCameraActive = false;
  ctx.autoAligned = true;
  if (mode === 0) {
    rememberFreeCameraPose(ctx, bounds || ctx.bounds || null);
  } else {
    cacheTrackingPoseFromCurrent(ctx, bounds || ctx.bounds || null);
  }
  return true;
}

function computeBoundsFromSceneSoA(snapshot, { ignoreStatic = false } = {}) {
  const scnNgeom = Number.isFinite(snapshot?.scn_ngeom) ? (snapshot.scn_ngeom | 0) : -1;
  if (scnNgeom <= 0) return null;
  const pos = snapshot?.scn_pos || null;
  const size = snapshot?.scn_size || null;
  const type = snapshot?.scn_type || null;
  const objType = snapshot?.scn_objtype || null;
  if (!pos || !size || !type || !objType) return null;
  if (pos.length < scnNgeom * 3 || size.length < scnNgeom * 3 || type.length < scnNgeom || objType.length < scnNgeom) return null;

  let minx = Number.POSITIVE_INFINITY;
  let miny = Number.POSITIVE_INFINITY;
  let minz = Number.POSITIVE_INFINITY;
  let maxx = Number.NEGATIVE_INFINITY;
  let maxy = Number.NEGATIVE_INFINITY;
  let maxz = Number.NEGATIVE_INFINITY;
  let used = 0;
  for (let si = 0; si < scnNgeom; si += 1) {
    if ((objType[si] | 0) !== MJ_OBJ.GEOM) continue;
    const base = si * 3;
    const x = Number(pos[base + 0]) || 0;
    const y = Number(pos[base + 1]) || 0;
    const z = Number(pos[base + 2]) || 0;
    const sx = Number(size[base + 0]) || 0.1;
    const sy = Number(size[base + 1]) || sx;
    const sz = Number(size[base + 2]) || sx;
    const gtype = type[si] ?? MJ_GEOM.BOX;
    if (ignoreStatic && (gtype === MJ_GEOM.PLANE || gtype === MJ_GEOM.HFIELD)) {
      continue;
    }
    const radius = computeGeomRadius(gtype, sx, sy, sz);
    const pxMin = x - radius;
    const pyMin = y - radius;
    const pzMin = z - radius;
    const pxMax = x + radius;
    const pyMax = y + radius;
    const pzMax = z + radius;
    if (pxMin < minx) minx = pxMin;
    if (pyMin < miny) miny = pyMin;
    if (pzMin < minz) minz = pzMin;
    if (pxMax > maxx) maxx = pxMax;
    if (pyMax > maxy) maxy = pyMax;
    if (pzMax > maxz) maxz = pzMax;
    used += 1;
  }
  if (used === 0 || !Number.isFinite(minx) || !Number.isFinite(maxx)) return null;
  const cx = (minx + maxx) / 2;
  const cy = (miny + maxy) / 2;
  const cz = (minz + maxz) / 2;
  const dx = maxx - minx;
  const dy = maxy - miny;
  const dz = maxz - minz;
  const radius = Math.max(dx, dy, dz) / 2;
  const fallback = Math.max(Math.abs(cx), Math.abs(cy), Math.abs(cz), 0.6);
  return { center: [cx, cy, cz], radius: Number.isFinite(radius) && radius > 0 ? radius : fallback };
}

  function overlayScale(radius, factor, min = 0.05, max = 2) {
    const r = Number.isFinite(radius) && radius > 0 ? radius : 1;
    return Math.min(max, Math.max(min, r * factor));
  }

function scaleAllFactor(state) {
  const value = Number(state?.model?.vis?.scale?.all);
  if (Number.isFinite(value) && value > 1e-6) return value;
  return 1;
}

function voptEnabled(flags, idx) {
  return Array.isArray(flags) && idx >= 0 && !!flags[idx];
}

function normalizeDeltaByViewportHeight(canvas, dx, dy, invertY = false) {
  const elementHeight = canvas?.clientHeight || (typeof window !== 'undefined' ? window.innerHeight : 1) || 1;
  const heightDen = Math.max(1, elementHeight);
  const dyEff = invertY ? -dy : dy;
  return { reldx: dx / heightDen, reldy: dyEff / heightDen };
}

function meanSizeFromState(state, context = null) {
  const statSize = Number(state?.model?.stat?.meansize);
  if (Number.isFinite(statSize) && statSize > 0) return statSize;
  const radius = Number(context?.bounds?.radius);
  if (Number.isFinite(radius) && radius > 0) return radius;
  return 1;
}

  function computeMeanScale(state, context = null) {
    const meanSize = meanSizeFromState(state, context);
    const scaleAll = scaleAllFactor(state);
    return { meanSize, scaleAll };
  }

function computeScenePolicy(snapshot, state, context) {
  const sceneFlags = Array.isArray(state.rendering?.sceneFlags) ? state.rendering.sceneFlags : [];
  const voptFlags = Array.isArray(state.rendering?.voptFlags)
    ? state.rendering.voptFlags
    : (Array.isArray(snapshot?.voptFlags) ? snapshot.voptFlags : (getDefaultVopt(context, state) || []));
    const segmentEnabled = !!sceneFlags[SEGMENT_FLAG_INDEX];
    const skyboxFlag = sceneFlags[4] !== false;
    const shadowEnabled = segmentEnabled ? false : sceneFlags[0] !== false;
    const reflectionEnabled = segmentEnabled ? false : sceneFlags[2] !== false;
    const skyboxEnabled = !segmentEnabled && skyboxFlag;
    const fogEnabled = segmentEnabled ? false : !!sceneFlags[5];
    const hazeEnabled = segmentEnabled ? false : !!sceneFlags[6];
    const hideAllGeometry = !!state.rendering?.hideAllGeometry;
    return {
      sceneFlags,
      voptFlags,
      segmentEnabled,
      skyboxEnabled,
      shadowEnabled,
      reflectionEnabled,
      fogEnabled,
      hazeEnabled,
      hideAllGeometry,
    };
  }

function disposeLabelTextureCache() {
  for (const tex of LABEL_TEXTURE_CACHE.values()) {
    if (tex && typeof tex.dispose === 'function') {
      try {
        tex.dispose();
      } catch (err) {
        strictCatch(err, 'main:labelTex_dispose');
      }
    }
  }
  LABEL_TEXTURE_CACHE.clear();
}

function getLabelTexture(text, quality = 1) {
  if (typeof document === 'undefined') return null;
  const label = (text || '').toString();
  const dpr = typeof window !== 'undefined' ? Math.min(window.devicePixelRatio || 1, LABEL_DPR_CAP) : 1;
  const q = Math.max(1, quality);
  const cacheKey = `${LABEL_TEXTURE_VERSION}::${label}::q${q.toFixed(2)}::${dpr.toFixed(2)}`;
  if (LABEL_TEXTURE_CACHE.has(cacheKey)) {
    const cached = LABEL_TEXTURE_CACHE.get(cacheKey);
    if (cached) {
      LABEL_TEXTURE_CACHE.delete(cacheKey);
      LABEL_TEXTURE_CACHE.set(cacheKey, cached);
    }
    return cached;
  }
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const baseFontPx = 18;
  const fontPx = baseFontPx * dpr * q;
  ctx.font = `400 ${fontPx}px "Inter", "Segoe UI", sans-serif`;
  const metrics = ctx.measureText(label);
  const paddingX = 10 * dpr * q;
  const paddingY = 6 * dpr * q;
  const textWidth = Math.max(metrics.width, 12 * dpr * q);
  canvas.width = Math.ceil(textWidth + paddingX * 2);
  canvas.height = Math.ceil(fontPx + paddingY * 2);
  ctx.font = `400 ${fontPx}px "Inter", "Segoe UI", sans-serif`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.lineWidth = Math.max(1.5 * dpr * q, 1);
  ctx.strokeStyle = 'rgba(255,255,255,0.95)';
  ctx.fillStyle = '#050608';
  const centerY = canvas.height / 2 + 0.1 * fontPx;
  ctx.strokeText(label, canvas.width / 2, centerY);
  ctx.fillText(label, canvas.width / 2, centerY);
  const texture = new THREE.CanvasTexture(canvas);
  texture.anisotropy = 1;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  texture.generateMipmaps = false;
  texture.userData = texture.userData || {};
  texture.userData.aspect = canvas.width / Math.max(1, canvas.height);
  LABEL_TEXTURE_CACHE.set(cacheKey, texture);
  while (LABEL_TEXTURE_CACHE.size > LABEL_TEXTURE_CACHE_LIMIT) {
    const oldest = LABEL_TEXTURE_CACHE.entries().next().value;
    if (!oldest) break;
    const [oldKey, oldTex] = oldest;
    LABEL_TEXTURE_CACHE.delete(oldKey);
    if (oldTex && typeof oldTex.dispose === 'function') {
      try {
        oldTex.dispose();
      } catch (err) {
        strictCatch(err, 'main:labelTex_dispose');
      }
    }
  }
  return texture;
}

function createLabelSprite() {
  const material = new THREE.SpriteMaterial({
    map: null,
    color: 0xffffff,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
  const sprite = new THREE.Sprite(material);
  sprite.visible = false;
  sprite.renderOrder = 999;
  sprite.center.set(0.5, 0);
  sprite.frustumCulled = false;
  return sprite;
}

function ensureLabelGroup(context) {
  if (!context.labelGroup) {
    context.labelGroup = new THREE.Group();
    context.labelGroup.name = 'overlay:labels';
    const worldScene = getWorldScene(context);
    if (worldScene) worldScene.add(context.labelGroup);
    context.labelPool = [];
    strictEnsure('ensureLabelGroup', { reason: 'create' });
  }
  return context.labelGroup;
}

function hideLabelGroup(context) {
  if (Array.isArray(context?.labelPool)) {
    for (const sprite of context.labelPool) {
      if (sprite) sprite.visible = false;
    }
  }
  if (context?.labelGroup) {
    context.labelGroup.visible = false;
  }
}

function updateSceneLabelOverlays(context, snapshot, state, options = {}) {
  const scnNgeom = snapshot?.scn_ngeom | 0;
  const labelBytes = snapshot?.scn_label || null;
  const posView = snapshot?.scn_pos || null;
  if (!(scnNgeom > 0) || !labelBytes || !posView || !MJ_LABEL_DECODER) {
    hideLabelGroup(context);
    return;
  }
  if (labelBytes.length < scnNgeom * MJ_LABEL_STRIDE || posView.length < scnNgeom * 3) {
    hideLabelGroup(context);
    return;
  }
  const hideAllGeometry = !!options.hideAllGeometry;
  if (hideAllGeometry) {
    hideLabelGroup(context);
    return;
  }

  const labelGroup = ensureLabelGroup(context);
  const pool = context.labelPool;
  const camera = context.camera;
  const labelHeight = LABEL_DEFAULT_HEIGHT;
  const verticalOffset = LABEL_DEFAULT_OFFSET;
  const maxLabels = LABEL_GEOM_LIMIT;
  let used = 0;

  for (let si = 0; si < scnNgeom; si += 1) {
    const base = si * MJ_LABEL_STRIDE;
    if ((labelBytes[base] | 0) === 0) continue;
    if (used >= maxLabels) break;
    const bytes = labelBytes.subarray(base, base + MJ_LABEL_STRIDE);
    let end = bytes.indexOf(0);
    if (end < 0) end = MJ_LABEL_STRIDE;
    const text = MJ_LABEL_DECODER.decode(bytes.subarray(0, end)).trim();
    if (!text) continue;
    const pbase = si * 3;
    const px = Number(posView[pbase + 0]);
    const py = Number(posView[pbase + 1]);
    const pz = Number(posView[pbase + 2]);
    if (!Number.isFinite(px) || !Number.isFinite(py) || !Number.isFinite(pz)) continue;

    let quality = LABEL_LOD_FACTORS.far;
    if (camera) {
      const dist = camera.position.distanceTo(__TMP_VEC3.set(px, py, pz));
      if (dist < LABEL_LOD_NEAR) quality = LABEL_LOD_FACTORS.near;
      else if (dist < LABEL_LOD_MID) quality = LABEL_LOD_FACTORS.mid;
    }
    const texture = getLabelTexture(text, quality);
    if (!texture) continue;
    let sprite = pool[used];
    if (!sprite) {
      sprite = createLabelSprite();
      pool[used] = sprite;
      labelGroup.add(sprite);
    }
    sprite.material.map = texture;
    sprite.material.needsUpdate = true;
    const aspect = Number(texture.userData?.aspect) || 3;
    const width = labelHeight * aspect;
    sprite.scale.set(width, labelHeight, 1);
    sprite.position.set(px, py, pz + verticalOffset);
    sprite.visible = true;
    used += 1;
  }

  for (let i = used; i < pool.length; i += 1) {
    if (pool[i]) pool[i].visible = false;
  }
  labelGroup.visible = used > 0;
}

function computeGeometryBounds(geometry) {
  geometry?.computeBoundingBox?.();
  geometry?.computeBoundingSphere?.();
}

function createPrimitiveGeometry(gtype, sizeVec) {
  let geometry;
  let materialOpts = {
    color: 0x6fa0ff,
    metalness: 0.05,
    roughness: 0.65,
  };
  let postCreate = null;
  let objectKind = 'mesh';
  const sx = Number(sizeVec?.[0]) || 0;
  const sy = Number(sizeVec?.[1]) || 0;
  const sz = Number(sizeVec?.[2]) || 0;
  switch (gtype) {
    case MJ_GEOM.LINE: {
      // mjGEOM_LINE is a connector: local +Z is the segment direction.
      // Width is denominated in pixels in MuJoCo; WebGL line width is not reliable,
      // so we render as a 1px line and rely on scene RGBA + depth ordering.
      const length = Math.max(1e-6, sy || sz || 0);
      geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
        0, 0, 0,
        0, 0, length,
      ]), 3));
      materialOpts = { color: 0xffffff, kind: 'line' };
      objectKind = 'line';
      break;
    }
    case MJ_GEOM.LINEBOX: {
      // mjGEOM_LINEBOX uses half-sizes (AABB extents).
      const bx = Math.max(1e-6, sx || 0.1);
      const by = Math.max(1e-6, sy || bx);
      const bz = Math.max(1e-6, sz || bx);
      const box = new THREE.BoxGeometry(2 * bx, 2 * by, 2 * bz);
      geometry = new THREE.EdgesGeometry(box);
      box.dispose();
      materialOpts = { color: 0xffffff, kind: 'line' };
      objectKind = 'line';
      break;
    }
    case MJ_GEOM.ARROW:
    case MJ_GEOM.ARROW1:
    case MJ_GEOM.ARROW2: {
      // Connector arrow: local +Z is the arrow direction, origin at the "from" endpoint.
      // Approximate with a single cone (MuJoCo uses wedges; we keep it simple).
      const radius = Math.max(1e-6, sx || 0.02);
      const length = Math.max(1e-6, sy || sz || 0.1);
      geometry = new THREE.CylinderGeometry(0, radius, length, 12, 1, false);
      geometry.rotateX(Math.PI / 2);
      geometry.translate(0, 0, length * 0.5);
      materialOpts = { color: 0xffffff, kind: 'basic' };
      break;
    }
    case MJ_GEOM.TRIANGLE: {
      // Triangle: local X is edge v0->v1, local Y is edge v0->v2 (see engine_vis_visualize.c:makeTriangle).
      const e1 = Math.max(0, sx || 0);
      const e2 = Math.max(0, sy || 0);
      geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
        0, 0, 0,
        e1, 0, 0,
        0, e2, 0,
      ]), 3));
      geometry.setIndex([0, 1, 2]);
      geometry.computeVertexNormals();
      materialOpts = { color: 0xffffff, kind: 'basic', doubleSided: true };
      break;
    }
    case MJ_GEOM.SPHERE: {
      const r = Math.max(1e-6, sx || sy || sz || 0.1);
      geometry = new THREE.SphereGeometry(1, 24, 16);
      geometry.scale(r, r, r);
      break;
    }
    case MJ_GEOM.ELLIPSOID: {
      const ax = Math.max(1e-6, sx || 0.1);
      const ay = Math.max(1e-6, sy || ax);
      const az = Math.max(1e-6, sz || ax);
      geometry = new THREE.SphereGeometry(1, 24, 16);
      geometry.scale(ax, ay, az);
      break;
    }
    case MJ_GEOM.CAPSULE: {
      const radius = Math.max(1e-6, sx || 0.05);
      const halfLength = Math.max(0, sy || 0);
      geometry = new THREE.CapsuleGeometry(radius, Math.max(0, 2 * halfLength), 20, 12);
      geometry.rotateX(Math.PI / 2);
      break;
    }
    case MJ_GEOM.CYLINDER: {
      const radius = Math.max(1e-6, sx || 0.05);
      const halfLength = Math.max(0, sy || 0.05);
      geometry = new THREE.CylinderGeometry(
        radius,
        radius,
        Math.max(1e-6, 2 * halfLength),
        24,
        1
      );
      geometry.rotateX(Math.PI / 2);
      break;
    }
    case MJ_GEOM.PLANE:
    case MJ_GEOM.HFIELD: {
      const halfX = Math.max(Math.abs(sx), PLANE_SIZE_EPS);
      const halfY = Math.max(Math.abs(sy || sx), PLANE_SIZE_EPS);
      const width = Math.max(PLANE_SIZE_EPS, halfX * 2);
      const height = Math.max(PLANE_SIZE_EPS, halfY * 2);
      geometry = new THREE.PlaneGeometry(width, height, 1, 1);
      const lightGray = 0xd0d0d0;
      materialOpts = {
        color: lightGray,
        metalness: 0.0,
        roughness: 0.82,
      };
      postCreate = (mesh) => {
        mesh.rotation.x = -Math.PI / 2;
        mesh.receiveShadow = true;
        mesh.castShadow = false;
        try {
          const baseMat = mesh.material;
          if (baseMat && typeof baseMat.clone === 'function') {
            const backMat = baseMat.clone();
            backMat.side = THREE.BackSide;
            backMat.transparent = true;
            backMat.opacity = 0.25;
            backMat.depthWrite = false;
            backMat.polygonOffset = true;
            backMat.polygonOffsetFactor = -1;
            const backMesh = new THREE.Mesh(mesh.geometry, backMat);
            backMesh.receiveShadow = false;
            backMesh.castShadow = false;
            backMesh.renderOrder = (mesh.renderOrder || 0) + 0.01;
            backMesh.userData = { ownGeometry: false };
            mesh.add(backMesh);
            mesh.userData = mesh.userData || {};
            mesh.userData.fallbackBackface = backMesh;
          }

        } catch (err) {
          strictCatch(err, 'main:plane_backface');
        }
      };
      break;
    }
    default: {
      const bx = Math.max(1e-6, sx || 0.1);
      const by = Math.max(1e-6, sy || bx);
      const bz = Math.max(1e-6, sz || bx);
      geometry = new THREE.BoxGeometry(2 * bx, 2 * by, 2 * bz);
      break;
    }
  }
  computeGeometryBounds(geometry);
  return { geometry, materialOpts, postCreate, objectKind };
}

function isDynamicSizeScaleGeomType(gtype) {
  switch (gtype | 0) {
    case MJ_GEOM.CAPSULE:
    case MJ_GEOM.CYLINDER:
    case MJ_GEOM.LINE:
    case MJ_GEOM.LINEBOX:
    case MJ_GEOM.ARROW:
    case MJ_GEOM.ARROW1:
    case MJ_GEOM.ARROW2:
    case MJ_GEOM.TRIANGLE:
      return true;
    default:
      return false;
  }
}

function safeScaleRatio(value, base) {
  const v = Number(value);
  const b = Number(base);
  if (!Number.isFinite(v) || !Number.isFinite(b) || Math.abs(b) < 1e-12) return 1;
  return v / b;
}

function ensureGeomBuiltSizes(mesh, gtype) {
  if (!mesh) return null;
  const type = gtype | 0;
  if (!isDynamicSizeScaleGeomType(type)) return mesh.userData || null;
  const userData = mesh.userData || (mesh.userData = {});
  if (
    Number.isFinite(userData.geomBuiltSizeX) &&
    Number.isFinite(userData.geomBuiltSizeY) &&
    Number.isFinite(userData.geomBuiltSizeZ)
  ) {
    return userData;
  }

  const geometry = mesh.geometry || null;
  if (!geometry) return userData;
  if (!geometry.boundingBox && typeof geometry.computeBoundingBox === 'function') {
    geometry.computeBoundingBox();
  }
  const bb = geometry.boundingBox || null;
  if (!bb) return userData;
  const ex = Math.abs(Number(bb.max.x) - Number(bb.min.x));
  const ey = Math.abs(Number(bb.max.y) - Number(bb.min.y));
  const ez = Math.abs(Number(bb.max.z) - Number(bb.min.z));
  let computed = false;

  switch (type) {
    case MJ_GEOM.LINE: {
      userData.geomBuiltSizeX = 1;
      userData.geomBuiltSizeY = Math.max(1e-6, ez);
      userData.geomBuiltSizeZ = 1;
      computed = true;
      break;
    }
    case MJ_GEOM.CAPSULE:
    case MJ_GEOM.CYLINDER:
    case MJ_GEOM.ARROW:
    case MJ_GEOM.ARROW1:
    case MJ_GEOM.ARROW2: {
      const radius = 0.5 * Math.max(ex, ey);
      userData.geomBuiltSizeX = Math.max(1e-6, radius);
      userData.geomBuiltSizeY = Math.max(1e-6, ez);
      userData.geomBuiltSizeZ = 1;
      computed = true;
      break;
    }
    case MJ_GEOM.LINEBOX: {
      userData.geomBuiltSizeX = Math.max(1e-6, 0.5 * ex);
      userData.geomBuiltSizeY = Math.max(1e-6, 0.5 * ey);
      userData.geomBuiltSizeZ = Math.max(1e-6, 0.5 * ez);
      computed = true;
      break;
    }
    case MJ_GEOM.TRIANGLE: {
      userData.geomBuiltSizeX = Math.max(0, ex);
      userData.geomBuiltSizeY = Math.max(0, ey);
      userData.geomBuiltSizeZ = 1;
      computed = true;
      break;
    }
    default:
      break;
  }
  if (computed) {
    strictEnsure('ensureGeomBuiltSizes', { reason: 'build_sizes', geomType: type });
  }
  return userData;
}

function applyDynamicSizeScale(mesh, gtype, sizeVec) {
  if (!mesh) return;
  const type = gtype | 0;
  if (!isDynamicSizeScaleGeomType(type)) return;
  const userData = ensureGeomBuiltSizes(mesh, type) || (mesh.userData || {});
  const sx = Number(sizeVec?.[0]) || 0;
  const sy = Number(sizeVec?.[1]) || 0;
  const sz = Number(sizeVec?.[2]) || 0;

  switch (type) {
    case MJ_GEOM.CYLINDER: {
      const radius = Math.max(1e-6, sx || 0.05);
      const halfLength = Math.max(0, sy || 0.05);
      const fullLength = Math.max(1e-6, 2 * halfLength);
      const sR = safeScaleRatio(radius, userData.geomBuiltSizeX);
      const sL = safeScaleRatio(fullLength, userData.geomBuiltSizeY);
      mesh.scale.set(sR, sR, sL);
      break;
    }
    case MJ_GEOM.CAPSULE: {
      const radius = Math.max(1e-6, sx || 0.05);
      const halfLength = Math.max(0, sy || 0);
      const fullLength = Math.max(1e-6, 2 * halfLength + 2 * radius);
      const sR = safeScaleRatio(radius, userData.geomBuiltSizeX);
      const sL = safeScaleRatio(fullLength, userData.geomBuiltSizeY);
      mesh.scale.set(sR, sR, sL);
      break;
    }
    case MJ_GEOM.LINE: {
      const length = Math.max(1e-6, sy || sz || 0);
      mesh.scale.set(1, 1, safeScaleRatio(length, userData.geomBuiltSizeY));
      break;
    }
    case MJ_GEOM.ARROW:
    case MJ_GEOM.ARROW1:
    case MJ_GEOM.ARROW2: {
      const radius = Math.max(1e-6, sx || 0.02);
      const length = Math.max(1e-6, sy || sz || 0.1);
      const sR = safeScaleRatio(radius, userData.geomBuiltSizeX);
      const sL = safeScaleRatio(length, userData.geomBuiltSizeY);
      mesh.scale.set(sR, sR, sL);
      break;
    }
    case MJ_GEOM.LINEBOX: {
      const bx = Math.max(1e-6, sx || 0.1);
      const by = Math.max(1e-6, sy || bx);
      const bz = Math.max(1e-6, sz || bx);
      mesh.scale.set(
        safeScaleRatio(bx, userData.geomBuiltSizeX),
        safeScaleRatio(by, userData.geomBuiltSizeY),
        safeScaleRatio(bz, userData.geomBuiltSizeZ),
      );
      break;
    }
    case MJ_GEOM.TRIANGLE: {
      const e1 = Math.max(0, sx || 0);
      const e2 = Math.max(0, sy || 0);
      mesh.scale.set(
        safeScaleRatio(e1, userData.geomBuiltSizeX),
        safeScaleRatio(e2, userData.geomBuiltSizeY),
        1,
      );
      break;
    }
    default:
      break;
  }
}

function createMeshGeometryFromAssets(assets, dataId) {
  if (!assets || !assets.meshes) return null;
  const rawDataId = dataId | 0;
  const MESH_DATAID_MASK = 1 << 30;
  const isEncoded = (rawDataId & MESH_DATAID_MASK) !== 0;
  const payload = isEncoded ? (rawDataId & (MESH_DATAID_MASK - 1)) : rawDataId;
  const meshCountGuess =
    Number.isFinite(assets.meshes.count)
      ? (assets.meshes.count | 0)
      : (assets.meshes.vertnum ? (assets.meshes.vertnum.length | 0) : 0);
  const decodedId = payload >> 1;
  const meshId = (!isEncoded && meshCountGuess > 0 && decodedId >= meshCountGuess && rawDataId >= 0 && rawDataId < meshCountGuess)
    ? rawDataId
    : decodedId;
  const hull = (payload & 1) !== 0;
  if (!(meshId >= 0)) return null;

  const {
    vert,
    vertadr,
    vertnum,
    face,
    faceadr,
    facenum,
    normal,
    normaladr,
    normalnum,
    facenormal,
    texcoord,
    texcoordadr,
    texcoordnum,
    facetexcoord,
    graph,
    graphadr,
    graphnum,
    nmeshgraph,
    polynum,
    polyadr,
    polynormal,
    polyvertadr,
    polyvertnum,
    polyvert,
    nmeshpoly,
    nmeshpolyvert,
  } = assets.meshes;
  const hasValidVert =
    vert
    && typeof vert.length === 'number'
    && typeof vert.slice === 'function';
  if (!hasValidVert || !vertadr || !vertnum) return null;

  const count = vertnum[meshId] | 0;
  if (!(count > 0)) return null;
  const start = (vertadr[meshId] | 0) * 3;
  const end = start + count * 3;
  if (start < 0 || end > vert.length) return null;

  if (isEncoded && hull) {
    const polyCount = polynum && meshId < polynum.length ? (polynum[meshId] | 0) : 0;
    const polyStart = polyadr && meshId < polyadr.length ? (polyadr[meshId] | 0) : -1;
    const totalPoly = Number.isFinite(nmeshpoly) ? (nmeshpoly | 0) : (polyvertnum ? (polyvertnum.length | 0) : 0);
    const totalPolyVert = Number.isFinite(nmeshpolyvert) ? (nmeshpolyvert | 0) : (polyvert ? (polyvert.length | 0) : 0);

    if (
      polyCount > 0 &&
      polyStart >= 0 &&
      polyvertadr &&
      polyvertnum &&
      polyvert &&
      polynormal &&
      polyStart < totalPoly
    ) {
      const polyEnd = Math.min(totalPoly, polyStart + polyCount);
      let triCount = 0;
      for (let pid = polyStart; pid < polyEnd; pid += 1) {
        const n = polyvertnum[pid] | 0;
        if (n >= 3) triCount += (n - 2);
      }
      if (triCount > 0) {
        const positions = new Float32Array(triCount * 9);
        const normals = new Float32Array(triCount * 9);
        let t = 0;
        for (let pid = polyStart; pid < polyEnd; pid += 1) {
          const vStart = polyvertadr[pid] | 0;
          const vNum = polyvertnum[pid] | 0;
          if (!(vNum >= 3) || vStart < 0 || (vStart + vNum) > totalPolyVert) continue;
          const v0 = polyvert[vStart] | 0;
          if (v0 < 0 || v0 >= count) continue;
          const nBase = pid * 3;
          const nx = Number(polynormal[nBase + 0]) || 0;
          const ny = Number(polynormal[nBase + 1]) || 0;
          const nz = Number(polynormal[nBase + 2]) || 1;

          for (let j = 1; j < vNum - 1; j += 1) {
            const v1 = polyvert[vStart + j] | 0;
            const v2 = polyvert[vStart + j + 1] | 0;
            if (v1 < 0 || v1 >= count) continue;
            if (v2 < 0 || v2 >= count) continue;

            const dstBase = 9 * t;
            const vtx = [v0, v1, v2];
            for (let k = 0; k < 3; k += 1) {
              const vi = vtx[k] | 0;
              const srcBase = start + 3 * vi;
              const outBase = dstBase + 3 * k;
              positions[outBase + 0] = vert[srcBase + 0] ?? 0;
              positions[outBase + 1] = vert[srcBase + 1] ?? 0;
              positions[outBase + 2] = vert[srcBase + 2] ?? 0;
              normals[outBase + 0] = nx;
              normals[outBase + 1] = ny;
              normals[outBase + 2] = nz;
            }
            t += 1;
          }
        }
        if (t > 0) {
          const geometry = new THREE.BufferGeometry();
          const usedPositions = t === triCount ? positions : positions.subarray(0, t * 9);
          const usedNormals = t === triCount ? normals : normals.subarray(0, t * 9);
          geometry.setAttribute('position', new THREE.BufferAttribute(usedPositions, 3));
          geometry.setAttribute('normal', new THREE.BufferAttribute(usedNormals, 3));
          computeGeometryBounds(geometry);
          return geometry;
        }
      }
    }

    // Fallback: if convex hull data is missing, render the original mesh.
    if (hull) {
      compatFallback('mesh.convex_hull_missing', { meshId, dataId: rawDataId });
    }
  }

  const triCount = (face && faceadr && facenum && meshId < facenum.length) ? (facenum[meshId] | 0) : 0;
  const faceStart = (triCount > 0 && faceadr && meshId < faceadr.length) ? ((faceadr[meshId] | 0) * 3) : -1;
  const faceEnd = (triCount > 0 && faceStart >= 0) ? (faceStart + triCount * 3) : -1;

  const tcCount = (texcoordnum && meshId < texcoordnum.length) ? (texcoordnum[meshId] | 0) : 0;
  const tcBase = (tcCount > 0 && texcoordadr && meshId < texcoordadr.length) ? ((texcoordadr[meshId] | 0) * 2) : -1;
  const tcEnd = (tcBase >= 0 && tcCount > 0) ? (tcBase + tcCount * 2) : -1;

  const nCount = (normalnum && meshId < normalnum.length) ? (normalnum[meshId] | 0) : 0;
  const nBase = (nCount > 0 && normaladr && meshId < normaladr.length) ? ((normaladr[meshId] | 0) * 3) : -1;
  const nEnd = (nBase >= 0 && nCount > 0) ? (nBase + nCount * 3) : -1;

  const hasFaceTexcoord =
    !!facetexcoord &&
    !!texcoord &&
    triCount > 0 &&
    faceStart >= 0 &&
    faceEnd >= 0 &&
    faceEnd <= facetexcoord.length &&
    tcBase >= 0 &&
    tcEnd >= 0 &&
    tcEnd <= texcoord.length;
  const hasFaceNormal =
    !!facenormal &&
    !!normal &&
    triCount > 0 &&
    faceStart >= 0 &&
    faceEnd >= 0 &&
    faceEnd <= facenormal.length &&
    nBase >= 0 &&
    nEnd >= 0 &&
    nEnd <= normal.length;

  // MuJoCo meshes can carry independent indices for vertex/normal/texcoord (OBJ-style).
  // When texcoords/normals are not 1:1 with vertices, we must expand faces into a
  // non-indexed BufferGeometry so each corner gets the correct (pos,nrm,uv) tuple.
  const needsFaceExpansion =
    (hasFaceTexcoord && tcCount > 0 && tcCount !== count) ||
    (hasFaceNormal && nCount > 0 && nCount !== count);

  if (needsFaceExpansion && face && faceStart >= 0 && faceEnd > faceStart && faceEnd <= face.length) {
    const posOut = new Float32Array(triCount * 9);
    const uvOut = hasFaceTexcoord ? new Float32Array(triCount * 6) : null;
    const nrmOut = (hasFaceNormal || (normal && nCount === count && nBase >= 0 && nEnd <= normal.length)) ? new Float32Array(triCount * 9) : null;

    for (let i = 0; i < triCount * 3; i += 1) {
      const vi = face[faceStart + i] | 0;
      const dstPos = i * 3;
      const srcPos = start + vi * 3;
      if (vi >= 0 && srcPos + 2 < end) {
        posOut[dstPos + 0] = vert[srcPos + 0] ?? 0;
        posOut[dstPos + 1] = vert[srcPos + 1] ?? 0;
        posOut[dstPos + 2] = vert[srcPos + 2] ?? 0;
      } else {
        posOut[dstPos + 0] = 0;
        posOut[dstPos + 1] = 0;
        posOut[dstPos + 2] = 0;
      }

      if (uvOut) {
        const ti = facetexcoord[faceStart + i] | 0;
        const dstUv = i * 2;
        const srcUv = tcBase + ti * 2;
        if (ti >= 0 && srcUv + 1 < tcEnd) {
          uvOut[dstUv + 0] = texcoord[srcUv + 0] ?? 0;
          uvOut[dstUv + 1] = texcoord[srcUv + 1] ?? 0;
        } else {
          uvOut[dstUv + 0] = 0;
          uvOut[dstUv + 1] = 0;
        }
      }

      if (nrmOut) {
        const dstNrm = i * 3;
        let nx = 0, ny = 0, nz = 1;
        if (hasFaceNormal) {
          const ni = facenormal[faceStart + i] | 0;
          const srcNrm = nBase + ni * 3;
          if (ni >= 0 && srcNrm + 2 < nEnd) {
            nx = normal[srcNrm + 0] ?? 0;
            ny = normal[srcNrm + 1] ?? 0;
            nz = normal[srcNrm + 2] ?? 1;
          }
        } else if (normal && nCount === count && nBase >= 0 && nEnd <= normal.length) {
          const srcNrm = nBase + vi * 3;
          if (vi >= 0 && srcNrm + 2 < nEnd) {
            nx = normal[srcNrm + 0] ?? 0;
            ny = normal[srcNrm + 1] ?? 0;
            nz = normal[srcNrm + 2] ?? 1;
          }
        }
        nrmOut[dstNrm + 0] = nx;
        nrmOut[dstNrm + 1] = ny;
        nrmOut[dstNrm + 2] = nz;
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(posOut, 3));
    if (nrmOut) geometry.setAttribute('normal', new THREE.BufferAttribute(nrmOut, 3));
    if (uvOut) geometry.setAttribute('uv', new THREE.BufferAttribute(uvOut, 2));
    if (!geometry.getAttribute('normal')) {
      geometry.computeVertexNormals();
    }
    computeGeometryBounds(geometry);
    return geometry;
  }

  const positions = vert.slice(start, end);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

  if (normal && nCount === count && nBase >= 0 && nEnd <= normal.length) {
    const normalSlice = normal.slice(nBase, nEnd);
    geometry.setAttribute('normal', new THREE.BufferAttribute(normalSlice, 3));
  }

  if (triCount > 0 && face && faceStart >= 0 && faceEnd > faceStart && faceEnd <= face.length) {
    const rawFaces = face.slice(faceStart, faceEnd);
    let needsUint32 = count > 65535;
    if (!needsUint32) {
      for (let i = 0; i < rawFaces.length; i += 1) {
        if (rawFaces[i] > 65535) {
          needsUint32 = true;
          break;
        }
      }
    }
    const IndexCtor = needsUint32 ? Uint32Array : Uint16Array;
    const indices = new IndexCtor(rawFaces);
    geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  }

  if (texcoord && tcCount === count && tcBase >= 0 && tcEnd > tcBase && tcEnd <= texcoord.length) {
    const uvSlice = texcoord.slice(tcBase, tcEnd);
    geometry.setAttribute('uv', new THREE.BufferAttribute(uvSlice, 2));
  }

  if (!geometry.getAttribute('normal')) {
    geometry.computeVertexNormals();
  }
  computeGeometryBounds(geometry);
  return geometry;
}

function disposeMeshObject(mesh) {
  try {
    if (mesh.userData && mesh.userData.fallbackBackface) {
      const back = mesh.userData.fallbackBackface;
      if (back.material && typeof back.material.dispose === 'function') {
        try {
          back.material.dispose();
        } catch (err) {
          strictCatch(err, 'main:dispose_mesh');
        }
      }
      if (typeof mesh.remove === 'function') {
        try {
          mesh.remove(back);
        } catch (err) {
          strictCatch(err, 'main:dispose_mesh');
        }
      }
      mesh.userData.fallbackBackface = null;
    }
  } catch (err) {
    strictCatch(err, 'main:dispose_mesh');
  }

  if (!mesh) return;
  const userData = mesh.userData || null;
  const parent = mesh.parent;
  if (parent && typeof parent.remove === 'function') {
    parent.remove(mesh);
  }
  const ownGeometry = userData?.ownGeometry !== false;
  if (ownGeometry && mesh.geometry && typeof mesh.geometry.dispose === 'function') {
    try {
      mesh.geometry.dispose();
    } catch (err) {
      strictCatch(err, 'main:dispose_mesh');
    }
  }
  const material = mesh.material;
  if (Array.isArray(material)) {
    for (const mat of material) {
      if (mat && !mat.userData?.pooled && typeof mat.dispose === 'function') {
        try {
          mat.dispose();
        } catch (err) {
          strictCatch(err, 'main:dispose_mesh');
        }
      }
    }
  } else if (material && !material.userData?.pooled && typeof material.dispose === 'function') {
    try {
      material.dispose();
    } catch (err) {
      strictCatch(err, 'main:dispose_mesh');
    }
  }
  const segMat = userData?.segmentMaterial || null;
  if (segMat) {
    let disposed = false;
    if (Array.isArray(material)) disposed = material.includes(segMat);
    else disposed = material === segMat;
    if (!disposed && typeof segMat.dispose === 'function') {
      try {
        segMat.dispose();
      } catch (err) {
        strictCatch(err, 'main:dispose_mesh');
      }
    }
    userData.segmentMaterial = null;
    userData.segmentOriginalMaterial = null;
  }
}

function disposeObject3DTree(root) {
  if (!root) return;
  try {
    const parent = root.parent;
    if (parent && typeof parent.remove === 'function') {
      parent.remove(root);
    }
  } catch (err) {
    strictCatch(err, 'main:dispose_tree');
  }
  if (typeof root.traverse !== 'function') return;
  root.traverse((obj) => {
    if (!obj) return;
    const userData = obj.userData || null;
    const ownGeometry = userData?.ownGeometry !== false;
    if (ownGeometry && !obj.isSprite && obj.geometry && typeof obj.geometry.dispose === 'function') {
      try {
        obj.geometry.dispose();
      } catch (err) {
        strictCatch(err, 'main:dispose_tree');
      }
    }
    const material = obj.material;
    if (Array.isArray(material)) {
      for (const mat of material) {
        if (mat && !mat.userData?.pooled && typeof mat.dispose === 'function') {
          try {
            mat.dispose();
          } catch (err) {
            strictCatch(err, 'main:dispose_tree');
          }
        }
      }
    } else if (material && !material.userData?.pooled && typeof material.dispose === 'function') {
      try {
        material.dispose();
      } catch (err) {
        strictCatch(err, 'main:dispose_tree');
      }
    }
  });
}

function disposeInstancing(ctx) {
  const inst = ctx?._instancing || null;
  if (!inst) return;
  const root = inst.root;
  if (root && root.parent && typeof root.parent.remove === 'function') {
    root.parent.remove(root);
  }
  if (inst.batches instanceof Map) {
    for (const batch of inst.batches.values()) {
      const mesh = batch?.mesh || null;
      if (mesh && mesh.parent && typeof mesh.parent.remove === 'function') {
        mesh.parent.remove(mesh);
      }
    }
    inst.batches.clear();
  }
  if (inst.materials instanceof Map) {
    for (const material of inst.materials.values()) {
      if (material && typeof material.dispose === 'function') {
        material.dispose();
      }
    }
    inst.materials.clear();
  }
  if (inst.geometries instanceof Map) {
    for (const geometry of inst.geometries.values()) {
      if (geometry && typeof geometry.dispose === 'function') {
        geometry.dispose();
      }
    }
    inst.geometries.clear();
  }
  ctx._instancing = null;
  ctx.instancing = null;
  if (Array.isArray(ctx.pickables)) {
    ctx.pickables.length = 0;
  }
}

// Lightweight pooled material factory to avoid excessive material instances
class MaterialPool {
  constructor(threeNS) {
    this.THREE = threeNS;
    this.cache = new Map();
  }
  _key(spec) {
    const kind = spec.kind || 'standard';
    const color = ((spec.color ?? 0xffffff) >>> 0).toString(16);
    const rough = Math.round(((spec.roughness ?? 0.55) + Number.EPSILON) * 1000) / 1000;
    const metal = Math.round(((spec.metalness ?? 0.0) + Number.EPSILON) * 1000) / 1000;
    const wire = !!spec.wireframe;
    const forceBasic = !!spec.forceBasic;
    return `${kind}|${color}|r${rough}|m${metal}|w${wire}|b${forceBasic ? 1 : 0}`;
  }
  get(spec) {
    const key = this._key(spec);
    if (this.cache.has(key)) return this.cache.get(key);
    const T = this.THREE;
    const color = spec.color ?? 0xffffff;
    const wireframe = !!spec.wireframe;
    const forceBasic = !!spec.forceBasic;
    const mat = forceBasic
      ? new T.MeshBasicMaterial({ color, wireframe })
      : new T.MeshStandardMaterial({
          color,
          roughness: spec.roughness ?? 0.55,
          metalness: spec.metalness ?? 0.0,
          wireframe,
        });
    mat.userData = mat.userData || {};
    mat.userData.pooled = true;
    this.cache.set(key, mat);
    return mat;
  }
  disposeAll() {
    for (const m of this.cache.values()) {
      try { m.dispose?.(); } catch (err) { strictCatch(err, 'main:materialPool_dispose'); }
    }
    this.cache.clear();
  }
}

function syncRendererAssets(ctx, assets) {
  const source = assets || null;
  if (ctx.assetSource === source) return;
  ctx.assetSource = source;
  disposeInstancing(ctx);
  if (!ctx.meshes) {
    ctx.meshes = [];
    return;
  }
  for (let i = 0; i < ctx.meshes.length; i += 1) {
    if (ctx.meshes[i]) {
      disposeMeshObject(ctx.meshes[i]);
    }
  }
  ctx.meshes = [];
  if (ctx.flexGroup) {
    disposeObject3DTree(ctx.flexGroup);
    ctx.flexGroup = null;
    ctx.flexPool = [];
  }
  if (ctx.skinGroup) {
    disposeObject3DTree(ctx.skinGroup);
    ctx.skinGroup = null;
    ctx.skinPool = [];
  }
  if (ctx.assetCache && ctx.assetCache.meshGeometries instanceof Map) {
    for (const geometry of ctx.assetCache.meshGeometries.values()) {
      if (geometry && typeof geometry.dispose === 'function') {
        try {
          geometry.dispose();
        } catch (err) {
          strictCatch(err, 'main:assetCache_dispose');
        }
      }
    }
    ctx.assetCache.meshGeometries.clear();
  }
  if (ctx.assetCache && ctx.assetCache.mjTextures instanceof Map) {
    for (const texture of ctx.assetCache.mjTextures.values()) {
      if (texture && typeof texture.dispose === 'function') {
        try {
          texture.dispose();
        } catch (err) {
          strictCatch(err, 'main:assetCache_dispose');
        }
      }
    }
    ctx.assetCache.mjTextures.clear();
  }
  ctx.assetCache = {
    meshGeometries: new Map(),
    mjTextures: new Map(),
  };
}

function ensureInstancingRoot(ctx) {
  if (!ctx) return null;
  const existing = ctx._instancing || null;
  if (existing?.root) return existing;
  let created = false;
  const inst = existing || {
    root: null,
    batches: new Map(),
    geometries: new Map(),
    materials: new Map(),
    geomRefs: [],
    pickables: [],
    tmpPos: new THREE.Vector3(),
    tmpQuat: new THREE.Quaternion(),
    tmpScale: new THREE.Vector3(),
    tmpMat4: new THREE.Matrix4(),
    tmpCamPos: new THREE.Vector3(),
    tmpCamDir: new THREE.Vector3(),
  };
  if (!existing) created = true;
  if (!inst.root) {
    const group = new THREE.Group();
    group.name = 'MuJoCoInstancing';
    inst.root = group;
    if (ctx.root) ctx.root.add(group);
    created = true;
  }
  ctx._instancing = inst;
  ctx.instancing = inst;
  if (created) {
    strictEnsure('ensureInstancingRoot', { reason: 'create' });
  }
  return inst;
}

function ensureInstancedGeometry(inst, gtype) {
  if (!inst) return null;
  if (!(inst.geometries instanceof Map)) inst.geometries = new Map();
  const key = gtype | 0;
  if (inst.geometries.has(key)) return inst.geometries.get(key);
  let geometry = null;
  switch (key) {
    case MJ_GEOM.SPHERE:
    case MJ_GEOM.ELLIPSOID: {
      geometry = new THREE.SphereGeometry(1, 24, 16);
      break;
    }
    case MJ_GEOM.BOX: {
      geometry = new THREE.BoxGeometry(2, 2, 2);
      break;
    }
    case MJ_GEOM.CYLINDER: {
      geometry = new THREE.CylinderGeometry(1, 1, 2, 24, 1);
      geometry.rotateX(Math.PI / 2);
      break;
    }
    case MJ_GEOM.CAPSULE: {
      geometry = new THREE.CapsuleGeometry(1, 2, 20, 12);
      geometry.rotateX(Math.PI / 2);
      break;
    }
    default:
      return null;
  }
  computeGeometryBounds(geometry);
  inst.geometries.set(key, geometry);
  strictEnsure('ensureInstancedGeometry', { reason: 'create', geomType: key });
  return geometry;
}

function instancingIsOverlayObjType(objType) {
  const ot = objType | 0;
  return ot === MJ_OBJ.SITE || ot === MJ_OBJ.TENDON;
}

function instancingEnabledFromState(state) {
  return state?.rendering?.options?.instancing?.enabled !== false;
}

function transparentBinsFromState(state, defaultBins = 16) {
  const override = state?.rendering?.options?.transparency?.bins;
  if (!Number.isFinite(override)) return defaultBins;
  return Math.max(0, Math.min(16, override | 0));
}

function transparentSortModeFromState(state) {
  const override = state?.rendering?.options?.transparency?.sortMode;
  if (override === 'strict' || override === 'bins' || override === 'nosort') return override;
  return 'strict';
}

function ensureInstancedMaterial(
  inst,
  reflectanceQ,
  { roughnessQ = 550, metalnessQ = 0 } = {},
  { wireframe = false, opacityQ = 1000, objType = MJ_OBJ.UNKNOWN, forceBasic = false } = {}
) {
  if (!inst) return null;
  if (!(inst.materials instanceof Map)) inst.materials = new Map();
  const oq = Math.max(0, Math.min(1000, opacityQ | 0));
  const rq = Math.max(0, Math.min(1000, roughnessQ | 0));
  const mq = Math.max(0, Math.min(1000, metalnessQ | 0));
  const forceBasicFlag = !!forceBasic || instancingIsOverlayObjType(objType);
  const key = `inst:${forceBasicFlag ? 1 : 0}:o${oq}:r${reflectanceQ | 0}:ru${rq}:me${mq}`;
  if (inst.materials.has(key)) {
    const mat = inst.materials.get(key);
    if (mat && typeof mat.wireframe === 'boolean' && mat.wireframe !== !!wireframe) {
      mat.wireframe = !!wireframe;
    }
    return mat;
  }
  const opacity = oq / 1000;
  const transparent = opacity < 0.999;
  const material = forceBasicFlag
    ? new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent,
        opacity,
        depthWrite: !transparent,
        depthTest: true,
        toneMapped: false,
      })
    : new THREE.MeshStandardMaterial({
        color: 0xffffff,
        roughness: rq / 1000,
        metalness: mq / 1000,
        transparent,
        opacity,
        depthWrite: !transparent,
        depthTest: true,
      });
  material.vertexColors = true;
  material.wireframe = !!wireframe;
  if (!forceBasicFlag && 'envMapIntensity' in material) {
    material.envMapIntensity = 0;
  }
  // MuJoCo GL3 disables face culling when rendering shadow maps, while three.js flips
  // FrontSide -> BackSide by default. Using DoubleSide for the shadow pass avoids
  // contact-shadow "peter panning" gaps and matches MuJoCo's behaviour more closely.
  if ('shadowSide' in material) {
    material.shadowSide = THREE.DoubleSide;
  }
  material.userData = material.userData || {};
  material.userData.instanced = true;
  material.userData.reflectanceQ = reflectanceQ | 0;
  inst.materials.set(key, material);
  strictEnsure('ensureInstancedMaterial', { reason: 'create', key, reflectanceQ: reflectanceQ | 0, opacityQ: oq });
  return material;
}

function ensureInstancedBatch(ctx, inst, batchKey, geometry, material, capacity) {
  if (!inst || !(inst.batches instanceof Map)) return null;
  const key = String(batchKey || '');
  const cap = Math.max(1, capacity | 0);
  let batch = inst.batches.get(key) || null;
  if (batch && batch.capacity >= cap && batch.mesh) {
    if (!(batch.instanceOrderRank instanceof Int32Array) || batch.instanceOrderRank.length !== batch.capacity) {
      batch.instanceOrderRank = new Int32Array(batch.capacity);
      batch.instanceOrderRank.fill(-1);
    }
    return batch;
  }
  if (batch?.mesh && batch.mesh.parent && typeof batch.mesh.parent.remove === 'function') {
    batch.mesh.parent.remove(batch.mesh);
  }
  // NOTE: InstancedMesh mutates its geometry by attaching instanced attributes
  // (instanceMatrix/instanceColor). Do not share the same geometry object
  // between multiple InstancedMesh instances, or attributes will collide and
  // cause incorrect transforms/colors.
  const geomClone = geometry?.clone ? geometry.clone() : geometry;
  // three.js uses `material.vertexColors` to enable instance colors for InstancedMesh,
  // but the shader path also expects a per-vertex `color` attribute. When missing,
  // WebGL provides a default (0,0,0,1) which can multiply instance colors to black.
  // Provide a constant white per-vertex color attribute when needed.
  if (material?.vertexColors && geomClone?.getAttribute && geomClone?.setAttribute) {
    const hasColor = !!geomClone.getAttribute('color');
    const posAttr = geomClone.getAttribute('position') || null;
    const vcount = posAttr?.count | 0;
    if (!hasColor && vcount > 0) {
      const arr = new Uint8Array(vcount * 3);
      arr.fill(255);
      const attr = typeof THREE.Uint8BufferAttribute === 'function'
        ? new THREE.Uint8BufferAttribute(arr, 3, true)
        : new THREE.BufferAttribute(new Float32Array(arr.length).fill(1), 3);
      geomClone.setAttribute('color', attr);
    }
  }
  const mesh = new THREE.InstancedMesh(geomClone, material, cap);
  mesh.frustumCulled = false;
  mesh.count = 0;
  mesh.visible = false;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.onBeforeShadow = onBeforeShadowMuJoCo;
  if (mesh.instanceMatrix && typeof mesh.instanceMatrix.setUsage === 'function') {
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  }
  mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
  mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
  if (mesh.geometry && typeof mesh.geometry.setAttribute === 'function') {
    mesh.geometry.setAttribute('instanceColor', mesh.instanceColor);
  }
  mesh.userData = mesh.userData || {};
  mesh.userData.instanced = true;
  mesh.userData.batchKey = key;
  const instanceToGeomIndex = new Int32Array(cap);
  instanceToGeomIndex.fill(-1);
  const instanceOrderRank = new Int32Array(cap);
  instanceOrderRank.fill(-1);
  mesh.userData.instanceToGeomIndex = instanceToGeomIndex;
  if (inst.root) inst.root.add(mesh);
  batch = {
    key,
    geometry: mesh.geometry,
    material,
    mesh,
    capacity: cap,
    used: 0,
    instanceToGeomIndex,
    instanceOrderRank,
    orderMin: Number.POSITIVE_INFINITY,
    orderMax: Number.NEGATIVE_INFINITY,
  };
  inst.batches.set(key, batch);
  strictEnsure('ensureInstancedBatch', { reason: 'create', key, capacity: cap });
  return batch;
}

function sortInstancedBatchByOrderRank(inst, batch) {
  const used = batch?.used | 0;
  const mesh = batch?.mesh || null;
  if (!mesh || used <= 1) return false;
  const matrixAttr = mesh.instanceMatrix || null;
  const matrixArr = matrixAttr?.array || null;
  const colorAttr = mesh.instanceColor || null;
  const colorArr = colorAttr?.array || null;
  const geomIndexArr = batch.instanceToGeomIndex || null;
  const orderRankArr = batch.instanceOrderRank || null;
  if (!matrixArr || matrixArr.length < used * 16) return false;
  if (!geomIndexArr || geomIndexArr.length < used) return false;
  if (!orderRankArr || orderRankArr.length < used) return false;

  const cap = batch.capacity | 0;
  if (!(cap > 0)) return false;
  if (!Array.isArray(batch.sortOrder)) batch.sortOrder = [];
  if (!(batch.sortTmpMatrix instanceof Float32Array) || batch.sortTmpMatrix.length !== cap * 16) {
    batch.sortTmpMatrix = new Float32Array(cap * 16);
  }
  if (colorArr && (!(batch.sortTmpColor instanceof Float32Array) || batch.sortTmpColor.length !== cap * 3)) {
    batch.sortTmpColor = new Float32Array(cap * 3);
  }
  if (!(batch.sortTmpGeomIndex instanceof Int32Array) || batch.sortTmpGeomIndex.length !== cap) {
    batch.sortTmpGeomIndex = new Int32Array(cap);
  }
  if (!(batch.sortTmpOrderRank instanceof Int32Array) || batch.sortTmpOrderRank.length !== cap) {
    batch.sortTmpOrderRank = new Int32Array(cap);
  }

  const order = batch.sortOrder;
  order.length = used;
  for (let i = 0; i < used; i += 1) {
    order[i] = i;
  }
  order.sort((a, b) => {
    const da = orderRankArr[a] | 0;
    const db = orderRankArr[b] | 0;
    const d = da - db;
    if (d) return d;
    return a - b;
  });

  const tmpMatrix = batch.sortTmpMatrix;
  const tmpColor = batch.sortTmpColor || null;
  const tmpGeomIndex = batch.sortTmpGeomIndex;
  const tmpOrderRank = batch.sortTmpOrderRank;
  for (let newIdx = 0; newIdx < used; newIdx += 1) {
    const oldIdx = order[newIdx] | 0;
    const srcMatBase = oldIdx * 16;
    const dstMatBase = newIdx * 16;
    for (let j = 0; j < 16; j += 1) {
      tmpMatrix[dstMatBase + j] = matrixArr[srcMatBase + j];
    }
    if (colorArr && tmpColor) {
      const srcColorBase = oldIdx * 3;
      const dstColorBase = newIdx * 3;
      tmpColor[dstColorBase + 0] = colorArr[srcColorBase + 0];
      tmpColor[dstColorBase + 1] = colorArr[srcColorBase + 1];
      tmpColor[dstColorBase + 2] = colorArr[srcColorBase + 2];
    }
    tmpGeomIndex[newIdx] = geomIndexArr[oldIdx] | 0;
    tmpOrderRank[newIdx] = orderRankArr[oldIdx] | 0;
  }

  for (let i = 0; i < used * 16; i += 1) {
    matrixArr[i] = tmpMatrix[i];
  }
  if (colorArr && tmpColor) {
    for (let i = 0; i < used * 3; i += 1) {
      colorArr[i] = tmpColor[i];
    }
  }
  for (let i = 0; i < used; i += 1) {
    geomIndexArr[i] = tmpGeomIndex[i] | 0;
    orderRankArr[i] = tmpOrderRank[i] | 0;
  }

  if (inst?.geomRefs) {
    for (let instanceId = 0; instanceId < used; instanceId += 1) {
      const geomIndex = geomIndexArr[instanceId] | 0;
      if (!(geomIndex >= 0)) continue;
      const ref = inst.geomRefs[geomIndex] || null;
      if (ref && ref.kind === 'instance' && ref.mesh === mesh) {
        ref.instanceId = instanceId;
      }
    }
  }

  if (matrixAttr) matrixAttr.needsUpdate = true;
  if (colorAttr) colorAttr.needsUpdate = true;
  mesh.userData = mesh.userData || {};
  mesh.userData.instanceToGeomIndex = geomIndexArr;
  return true;
}

const GEOM_RESOLVE_TMP_WORLD_MAT4 = new THREE.Matrix4();
const GEOM_RESOLVE_TMP_INSTANCE_MAT4 = new THREE.Matrix4();
function resolveGeomWorldMatrix(ctx, geomIndex, outMat4) {
  if (!ctx || !outMat4) return false;
  const index = geomIndex | 0;
  if (!(index >= 0)) return false;
  const inst = ctx._instancing || null;
  const ref = inst?.geomRefs?.[index] || null;
  if (ref && ref.kind === 'instance' && ref.mesh && typeof ref.instanceId === 'number') {
    const instancedMesh = ref.mesh;
    const instanceId = ref.instanceId | 0;
    if (!(instanceId >= 0)) return false;
    const count = typeof instancedMesh.count === 'number' ? (instancedMesh.count | 0) : null;
    if (count != null && instanceId >= count) return false;
    if (typeof instancedMesh.getMatrixAt !== 'function') return false;
    instancedMesh.getMatrixAt(instanceId, GEOM_RESOLVE_TMP_INSTANCE_MAT4);
    outMat4.multiplyMatrices(instancedMesh.matrixWorld, GEOM_RESOLVE_TMP_INSTANCE_MAT4);
    return true;
  }
  const mesh = Array.isArray(ctx.meshes) ? ctx.meshes[index] : null;
  if (mesh?.matrixWorld) {
    outMat4.copy(mesh.matrixWorld);
    return true;
  }
  return false;
}

function resolveGeomWorldPose(ctx, geomIndex, outPos, outQuat, outScale) {
  if (!outPos || !outQuat || !outScale) return false;
  if (!resolveGeomWorldMatrix(ctx, geomIndex, GEOM_RESOLVE_TMP_WORLD_MAT4)) return false;
  GEOM_RESOLVE_TMP_WORLD_MAT4.decompose(outPos, outQuat, outScale);
  return true;
}

function getSharedMeshGeometry(ctx, assets, dataId) {
  if (!ctx.assetCache || !(ctx.assetCache.meshGeometries instanceof Map)) {
    ctx.assetCache = {
      meshGeometries: new Map(),
      mjTextures: new Map(),
    };
  }
  const cache = ctx.assetCache.meshGeometries;
  if (cache.has(dataId)) return cache.get(dataId);
  const geometry = createMeshGeometryFromAssets(assets, dataId);
  if (geometry) {
    cache.set(dataId, geometry);
  }
  return geometry || null;
}

const SEGMENT_FLAG_INDEX = 7;
const SEGMENT_PALETTE = [
  0x1f77b4, 0xff7f0e, 0x2ca02c, 0xd62728, 0x9467bd,
  0x8c564b, 0xe377c2, 0x7f7f7f, 0xbcbd22, 0x17becf,
  0xaec7e8, 0xffbb78, 0x98df8a, 0xff9896, 0xc5b0d5,
  0xc49c94, 0xf7b6d2, 0xc7c7c7, 0xdbdb8d, 0x9edae5,
];

function segmentColorForIndex(index) {
  const palette = SEGMENT_PALETTE;
  if (!(index >= 0)) return palette[0];
  return palette[index % palette.length];
}

function restoreSegmentMaterial(mesh) {
  const userData = mesh?.userData || null;
  if (!mesh || !userData || !userData.segmentMaterial || !userData.segmentOriginalMaterial) {
    return;
  }
  if (mesh.material === userData.segmentMaterial) {
    mesh.material = userData.segmentOriginalMaterial;
  }
}

function ensureSegmentMaterial(mesh, sceneFlags) {
  if (!mesh) return null;
  const userData = mesh.userData || (mesh.userData = {});
  if (!userData.segmentOriginalMaterial) {
    userData.segmentOriginalMaterial = mesh.material;
  }
  let material = userData.segmentMaterial;
  if (!material) {
    material = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      depthWrite: true,
      depthTest: true,
      toneMapped: false,
    });
    userData.segmentMaterial = material;
    strictEnsure('ensureSegmentMaterial', { reason: 'create' });
  }
  material.wireframe = false;
  return material;
}

function applyMaterialFlags(mesh, index, state, sceneFlagsOverride = null) {
  if (!mesh || !mesh.material) return;
  const sceneFlags = sceneFlagsOverride || state.rendering?.sceneFlags || [];
  mesh.material.wireframe = !!sceneFlags[1];
}

function resolveMaterialScalar(matIndex, assets, field) {
  if (!(matIndex >= 0)) return null;
  const arr = assets?.materials?.[field] || null;
  if (!arr) return null;
  const value = arr[matIndex];
  return Number.isFinite(value) ? Number(value) : null;
}

function resolveMaterialReflectance(matIndex, assets) {
  const value = resolveMaterialScalar(matIndex, assets, 'reflectance');
  if (value == null) return 0;
  return Math.max(0, value);
}

function resolveMaterialMetallic(matIndex, assets) {
  const value = resolveMaterialScalar(matIndex, assets, 'metallic');
  return value == null ? null : clampUnit(value);
}

function resolveMaterialRoughness(matIndex, assets) {
  const value = resolveMaterialScalar(matIndex, assets, 'roughness');
  return value == null ? null : clampUnit(value);
}

function resolveMaterialEmission(matIndex, assets) {
  const value = resolveMaterialScalar(matIndex, assets, 'emission');
  if (value == null) return null;
  return value > 0 ? value : 0;
}

function applyReflectanceToMaterial(mesh, ctx, reflectance, reflectionEnabled) {
  if (!mesh) return;
  mesh.userData = mesh.userData || {};
  const baseIntensity = typeof ctx?.envIntensity === 'number' ? ctx.envIntensity : 0;
  const mat = mesh.material;
  if (!mat || !('envMapIntensity' in mat)) return;
  if (!('reflectanceBaseEnvIntensity' in mesh.userData) || mesh.userData.reflectanceBaseEnvIntensity == null) {
    mesh.userData.reflectanceBaseEnvIntensity = typeof mat.envMapIntensity === 'number' ? mat.envMapIntensity : 0;
  }
  const clampedReflectance = Number.isFinite(reflectance) ? Math.max(0, reflectance) : 0;
  mesh.userData.reflectance = clampedReflectance;
  const effectiveReflectance = clampedReflectance > 0 ? clampedReflectance : 0;
  let nextEnvIntensity = mat.envMapIntensity;
  if (!reflectionEnabled || baseIntensity <= 0) {
    nextEnvIntensity = 0;
  } else {
    nextEnvIntensity = baseIntensity * effectiveReflectance;
  }
  if (Number.isFinite(nextEnvIntensity)) {
    const current = typeof mat.envMapIntensity === 'number' ? mat.envMapIntensity : 0;
    if (Math.abs(current - nextEnvIntensity) > 1e-6) {
      mat.envMapIntensity = nextEnvIntensity;
    }
  }
  if (ctx) {
    ctx._envDebugSample = {
      baseIntensity,
      reflectance: clampedReflectance,
      reflectionEnabled: !!reflectionEnabled,
      envMapIntensity: nextEnvIntensity,
    };
  }
}

function ensureGeomMesh(ctx, index, gtype, assets, dataId, sizeVec, options = {}, state = null) {
  if (!ctx.meshes) ctx.meshes = [];
  const infinitePlane = gtype === MJ_GEOM.PLANE && isInfinitePlaneSize(sizeVec);
  let mesh = ctx.meshes[index];
  if (mesh?.userData?.proxy) {
    mesh = null;
  }
  const sx = Number(sizeVec?.[0]) || 0;
  const sy = Number(sizeVec?.[1]) || 0;
  const sz = Number(sizeVec?.[2]) || 0;
  const needsSizeCheck =
    !infinitePlane &&
    (gtype !== MJ_GEOM.MESH && gtype !== MJ_GEOM.SDF);
  const hasSizeKeys =
    !!mesh &&
    !!mesh.userData &&
    typeof mesh.userData.geomSizeX === 'number' &&
    typeof mesh.userData.geomSizeY === 'number' &&
    typeof mesh.userData.geomSizeZ === 'number';
  const dynamicSizeScale = !!options.dynamicSizeScale && isDynamicSizeScaleGeomType(gtype);
  const sizeChanged =
    needsSizeCheck &&
    (!hasSizeKeys ||
      Math.abs(mesh.userData.geomSizeX - sx) > 1e-6 ||
      Math.abs(mesh.userData.geomSizeY - sy) > 1e-6 ||
      Math.abs(mesh.userData.geomSizeZ - sz) > 1e-6);
  const needsRebuild =
    !mesh ||
    mesh.userData?.geomType !== gtype ||
    (!!mesh.userData?.infinitePlane !== infinitePlane) ||
    ((gtype === MJ_GEOM.MESH || gtype === MJ_GEOM.SDF) && mesh.userData?.geomDataId !== dataId) ||
    (sizeChanged && !dynamicSizeScale);

  if (needsRebuild) {
    strictEnsure('ensureGeomMesh', {
      reason: 'rebuild',
      geomType: gtype | 0,
      geomIndex: index | 0,
      infinitePlane,
      dataId: Number.isFinite(dataId) ? (dataId | 0) : -1,
      sizeChanged: !!sizeChanged,
      dynamicSizeScale: !!dynamicSizeScale,
    });
    if (mesh) {
      disposeMeshObject(mesh);
    }

    if (infinitePlane) {
      mesh = createInfiniteGroundHelper({
        color: 0xf5f5f5,
        distance: GROUND_DISTANCE,
        renderOrder: RENDER_ORDER.GROUND,
      });
      mesh.userData = mesh.userData || {};
      mesh.userData.infinitePlane = true;
      mesh.userData.geomType = gtype;
      mesh.userData.geomDataId = -1;
      mesh.userData.geomSizeKey = 'infinite';
      mesh.userData.ownGeometry = true;
      mesh.userData.geomIndex = index;
      ctx.root.add(mesh);
      ctx.meshes[index] = mesh;
    } else {
      let geometryInfo = null;
      if ((gtype === MJ_GEOM.MESH || gtype === MJ_GEOM.SDF) && assets && dataId >= 0) {
        const meshGeometry = getSharedMeshGeometry(ctx, assets, dataId);
        if (meshGeometry) {
          geometryInfo = {
            geometry: meshGeometry,
            materialOpts: {
              color: 0xffffff,
              metalness: 0.05,
              roughness: 0.55,
            },
            postCreate: null,
            ownGeometry: false,
          };
        } else if (!ctx.meshAssetMissingLogged) {
          logDebug('[render] mesh geometry missing', { dataId });
          ctx.meshAssetMissingLogged = true;
        }
      }
      if (!geometryInfo) {
        geometryInfo = createPrimitiveGeometry(gtype, sizeVec);
        geometryInfo.ownGeometry = true;
      }
      const objectKind = geometryInfo.objectKind || 'mesh';

      let material;
      if (geometryInfo.materialOpts && geometryInfo.materialOpts.shadow) {
        const op = Number.isFinite(geometryInfo.materialOpts.shadowOpacity)
          ? geometryInfo.materialOpts.shadowOpacity
          : 0.5;
        material = new THREE.ShadowMaterial({ opacity: op });
      } else {
        const baseOpts = geometryInfo.materialOpts || {};
        const useStandard = gtype === MJ_GEOM.PLANE || gtype === MJ_GEOM.HFIELD;
        const sceneFlags = state?.rendering?.sceneFlags || [];
        const wire = !!sceneFlags[1];
        const kind = baseOpts.kind || null;
        if (objectKind === 'line' || kind === 'line') {
          material = new THREE.LineBasicMaterial({
            color: baseOpts.color ?? 0xffffff,
            transparent: true,
            opacity: 1,
            depthWrite: true,
            depthTest: true,
            toneMapped: false,
          });
        } else if (kind === 'basic') {
          material = new THREE.MeshBasicMaterial({
            color: baseOpts.color ?? 0xffffff,
            transparent: true,
            opacity: 1,
            depthWrite: true,
            depthTest: true,
            toneMapped: false,
          });
          if (baseOpts.doubleSided) {
            material.side = THREE.DoubleSide;
          }
        } else {
          const poolKey = {
            kind: useStandard ? 'standard' : 'physical',
            color: baseOpts.color ?? 0xffffff,
            roughness: baseOpts.roughness ?? 0.55,
            metalness: baseOpts.metalness ?? 0.0,
            wireframe: wire,
            forceBasic: state?.rendering?.options?.materials?.forceBasic === true,
          };
          if (!ctx.materialPool) ctx.materialPool = new MaterialPool(THREE);
          material = ctx.materialPool.get(poolKey);
          if (material && material.userData?.pooled) {
            const cloned = material.clone();
            cloned.userData = cloned.userData || {};
            cloned.userData.pooled = false;
            material = cloned;
          }
          if (!useStandard) material.envMapIntensity = 0;
        }
      }
      if (material && 'side' in material) material.side = THREE.FrontSide;
      // MuJoCo renders shadow maps with culling disabled (glDisable(GL_CULL_FACE)).
      // three.js' default shadow-side flip can introduce contact gaps; keep the
      // visible pass FrontSide but force DoubleSide for the shadow pass.
      if (material && 'shadowSide' in material) material.shadowSide = THREE.DoubleSide;
      mesh = objectKind === 'line'
        ? new THREE.LineSegments(geometryInfo.geometry, material)
        : new THREE.Mesh(geometryInfo.geometry, material);
      const isDebugGeom =
        gtype === MJ_GEOM.LINE ||
        gtype === MJ_GEOM.LINEBOX ||
        gtype === MJ_GEOM.ARROW ||
        gtype === MJ_GEOM.ARROW1 ||
        gtype === MJ_GEOM.ARROW2 ||
        gtype === MJ_GEOM.TRIANGLE;
      mesh.castShadow = !isDebugGeom;
      mesh.receiveShadow = !isDebugGeom;
      mesh.onBeforeShadow = onBeforeShadowMuJoCo;
      if (typeof geometryInfo.postCreate === 'function') {
        geometryInfo.postCreate(mesh);
      }
      mesh.userData = mesh.userData || {};
      mesh.userData.infinitePlane = false;
      mesh.userData.geomType = gtype;
      mesh.userData.geomDataId = (gtype === MJ_GEOM.MESH || gtype === MJ_GEOM.SDF) ? dataId : -1;
      mesh.userData.geomSizeX = sx;
      mesh.userData.geomSizeY = sy;
      mesh.userData.geomSizeZ = sz;
      mesh.userData.ownGeometry = geometryInfo.ownGeometry !== false;
      mesh.userData.geomIndex = index;
      ctx.root.add(mesh);
      ctx.meshes[index] = mesh;
    }
  }

  if (mesh && options.geomMeta) {
    applyGeomMetadata(mesh, options.geomMeta);
  }
  if (mesh && dynamicSizeScale) {
    ensureGeomBuiltSizes(mesh, gtype);
    mesh.userData = mesh.userData || {};
    mesh.userData.geomSizeX = sx;
    mesh.userData.geomSizeY = sy;
    mesh.userData.geomSizeZ = sz;
  }
  return mesh;
}
function ensureGeomState(context, index, geomMeta = null) {
  context.geomState = context.geomState || [];
  let existing = context.geomState[index];
  if (existing && existing.mj && existing.view) {
    if (!geomMeta) return existing;
    // Refresh mj mirror; view layer kept as-is so overrides persist across frames.
    existing.mj.type = geomMeta.type;
    existing.mj.dataId = geomMeta.dataId;
    existing.mj.matId = geomMeta.matId;
    existing.mj.groupId = geomMeta.groupId;
    existing.mj.bodyId = geomMeta.bodyId;
    if (geomMeta.size) {
      let dst = existing.mj.size;
      if (!Array.isArray(dst) || dst.length < 3) {
        dst = [0, 0, 0];
        existing.mj.size = dst;
      }
      dst[0] = Number(geomMeta.size[0]) || 0;
      dst[1] = Number(geomMeta.size[1]) || 0;
      dst[2] = Number(geomMeta.size[2]) || 0;
    } else {
      existing.mj.size = null;
    }
    if (geomMeta.rgba) {
      let dst = existing.mj.rgba;
      if (!Array.isArray(dst) || dst.length < 4) {
        dst = [0, 0, 0, 0];
        existing.mj.rgba = dst;
      }
      dst[0] = Number(geomMeta.rgba[0]) || 0;
      dst[1] = Number(geomMeta.rgba[1]) || 0;
      dst[2] = Number(geomMeta.rgba[2]) || 0;
      dst[3] = Number(geomMeta.rgba[3]) || 0;
    } else {
      existing.mj.rgba = null;
    }
    return existing;
  }
  const mj = {
    type: geomMeta?.type ?? MJ_GEOM.BOX,
    size: null,
    dataId: geomMeta?.dataId ?? -1,
    matId: geomMeta?.matId ?? -1,
    groupId: geomMeta?.groupId ?? 0,
    bodyId: geomMeta?.bodyId ?? -1,
    rgba: null,
  };
  if (geomMeta?.size) {
    mj.size = [Number(geomMeta.size[0]) || 0, Number(geomMeta.size[1]) || 0, Number(geomMeta.size[2]) || 0];
  }
  if (geomMeta?.rgba) {
    mj.rgba = [Number(geomMeta.rgba[0]) || 0, Number(geomMeta.rgba[1]) || 0, Number(geomMeta.rgba[2]) || 0, Number(geomMeta.rgba[3]) || 0];
  }
  const view = {
    visibleOverride: null,
    debugHidden: false,
    colorOverride: null,
    roughnessOverride: null,
    metalnessOverride: null,
    envMapIntensityOverride: null,
    emissiveIntensityOverride: null,
    flags: {},
    helpers: {},
    __dirty: true,
  };
  const state = { mj, view };
  context.geomState[index] = state;
  strictEnsure('ensureGeomState', {
    reason: 'create',
    geomIndex: index,
    hasMeta: !!geomMeta,
  });
  return state;
}

/**
 * Apply high-level visual properties into the JS-side geom view state.
 * This helper deliberately hides whether a property is implemented via
 * MuJoCo fields or JS-only overrides; callers should only care about
 * the semantic keys on the props object.
 *
 * Supported props (extensible):
 *   - color: number (0xRRGGBB) | [r,g,b] in 0..1
 *   - opacity: number in 0..1
 *   - roughness: number in 0..1
 *   - metallic / metalness: number in 0..1
 *   - envIntensity: number (maps to envMapIntensityOverride)
 *   - emission: number (maps to emissiveIntensityOverride where available)
 *   - visible: boolean
 */
function setGeomViewProps(context, geomIndex, props = {}) {
  if (!context || geomIndex == null) return;
  context.geomState = context.geomState || [];
  let state = context.geomState[geomIndex];
  if (!state) {
    const fallbackMeta = {
      type: MJ_GEOM.BOX,
      size: null,
      dataId: -1,
      matId: -1,
      groupId: 0,
      bodyId: -1,
      rgba: null,
    };
    strictEnsure('setGeomViewProps', {
      reason: 'fallback_meta',
      geomIndex,
    });
    state = ensureGeomState(context, geomIndex, fallbackMeta);
  }
  const view = state.view || (state.view = {});

  if (Object.prototype.hasOwnProperty.call(props, 'visible')) {
    const v = props.visible;
    if (v === true || v === false) {
      view.visibleOverride = v;
    }
  }

  if (Object.prototype.hasOwnProperty.call(props, 'color') || Object.prototype.hasOwnProperty.call(props, 'opacity')) {
    let r = 1;
    let g = 1;
    let b = 1;
    let a = 1;
    const color = props.color;
    if (typeof color === 'number' && Number.isFinite(color)) {
      const hex = color >>> 0;
      r = ((hex >> 16) & 0xff) / 255;
      g = ((hex >> 8) & 0xff) / 255;
      b = (hex & 0xff) / 255;
    } else if (Array.isArray(color) && color.length >= 3) {
      r = Number(color[0]) || 0;
      g = Number(color[1]) || 0;
      b = Number(color[2]) || 0;
    }
    if (Object.prototype.hasOwnProperty.call(props, 'opacity') && Number.isFinite(props.opacity)) {
      a = Math.max(0, Math.min(1, props.opacity));
    }
    view.colorOverride = [r, g, b, a];
  }

  if (Object.prototype.hasOwnProperty.call(props, 'roughness') && props.roughness != null) {
    view.roughnessOverride = props.roughness;
  }
  if (Object.prototype.hasOwnProperty.call(props, 'metallic') && props.metallic != null) {
    view.metalnessOverride = props.metallic;
  }
  if (Object.prototype.hasOwnProperty.call(props, 'metalness') && props.metalness != null) {
    view.metalnessOverride = props.metalness;
  }
  if (Object.prototype.hasOwnProperty.call(props, 'envIntensity') && props.envIntensity != null) {
    view.envMapIntensityOverride = props.envIntensity;
  }
  if (Object.prototype.hasOwnProperty.call(props, 'emission') && props.emission != null) {
    view.emissiveIntensityOverride = props.emission;
  }

  view.__dirty = true;
}

function updateInfinitePlaneFromSceneSoA(ctx, mesh, scnIndex, snapshot, assets, model, sceneFlags = null) {
  const groundData = mesh.userData?.infiniteGround;
  if (!groundData) return;
  const xpos = snapshot?.scn_pos;
  const xmat = snapshot?.scn_mat;
  if (!xpos || !xmat) return;
  const uniforms = groundData.uniforms || {};
  const segmentEnabled = Array.isArray(sceneFlags) ? !!sceneFlags[SEGMENT_FLAG_INDEX] : false;
  const userData = mesh.userData || (mesh.userData = {});

  const i = scnIndex | 0;
  const baseIndex = 3 * i;
  const px = xpos?.[baseIndex + 0] ?? 0;
  const py = xpos?.[baseIndex + 1] ?? 0;
  const pz = xpos?.[baseIndex + 2] ?? 0;
  const matBase = 9 * i;
  const m00 = xmat?.[matBase + 0] ?? 1;
  const m01 = xmat?.[matBase + 1] ?? 0;
  const m02 = xmat?.[matBase + 2] ?? 0;
  const m10 = xmat?.[matBase + 3] ?? 0;
  const m11 = xmat?.[matBase + 4] ?? 1;
  const m12 = xmat?.[matBase + 5] ?? 0;
  const m20 = xmat?.[matBase + 6] ?? 0;
  const m21 = xmat?.[matBase + 7] ?? 0;
  const m22 = xmat?.[matBase + 8] ?? 1;
  setQuatFromMat3(__TMP_QUAT_A, m00, m01, m02, m10, m11, m12, m20, m21, m22);
  const axisU = __TMP_VEC3_A.set(1, 0, 0).applyQuaternion(__TMP_QUAT_A).normalize();
  const axisV = __TMP_VEC3_B.set(0, 1, 0).applyQuaternion(__TMP_QUAT_A).normalize();
  const normal = __TMP_VEC3_C.set(0, 0, 1).applyQuaternion(__TMP_QUAT_A).normalize();

  // MuJoCo (engine_vis_visualize.c) re-centers infinite planes around the
  // active camera and quantizes the translation in increments tied to the
  // material texrepeat, ensuring stable wrapping without texture swimming.
  let originX = px;
  let originY = py;
  let originZ = pz;
  const sizeView = snapshot?.scn_size || null;
  const sx = sizeView ? (Number(sizeView[baseIndex + 0]) || 0) : 0;
  const sy = sizeView ? (Number(sizeView[baseIndex + 1]) || 0) : 0;
  const recenterU = sx <= 0;
  const recenterV = sy <= 0;
  const cameraPos = ctx?.camera?.position || null;
  if (cameraPos && (recenterU || recenterV)) {
    const vx = cameraPos.x - originX;
    const vy = cameraPos.y - originY;
    const vz = cameraPos.z - originZ;

    const matId = Number.isFinite(userData.matId) ? (userData.matId | 0) : -1;
    const texrepeat = assets?.materials?.texrepeat || null;
    let repeatX = (texrepeat && matId >= 0 && texrepeat.length >= (matId * 2 + 2))
      ? Number(texrepeat[matId * 2 + 0])
      : 0;
    let repeatY = (texrepeat && matId >= 0 && texrepeat.length >= (matId * 2 + 2))
      ? Number(texrepeat[matId * 2 + 1])
      : 0;
    // Mirror the `texrepeat="x"` MuJoCo XML behavior: the missing axis is 0 in
    // the model buffer, but the renderer treats it as "copy the other axis".
    if (!Number.isFinite(repeatX)) repeatX = 0;
    if (!Number.isFinite(repeatY)) repeatY = 0;
    if (repeatX === 0 && repeatY === 0) {
      repeatX = 1;
      repeatY = 1;
    } else if (repeatX === 0) {
      repeatX = repeatY;
    } else if (repeatY === 0) {
      repeatY = repeatX;
    }
    const mapZfar = Number(model?.vis?.map?.zfar);
    const extent = Number(model?.stat?.extent);
    let zfar = (Number.isFinite(mapZfar) ? mapZfar : 0) * (Number.isFinite(extent) ? extent : 1);
    if (!(Number.isFinite(zfar) && zfar > 0)) {
      const fallbackFar = Number(ctx?.camera?.far);
      zfar = Number.isFinite(fallbackFar) && fallbackFar > 0 ? fallbackFar : 1;
    }
    const fallbackStep = (2.1 * zfar) / (MJ_MAXPLANEGRID - 2);

    if (recenterU) {
      let sX = fallbackStep;
      if (repeatX > 0) sX = 2 / repeatX;
      const dX = vx * axisU.x + vy * axisU.y + vz * axisU.z;
      const stepX = 2 * sX * mjuRound(0.5 * dX / sX);
      originX += axisU.x * stepX;
      originY += axisU.y * stepX;
      originZ += axisU.z * stepX;
    }
    if (recenterV) {
      let sY = fallbackStep;
      if (repeatY > 0) sY = 2 / repeatY;
      const dY = vx * axisV.x + vy * axisV.y + vz * axisV.z;
      const stepY = 2 * sY * mjuRound(0.5 * dY / sY);
      originX += axisV.x * stepY;
      originY += axisV.y * stepY;
      originZ += axisV.z * stepY;
    }
  }
  if (uniforms.uPlaneOrigin?.value) {
    uniforms.uPlaneOrigin.value.set(originX, originY, originZ);
  }
  if (uniforms.uPlaneAxisU?.value) {
    uniforms.uPlaneAxisU.value.copy(axisU);
  }
  if (uniforms.uPlaneAxisV?.value) {
    uniforms.uPlaneAxisV.value.copy(axisV);
  }
  if (uniforms.uPlaneNormal?.value) {
    uniforms.uPlaneNormal.value.copy(normal);
  }

  // Segment view: temporarily hide the ground grid by zeroing intensity,
  // but restore original values when segment is disabled.
  if (segmentEnabled) {
    if (!userData.segmentGroundGrid) {
      userData.segmentGroundGrid = {
        step: uniforms.uGridStep ? uniforms.uGridStep.value : null,
        intensity: uniforms.uGridIntensity ? uniforms.uGridIntensity.value : null,
      };
    }
    if (uniforms.uGridStep) {
      uniforms.uGridStep.value = 0;
    }
    if (uniforms.uGridIntensity) {
      uniforms.uGridIntensity.value = 0;
    }
  } else if (userData.segmentGroundGrid) {
    const backup = userData.segmentGroundGrid;
    if (uniforms.uGridStep && backup.step != null) {
      uniforms.uGridStep.value = backup.step;
    }
    if (uniforms.uGridIntensity && backup.intensity != null) {
      uniforms.uGridIntensity.value = backup.intensity;
    }
    userData.segmentGroundGrid = null;
  }
  // Ensure infinite ground remains blended by alpha
  if (mesh.material) {
    mesh.material.transparent = true;
    if ('depthWrite' in mesh.material) mesh.material.depthWrite = true;
    if ('needsUpdate' in mesh.material) mesh.material.needsUpdate = true;
  }
}

function getDefaultVopt(ctx, state) {
  if (!state?.rendering?.voptFlags) return null;
  if (!ctx.defaultVopt) {
    ctx.defaultVopt = state.rendering.voptFlags.slice();
  }
  return ctx.defaultVopt;
}

function ensureFlexGroup(ctx) {
  if (!ctx) return null;
  if (!ctx.flexGroup) {
    const group = new THREE.Group();
    group.name = 'base:flexes';
    if (ctx.root) ctx.root.add(group);
    ctx.flexGroup = group;
    ctx.flexPool = [];
    strictEnsure('ensureFlexGroup', { reason: 'create' });
  }
  return ctx.flexGroup;
}

function hideFlexGroup(ctx) {
  if (!ctx) return;
  const group = ctx.flexGroup || null;
  if (group) group.visible = false;
  if (Array.isArray(ctx.flexPool)) {
    for (const entry of ctx.flexPool) {
      if (entry?.group) entry.group.visible = false;
    }
  }
}

function ensureFlexEntry(ctx, index, assets, state) {
  const flexAssets = assets?.flexes || null;
  const count = flexAssets?.count | 0;
  if (!(count > 0) || index < 0 || index >= count) return null;
  const group = ensureFlexGroup(ctx);
  if (!group) return null;

  const pool = Array.isArray(ctx.flexPool) ? ctx.flexPool : (ctx.flexPool = []);
  const vertnum = flexAssets?.vertnum && index < flexAssets.vertnum.length ? (flexAssets.vertnum[index] | 0) : 0;
  const edgenum = flexAssets?.edgenum && index < flexAssets.edgenum.length ? (flexAssets.edgenum[index] | 0) : 0;
  const dim = flexAssets?.dim && index < flexAssets.dim.length ? (flexAssets.dim[index] | 0) : 0;
  let entry = pool[index] || null;

  const needsRebuild = !entry || entry.vertnum !== vertnum || entry.edgenum !== edgenum || entry.dim !== dim;
  if (needsRebuild) {
    if (entry?.group) {
      disposeObject3DTree(entry.group);
    }
    const entryGroup = new THREE.Group();
    entryGroup.name = `flex:${index}`;
    entryGroup.userData = entryGroup.userData || {};
    entryGroup.userData.flexIndex = index;
    group.add(entryGroup);

    const vertexPositions = vertnum > 0 ? new Float32Array(vertnum * 3) : new Float32Array(0);

    const pointsGeom = new THREE.BufferGeometry();
    if (vertexPositions.length) {
      pointsGeom.setAttribute('position', new THREE.BufferAttribute(vertexPositions, 3));
    }
    const pointsMat = new THREE.PointsMaterial({ color: 0xffffff, size: 3, sizeAttenuation: true, transparent: true, opacity: 1 });
    const points = new THREE.Points(pointsGeom, pointsMat);
    points.frustumCulled = false;
    points.userData = points.userData || {};
    points.userData.flexKind = 'vert';
    entryGroup.add(points);

    const edgeGeom = new THREE.BufferGeometry();
    if (vertexPositions.length) {
      edgeGeom.setAttribute('position', new THREE.BufferAttribute(vertexPositions, 3));
    }
    if (edgenum > 0 && flexAssets?.edge) {
      const edgeAdr = flexAssets?.edgeadr && index < flexAssets.edgeadr.length ? (flexAssets.edgeadr[index] | 0) : 0;
      const base = Math.max(0, edgeAdr) * 2;
      const end = base + edgenum * 2;
      const edgeSrc = flexAssets.edge;
      if (end <= edgeSrc.length) {
        const indices = new Uint32Array(edgenum * 2);
        for (let i = 0; i < edgenum * 2; i += 1) {
          indices[i] = edgeSrc[base + i] >>> 0;
        }
        edgeGeom.setIndex(new THREE.BufferAttribute(indices, 1));
      }
    }
    const edgeMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 1 });
    const edges = new THREE.LineSegments(edgeGeom, edgeMat);
    edges.frustumCulled = false;
    edges.userData = edges.userData || {};
    edges.userData.flexKind = 'edge';
    entryGroup.add(edges);

    const faceGeom = new THREE.BufferGeometry();
    const faceMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.8,
      metalness: 0.0,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 1,
    });
    const faces = new THREE.Mesh(faceGeom, faceMat);
    faces.frustumCulled = false;
    faces.castShadow = false;
    faces.receiveShadow = false;
    faces.userData = faces.userData || {};
    faces.userData.flexKind = 'face';
    entryGroup.add(faces);

    entry = {
      group: entryGroup,
      points,
      edges,
      faces,
      vertexPositions,
      vertnum,
      edgenum,
      dim,
      _facePositions: null,
      _faceNormals: null,
      _vertnorm: null,
    };
    pool[index] = entry;
    strictEnsure('ensureFlexEntry', {
      reason: 'rebuild',
      flexIndex: index | 0,
      vertnum,
      edgenum,
      dim,
    });
  }

  const sceneFlags = state?.rendering?.sceneFlags || [];
  const wire = !!sceneFlags[1];
  if (entry?.faces?.material && 'wireframe' in entry.faces.material) {
    entry.faces.material.wireframe = wire;
  }

  return entry;
}

function applyFlexAppearance(entry, flexIndex, assets, ctx, textureEnabled) {
  if (!entry) return;
  const appearance = resolveFlexAppearance(flexIndex, assets || null);
  if (entry.points) applyAppearanceToMaterial(entry.points, appearance);
  if (entry.edges) applyAppearanceToMaterial(entry.edges, appearance);
  if (entry.faces) applyAppearanceToMaterial(entry.faces, appearance);
  if (entry.faces) {
    const matIdView = assets?.flexes?.matid || null;
    const matId = matIdView && flexIndex < matIdView.length ? (matIdView[flexIndex] | 0) : -1;
    entry.faces.userData = entry.faces.userData || {};
    entry.faces.userData.matId = matId;
    applyMuJoCoTextureToMesh(entry.faces, matId, ctx, assets, textureEnabled, { texcoordMode: 'explicit' });
  }
}

function normalize3Inv(x, y, z) {
  const n = Math.sqrt(x * x + y * y + z * z);
  if (!(n > 0)) return 0;
  return 1 / n;
}

function flexMakeFace(posOut, nrmOut, faceIndex, radius, vertxpos, i0, i1, i2) {
  const v0x = vertxpos[3 * i0 + 0], v0y = vertxpos[3 * i0 + 1], v0z = vertxpos[3 * i0 + 2];
  const v1x = vertxpos[3 * i1 + 0], v1y = vertxpos[3 * i1 + 1], v1z = vertxpos[3 * i1 + 2];
  const v2x = vertxpos[3 * i2 + 0], v2y = vertxpos[3 * i2 + 1], v2z = vertxpos[3 * i2 + 2];
  const v01x = v1x - v0x, v01y = v1y - v0y, v01z = v1z - v0z;
  const v02x = v2x - v0x, v02y = v2y - v0y, v02z = v2z - v0z;
  const cx = v01y * v02z - v01z * v02y;
  const cy = v01z * v02x - v01x * v02z;
  const cz = v01x * v02y - v01y * v02x;
  const inv = normalize3Inv(cx, cy, cz);
  const nx = cx * inv, ny = cy * inv, nz = cz * inv;
  const offx = radius * nx, offy = radius * ny, offz = radius * nz;
  const base = 9 * faceIndex;
  posOut[base + 0] = v0x + offx;
  posOut[base + 1] = v0y + offy;
  posOut[base + 2] = v0z + offz;
  posOut[base + 3] = v1x + offx;
  posOut[base + 4] = v1y + offy;
  posOut[base + 5] = v1z + offz;
  posOut[base + 6] = v2x + offx;
  posOut[base + 7] = v2y + offy;
  posOut[base + 8] = v2z + offz;
  for (let k = 0; k < 3; k += 1) {
    nrmOut[base + 3 * k + 0] = nx;
    nrmOut[base + 3 * k + 1] = ny;
    nrmOut[base + 3 * k + 2] = nz;
  }
}

function flexAddNormal(vertnorm, vertxpos, i0, i1, i2) {
  const v0x = vertxpos[3 * i0 + 0], v0y = vertxpos[3 * i0 + 1], v0z = vertxpos[3 * i0 + 2];
  const v1x = vertxpos[3 * i1 + 0], v1y = vertxpos[3 * i1 + 1], v1z = vertxpos[3 * i1 + 2];
  const v2x = vertxpos[3 * i2 + 0], v2y = vertxpos[3 * i2 + 1], v2z = vertxpos[3 * i2 + 2];
  const v01x = v1x - v0x, v01y = v1y - v0y, v01z = v1z - v0z;
  const v02x = v2x - v0x, v02y = v2y - v0y, v02z = v2z - v0z;
  const cx = v01y * v02z - v01z * v02y;
  const cy = v01z * v02x - v01x * v02z;
  const cz = v01x * v02y - v01y * v02x;
  const inv = normalize3Inv(cx, cy, cz);
  const nx = cx * inv, ny = cy * inv, nz = cz * inv;
  vertnorm[3 * i0 + 0] += nx; vertnorm[3 * i0 + 1] += ny; vertnorm[3 * i0 + 2] += nz;
  vertnorm[3 * i1 + 0] += nx; vertnorm[3 * i1 + 1] += ny; vertnorm[3 * i1 + 2] += nz;
  vertnorm[3 * i2 + 0] += nx; vertnorm[3 * i2 + 1] += ny; vertnorm[3 * i2 + 2] += nz;
}

function flexMakeSmooth(posOut, nrmOut, faceIndex, radius, flgFlat, vertnorm, vertxpos, i0, i1, i2) {
  const base = 9 * faceIndex;
  const sign = radius > 0 ? 1 : -1;
  const ind0 = i0 | 0, ind1 = i1 | 0, ind2 = i2 | 0;
  if (flgFlat) {
    const v0x = vertxpos[3 * ind0 + 0], v0y = vertxpos[3 * ind0 + 1], v0z = vertxpos[3 * ind0 + 2];
    const v1x = vertxpos[3 * ind1 + 0], v1y = vertxpos[3 * ind1 + 1], v1z = vertxpos[3 * ind1 + 2];
    const v2x = vertxpos[3 * ind2 + 0], v2y = vertxpos[3 * ind2 + 1], v2z = vertxpos[3 * ind2 + 2];
    const v01x = v1x - v0x, v01y = v1y - v0y, v01z = v1z - v0z;
    const v02x = v2x - v0x, v02y = v2y - v0y, v02z = v2z - v0z;
    const cx = v01y * v02z - v01z * v02y;
    const cy = v01z * v02x - v01x * v02z;
    const cz = v01x * v02y - v01y * v02x;
    const inv = normalize3Inv(cx, cy, cz);
    const nx = cx * inv, ny = cy * inv, nz = cz * inv;
    for (let k = 0; k < 3; k += 1) {
      nrmOut[base + 3 * k + 0] = sign * nx;
      nrmOut[base + 3 * k + 1] = sign * ny;
      nrmOut[base + 3 * k + 2] = sign * nz;
    }
  } else {
    const ix = [ind0, ind1, ind2];
    for (let k = 0; k < 3; k += 1) {
      const vid = ix[k];
      nrmOut[base + 3 * k + 0] = sign * vertnorm[3 * vid + 0];
      nrmOut[base + 3 * k + 1] = sign * vertnorm[3 * vid + 1];
      nrmOut[base + 3 * k + 2] = sign * vertnorm[3 * vid + 2];
    }
  }
  const ix = [ind0, ind1, ind2];
  for (let k = 0; k < 3; k += 1) {
    const vid = ix[k];
    posOut[base + 3 * k + 0] = vertxpos[3 * vid + 0] + radius * vertnorm[3 * vid + 0];
    posOut[base + 3 * k + 1] = vertxpos[3 * vid + 1] + radius * vertnorm[3 * vid + 1];
    posOut[base + 3 * k + 2] = vertxpos[3 * vid + 2] + radius * vertnorm[3 * vid + 2];
  }
}

function flexMakeSide(posOut, nrmOut, faceIndex, radius, vertnorm, vertxpos, i0, i1) {
  const base = 9 * faceIndex;
  const v0x = vertxpos[3 * i0 + 0], v0y = vertxpos[3 * i0 + 1], v0z = vertxpos[3 * i0 + 2];
  const v1x = vertxpos[3 * i1 + 0], v1y = vertxpos[3 * i1 + 1], v1z = vertxpos[3 * i1 + 2];
  const v01x = v1x - v0x, v01y = v1y - v0y, v01z = v1z - v0z;
  const vn1x = vertnorm[3 * i1 + 0], vn1y = vertnorm[3 * i1 + 1], vn1z = vertnorm[3 * i1 + 2];
  let cx = v01y * vn1z - v01z * vn1y;
  let cy = v01z * vn1x - v01x * vn1z;
  let cz = v01x * vn1y - v01y * vn1x;
  if (radius < 0) {
    cx = -cx; cy = -cy; cz = -cz;
  }
  const inv = normalize3Inv(cx, cy, cz);
  const nx = cx * inv, ny = cy * inv, nz = cz * inv;
  for (let k = 0; k < 3; k += 1) {
    nrmOut[base + 3 * k + 0] = nx;
    nrmOut[base + 3 * k + 1] = ny;
    nrmOut[base + 3 * k + 2] = nz;
  }
  const ind = [i0 | 0, i1 | 0, i1 | 0];
  for (let k = 0; k < 3; k += 1) {
    const sign = k === 1 ? -1 : 1;
    const vid = ind[k];
    posOut[base + 3 * k + 0] = vertxpos[3 * vid + 0] + sign * radius * vertnorm[3 * vid + 0];
    posOut[base + 3 * k + 1] = vertxpos[3 * vid + 1] + sign * radius * vertnorm[3 * vid + 1];
    posOut[base + 3 * k + 2] = vertxpos[3 * vid + 2] + sign * radius * vertnorm[3 * vid + 2];
  }
}

function fillFlexFaceTexcoords(uvOut, faceIndex, texcoordArr, baseOffset, texcoordLength, i0, i1, i2) {
  if (!uvOut || !texcoordArr || baseOffset < 0) return;
  const destBase = faceIndex * 6;
  const writeUV = (destOffset, texIdx) => {
    const idx = Number.isFinite(texIdx) ? (texIdx | 0) : -1;
    const outIndex = destBase + destOffset;
    if (idx < 0) {
      uvOut[outIndex] = 0;
      uvOut[outIndex + 1] = 0;
      return;
    }
    const srcIndex = baseOffset + idx * 2;
    if (srcIndex + 1 >= texcoordLength) {
      uvOut[outIndex] = 0;
      uvOut[outIndex + 1] = 0;
      return;
    }
    uvOut[outIndex] = texcoordArr[srcIndex];
    uvOut[outIndex + 1] = texcoordArr[srcIndex + 1];
  };
  writeUV(0, i0);
  writeUV(2, i1);
  writeUV(4, i2);
}

function updateFlexFaces(entry, flexIndex, snapshot, state, assets, useSkin, flexLayer) {
  const flexAssets = assets?.flexes || null;
  if (!entry || !flexAssets) return;
  const dim = entry.dim | 0;
  if (dim === 1) {
    entry.faces.visible = false;
    return;
  }
  const ensureAttribute = (geom, name, array, itemSize) => {
    if (!geom || !array) return null;
    const existing = geom.getAttribute?.(name) || geom.attributes?.[name] || null;
    if (existing && existing.array === array && existing.itemSize === itemSize) {
      existing.needsUpdate = true;
      return existing;
    }
    const attr = new THREE.BufferAttribute(array, itemSize);
    if (typeof attr.setUsage === 'function') attr.setUsage(THREE.DynamicDrawUsage);
    geom.setAttribute(name, attr);
    attr.needsUpdate = true;
    return attr;
  };
  const flexLayerValue = Number.isFinite(flexLayer) ? (flexLayer | 0) : 0;
  const elemLayerArr = flexAssets?.elemlayer || null;
  const elemAdr = flexAssets?.elemadr && flexIndex < flexAssets.elemadr.length ? (flexAssets.elemadr[flexIndex] | 0) : 0;
  const texcoordArr = flexAssets?.texcoord || null;
  const texcoordAdr = flexAssets?.texcoordadr && flexIndex < flexAssets.texcoordadr.length ? (flexAssets.texcoordadr[flexIndex] | 0) : -1;
  const texcoordBaseOffset = texcoordAdr >= 0 ? Math.max(0, texcoordAdr) * 2 : -1;
  const texcoordLength = texcoordArr?.length || 0;
  const elemTexcoordArr = flexAssets?.elemtexcoord || null;
  const vertadr = flexAssets?.vertadr && flexIndex < flexAssets.vertadr.length ? (flexAssets.vertadr[flexIndex] | 0) : 0;
  const vertnum = entry.vertnum | 0;
  if (!(vertnum > 0)) {
    entry.faces.visible = false;
    return;
  }
  const srcAll = snapshot?.flexvert_xpos || null;
  const base = Math.max(0, vertadr) * 3;
  const end = base + vertnum * 3;
  if (!srcAll || end > srcAll.length) {
    entry.faces.visible = false;
    return;
  }
  const vertxpos = srcAll.subarray(base, end);
  const radius = flexAssets?.radius && flexIndex < flexAssets.radius.length ? Number(flexAssets.radius[flexIndex]) || 0 : 0;
  const flgFlat = flexAssets?.flatskin && flexIndex < flexAssets.flatskin.length ? (flexAssets.flatskin[flexIndex] ? 1 : 0) : 0;

  let nface = 0;
  if (!useSkin) {
    if (dim === 2) {
      const elemnum = flexAssets?.elemnum && flexIndex < flexAssets.elemnum.length ? (flexAssets.elemnum[flexIndex] | 0) : 0;
      nface = Math.max(0, elemnum) * 2;
    } else if (dim === 3) {
      const elemnum = flexAssets?.elemnum && flexIndex < flexAssets.elemnum.length ? (flexAssets.elemnum[flexIndex] | 0) : 0;
      nface = Math.max(0, elemnum) * 4;
    }
  } else {
    if (dim === 2) {
      const elemnum = flexAssets?.elemnum && flexIndex < flexAssets.elemnum.length ? (flexAssets.elemnum[flexIndex] | 0) : 0;
      const shellnum = flexAssets?.shellnum && flexIndex < flexAssets.shellnum.length ? (flexAssets.shellnum[flexIndex] | 0) : 0;
      nface = Math.max(0, elemnum) * 2 + Math.max(0, shellnum) * 2;
    } else if (dim === 3) {
      const shellnum = flexAssets?.shellnum && flexIndex < flexAssets.shellnum.length ? (flexAssets.shellnum[flexIndex] | 0) : 0;
      nface = Math.max(0, shellnum);
    }
  }
  if (!(nface > 0)) {
    entry.faces.visible = false;
    return;
  }

  const needed = nface * 9;
  let posOut = entry._facePositions;
  let nrmOut = entry._faceNormals;
  if (!posOut || posOut.length !== needed) posOut = new Float32Array(needed);
  if (!nrmOut || nrmOut.length !== needed) nrmOut = new Float32Array(needed);
  entry._facePositions = posOut;
  entry._faceNormals = nrmOut;
  const uvNeeded = nface * 6;
  let uvOut = entry._faceTexcoords;
  if (!uvOut || uvOut.length !== uvNeeded) {
    uvOut = new Float32Array(uvNeeded);
  }
  entry._faceTexcoords = uvOut;

  const elemArr = flexAssets?.elem || null;
  const shellArr = flexAssets?.shell || null;
  if (!elemArr && !shellArr) {
    entry.faces.visible = false;
    return;
  }

  let cursor = 0;
  if (!useSkin) {
    const elemnum = flexAssets?.elemnum && flexIndex < flexAssets.elemnum.length ? (flexAssets.elemnum[flexIndex] | 0) : 0;
    const elemdataadr = flexAssets?.elemdataadr && flexIndex < flexAssets.elemdataadr.length ? (flexAssets.elemdataadr[flexIndex] | 0) : 0;
    const baseElem = Math.max(0, elemdataadr);
    const elemLayerBase = Math.max(0, elemAdr);
    const elemStride = dim + 1;
    if (dim === 2 && elemArr) {
      for (let e = 0; e < elemnum; e += 1) {
        const layerIdx = elemLayerBase + e;
        const showElement =
          dim === 2 ||
          (elemLayerArr && elemLayerArr.length > layerIdx && elemLayerArr[layerIdx] === flexLayerValue);
        if (!showElement) continue;
        const off = baseElem + e * elemStride;
        const i0 = elemArr[off + 0] | 0;
        const i1 = elemArr[off + 1] | 0;
        const i2 = elemArr[off + 2] | 0;
        const texBase = baseElem + e * elemStride;
        const hasTexIndices = elemTexcoordArr && texBase + elemStride <= elemTexcoordArr.length;
        const tex0Raw = hasTexIndices ? elemTexcoordArr[texBase + 0] : null;
        const tex1Raw = hasTexIndices ? elemTexcoordArr[texBase + 1] : null;
        const tex2Raw = hasTexIndices ? elemTexcoordArr[texBase + 2] : null;
        const tex0 = (hasTexIndices && Number.isFinite(tex0Raw)) ? (tex0Raw | 0) : i0;
        const tex1 = (hasTexIndices && Number.isFinite(tex1Raw)) ? (tex1Raw | 0) : i1;
        const tex2 = (hasTexIndices && Number.isFinite(tex2Raw)) ? (tex2Raw | 0) : i2;
        flexMakeFace(posOut, nrmOut, cursor++, radius, vertxpos, i0, i1, i2);
        fillFlexFaceTexcoords(
          uvOut,
          cursor - 1,
          texcoordArr,
          texcoordBaseOffset,
          texcoordLength,
          tex0,
          tex1,
          tex2,
        );
        flexMakeFace(posOut, nrmOut, cursor++, radius, vertxpos, i0, i2, i1);
        fillFlexFaceTexcoords(
          uvOut,
          cursor - 1,
          texcoordArr,
          texcoordBaseOffset,
          texcoordLength,
          tex0,
          tex2,
          tex1,
        );
      }
    } else if (dim === 3 && elemArr) {
      for (let e = 0; e < elemnum; e += 1) {
        const layerIdx = elemLayerBase + e;
        const showElement =
          dim === 2 ||
          (elemLayerArr && elemLayerArr.length > layerIdx && elemLayerArr[layerIdx] === flexLayerValue);
        if (!showElement) continue;
        const off = baseElem + e * elemStride;
        const i0 = elemArr[off + 0] | 0;
        const i1 = elemArr[off + 1] | 0;
        const i2 = elemArr[off + 2] | 0;
        const i3 = elemArr[off + 3] | 0;
        const texBase = baseElem + e * elemStride;
        const hasTexIndices = elemTexcoordArr && texBase + elemStride <= elemTexcoordArr.length;
        const tex0Raw = hasTexIndices ? elemTexcoordArr[texBase + 0] : null;
        const tex1Raw = hasTexIndices ? elemTexcoordArr[texBase + 1] : null;
        const tex2Raw = hasTexIndices ? elemTexcoordArr[texBase + 2] : null;
        const tex3Raw = hasTexIndices ? elemTexcoordArr[texBase + 3] : null;
        const tex0 = (hasTexIndices && Number.isFinite(tex0Raw)) ? (tex0Raw | 0) : i0;
        const tex1 = (hasTexIndices && Number.isFinite(tex1Raw)) ? (tex1Raw | 0) : i1;
        const tex2 = (hasTexIndices && Number.isFinite(tex2Raw)) ? (tex2Raw | 0) : i2;
        const tex3 = (hasTexIndices && Number.isFinite(tex3Raw)) ? (tex3Raw | 0) : i3;
        flexMakeFace(posOut, nrmOut, cursor++, radius, vertxpos, i0, i1, i2);
        fillFlexFaceTexcoords(
          uvOut,
          cursor - 1,
          texcoordArr,
          texcoordBaseOffset,
          texcoordLength,
          tex0,
          tex1,
          tex2,
        );
        flexMakeFace(posOut, nrmOut, cursor++, radius, vertxpos, i0, i2, i3);
        fillFlexFaceTexcoords(
          uvOut,
          cursor - 1,
          texcoordArr,
          texcoordBaseOffset,
          texcoordLength,
          tex0,
          tex2,
          tex3,
        );
        flexMakeFace(posOut, nrmOut, cursor++, radius, vertxpos, i0, i3, i1);
        fillFlexFaceTexcoords(
          uvOut,
          cursor - 1,
          texcoordArr,
          texcoordBaseOffset,
          texcoordLength,
          tex0,
          tex3,
          tex1,
        );
        flexMakeFace(posOut, nrmOut, cursor++, radius, vertxpos, i1, i3, i2);
        fillFlexFaceTexcoords(
          uvOut,
          cursor - 1,
          texcoordArr,
          texcoordBaseOffset,
          texcoordLength,
          tex1,
          tex3,
          tex2,
        );
      }
    }
  } else {
    let vertnorm = entry._vertnorm || null;
    const neededNrm = vertnum * 3;
    if (!vertnorm || vertnorm.length !== neededNrm) {
      vertnorm = new Float32Array(neededNrm);
      entry._vertnorm = vertnorm;
    } else {
      vertnorm.fill(0);
    }
    const elemnum = flexAssets?.elemnum && flexIndex < flexAssets.elemnum.length ? (flexAssets.elemnum[flexIndex] | 0) : 0;
    const elemdataadr = flexAssets?.elemdataadr && flexIndex < flexAssets.elemdataadr.length ? (flexAssets.elemdataadr[flexIndex] | 0) : 0;
    const shellnum = flexAssets?.shellnum && flexIndex < flexAssets.shellnum.length ? (flexAssets.shellnum[flexIndex] | 0) : 0;
    const shelldataadr = flexAssets?.shelldataadr && flexIndex < flexAssets.shelldataadr.length ? (flexAssets.shelldataadr[flexIndex] | 0) : 0;
    const baseElem = Math.max(0, elemdataadr);
    const baseShell = Math.max(0, shelldataadr);
    const elemStride = dim + 1;

    if (dim === 2 && elemArr) {
      for (let e = 0; e < elemnum; e += 1) {
        const off = baseElem + e * 3;
        flexAddNormal(vertnorm, vertxpos, elemArr[off + 0] | 0, elemArr[off + 1] | 0, elemArr[off + 2] | 0);
      }
    } else if (dim === 3 && shellArr) {
      for (let s = 0; s < shellnum; s += 1) {
        const off = baseShell + s * 3;
        flexAddNormal(vertnorm, vertxpos, shellArr[off + 0] | 0, shellArr[off + 1] | 0, shellArr[off + 2] | 0);
      }
    }
    for (let i = 0; i < vertnum; i += 1) {
      const nx = vertnorm[3 * i + 0], ny = vertnorm[3 * i + 1], nz = vertnorm[3 * i + 2];
      const inv = normalize3Inv(nx, ny, nz);
      vertnorm[3 * i + 0] = nx * inv;
      vertnorm[3 * i + 1] = ny * inv;
      vertnorm[3 * i + 2] = nz * inv;
    }
    if (dim === 2 && elemArr) {
      for (let e = 0; e < elemnum; e += 1) {
        const off = baseElem + e * elemStride;
        const i0 = elemArr[off + 0] | 0;
        const i1 = elemArr[off + 1] | 0;
        const i2 = elemArr[off + 2] | 0;
        const texBase = baseElem + e * elemStride;
        const hasTexIndices = elemTexcoordArr && texBase + elemStride <= elemTexcoordArr.length;
        const tex0Raw = hasTexIndices ? elemTexcoordArr[texBase + 0] : null;
        const tex1Raw = hasTexIndices ? elemTexcoordArr[texBase + 1] : null;
        const tex2Raw = hasTexIndices ? elemTexcoordArr[texBase + 2] : null;
        const tex0 = (hasTexIndices && Number.isFinite(tex0Raw)) ? (tex0Raw | 0) : i0;
        const tex1 = (hasTexIndices && Number.isFinite(tex1Raw)) ? (tex1Raw | 0) : i1;
        const tex2 = (hasTexIndices && Number.isFinite(tex2Raw)) ? (tex2Raw | 0) : i2;
        flexMakeSmooth(posOut, nrmOut, cursor++, radius, flgFlat, vertnorm, vertxpos, i0, i1, i2);
        fillFlexFaceTexcoords(
          uvOut,
          cursor - 1,
          texcoordArr,
          texcoordBaseOffset,
          texcoordLength,
          tex0,
          tex1,
          tex2,
        );
        flexMakeSmooth(posOut, nrmOut, cursor++, -radius, flgFlat, vertnorm, vertxpos, i0, i2, i1);
        fillFlexFaceTexcoords(
          uvOut,
          cursor - 1,
          texcoordArr,
          texcoordBaseOffset,
          texcoordLength,
          tex0,
          tex2,
          tex1,
        );
      }
    } else if (dim === 3 && shellArr) {
      for (let s = 0; s < shellnum; s += 1) {
        const off = baseShell + s * 3;
        const i0 = shellArr[off + 0] | 0;
        const i1 = shellArr[off + 1] | 0;
        const i2 = shellArr[off + 2] | 0;
        flexMakeSmooth(posOut, nrmOut, cursor++, radius, flgFlat, vertnorm, vertxpos, i0, i1, i2);
        fillFlexFaceTexcoords(uvOut, cursor - 1, texcoordArr, texcoordBaseOffset, texcoordLength, i0, i1, i2);
      }
    }
    if (dim === 2 && shellArr) {
      for (let s = 0; s < shellnum; s += 1) {
        const off = baseShell + s * 2;
        const i0 = shellArr[off + 0] | 0;
        const i1 = shellArr[off + 1] | 0;
        flexMakeSide(posOut, nrmOut, cursor++, radius, vertnorm, vertxpos, i0, i1);
        fillFlexFaceTexcoords(uvOut, cursor - 1, texcoordArr, texcoordBaseOffset, texcoordLength, i0, i1, i1);
        flexMakeSide(posOut, nrmOut, cursor++, -radius, vertnorm, vertxpos, i1, i0);
        fillFlexFaceTexcoords(uvOut, cursor - 1, texcoordArr, texcoordBaseOffset, texcoordLength, i1, i0, i0);
      }
    }
  }

  const geom = entry.faces.geometry;
  ensureAttribute(geom, 'position', posOut, 3);
  ensureAttribute(geom, 'normal', nrmOut, 3);
  ensureAttribute(geom, 'uv', uvOut, 2);
  if (typeof geom.setDrawRange === 'function') {
    geom.setDrawRange(0, Math.max(0, cursor) * 3);
  }
  entry.faces.visible = true;
}

function ensureSkinGroup(ctx) {
  if (!ctx) return null;
  if (!ctx.skinGroup) {
    const group = new THREE.Group();
    group.name = 'base:skins';
    if (ctx.root) ctx.root.add(group);
    ctx.skinGroup = group;
    ctx.skinPool = [];
    strictEnsure('ensureSkinGroup', { reason: 'create' });
  }
  return ctx.skinGroup;
}

function hideSkinGroup(ctx) {
  if (!ctx) return;
  const group = ctx.skinGroup || null;
  if (group) group.visible = false;
  if (Array.isArray(ctx.skinPool)) {
    for (const entry of ctx.skinPool) {
      if (entry?.mesh) entry.mesh.visible = false;
    }
  }
}

function ensureSkinEntry(ctx, index, assets, state) {
  const skinAssets = assets?.skins || null;
  const count = skinAssets?.count | 0;
  if (!(count > 0) || index < 0 || index >= count) return null;
  const group = ensureSkinGroup(ctx);
  if (!group) return null;

  const pool = Array.isArray(ctx.skinPool) ? ctx.skinPool : (ctx.skinPool = []);
  const vertnum = skinAssets?.vertnum && index < skinAssets.vertnum.length ? (skinAssets.vertnum[index] | 0) : 0;
  const facenum = skinAssets?.facenum && index < skinAssets.facenum.length ? (skinAssets.facenum[index] | 0) : 0;
  let entry = pool[index] || null;

  const needsRebuild = !entry || entry.vertnum !== vertnum || entry.facenum !== facenum;
  if (needsRebuild) {
    if (entry?.mesh) {
      disposeMeshObject(entry.mesh);
    }
    const geometry = new THREE.BufferGeometry();
    const positions = vertnum > 0 ? new Float32Array(vertnum * 3) : new Float32Array(0);
    const normals = vertnum > 0 ? new Float32Array(vertnum * 3) : new Float32Array(0);
    const positionAttr = new THREE.BufferAttribute(positions, 3);
    const normalAttr = new THREE.BufferAttribute(normals, 3);
    geometry.setAttribute('position', positionAttr);
    geometry.setAttribute('normal', normalAttr);
    const uvArray = vertnum > 0 ? new Float32Array(vertnum * 2) : new Float32Array(0);
    const uvAttr = new THREE.BufferAttribute(uvArray, 2);
    geometry.setAttribute('uv', uvAttr);

    if (facenum > 0 && skinAssets?.face) {
      const faceadr = skinAssets?.faceadr && index < skinAssets.faceadr.length ? (skinAssets.faceadr[index] | 0) : 0;
      const base = Math.max(0, faceadr) * 3;
      const end = base + facenum * 3;
      const src = skinAssets.face;
      if (end <= src.length) {
        const indices = new Uint32Array(facenum * 3);
        for (let i = 0; i < facenum * 3; i += 1) {
          indices[i] = src[base + i] >>> 0;
        }
        geometry.setIndex(new THREE.BufferAttribute(indices, 1));
      }
    }

    const sceneFlags = state?.rendering?.sceneFlags || [];
    const wire = !!sceneFlags[1];
    const material = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.8,
      metalness: 0.0,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 1,
      wireframe: wire,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.frustumCulled = false;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.userData = mesh.userData || {};
    mesh.userData.skinIndex = index;
    group.add(mesh);

    entry = {
      mesh,
      geometry,
      positionAttr,
      normalAttr,
      positions,
      normals,
      vertnum,
      facenum,
      _tmpBindMat: new Float32Array(9),
      _tmpBindInv: new Float32Array(9),
      uvAttr,
      uvs: uvArray,
    };
    pool[index] = entry;
    strictEnsure('ensureSkinEntry', {
      reason: 'rebuild',
      skinIndex: index | 0,
      vertnum,
      facenum,
    });
  }

  const sceneFlags = state?.rendering?.sceneFlags || [];
  const wire = !!sceneFlags[1];
  if (entry?.mesh?.material && 'wireframe' in entry.mesh.material) {
    entry.mesh.material.wireframe = wire;
  }

  return entry;
}

function applySkinAppearance(entry, skinIndex, assets, ctx, textureEnabled) {
  if (!entry?.mesh) return;
  const appearance = resolveSkinAppearance(skinIndex, assets || null);
  applyAppearanceToMaterial(entry.mesh, appearance);
  const matIdView = assets?.skins?.matid || null;
  const matId = matIdView && skinIndex < matIdView.length ? (matIdView[skinIndex] | 0) : -1;
  entry.mesh.userData = entry.mesh.userData || {};
  entry.mesh.userData.matId = matId;
  applyMuJoCoTextureToMesh(entry.mesh, matId, ctx, assets, textureEnabled, { texcoordMode: 'explicit' });
}

function quatToMat3(w, x, y, z, out) {
  const x2 = x + x;
  const y2 = y + y;
  const z2 = z + z;
  const xx = x * x2;
  const xy = x * y2;
  const xz = x * z2;
  const yy = y * y2;
  const yz = y * z2;
  const zz = z * z2;
  const wx = w * x2;
  const wy = w * y2;
  const wz = w * z2;
  out[0] = 1 - (yy + zz);
  out[1] = xy - wz;
  out[2] = xz + wy;
  out[3] = xy + wz;
  out[4] = 1 - (xx + zz);
  out[5] = yz - wx;
  out[6] = xz - wy;
  out[7] = yz + wx;
  out[8] = 1 - (xx + yy);
  return out;
}

function updateSkinMesh(entry, skinIndex, snapshot, assets) {
  const skinAssets = assets?.skins || null;
  if (!entry || !skinAssets) return false;
  const bxpos = snapshot?.bxpos || null;
  const bxmat = snapshot?.bxmat || null;
  if (!bxpos || !bxmat) return false;

  const vertadr = skinAssets?.vertadr && skinIndex < skinAssets.vertadr.length ? (skinAssets.vertadr[skinIndex] | 0) : 0;
  const vertnum = entry.vertnum | 0;
  const boneadr = skinAssets?.boneadr && skinIndex < skinAssets.boneadr.length ? (skinAssets.boneadr[skinIndex] | 0) : 0;
  const bonenum = skinAssets?.bonenum && skinIndex < skinAssets.bonenum.length ? (skinAssets.bonenum[skinIndex] | 0) : 0;
  const faceadr = skinAssets?.faceadr && skinIndex < skinAssets.faceadr.length ? (skinAssets.faceadr[skinIndex] | 0) : 0;
  const facenum = entry.facenum | 0;

  const srcVert = skinAssets?.vert || null;
  const srcFace = skinAssets?.face || null;
  const bonevertadr = skinAssets?.bonevertadr || null;
  const bonevertnum = skinAssets?.bonevertnum || null;
  const bonebindpos = skinAssets?.bonebindpos || null;
  const bonebindquat = skinAssets?.bonebindquat || null;
  const bonebodyid = skinAssets?.bonebodyid || null;
  const bonevertid = skinAssets?.bonevertid || null;
  const bonevertweight = skinAssets?.bonevertweight || null;
  if (!srcVert || !srcFace || !bonevertadr || !bonevertnum || !bonebindpos || !bonebindquat || !bonebodyid || !bonevertid || !bonevertweight) {
    return false;
  }

  const positions = entry.positions;
  const normals = entry.normals;
  positions.fill(0);
  normals.fill(0);

  const bindMat = entry._tmpBindMat || (entry._tmpBindMat = new Float32Array(9));
  const bindInv = entry._tmpBindInv || (entry._tmpBindInv = new Float32Array(9));

  for (let j = boneadr; j < boneadr + bonenum; j += 1) {
    const bodyId = bonebodyid[j] | 0;
    const bmatBase = 9 * bodyId;
    const bposBase = 3 * bodyId;

    const bw = bonebindquat[4 * j + 0] || 0;
    const bx = bonebindquat[4 * j + 1] || 0;
    const by = bonebindquat[4 * j + 2] || 0;
    const bz = bonebindquat[4 * j + 3] || 0;
    quatToMat3(bw, bx, by, bz, bindMat);
    // inverse for unit rotation: transpose
    bindInv[0] = bindMat[0]; bindInv[1] = bindMat[3]; bindInv[2] = bindMat[6];
    bindInv[3] = bindMat[1]; bindInv[4] = bindMat[4]; bindInv[5] = bindMat[7];
    bindInv[6] = bindMat[2]; bindInv[7] = bindMat[5]; bindInv[8] = bindMat[8];

    const r00 = bxmat[bmatBase + 0] * bindInv[0] + bxmat[bmatBase + 1] * bindInv[3] + bxmat[bmatBase + 2] * bindInv[6];
    const r01 = bxmat[bmatBase + 0] * bindInv[1] + bxmat[bmatBase + 1] * bindInv[4] + bxmat[bmatBase + 2] * bindInv[7];
    const r02 = bxmat[bmatBase + 0] * bindInv[2] + bxmat[bmatBase + 1] * bindInv[5] + bxmat[bmatBase + 2] * bindInv[8];
    const r10 = bxmat[bmatBase + 3] * bindInv[0] + bxmat[bmatBase + 4] * bindInv[3] + bxmat[bmatBase + 5] * bindInv[6];
    const r11 = bxmat[bmatBase + 3] * bindInv[1] + bxmat[bmatBase + 4] * bindInv[4] + bxmat[bmatBase + 5] * bindInv[7];
    const r12 = bxmat[bmatBase + 3] * bindInv[2] + bxmat[bmatBase + 4] * bindInv[5] + bxmat[bmatBase + 5] * bindInv[8];
    const r20 = bxmat[bmatBase + 6] * bindInv[0] + bxmat[bmatBase + 7] * bindInv[3] + bxmat[bmatBase + 8] * bindInv[6];
    const r21 = bxmat[bmatBase + 6] * bindInv[1] + bxmat[bmatBase + 7] * bindInv[4] + bxmat[bmatBase + 8] * bindInv[7];
    const r22 = bxmat[bmatBase + 6] * bindInv[2] + bxmat[bmatBase + 7] * bindInv[5] + bxmat[bmatBase + 8] * bindInv[8];

    const bindpx = bonebindpos[3 * j + 0] || 0;
    const bindpy = bonebindpos[3 * j + 1] || 0;
    const bindpz = bonebindpos[3 * j + 2] || 0;
    const tx = (bxpos[bposBase + 0] || 0) - (r00 * bindpx + r01 * bindpy + r02 * bindpz);
    const ty = (bxpos[bposBase + 1] || 0) - (r10 * bindpx + r11 * bindpy + r12 * bindpz);
    const tz = (bxpos[bposBase + 2] || 0) - (r20 * bindpx + r21 * bindpy + r22 * bindpz);

    const k0 = bonevertadr[j] | 0;
    const kN = bonevertnum[j] | 0;
    for (let k = k0; k < k0 + kN; k += 1) {
      const vid = bonevertid[k] | 0;
      const wgt = bonevertweight[k] || 0;
      const srcBase = 3 * (vertadr + vid);
      const px = srcVert[srcBase + 0] || 0;
      const py = srcVert[srcBase + 1] || 0;
      const pz = srcVert[srcBase + 2] || 0;
      const px1 = r00 * px + r01 * py + r02 * pz + tx;
      const py1 = r10 * px + r11 * py + r12 * pz + ty;
      const pz1 = r20 * px + r21 * py + r22 * pz + tz;
      const dstBase = 3 * vid;
      positions[dstBase + 0] += wgt * px1;
      positions[dstBase + 1] += wgt * py1;
      positions[dstBase + 2] += wgt * pz1;
    }
  }

  // compute vertex normals from face normals
  const faceBase = Math.max(0, faceadr) * 3;
  const faceEnd = faceBase + facenum * 3;
  for (let k = faceBase; k < faceEnd; k += 3) {
    const a = srcFace[k + 0] | 0;
    const b = srcFace[k + 1] | 0;
    const c = srcFace[k + 2] | 0;
    const ax = positions[3 * a + 0], ay = positions[3 * a + 1], az = positions[3 * a + 2];
    const bx0 = positions[3 * b + 0], by0 = positions[3 * b + 1], bz0 = positions[3 * b + 2];
    const cx0 = positions[3 * c + 0], cy0 = positions[3 * c + 1], cz0 = positions[3 * c + 2];
    const v01x = bx0 - ax, v01y = by0 - ay, v01z = bz0 - az;
    const v02x = cx0 - ax, v02y = cy0 - ay, v02z = cz0 - az;
    const nx = v01y * v02z - v01z * v02y;
    const ny = v01z * v02x - v01x * v02z;
    const nz = v01x * v02y - v01y * v02x;
    normals[3 * a + 0] += nx; normals[3 * a + 1] += ny; normals[3 * a + 2] += nz;
    normals[3 * b + 0] += nx; normals[3 * b + 1] += ny; normals[3 * b + 2] += nz;
    normals[3 * c + 0] += nx; normals[3 * c + 1] += ny; normals[3 * c + 2] += nz;
  }
  for (let i = 0; i < vertnum; i += 1) {
    const nx = normals[3 * i + 0], ny = normals[3 * i + 1], nz = normals[3 * i + 2];
    const inv = normalize3Inv(nx, ny, nz);
    normals[3 * i + 0] = nx * inv;
    normals[3 * i + 1] = ny * inv;
    normals[3 * i + 2] = nz * inv;
  }

  const inflate = skinAssets?.inflate && skinIndex < skinAssets.inflate.length ? (skinAssets.inflate[skinIndex] || 0) : 0;
  if (inflate) {
    for (let i = 0; i < vertnum; i += 1) {
      positions[3 * i + 0] += inflate * normals[3 * i + 0];
      positions[3 * i + 1] += inflate * normals[3 * i + 1];
      positions[3 * i + 2] += inflate * normals[3 * i + 2];
    }
  }

  entry.positionAttr.needsUpdate = true;
  entry.normalAttr.needsUpdate = true;
  const uvAttr = entry.uvAttr;
  const uvArray = entry.uvs;
  const texcoordAdr = skinAssets?.texcoordadr && skinIndex < skinAssets.texcoordadr.length ? (skinAssets.texcoordadr[skinIndex] | 0) : -1;
  const texcoordSrc = skinAssets?.texcoord || null;
  if (uvArray && uvArray.length > 0 && texcoordAdr >= 0 && texcoordSrc) {
    const srcStart = texcoordAdr * 2;
    const available = Math.min(uvArray.length, Math.max(0, texcoordSrc.length - srcStart));
    if (available > 0) {
      uvArray.set(texcoordSrc.subarray(srcStart, srcStart + available));
      if (available < uvArray.length) {
        uvArray.fill(0, available);
      }
    } else {
      uvArray.fill(0);
    }
    if (uvAttr) uvAttr.needsUpdate = true;
  } else if (uvArray && uvAttr) {
    uvArray.fill(0);
    uvAttr.needsUpdate = true;
  }
  return true;
}

function applyMjvSceneSoAGeoms(ctx, snapshot, state, assets, {
  sceneFlags,
  voptFlags,
  segmentEnabled: segmentEnabledOverride,
  reflectionEnabled,
  hideAllGeometry,
}) {
  const scnNgeom = snapshot?.scn_ngeom | 0;
  if (!(scnNgeom > 0)) return 0;
  const typeView = snapshot?.scn_type || null;
  const posView = snapshot?.scn_pos || null;
  const matView = snapshot?.scn_mat || null;
  const sizeView = snapshot?.scn_size || null;
  const rgbaView = snapshot?.scn_rgba || null;
  const matIdView = snapshot?.scn_matid || null;
  const dataIdView = snapshot?.scn_dataid || null;
  const objTypeView = snapshot?.scn_objtype || null;
  const objIdView = snapshot?.scn_objid || null;
  const categoryView = snapshot?.scn_category || null;
  const geomOrderView = snapshot?.scn_geomorder || null;
  if (!typeView || !posView || !matView || !sizeView || !rgbaView || !matIdView || !dataIdView || !objTypeView || !objIdView || !categoryView) {
    return 0;
  }

  const perfEnabled = isPerfEnabled();
  const tTotalStart = perfEnabled ? perfNow() : 0;
  let meshMs = 0;
  let xformMs = 0;
  let flagsMs = 0;
  let textureMs = 0;
  let ensureCalls = 0;
  let ensureCreated = 0;
  let ensureRebuilt = 0;
  let ensureRebuiltType = 0;
  let ensureRebuiltInfinite = 0;
  let ensureRebuiltDataId = 0;
  let ensureRebuiltSize = 0;
  let ensureRebuiltSizeLine = 0;
  let ensureRebuiltSizeLinebox = 0;
  let ensureRebuiltSizeArrow = 0;
  let ensureRebuiltSizeTriangle = 0;
  let ensureRebuiltSizeCapsule = 0;
  let ensureRebuiltSizeCylinder = 0;
  let ensureRebuiltSizeOtherGtype = 0;
  let ensureRebuiltOther = 0;
  let textureCalls = 0;
  let colorUpdates = 0;
  let opacityUpdates = 0;
  let xformUpdates = 0;
  let infiniteXformUpdates = 0;
  const texPerf = perfEnabled
    ? (ctx._perfSoATexture || (ctx._perfSoATexture = {
      texMapChanged: 0,
      texUvCalls: 0,
      texUvCacheHit: 0,
      texUvRecompute: 0,
      texUvSkip: 0,
    }))
    : null;
  if (texPerf) {
    texPerf.texMapChanged = 0;
    texPerf.texUvCalls = 0;
    texPerf.texUvCacheHit = 0;
    texPerf.texUvRecompute = 0;
    texPerf.texUvSkip = 0;
  }

  const flags = Array.isArray(sceneFlags) ? sceneFlags : state?.rendering?.sceneFlags || [];
  const segmentEnabled = typeof segmentEnabledOverride === 'boolean'
    ? segmentEnabledOverride
    : !!flags[SEGMENT_FLAG_INDEX];
  const vopt = Array.isArray(voptFlags)
    ? voptFlags
    : (Array.isArray(state?.rendering?.voptFlags) ? state.rendering.voptFlags : []);
  const showStatic = voptEnabled(vopt, MJ_VIS.STATIC);
  const transparentDynamic = voptEnabled(vopt, MJ_VIS.TRANSPARENT);
  const alphaScale = transparentDynamic ? clampUnit(Number(state?.model?.vis?.map?.alpha)) : 1;
  const textureEnabled = voptEnabled(vopt, MJ_VIS.TEXTURE);
  const showFlexVert = voptEnabled(vopt, MJ_VIS.FLEXVERT);
  const showFlexEdge = voptEnabled(vopt, MJ_VIS.FLEXEDGE);
  const showFlexFace = voptEnabled(vopt, MJ_VIS.FLEXFACE);
  const showFlexSkin = voptEnabled(vopt, MJ_VIS.FLEXSKIN);
  const showFlexAny = showFlexVert || showFlexEdge || showFlexFace || showFlexSkin;
  const showSkin = voptEnabled(vopt, MJ_VIS.SKIN);
  const flexLayerValue = Number.isFinite(state?.rendering?.flexLayer)
    ? (state.rendering.flexLayer | 0)
    : 0;
  const baseNgeom = snapshot?.ngeom | 0;
  const geomNameLookup = getOrCreateGeomNameLookup(ctx, state?.model?.geoms || null);
  const geomBodyIdView = state?.model?.geomBodyId || null;
  const weldIdView =
    assets?.bodies?.weldid ||
    snapshot?.renderAssets?.bodies?.weldid ||
    state?.rendering?.assets?.bodies?.weldid ||
    null;
  const mocapIdView =
    assets?.bodies?.mocapid ||
    snapshot?.renderAssets?.bodies?.mocapid ||
    state?.rendering?.assets?.bodies?.mocapid ||
    null;
  const hasBodyCategory =
    !!weldIdView &&
    !!mocapIdView &&
    (ArrayBuffer.isView(weldIdView) || Array.isArray(weldIdView)) &&
    (ArrayBuffer.isView(mocapIdView) || Array.isArray(mocapIdView));
  const isBodyStatic = (bodyId) => {
    if (!hasBodyCategory) return false;
    const bid = bodyId | 0;
    if (bid < 0) return false;
    if (bid >= weldIdView.length || bid >= mocapIdView.length) return false;
    return (weldIdView[bid] | 0) === 0 && (mocapIdView[bid] | 0) === -1;
  };
  const geomMetaCache = ctx._scnGeomMeta || (ctx._scnGeomMeta = []);

  const forceBasicRequested = state?.rendering?.options?.materials?.forceBasic === true;
  const instancingEnabled = !segmentEnabled && instancingEnabledFromState(state);
  const inst = instancingEnabled ? ensureInstancingRoot(ctx) : null;
  if (inst && inst.batches instanceof Map) {
    for (const batch of inst.batches.values()) {
      if (!batch) continue;
      batch.used = 0;
      batch.orderMin = Number.POSITIVE_INFINITY;
      batch.orderMax = Number.NEGATIVE_INFINITY;
      batch.renderOrder = null;
      batch.transparentBin = -1;
    }
  } else if (!instancingEnabled && ctx?._instancing?.batches instanceof Map) {
    for (const batch of ctx._instancing.batches.values()) {
      if (!batch?.mesh) continue;
      batch.mesh.visible = false;
      batch.mesh.count = 0;
      batch.used = 0;
      batch.orderMin = Number.POSITIVE_INFINITY;
      batch.orderMax = Number.NEGATIVE_INFINITY;
      batch.renderOrder = null;
      batch.transparentBin = -1;
    }
  }

  const transparentBinsRequested = transparentBinsFromState(state, 16);
  const transparentSortMode = transparentSortModeFromState(state);
  const transparentBins = transparentSortMode === 'strict' ? 1 : transparentBinsRequested;
  const transparentOrderingEnabled = transparentBins > 0;
  const sortTransparentInstances = transparentOrderingEnabled && transparentSortMode === 'strict';

  const camera = ctx?.camera || null;
  const rootMatWorld = ctx?.root?.matrixWorld || null;
  const rootElements = rootMatWorld?.elements || null;
  let transparentCameraReady = false;
  let camX = 0;
  let camY = 0;
  let camZ = 0;
  let dirX = 0;
  let dirY = 0;
  let dirZ = 0;
  if (transparentOrderingEnabled && camera && typeof camera.getWorldDirection === 'function' && typeof camera.getWorldPosition === 'function') {
    camera.getWorldPosition(TRANSPARENT_BIN_CAM_POS);
    camera.getWorldDirection(TRANSPARENT_BIN_CAM_DIR);
    camX = TRANSPARENT_BIN_CAM_POS.x;
    camY = TRANSPARENT_BIN_CAM_POS.y;
    camZ = TRANSPARENT_BIN_CAM_POS.z;
    dirX = TRANSPARENT_BIN_CAM_DIR.x;
    dirY = TRANSPARENT_BIN_CAM_DIR.y;
    dirZ = TRANSPARENT_BIN_CAM_DIR.z;
    transparentCameraReady = true;
  }

  let transparentBinsUsed = null;
  if (transparentOrderingEnabled && transparentBins > 0) {
    transparentBinsUsed = ctx._transparentBinsUsed || null;
    if (!(transparentBinsUsed instanceof Uint8Array) || transparentBinsUsed.length !== transparentBins) {
      transparentBinsUsed = new Uint8Array(transparentBins);
      ctx._transparentBinsUsed = transparentBinsUsed;
    }
    transparentBinsUsed.fill(0);
  }

  let transparentBinPrev = null;
  let transparentBinMigrations = 0;
  let transparentSortMs = 0;
  let transparentSortedInstances = 0;
  if (transparentOrderingEnabled && baseNgeom > 0) {
    transparentBinPrev = ctx._transparentBinPrev || null;
    if (!(transparentBinPrev instanceof Int16Array) || transparentBinPrev.length !== baseNgeom) {
      transparentBinPrev = new Int16Array(baseNgeom);
      transparentBinPrev.fill(-1);
      ctx._transparentBinPrev = transparentBinPrev;
    }
  }

  let transparentDepthMin = 0;
  let transparentDepthInvSpan = 0;
  let transparentCandidateCount = 0;
  if (transparentOrderingEnabled && transparentCameraReady) {
    let min = 0;
    let max = 0;
    let count = 0;
    for (let si = 0; si < scnNgeom; si += 1) {
      const a0 = Number(rgbaView[si * 4 + 3]) || 0;
      if (!(a0 < 0.999)) continue;
      const posBase = si * 3;
      const depth = depthFromSoAPos(posView, posBase, rootElements, camX, camY, camZ, dirX, dirY, dirZ);
      if (count === 0) {
        min = depth;
        max = depth;
      } else {
        if (depth < min) min = depth;
        if (depth > max) max = depth;
      }
      count += 1;
    }
    transparentCandidateCount = count;
    if (count > 0) {
      if (!Number.isFinite(min) || !Number.isFinite(max)) {
        min = 0;
        max = 1;
      } else if (max - min < 1e-6) {
        max = min + 1;
      }

      const prev = ctx._transparentDepthRange || null;
      const ema = 0.2;
      if (prev && typeof prev.min === 'number' && typeof prev.max === 'number' && Number.isFinite(prev.min) && Number.isFinite(prev.max)) {
        prev.min = prev.min + (min - prev.min) * ema;
        prev.max = prev.max + (max - prev.max) * ema;
        min = prev.min;
        max = prev.max;
      } else {
        ctx._transparentDepthRange = { min, max };
      }

      const span = Math.max(1e-6, max - min);
      const margin = Math.max(1e-3, span * 0.05);
      const minWithMargin = min - margin;
      const maxWithMargin = max + margin;
      transparentDepthMin = minWithMargin;
      transparentDepthInvSpan = 1 / Math.max(1e-6, maxWithMargin - minWithMargin);
    }
  }

  const transparentBatchCapacity = transparentOrderingEnabled
    ? Math.max(32, Math.min(scnNgeom, transparentCandidateCount > 0 ? transparentCandidateCount : scnNgeom))
    : scnNgeom;

  let geomOrderRank = ctx._scnGeomOrderRank || null;
  if (!geomOrderRank || geomOrderRank.length !== scnNgeom) {
    geomOrderRank = new Int32Array(scnNgeom);
    ctx._scnGeomOrderRank = geomOrderRank;
  }
  for (let i = 0; i < scnNgeom; i += 1) {
    geomOrderRank[i] = i;
  }
  if (geomOrderView && geomOrderView.length >= scnNgeom) {
    for (let k = 0; k < scnNgeom; k += 1) {
      const si = geomOrderView[k] | 0;
      if (si >= 0 && si < scnNgeom) geomOrderRank[si] = k;
    }
  }

  let geomToScn = ctx._geomToScn || null;
  if (!geomToScn || geomToScn.length !== Math.max(0, baseNgeom)) {
    geomToScn = new Int32Array(Math.max(0, baseNgeom));
    ctx._geomToScn = geomToScn;
  }
  geomToScn.fill(-1);
  for (let i = 0; i < scnNgeom; i += 1) {
    const objType = objTypeView[i] | 0;
    if (objType !== MJ_OBJ.GEOM) continue;
    const geomId = objIdView[i] | 0;
    if (!(geomId >= 0 && geomId < baseNgeom)) continue;
    if (geomToScn[geomId] === -1) {
      geomToScn[geomId] = i;
    }
  }

  // In scene mode, flex/skin lifetime is driven solely by mjvScene.
  // Hide any stale JS-driven entries and let the scene loop re-enable them.
  hideFlexGroup(ctx);
  hideSkinGroup(ctx);

  // Flex/skin are special: their geometry comes from separate buffers, so they are
  // rendered via their dedicated pools but are still *enumerated* by mjvScene.
  if (!hideAllGeometry && (showFlexAny || showSkin)) {
    const flexAssets = showFlexAny ? (assets?.flexes || null) : null;
    const flexCount = flexAssets?.count | 0;
    const skinAssets = showSkin ? (assets?.skins || null) : null;
    const skinCount = skinAssets?.count | 0;

    let flexUsed = 0;
    let skinUsed = 0;
    const seenFlex = (showFlexAny && flexCount > 0)
      ? (ctx._seenFlexSet || (ctx._seenFlexSet = new Set()))
      : null;
    const seenSkin = (showSkin && skinCount > 0)
      ? (ctx._seenSkinSet || (ctx._seenSkinSet = new Set()))
      : null;
    if (seenFlex) seenFlex.clear();
    if (seenSkin) seenSkin.clear();

    if (seenFlex || seenSkin) {
      for (let si = 0; si < scnNgeom; si += 1) {
        const objType = objTypeView[si] | 0;
        if (objType === MJ_OBJ.FLEX && seenFlex) {
          const flexIndex = objIdView[si] | 0;
          if (flexIndex < 0 || flexIndex >= flexCount) continue;
          if (seenFlex.has(flexIndex)) continue;
          seenFlex.add(flexIndex);
          const entry = ensureFlexEntry(ctx, flexIndex, assets, state);
          if (!entry) continue;
          entry.group.visible = true;
          applyFlexAppearance(entry, flexIndex, assets, ctx, textureEnabled);

          const vertadr = flexAssets.vertadr && flexIndex < flexAssets.vertadr.length ? (flexAssets.vertadr[flexIndex] | 0) : 0;
          const vertnum = entry.vertnum | 0;
          const srcAll = snapshot?.flexvert_xpos || null;
          const base = Math.max(0, vertadr) * 3;
          const end = base + vertnum * 3;
          if (!srcAll || end > srcAll.length) {
            entry.points.visible = false;
            entry.edges.visible = false;
            entry.faces.visible = false;
            continue;
          }
          const vertxpos = srcAll.subarray(base, end);
          if (entry.vertexPositions && entry.vertexPositions.length === vertxpos.length) {
            entry.vertexPositions.set(vertxpos);
            const attr0 = entry.points?.geometry?.attributes?.position;
            if (attr0) attr0.needsUpdate = true;
            const attr1 = entry.edges?.geometry?.attributes?.position;
            if (attr1) attr1.needsUpdate = true;
          }

          entry.points.visible = showFlexVert;
          entry.edges.visible = showFlexEdge;
          if (showFlexSkin) {
            updateFlexFaces(entry, flexIndex, snapshot, state, assets, true, flexLayerValue);
          } else if (showFlexFace) {
            updateFlexFaces(entry, flexIndex, snapshot, state, assets, false, flexLayerValue);
          } else {
            entry.faces.visible = false;
          }
          flexUsed += 1;
        } else if (objType === MJ_OBJ.SKIN && seenSkin) {
          const skinIndex = objIdView[si] | 0;
          if (skinIndex < 0 || skinIndex >= skinCount) continue;
          if (seenSkin.has(skinIndex)) continue;
          seenSkin.add(skinIndex);
          const entry = ensureSkinEntry(ctx, skinIndex, assets, state);
          if (!entry) continue;
          applySkinAppearance(entry, skinIndex, assets, ctx, textureEnabled);
          const ok = updateSkinMesh(entry, skinIndex, snapshot, assets);
          entry.mesh.visible = ok;
          if (ok) skinUsed += 1;
        }
      }
    }

    if (showFlexAny && flexCount > 0) {
      const group = ensureFlexGroup(ctx);
      if (group) group.visible = flexUsed > 0;
    }
    if (showSkin && skinCount > 0) {
      const group = ensureSkinGroup(ctx);
      if (group) group.visible = skinUsed > 0;
    }
  }

  ctx.geomState = ctx.geomState || [];
  const safeHide = (meshIndex) => {
    const mesh = Array.isArray(ctx.meshes) ? ctx.meshes[meshIndex] : null;
    if (mesh) mesh.visible = false;
    if (meshIndex >= 0 && inst && Array.isArray(inst.geomRefs)) {
      inst.geomRefs[meshIndex] = null;
    }
  };

  const ensureGeomProxy = (meshIndex) => {
    const index = meshIndex | 0;
    if (!(index >= 0)) return null;
    if (!Array.isArray(ctx.meshes)) ctx.meshes = [];
    const existing = ctx.meshes[index] || null;
    if (existing && existing.userData?.proxy) return existing;
    if (existing && existing.isObject3D) {
      const parent = existing.parent || null;
      if (parent && typeof parent.remove === 'function') {
        parent.remove(existing);
      }
      existing.visible = false;
      existing.userData = existing.userData || {};
      existing.userData.proxy = true;
      return existing;
    }
    const proxy = {
      visible: false,
      material: {
        opacity: 1,
        transparent: false,
        color: new THREE.Color(0xffffff),
        wireframe: false,
        type: 'ProxyMaterial',
      },
      userData: {
        proxy: true,
        geomIndex: index,
      },
    };
    ctx.meshes[index] = proxy;
    return proxy;
  };

  const fillSizeVec = (out, gtype, scnIndex) => {
    const base = (scnIndex | 0) * 3;
    const sx = Number(sizeView[base + 0]) || 0;
    const sy = Number(sizeView[base + 1]) || 0;
    const sz = Number(sizeView[base + 2]) || 0;
    if (
      gtype === MJ_GEOM.CAPSULE ||
      gtype === MJ_GEOM.CYLINDER ||
      gtype === MJ_GEOM.LINE ||
      gtype === MJ_GEOM.ARROW ||
      gtype === MJ_GEOM.ARROW1 ||
      gtype === MJ_GEOM.ARROW2
    ) {
      // mjvGeom stores [radius, radius, halflength] for capsule/cylinder.
      // mjvGeom stores [width,width,length] for connector line/arrow types.
      out[0] = sx;
      out[1] = sz;
      out[2] = 0;
      return out;
    }
    out[0] = sx;
    out[1] = sy;
    out[2] = sz;
    return out;
  };

  const updateOne = (meshIndex, scnIndex, nameHint = null, allowCreate = true) => {
    const si = scnIndex | 0;
    if (si < 0 || si >= scnNgeom) {
      safeHide(meshIndex);
      return false;
    }

    const gtypeRaw = typeView[si] | 0;
    if (gtypeRaw === MJ_GEOM.LABEL || gtypeRaw === MJ_GEOM.NONE) {
      // Labels are rendered via the scene label buffer (mjvGeom.label); no mesh needed.
      safeHide(meshIndex);
      return false;
    }
    const supported =
      gtypeRaw === MJ_GEOM.PLANE ||
      gtypeRaw === MJ_GEOM.HFIELD ||
      gtypeRaw === MJ_GEOM.SPHERE ||
      gtypeRaw === MJ_GEOM.CAPSULE ||
      gtypeRaw === MJ_GEOM.ELLIPSOID ||
      gtypeRaw === MJ_GEOM.CYLINDER ||
      gtypeRaw === MJ_GEOM.BOX ||
      gtypeRaw === MJ_GEOM.MESH ||
      gtypeRaw === MJ_GEOM.SDF ||
      gtypeRaw === MJ_GEOM.LINE ||
      gtypeRaw === MJ_GEOM.LINEBOX ||
      gtypeRaw === MJ_GEOM.ARROW ||
      gtypeRaw === MJ_GEOM.ARROW1 ||
      gtypeRaw === MJ_GEOM.ARROW2 ||
      gtypeRaw === MJ_GEOM.TRIANGLE;
    if (!supported) {
      safeHide(meshIndex);
      return false;
    }

    const rawDataId = dataIdView[si] | 0;
    const meshLike = gtypeRaw === MJ_GEOM.MESH || gtypeRaw === MJ_GEOM.SDF;
    const MESH_DATAID_MASK = 1 << 30;
    const dataId = meshLike && rawDataId >= 0 ? (MESH_DATAID_MASK | rawDataId) : rawDataId;
    const meshModelDataId = meshLike && rawDataId >= 0 ? (rawDataId >> 1) : null;
    const matId = matIdView[si] | 0;

    if (perfEnabled) ensureCalls += 1;
    const existingMesh = Array.isArray(ctx.meshes) ? ctx.meshes[meshIndex] : null;
    const meshBefore = perfEnabled ? existingMesh : null;
    const tEnsureStart = perfEnabled ? perfNow() : 0;

    let geomMeta = geomMetaCache[meshIndex] || null;
    if (!geomMeta) {
      geomMeta = {
        index: meshIndex,
        type: gtypeRaw,
        dataId,
        size: [0, 0, 0],
        name: '',
        matId: -1,
        bodyId: -1,
        groupId: -1,
        rgba: [0, 0, 0, 0],
      };
      geomMetaCache[meshIndex] = geomMeta;
    }
    geomMeta.index = meshIndex;
    geomMeta.type = gtypeRaw;
    geomMeta.dataId = dataId;
    geomMeta.name = nameHint || `SceneGeom ${si}`;
    geomMeta.matId = matId;
    geomMeta.groupId = -1;
    geomMeta.bodyId = geomBodyIdView && meshIndex >= 0 && meshIndex < geomBodyIdView.length
      ? (geomBodyIdView[meshIndex] | 0)
      : -1;

    const sizeVec = geomMeta.size;
    fillSizeVec(sizeVec, gtypeRaw, si);

    const rgba = geomMeta.rgba;
    const rgbaBase = si * 4;
    rgba[0] = rgbaView[rgbaBase + 0];
    rgba[1] = rgbaView[rgbaBase + 1];
    rgba[2] = rgbaView[rgbaBase + 2];
    rgba[3] = rgbaView[rgbaBase + 3];

    const geomState = ensureGeomState(ctx, meshIndex, geomMeta);

    if (inst && meshIndex >= 0 && !segmentEnabled) {
      const view = geomState?.view || null;
      let r = clampUnit(Number(rgba?.[0]) || 0);
      let g = clampUnit(Number(rgba?.[1]) || 0);
      let b = clampUnit(Number(rgba?.[2]) || 0);
      let a = clampUnit(Number(rgba?.[3]) || 0);
      let visible = true;
      if (view) {
        if (view.debugHidden) visible = false;
        if (view.visibleOverride === true) visible = true;
        else if (view.visibleOverride === false) visible = false;
        if (Array.isArray(view.colorOverride) && view.colorOverride.length >= 4) {
          r = clampUnit(Number(view.colorOverride[0]) || 0);
          g = clampUnit(Number(view.colorOverride[1]) || 0);
          b = clampUnit(Number(view.colorOverride[2]) || 0);
          a = clampUnit(Number(view.colorOverride[3]) || 0);
        }
      }
      if (hideAllGeometry) visible = false;
      const bodyId = geomMeta.bodyId | 0;
      const bodyStatic = bodyId >= 0 && isBodyStatic(bodyId);
      if (visible && !showStatic && bodyStatic) visible = false;
      if (transparentDynamic && !bodyStatic && Number.isFinite(alphaScale) && alphaScale > 1e-6 && alphaScale < 0.999) {
        a = clampUnit(a * alphaScale);
      }

      const materialOverrides =
        !!view &&
        (view.roughnessOverride != null ||
          view.metalnessOverride != null ||
          view.envMapIntensityOverride != null ||
          view.emissiveIntensityOverride != null);
      const wantsTexture = !!textureEnabled && !!resolveMaterialTextureDescriptor(matId, assets);
      const opacityQ = Math.max(0, Math.min(1000, quantize1e3(a)));
      const opaque = opacityQ >= 999;
      const isTransparent = opacityQ < 999;

      let transparentBin = isTransparent ? 0 : -1;
      let transparentOrder = 0;
      let transparentDepthNorm = 0;
      if (transparentCameraReady && transparentOrderingEnabled && isTransparent) {
        const posBase = si * 3;
        const depth = depthFromSoAPos(posView, posBase, rootElements, camX, camY, camZ, dirX, dirY, dirZ);
        transparentDepthNorm = transparentDepthNorm01(depth, transparentDepthMin, transparentDepthInvSpan);
        transparentBin = transparentBinFromDepthNorm(transparentDepthNorm, transparentBins);
        transparentOrder = (transparentBins | 0) - 1 - (transparentBin | 0);
        if (transparentBinsUsed && transparentBin >= 0 && transparentBin < transparentBinsUsed.length) {
          transparentBinsUsed[transparentBin] = 1;
        }
      }
      const transparentBinKey = (transparentOrderingEnabled && isTransparent) ? (transparentBin | 0) : -1;
      if (transparentBinPrev && meshIndex >= 0 && meshIndex < transparentBinPrev.length) {
        const prevBin = transparentBinPrev[meshIndex] | 0;
        if (prevBin !== transparentBinKey) {
          transparentBinMigrations += 1;
          transparentBinPrev[meshIndex] = transparentBinKey;
        }
      }

      const instancedType =
        gtypeRaw === MJ_GEOM.SPHERE ||
        gtypeRaw === MJ_GEOM.ELLIPSOID ||
        gtypeRaw === MJ_GEOM.CAPSULE ||
        gtypeRaw === MJ_GEOM.CYLINDER ||
        gtypeRaw === MJ_GEOM.BOX;
      const baseEmission = resolveMaterialEmission(matId, assets) || 0;
      const eligibleForInstancing =
        instancedType &&
        (opaque || (transparentOrderingEnabled && isTransparent)) &&
        !materialOverrides &&
        !wantsTexture &&
        baseEmission <= 1e-6;
      if (eligibleForInstancing) {
        if (meshIndex >= 0 && meshIndex < baseNgeom) {
          const proxy = ensureGeomProxy(meshIndex);
          if (proxy) {
            proxy.visible = visible;
            proxy.userData = proxy.userData || {};
            proxy.userData.geomIndex = meshIndex;
            proxy.userData.geomBodyId = bodyId;
            proxy.userData.geomName = geomMeta.name;
            proxy.userData.geomOpacity = a;
            let proxyRgba = proxy.userData.geomRgba;
            if (!Array.isArray(proxyRgba) || proxyRgba.length < 4) {
              proxyRgba = [0, 0, 0, 1];
              proxy.userData.geomRgba = proxyRgba;
            }
            proxyRgba[0] = r;
            proxyRgba[1] = g;
            proxyRgba[2] = b;
            proxyRgba[3] = a;
            proxy.userData.infinitePlane = false;
            if (proxy.material && typeof proxy.material === 'object') {
              proxy.material.opacity = a;
              proxy.material.transparent = a < 0.999;
              if (proxy.material.color && typeof proxy.material.color.setRGB === 'function') {
                proxy.material.color.setRGB(r, g, b);
              }
              if (typeof proxy.material.wireframe === 'boolean') {
                proxy.material.wireframe = !!flags?.[1];
              }
            }
          }
        }
        if (!visible) {
          safeHide(meshIndex);
          if (view) view.__dirty = false;
          return false;
        }
      }
      if (visible && eligibleForInstancing) {
        const reflectanceValue = resolveMaterialReflectance(matId, assets);
        const reflectanceQ = quantize1e6(reflectanceValue);
        const roughnessValue = resolveMaterialRoughness(matId, assets);
        const metalnessValue = resolveMaterialMetallic(matId, assets);
        const roughnessQ = quantize1e3(roughnessValue != null ? roughnessValue : 0.55);
        const metalnessQ = quantize1e3(metalnessValue != null ? metalnessValue : 0.0);
        const wireframe = !!flags?.[1];
        const geometry = ensureInstancedGeometry(inst, gtypeRaw);
        const scnObjType = objTypeView[si] | 0;
        const material = geometry
          ? ensureInstancedMaterial(
            inst,
            reflectanceQ,
            { roughnessQ, metalnessQ },
            { wireframe, opacityQ, objType: scnObjType, forceBasic: forceBasicRequested },
          )
          : null;
        let depthQ16 = 0;
        if (transparentBinKey >= 0 && sortTransparentInstances) {
          depthQ16 = Math.max(0, Math.min(65535, Math.floor((1 - transparentDepthNorm) * 65535))) | 0;
        }
        const orderRank = (transparentBinKey >= 0)
          ? (sortTransparentInstances ? (((transparentOrder | 0) << 16) | (depthQ16 | 0)) : (transparentOrder | 0))
          : (geomOrderRank ? (geomOrderRank[si] | 0) : si);
        const batchKey = `g${gtypeRaw | 0}:ot${scnObjType}:o${opaque ? 1000 : opacityQ | 0}:r${reflectanceQ | 0}:ru${roughnessQ | 0}:me${metalnessQ | 0}:tb${transparentBinKey | 0}`;
        const batchCapacity = (transparentBinKey >= 0) ? transparentBatchCapacity : scnNgeom;
        const batch = (geometry && material)
          ? ensureInstancedBatch(ctx, inst, batchKey, geometry, material, batchCapacity)
          : null;
        if (batch?.mesh && batch.used < batch.capacity) {
          batch.objType = scnObjType;
          if (transparentBinKey >= 0) {
            batch.transparentBin = transparentBinKey | 0;
            if (batch.mesh.userData) batch.mesh.userData.transparentBin = transparentBinKey | 0;
            if (!sortTransparentInstances) {
              batch.renderOrder = transparentOrder | 0;
            }
          }
          if (Number.isFinite(orderRank)) {
            const lo = Number(batch.orderMin);
            const hi = Number(batch.orderMax);
            if (!Number.isFinite(lo) || orderRank < lo) batch.orderMin = orderRank;
            if (!Number.isFinite(hi) || orderRank > hi) batch.orderMax = orderRank;
          }
          const instanceId = batch.used | 0;
          if (batch.instanceOrderRank && instanceId < batch.instanceOrderRank.length) {
            batch.instanceOrderRank[instanceId] = Number.isFinite(orderRank) ? (orderRank | 0) : (si | 0);
          }
          const posBase = si * 3;
          inst.tmpPos.set(
            posView[posBase + 0] || 0,
            posView[posBase + 1] || 0,
            posView[posBase + 2] || 0,
          );
          const matBase = si * 9;
          setQuatFromMat3(
            inst.tmpQuat,
            matView[matBase + 0],
            matView[matBase + 1],
            matView[matBase + 2],
            matView[matBase + 3],
            matView[matBase + 4],
            matView[matBase + 5],
            matView[matBase + 6],
            matView[matBase + 7],
            matView[matBase + 8],
          );
          const sx0 = Number(sizeVec?.[0]) || 0;
          const sy0 = Number(sizeVec?.[1]) || 0;
          const sz0 = Number(sizeVec?.[2]) || 0;
          switch (gtypeRaw) {
            case MJ_GEOM.SPHERE: {
              const radius = Math.max(1e-6, sx0 || sy0 || sz0 || 0.1);
              inst.tmpScale.set(radius, radius, radius);
              break;
            }
            case MJ_GEOM.ELLIPSOID: {
              const ax = Math.max(1e-6, sx0 || 0.1);
              const ay = Math.max(1e-6, sy0 || ax);
              const az = Math.max(1e-6, sz0 || ax);
              inst.tmpScale.set(ax, ay, az);
              break;
            }
            case MJ_GEOM.CYLINDER: {
              const radius = Math.max(1e-6, sx0 || 0.05);
              const halfLength = Math.max(0, sy0 || 0);
              inst.tmpScale.set(radius, radius, Math.max(1e-6, halfLength));
              break;
            }
            case MJ_GEOM.CAPSULE: {
              const radius = Math.max(1e-6, sx0 || 0.05);
              const halfLength = Math.max(0, sy0 || 0);
              const totalLength = 2 * halfLength + 2 * radius;
              inst.tmpScale.set(radius, radius, Math.max(1e-6, totalLength * 0.25));
              break;
            }
            case MJ_GEOM.BOX:
            default: {
              const bx = Math.max(1e-6, sx0 || 0.1);
              const by = Math.max(1e-6, sy0 || bx);
              const bz = Math.max(1e-6, sz0 || bx);
              inst.tmpScale.set(bx, by, bz);
              break;
            }
          }
          inst.tmpMat4.compose(inst.tmpPos, inst.tmpQuat, inst.tmpScale);
          batch.mesh.setMatrixAt(instanceId, inst.tmpMat4);
          if (batch.mesh.instanceMatrix) batch.mesh.instanceMatrix.needsUpdate = true;
          if (batch.mesh.instanceColor?.array) {
            const colorArr = batch.mesh.instanceColor.array;
            const base = instanceId * 3;
            colorArr[base + 0] = r;
            colorArr[base + 1] = g;
            colorArr[base + 2] = b;
            batch.mesh.instanceColor.needsUpdate = true;
          }
          batch.instanceToGeomIndex[instanceId] = meshIndex;
          batch.used = instanceId + 1;
          batch.mesh.visible = true;
          const existingMesh = Array.isArray(ctx.meshes) ? ctx.meshes[meshIndex] : null;
          if (existingMesh && !existingMesh.userData?.proxy) existingMesh.visible = false;
          let ref = inst.geomRefs?.[meshIndex] || null;
          if (!ref) {
            ref = {};
            inst.geomRefs[meshIndex] = ref;
          }
          ref.kind = 'instance';
          ref.mesh = batch.mesh;
          ref.instanceId = instanceId;
          ref.geomType = gtypeRaw;
          ref.batchKey = batch.key;
          if (view) view.__dirty = false;
          return true;
        }
      }
      if (view) view.__dirty = false;
    }

    if (!allowCreate && !existingMesh) {
      safeHide(meshIndex);
      return false;
    }

    const mesh = ensureGeomMesh(ctx, meshIndex, gtypeRaw, assets, dataId, sizeVec, { geomMeta, dynamicSizeScale: true }, state);
    if (perfEnabled) meshMs += perfNow() - tEnsureStart;
    if (!mesh) return false;
    const scnObjType = objTypeView[si] | 0;
    if (instancingIsOverlayObjType(scnObjType)) {
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const mat of mats) {
        if (!mat || typeof mat !== 'object') continue;
        if (!('toneMapped' in mat)) continue;
        if (mat.toneMapped !== false) {
          mat.toneMapped = false;
          if ('needsUpdate' in mat) mat.needsUpdate = true;
        }
      }
    }
    if (perfEnabled && mesh !== meshBefore) {
      if (meshBefore) {
        ensureRebuilt += 1;
        const beforeUserData = meshBefore.userData || {};
        const beforeType = beforeUserData.geomType;
        const beforeInfinite = !!beforeUserData.infinitePlane;
        const infiniteNow = (gtypeRaw === MJ_GEOM.PLANE) && isInfinitePlaneSize(sizeVec);
        if (beforeType !== gtypeRaw) {
          ensureRebuiltType += 1;
        } else if (beforeInfinite !== infiniteNow) {
          ensureRebuiltInfinite += 1;
        } else if (meshLike && beforeUserData.geomDataId !== dataId) {
          ensureRebuiltDataId += 1;
        } else {
          const needsSizeCheck =
            !infiniteNow &&
            (gtypeRaw !== MJ_GEOM.MESH && gtypeRaw !== MJ_GEOM.SDF);
          if (needsSizeCheck) {
            const sx = Number(sizeVec?.[0]) || 0;
            const sy = Number(sizeVec?.[1]) || 0;
            const sz = Number(sizeVec?.[2]) || 0;
            const hasSizeKeys =
              typeof beforeUserData.geomSizeX === 'number' &&
              typeof beforeUserData.geomSizeY === 'number' &&
              typeof beforeUserData.geomSizeZ === 'number';
            const sizeChanged =
              !hasSizeKeys ||
              Math.abs(beforeUserData.geomSizeX - sx) > 1e-6 ||
              Math.abs(beforeUserData.geomSizeY - sy) > 1e-6 ||
              Math.abs(beforeUserData.geomSizeZ - sz) > 1e-6;
            if (sizeChanged) {
              ensureRebuiltSize += 1;
              switch (gtypeRaw) {
                case MJ_GEOM.LINE:
                  ensureRebuiltSizeLine += 1;
                  break;
                case MJ_GEOM.LINEBOX:
                  ensureRebuiltSizeLinebox += 1;
                  break;
                case MJ_GEOM.ARROW:
                case MJ_GEOM.ARROW1:
                case MJ_GEOM.ARROW2:
                  ensureRebuiltSizeArrow += 1;
                  break;
                case MJ_GEOM.TRIANGLE:
                  ensureRebuiltSizeTriangle += 1;
                  break;
                case MJ_GEOM.CAPSULE:
                  ensureRebuiltSizeCapsule += 1;
                  break;
                case MJ_GEOM.CYLINDER:
                  ensureRebuiltSizeCylinder += 1;
                  break;
                default:
                  ensureRebuiltSizeOtherGtype += 1;
                  break;
              }
            } else {
              ensureRebuiltOther += 1;
            }
          } else {
            ensureRebuiltOther += 1;
          }
        }
      } else {
        ensureCreated += 1;
      }
    }
    if (!mesh.userData?.infinitePlane) {
      mesh.renderOrder = geomOrderRank ? (geomOrderRank[si] | 0) : (mesh.renderOrder || 0);
    }

    const tFlagsStart0 = perfEnabled ? perfNow() : 0;
    const reflectanceValue = resolveMaterialReflectance(matId, assets);
    mesh.userData = mesh.userData || {};
    mesh.userData.matId = matId;
    mesh.userData.scnIndex = si;
    mesh.userData.scnObjType = objTypeView[si] | 0;
    mesh.userData.scnObjId = objIdView[si] | 0;
    mesh.userData.scnCategory = categoryView[si] | 0;
    mesh.userData.scnDataId = rawDataId;
    mesh.userData.geomModelDataId = meshLike ? meshModelDataId : null;
    applyReflectanceToMaterial(mesh, ctx, reflectanceValue, reflectionEnabled);

    if (segmentEnabled) {
      const segMat = ensureSegmentMaterial(mesh, flags);
      if (segMat) {
        const segColor = segmentColorForIndex(mesh.userData?.geomIndex ?? meshIndex);
        segMat.color.setHex(segColor);
        mesh.material = segMat;
      }
    } else {
      restoreSegmentMaterial(mesh);
    }
    if (perfEnabled) flagsMs += perfNow() - tFlagsStart0;

    const tXformStart = perfEnabled ? perfNow() : 0;
    const isInfinitePlane = !!mesh.userData?.infinitePlane;
    if (isInfinitePlane) {
      updateInfinitePlaneFromSceneSoA(ctx, mesh, si, snapshot, assets, state?.model || null, flags);
      if (perfEnabled) infiniteXformUpdates += 1;
    } else {
      const posBase = si * 3;
      mesh.position.set(
        posView[posBase + 0] || 0,
        posView[posBase + 1] || 0,
        posView[posBase + 2] || 0,
      );
      const matBase = si * 9;
      setQuatFromMat3(
        mesh.quaternion,
        matView[matBase + 0],
        matView[matBase + 1],
        matView[matBase + 2],
        matView[matBase + 3],
        matView[matBase + 4],
        matView[matBase + 5],
        matView[matBase + 6],
        matView[matBase + 7],
        matView[matBase + 8],
      );
      if (isDynamicSizeScaleGeomType(gtypeRaw)) {
        applyDynamicSizeScale(mesh, gtypeRaw, sizeVec);
      } else {
        mesh.scale.set(1, 1, 1);
      }
      if (perfEnabled) xformUpdates += 1;
    }
    if (perfEnabled) xformMs += perfNow() - tXformStart;

    let visible = true;
    if (hideAllGeometry) visible = false;
    if (!segmentEnabled) {
      const tFlagsStart1 = perfEnabled ? perfNow() : 0;
      let r = clampUnit(Number(rgba?.[0]) || 0);
      let g = clampUnit(Number(rgba?.[1]) || 0);
      let b = clampUnit(Number(rgba?.[2]) || 0);
      let a = clampUnit(Number(rgba?.[3]) || 0);
      const view = geomState?.view || null;
      if (view) {
        if (view.debugHidden) visible = false;
        if (view.visibleOverride === true) visible = true;
        else if (view.visibleOverride === false) visible = false;
        if (Array.isArray(view.colorOverride) && view.colorOverride.length >= 4) {
          r = clampUnit(Number(view.colorOverride[0]) || 0);
          g = clampUnit(Number(view.colorOverride[1]) || 0);
          b = clampUnit(Number(view.colorOverride[2]) || 0);
          a = clampUnit(Number(view.colorOverride[3]) || 0);
        }
      }
      if (hideAllGeometry) visible = false;
      const bodyId = geomMeta.bodyId | 0;
      const bodyStatic = bodyId >= 0 && isBodyStatic(bodyId);
      if (visible && !showStatic && bodyStatic) visible = false;
      if (transparentDynamic && !bodyStatic && Number.isFinite(alphaScale) && alphaScale > 1e-6 && alphaScale < 0.999) {
        a = clampUnit(a * alphaScale);
      }

      const mat = mesh.material;
      if (mat && mat.color && typeof mat.color.setRGB === 'function') {
        if ((mat.color.r !== r) || (mat.color.g !== g) || (mat.color.b !== b)) {
          mat.color.setRGB(r, g, b);
          if (perfEnabled) colorUpdates += 1;
        }
      }
      const nextTransparent = a < 0.999;
      if (mat && ('opacity' in mat)) {
        const changedOpacity = mat.opacity !== a;
        const changedTransparent = mat.transparent !== nextTransparent;
        if (changedOpacity) mat.opacity = a;
        if (changedTransparent) mat.transparent = nextTransparent;
        if (perfEnabled && (changedOpacity || changedTransparent)) opacityUpdates += 1;
      }
      if (mat && typeof mat.depthWrite === 'boolean') {
        const nextDepthWrite = !nextTransparent;
        if (mat.depthWrite !== nextDepthWrite) {
          mat.depthWrite = nextDepthWrite;
        }
      }
      const userData = mesh.userData || (mesh.userData = {});
      let transparentBinKey = -1;
      const ignoreTransparentOrdering = !!userData.infinitePlane || !!userData.infiniteGrid;
      if (ignoreTransparentOrdering) {
        userData.transparentBin = -1;
        if (userData.infinitePlane) {
          mesh.renderOrder = RENDER_ORDER.GROUND;
        } else if (userData.infiniteGrid && typeof userData.infiniteGrid === 'object') {
          const ro = userData.infiniteGrid.renderOrder;
          if (Number.isFinite(ro)) mesh.renderOrder = ro;
        }
      } else if (transparentOrderingEnabled && nextTransparent) {
        let bin = 0;
        let order = 0;
        if (transparentCameraReady) {
          const posBase = si * 3;
          const depth = depthFromSoAPos(posView, posBase, rootElements, camX, camY, camZ, dirX, dirY, dirZ);
          const depthNormClamped = transparentDepthNorm01(depth, transparentDepthMin, transparentDepthInvSpan);
          bin = transparentBinFromDepthNorm(depthNormClamped, transparentBins);
        }
        transparentBinKey = bin | 0;
        order = (transparentBins | 0) - 1 - transparentBinKey;
        mesh.renderOrder = order | 0;
        userData.transparentBin = transparentBinKey;
        if (transparentBinsUsed && transparentBinKey >= 0 && transparentBinKey < transparentBinsUsed.length) {
          transparentBinsUsed[transparentBinKey] = 1;
        }
      } else {
        userData.transparentBin = -1;
      }
      if (transparentBinPrev && meshIndex >= 0 && meshIndex < transparentBinPrev.length) {
        const prevBin = transparentBinPrev[meshIndex] | 0;
        const nextBin = (!ignoreTransparentOrdering && transparentOrderingEnabled && nextTransparent) ? transparentBinKey : -1;
        if (prevBin !== nextBin) {
          transparentBinMigrations += 1;
          transparentBinPrev[meshIndex] = nextBin;
        }
      }
      let userRgba = userData.geomRgba;
      if (!Array.isArray(userRgba) || userRgba.length < 4) {
        userRgba = [0, 0, 0, 1];
        userData.geomRgba = userRgba;
      }
      userRgba[0] = r;
      userRgba[1] = g;
      userRgba[2] = b;
      userRgba[3] = a;
      userData.geomOpacity = a;
      userData.baseAlpha = a;

      if (mat) {
        const baseRoughness = resolveMaterialRoughness(matId, assets);
        const baseMetalness = resolveMaterialMetallic(matId, assets);
        const baseEmission = resolveMaterialEmission(matId, assets);

        const roughnessOverride = view?.roughnessOverride;
        const metalnessOverride = view?.metalnessOverride;
        const envOverride = view?.envMapIntensityOverride;
        const emissiveOverride = view?.emissiveIntensityOverride;

        const desiredRoughness = roughnessOverride != null ? roughnessOverride : baseRoughness;
        if (desiredRoughness != null && ('roughness' in mat) && mat.roughness !== desiredRoughness) {
          mat.roughness = desiredRoughness;
        }
        const desiredMetalness = metalnessOverride != null ? metalnessOverride : baseMetalness;
        if (desiredMetalness != null && ('metalness' in mat) && mat.metalness !== desiredMetalness) {
          mat.metalness = desiredMetalness;
        }
        if (envOverride != null && ('envMapIntensity' in mat) && mat.envMapIntensity !== envOverride) {
          mat.envMapIntensity = envOverride;
        }

        const desiredEmissionRaw = emissiveOverride != null
          ? emissiveOverride
          : (baseEmission != null ? baseEmission : 0);
        const desiredEmission = Math.max(0, Number(desiredEmissionRaw) || 0);
        if ('emissiveIntensity' in mat && mat.emissiveIntensity !== desiredEmission) {
          mat.emissiveIntensity = desiredEmission;
        }
        if (mat.emissive && typeof mat.emissive.setRGB === 'function') {
          const wantEmissive = desiredEmission > 1e-6;
          const er = wantEmissive ? r : 0;
          const eg = wantEmissive ? g : 0;
          const eb = wantEmissive ? b : 0;
          if ((mat.emissive.r !== er) || (mat.emissive.g !== eg) || (mat.emissive.b !== eb)) {
            mat.emissive.setRGB(er, eg, eb);
          }
        }
      }
      if (view) view.__dirty = false;
      applyMaterialFlags(mesh, meshIndex, state, flags);
      const texcoordMode =
        (gtypeRaw === MJ_GEOM.MESH || gtypeRaw === MJ_GEOM.SDF) && mesh.geometry && typeof mesh.geometry.getAttribute === 'function' && mesh.geometry.getAttribute('uv')
          ? 'explicit'
          : 'generated';
      const textureCompatible =
        gtypeRaw === MJ_GEOM.PLANE ||
        gtypeRaw === MJ_GEOM.HFIELD ||
        gtypeRaw === MJ_GEOM.SPHERE ||
        gtypeRaw === MJ_GEOM.CAPSULE ||
        gtypeRaw === MJ_GEOM.ELLIPSOID ||
        gtypeRaw === MJ_GEOM.CYLINDER ||
        gtypeRaw === MJ_GEOM.BOX ||
        gtypeRaw === MJ_GEOM.MESH ||
        gtypeRaw === MJ_GEOM.SDF;
      if (perfEnabled) flagsMs += perfNow() - tFlagsStart1;
      if (textureCompatible) {
        if (perfEnabled) {
          textureCalls += 1;
          const tTexStart = perfNow();
          applyMuJoCoTextureToMesh(mesh, matId, ctx, assets, textureEnabled, {
            texcoordMode,
            geomType: gtypeRaw,
            geomSize: sizeVec,
            geomDataId: dataId,
            perfOut: texPerf,
          });
          textureMs += perfNow() - tTexStart;
        } else {
          applyMuJoCoTextureToMesh(mesh, matId, ctx, assets, textureEnabled, {
            texcoordMode,
            geomType: gtypeRaw,
            geomSize: sizeVec,
            geomDataId: dataId,
          });
        }
      }
    }

    mesh.visible = visible;
    if (inst && meshIndex >= 0) {
      let ref = inst.geomRefs?.[meshIndex] || null;
      if (!ref) {
        ref = {};
        inst.geomRefs[meshIndex] = ref;
      }
      ref.kind = 'mesh';
      ref.mesh = mesh;
      ref.instanceId = null;
      ref.geomType = gtypeRaw;
      ref.batchKey = null;
    }
    return visible;
  };

  let drawn = 0;
  // Base model geoms: keep indices 0..ngeom-1 stable for picking/controls.
  for (let geomId = 0; geomId < baseNgeom; geomId += 1) {
    const scnIdx = geomToScn[geomId] | 0;
    if (scnIdx < 0) {
      safeHide(geomId);
      continue;
    }
    const name = geomNameFromLookup(geomNameLookup, geomId);
    if (updateOne(geomId, scnIdx, name)) drawn += 1;
  }

  // Extra scene geoms (sites/tendons/etc), appended after base geoms.
  const extras = ctx._scnExtras || (ctx._scnExtras = []);
  extras.length = 0;
  for (let i = 0; i < scnNgeom; i += 1) {
    const objType = objTypeView[i] | 0;
    if (objType === MJ_OBJ.FLEX || objType === MJ_OBJ.SKIN) continue;
    if (objType === MJ_OBJ.GEOM) {
      const geomId = objIdView[i] | 0;
      if (geomId >= 0 && geomId < baseNgeom) continue;
    }
    extras.push(i);
  }

  // Creating hundreds of new Three.js meshes/geometries in a single frame can
  // stall the main thread (especially in headless / SwiftShader runs). Spread
  // extra-geom construction across frames while always updating existing ones.
  const createBudget = 8;
  let createdThisFrame = 0;
  const tCreateStart = perfNow();
  const createTimeBudgetMs = 6;
  for (let k = 0; k < extras.length; k += 1) {
    const meshIndex = baseNgeom + k;
    const scnIdx = extras[k] | 0;
    const existing = Array.isArray(ctx.meshes) ? ctx.meshes[meshIndex] : null;
    let allowCreate = true;
    if (!existing) {
      if ((perfNow() - tCreateStart) > createTimeBudgetMs) {
        allowCreate = false;
      }
      if (createdThisFrame >= createBudget) {
        allowCreate = false;
      }
    }
    const visible = updateOne(meshIndex, scnIdx, null, allowCreate);
    if (!existing && allowCreate) {
      const created = Array.isArray(ctx.meshes) ? ctx.meshes[meshIndex] : null;
      if (created) createdThisFrame += 1;
    }
    if (visible) drawn += 1;
  }

  // Hide any stale meshes beyond current range.
  const total = baseNgeom + extras.length;
  if (Array.isArray(ctx.meshes) && ctx.meshes.length > total) {
    for (let i = total; i < ctx.meshes.length; i += 1) {
      if (ctx.meshes[i]) ctx.meshes[i].visible = false;
    }
  }

  if (inst && inst.batches instanceof Map) {
    const wireframe = !!flags?.[1];
    let instancedBatches = 0;
    let instancedInstances = 0;
    let transparentInstancedBatches = 0;
    let transparentInstancedInstances = 0;
    for (const batch of inst.batches.values()) {
      if (!batch?.mesh) continue;
      const used = batch.used | 0;
      batch.mesh.count = used;
      batch.mesh.visible = used > 0;
      if (batch.mesh.instanceMatrix) batch.mesh.instanceMatrix.needsUpdate = used > 0;
      if (batch.mesh.instanceColor) batch.mesh.instanceColor.needsUpdate = used > 0;
      if (typeof batch.renderOrder === 'number' && Number.isFinite(batch.renderOrder)) {
        batch.mesh.renderOrder = Number(batch.renderOrder) | 0;
      } else if (Number.isFinite(batch.orderMin)) {
        batch.mesh.renderOrder = Number(batch.orderMin) | 0;
      }
      if (used > 1 && batch.material?.transparent && inst && sortTransparentInstances) {
        const tSort0 = perfEnabled ? perfNow() : 0;
        sortInstancedBatchByOrderRank(inst, batch);
        if (perfEnabled) {
          transparentSortMs += perfNow() - tSort0;
          transparentSortedInstances += used;
        }
      }
      if (batch.material && typeof batch.material.wireframe === 'boolean') {
        batch.material.wireframe = wireframe;
      }
      if (typeof batch.objType === 'number') {
        const overlay = instancingIsOverlayObjType(batch.objType);
        const nextCastShadow = !overlay;
        const nextReceiveShadow = !overlay;
        if (batch.mesh.castShadow !== nextCastShadow) batch.mesh.castShadow = nextCastShadow;
        if (batch.mesh.receiveShadow !== nextReceiveShadow) batch.mesh.receiveShadow = nextReceiveShadow;
      }
      if (batch.material && 'envMapIntensity' in batch.material) {
        const q = batch.material.userData?.reflectanceQ;
        const reflectance = Number.isFinite(q) ? Math.max(0, Number(q)) / 1e6 : 0;
        const baseIntensity = typeof ctx?.envIntensity === 'number' ? ctx.envIntensity : 0;
        const nextEnvIntensity =
          reflectionEnabled && baseIntensity > 0 && reflectance > 0
            ? baseIntensity * reflectance
            : 0;
        const current = typeof batch.material.envMapIntensity === 'number' ? batch.material.envMapIntensity : 0;
        if (Math.abs(current - nextEnvIntensity) > 1e-6) {
          batch.material.envMapIntensity = nextEnvIntensity;
        }
      }
      if (typeof batch.prevUsed === 'number' && batch.prevUsed > used && batch.instanceToGeomIndex) {
        batch.instanceToGeomIndex.fill(-1, used, batch.prevUsed);
      }
      batch.prevUsed = used;
      if (used > 0) {
        instancedBatches += 1;
        instancedInstances += used;
        if (batch.material?.transparent) {
          transparentInstancedBatches += 1;
          transparentInstancedInstances += used;
        }
      }
    }
    if (perfEnabled) {
      perfSample('renderer:instancing_batches', instancedBatches);
      perfSample('renderer:instancing_instances', instancedInstances);
      let activeBins = 0;
      if (transparentBinsUsed) {
        for (let i = 0; i < transparentBinsUsed.length; i += 1) {
          if (transparentBinsUsed[i] | 0) activeBins += 1;
        }
      }
      perfSample('renderer:transparent_bins', transparentBins | 0);
      perfSample('renderer:transparent_sort_strict', sortTransparentInstances ? 1 : 0);
      perfSample('renderer:transparent_candidate_count', transparentCandidateCount | 0);
      perfSample('renderer:transparent_bin_count', activeBins);
      perfSample('renderer:transparent_bin_migrations', transparentBinMigrations | 0);
      perfSample('renderer:transparent_instanced_batches', transparentInstancedBatches);
      perfSample('renderer:transparent_instanced_instances', transparentInstancedInstances);
      perfSample('renderer:transparent_sort_ms', transparentSortMs);
      perfSample('renderer:transparent_sorted_instances', transparentSortedInstances);
    }
  }

  if (perfEnabled) {
    const totalMs = perfNow() - tTotalStart;
    const miscMs = Math.max(0, totalMs - meshMs - xformMs - flagsMs - textureMs);
    perfSample('renderer:apply_scene_soa_mesh_ms', meshMs);
    perfSample('renderer:apply_scene_soa_xform_ms', xformMs);
    perfSample('renderer:apply_scene_soa_flags_ms', flagsMs);
    perfSample('renderer:apply_scene_soa_texture_ms', textureMs);
    perfSample('renderer:apply_scene_soa_misc_ms', miscMs);
    perfSample('renderer:apply_scene_soa_ensure_calls', ensureCalls);
    perfSample('renderer:apply_scene_soa_ensure_created', ensureCreated);
    perfSample('renderer:apply_scene_soa_ensure_rebuilt', ensureRebuilt);
    perfSample('renderer:apply_scene_soa_ensure_rebuilt_type', ensureRebuiltType);
    perfSample('renderer:apply_scene_soa_ensure_rebuilt_infinite', ensureRebuiltInfinite);
    perfSample('renderer:apply_scene_soa_ensure_rebuilt_dataid', ensureRebuiltDataId);
    perfSample('renderer:apply_scene_soa_ensure_rebuilt_size', ensureRebuiltSize);
    perfSample('renderer:apply_scene_soa_ensure_rebuilt_size_line', ensureRebuiltSizeLine);
    perfSample('renderer:apply_scene_soa_ensure_rebuilt_size_linebox', ensureRebuiltSizeLinebox);
    perfSample('renderer:apply_scene_soa_ensure_rebuilt_size_arrow', ensureRebuiltSizeArrow);
    perfSample('renderer:apply_scene_soa_ensure_rebuilt_size_triangle', ensureRebuiltSizeTriangle);
    perfSample('renderer:apply_scene_soa_ensure_rebuilt_size_capsule', ensureRebuiltSizeCapsule);
    perfSample('renderer:apply_scene_soa_ensure_rebuilt_size_cylinder', ensureRebuiltSizeCylinder);
    perfSample('renderer:apply_scene_soa_ensure_rebuilt_size_other_gtype', ensureRebuiltSizeOtherGtype);
    perfSample('renderer:apply_scene_soa_ensure_rebuilt_other', ensureRebuiltOther);
    perfSample('renderer:apply_scene_soa_texture_calls', textureCalls);
    perfSample('renderer:apply_scene_soa_color_updates', colorUpdates);
    perfSample('renderer:apply_scene_soa_opacity_updates', opacityUpdates);
    perfSample('renderer:apply_scene_soa_xform_updates', xformUpdates);
    perfSample('renderer:apply_scene_soa_xform_infinite_updates', infiniteXformUpdates);
    if (texPerf) {
      const uvCalls = texPerf.texUvCalls | 0;
      const uvHit = texPerf.texUvCacheHit | 0;
      const uvRecompute = texPerf.texUvRecompute | 0;
      const uvSkip = texPerf.texUvSkip | 0;
      perfSample('renderer:apply_scene_soa_tex_map_changed', texPerf.texMapChanged | 0);
      perfSample('renderer:apply_scene_soa_uv_calls', uvCalls);
      perfSample('renderer:apply_scene_soa_uv_cache_hit', uvHit);
      perfSample('renderer:apply_scene_soa_uv_recompute', uvRecompute);
      perfSample('renderer:apply_scene_soa_uv_skip', uvSkip);
      perfSample('renderer:apply_scene_soa_uv_hit_rate', uvCalls ? uvHit / uvCalls : 0);
      perfSample('renderer:apply_scene_soa_uv_recompute_rate', uvCalls ? uvRecompute / uvCalls : 0);
    }
  }

  return drawn;
}

function createRendererManager({
  canvas,
  backend,
  renderCtx,
  applyFallbackAppearance,
  ensureEnvIfNeeded,
  debugMode = false,
  setRenderStats = () => {},
}) {
  const ctx = renderCtx;
  if (!ctx) throw new Error('renderCtx is required');
  ctx.cameraTarget = ctx.cameraTarget || new THREE.Vector3(0, 0, 0);
  ctx.meshes = ctx.meshes || [];
  ctx.assetCache = ctx.assetCache || { meshGeometries: new Map(), mjTextures: new Map() };
  ctx._shadow = ctx._shadow || { lastCenter: null, lastRadius: 0 };
  ctx._frameCounter = ctx._frameCounter || 0;
  ctx.boundsEvery = typeof ctx.boundsEvery === 'number' && ctx.boundsEvery > 0 ? ctx.boundsEvery : 2;
  ctx.currentCameraMode = typeof ctx.currentCameraMode === 'number' ? ctx.currentCameraMode : 0;
  ctx.fixedCameraActive = !!ctx.fixedCameraActive;
  ctx.viewerCameraSynced = !!ctx.viewerCameraSynced;
  ctx.viewerCameraTrackId = Number.isFinite(ctx.viewerCameraTrackId) ? (ctx.viewerCameraTrackId | 0) : null;

  const cleanup = [];
  const tempVecA = new THREE.Vector3();
  const tempVecB = new THREE.Vector3();
  const tempVecC = new THREE.Vector3();
  const tempVecD = new THREE.Vector3();

  // Expose a small helper so other modules (e.g. environment manager)
  // can tweak JS-side geom view state without needing to know where
  // those fields live.
  ctx.setGeomViewProps = (geomIndex, props) => setGeomViewProps(ctx, geomIndex, props || {});
  ctx.resolveGeomWorldMatrix = (geomIndex, outMat4) => resolveGeomWorldMatrix(ctx, geomIndex, outMat4);
  ctx.resolveGeomWorldPose = (geomIndex, outPos, outQuat, outScale) => resolveGeomWorldPose(ctx, geomIndex, outPos, outQuat, outScale);

  function updateRendererViewport() {
    if (!canvas || !ctx.renderer || !ctx.camera) return;
    let width = 1;
    let height = 1;
    if (typeof canvas.getBoundingClientRect === 'function') {
      const rect = canvas.getBoundingClientRect();
      width = Math.max(1, Math.floor(rect.width || canvas.width || 1));
      height = Math.max(1, Math.floor(rect.height || canvas.height || 1));
    } else {
      width = Math.max(1, canvas.width || canvas.clientWidth || 1);
      height = Math.max(1, canvas.height || canvas.clientHeight || 1);
    }
    if (typeof window !== 'undefined') {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      if (typeof ctx.renderer.setPixelRatio === 'function') ctx.renderer.setPixelRatio(dpr);
    }
    ctx.renderer.setSize(width, height, false);
    ctx.camera.aspect = width / height;
    ctx.camera.updateProjectionMatrix();
  }

  function ensureRenderLoop() {
    if (typeof window === 'undefined' || !window.requestAnimationFrame) return;
    if (ctx.loopActive) return;
    ctx.loopActive = true;
    strictEnsure('ensureRenderLoop', { reason: 'start' });
    const perfEnabled = isPerfEnabled();
    const step = () => {
      if (!ctx.loopActive) return;
      ctx.frameId = window.requestAnimationFrame(step);
      if (!ctx.initialized || !ctx.renderer || !ctx.sceneWorld || !ctx.camera) return;
      const tDrawStart = perfEnabled ? perfNow() : 0;
      // Background/environment is managed by environment manager (ensureEnvIfNeeded)
      renderWorldScene(ctx, ctx.renderer, { camera: ctx.camera });
      if (perfEnabled) {
        const info = ctx.renderer?.info?.render || null;
        if (info) {
          perfSample('renderer:draw_calls', info.calls | 0);
          perfSample('renderer:draw_triangles', info.triangles | 0);
          const programs = ctx.renderer?.info?.programs;
          if (Array.isArray(programs)) {
            perfSample('renderer:program_count', programs.length | 0);
          }
        }
        perfMarkOnce('play:renderer:first_draw');
        perfSample('renderer:draw_ms', perfNow() - tDrawStart);
      }
      // Expose a simple frame counter for headless readiness checks
      ctx._frameCounter = (ctx._frameCounter || 0) + 1;
      window.__frameCounter = ctx._frameCounter;
    };
    ctx.frameId = window.requestAnimationFrame(step);
    if (!ctx.loopCleanup) {
      ctx.loopCleanup = () => {
        ctx.loopActive = false;
        if (typeof window !== 'undefined' && window.cancelAnimationFrame && ctx.frameId != null) {
          window.cancelAnimationFrame(ctx.frameId);
        }
        ctx.frameId = null;
        ctx.loopCleanup = null;
      };
      cleanup.push(ctx.loopCleanup);
    }
    if (typeof document !== 'undefined' && !ctx._visibilityInstalled) {
      const visHandler = () => {
        try {
          if (document.hidden) {
            if (ctx.loopActive && ctx.loopCleanup) ctx.loopCleanup();
          } else {
            ensureRenderLoop();
          }
        } catch (err) {
          strictCatch(err, 'main:visibility_handler');
        }
      };
      document.addEventListener('visibilitychange', visHandler, { capture: true });
      cleanup.push(() => document.removeEventListener('visibilitychange', visHandler, { capture: true }));
      ctx._visibilityInstalled = true;
    }
  }
  function initRenderer() {
    if (ctx.initialized || !canvas) return ctx;

    const wantPreserve = (typeof window !== 'undefined') && (
      window.PLAY_SNAPSHOT_DEBUG === true || window.PLAY_SNAPSHOT_DEBUG === 1 || window.PLAY_SNAPSHOT_DEBUG === '1' ||
      window.__snapshot === 1 || window.__snapshot === true ||
      (typeof window.location?.search === 'string' && window.location.search.includes('snapshot=1'))
    );
    const renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: wantPreserve,
    });
    installMuJoCoShadowViewportInset(renderer);
    renderer.autoClear = false;
    renderer.sortObjects = true;
    if (typeof window !== 'undefined') {
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    }
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;
    if ('physicallyCorrectLights' in renderer) {
      renderer.physicallyCorrectLights = true;
    }
    renderer.setClearColor(DEFAULT_CLEAR_HEX, 1);
    ctx.baseClearHex = DEFAULT_CLEAR_HEX;
    // Shadow map enablement is controlled by the unified state buffer
    // (sceneFlags + appearance + mj lights); avoid an always-on default.
    renderer.shadowMap.enabled = false;
    // MuJoCo's GL renderer relies on depth-compare + linear filtering (PCF-like).
    // Use three.js' PCF filter as the closest built-in match.
    renderer.shadowMap.type = THREE.PCFShadowMap;

    const sceneWorld = new THREE.Scene();

    const ambient = new THREE.AmbientLight(0xffffff, 0);
    ambient.visible = false;
    sceneWorld.add(ambient);
    const hemi = new THREE.HemisphereLight(0xffffff, 0x10131c, 0);
    hemi.visible = false;
    sceneWorld.add(hemi);
    const keyLight = new THREE.DirectionalLight(0xffffff, 0);
    keyLight.position.set(6, -8, 8);
    keyLight.visible = false;
    keyLight.castShadow = false;
    keyLight.shadow.mapSize.set(4096, 4096);
    keyLight.shadow.camera.near = 0.1;
    keyLight.shadow.camera.far = 200;
    keyLight.shadow.camera.left = -30;
    keyLight.shadow.camera.right = 30;
    keyLight.shadow.camera.top = 30;
    keyLight.shadow.camera.bottom = -30;
    keyLight.shadow.bias = -0.0001;
    if ('normalBias' in keyLight.shadow) {
      keyLight.shadow.normalBias = 0.001;
    }
    const lightTarget = new THREE.Object3D();
    sceneWorld.add(lightTarget);
    keyLight.target = lightTarget;
    sceneWorld.add(keyLight);
    const fill = new THREE.DirectionalLight(0xffffff, 0);
    fill.position.set(-6, 6, 3);
    fill.visible = false;
    sceneWorld.add(fill);

    const camera = new THREE.PerspectiveCamera(75, 1, 0.01, GROUND_DISTANCE * 20);
    camera.up.set(0, 0, 1);
    camera.position.set(3, -4, 2);
    camera.lookAt(new THREE.Vector3(0, 0, 0));

    const root = new THREE.Group();
    sceneWorld.add(root);

    Object.assign(ctx, {
      initialized: true,
      renderer,
      sceneWorld,
      scene: sceneWorld,
      camera,
      root,
      ground: null,
      grid: null,
      light: keyLight,
      lightTarget,
      fill,
      hemi,
      ambient,
      assetSource: null,
      meshes: [],
      defaultVopt: null,
      alignSeq: 0,
      copySeq: 0,
      autoAligned: false,
      bounds: null,
      pmrem: null,
      envRT: null,
      envFromHDRI: false,
      hdriReady: false,
      hdriLoading: false,
      hdriBackground: null,
      hdriLoadPromise: null,
      hdriFailed: false,
      hdriLoadGen: 0,
      envDirty: true,
      skyMode: null,
      skyBackground: null,
      skyCube: null,
      skyShader: null,
      skyPalette: null,
      skyDebugMode: null,
      skyInit: false,
    });

    updateRendererViewport();
    if (typeof window !== 'undefined') {
      const resizeListener = () => updateRendererViewport();
      window.addEventListener('resize', resizeListener);
      cleanup.push(() => window.removeEventListener('resize', resizeListener));
      ensureRenderLoop();
    }

    return ctx;
  }
  function renderScene(snapshot, state) {
    if (!snapshot || !state) return;
    const perfEnabled = isPerfEnabled();
    const tRenderStart = perfEnabled ? perfNow() : 0;
    const context = initRenderer();
    if (!context.initialized) return;
    context.visualSourceMode = state.visualSourceMode || 'model';
    if (typeof window !== 'undefined') {
      window.__renderCtx = context;
      window.__envDebug = {
        envIntensity: typeof context.envIntensity === 'number' ? context.envIntensity : null,
        sample: context._envDebugSample || null,
      };
    }
    const renderer = context.renderer;
    const policy = computeScenePolicy(snapshot, state, context);
    const {
      sceneFlags,
      voptFlags,
      segmentEnabled,
      skyboxEnabled,
      shadowEnabled,
      reflectionEnabled,
      fogEnabled,
      hazeEnabled,
    } = policy;
    context.reflectionActive = reflectionEnabled;
    const ngeom = snapshot?.ngeom | 0;

    const assets = state.rendering?.assets || null;
    const tAssetsStart = perfEnabled ? perfNow() : 0;
    syncRendererAssets(context, assets);
    if (perfEnabled) {
      perfSample('renderer:sync_assets_ms', perfNow() - tAssetsStart);
    }
    const geomGroupIds = assets?.geoms?.group || null;
    const geomGroupMask = Array.isArray(state.rendering?.groups?.geom) ? state.rendering.groups.geom : null;
    const flexGroupIds = assets?.flexes?.group || null;
    const flexGroupMask = Array.isArray(state.rendering?.groups?.flex) ? state.rendering.groups.flex : null;
    const skinGroupIds = assets?.skins?.group || null;
    const skinGroupMask = Array.isArray(state.rendering?.groups?.skin) ? state.rendering.groups.skin : null;

    if (typeof ensureEnvIfNeeded === 'function') {
      ensureEnvIfNeeded(context, state, { skyboxEnabled });
    }
    const worldScene = getWorldScene(context);
    if (segmentEnabled) {
      if (!context._segmentEnvBackup && worldScene) {
        context._segmentEnvBackup = {
          background: worldScene.background,
          environment: worldScene.environment,
          shadowEnabled: context.renderer?.shadowMap?.enabled ?? null,
          light: context.light ? context.light.intensity : null,
          fill: context.fill ? context.fill.intensity : null,
          ambient: context.ambient ? context.ambient.intensity : null,
          hemi: context.hemi ? context.hemi.intensity : null,
        };
      }
      if (worldScene) {
        worldScene.environment = null;
        context._segmentBgColor = context._segmentBgColor || new THREE.Color(0x000000);
        worldScene.background = context._segmentBgColor;
      }
      if (context.sky) context.sky.visible = false;
      if (context.renderer?.shadowMap) context.renderer.shadowMap.enabled = false;
      if (context.light) context.light.intensity = 0;
      if (context.fill) context.fill.intensity = 0;
      if (context.ambient) context.ambient.intensity = 0;
      if (context.hemi) context.hemi.intensity = 0;
      context._segmentEnvBackupApplied = true;
    } else {
      if (context._segmentEnvBackup && worldScene) {
        worldScene.background = context._segmentEnvBackup.background || null;
        worldScene.environment = context._segmentEnvBackup.environment || null;
        if (context.renderer?.shadowMap && context._segmentEnvBackup.shadowEnabled != null) {
          context.renderer.shadowMap.enabled = shadowEnabled && context._segmentEnvBackup.shadowEnabled;
        }
        if (context.light && context._segmentEnvBackup.light != null) {
          context.light.intensity = context._segmentEnvBackup.light;
        }
        if (context.fill && context._segmentEnvBackup.fill != null) {
          context.fill.intensity = context._segmentEnvBackup.fill;
        }
        if (context.ambient && context._segmentEnvBackup.ambient != null) {
          context.ambient.intensity = context._segmentEnvBackup.ambient;
        }
        if (context.hemi && context._segmentEnvBackup.hemi != null) {
          context.hemi.intensity = context._segmentEnvBackup.hemi;
        }
        context._segmentEnvBackup = null;
        context._segmentEnvBackupApplied = false;
      }
      if (typeof applyFallbackAppearance === 'function') {
        applyFallbackAppearance(context, state);
      }
      applySkyboxVisibility(context, skyboxEnabled, { useBlackOnDisable: true });
    }
    if (context.grid) {
      context.grid.visible = !segmentEnabled;
    }

    const ground = context.ground;
    const groundData = ground?.userData?.infiniteGround || null;
    const groundUniforms =
      ground?.material?.userData?.infiniteUniforms
      || ground?.material?.uniforms
      || null;
    const baseDistance = Number(groundData?.baseDistance);
    const groundDistance = Number.isFinite(baseDistance) && baseDistance > 0 ? baseDistance : null;
    if (groundUniforms?.uDistance && groundDistance != null) {
      groundUniforms.uDistance.value = groundDistance;
    }
    // Haze-driven fade parameters for the infinite ground. The base cutoff
    // disc is controlled by uQuadDistance and stays active even when haze is
    // disabled; here we only configure the optional fade inside that disc.
    const visStruct = state.model?.vis || null;
    const statStruct = state.model?.stat || null;
    const hazeConfig = resolveHazeConfig(visStruct, statStruct, context.bounds, hazeEnabled);
    const baseRadius =
      (groundUniforms?.uQuadDistance && Number(groundUniforms.uQuadDistance.value))
        || Number(groundData?.baseQuadDistance)
        || groundDistance
        || null;
    if (groundUniforms?.uFadePow) {
      const baseFade = Number(groundData?.baseFadePow);
      const defaultFade = Number.isFinite(baseFade) ? baseFade : 2.5;
      const powValue = hazeConfig.enabled && Number.isFinite(hazeConfig.pow)
        ? hazeConfig.pow
        : (hazeEnabled ? defaultFade : 0.0);
      groundUniforms.uFadePow.value = powValue;
    }
    if (groundUniforms) {
      if (hazeConfig.enabled && baseRadius != null && baseRadius > 0) {
        // Default ground haze: fade region is the outer 30% of the
        // visible disc. The cutoff radius is still controlled by
        // uQuadDistance; haze only shapes transparency inside it.
        const fadeEnd = baseRadius;
        const fadeStart = baseRadius * 0.7;
        if (groundUniforms.uFadeStart) groundUniforms.uFadeStart.value = fadeStart;
        if (groundUniforms.uFadeEnd) groundUniforms.uFadeEnd.value = fadeEnd;
      } else {
        // Disable haze fade while keeping the base cutoff disc active.
        if (groundUniforms.uFadeStart) groundUniforms.uFadeStart.value = 0;
        if (groundUniforms.uFadeEnd) groundUniforms.uFadeEnd.value = 0;
      }
    }
    const fogConfig = resolveFogConfig(visStruct, statStruct, context.bounds, fogEnabled, context);
    if (fogConfig.enabled && !fogConfig.color) {
      const presetFogRaw = state?.rendering?.appearance?.fogColor;
      const presetFog = (typeof presetFogRaw === 'number' && Number.isFinite(presetFogRaw))
        ? presetFogRaw
        : null;
      if (presetFog != null) {
        const fogPresetColor = context._fogPresetColor || (context._fogPresetColor = new THREE.Color());
        fogPresetColor.setHex(presetFog);
        fogConfig.color = fogPresetColor;
      }
    }
    const worldSceneForFog = getWorldScene(context);
    applySceneFog(worldSceneForFog, fogConfig);
    const hazeSummary = {
      mode: 'ground-fade',
      enabled: hazeEnabled && skyboxEnabled,
      reason: hazeEnabled
        ? (skyboxEnabled ? 'enabled' : 'skybox-disabled')
        : 'flag-off',
      fadePow: groundUniforms?.uFadePow?.value ?? null,
      distance: groundDistance,
      fadeStart: groundUniforms?.uFadeStart?.value ?? null,
      fadeEnd: groundUniforms?.uFadeEnd?.value ?? null,
      baseRadius: groundUniforms?.uQuadDistance?.value ?? null,
    };

    const hideAllGeometry = !!policy.hideAllGeometry;

    const nextBounds = computeBoundsFromSceneSoA(snapshot);
    const trackingBounds = computeBoundsFromSceneSoA(snapshot, { ignoreStatic: true }) || nextBounds;
    const trackingGeomSelection = Number.isFinite(state.runtime?.trackingGeom) ? (state.runtime.trackingGeom | 0) : -1;
    const trackingOverride = (() => {
      if (!(trackingGeomSelection >= 0)) return null;
      const scnNgeom = Number.isFinite(snapshot?.scn_ngeom) ? (snapshot.scn_ngeom | 0) : -1;
      if (scnNgeom <= 0) return null;
      const posView = snapshot?.scn_pos || null;
      const sizeView = snapshot?.scn_size || null;
      const typeView = snapshot?.scn_type || null;
      const objTypeView = snapshot?.scn_objtype || null;
      const objIdView = snapshot?.scn_objid || null;
      if (!posView || !sizeView || !typeView || !objTypeView || !objIdView) return null;

      let scnIndex = -1;
      const geomToScn = context?._geomToScn || null;
      if (geomToScn && trackingGeomSelection < geomToScn.length) {
        const candidate = geomToScn[trackingGeomSelection] | 0;
        if (candidate >= 0 && candidate < scnNgeom &&
          ((objTypeView[candidate] | 0) === MJ_OBJ.GEOM) &&
          ((objIdView[candidate] | 0) === trackingGeomSelection)
        ) {
          scnIndex = candidate;
        }
      }
      if (scnIndex < 0) {
        for (let si = 0; si < scnNgeom; si += 1) {
          if ((objTypeView[si] | 0) !== MJ_OBJ.GEOM) continue;
          if ((objIdView[si] | 0) === trackingGeomSelection) { scnIndex = si; break; }
        }
      }
      if (scnIndex < 0) return null;

      const base = scnIndex * 3;
      const px = Number(posView[base + 0]);
      const py = Number(posView[base + 1]);
      const pz = Number(posView[base + 2]);
      if (!Number.isFinite(px) || !Number.isFinite(py) || !Number.isFinite(pz)) return null;
      const sx = Number(sizeView[base + 0]) || 0.1;
      const sy = Number(sizeView[base + 1]) || sx;
      const sz = Number(sizeView[base + 2]) || sx;
      const gType = typeView[scnIndex] ?? MJ_GEOM.BOX;
      const radius = computeGeomRadius(gType, sx, sy, sz);
      return {
        index: trackingGeomSelection,
        position: [px, py, pz],
        radius: Number.isFinite(radius) ? radius : null,
      };
    })();
    syncCameraPoseFromMode(
      backend,
      context,
      state,
      nextBounds,
      { tempVecA, tempVecB, tempVecC, tempVecD },
      { trackingBounds, trackingOverride },
    );
    applyViewerCameraSnapshot(context, snapshot, state, nextBounds, { tempVecA, tempVecB });
    const mjShadowCasters = updateMjLightRig(context, snapshot, state, assets, {
      enabled: !segmentEnabled,
      shadowEnabled,
      bounds: nextBounds || context.bounds || null,
    });

    const baseShadowEnabled = shadowEnabled
      && (Number(state?.rendering?.appearance?.dir?.intensity) > 0);
    const shadowMapEnabled = baseShadowEnabled || (shadowEnabled && (mjShadowCasters | 0) > 0);
    if (context.renderer) {
      context.renderer.shadowMap.enabled = shadowMapEnabled;
      if (context.renderer.shadowMap) {
        context.renderer.shadowMap.type = THREE.PCFShadowMap;
      }
    }
    if (context.light) {
      context.light.castShadow = baseShadowEnabled;
    }
    let drawn = 0;

    const scnNgeom = Number.isFinite(snapshot?.scn_ngeom) ? (snapshot.scn_ngeom | 0) : -1;
    const hasSceneSoA =
      scnNgeom >= 0 &&
      !!snapshot?.scn_type &&
      !!snapshot?.scn_pos &&
      !!snapshot?.scn_mat &&
      !!snapshot?.scn_size &&
      !!snapshot?.scn_rgba &&
      !!snapshot?.scn_matid &&
      !!snapshot?.scn_dataid &&
      !!snapshot?.scn_objtype &&
      !!snapshot?.scn_objid &&
      !!snapshot?.scn_category;

    // Scene-first: decor/debug visuals come from mjvScene; JS overlay builders removed.
    updateSceneLabelOverlays(context, snapshot, state, { hideAllGeometry });

    // Scene-first: base-layer rendering is driven solely by mjvScene SoA.
    // Legacy JS-side scene construction (geom/site/tendon/flex/skin) is disabled.
    if (hasSceneSoA) {
      const tSceneGeomsStart = perfEnabled ? perfNow() : 0;
      drawn = applyMjvSceneSoAGeoms(context, snapshot, state, assets, {
        sceneFlags,
        voptFlags,
        segmentEnabled,
        reflectionEnabled,
        hideAllGeometry,
      });
      if (perfEnabled) {
        perfSample('renderer:apply_scene_soa_ms', perfNow() - tSceneGeomsStart, {
          ngeom: snapshot?.ngeom | 0,
          scn_ngeom: snapshot?.scn_ngeom | 0,
        });
        perfMarkOnce('play:renderer:first_scene_soa_render_end');
      }
    } else {
      // No fallback: wait for scene to become available (initial frames after load).
      if (!context._missingSceneSoALogged) {
        context._missingSceneSoALogged = true;
        logDebug('[render] mjvScene SoA missing; base-layer rendering disabled until scene arrives', {
          ngeom: snapshot?.ngeom | 0,
          scn_ngeom: snapshot?.scn_ngeom | 0,
        });
      }
      drawn = 0;
      if (Array.isArray(context.meshes)) {
        for (const mesh of context.meshes) {
          if (mesh) mesh.visible = false;
        }
      }
      hideFlexGroup(context);
      hideSkinGroup(context);
    }
    context.ground = null;
    for (let i = 0; i < ngeom; i += 1) {
      const candidate = context.meshes?.[i] || null;
      if (candidate?.userData?.infinitePlane && candidate.visible) {
        context.ground = candidate;
        break;
      }
    }
    if (context.ground && Array.isArray(context.geomState)) {
      const groundIndex = context.ground.userData?.geomIndex;
      if (Number.isFinite(groundIndex)) {
        const groundPreset = state?.rendering?.appearance?.ground || null;
        if (groundPreset && typeof groundPreset === 'object') {
          setGeomViewProps(context, groundIndex, {
            color: groundPreset.color,
            opacity: groundPreset.opacity,
            roughness: groundPreset.roughness,
            metallic: groundPreset.metallic,
            envIntensity: groundPreset.envIntensity,
            emission: groundPreset.emission,
          });
          // Apply infinite-ground specific tuning when available.
          const infiniteCfg = groundPreset.infinite || null;
          const groundMesh = context.ground;
          const infiniteData = groundMesh?.userData?.infiniteGround || null;
          const uniforms = infiniteData?.uniforms || null;
          if (infiniteCfg && uniforms) {
            const dist = Number(infiniteCfg.distance);
            if (Number.isFinite(dist) && dist > 0) {
              if (uniforms.uDistance) uniforms.uDistance.value = dist;
              if (uniforms.uQuadDistance) uniforms.uQuadDistance.value = dist;
              if (uniforms.uFadeStart && typeof infiniteCfg.fadeStartFactor === 'number') {
                uniforms.uFadeStart.value = dist * infiniteCfg.fadeStartFactor;
              }
              if (uniforms.uFadeEnd) {
                uniforms.uFadeEnd.value = dist;
              }
            }
            if (uniforms.uFadePow && Number.isFinite(infiniteCfg.fadePow)) {
              uniforms.uFadePow.value = infiniteCfg.fadePow;
            }
            if (uniforms.uGridStep && Number.isFinite(infiniteCfg.gridStep)) {
              uniforms.uGridStep.value = infiniteCfg.gridStep;
            }
            if (uniforms.uGridIntensity && Number.isFinite(infiniteCfg.gridIntensity)) {
              uniforms.uGridIntensity.value = Math.max(0, infiniteCfg.gridIntensity);
            }
            if (uniforms.uGridColor && uniforms.uGridColor.value?.set && infiniteCfg.gridColor != null) {
              uniforms.uGridColor.value.set(infiniteCfg.gridColor);
            }
          }
        } else {
          const gs = context.geomState[groundIndex];
          if (gs && gs.view) {
            gs.view.colorOverride = null;
            gs.view.roughnessOverride = null;
            gs.view.metalnessOverride = null;
            gs.view.envMapIntensityOverride = null;
            gs.view.emissiveIntensityOverride = null;
            gs.view.__dirty = true;
          }
        }
      }
    }

    // Selection visuals rely on mjvScene output (selectpoint/perturb geoms).

    const stats = {
      drawn,
      hidden: Math.max(0, ngeom - drawn),
      contacts: snapshot.contacts?.n ?? 0,
      t: typeof snapshot.t === 'number' ? snapshot.t : null,
      frame: ctx._frameCounter | 0,
    };
    setRenderStats(stats);
    if (Array.isArray(context.meshes)) {
      for (const mesh of context.meshes) {
        if (!mesh) continue;
        const refl = Number(mesh.userData?.reflectance) || 0;
        applyReflectanceToMaterial(mesh, context, refl, reflectionEnabled);
      }
    }

    if (context.light && context.bounds) {
      const r = Math.max(0.1, Number(context.bounds.radius) || 1);
      const cam = context.light.shadow && context.light.shadow.camera ? context.light.shadow.camera : null;
      if (cam && typeof cam.left !== 'undefined') {
        const k = 2.2;
        const l = -r * k;
        const rt = r * k;
        cam.left = l;
        cam.right = rt;
        cam.top = r * 1.6;
        cam.bottom = -r * 1.6;
        cam.near = Math.max(0.01, r * 0.03);
        cam.far = Math.max(40, r * 8);
        if (typeof cam.updateProjectionMatrix === 'function') cam.updateProjectionMatrix();
        // Texel snapping stabilization
        const mapSizeX = context.light.shadow?.mapSize?.x || 2048;
        const mapSizeY = context.light.shadow?.mapSize?.y || mapSizeX;
        const texelX = (cam.right - cam.left) / mapSizeX;
        const texelY = (cam.top - cam.bottom) / mapSizeY;
        const desiredCenter = tempVecA.set(
          context.bounds.center[0],
          context.bounds.center[1],
          context.bounds.center[2]
        );
        // Ensure matrices are up to date
        context.light.updateMatrixWorld?.(true);
        context.light.target?.updateMatrixWorld?.(true);
        cam.updateMatrixWorld?.(true);
        const toLight = tempVecB.copy(desiredCenter).applyMatrix4(cam.matrixWorldInverse);
        const snappedLS = tempVecC.copy(toLight);
        snappedLS.x = Math.round(snappedLS.x / texelX) * texelX;
        snappedLS.y = Math.round(snappedLS.y / texelY) * texelY;
        const snappedWS = tempVecD.copy(snappedLS).applyMatrix4(cam.matrixWorld);
        const lastC = context._shadow.lastCenter;
        const needUpdate =
          !lastC ||
          Math.abs(snappedWS.x - lastC.x) > texelX * 0.5 ||
          Math.abs(snappedWS.y - lastC.y) > texelY * 0.5 ||
          Math.abs(r - context._shadow.lastRadius) > r * 0.02;
        if (needUpdate) {
          if (context.lightTarget) {
            context.lightTarget.position.copy(snappedWS);
            context.light.target?.updateMatrixWorld?.();
          }
          if (!context._shadow.lastCenter) {
            context._shadow.lastCenter = new THREE.Vector3();
          }
          context._shadow.lastCenter.copy(snappedWS);
          context._shadow.lastRadius = r;
        }
      }
    }

    const bounds = nextBounds;
    if (bounds) {
      context.bounds = bounds;
      if (
        context.currentCameraMode === 0 &&
        !context.autoAligned &&
        context.camera
      ) {
        const radius = Math.max(bounds.radius || 0, 0.6);
        const focus = tempVecA.set(bounds.center[0], bounds.center[1], bounds.center[2]);
        const offset = tempVecB.set(radius * 2.6, -radius * 2.6, radius * 1.7);
        context.camera.position.copy(focus).add(offset);
        context.camera.lookAt(focus);
        context.cameraTarget.copy(focus);
        const minFar = Math.max(GROUND_DISTANCE * 2.5, 400);
        const desiredFar = Math.max(minFar, Math.max(radius, ctx.trackingRadius || radius) * 10);
        if (context.camera.far < desiredFar) {
          context.camera.far = desiredFar;
          if (typeof context.camera.updateProjectionMatrix === 'function') {
            context.camera.updateProjectionMatrix();
          }
        }
        context.autoAligned = true;
      }
      if (context.currentCameraMode === 0) {
        cacheTrackingPoseFromCurrent(context, bounds);
      }
      if (context.light) {
        const radius = Math.max(bounds.radius || 0, 0.6);
        const focus = tempVecC.set(bounds.center[0], bounds.center[1], bounds.center[2]);
        const horiz = radius * 3.0;
        const alt = Math.tan(20 * Math.PI / 180) * horiz;
        const lightOffset = tempVecD.set(horiz, -horiz * 0.9, Math.max(0.6, alt));
        // If we have a snapped center from previous step, prefer it to reduce jitter
        const baseCenter = context._shadow.lastCenter ? context._shadow.lastCenter : focus;
        context.light.position.copy(baseCenter).add(lightOffset);
        if (context.lightTarget) {
          context.lightTarget.position.copy(baseCenter);
          context.light.target?.updateMatrixWorld?.();
        }
        context.envDirty = true;
      }
      if (context.hemi) {
        const radius = Math.max(bounds.radius || 0, 0.6);
        context.hemi.position.set(
          bounds.center[0],
          bounds.center[1],
          bounds.center[2] + radius * 2.8
        );
      }
    }

    const alignState = state.runtime?.lastAlign;
    if (
      context.currentCameraMode === 0 &&
      alignState &&
      alignState.seq > context.alignSeq
    ) {
      context.alignSeq = alignState.seq;
      const center = alignState.center || [0, 0, 0];
      const radius = Math.max(
        alignState.radius || 0,
        context.bounds?.radius || 0,
        0.6
      );
      const target = tempVecA.set(center[0], center[1], center[2]);
      const alignOffset = tempVecB.set(radius * 0.8, -radius * 0.8, radius * 0.6);
      context.camera.position.copy(target).add(alignOffset);
      context.camera.lookAt(target);
      context.cameraTarget.copy(target);
      cacheTrackingPoseFromCurrent(context, { radius, center });
      sendViewerCameraSync(backend, context, state, tempVecA);
    }

    const copyState = state.runtime?.lastCopy;
    if (copyState && copyState.seq > context.copySeq) {
      context.copySeq = copyState.seq;
    }
    if (perfEnabled) {
      perfSample('renderer:renderScene_ms', perfNow() - tRenderStart, {
        ngeom: snapshot?.ngeom | 0,
        scn_ngeom: snapshot?.scn_ngeom | 0,
        drawn,
      });
      perfMarkOnce('play:renderer:first_renderScene_end');
    }
  }

  function setup() {
    initRenderer();
    return ctx;
  }

  function getContext() {
    return ctx && ctx.initialized ? ctx : null;
  }

  function dispose() {
    if (!ctx) return;
    ctx.loopActive = false;
    while (cleanup.length) {
      const fn = cleanup.pop();
      try { fn(); } catch (err) { strictCatch(err, 'main:renderer_cleanup'); }
    }
    ctx._visibilityInstalled = false;
    if (ctx.frameId != null && typeof window !== 'undefined' && window.cancelAnimationFrame) {
      try { window.cancelAnimationFrame(ctx.frameId); } catch (err) { strictCatch(err, 'main:renderer_cancel'); }
    }
    ctx.frameId = null;
    ctx.loopCleanup = null;

    disposeInstancing(ctx);

    if (Array.isArray(ctx.meshes)) {
      for (const mesh of ctx.meshes) {
        if (mesh) disposeMeshObject(mesh);
      }
      ctx.meshes.length = 0;
    }

    if (ctx.flexGroup) {
      disposeObject3DTree(ctx.flexGroup);
      ctx.flexGroup = null;
      ctx.flexPool = [];
    }
    if (ctx.skinGroup) {
      disposeObject3DTree(ctx.skinGroup);
      ctx.skinGroup = null;
      ctx.skinPool = [];
    }
    if (ctx.labelGroup) {
      disposeObject3DTree(ctx.labelGroup);
      ctx.labelGroup = null;
      ctx.labelPool = [];
    }

    if (ctx.materialPool && typeof ctx.materialPool.disposeAll === 'function') {
      try { ctx.materialPool.disposeAll(); } catch (err) { strictCatch(err, 'main:materialPool_dispose'); }
      ctx.materialPool = null;
    }
    disposeLabelTextureCache();

    if (ctx.assetCache && ctx.assetCache.meshGeometries instanceof Map) {
      for (const geometry of ctx.assetCache.meshGeometries.values()) {
        if (geometry && typeof geometry.dispose === 'function') {
          try { geometry.dispose(); } catch (err) { strictCatch(err, 'main:assetCache_dispose'); }
        }
      }
      ctx.assetCache.meshGeometries.clear();
    }
    if (ctx.assetCache && ctx.assetCache.mjTextures instanceof Map) {
      for (const texture of ctx.assetCache.mjTextures.values()) {
        if (texture && typeof texture.dispose === 'function') {
          try { texture.dispose(); } catch (err) { strictCatch(err, 'main:assetCache_dispose'); }
        }
      }
      ctx.assetCache.mjTextures.clear();
    }

    const disposeResource = (resource) => {
      if (resource && typeof resource.dispose === 'function') {
        try { resource.dispose(); } catch (err) { strictCatch(err, 'main:env_dispose'); }
      }
    };
    disposeResource(ctx.envRT);
    disposeResource(ctx.pmrem);
    disposeResource(ctx.hdriBackground);
    disposeResource(ctx.skyBackground);
    disposeResource(ctx.skyCube);
    if (ctx.skyShader) {
      disposeObject3DTree(ctx.skyShader);
      ctx.skyShader = null;
    }
    const skyCache = ctx.skyCache || null;
    if (skyCache) {
      const entries = [skyCache.model, skyCache.preset, skyCache.none];
      for (const entry of entries) {
        if (!entry) continue;
        disposeResource(entry.envRT);
        disposeResource(entry.background);
      }
      skyCache.model = null;
      skyCache.preset = null;
      skyCache.none = null;
    }
    ctx.envRT = null;
    ctx.pmrem = null;
    ctx.hdriBackground = null;
    ctx.skyBackground = null;
    ctx.skyCube = null;
    ctx.assetCache = { meshGeometries: new Map(), mjTextures: new Map() };

    if (ctx.renderer && typeof ctx.renderer.dispose === 'function') {
      try { ctx.renderer.dispose(); } catch (err) { strictCatch(err, 'main:renderer_dispose'); }
    }
    ctx.renderer = null;
    ctx.sceneWorld = null;
    ctx.scene = null;
    ctx.camera = null;
    ctx.root = null;
    ctx.light = null;
    ctx.lightTarget = null;
    ctx.fill = null;
    ctx.hemi = null;
    ctx.ambient = null;
    ctx.initialized = false;
  }

  return {
    setup,
    renderScene,
    ensureRenderLoop,
    updateViewport: () => updateRendererViewport(),
    getContext,
    dispose,
  };
}



function createCameraController({
  THREE_NS,
  canvas,
  store,
  backend,
  onGesture,
  renderCtx,
  debugMode = false,
  useWasmCamera = false,
  globalUp = new THREE_NS.Vector3(0, 0, 1),
  // new options (high‑leverage changes)
  minDistance,
  getMinDistance,
  zoomK = 0.35,
  maxWheelStep,
  invertY = false,
  keyRoot = null,
  assertUp = false,
  wheelLineFactor = 16,
  wheelPageFactor = 800,
  minOrthoZoom = 0.05,
  maxOrthoZoom = 200,
}) {
  const pointerState = {
    id: null,
    mode: 'idle',
    lastX: null,
    lastY: null,
    active: false,
  };

  const modifierState = {
    ctrl: false,
    shift: false,
    alt: false,
    meta: false,
  };

  const tempVecA = new THREE_NS.Vector3();
  const tempVecB = new THREE_NS.Vector3();
  const tempVecC = new THREE_NS.Vector3();
  const tempVecD = new THREE_NS.Vector3();
  const tempVecE = new THREE_NS.Vector3();
  const tempSpherical = new THREE_NS.Spherical();

  const cleanup = [];
  let initialised = false;
  let upNormalised = new THREE_NS.Vector3().copy(globalUp).normalize();
  let up0 = upNormalised.clone();

  const cameraModeIndex = () => {
    try {
      return store.get()?.runtime?.cameraIndex ?? 0;
    } catch (err) {
      strictCatch(err, 'main:cameraModeIndex');
      return 0;
    }
  };

  const isInteractiveCamera = () => cameraModeIndex() <= 1;

  function currentCtrl(event) {
    return !!event?.ctrlKey || modifierState.ctrl;
  }

  function currentShift(event) {
    return !!event?.shiftKey || modifierState.shift;
  }

  function resolveGestureMode(event) {
    const btn = typeof event.button === 'number' ? event.button : 0;
    if (btn === 2) return 'translate';
    if (btn === 1) return 'zoom';
    return 'rotate';
  }

  function pointerButtons(event) {
    if (event && typeof event.buttons === 'number') return event.buttons;
    if (event && typeof event.button === 'number') {
      switch (event.button) {
        case 0:
          return 1;
        case 1:
          return 4;
        case 2:
          return 2;
        default:
          return 1 << event.button;
      }
    }
    return 0;
  }

  function computeMinDistance(camera, target) {
    if (Number.isFinite(minDistance)) return Math.max(0.01, Number(minDistance));
    if (typeof getMinDistance === 'function') {
      const v = Number(getMinDistance(camera, target, renderCtx));
      if (Number.isFinite(v) && v > 0) return Math.max(0.01, v);
    }
    return 0.15;
  }

  const ZOOM_INCREMENT = 0.02;

  function computeWheelReldy(dy) {
    const dyLines = dy / wheelLineFactor;
    return ZOOM_INCREMENT * dyLines;
  }

  function buildCameraPayloadIfNeeded() {
    if (!useWasmCamera || !renderCtx) return null;
    const state = typeof store?.get === 'function' ? store.get() : null;
    const mode = Number(state?.runtime?.cameraIndex ?? 0) | 0;
    const trackingBodyId = mode === 1 ? resolveTrackingBodyId(state) : null;
    const needsSync =
      !renderCtx.viewerCameraSynced ||
      (mode === 1 && Number.isFinite(trackingBodyId) && trackingBodyId !== renderCtx.viewerCameraTrackId);
    if (!needsSync) return null;
    const payload = buildViewerCameraPayload(renderCtx, state, tempVecE);
    if (payload) {
      renderCtx.viewerCameraSynced = true;
      renderCtx.viewerCameraTrackId = Number.isFinite(payload.trackbodyid) ? (payload.trackbodyid | 0) : null;
    }
    return payload;
  }

  function applyCameraGesture(mode, dx, dy) {
    const ctx = renderCtx;
    const camera = ctx.camera;
    if (!camera) return;
    if (!ctx.cameraTarget) {
      ctx.cameraTarget = new THREE_NS.Vector3(0, 0, 0);
    }
    const target = ctx.cameraTarget;
    const offset = tempVecA.copy(camera.position).sub(target);
    const distance = offset.length();
    const minDist = computeMinDistance(camera, target);
    if (assertUp && renderCtx?.camera) {
      try {
        const dot = renderCtx.camera.up.clone().normalize().dot(up0);
        if (dot < 0.999) {
          renderCtx.camera.up.copy(upNormalised);
        }
      } catch (err) {
        strictCatch(err, 'main:camera_up_adjust');
      }
    }

    const elementWidth = canvas?.clientWidth || (typeof window !== 'undefined' ? window.innerWidth : 1) || 1;
    const { reldx: relDx, reldy: relDy } = normalizeDeltaByViewportHeight(canvas, dx, dy, invertY);
    const fovRad = THREE_NS.MathUtils.degToRad(typeof camera.fov === 'number' ? camera.fov : 45);
    const isOrtho = !!camera.isOrthographicCamera;

    switch (mode) {
      case 'translate': {
        let moveX = 0;
        let moveY = 0;
        if (isOrtho && typeof camera.zoom === 'number') {
          const zoom = Math.max(1e-6, camera.zoom || 1);
          const widthWorld = Math.abs((camera.right ?? 1) - (camera.left ?? -1)) / zoom;
          const heightWorld = Math.abs((camera.top ?? 1) - (camera.bottom ?? -1)) / zoom;
          moveX = -relDx * widthWorld;
          moveY = relDy * heightWorld;
        } else {
          const panScale = distance * Math.tan(fovRad / 2);
          moveX = -2 * relDx * panScale;
          moveY = 2 * relDy * panScale;
        }
        const forward = tempVecB;
        camera.getWorldDirection(forward).normalize();
        const up = tempVecD.copy(upNormalised);
        const right = tempVecC.copy(forward).cross(up).normalize();
        const pan = right.multiplyScalar(moveX).add(up.multiplyScalar(moveY));
        camera.position.add(pan);
        target.add(pan);
        camera.lookAt(target);
        break;
      }
      case 'zoom': {
        if (isOrtho && typeof camera.zoom === 'number') {
          const base = Math.max(1e-6, camera.zoom || 1);
          const factor = Math.exp((dy / shortEdge) * (Number.isFinite(zoomK) ? zoomK * 0.2 : 0.07));
          const nextZoom = THREE_NS.MathUtils.clamp(base * factor, minOrthoZoom, maxOrthoZoom);
          camera.zoom = nextZoom;
          if (typeof camera.updateProjectionMatrix === 'function') camera.updateProjectionMatrix();
        } else {
          const zoomSpeed = distance * 0.002;
          const delta = dy * zoomSpeed;
          const newLen = Math.max(minDist, distance + delta);
          offset.setLength(newLen);
          camera.position.copy(tempVecC.copy(target).add(offset));
          camera.lookAt(target);
        }
        break;
      }
      case 'rotate': {
        let yaw = -relDx * Math.PI;
        let pitch = -relDy * Math.PI;
        if (distance <= minDist * 1.05) {
          yaw *= 0.35;
          pitch *= 0.35;
        }
        const up = tempVecD.copy(upNormalised);
        const forward = tempVecB.copy(target).sub(camera.position).normalize();
        const right = tempVecC.copy(forward).cross(up).normalize();
        forward.applyAxisAngle(up, -yaw);
        forward.applyAxisAngle(right, -pitch);
        forward.normalize();
        const nextTarget = tempVecA.copy(camera.position).add(forward.multiplyScalar(distance));
        target.copy(nextTarget);
        camera.lookAt(target);
        break;
      }
      case 'orbit':
      default: {
        const thetaDelta = -relDx * Math.PI;
        const phiDelta = -relDy * Math.PI;
        tempSpherical.setFromVector3(offset);
        tempSpherical.theta += thetaDelta;
        tempSpherical.phi += phiDelta;
        tempSpherical.makeSafe();
        tempSpherical.radius = Math.max(minDist, tempSpherical.radius);
        offset.setFromSpherical(tempSpherical);
        camera.position.copy(tempVecC.copy(target).add(offset));
        camera.lookAt(target);
        break;
      }
    }
  }

  function handlePointerDown(event) {
    if (!event || !isInteractiveCamera()) return;
    const mode = resolveGestureMode(event);
    pointerState.id = event.pointerId ?? event.pointerId === 0 ? event.pointerId : 'mouse';
    pointerState.active = true;
    pointerState.mode = mode;
    pointerState.lastX = event.clientX;
    pointerState.lastY = event.clientY;
    if (canvas && typeof canvas.setPointerCapture === 'function' && event.pointerId != null) {
      try { canvas.setPointerCapture(event.pointerId); } catch (err) { strictCatch(err, 'main:pointer_capture'); }
    }
    if (typeof onGesture === 'function') {
      const camPayload = buildCameraPayloadIfNeeded();
      onGesture({
        mode,
        phase: 'start',
        pointer: event,
        gestureType: 'camera',
        shiftKey: currentShift(event),
        reldx: 0,
        reldy: 0,
        cam: camPayload,
      });
    }
  }

  function handlePointerMove(event) {
    if (!event || !pointerState.active) return;
    if (pointerState.id !== (event.pointerId ?? pointerState.id)) return;
    const dx = (event.clientX ?? 0) - (pointerState.lastX ?? event.clientX ?? 0);
    const dy = (event.clientY ?? 0) - (pointerState.lastY ?? event.clientY ?? 0);
    pointerState.lastX = event.clientX;
    pointerState.lastY = event.clientY;
    if (!dx && !dy) return;
    const { reldx, reldy } = normalizeDeltaByViewportHeight(canvas, dx, dy, invertY);
    if (!useWasmCamera) {
      applyCameraGesture(pointerState.mode, dx, dy);
    }
    if (typeof onGesture === 'function') {
      const camPayload = buildCameraPayloadIfNeeded();
      onGesture({
        mode: pointerState.mode,
        phase: 'update',
        pointer: event,
        drag: { dx, dy },
        gestureType: 'camera',
        shiftKey: currentShift(event),
        reldx,
        reldy,
        cam: camPayload,
      });
    }
  }

  function handlePointerUp(event) {
    if (!event || !pointerState.active) return;
    if (pointerState.id !== (event.pointerId ?? pointerState.id)) return;
    if (typeof onGesture === 'function') {
      onGesture({
        mode: pointerState.mode,
        phase: 'end',
        pointer: event,
        gestureType: 'camera',
        shiftKey: currentShift(event),
        reldx: 0,
        reldy: 0,
      });
    }
    pointerState.active = false;
    pointerState.id = null;
    pointerState.mode = 'idle';
    pointerState.lastX = null;
    pointerState.lastY = null;
    if (canvas && typeof canvas.releasePointerCapture === 'function' && event.pointerId != null) {
      try { canvas.releasePointerCapture(event.pointerId); } catch (err) { strictCatch(err, 'main:pointer_release'); }
    }
  }

  function handleWheel(event) {
    if (!event || !isInteractiveCamera()) return;
    if (typeof event.preventDefault === 'function') event.preventDefault();
    let dy = event.deltaY;
    if (event.deltaMode === 1) dy *= wheelLineFactor;
    if (event.deltaMode === 2) dy *= wheelPageFactor;
    if (Number.isFinite(maxWheelStep)) {
      dy = Math.max(-maxWheelStep, Math.min(maxWheelStep, dy));
    }
    const reldy = computeWheelReldy(dy);
    if (!useWasmCamera) {
      applyCameraGesture('zoom', 0, dy);
    }
    if (typeof onGesture === 'function') {
      const camPayload = buildCameraPayloadIfNeeded();
      onGesture({
        mode: 'zoom',
        phase: 'update',
        pointer: event,
        drag: { dx: 0, dy },
        gestureType: 'camera',
        shiftKey: currentShift(event),
        reldx: 0,
        reldy,
        cam: camPayload,
      });
    }
  }

  function handleKey(event, nextState) {
    if (!event) return;
    if (typeof event.key !== 'string') return;
    const key = event.key.toLowerCase();
    if (key === 'control') modifierState.ctrl = nextState;
    if (key === 'shift') modifierState.shift = nextState;
    if (key === 'alt') modifierState.alt = nextState;
    if (key === 'meta') modifierState.meta = nextState;
  }

  function install() {
    if (initialised) return;
    initialised = true;
    if (!canvas) return;
    const root = keyRoot || canvas;
    const onPointerDown = (event) => handlePointerDown(event);
    const onPointerMove = (event) => handlePointerMove(event);
    const onPointerUp = (event) => handlePointerUp(event);
    const onWheel = (event) => handleWheel(event);
    const onContextMenu = (event) => {
      if (typeof event?.preventDefault === 'function') event.preventDefault();
    };
    const onKeyDown = (event) => handleKey(event, true);
    const onKeyUp = (event) => handleKey(event, false);
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerUp);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('contextmenu', onContextMenu);
    if (root) {
      root.addEventListener('keydown', onKeyDown);
      root.addEventListener('keyup', onKeyUp);
    }
    cleanup.push(() => {
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerUp);
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('contextmenu', onContextMenu);
      if (root) {
        root.removeEventListener('keydown', onKeyDown);
        root.removeEventListener('keyup', onKeyUp);
      }
    });
  }

  function dispose() {
    while (cleanup.length) {
      const fn = cleanup.pop();
      try { fn(); } catch (err) { strictCatch(err, 'main:camera_cleanup'); }
    }
  }

  return {
    install,
    setup: install,
    dispose,
    applyGesture: applyCameraGesture,
    getModifierState: () => ({ ...modifierState }),
    isInteractiveCamera,
  };
}

function defaultSelection() {
  return {
    geom: -1,
    body: -1,
    joint: -1,
    name: '',
    kind: 'geom',
    point: [0, 0, 0],
    localPoint: [0, 0, 0],
    anchorLocal: null,
    normal: [0, 0, 1],
    seq: 0,
    timestamp: 0,
  };
}

const PERTURB_LABEL = {
  translate: 'perturb-translate',
  rotate: 'perturb-rotate',
};

const STATIC_PICK_BLOCK = { blocked: 'static' };

function createPickingController({
  THREE_NS = THREE,
  canvas,
  store,
  backend,
  renderCtx,
  debugMode = false,
  globalUp = new THREE_NS.Vector3(0, 0, 1),
  getSnapshot = null,
} = {}) {
  if (!canvas || !store || !backend || !renderCtx) {
    throw new Error('Picking controller requires canvas, store, backend, and renderCtx.');
  }
  const raycaster = new THREE_NS.Raycaster();
  const pointerNdc = new THREE_NS.Vector2();
  const normalMatrix = new THREE_NS.Matrix3();
  const tempQuat = new THREE_NS.Quaternion();
  const tempMat4 = new THREE_NS.Matrix4();
  const tempVecA = new THREE_NS.Vector3();
  const dragState = {
    active: false,
    pointerId: null,
    mode: 'idle',
    lastX: 0,
    lastY: 0,
    shiftKey: false,
    startButton: 0,
    perturbBegun: false,
    anchorLocal: new THREE_NS.Vector3(),
    bodyId: -1,
  };
  const cleanup = [];
  const tempBodyPos = new THREE_NS.Vector3();
  const tempBodyRot = new Float64Array(9);
  const tempVecLocal = new THREE_NS.Vector3();

  function hasSelection() {
    const sel = store.get()?.runtime?.selection;
    return !!sel && Number.isInteger(sel.body) && sel.body > 0;
  }

  function currentSelection() {
    return store.get()?.runtime?.selection || null;
  }

  function selectionSeq(nextSeq) {
    return Number.isFinite(nextSeq) ? nextSeq : (currentSelection()?.seq || 0) + 1;
  }

  function clearSelection({ toast = false } = {}) {
    const ts = Date.now();
    store.update((draft) => {
      const runtime = draft.runtime || (draft.runtime = {});
      runtime.selection = { ...defaultSelection(), seq: 0, timestamp: ts };
      runtime.lastAction = 'select-none';
      if (toast) {
        draft.toast = { message: 'Selection cleared', ts };
      }
    });
    dragState.bodyId = -1;
    backend.setSelection?.({ bodyId: 0 });
  }

  function showToast(message) {
    if (!message) return;
    const ts = Date.now();
    store.update((draft) => {
      draft.toast = { message, ts };
    });
  }

  function updateSelection(pick) {
    if (!pick) return;
    const ts = Date.now();
    let anchor = null;
    dragState.bodyId = -1;
    if (pick.bodyId > 0 && setAnchorLocalFromWorld(pick.bodyId, pick.worldPoint)) {
      dragState.bodyId = pick.bodyId;
      anchor = [dragState.anchorLocal.x, dragState.anchorLocal.y, dragState.anchorLocal.z];
    }
    store.update((draft) => {
      const runtime = draft.runtime || (draft.runtime = {});
      const seq = (runtime.selection?.seq || 0) + 1;
      runtime.selection = {
        geom: pick.geomIndex,
        body: pick.bodyId,
        joint: pick.jointId,
        name: pick.geomName,
        kind: 'geom',
        point: [pick.worldPoint.x, pick.worldPoint.y, pick.worldPoint.z],
        localPoint: [pick.localPoint.x, pick.localPoint.y, pick.localPoint.z],
        anchorLocal: anchor,
        normal: [pick.worldNormal.x, pick.worldNormal.y, pick.worldNormal.z],
        seq,
        timestamp: ts,
      };
      runtime.lastAction = 'select';
      draft.toast = { message: `Selected ${pick.geomName}`, ts };
    });
    if (anchor) {
      backend.setSelection?.({ bodyId: pick.bodyId, localpos: anchor });
    } else {
      backend.setSelection?.({ bodyId: 0 });
    }
  }

  const meshList = [];
  function getMeshList() {
    meshList.length = 0;
    const batches = renderCtx?._instancing?.batches || null;
    if (batches instanceof Map) {
      for (const batch of batches.values()) {
        const mesh = batch?.mesh || null;
        const count = typeof mesh?.count === 'number' ? (mesh.count | 0) : 0;
        if (mesh && mesh.visible !== false && count > 0) {
          meshList.push(mesh);
        }
      }
    }
    if (Array.isArray(renderCtx.meshes)) {
      for (const mesh of renderCtx.meshes) {
        if (mesh && mesh.visible !== false) meshList.push(mesh);
      }
    }
    return meshList;
  }

  function projectPointer(event) {
    const rect = canvas.getBoundingClientRect();
    const width = Math.max(1, rect.width);
    const height = Math.max(1, rect.height);
    pointerNdc.x = ((event.clientX - rect.left) / width) * 2 - 1;
    pointerNdc.y = -(((event.clientY - rect.top) / height) * 2 - 1);
    return { width, height };
  }

  function resolveGeomMesh(object) {
    let current = object;
    while (current) {
      if (typeof current.userData?.geomIndex === 'number') {
        return current;
      }
      current = current.parent;
    }
    return null;
  }

  function geomNameFor(index) {
    const mesh = Array.isArray(renderCtx.meshes) ? renderCtx.meshes[index] : null;
    if (mesh?.userData?.geomName) {
      return mesh.userData.geomName;
    }
    const state = store.get();
    const lookup = getOrCreateGeomNameLookup(renderCtx, state?.model?.geoms || null);
    return geomNameFromLookup(lookup, index);
  }

  function bodyIdFor(index) {
    const mesh = Array.isArray(renderCtx.meshes) ? renderCtx.meshes[index] : null;
    if (Number.isFinite(mesh?.userData?.geomBodyId)) {
      return mesh.userData.geomBodyId | 0;
    }
    const arr = store.get()?.model?.geomBodyId || null;
    if (!arr || !(index >= 0) || index >= arr.length) return -1;
    const bodyId = arr[index];
    return Number.isFinite(bodyId) ? (bodyId | 0) : -1;
  }

  function jointIdFor(bodyId) {
    if (!(bodyId >= 0)) return -1;
    const state = store.get();
    const bodyAdr = state?.model?.bodyJntAdr;
    const bodyNum = state?.model?.bodyJntNum;
    const jtype = state?.model?.jntType;
    if (!bodyAdr || !bodyNum || !jtype) return -1;
    const base = bodyAdr[bodyId] ?? -1;
    const num = bodyNum[bodyId] ?? 0;
    if (!(num > 0)) return -1;
    const j = base >= 0 ? (base | 0) : -1;
    if (j < 0 || j >= jtype.length) return -1;
    return j;
  }

  function applySelectionFromPick(pick, event = null) {
    updateSelection(pick);
    if (!event) return;
    if (event.shiftKey) {
      store.update((draft) => {
        const runtime = draft.runtime || (draft.runtime = {});
        runtime.trackingGeom = pick.geomIndex;
      });
      const trackingCtrl = { item_id: 'simulation.tracking_geom', type: 'select' };
      const cameraCtrl = { item_id: 'simulation.camera', type: 'select' };
      Promise.resolve(
        applySpecAction(store, backend, trackingCtrl, pick.geomIndex),
      )
        .then(() => applySpecAction(store, backend, cameraCtrl, 1))
        .catch((err) => {
          strictCatch(err, 'main:applySelectionFromPick');
        });
    }
  }

  function resolveDragMode(event) {
    const buttons = typeof event.buttons === 'number' ? event.buttons : 0;
    if ((buttons & 2) !== 0 || event.button === 2) return 'translate';
    return 'rotate';
  }

  function selectionAsBody() {
    const sel = currentSelection();
    if (!sel || sel.body < 0) return null;
    return sel.body;
  }

  function updateAnchorFromSelection() {
    const sel = currentSelection();
    if (!sel || sel.body < 1) return false;
    dragState.bodyId = sel.body | 0;
    if (Array.isArray(sel.anchorLocal) && sel.anchorLocal.length >= 3) {
      dragState.anchorLocal.set(
        Number(sel.anchorLocal[0]) || 0,
        Number(sel.anchorLocal[1]) || 0,
        Number(sel.anchorLocal[2]) || 0,
      );
      return true;
    }
    if (!sel.point) return false;
    tempVecA.set(sel.point[0], sel.point[1], sel.point[2]);
    return setAnchorLocalFromWorld(sel.body, tempVecA);
  }

  function setAnchorLocalFromWorld(bodyId, worldPoint) {
    const snapshot = typeof getSnapshot === 'function' ? getSnapshot() : null;
    const bxpos = snapshot?.bxpos || null;
    const bxmat = snapshot?.bxmat || null;
    if (!bxpos || !bxmat) return false;
    const base = bodyId * 3;
    const baseMat = bodyId * 9;
    if (base + 2 >= bxpos.length || baseMat + 8 >= bxmat.length) return false;
    tempBodyPos.set(
      Number(bxpos[base + 0]) || 0,
      Number(bxpos[base + 1]) || 0,
      Number(bxpos[base + 2]) || 0,
    );
    tempBodyRot.set([
      Number(bxmat[baseMat + 0]) || 1,
      Number(bxmat[baseMat + 1]) || 0,
      Number(bxmat[baseMat + 2]) || 0,
      Number(bxmat[baseMat + 3]) || 0,
      Number(bxmat[baseMat + 4]) || 1,
      Number(bxmat[baseMat + 5]) || 0,
      Number(bxmat[baseMat + 6]) || 0,
      Number(bxmat[baseMat + 7]) || 0,
      Number(bxmat[baseMat + 8]) || 1,
    ]);
    tempQuat.setFromRotationMatrix(tempMat4.set(
      tempBodyRot[0], tempBodyRot[1], tempBodyRot[2], 0,
      tempBodyRot[3], tempBodyRot[4], tempBodyRot[5], 0,
      tempBodyRot[6], tempBodyRot[7], tempBodyRot[8], 0,
      0, 0, 0, 1,
    ));
    tempVecLocal.copy(worldPoint).sub(tempBodyPos);
    tempVecLocal.applyQuaternion(tempQuat.invert());
    dragState.anchorLocal.copy(tempVecLocal);
    return true;
  }

  function resolvePick(event) {
    const { width, height } = projectPointer(event);
    const camera = renderCtx.camera;
    if (!camera) return null;
    raycaster.setFromCamera(pointerNdc, camera);
    const list = getMeshList();
    if (!list.length) return null;
    const hits = raycaster.intersectObjects(list, true);
    if (!hits.length) return null;
    let hit = null;
    let mesh = null;
    let geomIndex = -1;
    for (const entry of hits) {
      if (!entry?.object || !entry?.point) continue;
      const resolved = resolveGeomMesh(entry.object);
      const idx = resolved?.userData?.geomIndex ?? -1;
      if (resolved && idx >= 0) {
        hit = entry;
        mesh = resolved;
        geomIndex = idx;
        break;
      }
    }
    if (!hit || !mesh || geomIndex < 0) return null;
    const geomName = mesh.userData?.geomName || geomNameFor(geomIndex);
    const bodyId = bodyIdFor(geomIndex);
    if (mesh.userData?.geomStatic) {
      return { blocked: 'static', geomIndex, geomName };
    }
    const normal = hit.face?.normal || null;
    if (!normal) return null;
    const worldNormal = normal.clone().applyMatrix3(normalMatrix.getNormalMatrix(hit.object.matrixWorld)).normalize();
    const localPoint = hit.point.clone();
    hit.object.worldToLocal(localPoint);
    return {
      geomIndex,
      geomName,
      bodyId,
      jointId: jointIdFor(bodyId),
      worldPoint: hit.point.clone(),
      localPoint,
      worldNormal,
      screen: { width, height },
    };
  }

  function selectionFromPick(pick, event) {
    if (!pick) return null;
    if (pick.blocked === 'static') return STATIC_PICK_BLOCK;
    if (!Number.isFinite(pick.geomIndex) || pick.geomIndex < 0) return null;
    applySelectionFromPick(pick, event);
    return pick;
  }

  function beginPerturb(event) {
    const bodyId = dragState.bodyId;
    if (!(bodyId > 0)) return;
    backend.applyPerturb?.({
      phase: 'begin',
      mode: dragState.mode,
      shiftKey: !!event?.shiftKey,
      bodyId,
      localpos: [dragState.anchorLocal.x, dragState.anchorLocal.y, dragState.anchorLocal.z],
    });
    store.update((draft) => {
      const runtime = draft.runtime || (draft.runtime = {});
      const perturb = runtime.perturb || (runtime.perturb = { mode: 'idle', active: false });
      perturb.mode = dragState.mode;
      perturb.active = true;
      runtime.lastAction = dragState.mode === 'translate' ? 'translate' : 'rotate';
    });
  }

  function movePerturb(event) {
    if (!dragState.active || dragState.pointerId !== event.pointerId) return;
    const dx = event.clientX - dragState.lastX;
    const dy = event.clientY - dragState.lastY;
    dragState.lastX = event.clientX;
    dragState.lastY = event.clientY;
    if (!dragState.perturbBegun) return;
    // MuJoCo/simulate normalizes by viewport height, using the UI "y-down" convention:
    // dy > 0 means pointer moved down (browser `clientY` increases).
    const { reldx, reldy } = normalizeDeltaByViewportHeight(canvas, dx, dy);
    backend.applyPerturb?.({
      phase: 'move',
      mode: dragState.mode,
      shiftKey: !!event.shiftKey,
      reldx,
      reldy,
    });
  }

  function endPerturb() {
    backend.applyPerturb?.({ phase: 'end' });
    store.update((draft) => {
      if (draft.runtime?.perturb) {
        draft.runtime.perturb.active = false;
        draft.runtime.perturb.mode = 'idle';
      }
    });
  }

  function onClick(event) {
    if (!event) return;
    if (event.button !== 0) return;
  }

  function onDoubleClick(event) {
    if (!event) return;
    endPerturb();
    const rect = canvas?.getBoundingClientRect?.() || null;
    const width = rect ? rect.width : (canvas?.clientWidth || 1);
    const height = rect ? rect.height : (canvas?.clientHeight || 1);
    if (!(width > 0) || !(height > 0)) return;
    const relx = rect ? ((event.clientX - rect.left) / width) : 0;
    // NOTE: MuJoCo's `mjv_select` expects `rely` in a bottom-origin convention:
    // rely=0 at the viewport bottom, rely=1 at the viewport top (see `engine_vis_interact.c`).
    // Browser `clientY` is top-origin, so we flip it here to match MuJoCo/simulate semantics.
    const rely = rect ? ((rect.bottom - event.clientY) / height) : 0;
    backend.selectAt?.({
      relx: THREE_NS.MathUtils.clamp(relx, 0, 1),
      rely: THREE_NS.MathUtils.clamp(rely, 0, 1),
      aspect: width / height,
    });
  }

  function onPointerMove(event) {
    if (!dragState.active || dragState.pointerId !== event.pointerId) return;
    movePerturb(event);
  }

  function onPointerDragStart(event) {
    if (!event) return;
    if (!hasSelection()) return;
    if (!event.ctrlKey) return;
    dragState.active = true;
    dragState.pointerId = event.pointerId ?? null;
    dragState.mode = resolveDragMode(event);
    dragState.lastX = event.clientX;
    dragState.lastY = event.clientY;
    dragState.shiftKey = !!event.shiftKey;
    dragState.startButton = typeof event.button === 'number' ? event.button : 0;
    dragState.perturbBegun = true;
    updateAnchorFromSelection();
    beginPerturb(event);
    if (dragState.pointerId != null && canvas?.setPointerCapture) {
      try { canvas.setPointerCapture(dragState.pointerId); } catch (err) { strictCatch(err, 'main:drag_pointer_capture'); }
    }
    return true;
  }

  function onPointerDragEnd(event) {
    if (!dragState.active) return;
    dragState.active = false;
    if (dragState.pointerId != null && canvas?.releasePointerCapture) {
      try { canvas.releasePointerCapture(dragState.pointerId); } catch (err) { strictCatch(err, 'main:drag_pointer_release'); }
    }
    dragState.pointerId = null;
    if (dragState.perturbBegun) {
      endPerturb();
    }
    dragState.perturbBegun = false;
  }

  function install() {
    const onPointerDownEvt = (event) => {
      if (event.ctrlKey && (event.button === 0 || event.button === 2)) {
        const started = onPointerDragStart(event);
        if (started) {
          if (typeof event?.preventDefault === 'function') event.preventDefault();
          if (typeof event?.stopImmediatePropagation === 'function') event.stopImmediatePropagation();
        }
      }
    };
    const onPointerUpEvt = (event) => {
      if (dragState.active) {
        onPointerDragEnd(event);
        if (typeof event?.preventDefault === 'function') event.preventDefault();
        if (typeof event?.stopImmediatePropagation === 'function') event.stopImmediatePropagation();
      }
    };
    const onPointerMoveEvt = (event) => {
      if (dragState.active) {
        onPointerMove(event);
        if (typeof event?.preventDefault === 'function') event.preventDefault();
        if (typeof event?.stopImmediatePropagation === 'function') event.stopImmediatePropagation();
      }
    };
    const onContextMenu = (event) => {
      if (typeof event?.preventDefault === 'function') event.preventDefault();
    };
    canvas.addEventListener('pointerdown', onPointerDownEvt, true);
    canvas.addEventListener('pointerup', onPointerUpEvt, true);
    canvas.addEventListener('pointercancel', onPointerUpEvt, true);
    canvas.addEventListener('pointermove', onPointerMoveEvt, true);
    const contextTargets = [canvas, canvas?.parentElement].filter(Boolean);
    for (const target of contextTargets) {
      target.addEventListener('contextmenu', onContextMenu, true);
    }
    canvas.addEventListener('click', onClick);
    canvas.addEventListener('dblclick', onDoubleClick);
    cleanup.push(() => {
      canvas.removeEventListener('pointerdown', onPointerDownEvt, true);
      canvas.removeEventListener('pointerup', onPointerUpEvt, true);
      canvas.removeEventListener('pointercancel', onPointerUpEvt, true);
      canvas.removeEventListener('pointermove', onPointerMoveEvt, true);
      for (const target of contextTargets) {
        target.removeEventListener('contextmenu', onContextMenu, true);
      }
      canvas.removeEventListener('click', onClick);
      canvas.removeEventListener('dblclick', onDoubleClick);
    });
  }

  function dispose() {
    while (cleanup.length) {
      const fn = cleanup.pop();
      try { fn(); } catch (err) { strictCatch(err, 'main:picking_cleanup'); }
    }
  }

  return {
    install,
    setup: install,
    dispose,
    updateSelection,
    clearSelection,
    hasSelection,
    applySelectionFromPick,
    selectionFromPick,
    selectionSeq,
    PERTURB_LABEL,
  };
}


export {
  createCameraController,
  createPickingController,
  createRendererManager,
};
