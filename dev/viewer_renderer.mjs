import * as THREE from 'three';
import { createInfiniteGroundHelper } from './infinite_grid_helper.mjs';
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
const MJ_JOINT = {
  FREE: 0,
  BALL: 1,
  SLIDE: 2,
  HINGE: 3,
};
const MJ_TRN = {
  JOINT: 0,
  JOINTINPARENT: 1,
  SLIDERCRANK: 2,
  SITE: 3,
  BODY: 4,
  TENDON: 5,
};
const MJ_SENSOR = {
  RANGEFINDER: 7,
};
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
const MJ_EQ = {
  CONNECT: 0,
  WELD: 1,
  JOINT: 2,
  TENDON: 3,
  FLEX: 4,
  DISTANCE: 5,
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
const LABEL_TEXTURE_CACHE = new Map();
const LABEL_TEXTURE_VERSION = 3;
const LABEL_DEFAULT_HEIGHT = 0.08;
const LABEL_DEFAULT_OFFSET = 0.04;
const LABEL_LOD_NEAR = 2.0;
const LABEL_LOD_MID = 4.5;
const LABEL_LOD_FACTORS = { near: 2, mid: 1.4, far: 1 };
const __TMP_VEC3 = new THREE.Vector3();
const __TMP_VEC3_A = new THREE.Vector3();
const __TMP_VEC3_B = new THREE.Vector3();
const __TMP_VEC3_C = new THREE.Vector3();
const __TMP_COLOR = new THREE.Color();
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
const PERTURB_COLOR_ROTATE = 0xffd1a6;
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
const PERTURB_TEMP_VEC = new THREE.Vector3();
const PERTURB_TEMP_VEC2 = new THREE.Vector3();
const SELECTION_HIGHLIGHT_COLOR = new THREE.Color(0x40ff99);
const SELECTION_EMISSIVE_COLOR = new THREE.Color(0x3aff3a);
const SELECTION_OVERLAY_COLOR = new THREE.Color(0x66ffcc);
const SELECT_POINT_FALLBACK_COLOR = 0xff8a2b;
const PERTURB_COLOR_RING = 0xff8a2b;   // original ring color
const PERTURB_COLOR_ARROW = 0xffb366;  // previous arrow color (lighter)
const CAMERA_GIZMO_GEOMETRY = new THREE.BoxGeometry(1, 0.8, 0.6);
const LIGHT_GIZMO_GEOMETRY = new THREE.CylinderGeometry(0.6, 0.6, 1, 12, 1);
const SLIDERCRANK_SHAFT_GEOMETRY = new THREE.CylinderGeometry(1, 1, 1, 12, 1, false);

function cloneHighlightMaterial(source) {
  if (!source || typeof source.clone !== 'function') {
    return source;
  }
  const cloned = source.clone();
  if ('emissive' in cloned && cloned.emissive?.set) {
    cloned.emissive = cloned.emissive.clone();
    cloned.emissive.copy(SELECTION_EMISSIVE_COLOR);
    cloned.emissiveIntensity = Math.max(1.4, cloned.emissiveIntensity ?? 1);
  }
  if ('color' in cloned && cloned.color?.lerp) {
    cloned.color = cloned.color.clone();
    cloned.color.lerp(SELECTION_HIGHLIGHT_COLOR, 0.65);
  }
  if ('metalness' in cloned) cloned.metalness = Math.max(0, Math.min(1, (cloned.metalness ?? 0) * 0.5));
  if ('roughness' in cloned) cloned.roughness = Math.max(0, Math.min(1, (cloned.roughness ?? 0) * 0.7));
  // 保持原始透明度与深度写入，避免“玻璃质感”
  return cloned;
}
const LABEL_MODE_WARNINGS = new Set();
const FRAME_MODE_WARNINGS = new Set();
const LABEL_DPR_CAP = 2;
const LABEL_GEOM_LIMIT = 120;
const FRAME_GEOM_LIMIT = 80;
const TEMP_MAT4 = new THREE.Matrix4();
const DEFAULT_CLEAR_HEX = 0xd6dce4;
const GROUND_DISTANCE = 200;
const PLANE_SIZE_EPS = 1e-9;
const RENDER_ORDER = Object.freeze({
  GROUND: -50,
});
const HAZE_TMP_HEAD = new THREE.Vector3();
const HAZE_TMP_PLANE_POS = new THREE.Vector3();
const HAZE_TMP_NORMAL = new THREE.Vector3();
const HAZE_TMP_DELTA = new THREE.Vector3();
const HAZE_TMP_MAT_HEAD = new THREE.Matrix4();
const HAZE_TMP_MAT_SCALE = new THREE.Matrix4();
const HAZE_TMP_MAT_ROT = new THREE.Matrix4();
const HAZE_TMP_MAT_LOCAL_T = new THREE.Matrix4();
const HAZE_TMP_MAT_LOCAL_S = new THREE.Matrix4();
const HAZE_TMP_MAT_FINAL = new THREE.Matrix4();
const LIGHT_TMP_DIR = new THREE.Vector3();
const LIGHT_TMP_QUAT = new THREE.Quaternion();

function warnLogEnabled() {
  try {
    if (typeof window !== 'undefined') {
      return window.PLAY_VERBOSE_DEBUG === true;
    }
  } catch {}
  return false;
}

function warnLog(message, ...extra) {
  if (!warnLogEnabled()) return;
  try {
    console.warn(message, ...extra);
  } catch {}
}

function isMatrixLike(value) {
  return value && typeof value.copy === 'function';
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

function geomNameFromLookup(lookup, index) {
  if (lookup && lookup.has(index)) {
    return lookup.get(index);
  }
  return `Geom ${index}`;
}

function pushSkyDebug(ctx, payload) {
  try {
    const log = ctx?._skyDebug || (ctx._skyDebug = []);
    log.push({ ts: Date.now(), ...payload });
    if (log.length > 40) log.shift();
    if (typeof window !== 'undefined') {
      window.__skyDebug = log;
    }
  } catch {}
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
    userData.geomSize = meta.size;
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
    userData.geomRgba = meta.rgba;
  }
  userData.geomMetadata = {
    index: meta.index,
    type: meta.type,
    name: meta.name,
    bodyId: meta.bodyId,
    matId: meta.matId,
    dataId: meta.dataId,
    size: meta.size,
    grid: meta.grid,
    groupId: meta.groupId,
    rgba: meta.rgba,
  };
}

function applySkyboxVisibility(ctx, enabled, options = {}) {
  if (!ctx) return;
  const worldScene = getWorldScene(ctx);
  if (!worldScene) return;
  const useBlackBackground = options.useBlackOnDisable !== false;
  const skyEnabled = enabled !== false;
  if (!skyEnabled) {
    if (ctx.skyShader) ctx.skyShader.visible = false;
    worldScene.environment = null;
    worldScene.background = new THREE.Color(useBlackBackground ? 0x000000 : DEFAULT_CLEAR_HEX);
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
  // If no sky resources exist, fall back to a solid clear colour
  worldScene.background = new THREE.Color(DEFAULT_CLEAR_HEX);
  pushSkyDebug(ctx, { mode: 'fallback' });
}


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
    } catch {}
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

function rgbaToHex(color, fallback = 0xffffff) {
  const vec = parseVectorLike(color);
  if (!Array.isArray(vec) || vec.length < 3) return fallback;
  const [r, g, b] = rgbFromArray(vec);
  const toByte = (value) => Math.max(0, Math.min(255, Math.round(value * 255)));
  return (toByte(r) << 16) | (toByte(g) << 8) | toByte(b);
}

function alphaFromArray(color, fallback = 1) {
  const source = parseVectorLike(color);
  if (Array.isArray(source) && source.length >= 4) {
    const a = Number(source[3]);
    if (Number.isFinite(a)) {
      return clampUnit(a);
    }
  }
  return clampUnit(fallback);
}

function resolveGeomAppearance(index, sceneGeom, snapshot, assets) {
  if (sceneGeom && Array.isArray(sceneGeom.rgba)) {
    return {
      rgba: sceneGeom.rgba.slice(),
      color: rgbFromArray(sceneGeom.rgba),
      opacity: alphaFromArray(sceneGeom.rgba),
    };
  }
  const matIdView = snapshot.gmatid || assets?.geoms?.matid || null;
  const matIndex = matIdView && index < matIdView.length ? matIdView[index] : -1;
  const matRgbaView = assets?.materials?.rgba || snapshot.matrgba || null;
  const geomRgbaView = assets?.geoms?.rgba || null;
  if (matIndex >= 0 && matRgbaView && matRgbaView.length >= (matIndex * 4 + 4)) {
    const rgba = [
      matRgbaView[matIndex * 4 + 0],
      matRgbaView[matIndex * 4 + 1],
      matRgbaView[matIndex * 4 + 2],
      matRgbaView[matIndex * 4 + 3],
    ];
    return {
      rgba,
      color: rgbFromArray(rgba),
      opacity: alphaFromArray(rgba),
    };
  }
  if (matIndex < 0 && geomRgbaView && geomRgbaView.length >= ((index * 4) + 4)) {
    const base = index * 4;
    const rgba = [
      geomRgbaView[base + 0],
      geomRgbaView[base + 1],
      geomRgbaView[base + 2],
      geomRgbaView[base + 3],
    ];
    return {
      rgba,
      color: rgbFromArray(rgba),
      opacity: alphaFromArray(rgba),
    };
  }
  return { rgba: null, color: null, opacity: null };
}

function applyAppearanceToMaterial(mesh, appearance) {
  if (!mesh || !mesh.material || !appearance) return;
  const { color, opacity } = appearance;
  if (color && mesh.material.color && typeof mesh.material.color.setRGB === 'function') {
    mesh.material.color.setRGB(Math.max(0, color[0]), Math.max(0, color[1]), Math.max(0, color[2]));
  }
  if ('opacity' in mesh.material && opacity != null) {
    mesh.material.opacity = opacity;
    mesh.material.transparent = opacity < 0.999;
  }
  if ('needsUpdate' in mesh.material) {
    mesh.material.needsUpdate = true;
  }
  const userData = mesh.userData || (mesh.userData = {});
  if (appearance.rgba) {
    userData.geomRgba = appearance.rgba.slice();
    userData.geomOpacity = opacity;
  }
}

function averageRGB(arr) {
  if (!Array.isArray(arr) || arr.length === 0) return 0;
  return arr.reduce((acc, v) => acc + (Number(v) || 0), 0) / arr.length;
}

function computeSceneExtent(bounds, statStruct) {
  const fromBounds = Number(bounds?.radius);
  const fromStat = Number(statStruct?.extent);
  if (Number.isFinite(fromBounds) && fromBounds > 0) return fromBounds;
  if (Number.isFinite(fromStat) && fromStat > 0) return fromStat;
  return 1;
}

function resolveFogConfig(vis, statStruct, bounds, enabled) {
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
  const colorArr = rgbFromArray(vis?.rgba?.fog, [0.7, 0.75, 0.85]);
  const fogColor = new THREE.Color().setRGB(colorArr[0], colorArr[1], colorArr[2]);
  return {
    enabled: true,
    start: fogStart,
    end: fogEnd,
    color: fogColor,
    bgStrength: 0.65,
  };
}

function applySceneFog(scene, config) {
  if (!scene) return;
  if (!config?.enabled) {
    scene.fog = null;
    return;
  }
  const fogColor = config.color || new THREE.Color(DEFAULT_CLEAR_HEX);
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
      // When returning from fixed cameras, restore the saved free pose.
      // When returning from tracking (mode 1), keep the current camera pose
      // and simply stop tracking so the transition stays lightweight.
      if (desired === 0 && previous >= FIXED_CAMERA_OFFSET) {
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
  if (ctx.light) {
    ctx.light.intensity = active ? Math.max(0.05, averageRGB(diffuseRGB) * 3) : 0;
    ctx.light.color.setRGB(diffuseRGB[0], diffuseRGB[1], diffuseRGB[2]);
  }
  if (ctx.fill) {
    ctx.fill.intensity = active ? Math.max(0.05, averageRGB(diffuseRGB) * 1.0) : 0;
    ctx.fill.color.setRGB(diffuseRGB[0], diffuseRGB[1], diffuseRGB[2]);
  }
  if (ctx.ambient) {
    ctx.ambient.intensity = active ? Math.max(0.0, averageRGB(ambientRGB)) : 0;
    ctx.ambient.color.setRGB(ambientRGB[0], ambientRGB[1], ambientRGB[2]);
  }
  if (ctx.hemi) {
    const hemiStrength = Math.max(0.0, averageRGB(ambientRGB));
    ctx.hemi.intensity = active ? hemiStrength : 0;
    ctx.hemi.color.setRGB(diffuseRGB[0], diffuseRGB[1], diffuseRGB[2]);
    ctx.hemi.groundColor.setRGB(ambientRGB[0], ambientRGB[1], ambientRGB[2]);
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

function scaleAllFactor(state) {
  const value = Number(state?.model?.vis?.scale?.all);
  if (Number.isFinite(value) && value > 1e-6) return value;
  return 1;
}

function voptEnabled(flags, idx) {
  return Array.isArray(flags) && idx >= 0 && !!flags[idx];
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
    const presetMode = (state?.visualSourceMode ?? 'model') === 'preset';
    const skyboxFlag = sceneFlags[4] !== false;
    const shadowEnabled = segmentEnabled ? false : sceneFlags[0] !== false;
    const reflectionEnabled = segmentEnabled ? false : sceneFlags[2] !== false;
    const skyboxEnabled = !segmentEnabled && skyboxFlag;
    const fogEnabled = segmentEnabled ? false : !!sceneFlags[5];
    const hazeEnabled = segmentEnabled ? false : !!sceneFlags[6];
    const hideAllGeometry = !!state.rendering?.hideAllGeometry;
    // ID color / additive / cullFace can be extended later; keep false by default for now.
    const idColorEnabled = false;
    const additiveEnabled = false;
      const cullFaceEnabled = true;
      return {
        sceneFlags,
        voptFlags,
      segmentEnabled,
      skyboxEnabled,
      shadowEnabled,
      reflectionEnabled,
      fogEnabled,
      hazeEnabled,
      cullFaceEnabled,
      idColorEnabled,
      additiveEnabled,
        presetMode,
        hideAllGeometry,
      };
    }

  function isSceneDebugEnabled(state = null) {
    if (state?.debugMode === true || state?.rendering?.debugMode === true) return true;
    if (typeof window !== 'undefined') {
      try {
        if (window.PLAY_VERBOSE_DEBUG === true) return true;
        if (window.__PLAY_SCENE_DEBUG === true) return true;
      } catch {}
    }
    return false;
  }

  function debugSceneDescriptors(ctx, payload) {
    if (!ctx) return;
    ctx.lastSceneDebug = payload;
    if (typeof window === 'undefined') return;
    try {
      window.__sceneDescriptors = payload;
    } catch {}
  }

function warnOnce(cache, key, message) {
  if (!warnLogEnabled()) return;
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
    const worldScene = getWorldScene(context);
    if (worldScene) worldScene.add(context.labelGroup);
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
  const labelGroup = ensureLabelGroup(context);
  const pool = context.labelPool;
  const labelHeight = LABEL_DEFAULT_HEIGHT;
  const verticalOffset = LABEL_DEFAULT_OFFSET;
  const camera = context.camera;
  const maxLabels = LABEL_GEOM_LIMIT;
  let used = 0;

  const emitLabel = (px, py, pz, label) => {
    if (!Number.isFinite(px) || !Number.isFinite(py) || !Number.isFinite(pz)) return;
    if (!label || used >= maxLabels) return;
    let quality = LABEL_LOD_FACTORS.far;
    if (camera) {
      const dist = camera.position.distanceTo(__TMP_VEC3.set(px, py, pz));
      if (dist < LABEL_LOD_NEAR) quality = LABEL_LOD_FACTORS.near;
      else if (dist < LABEL_LOD_MID) quality = LABEL_LOD_FACTORS.mid;
    }
    const texture = getLabelTexture(label, quality);
    if (!texture) return;
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
  };

  if (mode === LABEL_MODES.GEOM) {
    const ngeom = snapshot.ngeom | 0;
    const xpos = snapshot.xpos;
    const xmat = snapshot.xmat;
    if (!(ngeom > 0) || !xpos || !xmat) {
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
    const typeView = options.typeView;
    const limit = Math.min(ngeom, maxLabels);
    for (let i = 0; i < limit; i += 1) {
      if (!shouldDisplayGeom(i, options)) continue;
      const base = 3 * i;
      const px = Number(xpos[base + 0]);
      const py = Number(xpos[base + 1]);
      const pz = Number(xpos[base + 2]);
      const geomType = Number(typeView?.[i]);
      if (geomType === MJ_GEOM.PLANE || geomType === MJ_GEOM.HFIELD) continue;
      const meshForGeom = Array.isArray(context.meshes) ? context.meshes[i] : null;
      const label = meshForGeom?.userData?.geomName || nameByIndex.get(i) || `Geom ${i}`;
      emitLabel(px, py, pz, label);
    }
  } else if (mode === LABEL_MODES.BODY) {
    const bxpos = snapshot.bxpos;
    const nbody = bxpos ? Math.floor(bxpos.length / 3) : 0;
    if (!bxpos || nbody <= 1) {
      hideLabelGroup(context);
      return;
    }
    // Skip world body 0
    const limit = Math.min(nbody, maxLabels + 1);
    for (let i = 1; i < limit; i += 1) {
      const base = 3 * i;
      const px = Number(bxpos[base + 0]) || 0;
      const py = Number(bxpos[base + 1]) || 0;
      const pz = Number(bxpos[base + 2]) || 0;
      const label = `Body ${i}`;
      emitLabel(px, py, pz, label);
    }
  } else if (mode === LABEL_MODES.SITE) {
    const siteXpos = snapshot.site_xpos;
    const nsite = siteXpos ? Math.floor(siteXpos.length / 3) : 0;
    if (!siteXpos || nsite <= 0) {
      hideLabelGroup(context);
      return;
    }
    const limit = Math.min(nsite, maxLabels);
    for (let i = 0; i < limit; i += 1) {
      const base = 3 * i;
      const px = Number(siteXpos[base + 0]) || 0;
      const py = Number(siteXpos[base + 1]) || 0;
      const pz = Number(siteXpos[base + 2]) || 0;
      const label = `Site ${i}`;
      emitLabel(px, py, pz, label);
    }
  } else if (mode === LABEL_MODES.JOINT) {
    const jpos = snapshot.jpos;
    const jbody = snapshot.jbody;
    const bxpos = snapshot.bxpos;
    const bxmat = snapshot.bxmat;
    const jntNames = Array.isArray(snapshot.jnt_names) ? snapshot.jnt_names : null;
    if (!jpos || !jbody || !bxpos || !bxmat) {
      hideLabelGroup(context);
      return;
    }
    const nj = Math.floor(jpos.length / 3);
    const nbody = Math.floor(bxpos.length / 3);
    const limit = Math.min(nj, maxLabels);
    for (let i = 0; i < limit; i += 1) {
      const bodyId = Number(jbody[i]) || 0;
      if (bodyId < 0 || bodyId >= nbody) continue;
      const base = 3 * i;
      const bodyPos = __TMP_VEC3_A.set(
        Number(bxpos[3 * bodyId + 0]) || 0,
        Number(bxpos[3 * bodyId + 1]) || 0,
        Number(bxpos[3 * bodyId + 2]) || 0,
      );
      const bodyMat = TEMP_MAT4.set(
        bxmat?.[9 * bodyId + 0] ?? 1, bxmat?.[9 * bodyId + 1] ?? 0, bxmat?.[9 * bodyId + 2] ?? 0, 0,
        bxmat?.[9 * bodyId + 3] ?? 0, bxmat?.[9 * bodyId + 4] ?? 1, bxmat?.[9 * bodyId + 5] ?? 0, 0,
        bxmat?.[9 * bodyId + 6] ?? 0, bxmat?.[9 * bodyId + 7] ?? 0, bxmat?.[9 * bodyId + 8] ?? 1, 0,
        0, 0, 0, 1,
      );
      const localAnchor = __TMP_VEC3_B.set(
        Number(jpos[base + 0]) || 0,
        Number(jpos[base + 1]) || 0,
        Number(jpos[base + 2]) || 0,
      );
      const worldAnchor = localAnchor.clone().applyMatrix4(bodyMat).add(bodyPos);
      const label = jntNames && jntNames[i] ? String(jntNames[i]) : `jnt ${i}`;
      emitLabel(worldAnchor.x, worldAnchor.y, worldAnchor.z, label);
    }
  } else {
    hideLabelGroup(context);
    warnOnce(LABEL_MODE_WARNINGS, mode, '[render] Label mode not yet supported in viewer (pending data)');
    return;
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
    const worldScene = getWorldScene(context);
    if (worldScene) worldScene.add(context.frameGroup);
    context.framePool = [];
  }
  return context.frameGroup;
}

function ensureCameraGroup(ctx) {
  if (!ctx.cameraGroup) {
    const group = new THREE.Group();
    group.name = 'overlay:cameras';
    const world = getWorldScene(ctx);
    if (world) world.add(group);
    ctx.cameraGroup = group;
    ctx.cameraPool = [];
  }
  return ctx.cameraGroup;
}

function ensureLightGroup(ctx) {
  if (!ctx.lightGroup) {
    const group = new THREE.Group();
    group.name = 'overlay:lights';
    const world = getWorldScene(ctx);
    if (world) world.add(group);
    ctx.lightGroup = group;
    ctx.lightPool = [];
  }
  return ctx.lightGroup;
}

function ensureComGroup(ctx) {
  if (!ctx.comGroup) {
    const group = new THREE.Group();
    group.name = 'overlay:com';
    const world = getWorldScene(ctx);
    if (world) world.add(group);
    ctx.comGroup = group;
    ctx.comPool = [];
  }
  return ctx.comGroup;
}

function ensureJointGroup(ctx) {
  if (!ctx.jointGroup) {
    const group = new THREE.Group();
    group.name = 'overlay:joints';
    const world = getWorldScene(ctx);
    if (world) world.add(group);
    ctx.jointGroup = group;
    ctx.jointPool = [];
  }
  return ctx.jointGroup;
}

function ensureActuatorGroup(ctx) {
  if (!ctx.actuatorGroup) {
    const group = new THREE.Group();
    group.name = 'overlay:actuators';
    const world = getWorldScene(ctx);
    if (world) world.add(group);
    ctx.actuatorGroup = group;
    ctx.actuatorPool = [];
  }
  return ctx.actuatorGroup;
}

function ensureSlidercrankGroup(ctx) {
  if (!ctx.slidercrankGroup) {
    const group = new THREE.Group();
    group.name = 'overlay:slidercrank';
    const world = getWorldScene(ctx);
    if (world) world.add(group);
    ctx.slidercrankGroup = group;
    ctx.slidercrankPool = [];
  }
  return ctx.slidercrankGroup;
}

function ensureRangefinderGroup(ctx) {
  if (!ctx.rangefinderGroup) {
    const group = new THREE.Group();
    group.name = 'overlay:rangefinder';
    const world = getWorldScene(ctx);
    if (world) world.add(group);
    ctx.rangefinderGroup = group;
    ctx.rangefinderPool = [];
  }
  return ctx.rangefinderGroup;
}

function ensureConstraintGroup(ctx) {
  if (!ctx.constraintGroup) {
    const group = new THREE.Group();
    group.name = 'overlay:constraints';
    const world = getWorldScene(ctx);
    if (world) world.add(group);
    ctx.constraintGroup = group;
    ctx.constraintPool = [];
  }
  return ctx.constraintGroup;
}

function ensureSelectionGroup(ctx) {
  if (!ctx) return null;
  if (!ctx.selectionGroup) {
    const group = new THREE.Group();
    group.name = 'overlay:selection';
    const world = getWorldScene(ctx);
    if (world) world.add(group);
    ctx.selectionGroup = group;
  }
  return ctx.selectionGroup;
}

function ensureContactGroup(ctx) {
  if (!ctx) return null;
  if (!ctx.contactGroup) {
    const group = new THREE.Group();
    group.name = 'overlay:contacts';
    const world = getWorldScene(ctx);
    if (world) world.add(group);
    ctx.contactGroup = group;
    if (!Array.isArray(ctx.contactPool)) {
      ctx.contactPool = [];
    }
  }
  return ctx.contactGroup;
}

function ensureContactForceGroup(ctx) {
  if (!ctx) return null;
  if (!ctx.contactForceGroup) {
    const group = new THREE.Group();
    group.name = 'overlay:contactForces';
    const world = getWorldScene(ctx);
    if (world) world.add(group);
    ctx.contactForceGroup = group;
    if (!Array.isArray(ctx.contactForcePool)) {
      ctx.contactForcePool = [];
    }
  }
  return ctx.contactForceGroup;
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

function hideCameraGroup(ctx) {
  if (Array.isArray(ctx?.cameraPool)) {
    ctx.cameraPool.forEach((mesh) => { if (mesh) mesh.visible = false; });
  }
  if (ctx?.cameraGroup) ctx.cameraGroup.visible = false;
}

function hideLightGroup(ctx) {
  if (Array.isArray(ctx?.lightPool)) {
    ctx.lightPool.forEach((mesh) => { if (mesh) mesh.visible = false; });
  }
  if (ctx?.lightGroup) ctx.lightGroup.visible = false;
}

function hideComGroup(ctx) {
  if (Array.isArray(ctx?.comPool)) {
    ctx.comPool.forEach((mesh) => { if (mesh) mesh.visible = false; });
  }
  if (ctx?.comGroup) ctx.comGroup.visible = false;
}

function hideJointGroup(ctx) {
  if (Array.isArray(ctx?.jointPool)) {
    ctx.jointPool.forEach((mesh) => { if (mesh) mesh.visible = false; });
  }
  if (ctx?.jointGroup) ctx.jointGroup.visible = false;
}

function hideActuatorGroup(ctx) {
  if (Array.isArray(ctx?.actuatorPool)) {
    ctx.actuatorPool.forEach((mesh) => { if (mesh) mesh.visible = false; });
  }
  if (ctx?.actuatorGroup) ctx.actuatorGroup.visible = false;
}

function hideSlidercrankGroup(ctx) {
  if (Array.isArray(ctx?.slidercrankPool)) {
    ctx.slidercrankPool.forEach((mesh) => { if (mesh) mesh.visible = false; });
  }
  if (ctx?.slidercrankGroup) ctx.slidercrankGroup.visible = false;
}

function hideRangefinderGroup(ctx) {
  if (Array.isArray(ctx?.rangefinderPool)) {
    ctx.rangefinderPool.forEach((line) => { if (line) line.visible = false; });
  }
  if (ctx?.rangefinderGroup) ctx.rangefinderGroup.visible = false;
}

function hideConstraintGroup(ctx) {
  if (Array.isArray(ctx?.constraintPool)) {
    ctx.constraintPool.forEach((mesh) => { if (mesh) mesh.visible = false; });
  }
  if (ctx?.constraintGroup) ctx.constraintGroup.visible = false;
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
    const { meanSize, scaleAll } = computeMeanScale(state, context);
    if (!Number.isFinite(context.frameBaseMeanSize) || context.frameBaseMeanSize <= 0) {
      context.frameBaseMeanSize = Number.isFinite(meanSize) && meanSize > 0 ? meanSize : 1;
    }
  const baseMeanSize = Number.isFinite(context.frameBaseMeanSize) && context.frameBaseMeanSize > 0
    ? context.frameBaseMeanSize
    : 1;
  const meanScale = Number.isFinite(meanSize) && meanSize > 0
    ? (meanSize / baseMeanSize)
      : 1;
    const scaleStruct = state?.model?.vis?.scale || {};
  const frameLengthScale = Number.isFinite(Number(scaleStruct.framelength)) && Number(scaleStruct.framelength) > 0
    ? Number(scaleStruct.framelength)
    : 1;
  const frameWidthScale = Number.isFinite(Number(scaleStruct.framewidth)) && Number(scaleStruct.framewidth) > 0
    ? Number(scaleStruct.framewidth)
    : 1;
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
      const axisScale = overlayScale(radius, 0.12, 0.1, 3) * 0.25 * scaleAll * frameLengthScale * meanScale;
      helper.scale.set(axisScale, axisScale, axisScale);
      if (helper.material && 'linewidth' in helper.material) {
        helper.material.linewidth = frameWidthScale * scaleAll * meanScale;
      }
    }
  } else if (mode === FRAME_MODES.BODY) {
    const bxpos = snapshot.bxpos;
    const bxmat = snapshot.bxmat;
    const nbody = bxpos ? Math.floor(bxpos.length / 3) : 0;
    if (!bxpos || !bxmat || nbody <= 1) {
      hideFrameGroup(context);
      return;
    }
    const limit = Math.min(nbody, FRAME_GEOM_LIMIT + 1);
    for (let i = 1; i < limit; i += 1) {
      const base = 3 * i;
      const px = Number(bxpos[base + 0]) || 0;
      const py = Number(bxpos[base + 1]) || 0;
      const pz = Number(bxpos[base + 2]) || 0;
      const helper = addHelper();
      helper.position.set(px, py, pz);
      const matBase = 9 * i;
      const rot = [
        bxmat?.[matBase + 0] ?? 1,
        bxmat?.[matBase + 1] ?? 0,
        bxmat?.[matBase + 2] ?? 0,
        bxmat?.[matBase + 3] ?? 0,
        bxmat?.[matBase + 4] ?? 1,
        bxmat?.[matBase + 5] ?? 0,
        bxmat?.[matBase + 6] ?? 0,
        bxmat?.[matBase + 7] ?? 0,
        bxmat?.[matBase + 8] ?? 1,
      ];
      TEMP_MAT4.set(
        rot[0], rot[1], rot[2], 0,
        rot[3], rot[4], rot[5], 0,
        rot[6], rot[7], rot[8], 0,
        0, 0, 0, 1,
      );
      helper.quaternion.setFromRotationMatrix(TEMP_MAT4);
      const axisScale = overlayScale(radius, 0.12, 0.1, 3) * 0.25 * scaleAll * frameLengthScale * meanScale;
      helper.scale.set(axisScale, axisScale, axisScale);
      if (helper.material && 'linewidth' in helper.material) {
        helper.material.linewidth = frameWidthScale * scaleAll * meanScale;
      }
    }
  } else if (mode === FRAME_MODES.SITE) {
    const siteXpos = snapshot.site_xpos;
    const siteXmat = snapshot.site_xmat;
    const nsite = siteXpos ? Math.floor(siteXpos.length / 3) : 0;
    if (!siteXpos || !siteXmat || nsite <= 0) {
      hideFrameGroup(context);
      return;
    }
    const limit = Math.min(nsite, FRAME_GEOM_LIMIT);
    for (let i = 0; i < limit; i += 1) {
      const base = 3 * i;
      const px = Number(siteXpos[base + 0]) || 0;
      const py = Number(siteXpos[base + 1]) || 0;
      const pz = Number(siteXpos[base + 2]) || 0;
      const helper = addHelper();
      helper.position.set(px, py, pz);
      const rotBase = 9 * i;
      const rot = [
        siteXmat?.[rotBase + 0] ?? 1,
        siteXmat?.[rotBase + 1] ?? 0,
        siteXmat?.[rotBase + 2] ?? 0,
        siteXmat?.[rotBase + 3] ?? 0,
        siteXmat?.[rotBase + 4] ?? 1,
        siteXmat?.[rotBase + 5] ?? 0,
        siteXmat?.[rotBase + 6] ?? 0,
        siteXmat?.[rotBase + 7] ?? 0,
        siteXmat?.[rotBase + 8] ?? 1,
      ];
      TEMP_MAT4.set(
        rot[0], rot[1], rot[2], 0,
        rot[3], rot[4], rot[5], 0,
        rot[6], rot[7], rot[8], 0,
        0, 0, 0, 1,
      );
      helper.quaternion.setFromRotationMatrix(TEMP_MAT4);
      const axisScale = overlayScale(radius, 0.12, 0.1, 3) * 0.25 * scaleAll * frameLengthScale * meanScale;
      helper.scale.set(axisScale, axisScale, axisScale);
      if (helper.material && 'linewidth' in helper.material) {
        helper.material.linewidth = frameWidthScale * scaleAll * meanScale;
      }
    }
  } else if (mode === FRAME_MODES.WORLD) {
    const helper = addHelper();
    // Lift world frame slightly above ground to avoid z-fighting
    helper.position.set(0, 0, 0.01);
    helper.quaternion.set(0, 0, 0, 1);
    const axisScale = overlayScale(radius, 0.25, 0.5, 5) * scaleAll * frameLengthScale * meanScale;
    helper.scale.set(axisScale, axisScale, axisScale);
    if (helper.material && 'linewidth' in helper.material) {
      helper.material.linewidth = frameWidthScale * scaleAll * meanScale;
    }
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

function updateRangefinderOverlays(ctx, snapshot, state) {
  const sensorType = snapshot?.sensor_type;
  const sensorObj = snapshot?.sensor_objid;
  const sensordata = snapshot?.sensordata;
  const siteXpos = snapshot?.site_xpos;
  const siteXmat = snapshot?.site_xmat;
  if (!sensorType || !sensorObj || !sensordata || !siteXpos || !siteXmat) {
    hideRangefinderGroup(ctx);
    return;
  }
  const ns = Math.floor(siteXpos.length / 3);
  const group = ensureRangefinderGroup(ctx);
  const pool = ctx.rangefinderPool || (ctx.rangefinderPool = []);
  const visRgba = state?.model?.vis?.rgba || {};
  const colorHex = rgbaToHex(visRgba.rangefinder, 0xffff66);
  const opacity = alphaFromArray(visRgba.rangefinder, 1);
  let used = 0;
  const addLine = () => {
    let line = pool[used];
    if (!line) {
      const geom = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(0, 0, 1),
      ]);
      const mat = new THREE.LineBasicMaterial({
        color: colorHex,
        transparent: opacity < 0.999,
        opacity,
        depthWrite: false,
        fog: false,
      });
      line = new THREE.Line(geom, mat);
      line.renderOrder = 49;
      pool[used] = line;
      group.add(line);
    }
    line.visible = true;
    used += 1;
    return line;
  };
  const count = Math.min(sensorType.length, sensorObj.length, sensordata.length);
  for (let i = 0; i < count; i += 1) {
    const stype = Number(sensorType[i]) | 0;
    if (stype !== MJ_SENSOR.RANGEFINDER) continue;
    const sid = Number(sensorObj[i]) | 0;
    if (sid < 0 || sid >= ns) continue;
    const dist = Number(sensordata[i]) || 0;
    if (!(dist > 0)) continue;
    const base = 3 * sid;
    const pos = PERTURB_TEMP_ANCHOR.set(
      Number(siteXpos[base + 0]) || 0,
      Number(siteXpos[base + 1]) || 0,
      Number(siteXpos[base + 2]) || 0,
    );
    const rotBase = 9 * sid;
    const rot = [
      siteXmat?.[rotBase + 0] ?? 1, siteXmat?.[rotBase + 1] ?? 0, siteXmat?.[rotBase + 2] ?? 0,
      siteXmat?.[rotBase + 3] ?? 0, siteXmat?.[rotBase + 4] ?? 1, siteXmat?.[rotBase + 5] ?? 0,
      siteXmat?.[rotBase + 6] ?? 0, siteXmat?.[rotBase + 7] ?? 0, siteXmat?.[rotBase + 8] ?? 1,
    ];
    TEMP_MAT4.set(
      rot[0], rot[1], rot[2], 0,
      rot[3], rot[4], rot[5], 0,
      rot[6], rot[7], rot[8], 0,
      0, 0, 0, 1,
    );
    const forward = PERTURB_TEMP_VEC.set(0, 0, 1).applyMatrix4(TEMP_MAT4).normalize();
    const to = PERTURB_TEMP_VEC2.copy(forward).multiplyScalar(dist).add(pos);
    const line = addLine();
    if (line.geometry?.attributes?.position) {
      const attr = line.geometry.attributes.position;
      attr.setXYZ(0, pos.x, pos.y, pos.z);
      attr.setXYZ(1, to.x, to.y, to.z);
      attr.needsUpdate = true;
      line.geometry.computeBoundingSphere?.();
    }
    if (line.material) {
      line.material.color.setHex(colorHex);
      line.material.opacity = opacity;
      line.material.transparent = opacity < 0.999;
      line.material.needsUpdate = true;
    }
  }
  for (let i = used; i < pool.length; i += 1) {
    if (pool[i]) pool[i].visible = false;
  }
  group.visible = used > 0;
}

function updateConstraintOverlays(ctx, snapshot, state) {
  const eqType = snapshot?.eq_type;
  const eqObj1 = snapshot?.eq_obj1id;
  const eqObj2 = snapshot?.eq_obj2id;
  const eqObjType = snapshot?.eq_objtype;
  const eqActive = snapshot?.eq_active;
  const bxpos = snapshot?.bxpos;
  const bxmat = snapshot?.bxmat;
  const siteXpos = snapshot?.site_xpos;
  const siteXmat = snapshot?.site_xmat;
  if (!eqType || !eqObj1 || !eqObj2 || !eqObjType) {
    hideConstraintGroup(ctx);
    return;
  }
  const group = ensureConstraintGroup(ctx);
  const pool = ctx.constraintPool || (ctx.constraintPool = []);
  const visScale = state?.model?.vis?.scale || {};
  const visRgba = state?.model?.vis?.rgba || {};
  const { meanSize, scaleAll } = computeMeanScale(state, ctx);
  const radiusConst = Math.max(1e-4, meanSize * 0.03 * Math.max(Number(visScale.constraint) || 1, 1e-6) * scaleAll);
  const radiusConnect = Math.max(1e-4, meanSize * 0.03 * Math.max(Number(visScale.connect) || 1, 1e-6) * scaleAll);
  const colorConnect = rgbaToHex(visRgba.connect, 0x3344dd);
  const colorConstraint = rgbaToHex(visRgba.constraint, 0xdd3333);
  const opacityConnect = alphaFromArray(visRgba.connect, 1);
  const opacityConstraint = alphaFromArray(visRgba.constraint, 1);
  const neq = Math.min(eqType.length, eqObj1.length, eqObj2.length, eqObjType.length);
  const nsite = siteXpos ? Math.floor(siteXpos.length / 3) : 0;
  const nbody = bxpos ? Math.floor(bxpos.length / 3) : 0;
  let used = 0;
  const addSphere = () => {
    let mesh = pool[used];
    if (!mesh) {
      const mat = new THREE.MeshBasicMaterial({
        color: colorConnect,
        transparent: true,
        opacity: 1,
        depthWrite: false,
        toneMapped: false,
        fog: false,
      });
      mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), mat);
      mesh.renderOrder = 48;
      pool[used] = mesh;
      group.add(mesh);
    }
    mesh.visible = true;
    used += 1;
    return mesh;
  };
  const getPose = (objType, objId) => {
    if (objType === MJ_OBJ.SITE && objId >= 0 && objId < nsite && siteXpos) {
      const base = 3 * objId;
      const pos = PERTURB_TEMP_ANCHOR.set(
        Number(siteXpos[base + 0]) || 0,
        Number(siteXpos[base + 1]) || 0,
        Number(siteXpos[base + 2]) || 0,
      );
      return { pos };
    }
    if (objType === MJ_OBJ.BODY && objId >= 0 && objId < nbody && bxpos) {
      const base = 3 * objId;
      const pos = PERTURB_TEMP_ANCHOR.set(
        Number(bxpos[base + 0]) || 0,
        Number(bxpos[base + 1]) || 0,
        Number(bxpos[base + 2]) || 0,
      );
      return { pos };
    }
    return null;
  };
  for (let i = 0; i < neq; i += 1) {
    const active = !eqActive || !!eqActive[i];
    if (!active) continue;
    const t = Number(eqType[i]) | 0;
    if (t !== MJ_EQ.CONNECT && t !== MJ_EQ.WELD) continue;
    const objType = Number(eqObjType[i]) | 0;
    const id1 = Number(eqObj1[i]) | 0;
    const id2 = Number(eqObj2[i]) | 0;
    const pose1 = getPose(objType, id1);
    const pose2 = getPose(objType, id2);
    if (!pose1 || !pose2) continue;
    const p1 = pose1.pos.clone();
    const p2 = pose2.pos.clone();
    const rConnect = radiusConnect;
    const rConstraint = radiusConst;
    // First endpoint: "connect" color
    const s1 = addSphere();
    s1.position.copy(p1);
    s1.scale.set(rConnect, rConnect, rConnect);
    if (s1.material) {
      s1.material.color.setHex(colorConnect);
      s1.material.opacity = opacityConnect;
      s1.material.transparent = opacityConnect < 0.999;
      s1.material.needsUpdate = true;
    }
    // Second endpoint: "constraint" color
    const s2 = addSphere();
    s2.position.copy(p2);
    s2.scale.set(rConstraint, rConstraint, rConstraint);
    if (s2.material) {
      s2.material.color.setHex(colorConstraint);
      s2.material.opacity = opacityConstraint;
      s2.material.transparent = opacityConstraint < 0.999;
      s2.material.needsUpdate = true;
    }
  }
  for (let i = used; i < pool.length; i += 1) {
    if (pool[i]) pool[i].visible = false;
  }
  group.visible = used > 0;
}

function updateLightOverlays(ctx, snapshot, state) {
  const pos = snapshot?.light_xpos;
  const dir = snapshot?.light_xdir;
  if (!pos || !dir || pos.length < 3 || dir.length < 3) {
    hideLightGroup(ctx);
    return;
  }
  const group = ensureLightGroup(ctx);
  const pool = ctx.lightPool || (ctx.lightPool = []);
  const visScale = state?.model?.vis?.scale || {};
  const visRgba = state?.model?.vis?.rgba || {};
  const { meanSize, scaleAll } = computeMeanScale(state, ctx);
  const sizeScale = Math.max(1e-6, Number(visScale.light) || 1) * scaleAll;
  const colorHex = rgbaToHex(visRgba.light, 0x8899ff);
  const opacity = alphaFromArray(visRgba.light, 1);
  const count = Math.floor(pos.length / 3);
  let used = 0;
  const addMesh = () => {
    let mesh = pool[used];
    if (!mesh) {
      const mat = new THREE.MeshBasicMaterial({
        color: colorHex,
        transparent: opacity < 0.999,
        opacity,
        depthWrite: false,
        toneMapped: false,
        fog: false,
      });
      mesh = new THREE.Mesh(LIGHT_GIZMO_GEOMETRY, mat);
      mesh.renderOrder = 54;
      pool[used] = mesh;
      group.add(mesh);
    }
    mesh.visible = true;
    used += 1;
    return mesh;
  };
  for (let i = 0; i < count; i += 1) {
    const mesh = addMesh();
    const base = 3 * i;
    const px = Number(pos[base + 0]) || 0;
    const py = Number(pos[base + 1]) || 0;
    const pz = Number(pos[base + 2]) || 0;
    const dirBase = 3 * i;
    LIGHT_TMP_DIR.set(
      Number(dir[dirBase + 0]) || 0,
      Number(dir[dirBase + 1]) || 0,
      Number(dir[dirBase + 2]) || 1,
    ).normalize();
    // Orient cylinder Y-axis along light direction (match mjv_quatZ2Vec + geom frame)
    LIGHT_TMP_QUAT.setFromUnitVectors(PERTURB_AXIS_DEFAULT, LIGHT_TMP_DIR);
    mesh.quaternion.copy(LIGHT_TMP_QUAT);
    // Offset gizmo slightly "behind" the light along -dir, similar to simulate
    const offset = Math.max(1e-4, meanSize * sizeScale);
    mesh.position.set(
      px - LIGHT_TMP_DIR.x * offset,
      py - LIGHT_TMP_DIR.y * offset,
      pz - LIGHT_TMP_DIR.z * offset,
    );
    const radius = Math.max(1e-4, meanSize * sizeScale * 0.8);
    const height = Math.max(1e-4, meanSize * sizeScale * 1.0);
    mesh.scale.set(radius, height, radius);
    if (mesh.material) {
      mesh.material.color.setHex(colorHex);
      mesh.material.opacity = opacity;
      mesh.material.transparent = opacity < 0.999;
      mesh.material.needsUpdate = true;
    }
  }
  for (let i = used; i < pool.length; i += 1) {
    if (pool[i]) pool[i].visible = false;
  }
  group.visible = used > 0;
}

function updateComOverlays(ctx, snapshot, state) {
  const xipos = snapshot?.xipos;
  if (!xipos || xipos.length < 3) {
    hideComGroup(ctx);
    return;
  }
  const group = ensureComGroup(ctx);
  const pool = ctx.comPool || (ctx.comPool = []);
  const visScale = state?.model?.vis?.scale || {};
  const visRgba = state?.model?.vis?.rgba || {};
  const { meanSize, scaleAll } = computeMeanScale(state, ctx);
  const sizeScale = Math.max(1e-6, Number(visScale.com) || 1) * scaleAll;
  const colorHex = rgbaToHex(visRgba.com, 0xe6e6e6);
  const opacity = alphaFromArray(visRgba.com, 1);
  const count = Math.floor(xipos.length / 3);
  const bodyParent = state?.model?.bodyParentId || null;
  let used = 0;
  const addMesh = () => {
    let mesh = pool[used];
    if (!mesh) {
      const mat = new THREE.MeshBasicMaterial({
        color: colorHex,
        transparent: opacity < 0.999,
        opacity,
        depthWrite: false,
        toneMapped: false,
        fog: false,
      });
      mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 14, 10), mat);
      mesh.renderOrder = 53;
      pool[used] = mesh;
      group.add(mesh);
    }
    mesh.visible = true;
    used += 1;
    return mesh;
  };
  const maxIndex = bodyParent && typeof bodyParent.length === 'number'
    ? Math.min(count, bodyParent.length)
    : count;
  for (let i = 1; i < maxIndex; i += 1) { // skip world body 0
    if (bodyParent && typeof bodyParent.length === 'number') {
      const parentId = Number(bodyParent[i]);
      // Only draw COM for “root” bodies (direct children of world), approximating subtree COM.
      if (Number.isFinite(parentId) && parentId !== 0) continue;
    }
    const mesh = addMesh();
    const base = 3 * i;
    mesh.position.set(
      Number(xipos[base + 0]) || 0,
      Number(xipos[base + 1]) || 0,
      Number(xipos[base + 2]) || 0,
    );
    const r = Math.max(1e-4, meanSize * sizeScale);
    mesh.scale.set(r, r, r);
    if (mesh.material) {
      mesh.material.color.setHex(colorHex);
      mesh.material.opacity = opacity;
      mesh.material.transparent = opacity < 0.999;
      mesh.material.needsUpdate = true;
    }
  }
  for (let i = used; i < pool.length; i += 1) {
    if (pool[i]) pool[i].visible = false;
  }
  group.visible = used > 0;
}
function createPerturbArrowNode(colorHex) {
  const material = new THREE.MeshBasicMaterial({
    color: colorHex,
    transparent: true,
    opacity: 0.8,
    depthWrite: false,
    toneMapped: false,
    fog: false,
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

function updateJointOverlays(ctx, snapshot, state) {
  const jpos = snapshot?.jpos;
  const jaxis = snapshot?.jaxis;
  const jtype = snapshot?.jtype;
  const jbody = snapshot?.jbody;
  const bxpos = snapshot?.bxpos;
  const bxmat = snapshot?.bxmat;
  if (!jpos || !jaxis || !jtype || !jbody || !bxpos || !bxmat) {
    hideJointGroup(ctx);
    return;
  }
  const group = ensureJointGroup(ctx);
  const pool = ctx.jointPool || (ctx.jointPool = []);
  const visScale = state?.model?.vis?.scale || {};
  const visRgba = state?.model?.vis?.rgba || {};
  const { meanSize, scaleAll } = computeMeanScale(state, ctx);
  const lenScale = Math.max(1e-6, Number(visScale.jointlength) || 1) * scaleAll;
  const widthScale = Math.max(1e-6, Number(visScale.jointwidth) || 1) * scaleAll;
  const colorHex = rgbaToHex(visRgba.joint, 0x3399cc);
  const opacity = alphaFromArray(visRgba.joint, 1);
  const nj = Math.floor(jpos.length / 3);
  const nbody = Math.floor(bxpos.length / 3);
  let used = 0;
  const addMesh = () => {
    let node = pool[used];
    if (!node) {
      const mat = new THREE.MeshBasicMaterial({
        color: colorHex,
        transparent: opacity < 0.999,
        opacity,
        depthWrite: false,
        toneMapped: false,
        fog: false,
      });
      const shaft = new THREE.Mesh(PERTURB_SHAFT_GEOMETRY, mat);
      const head = new THREE.Mesh(PERTURB_HEAD_GEOMETRY, mat);
      node = new THREE.Group();
      node.add(shaft);
      node.add(head);
      node.renderOrder = 52;
      node.userData = { shaft, head, material: mat };
      pool[used] = node;
      group.add(node);
    }
    node.visible = true;
    used += 1;
    return node;
  };
  for (let i = 0; i < nj; i += 1) {
    const bodyId = Number(jbody[i]) || 0;
    if (bodyId < 0 || bodyId >= nbody) continue;
    const base = 3 * i;
    const axisBase = 3 * i;
    const bodyPos = __TMP_VEC3_A.set(
      Number(bxpos[3 * bodyId + 0]) || 0,
      Number(bxpos[3 * bodyId + 1]) || 0,
      Number(bxpos[3 * bodyId + 2]) || 0,
    );
    const bodyMat = TEMP_MAT4.set(
      bxmat?.[9 * bodyId + 0] ?? 1, bxmat?.[9 * bodyId + 1] ?? 0, bxmat?.[9 * bodyId + 2] ?? 0, 0,
      bxmat?.[9 * bodyId + 3] ?? 0, bxmat?.[9 * bodyId + 4] ?? 1, bxmat?.[9 * bodyId + 5] ?? 0, 0,
      bxmat?.[9 * bodyId + 6] ?? 0, bxmat?.[9 * bodyId + 7] ?? 0, bxmat?.[9 * bodyId + 8] ?? 1, 0,
      0, 0, 0, 1,
    );
    const localAnchor = __TMP_VEC3_B.set(
      Number(jpos[base + 0]) || 0,
      Number(jpos[base + 1]) || 0,
      Number(jpos[base + 2]) || 0,
    );
    const worldAnchor = localAnchor.clone().applyMatrix4(bodyMat).add(bodyPos);
    const localAxis = __TMP_VEC3_C.set(
      Number(jaxis[axisBase + 0]) || 0,
      Number(jaxis[axisBase + 1]) || 0,
      Number(jaxis[axisBase + 2]) || 1,
    ).normalize();
    const worldAxis = localAxis.clone().applyMatrix4(bodyMat).normalize();
    const node = addMesh();
    const shaft = node.userData?.shaft;
    const head = node.userData?.head;
    const length = Math.max(1e-4, meanSize * lenScale);
    const width = Math.max(1e-4, meanSize * widthScale);
    const headLength = Math.min(length * 0.35, Math.max(length * 0.25, width * 4));
    const shaftLength = Math.max(1e-4, length - headLength);
    node.position.copy(worldAnchor);
    node.quaternion.setFromUnitVectors(PERTURB_AXIS_DEFAULT, worldAxis);
    if (shaft) {
      shaft.scale.set(width, shaftLength, width);
      shaft.position.set(0, shaftLength / 2, 0);
    }
    if (head) {
      head.scale.set(width * 1.8, headLength, width * 1.8);
      head.position.set(0, shaftLength + headLength / 2, 0);
    }
    if (node.userData?.material) {
      const mat = node.userData.material;
      mat.color.setHex(colorHex);
      mat.opacity = opacity;
      mat.transparent = opacity < 0.999;
      mat.needsUpdate = true;
    }
  }
  for (let i = used; i < pool.length; i += 1) {
    if (pool[i]) pool[i].visible = false;
  }
  group.visible = used > 0;
}

function updateActuatorOverlays(ctx, snapshot, state) {
  const trnid = snapshot?.act_trnid;
  const trntype = snapshot?.act_trntype;
  const jpos = snapshot?.jpos;
  const jaxis = snapshot?.jaxis;
  const jbody = snapshot?.jbody;
  const bxpos = snapshot?.bxpos;
  const bxmat = snapshot?.bxmat;
  if (!trnid || !trntype || !jpos || !jaxis || !jbody || !bxpos || !bxmat) {
    hideActuatorGroup(ctx);
    return;
  }
  const group = ensureActuatorGroup(ctx);
  const pool = ctx.actuatorPool || (ctx.actuatorPool = []);
  const visScale = state?.model?.vis?.scale || {};
  const visRgba = state?.model?.vis?.rgba || {};
  const { meanSize, scaleAll } = computeMeanScale(state, ctx);
  const lenScale = Math.max(1e-6, Number(visScale.actuatorlength) || 1) * scaleAll;
  const widthScale = Math.max(1e-6, Number(visScale.actuatorwidth) || 1) * scaleAll;
  const colorHex = rgbaToHex(visRgba.actuator, 0x2b90d9);
  const opacity = alphaFromArray(visRgba.actuator, 1);
  const na = Math.floor(trntype.length);
  const nj = Math.floor(jpos.length / 3);
  const nbody = Math.floor(bxpos.length / 3);
  let used = 0;
  const addMesh = () => {
    let node = pool[used];
    if (!node) {
      const mat = new THREE.MeshBasicMaterial({
        color: colorHex,
        transparent: opacity < 0.999,
        opacity,
        depthWrite: false,
        toneMapped: false,
        fog: false,
      });
      const shaft = new THREE.Mesh(PERTURB_SHAFT_GEOMETRY, mat);
      const head = new THREE.Mesh(PERTURB_HEAD_GEOMETRY, mat);
      node = new THREE.Group();
      node.add(shaft);
      node.add(head);
      node.renderOrder = 51;
      node.userData = { shaft, head, material: mat };
      pool[used] = node;
      group.add(node);
    }
    node.visible = true;
    used += 1;
    return node;
  };
  for (let i = 0; i < na; i += 1) {
    const t = Number(trntype[i]) | 0;
    if (t !== MJ_TRN.JOINT && t !== MJ_TRN.JOINTINPARENT) continue;
    const jid = trnid ? (trnid[2 * i] | 0) : -1;
    if (jid < 0 || jid >= nj) continue;
    const bodyId = Number(jbody[jid]) || 0;
    if (bodyId < 0 || bodyId >= nbody) continue;
    const base = 3 * jid;
    const bodyPos = __TMP_VEC3_A.set(
      Number(bxpos[3 * bodyId + 0]) || 0,
      Number(bxpos[3 * bodyId + 1]) || 0,
      Number(bxpos[3 * bodyId + 2]) || 0,
    );
    const bodyMat = TEMP_MAT4.set(
      bxmat?.[9 * bodyId + 0] ?? 1, bxmat?.[9 * bodyId + 1] ?? 0, bxmat?.[9 * bodyId + 2] ?? 0, 0,
      bxmat?.[9 * bodyId + 3] ?? 0, bxmat?.[9 * bodyId + 4] ?? 1, bxmat?.[9 * bodyId + 5] ?? 0, 0,
      bxmat?.[9 * bodyId + 6] ?? 0, bxmat?.[9 * bodyId + 7] ?? 0, bxmat?.[9 * bodyId + 8] ?? 1, 0,
      0, 0, 0, 1,
    );
    const localAnchor = __TMP_VEC3_B.set(
      Number(jpos[base + 0]) || 0,
      Number(jpos[base + 1]) || 0,
      Number(jpos[base + 2]) || 0,
    );
    const worldAnchor = localAnchor.clone().applyMatrix4(bodyMat).add(bodyPos);
    const localAxis = __TMP_VEC3_C.set(
      Number(jaxis[base + 0]) || 0,
      Number(jaxis[base + 1]) || 0,
      Number(jaxis[base + 2]) || 1,
    ).normalize();
    const worldAxis = localAxis.clone().applyMatrix4(bodyMat).normalize();
    const node = addMesh();
    const shaft = node.userData?.shaft;
    const head = node.userData?.head;
    const length = Math.max(1e-4, meanSize * lenScale);
    const width = Math.max(1e-4, meanSize * widthScale);
    const headLength = Math.min(length * 0.35, Math.max(length * 0.25, width * 4));
    const shaftLength = Math.max(1e-4, length - headLength);
    node.position.copy(worldAnchor);
    node.quaternion.setFromUnitVectors(PERTURB_AXIS_DEFAULT, worldAxis);
    if (shaft) {
      shaft.scale.set(width, shaftLength, width);
      shaft.position.set(0, shaftLength / 2, 0);
    }
    if (head) {
      head.scale.set(width * 1.9, headLength, width * 1.9);
      head.position.set(0, shaftLength + headLength / 2, 0);
    }
    if (node.userData?.material) {
      const mat = node.userData.material;
      mat.color.setHex(colorHex);
      mat.opacity = opacity;
      mat.transparent = opacity < 0.999;
      mat.needsUpdate = true;
    }
  }
  for (let i = used; i < pool.length; i += 1) {
    if (pool[i]) pool[i].visible = false;
  }
  group.visible = used > 0;
}

function updateSlidercrankOverlays(ctx, snapshot, state) {
  const trnid = snapshot?.act_trnid;
  const trntype = snapshot?.act_trntype;
  const crankLength = snapshot?.act_cranklength;
  const siteXpos = snapshot?.site_xpos;
  const siteXmat = snapshot?.site_xmat;
  if (!trnid || !trntype || !crankLength || !siteXpos || !siteXmat) {
    hideSlidercrankGroup(ctx);
    return;
  }
  const group = ensureSlidercrankGroup(ctx);
  const pool = ctx.slidercrankPool || (ctx.slidercrankPool = []);
  const visScale = state?.model?.vis?.scale || {};
  const visRgba = state?.model?.vis?.rgba || {};
  const { meanSize, scaleAll } = computeMeanScale(state, ctx);
  const scl = Math.max(1e-6, Number(visScale.slidercrank) || 1) * scaleAll;
  const colorHex = rgbaToHex(visRgba.slidercrank, 0x8a6aff);
  const brokenColorHex = rgbaToHex(visRgba.crankbroken, 0xff4d4d);
  const opacity = alphaFromArray(visRgba.slidercrank, 1);
  const ns = Math.floor(siteXpos.length / 3);
  const na = Math.floor(trntype.length);
  let used = 0;
  const addMesh = () => {
    let mesh = pool[used];
    if (!mesh) {
      const mat = new THREE.MeshBasicMaterial({
        color: colorHex,
        transparent: opacity < 0.999,
        opacity,
        depthWrite: false,
        toneMapped: false,
        fog: false,
      });
      mesh = new THREE.Mesh(SLIDERCRANK_SHAFT_GEOMETRY, mat);
      mesh.renderOrder = 50;
      pool[used] = mesh;
      group.add(mesh);
    }
    mesh.visible = true;
    used += 1;
    return mesh;
  };
  for (let i = 0; i < na; i += 1) {
    const t = Number(trntype[i]) | 0;
    if (t !== MJ_TRN.SLIDERCRANK) continue;
    const sidCrank = trnid ? (trnid[2 * i] | 0) : -1;
    const sidSlider = trnid ? (trnid[2 * i + 1] | 0) : -1;
    if (sidCrank < 0 || sidSlider < 0 || sidCrank >= ns || sidSlider >= ns) continue;
    const crank = new THREE.Vector3(
      Number(siteXpos[3 * sidCrank + 0]) || 0,
      Number(siteXpos[3 * sidCrank + 1]) || 0,
      Number(siteXpos[3 * sidCrank + 2]) || 0,
    );
    const slider = new THREE.Vector3(
      Number(siteXpos[3 * sidSlider + 0]) || 0,
      Number(siteXpos[3 * sidSlider + 1]) || 0,
      Number(siteXpos[3 * sidSlider + 2]) || 0,
    );
    const rod = Math.max(1e-6, Number(crankLength[i]) || 0);
    // Slider axis is third column (z) of slider site rotation
    const rotBase = 9 * sidSlider;
    const axis = __TMP_VEC3_A.set(
      Number(siteXmat[rotBase + 2]) || 0,
      Number(siteXmat[rotBase + 5]) || 0,
      Number(siteXmat[rotBase + 8]) || 0,
    ).normalize();
    const vec = __TMP_VEC3_B.copy(crank).sub(slider);
    const lenAlongAxis = vec.dot(axis);
    const distSq = vec.lengthSq();
    let det = (lenAlongAxis * lenAlongAxis) + (rod * rod) - distSq;
    let broken = false;
    if (det < 0) {
      det = 0;
      broken = true;
    }
    const len = lenAlongAxis - Math.sqrt(det);
    const end = __TMP_VEC3_C.copy(axis).multiplyScalar(len).add(slider);
    const widthBase = Math.max(1e-4, meanSize * 0.025 * scl);
    // Slider segment: slider -> end
    const sliderDir = __TMP_VEC3_B.copy(end).sub(slider);
    const sliderDist = sliderDir.length();
    if (sliderDist > 1e-6) {
      sliderDir.multiplyScalar(1 / sliderDist);
      const meshSlider = addMesh();
      meshSlider.position.copy(slider.clone().add(end).multiplyScalar(0.5));
      meshSlider.quaternion.setFromUnitVectors(PERTURB_AXIS_DEFAULT, sliderDir);
      meshSlider.scale.set(widthBase, sliderDist, widthBase);
      if (meshSlider.material) {
        meshSlider.material.color.setHex(colorHex);
        meshSlider.material.opacity = opacity;
        meshSlider.material.transparent = opacity < 0.999;
        meshSlider.material.needsUpdate = true;
      }
    }
    // Rod segment: end -> crank
    const rodDir = __TMP_VEC3_B.copy(crank).sub(end);
    const rodDist = rodDir.length();
    if (rodDist > 1e-6) {
      rodDir.multiplyScalar(1 / rodDist);
      const meshRod = addMesh();
      meshRod.position.copy(crank.clone().add(end).multiplyScalar(0.5));
      meshRod.quaternion.setFromUnitVectors(PERTURB_AXIS_DEFAULT, rodDir);
      const rodWidth = widthBase * 0.5;
      meshRod.scale.set(rodWidth, rodDist, rodWidth);
      if (meshRod.material) {
        meshRod.material.color.setHex(broken ? brokenColorHex : colorHex);
        meshRod.material.opacity = opacity;
        meshRod.material.transparent = opacity < 0.999;
        meshRod.material.needsUpdate = true;
      }
    }
  }
  for (let i = used; i < pool.length; i += 1) {
    if (pool[i]) pool[i].visible = false;
  }
  group.visible = used > 0;
}
function ensurePerturbHelpers(ctx) {
  const worldScene = getWorldScene(ctx);
  if (!ctx || !worldScene) return;
  if (!ctx.perturbGroup) {
    const group = new THREE.Group();
    group.name = 'overlay:perturb';
    worldScene.add(group);
    ctx.perturbGroup = group;
  }
  if (!ctx.perturbTranslate) {
    const material = new THREE.MeshBasicMaterial({
      color: PERTURB_COLOR_TRANSLATE,
      transparent: true,
      opacity: 0.95,
      depthTest: true,
      depthWrite: false,
      toneMapped: false,
      fog: false,
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
      fog: false,
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
      color: PERTURB_COLOR_RING,
      transparent: true,
      opacity: 0.45,
      side: THREE.DoubleSide,
      depthTest: true,
      depthWrite: false,
      toneMapped: false,
      fog: false,
    });
    const ring = new THREE.Mesh(ringGeom, ringMaterial);
    ring.visible = false;
    ring.renderOrder = 61;
    ctx.perturbGroup.add(ring);

    const arrowPrimary = createPerturbArrowNode(PERTURB_COLOR_ARROW);
    const arrowSecondary = createPerturbArrowNode(PERTURB_COLOR_ARROW);
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
  const cursorOffset = PERTURB_TEMP_DIR.copy(cursor).sub(anchor);
  // If we have an active selection with a stored localPoint, recompute anchor in
  // the geom's current space so it follows animated bodies instead of staying fixed.
  const selection = state?.runtime?.selection;
  if (selection && selection.geom >= 0 && Array.isArray(selection.localPoint) && selection.localPoint.length >= 3) {
    const mesh = Array.isArray(ctx.meshes) ? ctx.meshes[selection.geom] : null;
    if (mesh) {
      anchor.set(
        Number(selection.localPoint[0]) || 0,
        Number(selection.localPoint[1]) || 0,
        Number(selection.localPoint[2]) || 0,
      );
      mesh.localToWorld(anchor);
      // Keep cursor relative offset so the overlay follows the moving geom.
      cursor.copy(anchor).add(cursorOffset);
    }
  }
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
    const tangentialBase = PERTURB_TEMP_TANGENT.copy(primaryRadial).cross(axis);
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
    const tangents = [tangentialBase.clone().multiplyScalar(-1), tangentialBase.clone()];
    const radials = [primaryRadial, oppositeRadial];
    const arrows = rotate.arrows || [];
    radials.forEach((radialVec, idx) => {
      const arrow = arrows[idx];
      if (!arrow) return;
      const tangentDir = tangents[idx];
      const ringPoint = anchor.clone().add(radialVec.clone().multiplyScalar(radius));
      arrow.node.visible = true;
      arrow.material.color.setHex(PERTURB_COLOR_ARROW);
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
  const sx = Number(sizeVec?.[0]) || 0;
  const sy = Number(sizeVec?.[1]) || 0;
  const sz = Number(sizeVec?.[2]) || 0;
  switch (gtype) {
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

        } catch {}
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

function segmentBackgroundColor() {
  return 0x000000;
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
  }
  material.wireframe = false;
  return material;
}

function applyMaterialFlags(mesh, index, state, sceneFlagsOverride = null) {
  if (!mesh || !mesh.material) return;
  const sceneFlags = sceneFlagsOverride || state.rendering?.sceneFlags || [];
  mesh.material.wireframe = !!sceneFlags[1];
  if (mesh.material.emissive && typeof mesh.material.emissive.set === 'function') {
    mesh.material.emissive.set(0x000000);
  } else if (mesh.material && 'emissive' in mesh.material) {
    mesh.material.emissive = new THREE.Color(0x000000);
  }
}

function updateMeshMaterial(mesh, matIndex, matRgbaView, materials = null) {
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
  if (materials && materials.count && matIndex < materials.count) {
    const emissionArr = materials.emission || null;
    const metallicArr = materials.metallic || null;
    const roughnessArr = materials.roughness || null;
    const specularArr = materials.specular || null;
    const shininessArr = materials.shininess || null;
    if (emissionArr && 'emissiveIntensity' in material) {
      const e = emissionArr[matIndex];
      if (Number.isFinite(e)) {
        material.emissiveIntensity = e;
      }
    }
    if (metallicArr && 'metalness' in material) {
      const m = metallicArr[matIndex];
      if (Number.isFinite(m)) {
        material.metalness = Math.min(1, Math.max(0, m));
      }
    }
    if (roughnessArr && 'roughness' in material) {
      const rv = roughnessArr[matIndex];
      if (Number.isFinite(rv)) {
        material.roughness = Math.min(1, Math.max(0, rv));
      }
    } else if (shininessArr && 'roughness' in material) {
      const sh = shininessArr[matIndex];
      if (Number.isFinite(sh)) {
        const t = Math.max(1, sh);
        const rough = 1 / (1 + Math.log10(t));
        material.roughness = Math.min(1, Math.max(0, rough));
      }
    }
    if (specularArr && !('specularIntensity' in material)) {
      // No-op for now; specular is available via materials.specular if needed.
    }
  }
  if ('needsUpdate' in material) {
    material.needsUpdate = true;
  }
}

function resolveMaterialReflectance(matIndex, assets) {
  if (!(matIndex >= 0)) return 0;
  const reflectArr = assets?.materials?.reflectance || null;
  if (!reflectArr) return 0;
  const value = reflectArr[matIndex];
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Number(value));
}

function applyReflectanceToMaterial(mesh, ctx, reflectance, reflectionEnabled) {
  if (!mesh) return;
  mesh.userData = mesh.userData || {};
  const mode = ctx?.visualSourceMode || 'model';
  const baseIntensity = typeof ctx?.envIntensity === 'number' ? ctx.envIntensity : 0;
  const mat = mesh.material;
  if (!mat || !('envMapIntensity' in mat)) return;
  if (!('reflectanceBaseEnvIntensity' in mesh.userData) || mesh.userData.reflectanceBaseEnvIntensity == null) {
    mesh.userData.reflectanceBaseEnvIntensity = typeof mat.envMapIntensity === 'number' ? mat.envMapIntensity : 0;
  }
  const clampedReflectance = Number.isFinite(reflectance) ? Math.max(0, reflectance) : 0;
  mesh.userData.reflectance = clampedReflectance;
  const presetMode = mode === 'preset-sun' || mode === 'preset-moon';
  let effectiveReflectance = clampedReflectance > 0 ? clampedReflectance : 0;
  if (effectiveReflectance <= 0 && presetMode) {
    const name = typeof mesh.name === 'string' ? mesh.name.toLowerCase() : '';
    const isGround = mesh.userData?.infinitePlane || name.includes('floor') || name.includes('ground');
    effectiveReflectance = isGround ? 0.2 : 0.5;
  }
  let nextEnvIntensity = mat.envMapIntensity;
  if (!reflectionEnabled || baseIntensity <= 0 || !presetMode) {
    nextEnvIntensity = 0;
  } else {
    nextEnvIntensity = baseIntensity * effectiveReflectance;
  }
  mat.envMapIntensity = nextEnvIntensity;
  mat.needsUpdate = true;
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
  const sizeKey = infinitePlane
    ? `infinite:${Number(sizeVec?.[2]) || 0}`
    : Array.isArray(sizeVec)
      ? sizeVec.map((v) => (Number.isFinite(v) ? v.toFixed(6) : '0')).join(',')
      : 'null';
  const needsRebuild =
    !mesh ||
    mesh.userData?.geomType !== gtype ||
    (!!mesh.userData?.infinitePlane !== infinitePlane) ||
    (gtype === MJ_GEOM.MESH && mesh.userData?.geomDataId !== dataId) ||
    (!infinitePlane && gtype !== MJ_GEOM.MESH && mesh.userData?.geomSizeKey !== sizeKey);

  if (needsRebuild) {
    if (mesh) {
      disposeMeshObject(mesh);
    }

    if (infinitePlane) {
      const groundColorHex =
        (ctx.fallback && ctx.fallback.ground && typeof ctx.fallback.ground.color === 'number')
          ? ctx.fallback.ground.color
          : 0xf5f5f5;
      mesh = createInfiniteGroundHelper({
        color: groundColorHex,
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
          warnLog('[render] mesh geometry missing', { dataId });
          ctx.meshAssetMissingLogged = true;
        }
      }
      if (!geometryInfo) {
        const fb = ctx.fallback || {};
        geometryInfo = createPrimitiveGeometry(gtype, sizeVec, {
          fallbackEnabled: fb.enabled !== false,
          preset: fb.preset || 'bright-outdoor',
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
        if (material && material.userData?.pooled) {
          const cloned = material.clone();
          cloned.userData = cloned.userData || {};
          cloned.userData.pooled = false;
          material = cloned;
        }
        if (!useStandard) material.envMapIntensity = 0;
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
      mesh.userData.infinitePlane = false;
      mesh.userData.geomType = gtype;
      mesh.userData.geomDataId = gtype === MJ_GEOM.MESH ? dataId : -1;
      mesh.userData.geomSizeKey = gtype === MJ_GEOM.MESH ? null : sizeKey;
      mesh.userData.ownGeometry = geometryInfo.ownGeometry !== false;
      mesh.userData.geomIndex = index;
      ctx.root.add(mesh);
      ctx.meshes[index] = mesh;
    }
  }

  if (mesh && options.geomMeta) {
    applyGeomMetadata(mesh, options.geomMeta);
  }
  return mesh;
}
function updateMeshFromSnapshot(mesh, i, snapshot, state, assets, sceneFlags = null) {
  const n = snapshot.ngeom | 0;
  if (i >= n) {
    mesh.visible = false;
    return;
  }
  const flags = Array.isArray(sceneFlags) ? sceneFlags : state?.rendering?.sceneFlags || [];
  if (mesh.userData?.infinitePlane) {
    updateInfinitePlaneFromSnapshot(mesh, i, snapshot, assets, flags);
    return;
  }
  const sceneGeom = Array.isArray(snapshot.scene?.geoms) ? snapshot.scene.geoms[i] : null;
  const segmentEnabled = !!flags[SEGMENT_FLAG_INDEX];
  if (segmentEnabled) {
    const segMat = ensureSegmentMaterial(mesh, flags);
    if (segMat) {
      const segColor = segmentColorForIndex(mesh.userData?.geomIndex ?? i);
      segMat.color.setHex(segColor);
      mesh.material = segMat;
    }
  } else {
    restoreSegmentMaterial(mesh);
  }
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

  const appearance = resolveGeomAppearance(i, sceneGeom, snapshot, assets);
  if (!appearance.rgba) {
    const matIdView = snapshot.gmatid || assets?.geoms?.matid || null;
    const materials = assets?.materials || null;
    const matRgbaView = materials?.rgba || snapshot.matrgba || null;
    const matIndex = matIdView?.[i] ?? -1;
    if (Array.isArray(matRgbaView) || ArrayBuffer.isView(matRgbaView)) {
      updateMeshMaterial(mesh, matIndex, matRgbaView, materials);
      appearance.rgba = [
        matRgbaView[matIndex * 4 + 0] ?? 0.6,
        matRgbaView[matIndex * 4 + 1] ?? 0.6,
        matRgbaView[matIndex * 4 + 2] ?? 0.9,
        matRgbaView[matIndex * 4 + 3] ?? 1,
      ];
      appearance.color = rgbFromArray(appearance.rgba);
      appearance.opacity = alphaFromArray(appearance.rgba);
    }
  }
  const applyAppearance = !segmentEnabled;
  if (applyAppearance) {
    applyAppearanceToMaterial(mesh, appearance);
    applyMaterialFlags(mesh, i, state, flags);
  }
  mesh.visible = true;
}

function updateInfinitePlaneFromSnapshot(mesh, i, snapshot, assets, sceneFlags = null) {
  const groundData = mesh.userData?.infiniteGround;
  if (!groundData) return;
  const uniforms = groundData.uniforms || {};
  const segmentEnabled = Array.isArray(sceneFlags) ? !!sceneFlags[SEGMENT_FLAG_INDEX] : false;
  const baseColor = mesh.material?.color;
  if (segmentEnabled) {
    const userData = mesh.userData || (mesh.userData = {});
    if (baseColor && !userData.segmentOriginalColor) {
      userData.segmentOriginalColor = baseColor.clone();
    }
    if (mesh.material?.emissive && !userData.segmentOriginalEmissive) {
      userData.segmentOriginalEmissive = mesh.material.emissive.clone();
    }
    if ('emissiveIntensity' in mesh.material && userData.segmentOriginalEmissiveIntensity == null) {
      userData.segmentOriginalEmissiveIntensity = mesh.material.emissiveIntensity;
    }
    if ('toneMapped' in mesh.material && userData.segmentOriginalToneMapped == null) {
      userData.segmentOriginalToneMapped = mesh.material.toneMapped;
    }
    if ('transparent' in mesh.material && userData.segmentOriginalTransparent == null) {
      userData.segmentOriginalTransparent = mesh.material.transparent;
    }
    if ('opacity' in mesh.material && userData.segmentOriginalOpacity == null) {
      userData.segmentOriginalOpacity = mesh.material.opacity;
    }
    if ('metalness' in mesh.material && userData.segmentOriginalMetalness == null) {
      userData.segmentOriginalMetalness = mesh.material.metalness;
    }
    if ('roughness' in mesh.material && userData.segmentOriginalRoughness == null) {
      userData.segmentOriginalRoughness = mesh.material.roughness;
    }
    if ('envMapIntensity' in mesh.material && userData.segmentOriginalEnvMapIntensity == null) {
      userData.segmentOriginalEnvMapIntensity = mesh.material.envMapIntensity;
    }
    const segColor = segmentColorForIndex(mesh.userData?.geomIndex ?? i);
    if (baseColor) baseColor.setHex(segColor);
    if (mesh.material?.emissive) {
      mesh.material.emissive.setHex(segColor);
    }
    if ('emissiveIntensity' in mesh.material) {
      mesh.material.emissiveIntensity = 1;
    }
    if ('metalness' in mesh.material) mesh.material.metalness = 0;
    if ('roughness' in mesh.material) mesh.material.roughness = 1;
    if ('toneMapped' in mesh.material) mesh.material.toneMapped = false;
    if ('needsUpdate' in mesh.material) mesh.material.needsUpdate = true;
  } else {
    restoreSegmentMaterial(mesh);
    if (baseColor && mesh.userData.segmentOriginalColor) {
      baseColor.copy(mesh.userData.segmentOriginalColor);
      if ('needsUpdate' in mesh.material) mesh.material.needsUpdate = true;
      mesh.material.transparent = true;
    }
    if (mesh.material?.emissive && mesh.userData.segmentOriginalEmissive) {
      mesh.material.emissive.copy(mesh.userData.segmentOriginalEmissive);
    }
    if ('emissiveIntensity' in mesh.material && mesh.userData.segmentOriginalEmissiveIntensity != null) {
      mesh.material.emissiveIntensity = mesh.userData.segmentOriginalEmissiveIntensity;
    }
    if ('toneMapped' in mesh.material && mesh.userData.segmentOriginalToneMapped != null) {
      mesh.material.toneMapped = mesh.userData.segmentOriginalToneMapped;
    }
    if ('transparent' in mesh.material && mesh.userData.segmentOriginalTransparent != null) {
      mesh.material.transparent = mesh.userData.segmentOriginalTransparent;
    }
    if ('opacity' in mesh.material && mesh.userData.segmentOriginalOpacity != null) {
      mesh.material.opacity = mesh.userData.segmentOriginalOpacity;
    }
    if ('metalness' in mesh.material && mesh.userData.segmentOriginalMetalness != null) {
      mesh.material.metalness = mesh.userData.segmentOriginalMetalness;
    }
    if ('roughness' in mesh.material && mesh.userData.segmentOriginalRoughness != null) {
      mesh.material.roughness = mesh.userData.segmentOriginalRoughness;
    }
    if ('envMapIntensity' in mesh.material && mesh.userData.segmentOriginalEnvMapIntensity != null) {
      mesh.material.envMapIntensity = mesh.userData.segmentOriginalEnvMapIntensity;
    }
    if ('transparent' in mesh.material) {
      mesh.material.transparent = true;
    }
  }
  const sceneGeom = Array.isArray(snapshot.scene?.geoms) ? snapshot.scene.geoms[i] : null;
  let px = 0;
  let py = 0;
  let pz = 0;
  let rot = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  if (sceneGeom) {
    px = Number(sceneGeom.xpos?.[0]) || 0;
    py = Number(sceneGeom.xpos?.[1]) || 0;
    pz = Number(sceneGeom.xpos?.[2]) || 0;
    rot = Array.isArray(sceneGeom.xmat) && sceneGeom.xmat.length >= 9
      ? sceneGeom.xmat
      : rot;
  } else {
    const xpos = snapshot.xpos;
    const baseIndex = 3 * i;
    px = xpos?.[baseIndex + 0] ?? 0;
    py = xpos?.[baseIndex + 1] ?? 0;
    pz = xpos?.[baseIndex + 2] ?? 0;
    const xmat = snapshot.xmat;
    const matBase = 9 * i;
    rot = [
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
  }
  const quat = mat3ToQuat(rot);
  if (uniforms.uPlaneOrigin?.value) {
    uniforms.uPlaneOrigin.value.set(px, py, pz);
  }
  if (uniforms.uPlaneAxisU?.value) {
    uniforms.uPlaneAxisU.value.copy(__TMP_VEC3_A.set(1, 0, 0).applyQuaternion(quat).normalize());
  }
  if (uniforms.uPlaneAxisV?.value) {
    uniforms.uPlaneAxisV.value.copy(__TMP_VEC3_B.set(0, 1, 0).applyQuaternion(quat).normalize());
  }
  if (uniforms.uPlaneNormal?.value) {
    uniforms.uPlaneNormal.value.copy(__TMP_VEC3_C.set(0, 0, 1).applyQuaternion(quat).normalize());
  }
  const gridStep = Math.abs(mesh.userData?.geomGrid ?? 0);
  if (uniforms.uGridStep) {
    const defaultStep = groundData.defaultGridStep || 1;
    uniforms.uGridStep.value = segmentEnabled ? 0 : (gridStep > 0 ? gridStep : defaultStep);
  }
  if (uniforms.uDistance && groundData.baseDistance) {
    uniforms.uDistance.value = groundData.baseDistance;
  }
  if (uniforms.uFadeStart) {
    const val = groundData.baseFadeStart || (groundData.baseDistance ? groundData.baseDistance * 0.5 : 0);
    uniforms.uFadeStart.value = val;
  }
  if (uniforms.uFadeEnd) {
    const val = groundData.baseFadeEnd || groundData.baseDistance || 0;
    uniforms.uFadeEnd.value = val;
  }
  if (uniforms.uQuadDistance) {
    const fade = uniforms.uFadeEnd?.value || groundData.baseFadeEnd || 0;
    const dist = uniforms.uDistance?.value || groundData.baseDistance || 0;
    uniforms.uQuadDistance.value = Math.max(fade * 1.2, dist);
  }
  if (!segmentEnabled) {
    const appearance = resolveGeomAppearance(i, sceneGeom, snapshot, assets);
    if (!appearance.rgba) {
      const matIdView = snapshot.gmatid || assets?.geoms?.matid || null;
      const matRgbaView = assets?.materials?.rgba || snapshot.matrgba || null;
      const matIndex = matIdView?.[i] ?? -1;
      if (Array.isArray(matRgbaView) || ArrayBuffer.isView(matRgbaView)) {
        updateMeshMaterial(mesh, matIndex, matRgbaView);
        appearance.rgba = [
          matRgbaView[matIndex * 4 + 0] ?? 0.6,
          matRgbaView[matIndex * 4 + 1] ?? 0.6,
          matRgbaView[matIndex * 4 + 2] ?? 0.9,
          matRgbaView[matIndex * 4 + 3] ?? 1,
        ];
        appearance.color = rgbFromArray(appearance.rgba);
        appearance.opacity = alphaFromArray(appearance.rgba);
      }
    }
    applyAppearanceToMaterial(mesh, appearance);
  }
  // Ensure infinite ground remains blended by alpha
  if (mesh.material) {
    mesh.material.transparent = true;
    mesh.material.opacity = 1;
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

/**
 * @typedef {Object} GeomDescriptor
 * @property {'geom'} kind
 * @property {number} index
 * @property {number} type
 * @property {number} dataId
 * @property {number[] | null} size
 * @property {number} matId
 * @property {number} bodyId
 * @property {string} name
 */

/**
 * Build descriptors for base MuJoCo geoms in the current snapshot.
 * This describes "what exists" at the geom level, independent of how it is rendered.
 *
 * @param {object} snapshot
 * @param {object} state
 * @param {object | null} assets
 * @returns {GeomDescriptor[]}
 */
function buildGeomDescriptors(snapshot, state, assets) {
  const ngeom = snapshot?.ngeom | 0;
  if (!(ngeom > 0)) return [];
  const sizeView = snapshot.gsize || assets?.geoms?.size || null;
  const typeView = snapshot.gtype || assets?.geoms?.type || null;
  const dataIdView = snapshot.gdataid || assets?.geoms?.dataid || null;
  const matIdView = snapshot.gmatid || assets?.geoms?.matid || null;
  const bodyIdView = state?.model?.geomBodyId || assets?.geoms?.bodyid || null;
  const groupIdView = assets?.geoms?.group || null;
  const geomRgbaView = assets?.geoms?.rgba || null;
  const geomNameLookup = createGeomNameLookup(state?.model?.geoms);
  const sceneGeoms = Array.isArray(snapshot.scene?.geoms) ? snapshot.scene.geoms : null;

  const descriptors = [];
  for (let i = 0; i < ngeom; i += 1) {
    const sceneGeom = sceneGeoms ? sceneGeoms[i] : null;
    const type = sceneGeom ? sceneTypeToEnum(sceneGeom.type) : (typeView?.[i] ?? MJ_GEOM.BOX);
    const dataId = dataIdView?.[i] ?? -1;
    const base = 3 * i;
    let sizeVec = null;
    if (sizeView) {
      sizeVec = [
        sizeView[base + 0] ?? 0,
        sizeView[base + 1] ?? 0,
        sizeView[base + 2] ?? 0,
      ];
    } else if (sceneGeom && Array.isArray(sceneGeom.size)) {
      sizeVec = [
        sceneGeom.size[0] ?? 0,
        sceneGeom.size[1] ?? 0,
        sceneGeom.size[2] ?? 0,
      ];
    }
    if (Array.isArray(sizeVec)) {
      if (type === MJ_GEOM.SPHERE) {
        const r = Math.max(1e-6, Number(sizeVec[0]) || 0.1);
        sizeVec = [r, r, r];
      } else if (type === MJ_GEOM.ELLIPSOID) {
        const ax = Math.max(1e-6, Number(sizeVec[0]) || 0.1);
        const ay = Math.max(1e-6, Number(sizeVec[1]) || ax);
        const az = Math.max(1e-6, Number(sizeVec[2]) || ax);
        sizeVec = [ax, ay, az];
      }
    }
    const matId = matIdView?.[i] ?? -1;
    const bodyId = bodyIdView && i < bodyIdView.length ? bodyIdView[i] : -1;
    const groupId = groupIdView && i < groupIdView.length ? groupIdView[i] : -1;
    const name = geomNameFromLookup(geomNameLookup, i);
    let rgba = null;
    if (geomRgbaView && geomRgbaView.length >= ((i * 4) + 4)) {
      const rgbaBase = i * 4;
      rgba = [
        geomRgbaView[rgbaBase + 0],
        geomRgbaView[rgbaBase + 1],
        geomRgbaView[rgbaBase + 2],
        geomRgbaView[rgbaBase + 3],
      ];
    }

    descriptors.push({
      kind: 'geom',
      index: i,
      type,
      dataId,
      size: sizeVec,
      matId,
      bodyId,
      groupId,
      rgba,
      name,
    });
  }

  return descriptors;
}

/**
 * @typedef {Object} OverlayDescriptor
 * @property {'overlay'} kind
 * @property {string} subtype
 * @property {number} index
 * @property {number[]} position
 * @property {number[] | null} rotation
 * @property {number} scale
 * @property {number} colorHex
 * @property {number} opacity
 */

/**
 * Build overlay descriptors for model cameras.
 *
 * @param {object} snapshot
 * @param {object} state
 * @param {object} ctx
 * @returns {OverlayDescriptor[]}
 */
  function buildCameraOverlayDescriptors(snapshot, state, ctx) {
    const camPos = snapshot?.cam_xpos;
    const camMat = snapshot?.cam_xmat;
    if (!camPos || !camMat || camPos.length < 3) {
      return [];
    }
    const visScale = state?.model?.vis?.scale || {};
    const visRgba = state?.model?.vis?.rgba || {};
    const { meanSize, scaleAll } = computeMeanScale(state, ctx);
    const sizeScale = Math.max(1e-6, Number(visScale.camera) || 1) * scaleAll;
  const colorHex = rgbaToHex(visRgba.camera, 0x6aa86a);
  const opacity = alphaFromArray(visRgba.camera, 1);
  const count = Math.floor(camPos.length / 3);
  const descriptors = [];
  for (let i = 0; i < count; i += 1) {
    const base = 3 * i;
    const position = [
      Number(camPos[base + 0]) || 0,
      Number(camPos[base + 1]) || 0,
      Number(camPos[base + 2]) || 0,
    ];
    const rotBase = 9 * i;
    const rotation = [
      camMat?.[rotBase + 0] ?? 1,
      camMat?.[rotBase + 1] ?? 0,
      camMat?.[rotBase + 2] ?? 0,
      camMat?.[rotBase + 3] ?? 0,
      camMat?.[rotBase + 4] ?? 1,
      camMat?.[rotBase + 5] ?? 0,
      camMat?.[rotBase + 6] ?? 0,
      camMat?.[rotBase + 7] ?? 0,
      camMat?.[rotBase + 8] ?? 1,
    ];
    const s = Math.max(1e-4, meanSize * 0.15 * sizeScale);
    descriptors.push({
      kind: 'overlay',
      subtype: 'camera',
      index: i,
      position,
      rotation,
      scale: s,
      colorHex,
      opacity,
    });
  }
  return descriptors;
}

/**
 * Apply camera overlay descriptors to the Three.js scene, using the existing
 * camera gizmo pool and group. Behaviour matches updateCameraOverlays.
 *
 * @param {object} ctx
 * @param {OverlayDescriptor[]} descriptors
 */
function applyCameraOverlayDescriptors(ctx, descriptors) {
  if (!ctx) return;
  if (!Array.isArray(descriptors) || descriptors.length === 0) {
    hideCameraGroup(ctx);
    return;
  }
  const group = ensureCameraGroup(ctx);
  const pool = ctx.cameraPool || (ctx.cameraPool = []);
  let used = 0;
  for (const desc of descriptors) {
    if (!desc || desc.kind !== 'overlay' || desc.subtype !== 'camera') continue;
    let mesh = pool[used];
    if (!mesh) {
      const mat = new THREE.MeshBasicMaterial({
        color: desc.colorHex,
        transparent: desc.opacity < 0.999,
        opacity: desc.opacity,
        depthWrite: false,
        toneMapped: false,
        fog: false,
      });
      mesh = new THREE.Mesh(CAMERA_GIZMO_GEOMETRY, mat);
      mesh.renderOrder = 55;
      pool[used] = mesh;
      group.add(mesh);
    }
    mesh.visible = true;
    mesh.position.set(desc.position[0], desc.position[1], desc.position[2]);
    const rot = desc.rotation || null;
    if (rot && rot.length >= 9) {
      TEMP_MAT4.set(
        rot[0], rot[1], rot[2], 0,
        rot[3], rot[4], rot[5], 0,
        rot[6], rot[7], rot[8], 0,
        0, 0, 0, 1,
      );
      mesh.quaternion.setFromRotationMatrix(TEMP_MAT4);
    }
    mesh.scale.set(desc.scale, desc.scale, desc.scale);
    const mat = mesh.material;
    if (mat) {
      mat.color.setHex(desc.colorHex);
      mat.opacity = desc.opacity;
      mat.transparent = desc.opacity < 0.999;
      mat.needsUpdate = true;
    }
    used += 1;
  }
  for (let i = used; i < pool.length; i += 1) {
    if (pool[i]) pool[i].visible = false;
  }
  group.visible = used > 0;
}

/**
 * Apply geom descriptors to the Three.js scene: ensure meshes exist, update pose/material,
 * and apply visibility/group filters. Returns the number of geoms drawn.
 *
 * Behaviour is intended to match the previous inlined loop in renderScene.
 *
 * @param {object} context
 * @param {GeomDescriptor[]} descriptors
 * @param {object} params
 * @param {object | null} params.assets
 * @param {object} params.state
 * @param {object} params.snapshot
 * @param {boolean[]} params.sceneFlags
 * @param {boolean} params.reflectionEnabled
 * @param {boolean} params.hideAllGeometry
 * @param {ArrayLike<number> | null} params.geomGroupIds
 * @param {boolean[] | null} params.geomGroupMask
 * @returns {number}
 */
function applyGeomDescriptors(context, descriptors, {
  assets,
  state,
  snapshot,
  sceneFlags,
  reflectionEnabled,
  hideAllGeometry,
  geomGroupIds,
  geomGroupMask,
}) {
  if (!Array.isArray(descriptors) || descriptors.length === 0) {
    // Hide any leftover meshes if no descriptors exist.
    if (Array.isArray(context.meshes)) {
      for (let i = 0; i < context.meshes.length; i += 1) {
        if (context.meshes[i]) {
          context.meshes[i].visible = false;
        }
      }
    }
    return 0;
  }

  const flags = Array.isArray(sceneFlags) ? sceneFlags : [];
  const n = descriptors.length;
  let drawn = 0;

  for (let idx = 0; idx < n; idx += 1) {
    const desc = descriptors[idx];
    if (!desc || desc.kind !== 'geom') continue;
    const i = desc.index;
    const sizeVec = desc.size;
    const geomMeta = {
      index: i,
      type: desc.type,
      dataId: desc.dataId,
      size: sizeVec,
      // Plane size[2] is not grid step; use a sane default (1m) for planes.
      grid: desc.type === MJ_GEOM.PLANE ? 1 : sizeVec?.[2] ?? 0,
      name: desc.name,
      matId: desc.matId,
      bodyId: desc.bodyId,
      groupId: desc.groupId,
      rgba: desc.rgba,
    };

    const mesh = ensureGeomMesh(
      context,
      i,
      desc.type,
      assets,
      desc.dataId,
      sizeVec,
      { geomMeta },
      state,
    );
    if (!mesh) continue;

    const reflectanceValue = resolveMaterialReflectance(desc.matId, assets);
    mesh.userData = mesh.userData || {};
    mesh.userData.matId = desc.matId;
    applyReflectanceToMaterial(mesh, context, reflectanceValue, reflectionEnabled);
    updateMeshFromSnapshot(mesh, i, snapshot, state, assets, flags);

    let visible = mesh.visible;
    if (hideAllGeometry) {
      visible = false;
    }
    if (visible && geomGroupMask && Array.isArray(geomGroupMask)) {
      const rawGroup = geomGroupIds && i < geomGroupIds.length ? geomGroupIds[i] : 0;
      const groupIdx = Number.isFinite(rawGroup) ? (rawGroup | 0) : 0;
      if (groupIdx >= 0 && groupIdx < geomGroupMask.length) {
        if (!geomGroupMask[groupIdx]) {
          visible = false;
        }
      }
    }

    mesh.visible = visible;
    if (visible) {
      drawn += 1;
    }
  }

  // Hide any stale meshes beyond the descriptor range.
  if (Array.isArray(context.meshes) && context.meshes.length > n) {
    for (let i = n; i < context.meshes.length; i += 1) {
      if (context.meshes[i]) {
        context.meshes[i].visible = false;
      }
    }
  }

  return drawn;
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

  function debugHazeState(summary) {
    const globalDebug = typeof window !== 'undefined' ? window.__PLAY_HAZE_DEBUG : undefined;
    const verbose = typeof window !== 'undefined' ? window.PLAY_VERBOSE_DEBUG === true : false;
    const logEnabled = globalDebug === true || verbose;
    if (!logEnabled) return;
    const payload = summary || { mode: 'overlay', enabled: false };
    const key = JSON.stringify(payload);
    if (ctx._lastHazeDebugKey === key) return;
    ctx._lastHazeDebugKey = key;
    try {
      if (logEnabled) console.log('[viewer][haze]', payload);
      if (typeof window !== 'undefined') {
        window.__viewerHazeDebug = payload;
      }
    } catch {}
  }

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
      if (!ctx.initialized || !ctx.renderer || !ctx.sceneWorld || !ctx.camera) return;
      // Background/environment is managed by environment manager (ensureEnvIfNeeded)
      renderWorldScene(ctx, ctx.renderer, { camera: ctx.camera });
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
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;

    // Snapshot helpers: readiness + PBR export of final frame
    if (typeof window !== 'undefined' && (!window.exportPNG || !window.whenReady)) {
      try {
        window.whenReady = async () => {
          try {
            const r = renderer;
            const scn = sceneWorld;
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
            const scn = sceneWorld;
            const cam = (ctx && ctx.camera) ? ctx.camera : camera;
            if (!r || !scn || !cam) return null;
            r.setRenderTarget?.(null);
            renderWorldScene(ctx, r, { camera: cam });
            const url = r.domElement && typeof r.domElement.toDataURL === 'function'
              ? r.domElement.toDataURL('image/png')
              : null;
            if (typeof window !== 'undefined') {
              window.__viewerCanvasDataUrlLength = url ? url.length : 0;
            }
            return url || null;
          } catch (err) {
            try { warnLog('[render] exportExactPNG failed', err); } catch {}
            return null;
          }
        };

        window.exportPNG = async () => {
          try {
            await (window.whenReady ? window.whenReady() : Promise.resolve());
            const r = renderer;
            const scn = sceneWorld;
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
            renderWorldScene(ctx, r, { camera: cam });
            const url = r.domElement?.toDataURL?.('image/png');
            window.__viewerCanvasDataUrlLength = url ? url.length : 0;
            // restore
            try { for (const [o, m] of saved) { o.material.depthTest = m.dt; o.material.depthWrite = m.dw; o.material.transparent = m.tr; o.renderOrder = m.ro; } } catch {}
            return url || null;
          } catch (err) {
            try { warnLog('[render] exportPNG failed', err); } catch {}
            return null;
          }
        };
      } catch {}
    }

    const sceneWorld = new THREE.Scene();

    const ambient = new THREE.AmbientLight(0xffffff, 0);
    sceneWorld.add(ambient);
    const hemi = new THREE.HemisphereLight(0xffffff, 0x10131c, 0);
    sceneWorld.add(hemi);
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
    sceneWorld.add(lightTarget);
    keyLight.target = lightTarget;
    sceneWorld.add(keyLight);
    const fill = new THREE.DirectionalLight(0xffffff, 0.25);
    fill.position.set(-6, 6, 3);
    sceneWorld.add(fill);

    const camera = new THREE.PerspectiveCamera(45, 1, 0.01, GROUND_DISTANCE * 20);
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
      _lastPresetMode: null,
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
    if (typeof window !== 'undefined') {
      window.__renderCtx = context;
      window.__envDebug = {
        envIntensity: typeof context.envIntensity === 'number' ? context.envIntensity : null,
        sample: context._envDebugSample || null,
      };
    }
    const renderer = context.renderer;
    const debugSceneEnabled = isSceneDebugEnabled(state);
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
      presetMode,
    } = policy;
    context.reflectionActive = reflectionEnabled;

    const assets = state.rendering?.assets || null;
    syncRendererAssets(context, assets);
    const geomGroupIds = assets?.geoms?.group || null;
    const geomGroupMask = Array.isArray(state.rendering?.groups?.geom) ? state.rendering.groups.geom : null;

    if (typeof ensureEnvIfNeeded === 'function') {
      ensureEnvIfNeeded(context, state, { skyboxEnabled, presetMode });
    }
  if (!segmentEnabled && presetMode && typeof applyFallbackAppearance === 'function') {
      applyFallbackAppearance(context, state);
    }
    const worldScene = getWorldScene(context);
      if (segmentEnabled) {
        if (!context._segmentEnvBackup && worldScene) {
          context._segmentEnvBackup = {
            background: worldScene.background,
            environment: worldScene.environment,
          shadowEnabled: context.renderer?.shadowMap?.enabled ?? null,
          toneExposure: context.renderer?.toneMappingExposure ?? null,
          light: context.light ? context.light.intensity : null,
          fill: context.fill ? context.fill.intensity : null,
          ambient: context.ambient ? context.ambient.intensity : null,
          hemi: context.hemi ? context.hemi.intensity : null,
        };
      }
      if (worldScene) {
        worldScene.environment = null;
        worldScene.background = new THREE.Color(segmentBackgroundColor());
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
    const groundDistance =
      Number(groundData?.baseDistance) || GROUND_DISTANCE;
    if (groundUniforms?.uDistance) {
      groundUniforms.uDistance.value = groundDistance;
    }
    if (groundUniforms?.uFadePow) {
      const baseFade = Number(groundData?.baseFadePow);
      const defaultFade = Number.isFinite(baseFade) ? baseFade : 2.5;
      groundUniforms.uFadePow.value = hazeEnabled ? defaultFade : 1e-6;
    }
    // Avoid visible radial "mask" from the infinite ground quad:
    // push fade-out far beyond typical scene extents so the plane
    // behaves visually infinite in normal views.
    const fadeRadius = groundDistance * 1000;
    if (groundUniforms?.uFadeStart) {
      groundUniforms.uFadeStart.value = 0;
    }
    if (groundUniforms?.uFadeEnd) {
      groundUniforms.uFadeEnd.value = fadeRadius;
    }
    if (groundUniforms?.uQuadDistance) {
      groundUniforms.uQuadDistance.value = fadeRadius;
    }
    const visStruct = state.model?.vis || null;
    const statStruct = state.model?.stat || null;
    const fogConfig = resolveFogConfig(visStruct, statStruct, context.bounds, fogEnabled);
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
    };
    debugHazeState(hazeSummary);
    if (visStruct && !segmentEnabled) {
      applyVisualLighting(context, visStruct);
    }

    const defaults = getDefaultVopt(context, state);
    if (context.renderer) {
      context.renderer.shadowMap.enabled = shadowEnabled;
      if (context.renderer.shadowMap) {
        context.renderer.shadowMap.type = THREE.PCFShadowMap;
      }
    }
    if (context.light) {
      context.light.castShadow = shadowEnabled;
    }

    // --- Overlays: contacts (controlled by vopt flags) ---
    const vopt = voptFlags;
    const contactPointEnabled = !!vopt[14];
    const contactForceEnabled = !!vopt[16];
    // Contact overlays: points (flags[14]) and force arrows (flags[16]).
    const contacts = snapshot.contacts || null;
    const visScale = visStruct?.scale || {};
    const { meanSize, scaleAll } = computeMeanScale(state, context);
    const boundsRadius = Math.max(0.1, context.bounds?.radius || meanSize || 1);
    if (contactPointEnabled && contacts && typeof contacts.n === 'number' && !contacts.pos) {
      try { warnLog('[render] contact points enabled but no position array in snapshot; n=', contacts.n); } catch {}
    }
    if (contactPointEnabled && contacts && contacts.pos && typeof contacts.n === 'number') {
      const group = ensureContactGroup(context);
      const pool = Array.isArray(context.contactPool) ? context.contactPool : (context.contactPool = []);
      const n = Math.max(0, contacts.n | 0);
      // Contact visual size scales by vis.scale.{contactwidth,contactheight} * vis.scale.all * meansize.
      const base = Math.max(1e-6, meanSize * scaleAll);
      const widthScale = Number(visScale?.contactwidth);
      const heightScale = Number(visScale?.contactheight);
      const radius = Number.isFinite(widthScale) && widthScale > 0
        ? Math.max(0.0015, widthScale * base)
        : Math.max(0.002, Math.min(base * 0.02, base * 0.1));
      const thickness = Number.isFinite(heightScale) && heightScale > 0
        ? Math.max(0.0015, heightScale * base)
        : Math.max(0.001, radius * 0.65);
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
      const rgbaContact = visStruct?.rgba?.contact;
      const contactColorHex = segmentEnabled
        ? segmentColorForIndex(contacts?.n ? contacts.n + 1 : 0)
        : rgbaToHex(rgbaContact, CONTACT_POINT_FALLBACK_COLOR);
      const contactOpacity = segmentEnabled ? 1 : alphaFromArray(rgbaContact, 0.85);
      if (!group.userData.material) {
      group.userData.material = new THREE.MeshBasicMaterial({
        color: contactColorHex,
        side: THREE.DoubleSide,
        transparent: contactOpacity < 0.999,
        opacity: contactOpacity,
        depthTest: true,
        depthWrite: true,
        toneMapped: false,
        fog: false,
      });
      } else {
        group.userData.material.color.setHex(contactColorHex);
        group.userData.material.opacity = contactOpacity;
        group.userData.material.transparent = contactOpacity < 0.999;
        group.userData.material.depthWrite = true;
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
        const group = ensureContactForceGroup(context);
        const pool = Array.isArray(context.contactForcePool) ? context.contactForcePool : (context.contactForcePool = []);
        const meanMass = (() => {
          const value = Number(statStruct?.meanmass);
          if (Number.isFinite(value) && value > 1e-9) return value;
          return 1;
        })();
        const { meanSize, scaleAll } = computeMeanScale(state, context);
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
        const shaftRadius = Math.max(meanSize * 0.015, forceWidthScale * meanSize * 0.5, 0.008) * scaleAll;
        const minLength = Math.max(shaftRadius * 2.5, meanSize * 0.02);
        const fallbackLength = Math.max(minLength, shaftRadius * 3);
        const maxLength = Math.max(meanSize * 6, (context.bounds?.radius || meanSize) * 8);
        const lengthScale = (mapForce / meanMass) * scaleAll;
        const frame = ArrayBuffer.isView(contacts.frame) ? contacts.frame : null;
        const force = ArrayBuffer.isView(contacts.force) ? contacts.force : null;
      const rgbaContactForce = visStruct?.rgba?.contactforce;
      const colorHex = segmentEnabled
        ? segmentColorForIndex(contacts.n + 2)
        : rgbaToHex(rgbaContactForce, CONTACT_FORCE_FALLBACK_COLOR);
      const colorOpacity = segmentEnabled ? 1 : alphaFromArray(rgbaContactForce, 0.8);
        if (!context.contactForceMaterial) {
          context.contactForceMaterial = new THREE.MeshBasicMaterial({
            color: colorHex,
            transparent: colorOpacity < 0.999,
            opacity: colorOpacity,
            depthWrite: true,
            toneMapped: false,
            fog: false,
          });
        } else {
          context.contactForceMaterial.color.setHex(colorHex);
          context.contactForceMaterial.opacity = colorOpacity;
          context.contactForceMaterial.transparent = colorOpacity < 0.999;
          context.contactForceMaterial.depthWrite = true;
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
    if (defaults) {
      for (let idx = 0; idx < Math.min(defaults.length, voptFlags.length); idx += 1) {
        const def = defaults[idx];
        const val = voptFlags[idx];
        if (def && !val) {
          hideAllGeometry = true;
          break;
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
    let drawn = 0;
    const sizeView = snapshot.gsize || assets?.geoms?.size || null;
    const typeView = snapshot.gtype || assets?.geoms?.type || null;
    const dataIdView = snapshot.gdataid || assets?.geoms?.dataid || null;
    const matIdView = snapshot.gmatid || assets?.geoms?.matid || null;
    const bodyIdView = state?.model?.geomBodyId || null;
    const overlayOptions = {
      geomGroupIds,
      geomGroupMask,
      hideAllGeometry,
      typeView,
      bounds: nextBounds || context.bounds || null,
    };
    updateFrameOverlays(context, snapshot, state, overlayOptions);
    updateLabelOverlays(context, snapshot, state, overlayOptions);
    const showCamera = voptEnabled(voptFlags, MJ_VIS.CAMERA);
    let cameraDescriptors = null;
    const showLight = voptEnabled(voptFlags, MJ_VIS.LIGHT);
    const showCom = voptEnabled(voptFlags, MJ_VIS.COM);
    const showJoint = voptEnabled(voptFlags, MJ_VIS.JOINT);
      const showActuator = voptEnabled(voptFlags, MJ_VIS.ACTUATOR);
      const showRangefinder = voptEnabled(voptFlags, MJ_VIS.RANGEFINDER);
      const showConstraint = voptEnabled(voptFlags, MJ_VIS.CONSTRAINT);

    if (showCamera) {
        cameraDescriptors = buildCameraOverlayDescriptors(snapshot, state, context);
        applyCameraOverlayDescriptors(context, cameraDescriptors);
      } else {
        hideCameraGroup(context);
      }
    if (showLight) updateLightOverlays(context, snapshot, state);
    else hideLightGroup(context);
    if (showCom) updateComOverlays(context, snapshot, state);
    else hideComGroup(context);
    if (showJoint) updateJointOverlays(context, snapshot, state);
    else hideJointGroup(context);
    if (showActuator) updateActuatorOverlays(context, snapshot, state);
    else hideActuatorGroup(context);
    if (showActuator) updateSlidercrankOverlays(context, snapshot, state);
    else hideSlidercrankGroup(context);
    if (showRangefinder) updateRangefinderOverlays(context, snapshot, state);
    else hideRangefinderGroup(context);
      if (showConstraint) updateConstraintOverlays(context, snapshot, state);
      else hideConstraintGroup(context);
    // Perturb overlay is driven by runtime.pertViz in state; do not gate on vopt flags.
      updatePerturbOverlay(context, snapshot, state, overlayOptions);

      const geomDescriptors = buildGeomDescriptors(snapshot, state, assets);
    drawn = applyGeomDescriptors(context, geomDescriptors, {
      assets,
      state,
      snapshot,
      sceneFlags,
      reflectionEnabled,
      hideAllGeometry,
      geomGroupIds,
      geomGroupMask,
    });

    context.ground = null;
    for (let i = 0; i < ngeom; i += 1) {
      const candidate = context.meshes?.[i] || null;
      if (candidate?.userData?.infinitePlane && candidate.visible) {
        context.ground = candidate;
        break;
      }
    }

    if (voptEnabled(voptFlags, MJ_VIS.SELECT)) {
      updateSelectionOverlay(context, snapshot, state);
    } else {
      clearSelectionHighlight(context);
      hideSelectionPoint(context);
    }

    const stats = {
      drawn,
      hidden: Math.max(0, ngeom - drawn),
      contacts: snapshot.contacts?.n ?? 0,
      t: typeof snapshot.t === 'number' ? snapshot.t : null,
      frame: ctx._frameCounter | 0,
    };
    setRenderStats(stats);
    if (debugSceneEnabled) {
      const contacts = snapshot.contacts || null;
      const contactCount = typeof contacts?.n === 'number' ? (contacts.n | 0) : 0;
      const contactDebug = {
        n: contactCount,
        hasPos: !!contacts?.pos,
        hasFrame: !!contacts?.frame,
        hasForce: !!contacts?.force,
      };
      const sceneDebugPayload = {
        stats: {
          ngeom,
          drawn,
          hidden: Math.max(0, ngeom - drawn),
          contacts: {
            n: contactCount,
          },
        },
        geoms: Array.isArray(geomDescriptors) ? geomDescriptors : [],
      };
      debugSceneDescriptors(context, sceneDebugPayload);
      try {
        if (typeof window !== 'undefined') {
          window.__contactDebug = contactDebug;
        }
      } catch {}
    }
    try {
      if (typeof window !== 'undefined') {
        window.__drawnCount = drawn;
        window.__ngeom = ngeom;
      }
    } catch {}

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
        const minFar = Math.max(GROUND_DISTANCE * 2.5, 400);
        const desiredFar = Math.max(minFar, Math.max(radius, ctx.trackingRadius || radius) * 10);
        if (context.camera.far < desiredFar) {
          context.camera.far = desiredFar;
          if (typeof context.camera.updateProjectionMatrix === 'function') {
            context.camera.updateProjectionMatrix();
          }
        }
        context.autoAligned = true;
        if (typeof window !== 'undefined' && window.PLAY_VERBOSE_DEBUG === true) {
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
        target.clone().add(new THREE.Vector3(radius * 0.8, -radius * 0.8, radius * 0.6))
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
    const gl = renderer && typeof renderer.getContext === 'function' ? renderer.getContext() : null;
    // Legacy magenta framebuffer test removed; keep flag to avoid re-running in old sessions.
    if (gl && !context.__debugMagentaTested) {
      context.__debugMagentaTested = true;
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
    if (ctx.frameId != null && typeof window !== 'undefined' && window.cancelAnimationFrame) {
      try { window.cancelAnimationFrame(ctx.frameId); } catch {}
      ctx.frameId = null;
    }
    if (ctx.renderer && typeof ctx.renderer.dispose === 'function') {
      try { ctx.renderer.dispose(); } catch {}
    }
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








function hideSelectionPoint(ctx) {
  const overlay = ctx?.selectionPoint?.mesh;
  if (overlay) {
    overlay.visible = false;
  }
}

function ensureSelectionPointOverlay(ctx) {
  if (!ctx) return null;
  if (ctx.selectionPoint?.mesh) return ctx.selectionPoint;
  const group = ensureSelectionGroup(ctx);
  const geometry = new THREE.SphereGeometry(1, 18, 12);
  const material = new THREE.MeshBasicMaterial({
    color: SELECT_POINT_FALLBACK_COLOR,
    transparent: false,
    depthWrite: true,
    toneMapped: false,
    fog: false,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'overlay:selectpoint';
  mesh.matrixAutoUpdate = true;
  mesh.renderOrder = 10;
  mesh.visible = false;
  if (group) {
    group.add(mesh);
  } else {
    const worldScene = getWorldScene(ctx);
    if (worldScene) worldScene.add(mesh);
  }
  ctx.selectionPoint = { mesh, material, geometry };
  return ctx.selectionPoint;
}

function clearSelectionHighlight(ctx) {
  const hl = ctx?.selectionHighlight;
  if (!hl?.mesh) return;
  try {
    hl.mesh.material = hl.originalMaterial;
    const dispose = (mat) => {
      if (mat && typeof mat.dispose === 'function') {
        try { mat.dispose(); } catch {}
      }
    };
    if (Array.isArray(hl.highlightMaterial)) {
      hl.highlightMaterial.forEach(dispose);
    } else {
      dispose(hl.highlightMaterial);
    }
    if (hl.overlay && hl.overlay.parent) {
      hl.overlay.parent.remove(hl.overlay);
    }
    dispose(hl.overlayMaterial);
  } catch {}
  ctx.selectionHighlight = null;
}

function applySelectionHighlight(ctx, mesh) {
  if (!mesh) {
    clearSelectionHighlight(ctx);
    return;
  }
  if (ctx.selectionHighlight?.mesh === mesh) {
    const target = ctx.selectionHighlight.highlightMaterial;
    if (mesh.material !== target) {
      mesh.material = target;
    }
    return;
  }
  clearSelectionHighlight(ctx);
  const originalMaterial = mesh.material;
  const highlightMaterial = Array.isArray(originalMaterial)
    ? originalMaterial.map((mat) => cloneHighlightMaterial(mat))
    : cloneHighlightMaterial(originalMaterial);
  const overlayMaterial = new THREE.MeshBasicMaterial({
    color: SELECTION_OVERLAY_COLOR,
    transparent: true,
    opacity: 0.5,
    depthWrite: false,
    toneMapped: false,
    fog: false,
  });
  const overlay = new THREE.Mesh(mesh.geometry, overlayMaterial);
  overlay.position.set(0, 0, 0);
  overlay.quaternion.set(0, 0, 0, 1);
  overlay.scale.set(1.02, 1.02, 1.02);
  overlay.renderOrder = (mesh.renderOrder || 0) + 0.5;
  overlay.userData = { selectionOverlay: true };
  mesh.add(overlay);
  mesh.material = highlightMaterial;
  ctx.selectionHighlight = {
    mesh,
    originalMaterial,
    highlightMaterial,
    overlay,
    overlayMaterial,
  };
}

  function updateSelectionOverlay(ctx, snapshot, state) {
  const selection = state?.runtime?.selection;
  if (!selection || selection.geom < 0) {
    clearSelectionHighlight(ctx);
    hideSelectionPoint(ctx);
    return;
  }
  const mesh = Array.isArray(ctx.meshes) ? ctx.meshes[selection.geom] : null;
  if (!mesh) {
    clearSelectionHighlight(ctx);
    hideSelectionPoint(ctx);
    return;
  }
  applySelectionHighlight(ctx, mesh);
  const point = (() => {
    if (Array.isArray(selection.localPoint) && selection.localPoint.length >= 3 && mesh.matrixWorld) {
      const lp = __TMP_VEC3_A.set(
        Number(selection.localPoint[0]) || 0,
        Number(selection.localPoint[1]) || 0,
        Number(selection.localPoint[2]) || 0,
      );
      return lp.applyMatrix4(mesh.matrixWorld).toArray();
    }
    if (Array.isArray(selection.point) && selection.point.length >= 3) {
      return selection.point.map((n) => Number(n) || 0);
    }
    return null;
  })();
  if (!point) {
    hideSelectionPoint(ctx);
    return;
  }
    const overlay = ensureSelectionPointOverlay(ctx);
    if (!overlay) return;
    const scaleStruct = state?.model?.vis?.scale || {};
    const rgbaStruct = state?.model?.vis?.rgba || {};
    const { scaleAll } = computeMeanScale(state, ctx);
  const selectScale = Number.isFinite(Number(scaleStruct.selectpoint)) && Number(scaleStruct.selectpoint) > 0
    ? Number(scaleStruct.selectpoint)
    : 0.2;
  const boundsRadius = Math.max(0.05, ctx?.bounds?.radius || 1);
  const radius = Math.max(0.003, boundsRadius * 0.0125 * scaleAll * selectScale);
  const colorHex = rgbaToHex(rgbaStruct.selectpoint, SELECT_POINT_FALLBACK_COLOR);
  const opacity = alphaFromArray(rgbaStruct.selectpoint, 1);
  const normal = Array.isArray(selection.normal) && selection.normal.length >= 3
    ? __TMP_VEC3_B.set(
        Number(selection.normal[0]) || 0,
        Number(selection.normal[1]) || 0,
        Number(selection.normal[2]) || 1,
      ).normalize()
    : __TMP_VEC3_B.set(0, 0, 1);
  const offset = normal.clone().multiplyScalar(radius * 0.4);
  overlay.mesh.position.set(
    Number(point[0]) + offset.x || 0,
    Number(point[1]) + offset.y || 0,
    Number(point[2]) + offset.z || 0,
  );
  overlay.mesh.scale.set(radius, radius, radius);
  overlay.mesh.visible = true;
  overlay.material.color.setHex(colorHex);
  overlay.material.opacity = opacity;
  overlay.material.transparent = opacity < 0.999;
  overlay.material.depthWrite = true;
  overlay.material.needsUpdate = true;
}
