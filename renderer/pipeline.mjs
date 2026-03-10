// Extracted from main.nobuild.mjs (renderer + camera/picking controllers).
// Keep behaviour identical; do not swallow errors.

import * as THREE from 'three';
import {
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
} from '../core/viewer_runtime.mjs';
import { getRuntimeConfig } from '../core/runtime_config.mjs';
import { getSnapshotAlign, getSnapshotBvhDepth, getSnapshotCameraMode, getSnapshotCameras, getSnapshotCopyState, getSnapshotFlexLayer, getSnapshotGeomBodyIds, getSnapshotGeoms, getSnapshotGroups, getSnapshotLabelMode, getSnapshotOptions, getSnapshotRenderAssets, getSnapshotSceneFlags, getSnapshotSelection, getSnapshotStatistic, getSnapshotStructValue, getSnapshotVisual, getSnapshotVoptFlags } from '../core/snapshot_selectors.mjs';
import { pushSkyDebug } from '../environment/environment.mjs';
import {
  depthFromSoAPos,
  transparentBinFromDepthNorm,
  transparentDepthNorm01,
} from './depth_sort.mjs';
import {
  disposeMeshObject,
  disposeObject3DTree,
  getWorldScene,
  renderWorldScene,
} from './three_helpers.mjs';
import { disposeOverlay3D, ensureOverlay3D } from './overlay3d.mjs';
import { installMuJoCoShadowViewportInset } from './mujoco_shadows.mjs';
import { MJ_GEOM, MJ_LIGHT_TYPE, MJ_MAXLIGHT, MJ_MAXPLANEGRID, MJ_MINVAL, MJ_OBJ, MJ_TEXTURE, MJ_VIS } from './mujoco_constants.mjs';
import { applyMuJoCoTextureToMesh, quantize1e6, quantize1e3, resolveMaterialTextureDescriptor } from './mujoco_textures.mjs';
import { ensureFlexGroup, hideFlexGroup, ensureFlexEntry, applyFlexAppearance, updateFlexFaces, ensureSkinGroup, hideSkinGroup, ensureSkinEntry, applySkinAppearance, updateSkinMesh } from './deformables.mjs';
import { geomNameFromLookup, getOrCreateGeomNameLookup } from './geom_names.mjs';
import {
  GROUND_DISTANCE,
  RENDER_ORDER,
  TRANSPARENT_BIN_CAM_POS,
  TRANSPARENT_BIN_CAM_DIR,
  SEGMENT_FLAG_INDEX,
  isInfinitePlaneSize,
  isDynamicSizeScaleGeomType,
  applyDynamicSizeScale,
  disposeInstancing,
  syncRendererAssets,
  ensureInstancingRoot,
  ensureInstancedGeometry,
  instancingEnabledFromState,
  transparentBinsFromState,
  transparentSortModeFromState,
  ensureInstancedMaterial,
  ensureInstancedBatch,
  sortInstancedBatchByOrderRank,
  resolveGeomWorldMatrix,
  resolveGeomWorldPose,
  segmentColorForIndex,
  restoreSegmentMaterial,
  ensureSegmentMaterial,
  applyMaterialFlags,
  resolveMaterialReflectance,
  resolveMaterialMetallic,
  resolveMaterialRoughness,
  resolveMaterialEmission,
  applyReflectanceToMaterial,
  ensureGeomMesh,
  ensureGeomState,
  setGeomViewProps,
} from './scene_soa_geoms.mjs';



const FIXED_CAMERA_OFFSET = 2;
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

const LABEL_DPR_CAP = 2;
const LABEL_GEOM_LIMIT = 120;
const DEFAULT_CLEAR_HEX = 0xd6dce4;
const DEFAULT_CLEAR_COLOR = new THREE.Color(DEFAULT_CLEAR_HEX);


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

export function resolveTrackingBodyId(snapshot, state) {
  const selectionBody = Number(getSnapshotSelection(snapshot)?.bodyId);
  if (Number.isFinite(selectionBody) && selectionBody >= 0) return selectionBody | 0;
  const geomIndex = Number(state?.runtime?.trackingGeom);
  const geomBodyIds = getSnapshotGeomBodyIds(snapshot);
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

export function buildViewerCameraPayload(ctx, snapshot, state, scratchVec = null) {
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
    payload.trackbodyid = resolveTrackingBodyId(snapshot, state);
  } else if (mode === 0) {
    payload.type = 0;
    payload.trackbodyid = -1;
  }
  return payload;
}

function sendViewerCameraSync(backend, ctx, snapshot, state, scratchVec = null) {
  if (!ctx || !backend || typeof backend.apply !== 'function') return;
  const payload = buildViewerCameraPayload(ctx, snapshot, state, scratchVec);
  if (!payload) return;
  const prevSeqSource = Number(ctx.viewerCameraSyncSeqSent);
  const prevSeq = Number.isFinite(prevSeqSource) ? Math.max(0, Math.trunc(prevSeqSource)) : 0;
  const camSyncSeq = prevSeq + 1;
  ctx.viewerCameraSyncSeqSent = camSyncSeq;
  ctx.viewerCameraSynced = false;
  ctx.viewerCameraTrackId = Number.isFinite(payload.trackbodyid) ? (payload.trackbodyid | 0) : null;
  backend.apply({
    kind: 'gesture',
    gestureType: 'camera',
    phase: 'sync',
    cam: payload,
    camSyncSeq,
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

  function syncCameraPoseFromMode(backend, ctx, snapshot, state, bounds, helpers, trackingCtx = {}) {
    if (!ctx?.camera || !state) return;
    const runtimeMode = Number(state.runtime?.cameraIndex ?? 0) | 0;
  const cameraList = getSnapshotCameras(snapshot);
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
        sendViewerCameraSync(backend, ctx, snapshot, state, helpers.tempVecA);
      }
    }
  if (desired >= FIXED_CAMERA_OFFSET) {
    if (!applyFixedCameraPreset(ctx, state, helpers)) {
      ctx.fixedCameraActive = false;
    }
    return;
  }
  if (desired === 1) {
    const trackingBodyId = resolveTrackingBodyId(snapshot, state);
    if (Number.isFinite(trackingBodyId) && trackingBodyId !== ctx.viewerCameraTrackId) {
      ctx.viewerCameraSynced = false;
      sendViewerCameraSync(backend, ctx, snapshot, state, helpers.tempVecA);
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
  const headlight = getSnapshotVisual(snapshot)?.headlight || null;
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
    const statExtent = Number(getSnapshotStatistic(snapshot)?.extent);
    const extentFallback = Number.isFinite(statExtent) && statExtent > 1e-6
      ? statExtent
      : Math.max(0.1, Number(bounds?.radius) || 1);
    const shadowclipFactor = Number(getSnapshotVisual(snapshot)?.map?.shadowclip);
    const shadowClip = extentFallback * (Number.isFinite(shadowclipFactor) && shadowclipFactor > 1e-6 ? shadowclipFactor : 1);
    const znearFactor = Number(getSnapshotVisual(snapshot)?.map?.znear);
    const zfarFactor = Number(getSnapshotVisual(snapshot)?.map?.zfar);
    const frustumNear = Math.max(0.01, (Number.isFinite(znearFactor) && znearFactor > 1e-6 ? znearFactor : 0.01) * extentFallback);
    const frustumFar = Math.max(frustumNear + 0.1, (Number.isFinite(zfarFactor) && zfarFactor > 0 ? zfarFactor : 50) * extentFallback);
    const shadowscale = Number(getSnapshotVisual(snapshot)?.map?.shadowscale);
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
        const modelShadowSize = Number(getSnapshotVisual(snapshot)?.quality?.shadowsize);
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
  const list = getSnapshotCameras(snapshot);
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
  const fovy = Number(getSnapshotVisual(snapshot)?.global?.fovy);
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

function scaleAllFactor(snapshot) {
  const value = Number(getSnapshotVisual(snapshot)?.scale?.all);
  if (Number.isFinite(value) && value > 1e-6) return value;
  return 1;
}

function voptEnabled(flags, idx) {
  return Array.isArray(flags) && idx >= 0 && !!flags[idx];
}

export function normalizeDeltaByViewportHeight(canvas, dx, dy, invertY = false) {
  const elementHeight = canvas?.clientHeight || (typeof window !== 'undefined' ? window.innerHeight : 1) || 1;
  const heightDen = Math.max(1, elementHeight);
  const dyEff = invertY ? -dy : dy;
  return { reldx: dx / heightDen, reldy: dyEff / heightDen };
}

function meanSizeFromState(snapshot, context = null) {
  const statSize = Number(getSnapshotStatistic(snapshot)?.meansize);
  if (Number.isFinite(statSize) && statSize > 0) return statSize;
  const radius = Number(context?.bounds?.radius);
  if (Number.isFinite(radius) && radius > 0) return radius;
  return 1;
}

  function computeMeanScale(snapshot, context = null) {
    const meanSize = meanSizeFromState(snapshot, context);
    const scaleAll = scaleAllFactor(snapshot);
    return { meanSize, scaleAll };
  }

function computeScenePolicy(snapshot, state, context) {
  const sceneFlags = getSnapshotSceneFlags(snapshot);
  const voptFlags = getSnapshotVoptFlags(snapshot) || getDefaultVopt(context, snapshot) || [];
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


function updateInfinitePlaneFromSceneSoA(ctx, mesh, scnIndex, snapshot, assets, sceneFlags = null) {
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
    const mapZfar = Number(getSnapshotVisual(snapshot)?.map?.zfar);
    const extent = Number(getSnapshotStatistic(snapshot)?.extent);
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
}

function getDefaultVopt(ctx, snapshot) {
  const flags = getSnapshotVoptFlags(snapshot);
  if (!flags) return null;
  if (!ctx.defaultVopt) {
    ctx.defaultVopt = flags.slice();
  }
  return ctx.defaultVopt;
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

  const flags = Array.isArray(sceneFlags) ? sceneFlags : [];
  const segmentEnabled = typeof segmentEnabledOverride === 'boolean'
    ? segmentEnabledOverride
    : !!flags[SEGMENT_FLAG_INDEX];
  const vopt = Array.isArray(voptFlags) ? voptFlags : [];
  const showStatic = voptEnabled(vopt, MJ_VIS.STATIC);
  const transparentDynamic = voptEnabled(vopt, MJ_VIS.TRANSPARENT);
  const alphaScale = transparentDynamic ? clampUnit(Number(getSnapshotVisual(snapshot)?.map?.alpha)) : 1;
  const textureEnabled = voptEnabled(vopt, MJ_VIS.TEXTURE);
  const showFlexVert = voptEnabled(vopt, MJ_VIS.FLEXVERT);
  const showFlexEdge = voptEnabled(vopt, MJ_VIS.FLEXEDGE);
  const showFlexFace = voptEnabled(vopt, MJ_VIS.FLEXFACE);
  const showFlexSkin = voptEnabled(vopt, MJ_VIS.FLEXSKIN);
  const showFlexAny = showFlexVert || showFlexEdge || showFlexFace || showFlexSkin;
  const showSkin = voptEnabled(vopt, MJ_VIS.SKIN);
  const flexLayerValue = getSnapshotFlexLayer(snapshot);
  const baseNgeom = snapshot?.ngeom | 0;
  const geomNameLookup = getOrCreateGeomNameLookup(ctx, getSnapshotGeoms(snapshot) || null);
  const geomBodyIdView = getSnapshotGeomBodyIds(snapshot) || null;
  const weldIdView =
    assets?.bodies?.weldid || null;
  const mocapIdView =
    assets?.bodies?.mocapid || null;
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
          const entry = ensureFlexEntry(ctx, flexIndex, assets, flags);
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
            updateFlexFaces(entry, flexIndex, snapshot, assets, true, flexLayerValue);
          } else if (showFlexFace) {
            updateFlexFaces(entry, flexIndex, snapshot, assets, false, flexLayerValue);
          } else {
            entry.faces.visible = false;
          }
          flexUsed += 1;
        } else if (objType === MJ_OBJ.SKIN && seenSkin) {
          const skinIndex = objIdView[si] | 0;
          if (skinIndex < 0 || skinIndex >= skinCount) continue;
          if (seenSkin.has(skinIndex)) continue;
          seenSkin.add(skinIndex);
          const entry = ensureSkinEntry(ctx, skinIndex, assets, flags);
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

    const mesh = ensureGeomMesh(ctx, meshIndex, gtypeRaw, assets, dataId, sizeVec, { geomMeta, dynamicSizeScale: true }, state, flags);
    if (perfEnabled) meshMs += perfNow() - tEnsureStart;
    if (!mesh) return false;
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
      updateInfinitePlaneFromSceneSoA(ctx, mesh, si, snapshot, assets, flags);
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
      // Infinite ground uses shader-driven alpha (haze, underside fade, edge cutoffs).
      // Keep it in the transparent render pass regardless of the MuJoCo RGBA alpha.
      const nextTransparent = isInfinitePlane ? true : (a < 0.999);
      if (mat && ('opacity' in mat)) {
        const changedOpacity = mat.opacity !== a;
        const changedTransparent = mat.transparent !== nextTransparent;
        if (changedOpacity) mat.opacity = a;
        if (changedTransparent) mat.transparent = nextTransparent;
        if (perfEnabled && (changedOpacity || changedTransparent)) opacityUpdates += 1;
      }
      if (mat && typeof mat.depthWrite === 'boolean' && !isInfinitePlane) {
        const nextDepthWrite = !nextTransparent;
        if (mat.depthWrite !== nextDepthWrite) mat.depthWrite = nextDepthWrite;
      }
      const userData = mesh.userData || (mesh.userData = {});
      let transparentBinKey = -1;
      const ignoreTransparentOrdering = !!userData.infinitePlane || !!userData.infiniteGrid;
      if (ignoreTransparentOrdering) {
        userData.transparentBin = -1;
        if (userData.infinitePlane) {
          // Infinite ground ordering is handled by tuneInfiniteGroundForCamera().
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
      applyMaterialFlags(mesh, meshIndex, flags);
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

  // TODO(delete): Remove extra-geom creation throttling. This was originally added
  // to avoid one-frame main-thread stalls when creating lots of scene geoms
  // (sites/tendons/etc). Modern runtimes should generally handle this better, and
  // many plugin overlays prefer immediate construction.
  //
  // For now, keep the throttling logic in place but set budgets extremely high so
  // it behaves like "create immediately" until the code is deleted.
  const createBudget = Number.POSITIVE_INFINITY;
  let createdThisFrame = 0;
  const tCreateStart = perfNow();
  const createTimeBudgetMs = Number.POSITIVE_INFINITY;
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

function tuneInfiniteGroundForCamera(ctx) {
  const ground = ctx?.ground || null;
  if (!ground?.userData?.infinitePlane) return;
  const mat = ground.material || null;
  if (!mat) return;

  const camera = ctx?.camera || null;
  const camPos = camera?.position || null;
  const uniforms =
    ground.userData?.infiniteGround?.uniforms ||
    mat?.userData?.infiniteUniforms ||
    null;
  const origin = uniforms?.uPlaneOrigin?.value || null;
  const normal = uniforms?.uPlaneNormal?.value || null;
  if (!camPos || !origin || !normal) return;

  const vx = (camPos.x - origin.x);
  const vy = (camPos.y - origin.y);
  const vz = (camPos.z - origin.z);
  const side = vx * normal.x + vy * normal.y + vz * normal.z;
  const camBelow = side < -0.01;

  if (typeof mat.depthWrite === 'boolean') {
    const desiredDepthWrite = !camBelow;
    if (mat.depthWrite !== desiredDepthWrite) mat.depthWrite = desiredDepthWrite;
  }
  const baseGroundOrder = RENDER_ORDER.GROUND | 0;
  const desiredOrder = camBelow ? (-baseGroundOrder) : baseGroundOrder;
  if (typeof ground.renderOrder === 'number' && ground.renderOrder !== desiredOrder) {
    ground.renderOrder = desiredOrder;
  }
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
  ctx.assetCache = ctx.assetCache || { meshGeometries: new Map(), hfieldGeometries: new Map(), mjTextures: new Map() };
  ctx._frameCounter = ctx._frameCounter || 0;
  ctx.boundsEvery = typeof ctx.boundsEvery === 'number' && ctx.boundsEvery > 0 ? ctx.boundsEvery : 2;
  ctx.currentCameraMode = typeof ctx.currentCameraMode === 'number' ? ctx.currentCameraMode : 0;
  ctx.fixedCameraActive = !!ctx.fixedCameraActive;
  ctx.viewerCameraSynced = !!ctx.viewerCameraSynced;
  ctx.viewerCameraSyncSeqSent = Number.isFinite(ctx.viewerCameraSyncSeqSent)
    ? Math.max(0, Math.trunc(ctx.viewerCameraSyncSeqSent))
    : 0;
  ctx.viewerCameraSyncSeqAck = Number.isFinite(ctx.viewerCameraSyncSeqAck)
    ? Math.max(0, Math.trunc(ctx.viewerCameraSyncSeqAck))
    : 0;
  ctx.viewerCameraTrackId = Number.isFinite(ctx.viewerCameraTrackId) ? (ctx.viewerCameraTrackId | 0) : null;

  const cleanup = [];
  const tempVecA = new THREE.Vector3();
  const tempVecB = new THREE.Vector3();
  const tempVecC = new THREE.Vector3();
  const tempVecD = new THREE.Vector3();

  const frameSubscribers = new Set();
  let pendingSceneSnapshot = null;
  let pendingSceneState = null;
  let pendingSceneDirty = false;
  let lastFrameSnapshot = null;
  let lastFrameState = null;

  function requestRenderScene(snapshot, state) {
    pendingSceneSnapshot = snapshot || null;
    pendingSceneState = state || null;
    pendingSceneDirty = true;
  }

  function onFrame(fn) {
    if (typeof fn !== 'function') return () => {};
    frameSubscribers.add(fn);
    return () => frameSubscribers.delete(fn);
  }

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
      const frame = ctx._frameCounter || 0;

      if (pendingSceneDirty) {
        pendingSceneDirty = false;
        const snapshot = pendingSceneSnapshot;
        const state = pendingSceneState;
        if (snapshot && state) {
          renderScene(snapshot, state);
          lastFrameSnapshot = snapshot;
          lastFrameState = state;
        }
      }

      if (frameSubscribers.size && lastFrameSnapshot && lastFrameState) {
        const snapshot = lastFrameSnapshot;
        const state = lastFrameState;
        const nowMs = perfNow();
        for (const fn of frameSubscribers) {
          try {
            fn({ snapshot, state, nowMs, frame });
          } catch (err) {
            logWarn('[clock] frame subscriber error', err);
            strictCatch(err, 'main:clock_frame_subscriber');
          }
        }
      }

      const overlay3d = ctx._overlay3d || ctx.overlay3d || null;
      if (overlay3d && typeof overlay3d.flushCommits === 'function') {
        overlay3d.flushCommits({ camera: ctx.camera, frame });
      }
      if (overlay3d && typeof overlay3d.onFrame === 'function') {
        overlay3d.onFrame({ camera: ctx.camera, frame });
      }
      // Background/environment is managed by environment manager (ensureEnvIfNeeded)
      tuneInfiniteGroundForCamera(ctx);
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

    const wantPreserve = !!getRuntimeConfig().snapshotDebug;
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
    hemi.position.set(0, 0, 1);
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
        alignTimestamp: 0,
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

    const assets = getSnapshotRenderAssets(snapshot);
    const tAssetsStart = perfEnabled ? perfNow() : 0;
    syncRendererAssets(context, assets);
    if (perfEnabled) {
      perfSample('renderer:sync_assets_ms', perfNow() - tAssetsStart);
    }
    const geomGroupIds = assets?.geoms?.group || null;
    const groupState = getSnapshotGroups(snapshot);
    const geomGroupMask = Array.isArray(groupState?.geom) ? groupState.geom : null;
    const flexGroupIds = assets?.flexes?.group || null;
    const flexGroupMask = Array.isArray(groupState?.flex) ? groupState.flex : null;
    const skinGroupIds = assets?.skins?.group || null;
    const skinGroupMask = Array.isArray(groupState?.skin) ? groupState.skin : null;

    if (typeof ensureEnvIfNeeded === 'function') {
      ensureEnvIfNeeded(context, state, { skyboxEnabled, snapshot });
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
    const visStruct = getSnapshotVisual(snapshot);
    const statStruct = getSnapshotStatistic(snapshot);
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
      snapshot,
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
      }
    }

    const bounds = nextBounds;
    if (bounds) {
      context.bounds = bounds;
      if (context.currentCameraMode === 0) {
        cacheTrackingPoseFromCurrent(context, bounds);
      }
    }

    const alignState = getSnapshotAlign(snapshot);
    const alignMode = context.currentCameraMode | 0;
    const alignTimestamp = alignState ? (Number(alignState.timestamp) || 0) : 0;
    if (alignMode <= 1 && alignState && (alignState.seq > context.alignSeq || alignTimestamp > context.alignTimestamp)) {
      context.alignSeq = alignState.seq;
      context.alignTimestamp = alignTimestamp;
      const center = alignState.center || [0, 0, 0];
      const alignRadiusRaw = Number(alignState.radius) || 0;
      const boundsRadiusRaw = Number(context.bounds?.radius) || 0;
      const radius = Math.max(alignRadiusRaw > 0 ? alignRadiusRaw : boundsRadiusRaw, 0.6);

      const cam = alignState.camera;
      const lookatSource = cam && Array.isArray(cam.lookat) ? cam.lookat : null;
      const dist = cam ? Number(cam.distance) : NaN;
      const az = cam ? Number(cam.azimuth) : NaN;
      const el = cam ? Number(cam.elevation) : NaN;

      const useMjvCam =
        lookatSource &&
        lookatSource.length >= 3 &&
        Number.isFinite(dist) &&
        dist > 0 &&
        Number.isFinite(az) &&
        Number.isFinite(el);

      if (useMjvCam) {
        // Simulate 1:1: apply MuJoCo mjvCamera parameters (azimuth/elevation/distance/lookat).
        const azRad = az * CAMERA_RAD_PER_DEG;
        const elRad = el * CAMERA_RAD_PER_DEG;
        const ca = Math.cos(azRad);
        const sa = Math.sin(azRad);
        const ce = Math.cos(elRad);
        const se = Math.sin(elRad);
        const target = tempVecA.set(
          Number(lookatSource[0]) || 0,
          Number(lookatSource[1]) || 0,
          Number(lookatSource[2]) || 0,
        );
        const forward = tempVecB.set(ce * ca, ce * sa, se);
        context.camera.position.copy(forward).multiplyScalar(-dist).add(target);
        context.camera.up.set(-se * ca, -se * sa, ce);
        context.camera.lookAt(target);
        context.cameraTarget.copy(target);
      } else {
        const target = tempVecA.set(center[0], center[1], center[2]);
        const alignOffset = tempVecB.set(radius * 0.8, -radius * 0.8, radius * 0.6);
        context.camera.position.copy(target).add(alignOffset);
        context.camera.up.set(0, 0, 1);
        context.camera.lookAt(target);
        context.cameraTarget.copy(target);
      }

      context.autoAligned = true;
      cacheTrackingPoseFromCurrent(context, { radius, center });
      sendViewerCameraSync(backend, context, snapshot, state, tempVecA);
    }

    const copyState = getSnapshotCopyState(snapshot);
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

  function getOverlay3D() {
    const context = initRenderer();
    if (!context?.initialized) return null;
    return ensureOverlay3D(context);
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

    disposeOverlay3D(ctx);

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
    if (ctx.assetCache && ctx.assetCache.hfieldGeometries instanceof Map) {
      for (const geometry of ctx.assetCache.hfieldGeometries.values()) {
        if (geometry && typeof geometry.dispose === 'function') {
          try { geometry.dispose(); } catch (err) { strictCatch(err, 'main:assetCache_dispose'); }
        }
      }
      ctx.assetCache.hfieldGeometries.clear();
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
      if (skyCache.presetMap instanceof Map) {
        for (const entry of skyCache.presetMap.values()) {
          if (!entry) continue;
          disposeResource(entry.envRT);
          disposeResource(entry.background);
        }
        skyCache.presetMap.clear();
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
    ctx.assetCache = { meshGeometries: new Map(), hfieldGeometries: new Map(), mjTextures: new Map() };

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
    requestRenderScene,
    renderScene,
    ensureRenderLoop,
    updateViewport: () => updateRendererViewport(),
    onFrame,
    getContext,
    getOverlay3D,
    dispose,
  };
}


export {
  createRendererManager,
};
