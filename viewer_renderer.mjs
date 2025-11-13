import * as THREE from 'three';

const MJ_GEOM = {
  PLANE: 0,
  HFIELD: 1,
  SPHERE: 2,
  CAPSULE: 3,
  ELLIPSOID: 4,
  CYLINDER: 5,
  BOX: 6,
  MESH: 7,
};
const FIXED_CAMERA_OFFSET = 2;
const LABEL_MODES = {
  NONE: 0,
  BODY: 1,
  JOINT: 2,
  GEOM: 3,
  SITE: 4,
  CAMERA: 5,
  LIGHT: 6,
  TENDON: 7,
  ACTUATOR: 8,
  CONSTRAINT: 9,
  FLEX: 10,
  SKIN: 11,
  SELECTION: 12,
  SEL_POINT: 13,
  CONTACT: 14,
  FORCE: 15,
  ISLAND: 16,
};
const FRAME_MODES = {
  NONE: 0,
  BODY: 1,
  GEOM: 2,
  SITE: 3,
  CAMERA: 4,
  LIGHT: 5,
  CONTACT: 6,
  WORLD: 7,
};
const LABEL_TEXTURE_CACHE = new Map();
const LABEL_TEXTURE_VERSION = 3;
const LABEL_DEFAULT_HEIGHT = 0.08;
const LABEL_DEFAULT_OFFSET = 0.04;
const LABEL_LOD_NEAR = 2.0;
const LABEL_LOD_MID = 4.5;
const LABEL_LOD_FACTORS = { near: 2, mid: 1.4, far: 1 };
const __TMP_VEC3 = new THREE.Vector3();
const CONTACT_UP = new THREE.Vector3(0, 0, 1);
const CONTACT_TMP_NORMAL = new THREE.Vector3();
const CONTACT_FORCE_DIR = new THREE.Vector3();
const CONTACT_FORCE_NORMAL = new THREE.Vector3();
const CONTACT_FORCE_AXIS = new THREE.Vector3(0, 1, 0);
const CONTACT_FORCE_TMP_QUAT = new THREE.Quaternion();
const CONTACT_FORCE_FALLBACK_COLOR = 0x4d7cfe;
const CONTACT_POINT_FALLBACK_COLOR = 0xff8a2b;
const CONTACT_FORCE_EPS = 1e-9;
const CONTACT_FORCE_SHAFT_GEOMETRY = new THREE.CylinderGeometry(1, 1, 1, 20, 1, false);
const CONTACT_FORCE_HEAD_GEOMETRY = new THREE.ConeGeometry(1, 1, 24, 1, false);
const PERTURB_SHAFT_GEOMETRY = CONTACT_FORCE_SHAFT_GEOMETRY;
const PERTURB_HEAD_GEOMETRY = CONTACT_FORCE_HEAD_GEOMETRY;
const PERTURB_COLOR_TRANSLATE = 0x2b90d9;
const PERTURB_COLOR_ROTATE = 0xff8a2b;
const PERTURB_AXIS_DEFAULT = new THREE.Vector3(0, 1, 0);
const PERTURB_RING_NORMAL = new THREE.Vector3(0, 0, 1);
const PERTURB_RADIAL_DEFAULT = new THREE.Vector3(1, 0, 0);
const PERTURB_TEMP_ANCHOR = new THREE.Vector3();
const PERTURB_TEMP_CURSOR = new THREE.Vector3();
const PERTURB_TEMP_DIR = new THREE.Vector3();
const PERTURB_TEMP_FORCE = new THREE.Vector3();
const PERTURB_TEMP_AXIS = new THREE.Vector3();
const PERTURB_TEMP_RADIAL = new THREE.Vector3();
const PERTURB_TEMP_TANGENT = new THREE.Vector3();
const PERTURB_TEMP_QUAT = new THREE.Quaternion();
const SELECTION_OVERLAY_COLOR = new THREE.Color(0x91ffcb);
const LABEL_MODE_WARNINGS = new Set();
const FRAME_MODE_WARNINGS = new Set();
const LABEL_DPR_CAP = 2;
const LABEL_GEOM_LIMIT = 120;
const FRAME_GEOM_LIMIT = 80;
const TEMP_MAT4 = new THREE.Matrix4();

function mat3ToQuat(m) {
  const m00 = m[0] ?? 1;
  const m01 = m[1] ?? 0;
  const m02 = m[2] ?? 0;
  const m10 = m[3] ?? 0;
  const m11 = m[4] ?? 1;
  const m12 = m[5] ?? 0;
  const m20 = m[6] ?? 0;
  const m21 = m[7] ?? 0;
  const m22 = m[8] ?? 1;
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
  return new THREE.Quaternion(x, y, z, w);
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

function rgbFromArray(arr, fallback = [1, 1, 1]) {
  if (Array.isArray(arr) && arr.length >= 3) {
    return [
      clampUnit(Number(arr[0])),
      clampUnit(Number(arr[1])),
      clampUnit(Number(arr[2])),
    ];
  }
  return fallback.slice();
}

function rgbaToHex(color, fallback = 0xffffff) {
  if (!Array.isArray(color) || color.length < 3) return fallback;
  const [r, g, b] = rgbFromArray(color);
  const toByte = (value) => Math.max(0, Math.min(255, Math.round(value * 255)));
  return (toByte(r) << 16) | (toByte(g) << 8) | toByte(b);
}

function alphaFromArray(color, fallback = 1) {
  if (Array.isArray(color) && color.length >= 4) {
    const a = Number(color[3]);
    if (Number.isFinite(a)) {
      return clampUnit(a);
    }
  }
  return clampUnit(fallback);
}

function averageRGB(arr) {
  if (!Array.isArray(arr) || arr.length === 0) return 0;
  return arr.reduce((acc, v) => acc + (Number(v) || 0), 0) / arr.length;
}

function ensureCameraTarget(ctx) {
  if (!ctx) return null;
  if (!ctx.cameraTarget) {
    ctx.cameraTarget = new THREE.Vector3(0, 0, 0);
  }
  return ctx.cameraTarget;
}

function ensureFreeCameraPose(ctx) {
  if (!ctx) return null;
  if (!ctx.freeCameraPose) {
    ctx.freeCameraPose = {
      position: new THREE.Vector3(),
      target: new THREE.Vector3(),
      up: new THREE.Vector3(0, 0, 1),
      fov: 45,
      valid: false,
      autoAligned: false,
    };
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
  pose.fov = Number.isFinite(ctx.camera.fov) ? ctx.camera.fov : pose.fov;
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
  if (Number.isFinite(pose.fov) && ctx.camera.fov !== pose.fov) {
    ctx.camera.fov = pose.fov;
    if (typeof ctx.camera.updateProjectionMatrix === 'function') {
      ctx.camera.updateProjectionMatrix();
    }
  }
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
    ctx.trackingOffset = new THREE.Vector3(radius * 2.6, -radius * 2.6, radius * 1.7);
    ctx.trackingRadius = ctx.trackingOffset.length();
  }
  ctx.camera.position.copy(center.clone().add(ctx.trackingOffset));
  ctx.trackingRadius = ctx.trackingOffset.length();
  ctx.camera.lookAt(center);
  target.copy(center);
  ctx.trackingRadius = ctx.trackingOffset.length();
  ctx.fixedCameraActive = false;
  const desiredFar = Math.max(100, Math.max(radius, ctx.trackingRadius || radius) * 10);
  if (ctx.camera.far < desiredFar) {
    ctx.camera.far = desiredFar;
    if (typeof ctx.camera.updateProjectionMatrix === 'function') {
      ctx.camera.updateProjectionMatrix();
    }
  }
  return true;
}

function syncCameraPoseFromMode(ctx, state, bounds, helpers, trackingCtx = {}) {
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
    if (desired === 0 && previous !== 0) {
      restoreFreeCameraPose(ctx);
    }
    ctx.currentCameraMode = desired;
  }
  if (desired >= FIXED_CAMERA_OFFSET) {
    if (!applyFixedCameraPreset(ctx, state, helpers)) {
      ctx.fixedCameraActive = false;
    }
    return;
  }
  if (desired === 1) {
    applyTrackingCamera(ctx, trackingCtx.trackingBounds || bounds, helpers, trackingCtx.trackingOverride || null);
    return;
  }
  ctx.fixedCameraActive = false;
}

function applyVisualLighting(ctx, vis) {
  if (!vis || !ctx) return;
  const head = vis.headlight || {};
  const diffuseRGB = rgbFromArray(head.diffuse, [1, 1, 1]);
  const ambientRGB = rgbFromArray(head.ambient, [0.2, 0.2, 0.2]);
  const active = (head.active ?? 1) !== 0;
  const diffuseStrength = Math.max(0.05, averageRGB(diffuseRGB) * 3);
  const ambientStrength = Math.max(0.01, averageRGB(ambientRGB));
  if (ctx.light) {
    ctx.light.intensity = active ? diffuseStrength : 0;
    ctx.light.color.setRGB(diffuseRGB[0], diffuseRGB[1], diffuseRGB[2]);
  }
  if (ctx.fill) {
    ctx.fill.intensity = active ? diffuseStrength * 0.35 : 0;
    ctx.fill.color.setRGB(diffuseRGB[0], diffuseRGB[1], diffuseRGB[2]);
  }
  if (ctx.ambient) {
    ctx.ambient.intensity = ambientStrength;
    ctx.ambient.color.setRGB(ambientRGB[0], ambientRGB[1], ambientRGB[2]);
  }
}

function applyVisualFog(ctx, vis, stat, bounds) {
  if (!ctx?.scene?.fog || !vis?.map) return;
  const map = vis.map;
  const extent = Math.max(
    0.1,
    Number(stat?.extent) || Number(bounds?.radius) || 1
  );
  const fogStart = Number(map.fogstart);
  const fogEnd = Number(map.fogend);
  if (Number.isFinite(fogStart) && Number.isFinite(fogEnd)) {
    const near = Math.max(0.001, extent * fogStart);
    const far = Math.max(near + 0.1, extent * fogEnd);
    ctx.scene.fog.near = near;
    ctx.scene.fog.far = far;
  }
  const fogColor = vis?.rgba?.fog;
  if (fogColor && ctx.scene.fog?.color) {
    const color = rgbFromArray(fogColor, [0.7, 0.75, 0.85]);
    ctx.scene.fog.color.setRGB(color[0], color[1], color[2]);
  }
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

function computeBoundsFromSnapshot(snapshot, { ignoreStatic = false } = {}) {
  const n = snapshot?.ngeom | 0;
  const xpos = snapshot?.xpos;
  if (!xpos || n <= 0) return null;
  const gsize = snapshot?.gsize;
  const gtype = snapshot?.gtype;
  let minx = Number.POSITIVE_INFINITY;
  let miny = Number.POSITIVE_INFINITY;
  let minz = Number.POSITIVE_INFINITY;
  let maxx = Number.NEGATIVE_INFINITY;
  let maxy = Number.NEGATIVE_INFINITY;
  let maxz = Number.NEGATIVE_INFINITY;
  let used = 0;
  for (let i = 0; i < n; i += 1) {
    const base = 3 * i;
    const x = Number(xpos[base + 0]) || 0;
    const y = Number(xpos[base + 1]) || 0;
    const z = Number(xpos[base + 2]) || 0;
    const sx = gsize?.[base + 0] ?? 0.1;
    const sy = gsize?.[base + 1] ?? sx;
    const sz = gsize?.[base + 2] ?? sx;
    const type = gtype?.[i] ?? MJ_GEOM.BOX;
    if (ignoreStatic && (type === MJ_GEOM.PLANE || type === MJ_GEOM.HFIELD)) {
      continue;
    }
    const radius = computeGeomRadius(type, sx, sy, sz);
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
  return {
    center: [cx, cy, cz],
    radius: Number.isFinite(radius) && radius > 0 ? radius : fallback,
  };
}

function overlayScale(radius, factor, min = 0.05, max = 2) {
  const r = Number.isFinite(radius) && radius > 0 ? radius : 1;
  return Math.min(max, Math.max(min, r * factor));
}

function warnOnce(cache, key, message) {
  if (!key || cache.has(key)) return;
  cache.add(key);
  try {
    console.warn(message);
  } catch {}
}

function shouldDisplayGeom(index, options = {}) {
  if (!Number.isFinite(index) || index < 0) return false;
  if (options.hideAllGeometry) return false;
  const mask = options.geomGroupMask;
  const ids = options.geomGroupIds;
  if (mask && ids && index < ids.length) {
    const rawGroup = Number(ids[index]) || 0;
    if (rawGroup >= 0 && rawGroup < mask.length && !mask[rawGroup]) {
      return false;
    }
  }
  return true;
}

function getLabelTexture(text, quality = 1) {
  if (typeof document === 'undefined') return null;
  const label = (text || '').toString();
  const dpr = typeof window !== 'undefined' ? Math.min(window.devicePixelRatio || 1, LABEL_DPR_CAP) : 1;
  const q = Math.max(1, quality);
  const cacheKey = `${LABEL_TEXTURE_VERSION}::${label}::q${q.toFixed(2)}::${dpr.toFixed(2)}`;
  if (LABEL_TEXTURE_CACHE.has(cacheKey)) {
    return LABEL_TEXTURE_CACHE.get(cacheKey);
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
    context.scene.add(context.labelGroup);
    context.labelPool = [];
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

function updateLabelOverlays(context, snapshot, state, options = {}) {
  const mode = Number(state.rendering?.labelMode) | 0;
  if (mode === LABEL_MODES.NONE) {
    hideLabelGroup(context);
    return;
  }
  if (mode !== LABEL_MODES.GEOM) {
    hideLabelGroup(context);
    warnOnce(LABEL_MODE_WARNINGS, mode, '[render] Label mode not yet supported in viewer (pending data)');
    return;
  }
  const ngeom = snapshot.ngeom | 0;
  const xpos = snapshot.xpos;
  if (!(ngeom > 0) || !xpos) {
    hideLabelGroup(context);
    return;
  }
  const geomsMeta = Array.isArray(state.model?.geoms) ? state.model.geoms : [];
  const nameByIndex = new Map();
  for (const geom of geomsMeta) {
    const idx = Number(geom?.index);
    if (Number.isFinite(idx)) {
      nameByIndex.set(idx, (geom?.name || `Geom ${idx}`).trim());
    }
  }
  const labelGroup = ensureLabelGroup(context);
  const pool = context.labelPool;
  const radius = options.bounds?.radius ?? context.bounds?.radius ?? 1;
  const labelHeight = LABEL_DEFAULT_HEIGHT;
  const verticalOffset = LABEL_DEFAULT_OFFSET;
  const typeView = options.typeView;
  let used = 0;
  const limit = Math.min(ngeom, LABEL_GEOM_LIMIT);
  const camera = context.camera;
  for (let i = 0; i < limit; i += 1) {
    if (!shouldDisplayGeom(i, options)) continue;
    const base = 3 * i;
    const px = Number(xpos[base + 0]);
    const py = Number(xpos[base + 1]);
    const pz = Number(xpos[base + 2]);
    if (!Number.isFinite(px) || !Number.isFinite(py) || !Number.isFinite(pz)) continue;
    const geomType = Number(typeView?.[i]);
    if (geomType === MJ_GEOM.PLANE || geomType === MJ_GEOM.HFIELD) continue;
    const label = nameByIndex.get(i) || `Geom ${i}`;
    let quality = LABEL_LOD_FACTORS.far;
    if (camera) {
      const dist = camera.position.distanceTo(__TMP_VEC3.set(px, py, pz));
      if (dist < LABEL_LOD_NEAR) quality = LABEL_LOD_FACTORS.near;
      else if (dist < LABEL_LOD_MID) quality = LABEL_LOD_FACTORS.mid;
    }
    const texture = getLabelTexture(label, quality);
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
    const width = LABEL_DEFAULT_HEIGHT * aspect;
    sprite.scale.set(width, LABEL_DEFAULT_HEIGHT, 1);
    sprite.position.set(px, py, pz + verticalOffset);
    sprite.visible = true;
    used += 1;
  }
  for (let i = used; i < pool.length; i += 1) {
    if (pool[i]) pool[i].visible = false;
  }
  labelGroup.visible = used > 0;
}

function createFrameHelper() {
  const helper = new THREE.AxesHelper(1);
  helper.visible = false;
  helper.renderOrder = 600;
  if (helper.material) {
    helper.material.depthTest = true;
    helper.material.depthWrite = false;
    helper.material.transparent = false;
  }
  return helper;
}

function ensureFrameGroup(context) {
  if (!context.frameGroup) {
    context.frameGroup = new THREE.Group();
    context.frameGroup.name = 'overlay:frames';
    context.scene.add(context.frameGroup);
    context.framePool = [];
  }
  return context.frameGroup;
}

function hideFrameGroup(context) {
  if (Array.isArray(context?.framePool)) {
    for (const helper of context.framePool) {
      if (helper) helper.visible = false;
    }
  }
  if (context?.frameGroup) {
    context.frameGroup.visible = false;
  }
}

function updateFrameOverlays(context, snapshot, state, options = {}) {
  const mode = Number(state.rendering?.frameMode) | 0;
  if (mode === FRAME_MODES.NONE) {
    hideFrameGroup(context);
    return;
  }
  const frameGroup = ensureFrameGroup(context);
  const pool = context.framePool;
  const bounds = options.bounds || context.bounds || null;
  const radius = Number.isFinite(bounds?.radius) ? bounds.radius : 1;
  let used = 0;
  const addHelper = () => {
    let helper = pool[used];
    if (!helper) {
      helper = createFrameHelper();
      pool[used] = helper;
      frameGroup.add(helper);
    }
    helper.visible = true;
    used += 1;
    return helper;
  };
  if (mode === FRAME_MODES.GEOM) {
    const ngeom = snapshot.ngeom | 0;
    const xpos = snapshot.xpos;
    const xmat = snapshot.xmat;
    if (!(ngeom > 0) || !xpos || !xmat) {
      hideFrameGroup(context);
      return;
    }
    const typeView = options.typeView;
    const limit = Math.min(ngeom, FRAME_GEOM_LIMIT);
    for (let i = 0; i < limit; i += 1) {
      if (!shouldDisplayGeom(i, options)) continue;
      const base = 3 * i;
      const px = Number(xpos[base + 0]);
      const py = Number(xpos[base + 1]);
      const pz = Number(xpos[base + 2]);
      if (!Number.isFinite(px) || !Number.isFinite(py) || !Number.isFinite(pz)) continue;
      const geomType = Number(typeView?.[i]);
      if (geomType === MJ_GEOM.PLANE || geomType === MJ_GEOM.HFIELD) continue;
      const helper = addHelper();
      helper.position.set(px, py, pz);
      const matBase = 9 * i;
      const rot = [
        xmat?.[matBase + 0] ?? 1,
        xmat?.[matBase + 1] ?? 0,
        xmat?.[matBase + 2] ?? 0,
        xmat?.[matBase + 3] ?? 0,
        xmat?.[matBase + 4] ?? 1,
        xmat?.[matBase + 5] ?? 0,
        xmat?.[matBase + 6] ?? 0,
        xmat?.[matBase + 7] ?? 0,
        xmat?.[matBase + 8] ?? 1,
      ];
      TEMP_MAT4.set(
        rot[0], rot[1], rot[2], 0,
        rot[3], rot[4], rot[5], 0,
        rot[6], rot[7], rot[8], 0,
        0, 0, 0, 1,
      );
      helper.quaternion.setFromRotationMatrix(TEMP_MAT4);
      const axisScale = overlayScale(radius, 0.12, 0.1, 3) * 0.25;
      helper.scale.set(axisScale, axisScale, axisScale);
    }
  } else if (mode === FRAME_MODES.WORLD) {
    const helper = addHelper();
    helper.position.set(0, 0, 0);
    helper.quaternion.set(0, 0, 0, 1);
    const axisScale = overlayScale(radius, 0.25, 0.5, 5);
    helper.scale.set(axisScale, axisScale, axisScale);
  } else {
    hideFrameGroup(context);
    warnOnce(FRAME_MODE_WARNINGS, mode, '[render] Frame mode not yet supported in viewer (pending data)');
    return;
  }
  for (let i = used; i < pool.length; i += 1) {
    if (pool[i]) pool[i].visible = false;
  }
  frameGroup.visible = used > 0;
}

function createPerturbArrowNode(colorHex, { lit = false } = {}) {
  const material = lit
    ? new THREE.MeshStandardMaterial({
        color: colorHex,
        metalness: 0.55,
        roughness: 0.25,
      })
    : new THREE.MeshBasicMaterial({
        color: colorHex,
        transparent: true,
        opacity: 0.9,
        depthTest: true,
        depthWrite: false,
      });
  const shaft = new THREE.Mesh(PERTURB_SHAFT_GEOMETRY, material);
  const head = new THREE.Mesh(PERTURB_HEAD_GEOMETRY, material);
  const node = new THREE.Group();
  node.add(shaft);
  node.add(head);
  node.visible = false;
  node.renderOrder = 62;
  return { node, shaft, head, material };
}

function ensurePerturbHelpers(ctx) {
  if (!ctx || !ctx.scene) return;
  if (!ctx.perturbGroup) {
    const group = new THREE.Group();
    group.name = 'overlay:perturb';
    ctx.scene.add(group);
    ctx.perturbGroup = group;
  }
  if (!ctx.perturbTranslate) {
    const material = new THREE.MeshBasicMaterial({
      color: PERTURB_COLOR_TRANSLATE,
      transparent: true,
      opacity: 0.95,
      depthTest: true,
      depthWrite: false,
    });
    const shaft = new THREE.Mesh(PERTURB_SHAFT_GEOMETRY, material);
    const head = new THREE.Mesh(PERTURB_HEAD_GEOMETRY, material);
    const node = new THREE.Group();
    node.add(shaft);
    node.add(head);
    node.visible = false;
    node.renderOrder = 60;
    ctx.perturbGroup.add(node);

    const lineGeom = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0, 1, 0),
    ]);
    const lineMaterial = new THREE.LineBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.35,
      depthTest: true,
      depthWrite: false,
    });
    const line = new THREE.Line(lineGeom, lineMaterial);
    line.visible = false;
    line.renderOrder = 59;
    ctx.perturbGroup.add(line);

    ctx.perturbTranslate = { node, shaft, head, material, line };
  }
  if (!ctx.perturbRotate) {
    const ringGeom = new THREE.RingGeometry(0.9, 1, 48, 1);
    const ringMaterial = new THREE.MeshBasicMaterial({
      color: PERTURB_COLOR_ROTATE,
      transparent: true,
      opacity: 0.45,
      side: THREE.DoubleSide,
      depthTest: true,
      depthWrite: false,
    });
    const ring = new THREE.Mesh(ringGeom, ringMaterial);
    ring.visible = false;
    ring.renderOrder = 61;
    ctx.perturbGroup.add(ring);

    const arrowPrimary = createPerturbArrowNode(PERTURB_COLOR_ROTATE, { lit: true });
    const arrowSecondary = createPerturbArrowNode(PERTURB_COLOR_ROTATE, { lit: true });
    ctx.perturbGroup.add(arrowPrimary.node);
    ctx.perturbGroup.add(arrowSecondary.node);

    ctx.perturbRotate = { ring, arrows: [arrowPrimary, arrowSecondary] };
  }
}

function hidePerturbTranslate(ctx) {
  if (ctx?.perturbTranslate?.node) ctx.perturbTranslate.node.visible = false;
  if (ctx?.perturbTranslate?.line) ctx.perturbTranslate.line.visible = false;
}

function hidePerturbRotate(ctx) {
  if (ctx?.perturbRotate?.ring) ctx.perturbRotate.ring.visible = false;
  if (Array.isArray(ctx?.perturbRotate?.arrows)) {
    ctx.perturbRotate.arrows.forEach((arrow) => {
      if (arrow?.node) arrow.node.visible = false;
    });
  }
}

function updatePerturbOverlay(ctx, snapshot, state, options = {}) {
  const viz = state?.runtime?.pertViz;
  if (!viz || !viz.active) {
    hidePerturbTranslate(ctx);
    hidePerturbRotate(ctx);
    if (ctx?.perturbGroup) ctx.perturbGroup.visible = false;
    return;
  }
  ensurePerturbHelpers(ctx);
  if (ctx.perturbGroup) ctx.perturbGroup.visible = true;
  const bounds = options?.bounds || ctx?.bounds || null;
  const sceneRadius = Math.max(0.1, Number(bounds?.radius) || 1);
  const anchor = PERTURB_TEMP_ANCHOR.set(
    Number(viz.anchor?.[0]) || 0,
    Number(viz.anchor?.[1]) || 0,
    Number(viz.anchor?.[2]) || 0,
  );
  const cursor = PERTURB_TEMP_CURSOR.set(
    Number(viz.cursor?.[0]) || 0,
    Number(viz.cursor?.[1]) || 0,
    Number(viz.cursor?.[2]) || 0,
  );
  const mode = String(viz.mode || 'translate');
  if (mode === 'rotate') {
    hidePerturbTranslate(ctx);
    const rotate = ctx.perturbRotate;
    if (!rotate) return;
    const torqueVec = Array.isArray(viz.torque)
      ? PERTURB_TEMP_AXIS.set(
          Number(viz.torque[0]) || 0,
          Number(viz.torque[1]) || 0,
          Number(viz.torque[2]) || 0,
        )
      : null;
    const torqueMag = torqueVec ? torqueVec.length() : 0;
    if (!torqueVec || torqueMag < 1e-8) {
      hidePerturbRotate(ctx);
      return;
    }
    const axis = torqueVec.normalize();
    const radius = Math.max(
      0.02 * sceneRadius,
      Math.min(sceneRadius * 0.25, Math.log(1 + torqueMag / Math.max(1e-6, sceneRadius * 0.3)) * sceneRadius * 0.06),
    );
    const quat = PERTURB_TEMP_QUAT.setFromUnitVectors(PERTURB_RING_NORMAL, axis);
    rotate.ring.visible = true;
    rotate.ring.position.copy(anchor);
    rotate.ring.quaternion.copy(quat);
    rotate.ring.scale.setScalar(radius);

    const radialRaw = PERTURB_TEMP_RADIAL.copy(cursor).sub(anchor);
    const radialPlane = radialRaw.clone().sub(axis.clone().multiplyScalar(radialRaw.dot(axis)));
    if (radialPlane.lengthSq() < 1e-8) {
      radialPlane.copy(PERTURB_RADIAL_DEFAULT).applyQuaternion(quat);
    }
    const radialDir = radialPlane.normalize();
    const primaryRadial = radialDir.clone();
    const oppositeRadial = primaryRadial.clone().multiplyScalar(-1);
    const tangentialBase = PERTURB_TEMP_TANGENT.copy(axis).cross(primaryRadial);
    if (tangentialBase.lengthSq() < 1e-8) {
      tangentialBase.copy(PERTURB_AXIS_DEFAULT).applyQuaternion(quat);
    } else {
      tangentialBase.normalize();
    }
    const arrowLenBase = 2 * Math.max(
      0.05 * radius,
      Math.min(radius * 0.25, Math.log(1 + torqueMag / Math.max(1e-6, sceneRadius * 0.2)) * radius * 0.2),
    );
    const headLen = Math.max(arrowLenBase * 0.35, 0.02 * sceneRadius);
    const shaftLen = Math.max(1e-4, arrowLenBase - headLen);
    const shaftRadius = Math.max(
      0.0008 * sceneRadius,
      Math.min(0.01 * sceneRadius, Math.log(1 + torqueMag / Math.max(1e-6, sceneRadius * 0.3)) * 0.003 * sceneRadius),
    );
    const tangents = [tangentialBase.clone(), tangentialBase.clone().multiplyScalar(-1)];
    const radials = [primaryRadial, oppositeRadial];
    const arrows = rotate.arrows || [];
    radials.forEach((radialVec, idx) => {
      const arrow = arrows[idx];
      if (!arrow) return;
      const tangentDir = tangents[idx];
      const ringPoint = anchor.clone().add(radialVec.clone().multiplyScalar(radius));
      arrow.node.visible = true;
      arrow.material.color.setHex(PERTURB_COLOR_ROTATE);
      arrow.node.position.copy(ringPoint);
      arrow.node.quaternion.copy(PERTURB_TEMP_QUAT.setFromUnitVectors(PERTURB_AXIS_DEFAULT, tangentDir));
      arrow.shaft.scale.set(shaftRadius, shaftLen, shaftRadius);
      arrow.shaft.position.set(0, shaftLen / 2, 0);
      arrow.head.scale.set(shaftRadius * 1.8, headLen, shaftRadius * 1.8);
      arrow.head.position.set(0, shaftLen + headLen / 2, 0);
    });
  } else {
    hidePerturbRotate(ctx);
    const translate = ctx.perturbTranslate;
    if (!translate) return;
    const dir = PERTURB_TEMP_DIR.copy(cursor).sub(anchor);
    const distance = dir.length();
    if (distance < 1e-6) {
      hidePerturbTranslate(ctx);
      return;
    }
    const dirNorm = dir.clone().multiplyScalar(1 / distance);
    const forceVec = Array.isArray(viz.force)
      ? PERTURB_TEMP_FORCE.set(
          Number(viz.force[0]) || 0,
          Number(viz.force[1]) || 0,
          Number(viz.force[2]) || 0,
        )
      : null;
    const forceMag = forceVec ? forceVec.length() : distance;
    const thicknessScale = Math.max(0.15, Math.log(1 + forceMag / Math.max(1e-6, sceneRadius * 0.15)));
    const shaftRadius = Math.max(
      0.0003 * sceneRadius,
      Math.min(0.0045 * sceneRadius, thicknessScale * 0.0012 * sceneRadius),
    );
    let headLength = Math.min(
      Math.max(0.03 * sceneRadius, distance * 0.2),
      Math.max(distance * 0.45, 0.08 * sceneRadius),
    );
    headLength = Math.min(headLength, Math.max(0.12 * distance, distance * 0.6));
    const shaftLength = Math.max(1e-4, distance - headLength);
    translate.node.visible = true;
    translate.material.color.setHex(PERTURB_COLOR_TRANSLATE);
    translate.node.position.copy(anchor);
    translate.node.quaternion.copy(PERTURB_TEMP_QUAT.setFromUnitVectors(PERTURB_AXIS_DEFAULT, dirNorm));
    translate.shaft.scale.set(shaftRadius, shaftLength, shaftRadius);
    translate.shaft.position.set(0, shaftLength / 2, 0);
    translate.head.scale.set(shaftRadius * 1.9, headLength, shaftRadius * 1.9);
    translate.head.position.set(0, shaftLength + headLength / 2, 0);
    if (translate.line?.geometry?.attributes?.position) {
      const attr = translate.line.geometry.attributes.position;
      attr.setXYZ(0, anchor.x, anchor.y, anchor.z);
      attr.setXYZ(1, cursor.x, cursor.y, cursor.z);
      attr.needsUpdate = true;
      translate.line.geometry.computeBoundingSphere?.();
      translate.line.visible = true;
    }
  }
}

function createPrimitiveGeometry(gtype, sizeVec, options = {}) {
  const fallbackEnabled = options.fallbackEnabled !== false;
  const preset = options.preset || 'bright-outdoor';
  let geometry;
  let materialOpts = {
    color: 0x6fa0ff,
    metalness: 0.05,
    roughness: 0.65,
  };
  let postCreate = null;
  switch (gtype) {
    case MJ_GEOM.SPHERE:
    case MJ_GEOM.ELLIPSOID: {
      geometry = new THREE.SphereGeometry(1, 24, 16);
      if (Array.isArray(sizeVec)) {
        const ax = Math.max(1e-6, sizeVec[0] || 0);
        const ay = Math.max(1e-6, (sizeVec[1] ?? sizeVec[0]) || 0);
        const az = Math.max(1e-6, (sizeVec[2] ?? sizeVec[0]) || 0);
        geometry.scale(ax, ay, az);
      }
      break;
    }
    case MJ_GEOM.CAPSULE: {
      const radius = Math.max(1e-6, sizeVec?.[0] || 0.05);
      const halfLength = Math.max(0, sizeVec?.[1] || 0);
      geometry = new THREE.CapsuleGeometry(radius, Math.max(0, 2 * halfLength), 20, 12);
      break;
    }
    case MJ_GEOM.CYLINDER: {
      const radius = Math.max(1e-6, sizeVec?.[0] || 0.05);
      const halfLength = Math.max(0, sizeVec?.[1] || 0.05);
      geometry = new THREE.CylinderGeometry(
        radius,
        radius,
        Math.max(1e-6, 2 * halfLength),
        24,
        1
      );
      break;
    }
    case MJ_GEOM.PLANE:
    case MJ_GEOM.HFIELD: {
      const defaultExtent = 20;
      const fallbackHalf = Math.max(
        1,
        options.planeExtent != null ? options.planeExtent : defaultExtent
      );
      const halfX = Math.abs(sizeVec?.[0] ?? 0);
      const halfY = Math.abs(sizeVec?.[1] ?? 0);
      const width = Math.max(
        1,
        (halfX > 1e-6 ? halfX : fallbackHalf) * 2
      );
      const height = Math.max(
        1,
        (halfY > 1e-6 ? halfY : fallbackHalf) * 2
      );
      geometry = new THREE.PlaneGeometry(
        width,
        height,
        1,
        1
      );
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

          const shadowMaterial = new THREE.ShadowMaterial({
            opacity: 0.38,
            side: THREE.FrontSide,
          });
          shadowMaterial.depthWrite = false;
          shadowMaterial.polygonOffset = true;
          shadowMaterial.polygonOffsetFactor = -1;
          shadowMaterial.polygonOffsetUnits = -1;
          const shadowLayer = new THREE.Mesh(mesh.geometry, shadowMaterial);
          shadowLayer.receiveShadow = true;
          shadowLayer.castShadow = false;
          shadowLayer.renderOrder = (mesh.renderOrder || 0) + 0.02;
          shadowLayer.userData = { ownGeometry: false };
          mesh.add(shadowLayer);
          mesh.userData = mesh.userData || {};
          mesh.userData.groundShadowLayer = shadowLayer;
        } catch {}
      };
      break;
    }
    default: {
      const sx = Math.max(1e-6, sizeVec?.[0] || 0.1);
      const sy = Math.max(1e-6, sizeVec?.[1] || sx);
      const sz = Math.max(1e-6, sizeVec?.[2] || sx);
      geometry = new THREE.BoxGeometry(2 * sx, 2 * sy, 2 * sz);
      break;
    }
  }
  if (geometry?.computeBoundingBox) geometry.computeBoundingBox();
  if (geometry?.computeBoundingSphere) geometry.computeBoundingSphere();
  return { geometry, materialOpts, postCreate };
}
function createMeshGeometryFromAssets(assets, meshId) {
  if (!assets || !assets.meshes || !(meshId >= 0)) return null;
  const {
    vert,
    vertadr,
    vertnum,
    face,
    faceadr,
    facenum,
    normal,
    texcoord,
    texcoordadr,
    texcoordnum,
  } = assets.meshes;
  if (!vert || !vertadr || !vertnum) return null;
  const count = vertnum[meshId] | 0;
  if (!(count > 0)) return null;
  const start = (vertadr[meshId] | 0) * 3;
  const end = start + count * 3;
  if (start < 0 || end > vert.length) return null;
  const positions = vert.slice(start, end);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

  if (normal && normal.length >= end) {
    const normalSlice = normal.slice(start, end);
    geometry.setAttribute('normal', new THREE.BufferAttribute(normalSlice, 3));
  }

  if (face && faceadr && facenum) {
    const triCount = facenum[meshId] | 0;
    if (triCount > 0) {
      const faceStart = (faceadr[meshId] | 0) * 3;
      const faceEnd = faceStart + triCount * 3;
      if (faceStart >= 0 && faceEnd <= face.length) {
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
    }
  }

  if (texcoord && texcoordadr && texcoordnum) {
    const tcCount = texcoordnum[meshId] | 0;
    if (tcCount > 0) {
      const tcStart = (texcoordadr[meshId] | 0) * 2;
      const tcEnd = tcStart + tcCount * 2;
      if (tcStart >= 0 && tcEnd <= texcoord.length) {
        const uvSlice = texcoord.slice(tcStart, tcEnd);
        geometry.setAttribute('uv', new THREE.BufferAttribute(uvSlice, 2));
      }
    }
  }

  if (!geometry.getAttribute('normal')) {
    geometry.computeVertexNormals();
  }
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

function disposeMeshObject(mesh) {
  try {
    if (mesh.userData && mesh.userData.fallbackBackface) {
      const back = mesh.userData.fallbackBackface;
      if (back.material && typeof back.material.dispose === 'function') {
        try {
          back.material.dispose();
        } catch {}
      }
      if (typeof mesh.remove === 'function') {
        try {
          mesh.remove(back);
        } catch {}
      }
      mesh.userData.fallbackBackface = null;
    }
    if (mesh.userData && mesh.userData.groundShadowLayer) {
      const shadowLayer = mesh.userData.groundShadowLayer;
      if (shadowLayer.material && typeof shadowLayer.material.dispose === 'function') {
        try {
          shadowLayer.material.dispose();
        } catch {}
      }
      if (typeof mesh.remove === 'function') {
        try {
          mesh.remove(shadowLayer);
        } catch {}
      }
      mesh.userData.groundShadowLayer = null;
    }
  } catch {}

  if (!mesh) return;
  const parent = mesh.parent;
  if (parent && typeof parent.remove === 'function') {
    parent.remove(mesh);
  }
  const ownGeometry = mesh.userData?.ownGeometry !== false;
  if (ownGeometry && mesh.geometry && typeof mesh.geometry.dispose === 'function') {
    try {
      mesh.geometry.dispose();
    } catch {}
  }
  const material = mesh.material;
  if (Array.isArray(material)) {
    for (const mat of material) {
      if (mat && !mat.userData?.pooled && typeof mat.dispose === 'function') {
        try {
          mat.dispose();
        } catch {}
      }
    }
  } else if (material && !material.userData?.pooled && typeof material.dispose === 'function') {
    try {
      material.dispose();
    } catch {}
  }
}

function sceneTypeToEnum(t) {
  const s = String(t || '').toLowerCase();
  switch (s) {
    case 'plane': return MJ_GEOM.PLANE;
    case 'hfield': return MJ_GEOM.HFIELD;
    case 'sphere': return MJ_GEOM.SPHERE;
    case 'capsule': return MJ_GEOM.CAPSULE;
    case 'ellipsoid': return MJ_GEOM.ELLIPSOID;
    case 'cylinder': return MJ_GEOM.CYLINDER;
    case 'box': return MJ_GEOM.BOX;
    case 'mesh': return MJ_GEOM.MESH;
    default: return MJ_GEOM.BOX;
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
    const color = (spec.color >>> 0).toString(16);
    const rough = Math.round(((spec.roughness ?? 0.55) + Number.EPSILON) * 1000) / 1000;
    const metal = Math.round(((spec.metalness ?? 0.0) + Number.EPSILON) * 1000) / 1000;
    const wire = !!spec.wireframe;
    return `${kind}|${color}|r${rough}|m${metal}|w${wire}`;
  }
  get(spec) {
    const key = this._key(spec);
    if (this.cache.has(key)) return this.cache.get(key);
    const T = this.THREE;
    let mat;
    const forceBasic = (typeof window !== 'undefined') && (window.location?.search?.includes('forceBasic=1'));
    if (spec.kind === 'standard') {
      mat = forceBasic
        ? new T.MeshBasicMaterial({ color: spec.color ?? 0xffffff, wireframe: !!spec.wireframe })
        : new T.MeshStandardMaterial({
            color: spec.color ?? 0xffffff,
            roughness: spec.roughness ?? 0.55,
            metalness: spec.metalness ?? 0.0,
            wireframe: !!spec.wireframe,
          });
    } else {
      mat = forceBasic
        ? new T.MeshBasicMaterial({ color: spec.color ?? 0xffffff, wireframe: !!spec.wireframe })
        : new T.MeshPhysicalMaterial({
            color: spec.color ?? 0xffffff,
            roughness: spec.roughness ?? 0.55,
            metalness: spec.metalness ?? 0.0,
            clearcoat: 0.2,
            clearcoatRoughness: 0.15,
            specularIntensity: 0.25,
            ior: 1.5,
            wireframe: !!spec.wireframe,
          });
    }
    mat.userData = mat.userData || {};
    mat.userData.pooled = true;
    this.cache.set(key, mat);
    return mat;
  }
  disposeAll() {
    for (const m of this.cache.values()) {
      try { m.dispose?.(); } catch {}
    }
    this.cache.clear();
  }
}

function syncRendererAssets(ctx, assets) {
  const source = assets || null;
  if (ctx.assetSource === source) return;
  ctx.assetSource = source;
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
  if (ctx.assetCache && ctx.assetCache.meshGeometries instanceof Map) {
    for (const geometry of ctx.assetCache.meshGeometries.values()) {
      if (geometry && typeof geometry.dispose === 'function') {
        try {
          geometry.dispose();
        } catch {}
      }
    }
    ctx.assetCache.meshGeometries.clear();
  }
  ctx.assetCache = {
    meshGeometries: new Map(),
  };
}

function getSharedMeshGeometry(ctx, assets, dataId) {
  if (!ctx.assetCache || !(ctx.assetCache.meshGeometries instanceof Map)) {
    ctx.assetCache = {
      meshGeometries: new Map(),
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

function applyMaterialFlags(mesh, index, state) {
  if (!mesh || !mesh.material) return;
  const sceneFlags = state.rendering?.sceneFlags || [];
  mesh.material.wireframe = !!sceneFlags[1];
  if (mesh.material.emissive && typeof mesh.material.emissive.set === 'function') {
    mesh.material.emissive.set(sceneFlags[0] ? 0x1a1f2a : 0x000000);
  } else if (mesh.material && 'emissive' in mesh.material) {
    mesh.material.emissive = new THREE.Color(sceneFlags[0] ? 0x1a1f2a : 0x000000);
  }
}

function updateMeshMaterial(mesh, matIndex, matRgbaView) {
  if (!mesh || !mesh.material || !(matIndex >= 0)) return;
  const base = matIndex * 4;
  const r = matRgbaView?.[base + 0] ?? 0.6;
  const g = matRgbaView?.[base + 1] ?? 0.6;
  const b = matRgbaView?.[base + 2] ?? 0.9;
  const a = matRgbaView?.[base + 3] ?? 1;
  const material = mesh.material;
  if (material.color && typeof material.color.setRGB === 'function') {
    material.color.setRGB(r, g, b);
  }
  if ('opacity' in material) {
    material.opacity = a;
    material.transparent = a < 0.999;
  }
  if ('needsUpdate' in material) {
    material.needsUpdate = true;
  }
}

function ensureGeomMesh(ctx, index, gtype, assets, dataId, sizeVec, options = {}, state = null) {
  if (!ctx.meshes) ctx.meshes = [];
  let mesh = ctx.meshes[index];
  const sizeKey = Array.isArray(sizeVec)
    ? sizeVec.map((v) => (Number.isFinite(v) ? v.toFixed(6) : '0')).join(',')
    : 'null';
  const needsRebuild =
    !mesh ||
    mesh.userData?.geomType !== gtype ||
    (gtype === MJ_GEOM.MESH && mesh.userData?.geomDataId !== dataId) ||
    (gtype !== MJ_GEOM.MESH && mesh.userData?.geomSizeKey !== sizeKey);

  if (needsRebuild) {
    if (mesh) {
      disposeMeshObject(mesh);
    }

    let geometryInfo = null;
    if (gtype === MJ_GEOM.MESH && assets && dataId >= 0) {
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
        console.warn('[render] mesh geometry missing', { dataId });
        ctx.meshAssetMissingLogged = true;
      }
    }
    if (!geometryInfo) {
      const fb = ctx.fallback || {};
      geometryInfo = createPrimitiveGeometry(gtype, sizeVec, {
        fallbackEnabled: fb.enabled !== false,
        preset: fb.preset || 'bright-outdoor',
        planeExtent: options.planeExtent,
      });
      geometryInfo.ownGeometry = true;
    }

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
      const poolKey = {
        kind: useStandard ? 'standard' : 'physical',
        color: baseOpts.color ?? 0xffffff,
        roughness: baseOpts.roughness ?? 0.55,
        metalness: baseOpts.metalness ?? 0.0,
        wireframe: wire,
      };
      if (!ctx.materialPool) ctx.materialPool = new MaterialPool(THREE);
      material = ctx.materialPool.get(poolKey);
      if (!useStandard) material.envMapIntensity = (ctx?.envIntensity ?? 0.6);
    }
    material.side = THREE.FrontSide;
    mesh = new THREE.Mesh(geometryInfo.geometry, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    if (typeof geometryInfo.postCreate === 'function') {
      try {
        geometryInfo.postCreate(mesh);
      } catch {}
    }
    mesh.userData = mesh.userData || {};
    mesh.userData.geomType = gtype;
    mesh.userData.geomDataId = gtype === MJ_GEOM.MESH ? dataId : -1;
    mesh.userData.geomSizeKey = gtype === MJ_GEOM.MESH ? null : sizeKey;
    mesh.userData.ownGeometry = geometryInfo.ownGeometry !== false;
    mesh.userData.geomIndex = index;
    ctx.root.add(mesh);
    ctx.meshes[index] = mesh;
  }

  return mesh;
}
function updateMeshFromSnapshot(mesh, i, snapshot, state, assets) {
  const n = snapshot.ngeom | 0;
  if (i >= n) {
    mesh.visible = false;
    return;
  }
  const sceneGeom = Array.isArray(snapshot.scene?.geoms) ? snapshot.scene.geoms[i] : null;
  if (sceneGeom) {
    const px = Number(sceneGeom.xpos?.[0]) || 0;
    const py = Number(sceneGeom.xpos?.[1]) || 0;
    const pz = Number(sceneGeom.xpos?.[2]) || 0;
    mesh.position.set(px, py, pz);
    const m = Array.isArray(sceneGeom.xmat) && sceneGeom.xmat.length >= 9 ? sceneGeom.xmat : [1,0,0,0,1,0,0,0,1];
    mesh.quaternion.copy(mat3ToQuat(m));
  } else {
    const xpos = snapshot.xpos;
    const baseIndex = 3 * i;
    const pos = [
      xpos?.[baseIndex + 0] ?? 0,
      xpos?.[baseIndex + 1] ?? 0,
      xpos?.[baseIndex + 2] ?? 0,
    ];
    mesh.position.set(pos[0], pos[1], pos[2]);
    const xmat = snapshot.xmat;
    const matBase = 9 * i;
    const rot = [
      xmat?.[matBase + 0] ?? 1,
      xmat?.[matBase + 1] ?? 0,
      xmat?.[matBase + 2] ?? 0,
      xmat?.[matBase + 3] ?? 0,
      xmat?.[matBase + 4] ?? 1,
      xmat?.[matBase + 5] ?? 0,
      xmat?.[matBase + 6] ?? 0,
      xmat?.[matBase + 7] ?? 0,
      xmat?.[matBase + 8] ?? 1,
    ];
    mesh.quaternion.copy(mat3ToQuat(rot));
  }
  mesh.scale.set(1, 1, 1);

  if (sceneGeom && Array.isArray(sceneGeom.rgba)) {
    try {
      const r = Number(sceneGeom.rgba[0]);
      const g = Number(sceneGeom.rgba[1]);
      const b = Number(sceneGeom.rgba[2]);
      const a = Number(sceneGeom.rgba[3]);
      if (mesh.material && mesh.material.color && typeof mesh.material.color.setRGB === 'function') {
        if (Number.isFinite(r) && Number.isFinite(g) && Number.isFinite(b)) {
          mesh.material.color.setRGB(Math.max(0, r), Math.max(0, g), Math.max(0, b));
        }
      }
      if ('opacity' in mesh.material && Number.isFinite(a)) {
        mesh.material.opacity = a;
        mesh.material.transparent = a < 0.999;
      }
      if ('needsUpdate' in mesh.material) mesh.material.needsUpdate = true;
    } catch {}
  } else {
    const matIdView = snapshot.gmatid || assets?.geoms?.matid || null;
    const matRgbaView = assets?.materials?.rgba || snapshot.matrgba || null;
    const matIndex = matIdView?.[i] ?? -1;
    if (Array.isArray(matRgbaView) || ArrayBuffer.isView(matRgbaView)) {
      updateMeshMaterial(mesh, matIndex, matRgbaView);
    }
  }

  applyMaterialFlags(mesh, i, state);
  mesh.visible = true;
}

function getDefaultVopt(ctx, state) {
  if (!state?.rendering?.voptFlags) return null;
  if (!ctx.defaultVopt) {
    ctx.defaultVopt = state.rendering.voptFlags.slice();
  }
  return ctx.defaultVopt;
}
export function createRendererManager({
  canvas,
  renderCtx,
  applyFallbackAppearance,
  ensureEnvIfNeeded,
  hideAllGeometryDefault,
  fallbackEnabledDefault,
  fallbackPresetKey,
  fallbackModeParam,
  debugMode = false,
  setRenderStats = () => {},
}) {
  const ctx = renderCtx;
  if (!ctx) throw new Error('renderCtx is required');
  ctx.cameraTarget = ctx.cameraTarget || new THREE.Vector3(0, 0, 0);
  ctx.meshes = ctx.meshes || [];
  ctx.assetCache = ctx.assetCache || { meshGeometries: new Map() };
  ctx._shadow = ctx._shadow || { lastCenter: null, lastRadius: 0 };
  ctx._frameCounter = ctx._frameCounter || 0;
  ctx.boundsEvery = typeof ctx.boundsEvery === 'number' && ctx.boundsEvery > 0 ? ctx.boundsEvery : 2;
  ctx.currentCameraMode = typeof ctx.currentCameraMode === 'number' ? ctx.currentCameraMode : 0;
  ctx.fixedCameraActive = !!ctx.fixedCameraActive;

  const cleanup = [];
  const tempVecA = new THREE.Vector3();
  const tempVecB = new THREE.Vector3();
  const tempVecC = new THREE.Vector3();
  const tempVecD = new THREE.Vector3();

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
    const step = () => {
      if (!ctx.loopActive) return;
      ctx.frameId = window.requestAnimationFrame(step);
      if (!ctx.initialized || !ctx.renderer || !ctx.scene || !ctx.camera) return;
      // Background/environment is managed by environment manager (ensureEnvIfNeeded)
      ctx.renderer.render(ctx.scene, ctx.camera);
      // Expose a simple frame counter for headless readiness checks
      try {
        ctx._frameCounter = (ctx._frameCounter || 0) + 1;
        if (typeof window !== 'undefined') {
          window.__frameCounter = ctx._frameCounter;
        }
      } catch {}
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
        } catch {}
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
    if (typeof window !== 'undefined') {
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    }
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;
    if ('physicallyCorrectLights' in renderer) {
      renderer.physicallyCorrectLights = true;
    }
    renderer.setClearColor(0xd6dce4, 1);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;

    // Snapshot helpers: readiness + PBR export of final frame
    if (typeof window !== 'undefined' && (!window.exportPNG || !window.whenReady)) {
      try {
        window.whenReady = async () => {
          try {
            const r = renderer;
            const scn = scene;
            const cam = (ctx && ctx.camera) ? ctx.camera : camera;
            if (!r || !scn || !cam) return false;
            const texReady = () => {
              try { return !!scn.environment && !!scn.environment.isTexture && scn.environment.isRenderTargetTexture !== true; } catch { return false; }
            };
            const drew = () => {
              try { return (r.info?.render?.triangles || 0) > 0 || (window.__drawnCount || 0) > 3; } catch { return false; }
            };
            const compiled = () => {
              try { return Array.isArray(r.info?.programs) ? r.info.programs.length > 0 : true; } catch { return true; }
            };
            for (let i = 0; i < 120; i += 1) {
              await new Promise((res) => requestAnimationFrame(res));
              if (texReady() && drew() && compiled()) break;
            }
            window.__ready = true;
            return true;
          } catch { window.__ready = true; return false; }
        };

        // Export exactly the current frame as seen on screen (no state changes)
        window.exportExactPNG = async () => {
          try {
            await (window.whenReady ? window.whenReady() : Promise.resolve());
            const r = renderer;
            const scn = scene;
            const cam = (ctx && ctx.camera) ? ctx.camera : camera;
            if (!r || !scn || !cam) return null;
            r.setRenderTarget?.(null);
            r.render(scn, cam);
            const url = r.domElement && typeof r.domElement.toDataURL === 'function'
              ? r.domElement.toDataURL('image/png')
              : null;
            if (typeof window !== 'undefined') {
              window.__viewerCanvasDataUrlLength = url ? url.length : 0;
            }
            return url || null;
          } catch (err) {
            try { console.warn('[render] exportExactPNG failed', err); } catch {}
            return null;
          }
        };

        window.exportPNG = async () => {
          try {
            await (window.whenReady ? window.whenReady() : Promise.resolve());
            const r = renderer;
            const scn = scene;
            const cam = (ctx && ctx.camera) ? ctx.camera : camera;
            if (!r || !scn || !cam) return null;
            // Ensure depth/alpha consistent for the frame
            try {
              const gl = r.getContext?.();
              if (gl) { gl.enable(gl.DEPTH_TEST); gl.depthMask(true); }
            } catch {}
            const saved = [];
            try {
              scn.traverse((o) => {
                if (o && o.isMesh && o.material) {
                  saved.push([o, {
                    dt: !!o.material.depthTest,
                    dw: !!o.material.depthWrite,
                    tr: !!o.material.transparent,
                    ro: Number(o.renderOrder || 0),
                  }]);
                  if ('depthTest' in o.material) o.material.depthTest = true;
                  if ('depthWrite' in o.material) o.material.depthWrite = true;
                  if ('transparent' in o.material) o.material.transparent = false;
                  o.renderOrder = 0;
                }
              });
            } catch {}
            r.setRenderTarget?.(null);
            r.render(scn, cam);
            const url = r.domElement?.toDataURL?.('image/png');
            window.__viewerCanvasDataUrlLength = url ? url.length : 0;
            // restore
            try { for (const [o, m] of saved) { o.material.depthTest = m.dt; o.material.depthWrite = m.dw; o.material.transparent = m.tr; o.renderOrder = m.ro; } } catch {}
            return url || null;
          } catch (err) {
            try { console.warn('[render] exportPNG failed', err); } catch {}
            return null;
          }
        };
      } catch {}
    }

    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0xd6dce4, 12, 48);

    const ambient = new THREE.AmbientLight(0xffffff, 0);
    scene.add(ambient);
    const hemi = new THREE.HemisphereLight(0xffffff, 0x10131c, 0);
    scene.add(hemi);
    const keyLight = new THREE.DirectionalLight(0xffffff, 2.0);
    keyLight.position.set(6, -8, 8);
    keyLight.castShadow = true;
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
    scene.add(lightTarget);
    keyLight.target = lightTarget;
    scene.add(keyLight);
    const fill = new THREE.DirectionalLight(0xffffff, 0.25);
    fill.position.set(-6, 6, 3);
    scene.add(fill);

    const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 100);
    camera.up.set(0, 0, 1);
    camera.position.set(3, -4, 2);
    camera.lookAt(new THREE.Vector3(0, 0, 0));

    const root = new THREE.Group();
    scene.add(root);

    const grid = new THREE.GridHelper(12, 24, 0xdfe6f4, 0xdfe6f4);
    grid.rotation.x = Math.PI / 2;
    const gridMaterials = Array.isArray(grid.material) ? grid.material : [grid.material];
    for (const mat of gridMaterials) {
      if (!mat) continue;
      if ('color' in mat && typeof mat.color?.set === 'function') {
        mat.color.set(0xdfe6f4);
      }
      mat.transparent = true;
      mat.opacity = 0.08;
      mat.depthWrite = false;
    }
    scene.add(grid);

    Object.assign(ctx, {
      initialized: true,
      renderer,
      scene,
      camera,
      root,
      grid,
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
      envDirty: true,
      sky: null,
      skyInit: false,
      fallback: {
        enabled: fallbackEnabledDefault,
        preset: fallbackPresetKey,
        mode: fallbackModeParam,
      },
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
    const context = initRenderer();
    if (!context.initialized) return;
    const renderer = context.renderer;

    const assets = state.rendering?.assets || null;
    syncRendererAssets(context, assets);
    const geomGroupIds = assets?.geoms?.group || null;
    const geomGroupMask = Array.isArray(state.rendering?.groups?.geom) ? state.rendering.groups.geom : null;

    if (typeof applyFallbackAppearance === 'function') {
      applyFallbackAppearance(context, state);
    }
    if (typeof ensureEnvIfNeeded === 'function') {
      ensureEnvIfNeeded(context, state);
    }

    const visStruct = state.model?.vis || null;
    const statStruct = state.model?.stat || null;
    if (visStruct) {
      applyVisualLighting(context, visStruct);
      applyVisualFog(context, visStruct, statStruct, context.bounds);
    }

    const defaults = getDefaultVopt(context, state);
    const voptFlags = state.rendering?.voptFlags || [];
    const sceneFlags = state.rendering?.sceneFlags || [];
    if (context.renderer) {
      context.renderer.shadowMap.enabled = true;
      if (context.renderer.shadowMap) {
        context.renderer.shadowMap.type = THREE.PCFShadowMap;
      }
    }
    if (context.light) {
      const baseLight = sceneFlags[0] ? 1.45 : 1.05;
      context.light.intensity = baseLight;
    }
    if (context.fill) {
      context.fill.intensity = sceneFlags[0] ? 0.35 : 0.2;
    }
    if (context.ambient) {
      context.ambient.intensity = 0.03;
    }
    if (context.hemi) {
      const fillLight = sceneFlags[0] ? 0.6 : 0.35;
      context.hemi.intensity = fillLight;
      context.hemi.groundColor.set(sceneFlags[0] ? 0x111622 : 0x161b29);
    }

    // --- Overlays: contacts (controlled by vopt flags) ---
    const vopt = state.rendering?.voptFlags || [];
    const contactPointEnabled = !!vopt[14];
    const contactForceEnabled = !!vopt[16];
    // Contact overlays: points (flags[14]) and force arrows (flags[16]).
    const contacts = snapshot.contacts || null;
    if (contactPointEnabled && contacts && typeof contacts.n === 'number' && !contacts.pos) {
      try { console.warn('[render] contact points enabled but no position array in snapshot; n=', contacts.n); } catch {}
    }
    if (contactPointEnabled && contacts && contacts.pos && typeof contacts.n === 'number') {
      // Ensure overlay group
      if (!context.contactGroup) {
        context.contactGroup = new THREE.Group();
        context.contactGroup.name = 'overlay:contacts';
        context.scene.add(context.contactGroup);
        context.contactPool = [];
      }
      const group = context.contactGroup;
      const pool = context.contactPool || [];
      const n = Math.max(0, contacts.n | 0);
      // Contact visual size: small fraction of bounds radius
      const r = Math.max(0.5, (context.bounds?.radius || 1));
      const radius = Math.max(0.012, Math.min(0.04, r * 0.014));
      const thickness = Math.max(0.2 * radius, 0.01);
      // Prepare a shared cylinder geometry/material
      const currentGeom = group.userData.geometry;
      if (
        !currentGeom
        || currentGeom.parameters?.radiusTop !== radius
        || currentGeom.parameters?.height !== thickness
      ) {
        try { currentGeom?.dispose?.(); } catch {}
        const cyl = new THREE.CylinderGeometry(radius * 0.85, radius * 0.85, thickness, 24, 1);
        cyl.rotateX(Math.PI / 2);
        group.userData.geometry = cyl;
        for (const mesh of pool) {
          if (mesh) mesh.geometry = cyl;
        }
      }
      const visStruct = state?.model?.vis || {};
      const rgbaContact = visStruct?.rgba?.contact;
      const contactColorHex = rgbaToHex(rgbaContact, CONTACT_POINT_FALLBACK_COLOR);
      const contactOpacity = alphaFromArray(rgbaContact, 0.85);
      if (!group.userData.material) {
        group.userData.material = new THREE.MeshBasicMaterial({
          color: contactColorHex,
          side: THREE.DoubleSide,
          transparent: contactOpacity < 0.999,
          opacity: contactOpacity,
          depthTest: true,
          depthWrite: false,
        });
      } else {
        group.userData.material.color.setHex(contactColorHex);
        group.userData.material.opacity = contactOpacity;
        group.userData.material.transparent = contactOpacity < 0.999;
        group.userData.material.depthWrite = false;
      }
      // Grow pool if needed
      for (let i = pool.length; i < n; i += 1) {
        const m = new THREE.Mesh(group.userData.geometry, group.userData.material);
        m.matrixAutoUpdate = true;
        m.frustumCulled = false;
        pool.push(m);
        group.add(m);
      }
      // Update positions
      const pos = contacts.pos;
      const frame = ArrayBuffer.isView(contacts.frame) ? contacts.frame : null;
      const offsetScale = Math.max(thickness * 0.5, 0.003);
      for (let i = 0; i < pool.length; i += 1) {
        const mesh = pool[i];
        if (i < n) {
          const base = 3 * i;
          const x = Number(pos[base + 0]) || 0;
          const y = Number(pos[base + 1]) || 0;
          const z = Number(pos[base + 2]) || 0;
          mesh.visible = true;
          const normal = CONTACT_TMP_NORMAL.set(0, 0, 1);
          if (frame && frame.length >= 9 * (i + 1)) {
            const rotBase = 9 * i;
            normal.set(
              Number(frame[rotBase + 0]) || 0,
              Number(frame[rotBase + 1]) || 0,
              Number(frame[rotBase + 2]) || 0,
            ).normalize();
          }
          mesh.quaternion.setFromUnitVectors(CONTACT_UP, normal);
          const ox = x + normal.x * offsetScale;
          const oy = y + normal.y * offsetScale;
          const oz = z + normal.z * offsetScale;
          mesh.position.set(ox, oy, oz);
        } else {
          mesh.visible = false;
        }
      }
      // Update references
      context.contactPool = pool;
      group.visible = true;
    } else {
      if (context.contactGroup) context.contactGroup.visible = false;
    }

    if (contactForceEnabled && contacts && typeof contacts.n === 'number' && contacts.n > 0) {
      const pos = ArrayBuffer.isView(contacts.pos) ? contacts.pos : null;
      if (!pos) {
        if (context.contactForceGroup) context.contactForceGroup.visible = false;
      } else {
        if (!context.contactForceGroup) {
          context.contactForceGroup = new THREE.Group();
          context.contactForceGroup.name = 'overlay:contactForces';
          context.scene.add(context.contactForceGroup);
          context.contactForcePool = [];
        }
        const group = context.contactForceGroup;
        const pool = Array.isArray(context.contactForcePool) ? context.contactForcePool : [];
        const visStruct = state?.model?.vis || {};
        const statStruct = state?.model?.stat || state?.statistic || {};
        const meanSize = (() => {
          const value = Number(statStruct?.meansize);
          if (Number.isFinite(value) && value > 1e-6) return value;
          const radius = context.bounds?.radius;
          if (Number.isFinite(radius) && radius > 0) return radius;
          return 1;
        })();
        const meanMass = (() => {
          const value = Number(statStruct?.meanmass);
          if (Number.isFinite(value) && value > 1e-9) return value;
          return 1;
        })();
        const mapForce = (() => {
          const value = Number(visStruct?.map?.force);
          if (Number.isFinite(value) && value > 0) return value;
          return 0.005;
        })();
        const forceWidthScale = (() => {
          const value = Number(visStruct?.scale?.forcewidth);
          if (Number.isFinite(value) && value > 0) return value;
          return 0.1;
        })();
        const shaftRadius = Math.max(meanSize * 0.015, forceWidthScale * meanSize * 0.5, 0.008);
        const minLength = Math.max(shaftRadius * 2.5, meanSize * 0.02);
        const fallbackLength = Math.max(minLength, shaftRadius * 3);
        const maxLength = Math.max(meanSize * 6, (context.bounds?.radius || meanSize) * 8);
        const lengthScale = mapForce / meanMass;
        const frame = ArrayBuffer.isView(contacts.frame) ? contacts.frame : null;
        const force = ArrayBuffer.isView(contacts.force) ? contacts.force : null;
        const rgbaContactForce = visStruct?.rgba?.contactforce;
        const colorHex = rgbaToHex(rgbaContactForce, CONTACT_FORCE_FALLBACK_COLOR);
        const colorOpacity = alphaFromArray(rgbaContactForce, 0.8);
        if (!context.contactForceMaterial) {
          context.contactForceMaterial = new THREE.MeshBasicMaterial({
            color: colorHex,
            transparent: colorOpacity < 0.999,
            opacity: colorOpacity,
            depthWrite: false,
            toneMapped: false,
          });
        } else {
          context.contactForceMaterial.color.setHex(colorHex);
          context.contactForceMaterial.opacity = colorOpacity;
          context.contactForceMaterial.transparent = colorOpacity < 0.999;
          context.contactForceMaterial.depthWrite = false;
        }
        const material = context.contactForceMaterial;
        const n = Math.max(0, contacts.n | 0);
        while (pool.length < n) {
          const shaft = new THREE.Mesh(CONTACT_FORCE_SHAFT_GEOMETRY, material);
          shaft.matrixAutoUpdate = true;
          shaft.frustumCulled = false;
          const head = new THREE.Mesh(CONTACT_FORCE_HEAD_GEOMETRY, material);
          head.matrixAutoUpdate = true;
          head.frustumCulled = false;
          const node = new THREE.Group();
          node.matrixAutoUpdate = true;
          node.frustumCulled = false;
          node.add(shaft);
          node.add(head);
          pool.push({ node, shaft, head });
          group.add(node);
        }
        for (let i = 0; i < pool.length; i += 1) {
          const arrow = pool[i];
          if (i < n) {
            const base = 3 * i;
            const x = Number(pos[base + 0]) || 0;
            const y = Number(pos[base + 1]) || 0;
            const z = Number(pos[base + 2]) || 0;
            arrow.node.visible = true;
            arrow.node.position.set(x, y, z);
            let magnitude = 0;
            if (force && force.length >= base + 3) {
              const wx = Number(force[base + 0]) || 0;
              const wy = Number(force[base + 1]) || 0;
              const wz = Number(force[base + 2]) || 0;
              CONTACT_FORCE_DIR.set(wx, wy, wz);
              magnitude = CONTACT_FORCE_DIR.length();
            } else {
              CONTACT_FORCE_DIR.set(0, 0, 0);
            }
            let directionReady = false;
            if (magnitude > CONTACT_FORCE_EPS) {
              CONTACT_FORCE_DIR.multiplyScalar(1 / magnitude);
              directionReady = true;
            }
            const rotBase = 9 * i;
            if (!directionReady) {
              if (frame && frame.length >= (rotBase + 9)) {
                CONTACT_FORCE_NORMAL.set(
                  Number(frame[rotBase + 0]) || 0,
                  Number(frame[rotBase + 1]) || 0,
                  Number(frame[rotBase + 2]) || 0,
                );
                if (CONTACT_FORCE_NORMAL.lengthSq() <= CONTACT_FORCE_EPS) {
                  CONTACT_FORCE_NORMAL.copy(CONTACT_UP);
                } else {
                  CONTACT_FORCE_NORMAL.normalize();
                }
              } else {
                CONTACT_FORCE_NORMAL.copy(CONTACT_UP);
              }
              CONTACT_FORCE_DIR.copy(CONTACT_FORCE_NORMAL);
            }
            CONTACT_FORCE_TMP_QUAT.setFromUnitVectors(CONTACT_FORCE_AXIS, CONTACT_FORCE_DIR);
            arrow.node.quaternion.copy(CONTACT_FORCE_TMP_QUAT);
            const scaledLength = magnitude > CONTACT_FORCE_EPS
              ? magnitude * lengthScale
              : fallbackLength;
            const length = Math.min(maxLength, Math.max(minLength, scaledLength));
            let headLength = Math.max(length * 0.3, shaftRadius * 3);
            headLength = Math.min(headLength, length * 0.6);
            const headRadius = Math.max(shaftRadius * 1.6, headLength * 0.4);
            let rawShaft = Math.max(length - headLength, shaftRadius * 1.5);
            const totalRaw = rawShaft + headLength;
            const scaleFactor = totalRaw > CONTACT_FORCE_EPS ? (length / totalRaw) : 1;
            rawShaft *= scaleFactor;
            const finalHeadLength = headLength * scaleFactor;
            arrow.shaft.scale.set(shaftRadius, rawShaft, shaftRadius);
            arrow.shaft.position.set(0, rawShaft / 2, 0);
            arrow.head.scale.set(headRadius, finalHeadLength, headRadius);
            arrow.head.position.set(0, rawShaft + finalHeadLength / 2, 0);
          } else if (arrow?.node) {
            arrow.node.visible = false;
          }
        }
        context.contactForcePool = pool;
        group.visible = true;
      }
    } else if (context.contactForceGroup) {
      context.contactForceGroup.visible = false;
      if (Array.isArray(context.contactForcePool)) {
        for (const arrow of context.contactForcePool) {
          if (arrow?.node) arrow.node.visible = false;
        }
      }
    }

    let hideAllGeometry = !!hideAllGeometryDefault;
    let highlightGeometry = false;
    if (defaults) {
      for (let idx = 0; idx < Math.min(defaults.length, voptFlags.length); idx += 1) {
        const def = defaults[idx];
        const val = voptFlags[idx];
        if (def && !val) {
          hideAllGeometry = true;
          break;
        }
        if (!def && val) {
          highlightGeometry = true;
        }
      }
    }

    const ngeom = snapshot.ngeom | 0;
    const nextBounds = ngeom > 0 ? computeBoundsFromSnapshot(snapshot) : null;
    const trackingBounds = ngeom > 0 ? (computeBoundsFromSnapshot(snapshot, { ignoreStatic: true }) || nextBounds) : nextBounds;
    const trackingGeomSelection = Number.isFinite(state.runtime?.trackingGeom) ? (state.runtime.trackingGeom | 0) : -1;
    const trackingOverride = (() => {
      if (!(trackingGeomSelection >= 0) || !(ngeom > 0)) return null;
      if (!snapshot.xpos || trackingGeomSelection >= ngeom) return null;
      const base = trackingGeomSelection * 3;
      const px = Number(snapshot.xpos[base + 0]);
      const py = Number(snapshot.xpos[base + 1]);
      const pz = Number(snapshot.xpos[base + 2]);
      if (!Number.isFinite(px) || !Number.isFinite(py) || !Number.isFinite(pz)) return null;
      let radius = null;
      try {
        const sizeView = snapshot.gsize || null;
        const typeView = snapshot.gtype || null;
        const sx = sizeView ? Number(sizeView[base + 0]) : 0.1;
        const sy = sizeView ? Number(sizeView[base + 1]) : sx;
        const sz = sizeView ? Number(sizeView[base + 2]) : sx;
        const gType = typeView ? (typeView[trackingGeomSelection] ?? MJ_GEOM.BOX) : MJ_GEOM.BOX;
        radius = computeGeomRadius(gType, sx, sy, sz);
      } catch {}
      return {
        index: trackingGeomSelection,
        position: [px, py, pz],
        radius: Number.isFinite(radius) ? radius : null,
      };
    })();
    syncCameraPoseFromMode(
      context,
      state,
      nextBounds,
      { tempVecA, tempVecB, tempVecC, tempVecD },
      { trackingBounds, trackingOverride },
    );
    const planeExtentHint = (() => {
      const radiusSource =
        nextBounds?.radius ?? context.bounds?.radius ?? 0;
      const baseRadius =
        Number.isFinite(radiusSource) && radiusSource > 0 ? radiusSource : 1;
      const candidate = baseRadius * 12;
      return Math.max(100, candidate);
    })();

    let drawn = 0;
    const sizeView = snapshot.gsize || assets?.geoms?.size || null;
    const typeView = snapshot.gtype || assets?.geoms?.type || null;
    const dataIdView = snapshot.gdataid || assets?.geoms?.dataid || null;

    const overlayOptions = {
      geomGroupIds,
      geomGroupMask,
      hideAllGeometry,
      typeView,
      bounds: nextBounds || context.bounds || null,
    };
    updateFrameOverlays(context, snapshot, state, overlayOptions);
    updateLabelOverlays(context, snapshot, state, overlayOptions);
    updatePerturbOverlay(context, snapshot, state, overlayOptions);

    for (let i = 0; i < ngeom; i += 1) {
      const sceneGeom = Array.isArray(snapshot.scene?.geoms) ? snapshot.scene.geoms[i] : null;
      const type = sceneGeom ? sceneTypeToEnum(sceneGeom.type) : (typeView?.[i] ?? MJ_GEOM.BOX);
      const dataId = dataIdView?.[i] ?? -1;
      const base = 3 * i;
      const sizeVec = sceneGeom && Array.isArray(sceneGeom.size)
        ? [sceneGeom.size[0] ?? 0.1, sceneGeom.size[1] ?? sceneGeom.size[0] ?? 0.1, sceneGeom.size[2] ?? sceneGeom.size[0] ?? 0.1]
        : (sizeView
          ? [
              sizeView[base + 0] ?? 0,
              sizeView[base + 1] ?? 0,
              sizeView[base + 2] ?? 0,
            ]
          : null);
      const mesh = ensureGeomMesh(
        context,
        i,
        type,
        assets,
        dataId,
        sizeVec,
        { planeExtent: planeExtentHint },
        state,
      );
      if (!mesh) continue;
      updateMeshFromSnapshot(mesh, i, snapshot, state, assets);

      let visible = mesh.visible;
      if (hideAllGeometry) {
        visible = false;
      }
      if (visible && geomGroupMask) {
        const rawGroup = geomGroupIds && i < geomGroupIds.length ? geomGroupIds[i] : 0;
        const groupIdx = Number.isFinite(rawGroup) ? (rawGroup | 0) : 0;
        if (groupIdx >= 0 && groupIdx < geomGroupMask.length) {
          if (!geomGroupMask[groupIdx]) {
            visible = false;
          }
        }
      }

      if (highlightGeometry) {
        if (mesh.material?.emissive && typeof mesh.material.emissive.set === 'function') {
          mesh.material.emissive.set(0x2b3a7a);
        } else if (mesh.material) {
          mesh.material.emissive = new THREE.Color(0x2b3a7a);
        }
      }

      mesh.visible = visible;
      if (visible) drawn += 1;
    }

    for (let i = ngeom; i < context.meshes.length; i += 1) {
      if (context.meshes[i]) {
        context.meshes[i].visible = false;
      }
    }

    updateSelectionOverlay(context, snapshot, state);

    const stats = {
      drawn,
      hidden: Math.max(0, ngeom - drawn),
      contacts: snapshot.contacts?.n ?? 0,
      t: typeof snapshot.t === 'number' ? snapshot.t : null,
    };
    setRenderStats(stats);
    try {
      if (typeof window !== 'undefined') {
        window.__drawnCount = drawn;
        window.__ngeom = ngeom;
      }
    } catch {}

    if (typeof context.envIntensity === 'number' && context.envIntensity !== context.lastEnvIntensity) {
      const intensity = context.envIntensity;
      for (const m of context.meshes) {
        if (m && m.material && 'envMapIntensity' in m.material) {
          m.material.envMapIntensity = intensity;
        }
      }
      context.lastEnvIntensity = intensity;
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
        const toLight = desiredCenter.clone().applyMatrix4(cam.matrixWorldInverse);
        const snappedLS = toLight.clone();
        snappedLS.x = Math.round(snappedLS.x / texelX) * texelX;
        snappedLS.y = Math.round(snappedLS.y / texelY) * texelY;
        const snappedWS = snappedLS.clone().applyMatrix4(cam.matrixWorld);
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
          context._shadow.lastCenter = snappedWS.clone();
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
        context.camera.position.copy(focus.clone().add(offset));
        context.camera.lookAt(focus);
        context.cameraTarget.copy(focus);
        const desiredFar = Math.max(100, Math.max(radius, ctx.trackingRadius || radius) * 10);
        if (context.camera.far < desiredFar) {
          context.camera.far = desiredFar;
          if (typeof context.camera.updateProjectionMatrix === 'function') {
            context.camera.updateProjectionMatrix();
          }
        }
        context.autoAligned = true;
        if (debugMode) {
          console.log('[render] auto align', { radius, center: bounds.center });
        }
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
        context.light.position.copy(baseCenter.clone().add(lightOffset));
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
      context.camera.position.copy(
        target.clone().add(new THREE.Vector3(radius * 1.8, -radius * 1.8, radius * 1.2))
      );
      context.camera.lookAt(target);
      context.cameraTarget.copy(target);
      cacheTrackingPoseFromCurrent(context, { radius, center });
      if (debugMode) {
        console.log('[render] align', { radius, center });
      }
    }

    const copyState = state.runtime?.lastCopy;
    if (copyState && copyState.seq > context.copySeq) {
      context.copySeq = copyState.seq;
    }
    const baseGrid = sceneFlags[2] !== false;
    const fb = context.fallback || {};
    const gridVisible =
      !fb.enabled &&
      (baseGrid &&
        !(
          copyState &&
          copyState.precision === 'full' &&
          copyState.seq === context.copySeq
        ));
    context.grid.visible = gridVisible;

    const gl = renderer && typeof renderer.getContext === 'function' ? renderer.getContext() : null;
    if (typeof debugMode !== 'undefined' && debugMode && gl && !context.__debugMagentaTested) {
      try {
        if (typeof renderer?.setRenderTarget === 'function') {
          renderer.setRenderTarget(null);
        }
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.disable(gl.SCISSOR_TEST);
        gl.colorMask(true, true, true, true);
        gl.depthMask(true);
        const prevClear = gl.getParameter(gl.COLOR_CLEAR_VALUE);
        // Also capture renderer clear color as a robust fallback
        const prevRendererColor = (() => {
          try {
            const c = renderer.getClearColor(new THREE.Color());
            const a = renderer.getClearAlpha?.() ?? 1;
            return [c.r, c.g, c.b, a];
          } catch { return null; }
        })();
        gl.clearColor(1, 0, 1, 1);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        const pixels = new Uint8Array(4);
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
        console.log('[render] magenta test sample', Array.from(pixels));
        const restore = (arr) => { try { gl.clearColor(arr[0], arr[1], arr[2], arr[3]); } catch {} };
        if (Array.isArray(prevClear) && prevClear.length === 4) {
          restore(prevClear);
        } else if (Array.isArray(prevRendererColor) && prevRendererColor.length === 4) {
          restore(prevRendererColor);
        } else {
          // Final fallback to the light UI background
          const c = new THREE.Color(0xd6dce4);
          restore([c.r, c.g, c.b, 1]);
        }
      } catch (err) {
        console.warn('[render] magenta test failed', err);
      }
      context.__debugMagentaTested = true;
    }
  }

  function setup() {
    initRenderer();
    return ctx;
  }

  return {
    setup,
    renderScene,
    ensureRenderLoop,
    updateViewport: () => updateRendererViewport(),
  };
}








function clearSelectionHighlight(ctx) {
  const hl = ctx?.selectionHighlight;
  if (!hl) return;
  try {
    if (hl.glow && hl.glow.parent) {
      hl.glow.parent.remove(hl.glow);
    }
    if (hl.material && typeof hl.material.dispose === 'function') {
      try { hl.material.dispose(); } catch {}
    }
  } catch {}
  ctx.selectionHighlight = null;
}

function createSelectionGlow(mesh) {
  const material = new THREE.MeshStandardMaterial({
    color: SELECTION_OVERLAY_COLOR,
    emissive: SELECTION_OVERLAY_COLOR.clone(),
    emissiveIntensity: 0.8,
    metalness: 0.2,
    roughness: 0.35,
    transparent: true,
    opacity: 0.85,
    side: THREE.DoubleSide,
    depthWrite: false,
    depthTest: true,
    blending: THREE.AdditiveBlending,
  });
  const glow = new THREE.Mesh(mesh.geometry, material);
  glow.renderOrder = (mesh.renderOrder || 0) + 0.5;
  glow.frustumCulled = false;
  glow.userData = { selectionGlow: true };
  glow.scale.setScalar(1.04);
  return { glow, material };
}

function applySelectionHighlight(ctx, mesh) {
  if (!mesh) {
    clearSelectionHighlight(ctx);
    return;
  }
  if (ctx.selectionHighlight?.mesh === mesh) {
    const hl = ctx.selectionHighlight;
    if (hl.glow && hl.glow.geometry !== mesh.geometry) {
      hl.glow.geometry = mesh.geometry;
    }
    if (hl.glow && hl.glow.parent !== mesh) {
      mesh.add(hl.glow);
    }
    hl.glow.visible = true;
    return;
  }
  clearSelectionHighlight(ctx);
  const { glow, material } = createSelectionGlow(mesh);
  mesh.add(glow);
  ctx.selectionHighlight = { mesh, glow, material };
}

function updateSelectionOverlay(ctx, snapshot, state) {
  const selection = state?.runtime?.selection;
  if (!selection || selection.geom < 0) {
    clearSelectionHighlight(ctx);
    return;
  }
  const mesh = Array.isArray(ctx.meshes) ? ctx.meshes[selection.geom] : null;
  if (!mesh) {
    clearSelectionHighlight(ctx);
    return;
  }
  applySelectionHighlight(ctx, mesh);
}
