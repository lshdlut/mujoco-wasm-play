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
  SDF: 8,
  FLEX: 100,
  SKIN: 101,
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
  GEOMFROMTO: 41,
  TACTILE: 46,
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
const __TMP_VEC3_D = new THREE.Vector3();
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
const OVERLAY_SUBTYPE = {
  SELECTION_POINT: 'selection_point',
  SELECTION_HIGHLIGHT: 'selection_highlight',
  LIGHT: 'light',
  COM: 'com',
  JOINT: 'joint',
  ACTUATOR: 'actuator',
  SLIDERCRANK: 'slidercrank',
  RANGEFINDER: 'rangefinder',
  CONSTRAINT: 'constraint',
  CONTACT_POINT: 'contact_point',
  CONTACT_FORCE: 'contact_force',
  CAMERA: 'camera',
  PERTURB_TRANSLATE: 'perturb_translate',
  PERTURB_ROTATE: 'perturb_rotate',
};
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
  // Allow preset overlays to tweak highlight colours.
  let highlightColor = SELECTION_HIGHLIGHT_COLOR;
  let emissiveColor = SELECTION_EMISSIVE_COLOR;
  try {
    const ctx = typeof renderCtx !== 'undefined' ? renderCtx : null;
    const overlayCfg = ctx?.fallback?.overlays || null;
    if (overlayCfg && Number.isFinite(overlayCfg.selectionHighlight)) {
      highlightColor = new THREE.Color(overlayCfg.selectionHighlight);
    }
    if (overlayCfg && Number.isFinite(overlayCfg.selectionEmissive)) {
      emissiveColor = new THREE.Color(overlayCfg.selectionEmissive);
    }
  } catch {}
  if ('emissive' in cloned && cloned.emissive?.set) {
    cloned.emissive = cloned.emissive.clone();
    cloned.emissive.copy(emissiveColor);
    cloned.emissiveIntensity = Math.max(1.4, cloned.emissiveIntensity ?? 1);
  }
  if ('color' in cloned && cloned.color?.lerp) {
    cloned.color = cloned.color.clone();
    cloned.color.lerp(highlightColor, 0.65);
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
const GROUND_DISTANCE = 2000;
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
const SELECTION_TEMP_VEC = new THREE.Vector3();
const SELECTION_NORMAL_VEC = new THREE.Vector3();

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
  const baseClear = typeof ctx.baseClearHex === 'number' ? ctx.baseClearHex : DEFAULT_CLEAR_HEX;
  const skyEnabled = enabled !== false;
  if (!skyEnabled) {
    if (ctx.skyShader) ctx.skyShader.visible = false;
    worldScene.environment = null;
    worldScene.background = new THREE.Color(useBlackBackground ? 0x000000 : baseClear);
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
  worldScene.background = new THREE.Color(baseClear);
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

function resolveSiteAppearance(index, assets) {
  const matIdView = assets?.sites?.matid || null;
  const matIndex = matIdView && index < matIdView.length ? matIdView[index] : -1;
  const matRgbaView = assets?.materials?.rgba || null;
  const siteRgbaView = assets?.sites?.rgba || null;
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
  if (matIndex < 0 && siteRgbaView && siteRgbaView.length >= (index * 4 + 4)) {
    const base = index * 4;
    const rgba = [
      siteRgbaView[base + 0],
      siteRgbaView[base + 1],
      siteRgbaView[base + 2],
      siteRgbaView[base + 3],
    ];
    return {
      rgba,
      color: rgbFromArray(rgba),
      opacity: alphaFromArray(rgba),
    };
  }
  return { rgba: null, color: null, opacity: null };
}

function resolveTendonAppearance(index, assets) {
  const matIdView = assets?.tendons?.matid || null;
  const matIndex = matIdView && index < matIdView.length ? matIdView[index] : -1;
  const matRgbaView = assets?.materials?.rgba || null;
  const tendonRgbaView = assets?.tendons?.rgba || null;
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
  if (matIndex < 0 && tendonRgbaView && tendonRgbaView.length >= (index * 4 + 4)) {
    const base = index * 4;
    const rgba = [
      tendonRgbaView[base + 0],
      tendonRgbaView[base + 1],
      tendonRgbaView[base + 2],
      tendonRgbaView[base + 3],
    ];
    return {
      rgba,
      color: rgbFromArray(rgba),
      opacity: alphaFromArray(rgba),
    };
  }
  return { rgba: null, color: null, opacity: null };
}

function resolveFlexAppearance(index, assets) {
  const matIdView = assets?.flexes?.matid || null;
  const matIndex = matIdView && index < matIdView.length ? matIdView[index] : -1;
  const matRgbaView = assets?.materials?.rgba || null;
  const flexRgbaView = assets?.flexes?.rgba || null;
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
  if (matIndex < 0 && flexRgbaView && flexRgbaView.length >= (index * 4 + 4)) {
    const base = index * 4;
    const rgba = [
      flexRgbaView[base + 0],
      flexRgbaView[base + 1],
      flexRgbaView[base + 2],
      flexRgbaView[base + 3],
    ];
    return {
      rgba,
      color: rgbFromArray(rgba),
      opacity: alphaFromArray(rgba),
    };
  }
  return { rgba: null, color: null, opacity: null };
}

function resolveSkinAppearance(index, assets) {
  const matIdView = assets?.skins?.matid || null;
  const matIndex = matIdView && index < matIdView.length ? matIdView[index] : -1;
  const matRgbaView = assets?.materials?.rgba || null;
  const skinRgbaView = assets?.skins?.rgba || null;
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
  if (matIndex < 0 && skinRgbaView && skinRgbaView.length >= (index * 4 + 4)) {
    const base = index * 4;
    const rgba = [
      skinRgbaView[base + 0],
      skinRgbaView[base + 1],
      skinRgbaView[base + 2],
      skinRgbaView[base + 3],
    ];
    return {
      rgba,
      color: rgbFromArray(rgba),
      opacity: alphaFromArray(rgba),
    };
  }
  return { rgba: null, color: null, opacity: null };
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
    repeatX = Number(repeatView[matId * 2 + 0]) || 1;
    repeatY = Number(repeatView[matId * 2 + 1]) || 1;
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
  tex.generateMipmaps = false;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.flipY = true;
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

function resolveMuJoCoTexcoordScale3(geomType, geomSize) {
  const sx = Math.abs(Number(geomSize?.[0]) || 0);
  const sy = Math.abs(Number(geomSize?.[1]) || 0);
  const sz = Math.abs(Number(geomSize?.[2]) || 0);
  switch (geomType | 0) {
    case MJ_GEOM.PLANE:
    case MJ_GEOM.HFIELD:
    case MJ_GEOM.BOX:
    case MJ_GEOM.SPHERE:
    case MJ_GEOM.ELLIPSOID:
    case MJ_GEOM.CYLINDER:
    case MJ_GEOM.CAPSULE:
      return {
        scaleX: Math.max(MJ_MINVAL, sx),
        scaleY: Math.max(MJ_MINVAL, sy),
        scaleZ: Math.max(MJ_MINVAL, sz),
      };
    default:
      return {
        scaleX: Math.max(MJ_MINVAL, sx),
        scaleY: Math.max(MJ_MINVAL, sy),
        scaleZ: Math.max(MJ_MINVAL, sz),
      };
  }
}

function ensureMuJoCo2DGeneratedTexcoords(mesh, geomType, geomSize, geomDataId, matId, descriptor) {
  if (!mesh || !mesh.geometry) return;
  const geometry = mesh.geometry;
  const positionAttr = geometry.getAttribute?.('position') || null;
  if (!positionAttr || !(positionAttr.count > 0)) return;

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

  const { scaleX, scaleY } = resolveMuJoCoTexcoordScale3(geomType, geomSize);
  const vcount = positionAttr.count | 0;
  const key = [
    'mj2d:v1',
    matId | 0,
    Number.isFinite(scl0) ? scl0.toFixed(6) : '0',
    Number.isFinite(scl1) ? scl1.toFixed(6) : '0',
    Number.isFinite(scaleX) ? scaleX.toFixed(6) : '0',
    Number.isFinite(scaleY) ? scaleY.toFixed(6) : '0',
    geomType | 0,
    did,
    vcount,
  ].join(':');

  const userData = mesh.userData || (mesh.userData = {});
  if (userData.mj2dTexcoordKey === key) return;

  if (userData.ownGeometry === false) {
    const cloned = geometry.clone();
    mesh.geometry = cloned;
    userData.ownGeometry = true;
  }

  const uv = new Float32Array(vcount * 2);
  for (let i = 0; i < vcount; i += 1) {
    const x = positionAttr.getX(i);
    const y = positionAttr.getY(i);
    const x0 = x / scaleX;
    const y0 = y / scaleY;
    uv[i * 2 + 0] = 0.5 * scl0 * x0 - 0.5;
    uv[i * 2 + 1] = -0.5 * scl1 * y0 - 0.5;
  }
  mesh.geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  userData.mj2dTexcoordKey = key;
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
  const isInfinitePlane = !!mesh.userData?.infinitePlane;
  if (isInfinitePlane) {
    const uniforms =
      mesh.userData?.infiniteGround?.uniforms ||
      material.userData?.infiniteUniforms ||
      null;
    if (material.map) {
      material.map = null;
      material.needsUpdate = true;
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
    }
    return;
  }
  if (!assets) {
    if (material.map) {
      material.map = null;
      material.needsUpdate = true;
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
  }

  if (!desc) return;
  const texcoordMode = options?.texcoordMode || 'explicit';
  if (texType === MJ_TEXTURE.TEX2D && texcoordMode === 'generated') {
    const geomType = options?.geomType ?? (mesh.userData?.geomType ?? MJ_GEOM.BOX);
    const geomSize = options?.geomSize ?? (mesh.userData?.geomSize ?? null);
    const geomDataId = options?.geomDataId ?? (mesh.userData?.geomDataId ?? -1);
    if (Array.isArray(geomSize) && geomSize.length >= 2) {
      ensureMuJoCo2DGeneratedTexcoords(mesh, geomType, geomSize, geomDataId, matId, desc);
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
  const { scaleX, scaleY, scaleZ } = resolveMuJoCoTexcoordScale3(geomType, geomSize);
  const uniform = !!desc.uniform;
  const size0 = Number(geomSize?.[0]) || 0;
  const size1 = Number(geomSize?.[1]) || 0;
  const size2 = Number(geomSize?.[2]) || 0;
  const factorX = uniform ? size0 : 1;
  const factorY = uniform ? size1 : 1;
  const factorZ = uniform ? size2 : 1;
  const meshUserData = mesh.userData || (mesh.userData = {});
  const cubeScaleKey = [
    'cube:v1',
    matId | 0,
    uniform ? 1 : 0,
    Number.isFinite(factorX) ? factorX.toFixed(6) : '0',
    Number.isFinite(factorY) ? factorY.toFixed(6) : '0',
    Number.isFinite(factorZ) ? factorZ.toFixed(6) : '0',
    scaleX.toFixed(6),
    scaleY.toFixed(6),
    scaleZ.toFixed(6),
  ].join(':');
  let scaleVec = meshUserData.mjCubeScaleVec;
  if (!scaleVec) {
    scaleVec = new THREE.Vector3(1, 1, 1);
    meshUserData.mjCubeScaleVec = scaleVec;
    meshUserData.mjCubeScaleKey = null;
  }
  if (meshUserData.mjCubeScaleKey !== cubeScaleKey) {
    scaleVec.set(factorX / scaleX, factorY / scaleY, factorZ / scaleZ);
    meshUserData.mjCubeScaleKey = cubeScaleKey;
  }
  applyMuJoCoCubeAlbedo(mesh, cube, scaleVec, true);
}

function averageRGB(arr) {
  if (!Array.isArray(arr) || arr.length === 0) return 0;
  return arr.reduce((acc, v) => acc + (Number(v) || 0), 0) / arr.length;
}

function isDisabledFlag(mask, bitIndex) {
  const m = Number(mask) || 0;
  const bit = bitIndex | 0;
  if (bit < 0 || bit >= 31) return false;
  return (m & (1 << bit)) !== 0;
}

function vec3Norm(x, y, z) {
  return Math.sqrt(x * x + y * y + z * z);
}

function vec3NormalizeInPlace(v) {
  const x = v[0] || 0;
  const y = v[1] || 0;
  const z = v[2] || 0;
  const n = vec3Norm(x, y, z);
  if (!(n > 1e-12)) {
    v[0] = 0; v[1] = 0; v[2] = 0;
    return 0;
  }
  const inv = 1 / n;
  v[0] = x * inv;
  v[1] = y * inv;
  v[2] = z * inv;
  return n;
}

function vec3Dot(ax, ay, az, bx, by, bz) {
  return ax * bx + ay * by + az * bz;
}

function coshSinh(x) {
  const expx = Math.exp(x);
  const inv = 1 / expx;
  return {
    cosh: 0.5 * (expx + inv),
    sinh: 0.5 * (expx - inv),
  };
}

function catenaryIntercept(v, h, length) {
  const term = Math.sqrt(Math.max(0, length * length - v * v)) / Math.max(1e-12, h) - 1;
  if (!(term > 0)) return 0;
  return 1 / Math.sqrt(Math.sqrt(term));
}

function catenaryResidual(b, intercept) {
  const a = 0.5 / b;
  const { cosh, sinh } = coshSinh(a);
  const denom = 2 * b * sinh - 1;
  if (!(denom > 0)) {
    return { res: Number.POSITIVE_INFINITY, grad: 0 };
  }
  const invSqrt = 1 / Math.sqrt(denom);
  const res = invSqrt - intercept;
  const grad = (a * cosh - sinh) * Math.pow(denom, -1.5);
  return { res, grad };
}

function solveCatenary(v, h, length) {
  const intercept = catenaryIntercept(v, h, length);
  let b = intercept / Math.sqrt(24);
  const tol = 1e-9;
  for (let i = 0; i < 50; i += 1) {
    const { res, grad } = catenaryResidual(b, intercept);
    if (Math.abs(res) < tol) break;
    let step = -res / (grad || 1e-12);
    for (let j = 0; j < 10; j += 1) {
      const next = catenaryResidual(b + step, intercept).res;
      if (Math.abs(next) < Math.abs(res)) break;
      step *= 0.5;
    }
    b += step;
  }
  return b;
}

function computeCatenaryPoints(x0, x1, gravity, length, ncatenary) {
  const dx = (x1[0] || 0) - (x0[0] || 0);
  const dy = (x1[1] || 0) - (x0[1] || 0);
  const dz = (x1[2] || 0) - (x0[2] || 0);
  const dist = vec3Norm(dx, dy, dz);
  if (!(dist > 0) || dist > length) {
    return { points: [x0.slice(), x1.slice()], npoints: 2 };
  }

  const up = [-(gravity?.[0] || 0), -(gravity?.[1] || 0), -(gravity?.[2] || 0)];
  vec3NormalizeInPlace(up);

  const across = [dx, dy, dz];
  const proj = vec3Dot(up[0], up[1], up[2], across[0], across[1], across[2]);
  across[0] -= up[0] * proj;
  across[1] -= up[1] * proj;
  across[2] -= up[2] * proj;
  const acrossNorm = vec3NormalizeInPlace(across);
  if (acrossNorm < 1e-12) {
    across[0] = 0; across[1] = 0; across[2] = 0;
  }

  const h = vec3Dot(dx, dy, dz, across[0], across[1], across[2]);
  const v = vec3Dot(dx, dy, dz, up[0], up[1], up[2]);

  if (length > 100 * h) {
    const dUp = -0.5 * (Math.sqrt(Math.max(0, length * length - h * h)) - v);
    const denom = 2 * dUp - v;
    const dAcross = Math.abs(denom) > 1e-12 ? (h * dUp) / denom : 0;
    const mid = [
      (x0[0] || 0) + up[0] * dUp + across[0] * dAcross,
      (x0[1] || 0) + up[1] * dUp + across[1] * dAcross,
      (x0[2] || 0) + up[2] * dUp + across[2] * dAcross,
    ];
    return { points: [x0.slice(), mid, x1.slice()], npoints: 3 };
  }

  const n = Math.max(2, Math.min(100, ncatenary | 0));
  const bh = solveCatenary(v, h, length) * h;
  const ratio = (length + v) / Math.max(1e-12, (length - v));
  const hOffset = -0.5 * (Math.log(Math.max(1e-12, ratio)) * bh - h);
  const vOffset = -coshSinh(hOffset / bh).cosh * bh;
  const points = [];
  points.push(x0.slice());
  for (let i = 1; i < n - 1; i += 1) {
    const horizontal = (i * h) / n;
    const t = (horizontal - hOffset) / bh;
    const vertical = bh * coshSinh(t).cosh + vOffset;
    points.push([
      (x0[0] || 0) + across[0] * horizontal + up[0] * vertical,
      (x0[1] || 0) + across[1] * horizontal + up[1] * vertical,
      (x0[2] || 0) + across[2] * horizontal + up[2] * vertical,
    ]);
  }
  points.push(x1.slice());
  return { points, npoints: points.length };
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
  // Fog colour:
  // - primary source: model vis.rgba.fog (if present)
  // - otherwise: viewer/preset fallback decides, see render loop.
  let fogColor = null;
  if (vis?.rgba?.fog != null) {
    const colorArr = rgbFromArray(vis.rgba.fog);
    fogColor = new THREE.Color().setRGB(colorArr[0], colorArr[1], colorArr[2]);
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
      fov: 75,
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
    ctx.trackingOffset = new THREE.Vector3(radius * 2.6, -radius * 2.6, radius * 1.2);
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
    const mode = state?.visualSourceMode ?? 'model';
    const presetMode = mode === 'preset' || mode === 'preset-sun' || mode === 'preset-moon';
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
  } else if (mode === LABEL_MODES.ISLAND) {
    const nisland = snapshot?.nisland | 0;
    const dofIsland = snapshot?.dof_island || null;
    const xipos = snapshot?.xipos || null;
    const bodies = state?.rendering?.assets?.bodies || snapshot?.renderAssets?.bodies || null;
    const weldid = bodies?.weldid || null;
    const dofadr = bodies?.dofadr || null;
    const dofnum = bodies?.dofnum || null;
    if (!(nisland > 0) || !dofIsland || !xipos || !weldid || !dofadr || !dofnum) {
      hideLabelGroup(context);
      return;
    }
    const nbody = Math.min(Math.floor(xipos.length / 3), weldid.length, dofadr.length, dofnum.length);
    const limit = Math.min(nbody, maxLabels + 1);
    for (let i = 1; i < limit; i += 1) {
      const weld = weldid[i] | 0;
      if (weld < 0 || weld >= nbody) continue;
      if ((dofnum[weld] | 0) <= 0) continue;
      const adr = dofadr[weld] | 0;
      if (adr < 0 || adr >= dofIsland.length) continue;
      const islandId = dofIsland[adr] | 0;
      if (islandId <= -1) continue;
      const base = 3 * i;
      emitLabel(
        Number(xipos[base + 0]) || 0,
        Number(xipos[base + 1]) || 0,
        Number(xipos[base + 2]) || 0,
        String(islandId),
      );
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
  const overlayCfg = ctx.fallback?.overlays || null;
  const lightFallback =
    overlayCfg && Number.isFinite(overlayCfg.light)
      ? overlayCfg.light
      : 0x8899ff;
  const colorHex = rgbaToHex(visRgba.light, lightFallback);
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
  const overlayCfg = ctx.fallback?.overlays || null;
  const comFallback =
    overlayCfg && Number.isFinite(overlayCfg.com)
      ? overlayCfg.com
      : 0xe6e6e6;
  const colorHex = rgbaToHex(visRgba.com, comFallback);
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

function buildJointOverlayDescriptors(snapshot, state, ctx) {
  const jpos = snapshot?.jpos;
  const jaxis = snapshot?.jaxis;
  const jbody = snapshot?.jbody;
  const bxpos = snapshot?.bxpos;
  const bxmat = snapshot?.bxmat;
  if (!jpos || !jaxis || !jbody || !bxpos || !bxmat) {
    return [];
  }
  const visScale = state?.model?.vis?.scale || {};
  const visRgba = state?.model?.vis?.rgba || {};
  const { meanSize, scaleAll } = computeMeanScale(state, ctx);
  const lenScale = Math.max(1e-6, Number(visScale.jointlength) || 1) * scaleAll;
  const widthScale = Math.max(1e-6, Number(visScale.jointwidth) || 1) * scaleAll;
  const overlayCfg = ctx?.fallback?.overlays || null;
  const jointFallback =
    overlayCfg && Number.isFinite(overlayCfg.joint)
      ? overlayCfg.joint
      : 0x3399cc;
  const colorHex = rgbaToHex(visRgba.joint, jointFallback);
  const opacity = alphaFromArray(visRgba.joint, 1);
  const nj = Math.floor(jpos.length / 3);
  const nbody = Math.floor(bxpos.length / 3);
  const descriptors = [];
  for (let i = 0; i < nj; i += 1) {
    const bodyId = Number(jbody[i]) || 0;
    if (bodyId < 0 || bodyId >= nbody) continue;
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
    const base = 3 * i;
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
    let worldAxis = localAxis.clone().applyMatrix4(bodyMat);
    if (worldAxis.lengthSq() <= 0) {
      worldAxis = PERTURB_AXIS_DEFAULT.clone();
    } else {
      worldAxis.normalize();
    }
    const length = Math.max(1e-4, meanSize * lenScale);
    const width = Math.max(1e-4, meanSize * widthScale);
    const headLength = Math.min(length * 0.35, Math.max(length * 0.25, width * 4));
    const shaftLength = Math.max(1e-4, length - headLength);
    const headRadius = width * 1.8;
    descriptors.push({
      kind: 'overlay',
      subtype: OVERLAY_SUBTYPE.JOINT,
      index: i,
      position: [worldAnchor.x, worldAnchor.y, worldAnchor.z],
      direction: [worldAxis.x, worldAxis.y, worldAxis.z],
      shaftLength,
      headLength,
      shaftRadius: width,
      headRadius,
      colorHex,
      opacity,
    });
  }
  return descriptors;
}

function applyJointOverlayDescriptors(ctx, descriptors) {
  if (!ctx) return;
  const group = ensureJointGroup(ctx);
  if (!Array.isArray(descriptors) || descriptors.length === 0) {
    hideJointGroup(ctx);
    return;
  }
  const pool = ctx.jointPool || (ctx.jointPool = []);
  let used = 0;
  for (const desc of descriptors) {
    if (!desc || desc.subtype !== OVERLAY_SUBTYPE.JOINT) continue;
    let node = pool[used];
    if (!node) {
      const mat = new THREE.MeshBasicMaterial({
        color: desc.colorHex,
        transparent: desc.opacity < 0.999,
        opacity: desc.opacity,
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
    node.position.set(desc.position[0], desc.position[1], desc.position[2]);
    __TMP_VEC3.set(
      desc.direction?.[0] ?? 0,
      desc.direction?.[1] ?? 1,
      desc.direction?.[2] ?? 0,
    );
    if (__TMP_VEC3.lengthSq() <= 0) {
      __TMP_VEC3.copy(PERTURB_AXIS_DEFAULT);
    } else {
      __TMP_VEC3.normalize();
    }
    node.quaternion.setFromUnitVectors(PERTURB_AXIS_DEFAULT, __TMP_VEC3);
    const shaft = node.userData?.shaft;
    if (shaft) {
      shaft.scale.set(desc.shaftRadius, desc.shaftLength, desc.shaftRadius);
      shaft.position.set(0, desc.shaftLength / 2, 0);
    }
    const head = node.userData?.head;
    if (head) {
      head.scale.set(desc.headRadius, desc.headLength, desc.headRadius);
      head.position.set(0, desc.shaftLength + desc.headLength / 2, 0);
    }
    const mat = node.userData?.material;
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
  ctx.jointPool = pool;
}

function buildActuatorOverlayDescriptors(snapshot, state, ctx) {
  const trnid = snapshot?.act_trnid;
  const trntype = snapshot?.act_trntype;
  const jpos = snapshot?.jpos;
  const jaxis = snapshot?.jaxis;
  const jbody = snapshot?.jbody;
  const bxpos = snapshot?.bxpos;
  const bxmat = snapshot?.bxmat;
  if (!trnid || !trntype || !jpos || !jaxis || !jbody || !bxpos || !bxmat) {
    return [];
  }
  const visScale = state?.model?.vis?.scale || {};
  const visRgba = state?.model?.vis?.rgba || {};
  const { meanSize, scaleAll } = computeMeanScale(state, ctx);
  const lenScale = Math.max(1e-6, Number(visScale.actuatorlength) || 1) * scaleAll;
  const widthScale = Math.max(1e-6, Number(visScale.actuatorwidth) || 1) * scaleAll;
  const overlayCfg = ctx?.fallback?.overlays || null;
  const actuatorFallback =
    overlayCfg && Number.isFinite(overlayCfg.actuator)
      ? overlayCfg.actuator
      : 0x2b90d9;
  const colorHex = rgbaToHex(visRgba.actuator, actuatorFallback);
  const opacity = alphaFromArray(visRgba.actuator, 1);
  const na = Math.floor(trntype.length);
  const nj = Math.floor(jpos.length / 3);
  const nbody = Math.floor(bxpos.length / 3);
  const descriptors = [];
  for (let i = 0; i < na; i += 1) {
    const t = Number(trntype[i]) | 0;
    if (t !== MJ_TRN.JOINT && t !== MJ_TRN.JOINTINPARENT) continue;
    const jid = trnid ? (trnid[2 * i] | 0) : -1;
    if (jid < 0 || jid >= nj) continue;
    const bodyId = Number(jbody[jid]) || 0;
    if (bodyId < 0 || bodyId >= nbody) continue;
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
    const base = 3 * jid;
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
    let worldAxis = localAxis.clone().applyMatrix4(bodyMat);
    if (worldAxis.lengthSq() <= 0) {
      worldAxis = PERTURB_AXIS_DEFAULT.clone();
    } else {
      worldAxis.normalize();
    }
    const length = Math.max(1e-4, meanSize * lenScale);
    const width = Math.max(1e-4, meanSize * widthScale);
    const headLength = Math.min(length * 0.35, Math.max(length * 0.25, width * 4));
    const shaftLength = Math.max(1e-4, length - headLength);
    const headRadius = width * 1.9;
    descriptors.push({
      kind: 'overlay',
      subtype: OVERLAY_SUBTYPE.ACTUATOR,
      index: i,
      position: [worldAnchor.x, worldAnchor.y, worldAnchor.z],
      direction: [worldAxis.x, worldAxis.y, worldAxis.z],
      shaftLength,
      headLength,
      shaftRadius: width,
      headRadius,
      colorHex,
      opacity,
    });
  }
  return descriptors;
}

function applyActuatorOverlayDescriptors(ctx, descriptors) {
  if (!ctx) return;
  const group = ensureActuatorGroup(ctx);
  if (!Array.isArray(descriptors) || descriptors.length === 0) {
    hideActuatorGroup(ctx);
    return;
  }
  const pool = ctx.actuatorPool || (ctx.actuatorPool = []);
  let used = 0;
  for (const desc of descriptors) {
    if (!desc || desc.subtype !== OVERLAY_SUBTYPE.ACTUATOR) continue;
    let node = pool[used];
    if (!node) {
      const mat = new THREE.MeshBasicMaterial({
        color: desc.colorHex,
        transparent: desc.opacity < 0.999,
        opacity: desc.opacity,
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
    node.position.set(desc.position[0], desc.position[1], desc.position[2]);
    __TMP_VEC3.set(
      desc.direction?.[0] ?? 0,
      desc.direction?.[1] ?? 1,
      desc.direction?.[2] ?? 0,
    );
    if (__TMP_VEC3.lengthSq() <= 0) {
      __TMP_VEC3.copy(PERTURB_AXIS_DEFAULT);
    } else {
      __TMP_VEC3.normalize();
    }
    node.quaternion.setFromUnitVectors(PERTURB_AXIS_DEFAULT, __TMP_VEC3);
    const shaft = node.userData?.shaft;
    if (shaft) {
      shaft.scale.set(desc.shaftRadius, desc.shaftLength, desc.shaftRadius);
      shaft.position.set(0, desc.shaftLength / 2, 0);
    }
    const head = node.userData?.head;
    if (head) {
      head.scale.set(desc.headRadius, desc.headLength, desc.headRadius);
      head.position.set(0, desc.shaftLength + desc.headLength / 2, 0);
    }
    const mat = node.userData?.material;
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
  ctx.actuatorPool = pool;
}

function buildSlidercrankOverlayDescriptors(snapshot, state, ctx) {
  const actuatorAssets = state?.rendering?.assets?.actuators || snapshot?.renderAssets?.actuators || null;
  const trnid = actuatorAssets?.trnid || snapshot?.act_trnid;
  const trntype = actuatorAssets?.trntype || snapshot?.act_trntype;
  const crankLength = actuatorAssets?.cranklength || snapshot?.act_cranklength;
  const siteXpos = snapshot?.site_xpos;
  const siteXmat = snapshot?.site_xmat;
  if (!trnid || !trntype || !crankLength || !siteXpos || !siteXmat) {
    return [];
  }
  const visScale = state?.model?.vis?.scale || {};
  const visRgba = state?.model?.vis?.rgba || {};
  const { meanSize, scaleAll } = computeMeanScale(state, ctx);
  const scl = Math.max(1e-6, Number(visScale.slidercrank) || 1) * scaleAll;
  const overlayCfg = ctx?.fallback?.overlays || null;
  const sliderFallback =
    overlayCfg && Number.isFinite(overlayCfg.slidercrank)
      ? overlayCfg.slidercrank
      : 0x8a6aff;
  const brokenFallback =
    overlayCfg && Number.isFinite(overlayCfg.crankbroken)
      ? overlayCfg.crankbroken
      : 0xff4d4d;
  const colorHex = rgbaToHex(visRgba.slidercrank, sliderFallback);
  const brokenColorHex = rgbaToHex(visRgba.crankbroken, brokenFallback);
  const opacity = alphaFromArray(visRgba.slidercrank, 1);
  const ns = Math.floor(siteXpos.length / 3);
  const na = Math.floor(trntype.length);
  const descriptors = [];
  let descriptorIndex = 0;
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
    const sliderDir = __TMP_VEC3_B.copy(end).sub(slider);
    const sliderDist = sliderDir.length();
    if (sliderDist > 1e-6) {
      const sliderDirNorm = sliderDir.clone().normalize();
      const sliderMid = slider.clone().add(end).multiplyScalar(0.5);
      descriptors.push({
        kind: 'overlay',
        subtype: OVERLAY_SUBTYPE.SLIDERCRANK,
        index: descriptorIndex,
        position: [sliderMid.x, sliderMid.y, sliderMid.z],
        direction: [sliderDirNorm.x, sliderDirNorm.y, sliderDirNorm.z],
        length: sliderDist,
        radius: widthBase,
        colorHex,
        opacity,
      });
      descriptorIndex += 1;
    }
    const rodDir = __TMP_VEC3_B.copy(crank).sub(end);
    const rodDist = rodDir.length();
    if (rodDist > 1e-6) {
      const rodDirNorm = rodDir.clone().normalize();
      const rodMid = crank.clone().add(end).multiplyScalar(0.5);
      descriptors.push({
        kind: 'overlay',
        subtype: OVERLAY_SUBTYPE.SLIDERCRANK,
        index: descriptorIndex,
        position: [rodMid.x, rodMid.y, rodMid.z],
        direction: [rodDirNorm.x, rodDirNorm.y, rodDirNorm.z],
        length: rodDist,
        radius: widthBase * 0.5,
        colorHex: broken ? brokenColorHex : colorHex,
        opacity,
      });
      descriptorIndex += 1;
    }
  }
  return descriptors;
}

function applySlidercrankOverlayDescriptors(ctx, descriptors) {
  if (!ctx) return;
  const group = ensureSlidercrankGroup(ctx);
  if (!Array.isArray(descriptors) || descriptors.length === 0) {
    hideSlidercrankGroup(ctx);
    return;
  }
  const pool = ctx.slidercrankPool || (ctx.slidercrankPool = []);
  let used = 0;
  for (const desc of descriptors) {
    if (!desc || desc.subtype !== OVERLAY_SUBTYPE.SLIDERCRANK) continue;
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
      mesh = new THREE.Mesh(SLIDERCRANK_SHAFT_GEOMETRY, mat);
      mesh.renderOrder = 50;
      mesh.userData.overlayKind = 'overlay';
      mesh.userData.overlaySubtype = OVERLAY_SUBTYPE.SLIDERCRANK;
      pool[used] = mesh;
      group.add(mesh);
    }
    mesh.visible = true;
    mesh.position.set(desc.position[0], desc.position[1], desc.position[2]);
    __TMP_VEC3.set(
      desc.direction?.[0] ?? 0,
      desc.direction?.[1] ?? 1,
      desc.direction?.[2] ?? 0,
    );
    if (__TMP_VEC3.lengthSq() <= 0) {
      __TMP_VEC3.copy(PERTURB_AXIS_DEFAULT);
    } else {
      __TMP_VEC3.normalize();
    }
    mesh.quaternion.setFromUnitVectors(PERTURB_AXIS_DEFAULT, __TMP_VEC3);
    const length = desc.length || 1;
    const radius = desc.radius || 0.1;
    mesh.scale.set(radius, length, radius);
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
  ctx.slidercrankPool = pool;
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
    texcoord,
    texcoordadr,
    texcoordnum,
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
          geometry.computeBoundingBox();
          geometry.computeBoundingSphere();
          return geometry;
        }
      }
    }

    // Fallback: if convex hull data is missing, render the original mesh.
  }

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
  const effectiveReflectance = clampedReflectance > 0 ? clampedReflectance : 0;
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
    ((gtype === MJ_GEOM.MESH || gtype === MJ_GEOM.SDF) && mesh.userData?.geomDataId !== dataId) ||
    (!infinitePlane && (gtype !== MJ_GEOM.MESH && gtype !== MJ_GEOM.SDF) && mesh.userData?.geomSizeKey !== sizeKey);

  if (needsRebuild) {
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
      mesh.userData.geomDataId = (gtype === MJ_GEOM.MESH || gtype === MJ_GEOM.SDF) ? dataId : -1;
      mesh.userData.geomSizeKey = (gtype === MJ_GEOM.MESH || gtype === MJ_GEOM.SDF) ? null : sizeKey;
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
function ensureGeomState(context, index, geomMeta) {
  context.geomState = context.geomState || [];
  const existing = context.geomState[index];
  if (existing && existing.mj && existing.view) {
    // Refresh mj mirror; view layer kept as-is so overrides persist across frames.
    existing.mj.type = geomMeta.type;
    existing.mj.size = Array.isArray(geomMeta.size) ? geomMeta.size.slice() : null;
    existing.mj.dataId = geomMeta.dataId;
    existing.mj.matId = geomMeta.matId;
    existing.mj.groupId = geomMeta.groupId;
    existing.mj.bodyId = geomMeta.bodyId;
    existing.mj.rgba = Array.isArray(geomMeta.rgba) ? geomMeta.rgba.slice() : null;
    return existing;
  }
  const mj = {
    type: geomMeta.type,
    size: Array.isArray(geomMeta.size) ? geomMeta.size.slice() : null,
    dataId: geomMeta.dataId,
    matId: geomMeta.matId,
    groupId: geomMeta.groupId,
    bodyId: geomMeta.bodyId,
    rgba: Array.isArray(geomMeta.rgba) ? geomMeta.rgba.slice() : null,
  };
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

function composeGeomAppearance(geomState, baseAppearance, defaultVisible) {
  if (!geomState || !geomState.view) {
    return {
      appearance: baseAppearance,
      visible: defaultVisible,
      overrides: null,
    };
  }
  const { view } = geomState;
  let visible = defaultVisible;
  if (view.debugHidden) visible = false;
  if (view.visibleOverride === true) visible = true;
  else if (view.visibleOverride === false) visible = false;

  const appearance = { ...baseAppearance };
  if (view.colorOverride && Array.isArray(view.colorOverride)) {
    const [r, g, b, a] = view.colorOverride;
    appearance.rgba = [r, g, b, a];
    appearance.color = [r, g, b];
    appearance.opacity = a;
  }
  const overrides = {};
  if (view.roughnessOverride != null) overrides.roughness = view.roughnessOverride;
  if (view.metalnessOverride != null) overrides.metalness = view.metalnessOverride;
  if (view.envMapIntensityOverride != null) overrides.envMapIntensity = view.envMapIntensityOverride;
  if (view.emissiveIntensityOverride != null) overrides.emissiveIntensity = view.emissiveIntensityOverride;

  return { appearance, visible, overrides };
}

function applyMaterialOverrides(material, overrides) {
  if (!material || !overrides) return;
  if ('roughness' in overrides && 'roughness' in material) {
    material.roughness = overrides.roughness;
  }
  if ('metalness' in overrides && 'metalness' in material) {
    material.metalness = overrides.metalness;
  }
  if ('envMapIntensity' in overrides && 'envMapIntensity' in material) {
    material.envMapIntensity = overrides.envMapIntensity;
  }
  if ('emissiveIntensity' in overrides && 'emissiveIntensity' in material) {
    material.emissiveIntensity = overrides.emissiveIntensity;
  }
  if ('needsUpdate' in material) {
    material.needsUpdate = true;
  }
}

function updateMeshFromSnapshot(mesh, i, snapshot, state, assets, sceneFlags = null, geomState = null) {
  const n = snapshot.ngeom | 0;
  if (i >= n) {
    mesh.visible = false;
    return;
  }
  const flags = Array.isArray(sceneFlags) ? sceneFlags : state?.rendering?.sceneFlags || [];
  const isInfinitePlane = !!mesh.userData?.infinitePlane;
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
  if (!isInfinitePlane) {
    if (sceneGeom) {
      const px = Number(sceneGeom.xpos?.[0]) || 0;
      const py = Number(sceneGeom.xpos?.[1]) || 0;
      const pz = Number(sceneGeom.xpos?.[2]) || 0;
      mesh.position.set(px, py, pz);
      const m = Array.isArray(sceneGeom.xmat) && sceneGeom.xmat.length >= 9
        ? sceneGeom.xmat
        : [1, 0, 0, 0, 1, 0, 0, 0, 1];
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
  }

  const baseAppearance = resolveGeomAppearance(i, sceneGeom, snapshot, assets);
  if (!baseAppearance.rgba) {
    const matIdView = snapshot.gmatid || assets?.geoms?.matid || null;
    const materials = assets?.materials || null;
    const matRgbaView = materials?.rgba || snapshot.matrgba || null;
    const matIndex = matIdView?.[i] ?? -1;
    if (Array.isArray(matRgbaView) || ArrayBuffer.isView(matRgbaView)) {
      updateMeshMaterial(mesh, matIndex, matRgbaView, materials);
      baseAppearance.rgba = [
        matRgbaView[matIndex * 4 + 0] ?? 0.6,
        matRgbaView[matIndex * 4 + 1] ?? 0.6,
        matRgbaView[matIndex * 4 + 2] ?? 0.9,
        matRgbaView[matIndex * 4 + 3] ?? 1,
      ];
      baseAppearance.color = rgbFromArray(baseAppearance.rgba);
      baseAppearance.opacity = alphaFromArray(baseAppearance.rgba);
    }
  }
  const viewDirty = !!geomState?.view?.__dirty;
  mesh.userData = mesh.userData || {};
  const segmentStateChanged = mesh.userData.segmentState !== segmentEnabled;
  mesh.userData.segmentState = segmentEnabled;
  const shouldApplyAppearance = !segmentEnabled && (viewDirty || segmentStateChanged);
  if (shouldApplyAppearance) {
    const composed = composeGeomAppearance(geomState, baseAppearance, true);
    applyAppearanceToMaterial(mesh, composed.appearance);
    applyMaterialOverrides(mesh.material, composed.overrides);
    mesh.visible = composed.visible;
    mesh.userData = mesh.userData || {};
    const alpha = composed?.appearance?.opacity;
    if (typeof alpha === 'number' && Number.isFinite(alpha)) {
      mesh.userData.baseAlpha = alpha;
    } else if (mesh.material && typeof mesh.material.opacity === 'number') {
      mesh.userData.baseAlpha = mesh.material.opacity;
    }
    if (geomState?.view) geomState.view.__dirty = false;
  }

  if (!segmentEnabled) {
    applyMaterialFlags(mesh, i, state, flags);
  }
  if (isInfinitePlane) {
    updateInfinitePlaneFromSnapshot(mesh, i, snapshot, assets, flags);
  }
}

function updateInfinitePlaneFromSnapshot(mesh, i, snapshot, assets, sceneFlags = null) {
  const groundData = mesh.userData?.infiniteGround;
  if (!groundData) return;
  const uniforms = groundData.uniforms || {};
  const segmentEnabled = Array.isArray(sceneFlags) ? !!sceneFlags[SEGMENT_FLAG_INDEX] : false;
  const userData = mesh.userData || (mesh.userData = {});
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

function updateInfinitePlaneFromSceneSoA(mesh, scnIndex, snapshot, sceneFlags = null) {
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
 * @typedef {Object} SiteDescriptor
 * @property {'site'} kind
 * @property {number} index
 * @property {number} type
 * @property {number[] | null} size
 * @property {number} matId
 * @property {number} bodyId
 * @property {number} groupId
 * @property {number[] | null} rgba
 * @property {string} name
 */

/**
 * Build descriptors for base MuJoCo sites.
 *
 * Sites are base-layer objects in simulate (addSiteGeoms) and should be rendered
 * independently of frame/label overlays.
 *
 * @param {object} snapshot
 * @param {object} state
 * @param {object | null} assets
 * @returns {SiteDescriptor[]}
 */
function buildSiteDescriptors(snapshot, state, assets) {
  const sitePos = snapshot?.site_xpos;
  const siteMat = snapshot?.site_xmat;
  const nsite = assets?.sites?.count ?? (sitePos ? Math.floor(sitePos.length / 3) : 0);
  if (!(nsite > 0) || !sitePos || !siteMat) return [];
  const sizeView = assets?.sites?.size || null;
  const typeView = assets?.sites?.type || null;
  const matIdView = assets?.sites?.matid || null;
  const bodyIdView = assets?.sites?.bodyid || null;
  const groupIdView = assets?.sites?.group || null;
  const rgbaView = assets?.sites?.rgba || null;

  const descriptors = [];
  for (let i = 0; i < nsite; i += 1) {
    const type = typeView?.[i] ?? MJ_GEOM.SPHERE;
    const base = 3 * i;
    let sizeVec = null;
    if (sizeView && sizeView.length >= base + 3) {
      sizeVec = [
        sizeView[base + 0] ?? 0,
        sizeView[base + 1] ?? 0,
        sizeView[base + 2] ?? 0,
      ];
    }
    if (Array.isArray(sizeVec)) {
      if (type === MJ_GEOM.SPHERE) {
        const r = Math.max(1e-6, Number(sizeVec[0]) || 0.01);
        sizeVec = [r, r, r];
      } else if (type === MJ_GEOM.ELLIPSOID) {
        const ax = Math.max(1e-6, Number(sizeVec[0]) || 0.01);
        const ay = Math.max(1e-6, Number(sizeVec[1]) || ax);
        const az = Math.max(1e-6, Number(sizeVec[2]) || ax);
        sizeVec = [ax, ay, az];
      }
    }
    const matId = matIdView?.[i] ?? -1;
    const bodyId = bodyIdView?.[i] ?? -1;
    const groupId = groupIdView?.[i] ?? -1;
    let rgba = null;
    if (rgbaView && rgbaView.length >= (i * 4 + 4)) {
      const rgbaBase = i * 4;
      rgba = [
        rgbaView[rgbaBase + 0],
        rgbaView[rgbaBase + 1],
        rgbaView[rgbaBase + 2],
        rgbaView[rgbaBase + 3],
      ];
    }
    descriptors.push({
      kind: 'site',
      index: i,
      type,
      size: sizeVec,
      matId,
      bodyId,
      groupId,
      rgba,
      name: `Site ${i}`,
    });
  }
  return descriptors;
}

/**
 * @typedef {Object} TendonSegmentDescriptor
 * @property {'tendon_segment'} kind
 * @property {number} tendon
 * @property {number[]} start
 * @property {number[]} end
 * @property {number} width
 */

/**
 * Build tendon segment descriptors from wrap state.
 *
 * This matches simulate's addSpatialTendonGeoms straight-segment path.
 *
 * @param {object} snapshot
 * @param {object} state
 * @param {object | null} assets
 * @returns {TendonSegmentDescriptor[]}
 */
function buildTendonSegmentDescriptors(snapshot, state, assets) {
  const tenWrapAdr = snapshot?.ten_wrapadr;
  const tenWrapNum = snapshot?.ten_wrapnum;
  const wrapObj = snapshot?.wrap_obj;
  const wrapXpos = snapshot?.wrap_xpos;
  const ntendon = assets?.tendons?.count ?? (tenWrapAdr ? (tenWrapAdr.length | 0) : 0);
  if (!(ntendon > 0) || !tenWrapAdr || !tenWrapNum || !wrapObj || !wrapXpos) {
    return [];
  }
  const widthView = assets?.tendons?.width || null;
  const numView = assets?.tendons?.num || null;
  const limitedView = assets?.tendons?.limited || null;
  const stiffnessView = assets?.tendons?.stiffness || null;
  const dampingView = assets?.tendons?.damping || null;
  const frictionlossView = assets?.tendons?.frictionloss || null;
  const rangeView = assets?.tendons?.range || null;
  const lengthspringView = assets?.tendons?.lengthspring || null;
  const actTrnType = assets?.actuators?.trntype || null;
  const actTrnId = assets?.actuators?.trnid || null;

  const gravity = state?.model?.opt?.gravity || null;
  const disableMask = state?.model?.opt?.disableflags || 0;
  const gravityEnabled = !isDisabledFlag(disableMask, 7) && Array.isArray(gravity) && vec3Norm(gravity[0] || 0, gravity[1] || 0, gravity[2] || 0) > 1e-12;
  const numslices = Math.max(0, (state?.model?.vis?.quality?.numslices ?? 0) | 0);
  const ncatenary = Math.min(100, numslices + 1);
  const hasCatenaryModelFields =
    !!numView &&
    !!limitedView &&
    !!stiffnessView &&
    !!dampingView &&
    !!frictionlossView &&
    !!rangeView &&
    !!lengthspringView;
  const hasActuators = !!actTrnType && !!actTrnId;
  const hasTendonActuator = (tendonIndex) => {
    if (!hasActuators) return false;
    const n = actTrnType.length | 0;
    for (let j = 0; j < n; j += 1) {
      if ((actTrnType[j] | 0) !== MJ_TRN.TENDON) continue;
      const base = 2 * j;
      const tid = actTrnId[base] | 0;
      if (tid === (tendonIndex | 0)) return true;
    }
    return false;
  };
  const descriptors = [];
  for (let i = 0; i < ntendon; i += 1) {
    const adr = tenWrapAdr[i] | 0;
    const num = tenWrapNum[i] | 0;
    if (!(num >= 2) || adr < 0) continue;
    const baseWidth = widthView && i < widthView.length ? Number(widthView[i]) || 0 : 0;
    const defaultWidth = baseWidth > 0 ? baseWidth : 0.005;

    // Simulate special-case: string-like tendons under gravity (mjv_catenary).
    if (
      gravityEnabled &&
      hasCatenaryModelFields &&
      !hasTendonActuator(i) &&
      (numView[i] | 0) === 2 &&
      num === 2
    ) {
      const stiffness = Number(stiffnessView[i]) || 0;
      const damping = Number(dampingView[i]) || 0;
      const frictionloss = Number(frictionlossView[i]) || 0;
      const limited = limitedView[i] | 0;
      const ls0 = Number(lengthspringView[2 * i]) || 0;
      const ls1 = Number(lengthspringView[2 * i + 1]) || 0;
      const r0 = Number(rangeView[2 * i]) || 0;
      const r1 = Number(rangeView[2 * i + 1]) || 0;
      const limitedspring = stiffness > 0 && ls0 === 0 && ls1 > 0;
      const limitedconstraint = stiffness === 0 && limited === 1 && r0 === 0 && r1 > 0;
      const drawCatenary = (limitedspring !== limitedconstraint) && damping === 0 && frictionloss === 0;
      if (drawCatenary) {
        const p0 = adr * 3;
        const p1 = (adr + 1) * 3;
        if (p1 + 2 < wrapXpos.length) {
          const x0 = [
            Number(wrapXpos[p0 + 0]) || 0,
            Number(wrapXpos[p0 + 1]) || 0,
            Number(wrapXpos[p0 + 2]) || 0,
          ];
          const x1 = [
            Number(wrapXpos[p1 + 0]) || 0,
            Number(wrapXpos[p1 + 1]) || 0,
            Number(wrapXpos[p1 + 2]) || 0,
          ];
          const length = limitedconstraint ? r1 : ls1;
          const { points, npoints } = computeCatenaryPoints(x0, x1, gravity, Math.max(0, length), ncatenary);
          if (npoints >= 2) {
            for (let j = 0; j < npoints - 1; j += 1) {
              descriptors.push({
                kind: 'tendon_segment',
                tendon: i,
                start: points[j],
                end: points[j + 1],
                width: defaultWidth,
              });
            }
            continue;
          }
        }
      }
    }

    const end = adr + num - 1;
    for (let j = adr; j < end; j += 1) {
      // MuJoCo stores wrap arrays as (nwrap x 2) ints and (nwrap x 6) reals, but
      // the visualize path indexes them as 2*nwrap sequential points: wrap_obj[j]
      // and wrap_xpos[3*j : 3*j+3].
      const o0 = wrapObj[j] ?? -2;
      const o1 = wrapObj[j + 1] ?? -2;
      if ((o0 | 0) === -2 || (o1 | 0) === -2) continue;
      const p0 = j * 3;
      const p1 = (j + 1) * 3;
      if (p1 + 2 >= wrapXpos.length) continue;
      const start = [
        Number(wrapXpos[p0 + 0]) || 0,
        Number(wrapXpos[p0 + 1]) || 0,
        Number(wrapXpos[p0 + 2]) || 0,
      ];
      const endPos = [
        Number(wrapXpos[p1 + 0]) || 0,
        Number(wrapXpos[p1 + 1]) || 0,
        Number(wrapXpos[p1 + 2]) || 0,
      ];
      let width = defaultWidth;
      if ((o0 | 0) >= 0 && (o1 | 0) >= 0) {
        width *= 0.5;
      }
      descriptors.push({
        kind: 'tendon_segment',
        tendon: i,
        start,
        end: endPos,
        width,
      });
    }
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
  const overlayCfg = ctx.fallback?.overlays || null;
  const cameraFallback =
    overlayCfg && Number.isFinite(overlayCfg.camera)
      ? overlayCfg.camera
      : 0x6aa86a;
  const colorHex = rgbaToHex(visRgba.camera, cameraFallback);
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

function ensureSiteMesh(ctx, index, stype, sizeVec, state = null) {
  if (!ctx.siteMeshes) ctx.siteMeshes = [];
  let mesh = ctx.siteMeshes[index];
  const sizeKey = Array.isArray(sizeVec)
    ? sizeVec.map((v) => (Number.isFinite(v) ? v.toFixed(6) : '0')).join(',')
    : 'null';
  const needsRebuild =
    !mesh ||
    mesh.userData?.siteType !== stype ||
    mesh.userData?.siteSizeKey !== sizeKey;

  if (needsRebuild) {
    if (mesh) disposeMeshObject(mesh);
    const fb = ctx.fallback || {};
    const geometryInfo = createPrimitiveGeometry(stype, sizeVec, {
      fallbackEnabled: fb.enabled !== false,
      preset: fb.preset || 'bright-outdoor',
    });
    const useStandard = stype === MJ_GEOM.PLANE || stype === MJ_GEOM.HFIELD;
    const sceneFlags = state?.rendering?.sceneFlags || [];
    const wire = !!sceneFlags[1];
    const baseOpts = geometryInfo.materialOpts || {};
    const poolKey = {
      kind: useStandard ? 'standard' : 'physical',
      color: baseOpts.color ?? 0xffffff,
      roughness: baseOpts.roughness ?? 0.55,
      metalness: baseOpts.metalness ?? 0.0,
      wireframe: wire,
    };
    if (!ctx.materialPool) ctx.materialPool = new MaterialPool(THREE);
    let material = ctx.materialPool.get(poolKey);
    if (material && material.userData?.pooled) {
      const cloned = material.clone();
      cloned.userData = cloned.userData || {};
      cloned.userData.pooled = false;
      material = cloned;
    }
    if (!useStandard && material) material.envMapIntensity = 0;
    if (material) material.side = THREE.FrontSide;
    mesh = new THREE.Mesh(geometryInfo.geometry, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    if (typeof geometryInfo.postCreate === 'function') {
      try {
        geometryInfo.postCreate(mesh);
      } catch (err) {
        warnLog('[render] site postCreate failed', err);
        throw err;
      }
    }
    mesh.userData = mesh.userData || {};
    mesh.userData.siteIndex = index;
    mesh.userData.siteType = stype;
    mesh.userData.siteSizeKey = sizeKey;
    mesh.userData.ownGeometry = true;
    if (ctx.root) ctx.root.add(mesh);
    ctx.siteMeshes[index] = mesh;
  }

  return mesh;
}

function applySiteDescriptors(context, descriptors, {
  assets,
  state,
  snapshot,
  hideAllGeometry,
  voptFlags,
  siteGroupIds,
  siteGroupMask,
}) {
  if (!Array.isArray(descriptors) || descriptors.length === 0) {
    if (Array.isArray(context.siteMeshes)) {
      for (const mesh of context.siteMeshes) {
        if (mesh) mesh.visible = false;
      }
    }
    return 0;
  }

  const vopt = Array.isArray(voptFlags) ? voptFlags : state?.rendering?.voptFlags || [];
  const showStatic = voptEnabled(vopt, MJ_VIS.STATIC);
  const transparentDynamic = voptEnabled(vopt, MJ_VIS.TRANSPARENT);
  const textureEnabled = voptEnabled(vopt, MJ_VIS.TEXTURE);
  const alphaScale = transparentDynamic ? clampUnit(Number(state?.model?.vis?.map?.alpha)) : 1;
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

  const sitePos = snapshot?.site_xpos;
  const siteMat = snapshot?.site_xmat;
  const n = descriptors.length;
  let drawn = 0;
  for (let idx = 0; idx < n; idx += 1) {
    const desc = descriptors[idx];
    if (!desc || desc.kind !== 'site') continue;
    const i = desc.index;
    const mesh = ensureSiteMesh(context, i, desc.type, desc.size, state);
    if (!mesh) continue;

    if (sitePos && sitePos.length >= (i * 3 + 3)) {
      const base = i * 3;
      mesh.position.set(
        Number(sitePos[base + 0]) || 0,
        Number(sitePos[base + 1]) || 0,
        Number(sitePos[base + 2]) || 0,
      );
    }
    if (siteMat && siteMat.length >= (i * 9 + 9)) {
      const rotBase = i * 9;
      TEMP_MAT4.set(
        siteMat[rotBase + 0] ?? 1, siteMat[rotBase + 1] ?? 0, siteMat[rotBase + 2] ?? 0, 0,
        siteMat[rotBase + 3] ?? 0, siteMat[rotBase + 4] ?? 1, siteMat[rotBase + 5] ?? 0, 0,
        siteMat[rotBase + 6] ?? 0, siteMat[rotBase + 7] ?? 0, siteMat[rotBase + 8] ?? 1, 0,
        0, 0, 0, 1,
      );
      mesh.quaternion.setFromRotationMatrix(TEMP_MAT4);
    }

    const appearance = resolveSiteAppearance(i, assets || null);
    applyAppearanceToMaterial(mesh, appearance);
    mesh.userData = mesh.userData || {};
    mesh.userData.matId = desc.matId;
    mesh.userData.siteBodyId = desc.bodyId;
    mesh.userData.siteGroupId = desc.groupId;
    const baseAlpha =
      typeof appearance?.opacity === 'number' && Number.isFinite(appearance.opacity)
        ? appearance.opacity
        : (mesh.material && typeof mesh.material.opacity === 'number' ? mesh.material.opacity : 1);
    mesh.userData.baseAlpha = baseAlpha;
    if (mesh.material && typeof mesh.material.opacity === 'number') {
      const shouldFade = transparentDynamic && !isBodyStatic(desc.bodyId);
      const desiredAlpha = shouldFade ? baseAlpha * alphaScale : baseAlpha;
      const nextAlpha = Number.isFinite(desiredAlpha) ? desiredAlpha : baseAlpha;
      const nextTransparent = nextAlpha < 0.999;
      if (Math.abs(mesh.material.opacity - nextAlpha) > 1e-6 || mesh.material.transparent !== nextTransparent) {
        mesh.material.opacity = nextAlpha;
        mesh.material.transparent = nextTransparent;
        mesh.material.needsUpdate = true;
      }
    }
    applyMuJoCoTextureToMesh(mesh, desc.matId, context, assets, textureEnabled, {
      texcoordMode: 'generated',
      geomType: desc.type,
      geomSize: desc.size,
      geomDataId: -1,
    });

    let visible = true;
    if (hideAllGeometry) {
      visible = false;
    }
    if (visible && siteGroupMask && Array.isArray(siteGroupMask)) {
      const rawGroup = siteGroupIds && i < siteGroupIds.length ? siteGroupIds[i] : 0;
      const groupIdx = Number.isFinite(rawGroup) ? (rawGroup | 0) : 0;
      if (groupIdx >= 0 && groupIdx < siteGroupMask.length) {
        if (!siteGroupMask[groupIdx]) {
          visible = false;
        }
      }
    }
    if (visible && !showStatic && isBodyStatic(desc.bodyId)) {
      visible = false;
    }
    mesh.visible = visible;
    if (visible) drawn += 1;
  }

  if (Array.isArray(context.siteMeshes) && context.siteMeshes.length > n) {
    for (let i = n; i < context.siteMeshes.length; i += 1) {
      if (context.siteMeshes[i]) {
        context.siteMeshes[i].visible = false;
      }
    }
  }

  return drawn;
}

function ensureTendonGroup(ctx) {
  if (!ctx) return null;
  if (!ctx.tendonGroup) {
    const group = new THREE.Group();
    group.name = 'base:tendons';
    if (ctx.root) ctx.root.add(group);
    ctx.tendonGroup = group;
    ctx.tendonPool = [];
    ctx._tendonUnitGeometry = new THREE.CylinderGeometry(1, 1, 1, 12, 1, false);
  }
  return ctx.tendonGroup;
}

function ensureTendonMesh(ctx, poolIndex, state) {
  const group = ensureTendonGroup(ctx);
  if (!group) return null;
  const pool = Array.isArray(ctx.tendonPool) ? ctx.tendonPool : (ctx.tendonPool = []);
  let mesh = pool[poolIndex];
  if (!mesh) {
    const geom = ctx._tendonUnitGeometry || (ctx._tendonUnitGeometry = new THREE.CylinderGeometry(1, 1, 1, 12, 1, false));
    const sceneFlags = state?.rendering?.sceneFlags || [];
    const wire = !!sceneFlags[1];
    const poolKey = {
      kind: 'physical',
      color: 0xffffff,
      roughness: 0.8,
      metalness: 0.0,
      wireframe: wire,
    };
    if (!ctx.materialPool) ctx.materialPool = new MaterialPool(THREE);
    let material = ctx.materialPool.get(poolKey);
    if (!material) {
      material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8, metalness: 0.0, wireframe: wire });
    } else if (material.userData?.pooled) {
      const cloned = material.clone();
      cloned.userData = cloned.userData || {};
      cloned.userData.pooled = false;
      material = cloned;
    }
    if (material) material.side = THREE.FrontSide;
    mesh = new THREE.Mesh(geom, material);
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.frustumCulled = false;
    mesh.userData = mesh.userData || {};
    mesh.userData.tendonSegment = true;
    group.add(mesh);
    pool[poolIndex] = mesh;
  }
  return mesh;
}

function applyTendonSegmentDescriptors(ctx, descriptors, {
  assets,
  state,
  hideAllGeometry,
  tendonGroupIds,
  tendonGroupMask,
}) {
  if (!ctx) return 0;
  const group = ensureTendonGroup(ctx);
  if (!Array.isArray(descriptors) || descriptors.length === 0) {
    if (group) group.visible = false;
    if (Array.isArray(ctx.tendonPool)) {
      for (const mesh of ctx.tendonPool) {
        if (mesh) mesh.visible = false;
      }
    }
    return 0;
  }

  const pool = Array.isArray(ctx.tendonPool) ? ctx.tendonPool : (ctx.tendonPool = []);
  let used = 0;
  for (const desc of descriptors) {
    if (!desc || desc.kind !== 'tendon_segment') continue;
    const tendonIndex = desc.tendon | 0;
    let visible = true;
    if (hideAllGeometry) visible = false;
    if (visible && tendonGroupMask && Array.isArray(tendonGroupMask)) {
      const rawGroup = tendonGroupIds && tendonIndex < tendonGroupIds.length ? tendonGroupIds[tendonIndex] : 0;
      const groupIdx = Number.isFinite(rawGroup) ? (rawGroup | 0) : 0;
      if (groupIdx >= 0 && groupIdx < tendonGroupMask.length) {
        if (!tendonGroupMask[groupIdx]) {
          visible = false;
        }
      }
    }
    if (!visible) continue;

    const mesh = ensureTendonMesh(ctx, used, state);
    if (!mesh) continue;
    mesh.userData = mesh.userData || {};
    mesh.userData.tendonIndex = tendonIndex;
    const start = desc.start || [];
    const end = desc.end || [];
    __TMP_VEC3_A.set(Number(start[0]) || 0, Number(start[1]) || 0, Number(start[2]) || 0);
    __TMP_VEC3_B.set(Number(end[0]) || 0, Number(end[1]) || 0, Number(end[2]) || 0);
    const dir = __TMP_VEC3_C.copy(__TMP_VEC3_B).sub(__TMP_VEC3_A);
    const length = dir.length();
    if (!(length > 1e-9)) continue;
    const center = __TMP_VEC3_D.copy(__TMP_VEC3_A).add(__TMP_VEC3_B).multiplyScalar(0.5);
    dir.normalize();
    LIGHT_TMP_QUAT.setFromUnitVectors(PERTURB_AXIS_DEFAULT, dir);
    mesh.position.copy(center);
    mesh.quaternion.copy(LIGHT_TMP_QUAT);
    const radius = Math.max(1e-6, Number(desc.width) || 0.001);
    mesh.scale.set(radius, length, radius);

    const appearance = resolveTendonAppearance(tendonIndex, assets || null);
    applyAppearanceToMaterial(mesh, appearance);
    mesh.visible = true;
    used += 1;
  }

  for (let i = used; i < pool.length; i += 1) {
    if (pool[i]) pool[i].visible = false;
  }
  if (group) group.visible = used > 0;
  ctx.tendonPool = pool;
  return used;
}

function ensureFlexGroup(ctx) {
  if (!ctx) return null;
  if (!ctx.flexGroup) {
    const group = new THREE.Group();
    group.name = 'base:flexes';
    if (ctx.root) ctx.root.add(group);
    ctx.flexGroup = group;
    ctx.flexPool = [];
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
      try { group.remove(entry.group); } catch {}
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
  } else if (uvOut.length) {
    uvOut.fill(0);
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
        const texIndices = hasTexIndices
          ? Array.from({ length: elemStride }, (_, idx) => elemTexcoordArr[texBase + idx] | 0)
          : null;
        const getTexIndex = (idx, fallback) =>
          texIndices && Number.isFinite(texIndices[idx]) ? texIndices[idx] : fallback;
        flexMakeFace(posOut, nrmOut, cursor++, radius, vertxpos, i0, i1, i2);
        fillFlexFaceTexcoords(
          uvOut,
          cursor - 1,
          texcoordArr,
          texcoordBaseOffset,
          texcoordLength,
          getTexIndex(0, i0),
          getTexIndex(1, i1),
          getTexIndex(2, i2),
        );
        flexMakeFace(posOut, nrmOut, cursor++, radius, vertxpos, i0, i2, i1);
        fillFlexFaceTexcoords(
          uvOut,
          cursor - 1,
          texcoordArr,
          texcoordBaseOffset,
          texcoordLength,
          getTexIndex(0, i0),
          getTexIndex(2, i2),
          getTexIndex(1, i1),
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
        const texIndices = hasTexIndices
          ? Array.from({ length: elemStride }, (_, idx) => elemTexcoordArr[texBase + idx] | 0)
          : null;
        const getTexIndex = (idx, fallback) =>
          texIndices && Number.isFinite(texIndices[idx]) ? texIndices[idx] : fallback;
        flexMakeFace(posOut, nrmOut, cursor++, radius, vertxpos, i0, i1, i2);
        fillFlexFaceTexcoords(
          uvOut,
          cursor - 1,
          texcoordArr,
          texcoordBaseOffset,
          texcoordLength,
          getTexIndex(0, i0),
          getTexIndex(1, i1),
          getTexIndex(2, i2),
        );
        flexMakeFace(posOut, nrmOut, cursor++, radius, vertxpos, i0, i2, i3);
        fillFlexFaceTexcoords(
          uvOut,
          cursor - 1,
          texcoordArr,
          texcoordBaseOffset,
          texcoordLength,
          getTexIndex(0, i0),
          getTexIndex(2, i2),
          getTexIndex(3, i3),
        );
        flexMakeFace(posOut, nrmOut, cursor++, radius, vertxpos, i0, i3, i1);
        fillFlexFaceTexcoords(
          uvOut,
          cursor - 1,
          texcoordArr,
          texcoordBaseOffset,
          texcoordLength,
          getTexIndex(0, i0),
          getTexIndex(3, i3),
          getTexIndex(1, i1),
        );
        flexMakeFace(posOut, nrmOut, cursor++, radius, vertxpos, i1, i3, i2);
        fillFlexFaceTexcoords(
          uvOut,
          cursor - 1,
          texcoordArr,
          texcoordBaseOffset,
          texcoordLength,
          getTexIndex(1, i1),
          getTexIndex(3, i3),
          getTexIndex(2, i2),
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
        const texIndices = hasTexIndices
          ? Array.from({ length: elemStride }, (_, idx) => elemTexcoordArr[texBase + idx] | 0)
          : null;
        const getTexIndex = (idx, fallback) =>
          texIndices && Number.isFinite(texIndices[idx]) ? texIndices[idx] : fallback;
        flexMakeSmooth(posOut, nrmOut, cursor++, radius, flgFlat, vertnorm, vertxpos, i0, i1, i2);
        fillFlexFaceTexcoords(
          uvOut,
          cursor - 1,
          texcoordArr,
          texcoordBaseOffset,
          texcoordLength,
          getTexIndex(0, i0),
          getTexIndex(1, i1),
          getTexIndex(2, i2),
        );
        flexMakeSmooth(posOut, nrmOut, cursor++, -radius, flgFlat, vertnorm, vertxpos, i0, i2, i1);
        fillFlexFaceTexcoords(
          uvOut,
          cursor - 1,
          texcoordArr,
          texcoordBaseOffset,
          texcoordLength,
          getTexIndex(0, i0),
          getTexIndex(2, i2),
          getTexIndex(1, i1),
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
  geom.setAttribute('position', new THREE.BufferAttribute(posOut, 3));
  geom.setAttribute('normal', new THREE.BufferAttribute(nrmOut, 3));
  geom.setAttribute('uv', new THREE.BufferAttribute(uvOut, 2));
  entry.faces.visible = true;
}

function applyFlexRendering(ctx, snapshot, state, assets, {
  hideAllGeometry,
  voptFlags,
  flexGroupIds,
  flexGroupMask,
}) {
  if (!ctx) return 0;
  const flexAssets = assets?.flexes || null;
  const count = flexAssets?.count | 0;
  if (!(count > 0)) {
    hideFlexGroup(ctx);
    return 0;
  }
  const showVert = voptEnabled(voptFlags, MJ_VIS.FLEXVERT);
  const showEdge = voptEnabled(voptFlags, MJ_VIS.FLEXEDGE);
  const showFace = voptEnabled(voptFlags, MJ_VIS.FLEXFACE);
  const showSkin = voptEnabled(voptFlags, MJ_VIS.FLEXSKIN);
  const textureEnabled = voptEnabled(voptFlags, MJ_VIS.TEXTURE);
  const showAny = showVert || showEdge || showFace || showSkin;
  if (!showAny || hideAllGeometry) {
    hideFlexGroup(ctx);
    return 0;
  }
  const flexLayerValue = Number.isFinite(state?.rendering?.flexLayer)
    ? (state.rendering.flexLayer | 0)
    : 0;

  let used = 0;
  for (let i = 0; i < count; i += 1) {
    const entry = ensureFlexEntry(ctx, i, assets, state);
    if (!entry) continue;

    let visible = true;
    if (flexGroupMask && Array.isArray(flexGroupMask)) {
      const rawGroup = flexGroupIds && i < flexGroupIds.length ? flexGroupIds[i] : 0;
      const groupIdx = Number.isFinite(rawGroup) ? (rawGroup | 0) : 0;
      if (groupIdx >= 0 && groupIdx < flexGroupMask.length) {
        if (!flexGroupMask[groupIdx]) visible = false;
      }
    }
    entry.group.visible = visible;
    if (!visible) continue;

    applyFlexAppearance(entry, i, assets, ctx, textureEnabled);

    const vertadr = flexAssets?.vertadr && i < flexAssets.vertadr.length ? (flexAssets.vertadr[i] | 0) : 0;
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

    entry.points.visible = showVert;
    entry.edges.visible = showEdge;
    if (showSkin) {
      updateFlexFaces(entry, i, snapshot, state, assets, true, flexLayerValue);
    } else if (showFace) {
      updateFlexFaces(entry, i, snapshot, state, assets, false, flexLayerValue);
    } else {
      entry.faces.visible = false;
    }

    used += 1;
  }

  if (Array.isArray(ctx.flexPool) && ctx.flexPool.length > count) {
    for (let i = count; i < ctx.flexPool.length; i += 1) {
      if (ctx.flexPool[i]?.group) ctx.flexPool[i].group.visible = false;
    }
  }

  const group = ensureFlexGroup(ctx);
  if (group) group.visible = used > 0;
  return used;
}

function ensureSkinGroup(ctx) {
  if (!ctx) return null;
  if (!ctx.skinGroup) {
    const group = new THREE.Group();
    group.name = 'base:skins';
    if (ctx.root) ctx.root.add(group);
    ctx.skinGroup = group;
    ctx.skinPool = [];
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
      try { group.remove(entry.mesh); } catch {}
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

function applySkinRendering(ctx, snapshot, state, assets, {
  hideAllGeometry,
  skinGroupIds,
  skinGroupMask,
}) {
  if (!ctx) return 0;
  const skinAssets = assets?.skins || null;
  const count = skinAssets?.count | 0;
  if (!(count > 0) || hideAllGeometry) {
    hideSkinGroup(ctx);
    return 0;
  }
  const textureEnabled = voptEnabled(state?.rendering?.voptFlags, MJ_VIS.TEXTURE);
  let used = 0;
  for (let i = 0; i < count; i += 1) {
    const entry = ensureSkinEntry(ctx, i, assets, state);
    if (!entry) continue;

    let visible = true;
    if (skinGroupMask && Array.isArray(skinGroupMask)) {
      const rawGroup = skinGroupIds && i < skinGroupIds.length ? skinGroupIds[i] : 0;
      const groupIdx = Number.isFinite(rawGroup) ? (rawGroup | 0) : 0;
      if (groupIdx >= 0 && groupIdx < skinGroupMask.length) {
        if (!skinGroupMask[groupIdx]) visible = false;
      }
    }
    if (!visible) {
      entry.mesh.visible = false;
      continue;
    }

    applySkinAppearance(entry, i, assets, ctx, textureEnabled);
    const ok = updateSkinMesh(entry, i, snapshot, assets);
    entry.mesh.visible = ok;
    if (ok) used += 1;
  }
  const group = ensureSkinGroup(ctx);
  if (group) group.visible = used > 0;
  return used;
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
  voptFlags,
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
  const vopt = Array.isArray(voptFlags) ? voptFlags : state?.rendering?.voptFlags || [];
  const showStatic = voptEnabled(vopt, MJ_VIS.STATIC);
  const transparentDynamic = voptEnabled(vopt, MJ_VIS.TRANSPARENT);
  const textureEnabled = voptEnabled(vopt, MJ_VIS.TEXTURE);
  const alphaScale = transparentDynamic ? clampUnit(Number(state?.model?.vis?.map?.alpha)) : 1;
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
  const n = descriptors.length;
  context.geomState = context.geomState || [];
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
      name: desc.name,
      matId: desc.matId,
      bodyId: desc.bodyId,
      groupId: desc.groupId,
      rgba: desc.rgba,
    };

    // Ensure state buffer for this geom index
    const geomState = ensureGeomState(context, i, geomMeta);

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
    updateMeshFromSnapshot(mesh, i, snapshot, state, assets, flags, geomState);

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
    if (visible && !showStatic && isBodyStatic(desc.bodyId)) {
      visible = false;
    }

    if (mesh.material && typeof mesh.material.opacity === 'number') {
      const userData = mesh.userData || (mesh.userData = {});
      if (!(typeof userData.baseAlpha === 'number' && Number.isFinite(userData.baseAlpha))) {
        userData.baseAlpha = mesh.material.opacity;
      }
      const shouldFade = transparentDynamic && !isBodyStatic(desc.bodyId);
      if (shouldFade && Number.isFinite(alphaScale) && alphaScale > 1e-6 && alphaScale < 0.999) {
        const currentAlpha = mesh.material.opacity;
        const stored = userData.baseAlpha;
        if (Number.isFinite(currentAlpha) && Number.isFinite(stored) && Math.abs(stored - currentAlpha) < 1e-6) {
          userData.baseAlpha = clampUnit(stored / alphaScale);
        }
      }
      const baseAlpha = userData.baseAlpha;
      const desiredAlpha = shouldFade ? baseAlpha * alphaScale : baseAlpha;
      const nextAlpha = Number.isFinite(desiredAlpha) ? desiredAlpha : baseAlpha;
      const nextTransparent = nextAlpha < 0.999;
      if (Math.abs(mesh.material.opacity - nextAlpha) > 1e-6 || mesh.material.transparent !== nextTransparent) {
        mesh.material.opacity = nextAlpha;
        mesh.material.transparent = nextTransparent;
        mesh.material.needsUpdate = true;
      }
    }
    const texcoordMode =
      desc.type === MJ_GEOM.MESH && mesh.geometry && typeof mesh.geometry.getAttribute === 'function' && mesh.geometry.getAttribute('uv')
        ? 'explicit'
        : 'generated';
    applyMuJoCoTextureToMesh(mesh, desc.matId, context, assets, textureEnabled, {
      texcoordMode,
      geomType: desc.type,
      geomSize: sizeVec,
      geomDataId: desc.dataId,
    });

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

function applyMjvSceneSoAGeoms(ctx, snapshot, state, assets, {
  sceneFlags,
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
  if (!typeView || !posView || !matView || !sizeView || !rgbaView || !matIdView || !dataIdView || !objTypeView || !objIdView || !categoryView) {
    return 0;
  }

  const flags = Array.isArray(sceneFlags) ? sceneFlags : state?.rendering?.sceneFlags || [];
  const segmentEnabled = !!flags[SEGMENT_FLAG_INDEX];
  const vopt = Array.isArray(state?.rendering?.voptFlags) ? state.rendering.voptFlags : [];
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
  const geomNameLookup = createGeomNameLookup(state?.model?.geoms);
  const geomBodyIdView = state?.model?.geomBodyId || null;

  const geomToScn = new Int32Array(Math.max(0, baseNgeom));
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
    if (showFlexAny) {
      const flexAssets = assets?.flexes || null;
      const count = flexAssets?.count | 0;
      if (count > 0) {
        let used = 0;
        const seen = new Set();
        for (let si = 0; si < scnNgeom; si += 1) {
          if ((objTypeView[si] | 0) !== MJ_OBJ.FLEX) continue;
          const flexIndex = objIdView[si] | 0;
          if (flexIndex < 0 || flexIndex >= count) continue;
          if (seen.has(flexIndex)) continue;
          seen.add(flexIndex);
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
          used += 1;
        }
        const group = ensureFlexGroup(ctx);
        if (group) group.visible = used > 0;
      }
    }

    if (showSkin) {
      const skinAssets = assets?.skins || null;
      const count = skinAssets?.count | 0;
      if (count > 0) {
        let used = 0;
        const seen = new Set();
        for (let si = 0; si < scnNgeom; si += 1) {
          if ((objTypeView[si] | 0) !== MJ_OBJ.SKIN) continue;
          const skinIndex = objIdView[si] | 0;
          if (skinIndex < 0 || skinIndex >= count) continue;
          if (seen.has(skinIndex)) continue;
          seen.add(skinIndex);
          const entry = ensureSkinEntry(ctx, skinIndex, assets, state);
          if (!entry) continue;
          applySkinAppearance(entry, skinIndex, assets, ctx, textureEnabled);
          const ok = updateSkinMesh(entry, skinIndex, snapshot, assets);
          entry.mesh.visible = ok;
          if (ok) used += 1;
        }
        const group = ensureSkinGroup(ctx);
        if (group) group.visible = used > 0;
      }
    }
  }

  ctx.geomState = ctx.geomState || [];
  const safeHide = (meshIndex) => {
    const mesh = Array.isArray(ctx.meshes) ? ctx.meshes[meshIndex] : null;
    if (mesh) mesh.visible = false;
  };
  const sizeVecFor = (gtype, scnIndex) => {
    const base = (scnIndex | 0) * 3;
    const sx = Number(sizeView?.[base + 0]) || 0;
    const sy = Number(sizeView?.[base + 1]) || 0;
    const sz = Number(sizeView?.[base + 2]) || 0;
    if (gtype === MJ_GEOM.CAPSULE || gtype === MJ_GEOM.CYLINDER) {
      // mjvGeom stores [radius, radius, halflength] for capsule/cylinder.
      return [sx, sz, 0];
    }
    return [sx, sy, sz];
  };

  const updateOne = (meshIndex, scnIndex, nameHint = null) => {
    const si = scnIndex | 0;
    if (si < 0 || si >= scnNgeom) {
      safeHide(meshIndex);
      return false;
    }

    const gtypeRaw = typeView[si] | 0;
    const supported =
      gtypeRaw === MJ_GEOM.PLANE ||
      gtypeRaw === MJ_GEOM.HFIELD ||
      gtypeRaw === MJ_GEOM.SPHERE ||
      gtypeRaw === MJ_GEOM.CAPSULE ||
      gtypeRaw === MJ_GEOM.ELLIPSOID ||
      gtypeRaw === MJ_GEOM.CYLINDER ||
      gtypeRaw === MJ_GEOM.BOX ||
      gtypeRaw === MJ_GEOM.MESH ||
      gtypeRaw === MJ_GEOM.SDF;
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
    const sizeVec = sizeVecFor(gtypeRaw, si);
    const rgbaBase = si * 4;
    const rgba = rgbaView && rgbaView.length >= rgbaBase + 4
      ? [
          rgbaView[rgbaBase + 0],
          rgbaView[rgbaBase + 1],
          rgbaView[rgbaBase + 2],
          rgbaView[rgbaBase + 3],
        ]
      : null;
    const bodyId = geomBodyIdView && meshIndex >= 0 && meshIndex < geomBodyIdView.length
      ? (geomBodyIdView[meshIndex] | 0)
      : -1;
    const geomMeta = {
      index: meshIndex,
      type: gtypeRaw,
      dataId,
      size: sizeVec,
      name: nameHint || `SceneGeom ${si}`,
      matId,
      bodyId,
      groupId: -1,
      rgba,
    };
    const geomState = ensureGeomState(ctx, meshIndex, geomMeta);
    const mesh = ensureGeomMesh(ctx, meshIndex, gtypeRaw, assets, dataId, sizeVec, { geomMeta }, state);
    if (!mesh) return false;

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

    const isInfinitePlane = !!mesh.userData?.infinitePlane;
    if (isInfinitePlane) {
      updateInfinitePlaneFromSceneSoA(mesh, si, snapshot, flags);
    } else {
      const posBase = si * 3;
      const px = posView?.[posBase + 0] ?? 0;
      const py = posView?.[posBase + 1] ?? 0;
      const pz = posView?.[posBase + 2] ?? 0;
      mesh.position.set(px, py, pz);
      const matBase = si * 9;
      const rot = [
        matView?.[matBase + 0] ?? 1,
        matView?.[matBase + 1] ?? 0,
        matView?.[matBase + 2] ?? 0,
        matView?.[matBase + 3] ?? 0,
        matView?.[matBase + 4] ?? 1,
        matView?.[matBase + 5] ?? 0,
        matView?.[matBase + 6] ?? 0,
        matView?.[matBase + 7] ?? 0,
        matView?.[matBase + 8] ?? 1,
      ];
      mesh.quaternion.copy(mat3ToQuat(rot));
      mesh.scale.set(1, 1, 1);
    }

    let visible = true;
    if (hideAllGeometry) visible = false;
    if (!segmentEnabled) {
      const baseAppearance = rgba
        ? { rgba: rgba.slice(), color: rgbFromArray(rgba), opacity: alphaFromArray(rgba) }
        : { rgba: null, color: null, opacity: null };
      const composed = composeGeomAppearance(geomState, baseAppearance, true);
      applyAppearanceToMaterial(mesh, composed.appearance);
      applyMaterialOverrides(mesh.material, composed.overrides);
      visible = composed.visible;
      if (hideAllGeometry) visible = false;
      mesh.userData = mesh.userData || {};
      const alpha = composed?.appearance?.opacity;
      if (typeof alpha === 'number' && Number.isFinite(alpha)) {
        mesh.userData.baseAlpha = alpha;
      } else if (mesh.material && typeof mesh.material.opacity === 'number') {
        mesh.userData.baseAlpha = mesh.material.opacity;
      }
      if (geomState?.view) geomState.view.__dirty = false;
      applyMaterialFlags(mesh, meshIndex, state, flags);
      const texcoordMode =
        (gtypeRaw === MJ_GEOM.MESH || gtypeRaw === MJ_GEOM.SDF) && mesh.geometry && typeof mesh.geometry.getAttribute === 'function' && mesh.geometry.getAttribute('uv')
          ? 'explicit'
          : 'generated';
      applyMuJoCoTextureToMesh(mesh, matId, ctx, assets, textureEnabled, {
        texcoordMode,
        geomType: gtypeRaw,
        geomSize: sizeVec,
        geomDataId: dataId,
      });
    }

    mesh.visible = visible;
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
  const extras = [];
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
  const tCreateStart = (typeof performance !== 'undefined' && performance.now) ? performance.now() : null;
  const createTimeBudgetMs = 6;
  for (let k = 0; k < extras.length; k += 1) {
    const meshIndex = baseNgeom + k;
    const scnIdx = extras[k] | 0;
    const existing = Array.isArray(ctx.meshes) ? ctx.meshes[meshIndex] : null;
    if (!existing) {
      if (tCreateStart != null && (performance.now() - tCreateStart) > createTimeBudgetMs) continue;
      if (createdThisFrame >= createBudget) continue;
      createdThisFrame += 1;
    }
    if (updateOne(meshIndex, scnIdx, null)) drawn += 1;
  }

  // Hide any stale meshes beyond current range.
  const total = baseNgeom + extras.length;
  if (Array.isArray(ctx.meshes) && ctx.meshes.length > total) {
    for (let i = total; i < ctx.meshes.length; i += 1) {
      if (ctx.meshes[i]) ctx.meshes[i].visible = false;
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

  // Expose a small helper so other modules (e.g. environment manager)
  // can tweak JS-side geom view state without needing to know where
  // those fields live.
  ctx.setGeomViewProps = (geomIndex, props) => setGeomViewProps(ctx, geomIndex, props || {});

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
    context.visualSourceMode = state.visualSourceMode || 'model';
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
    const siteGroupIds = assets?.sites?.group || null;
    const siteGroupMask = Array.isArray(state.rendering?.groups?.site) ? state.rendering.groups.site : null;
    const tendonGroupIds = assets?.tendons?.group || null;
    const tendonGroupMask = Array.isArray(state.rendering?.groups?.tendon) ? state.rendering.groups.tendon : null;
    const flexGroupIds = assets?.flexes?.group || null;
    const flexGroupMask = Array.isArray(state.rendering?.groups?.flex) ? state.rendering.groups.flex : null;
    const skinGroupIds = assets?.skins?.group || null;
    const skinGroupMask = Array.isArray(state.rendering?.groups?.skin) ? state.rendering.groups.skin : null;

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
    const fogConfig = resolveFogConfig(visStruct, statStruct, context.bounds, fogEnabled);
    if (fogConfig.enabled && !fogConfig.color) {
      const presetFog = context.fallback && Number.isFinite(context.fallback.fogColor)
        ? context.fallback.fogColor
        : null;
      if (presetFog != null) {
        fogConfig.color = new THREE.Color(presetFog);
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
    debugHazeState(hazeSummary);
    if (visStruct && !segmentEnabled) {
      const mode = state.visualSourceMode || 'model';
      const presetMode = mode === 'preset' || mode === 'preset-sun' || mode === 'preset-moon';
      if (!presetMode) {
        applyVisualLighting(context, visStruct);
      }
    }

    if (context.renderer) {
      context.renderer.shadowMap.enabled = shadowEnabled;
      if (context.renderer.shadowMap) {
        context.renderer.shadowMap.type = THREE.PCFShadowMap;
      }
    }
    if (context.light) {
      context.light.castShadow = shadowEnabled;
    }

    const showContactPoint = voptEnabled(voptFlags, MJ_VIS.CONTACTPOINT);
    const showContactForce = voptEnabled(voptFlags, MJ_VIS.CONTACTFORCE);
    if (showContactPoint) {
      const pointPayload = buildContactPointOverlayDescriptors(snapshot, state, context, { segmentEnabled });
      applyContactPointOverlayDescriptors(context, pointPayload);
      updateTactileOverlays(context, snapshot, state, assets, { voptFlags });
    } else {
      if (context.contactGroup) context.contactGroup.visible = false;
      hideTactileGroup(context);
    }
    if (showContactForce) {
      const forcePayload = buildContactForceOverlayDescriptors(snapshot, state, context, { segmentEnabled });
      applyContactForceOverlayDescriptors(context, forcePayload);
    } else {
      if (context.contactForceGroup) context.contactForceGroup.visible = false;
    }

    const hideAllGeometry = !!hideAllGeometryDefault;

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
    const showBodyBvh = voptEnabled(voptFlags, MJ_VIS.BODYBVH);
    const showMeshBvh = voptEnabled(voptFlags, MJ_VIS.MESHBVH);
    const showInertia = voptEnabled(voptFlags, MJ_VIS.INERTIA);
    const showAutoConnect = voptEnabled(voptFlags, MJ_VIS.AUTOCONNECT);
    const showPertForce = voptEnabled(voptFlags, MJ_VIS.PERTFORCE);

    if (showCamera) {
      cameraDescriptors = buildCameraOverlayDescriptors(snapshot, state, context);
      applyCameraOverlayDescriptors(context, cameraDescriptors);
    } else {
      hideCameraGroup(context);
    }
    if (showLight) {
      const lightDescriptors = buildLightOverlayDescriptors(snapshot, state, context);
      applyLightOverlayDescriptors(context, lightDescriptors);
    } else {
      hideLightGroup(context);
    }
    if (showCom) {
      const comDescriptors = buildComOverlayDescriptors(snapshot, state, context);
      applyComOverlayDescriptors(context, comDescriptors);
    } else {
      hideComGroup(context);
    }
    if (showJoint) {
      const jointDescriptors = buildJointOverlayDescriptors(snapshot, state, context);
      applyJointOverlayDescriptors(context, jointDescriptors);
    } else {
      hideJointGroup(context);
    }
    if (showActuator) {
      const actuatorDescriptors = buildActuatorOverlayDescriptors(snapshot, state, context);
      applyActuatorOverlayDescriptors(context, actuatorDescriptors);
    } else {
      hideActuatorGroup(context);
    }
    // Simulate renders slider-crank geoms whenever mjTRN_SLIDERCRANK actuators exist,
    // independent of mjVIS_ACTUATOR; keep parity by not gating this overlay on showActuator.
    if (hideAllGeometry) {
      hideSlidercrankGroup(context);
    } else {
      const sliderDescriptors = buildSlidercrankOverlayDescriptors(snapshot, state, context);
      applySlidercrankOverlayDescriptors(context, sliderDescriptors);
    }
    if (showRangefinder) {
      const rangeDescriptors = buildRangefinderOverlayDescriptors(snapshot, state, context);
      applyRangefinderOverlayDescriptors(context, rangeDescriptors);
    } else {
      hideRangefinderGroup(context);
    }
    if (showConstraint) {
      const constraintDescriptors = buildConstraintOverlayDescriptors(snapshot, state, context);
      applyConstraintOverlayDescriptors(context, constraintDescriptors);
    } else {
      hideConstraintGroup(context);
    }
    // Perturb overlay is driven by runtime.pertViz in state; descriptors take care of the helpers.
    const perturbDescriptors = buildPerturbOverlayDescriptors(snapshot, state, context, overlayOptions);
    applyPerturbOverlayDescriptors(context, perturbDescriptors);

    if (showBodyBvh || showMeshBvh) {
      updateBvhOverlays(context, snapshot, state, assets, {
        voptFlags,
        hideAllGeometry,
        flexGroupIds,
        flexGroupMask,
      });
    } else {
      hideBvhGroup(context);
    }
    if (showInertia) {
      updateInertiaOverlays(context, snapshot, state, assets, { voptFlags, hideAllGeometry });
    } else {
      hideInertiaGroup(context);
    }
    if (showAutoConnect) {
      updateAutoConnectOverlays(context, snapshot, state, assets, { voptFlags, hideAllGeometry });
    } else {
      hideAutoConnectGroup(context);
    }
    if (showPertForce) {
      updateExternalPerturbOverlays(context, snapshot, state, { voptFlags });
    } else {
      hideExternalPerturbGroup(context);
    }

    const hasSceneSoA =
      (snapshot?.scn_ngeom | 0) > 0 &&
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
    const geomDescriptors = null;

    // Scene-first: base-layer rendering is driven solely by mjvScene SoA.
    // Legacy JS-side scene construction (geom/site/tendon/flex/skin) is disabled.
    if (hasSceneSoA) {
      drawn = applyMjvSceneSoAGeoms(context, snapshot, state, assets, {
        sceneFlags,
        reflectionEnabled,
        hideAllGeometry,
      });
    } else {
      // No fallback: wait for scene to become available (initial frames after load).
      if (!context._missingSceneSoALogged) {
        context._missingSceneSoALogged = true;
        warnLog('[render] mjvScene SoA missing; base-layer rendering disabled until scene arrives', {
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
    // Always hide legacy base-layer groups in scene-first mode.
    applySiteDescriptors(context, [], {
      assets,
      state,
      snapshot,
      hideAllGeometry: true,
      voptFlags,
      siteGroupIds,
      siteGroupMask,
    });
    applyTendonSegmentDescriptors(context, [], {
      assets,
      state,
      hideAllGeometry: true,
      tendonGroupIds,
      tendonGroupMask,
    });

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
        const presetMode = context._lastPresetMode === true;
        const groundPreset = presetMode ? context.fallback?.ground || null : null;
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

    if (voptEnabled(voptFlags, MJ_VIS.SELECT)) {
      const selectionDescriptor = buildSelectionOverlayDescriptors(snapshot, state, context);
      applySelectionOverlayDescriptors(context, selectionDescriptor);
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
  const overlayCfg = ctx.fallback?.overlays || null;
  const fallbackColor =
    overlayCfg && Number.isFinite(overlayCfg.selectPoint)
      ? overlayCfg.selectPoint
      : SELECT_POINT_FALLBACK_COLOR;
  const material = new THREE.MeshBasicMaterial({
    color: fallbackColor,
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

function applySelectionPointDescriptor(ctx, desc) {
  if (!ctx || !desc) return;
  const overlay = ensureSelectionPointOverlay(ctx);
  if (!overlay) return;
  const position = Array.isArray(desc.position) && desc.position.length >= 3
    ? desc.position
    : [0, 0, 0];
  const normalArr = Array.isArray(desc.normal) && desc.normal.length >= 3
    ? desc.normal
    : [0, 0, 1];
  const radius = Math.max(1e-4, Number(desc.radius) || 0);
  SELECTION_NORMAL_VEC.set(normalArr[0] || 0, normalArr[1] || 0, normalArr[2] || 1);
  if (SELECTION_NORMAL_VEC.lengthSq() <= 0) {
    SELECTION_NORMAL_VEC.set(0, 0, 1);
  } else {
    SELECTION_NORMAL_VEC.normalize();
  }
  const offset = SELECTION_NORMAL_VEC.clone().multiplyScalar(radius * 0.4);
  overlay.mesh.position.set(
    (position[0] || 0) + offset.x,
    (position[1] || 0) + offset.y,
    (position[2] || 0) + offset.z,
  );
  overlay.mesh.scale.set(radius, radius, radius);
  overlay.mesh.visible = true;
  const material = overlay.material;
  if (material) {
    material.color.setHex(Number(desc.colorHex) || 0);
    const opacity = Number(desc.opacity);
    material.opacity = Number.isFinite(opacity) ? opacity : 1;
    material.transparent = material.opacity < 0.999;
    material.needsUpdate = true;
  }
}

function buildSelectionOverlayDescriptors(snapshot, state, ctx) {
  const selection = state?.runtime?.selection;
  if (!selection || selection.geom < 0) {
    return { highlight: null, point: null };
  }
  const mesh = Array.isArray(ctx?.meshes) ? ctx.meshes[selection.geom] : null;
  if (!mesh) {
    return { highlight: null, point: null };
  }
  const highlight = { meshIndex: selection.geom };
  const pointPosition = (() => {
    if (Array.isArray(selection.localPoint) && selection.localPoint.length >= 3 && mesh.matrixWorld) {
      const lp = SELECTION_TEMP_VEC.set(
        Number(selection.localPoint[0]) || 0,
        Number(selection.localPoint[1]) || 0,
        Number(selection.localPoint[2]) || 0,
      );
      return lp.applyMatrix4(mesh.matrixWorld).toArray();
    }
    if (Array.isArray(selection.point) && selection.point.length >= 3) {
      return [
        Number(selection.point[0]) || 0,
        Number(selection.point[1]) || 0,
        Number(selection.point[2]) || 0,
      ];
    }
    return null;
  })();
  if (!pointPosition) {
    return { highlight, point: null };
  }
  const scaleStruct = state?.model?.vis?.scale || {};
  const rgbaStruct = state?.model?.vis?.rgba || {};
  const { scaleAll } = computeMeanScale(state, ctx);
  const selectScale = Number.isFinite(Number(scaleStruct.selectpoint)) && Number(scaleStruct.selectpoint) > 0
    ? Number(scaleStruct.selectpoint)
    : 0.2;
  const boundsRadius = Math.max(0.05, ctx?.bounds?.radius || 1);
  const radius = Math.max(0.003, boundsRadius * 0.0125 * scaleAll * selectScale);
  const overlayCfg = ctx?.fallback?.overlays || null;
  const selectFallback =
    overlayCfg && Number.isFinite(overlayCfg.selectPoint)
      ? overlayCfg.selectPoint
      : SELECT_POINT_FALLBACK_COLOR;
  const colorHex = rgbaToHex(rgbaStruct.selectpoint, selectFallback);
  const opacity = alphaFromArray(rgbaStruct.selectpoint, 1);
  const normal = (() => {
    if (Array.isArray(selection.normal) && selection.normal.length >= 3) {
      const vec = SELECTION_NORMAL_VEC.set(
        Number(selection.normal[0]) || 0,
        Number(selection.normal[1]) || 0,
        Number(selection.normal[2]) || 1,
      );
      if (vec.lengthSq() <= 0) {
        vec.set(0, 0, 1);
      } else {
        vec.normalize();
      }
      return [vec.x, vec.y, vec.z];
    }
    return [0, 0, 1];
  })();
  return {
    highlight,
    point: {
      position: pointPosition,
      normal,
      radius,
      colorHex,
      opacity,
    },
  };
}

function applySelectionOverlayDescriptors(ctx, descriptor) {
  const highlight = descriptor?.highlight;
  if (highlight?.meshIndex >= 0) {
    const mesh = Array.isArray(ctx?.meshes) ? ctx.meshes[highlight.meshIndex] : null;
    if (mesh) {
      applySelectionHighlight(ctx, mesh);
    } else {
      clearSelectionHighlight(ctx);
    }
  } else {
    clearSelectionHighlight(ctx);
  }
  const pointDesc = descriptor?.point;
  if (pointDesc) {
    applySelectionPointDescriptor(ctx, pointDesc);
  } else {
    hideSelectionPoint(ctx);
  }
}

function buildPerturbOverlayDescriptors(snapshot, state, ctx, options = {}) {
  const viz = state?.runtime?.pertViz;
  if (!viz || !viz.active) {
    return [];
  }
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
  const selection = state?.runtime?.selection;
  if (selection && selection.geom >= 0 && Array.isArray(selection.localPoint) && selection.localPoint.length >= 3) {
    const mesh = Array.isArray(ctx?.meshes) ? ctx.meshes[selection.geom] : null;
    if (mesh) {
      anchor.set(
        Number(selection.localPoint[0]) || 0,
        Number(selection.localPoint[1]) || 0,
        Number(selection.localPoint[2]) || 0,
      );
      mesh.localToWorld(anchor);
      cursor.copy(anchor).add(cursorOffset);
    }
  }
  const mode = String(viz.mode || 'translate');
  if (mode === 'rotate') {
    const torqueVec = Array.isArray(viz.torque)
      ? PERTURB_TEMP_AXIS.set(
          Number(viz.torque[0]) || 0,
          Number(viz.torque[1]) || 0,
          Number(viz.torque[2]) || 0,
        )
      : null;
    const torqueMag = torqueVec ? torqueVec.length() : 0;
    if (!torqueVec || torqueMag < 1e-8) {
      return [];
    }
    const axis = torqueVec.normalize();
    const radius = Math.max(
      0.02 * sceneRadius,
      Math.min(sceneRadius * 0.25, Math.log(1 + torqueMag / Math.max(1e-6, sceneRadius * 0.3)) * sceneRadius * 0.06),
    );
    const quat = PERTURB_TEMP_QUAT.setFromUnitVectors(PERTURB_RING_NORMAL, axis);
    const descriptors = [
      {
        kind: 'overlay',
        subtype: OVERLAY_SUBTYPE.PERTURB_ROTATE,
        variant: 'ring',
        position: [anchor.x, anchor.y, anchor.z],
        quaternion: [quat.x, quat.y, quat.z, quat.w],
        radius,
        colorHex: PERTURB_COLOR_RING,
        opacity: 0.45,
      },
    ];
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
    radials.forEach((radialVec, idx) => {
      const tangentDir = tangents[idx];
      const ringPoint = anchor.clone().add(radialVec.clone().multiplyScalar(radius));
      descriptors.push({
        kind: 'overlay',
        subtype: OVERLAY_SUBTYPE.PERTURB_ROTATE,
        variant: 'arrow',
        arrowIndex: idx,
        position: [ringPoint.x, ringPoint.y, ringPoint.z],
        direction: [tangentDir.x, tangentDir.y, tangentDir.z],
        shaftRadius,
        shaftLength: shaftLen,
        headLength: headLen,
        colorHex: PERTURB_COLOR_ARROW,
        opacity: 1,
      });
    });
    return descriptors;
  }
  const dir = PERTURB_TEMP_DIR.copy(cursor).sub(anchor);
  const distance = dir.length();
  if (distance < 1e-6) {
    return [];
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
  return [{
    kind: 'overlay',
    subtype: OVERLAY_SUBTYPE.PERTURB_TRANSLATE,
    position: [anchor.x, anchor.y, anchor.z],
    direction: [dirNorm.x, dirNorm.y, dirNorm.z],
    shaftRadius,
    shaftLength,
    headLength,
    lineStart: [anchor.x, anchor.y, anchor.z],
    lineEnd: [cursor.x, cursor.y, cursor.z],
    colorHex: PERTURB_COLOR_TRANSLATE,
    opacity: 0.95,
  }];
}

function applyPerturbOverlayDescriptors(ctx, descriptors) {
  if (!ctx) return;
  const hasDescriptors = Array.isArray(descriptors) && descriptors.length > 0;
  if (!hasDescriptors) {
    hidePerturbTranslate(ctx);
    hidePerturbRotate(ctx);
    if (ctx?.perturbGroup) ctx.perturbGroup.visible = false;
    return;
  }
  ensurePerturbHelpers(ctx);
  if (ctx?.perturbGroup) ctx.perturbGroup.visible = true;
  const translateDesc = descriptors.find((desc) => desc?.subtype === OVERLAY_SUBTYPE.PERTURB_TRANSLATE);
  if (translateDesc) {
    hidePerturbRotate(ctx);
    const translate = ctx?.perturbTranslate;
    if (translate) {
      translate.node.visible = true;
      const mat = translate.material;
      if (mat) {
        mat.color.setHex(Number(translateDesc.colorHex) || PERTURB_COLOR_TRANSLATE);
        const opacity = Number(translateDesc.opacity);
        mat.opacity = Number.isFinite(opacity) ? opacity : 0.95;
        mat.transparent = mat.opacity < 0.999;
        mat.needsUpdate = true;
      }
      translate.node.position.set(
        Number(translateDesc.position?.[0]) || 0,
        Number(translateDesc.position?.[1]) || 0,
        Number(translateDesc.position?.[2]) || 0,
      );
      const dirVec = PERTURB_TEMP_DIR.set(
        Number(translateDesc.direction?.[0]) || 0,
        Number(translateDesc.direction?.[1]) || 0,
        Number(translateDesc.direction?.[2]) || 0,
      );
      if (dirVec.lengthSq() <= 0) {
        dirVec.set(0, 1, 0);
      } else {
        dirVec.normalize();
      }
      translate.node.quaternion.copy(PERTURB_TEMP_QUAT.setFromUnitVectors(PERTURB_AXIS_DEFAULT, dirVec));
      const shaftLength = Math.max(1e-4, Number(translateDesc.shaftLength) || 0);
      const shaftRadius = Math.max(1e-4, Number(translateDesc.shaftRadius) || 0);
      const headLength = Math.max(1e-4, Number(translateDesc.headLength) || 0);
      if (translate.shaft) {
        translate.shaft.scale.set(shaftRadius, shaftLength, shaftRadius);
        translate.shaft.position.set(0, shaftLength / 2, 0);
      }
      if (translate.head) {
        translate.head.scale.set(shaftRadius * 1.9, headLength, shaftRadius * 1.9);
        translate.head.position.set(0, shaftLength + headLength / 2, 0);
      }
      const line = translate.line;
      if (line?.geometry?.attributes?.position) {
        const attr = line.geometry.attributes.position;
        attr.setXYZ(
          0,
          Number(translateDesc.lineStart?.[0]) || 0,
          Number(translateDesc.lineStart?.[1]) || 0,
          Number(translateDesc.lineStart?.[2]) || 0,
        );
        attr.setXYZ(
          1,
          Number(translateDesc.lineEnd?.[0]) || 0,
          Number(translateDesc.lineEnd?.[1]) || 0,
          Number(translateDesc.lineEnd?.[2]) || 0,
        );
        attr.needsUpdate = true;
        line.geometry.computeBoundingSphere?.();
        line.visible = true;
      }
    }
  } else {
    hidePerturbTranslate(ctx);
  }
  const rotateDescs = descriptors.filter((desc) => desc?.subtype === OVERLAY_SUBTYPE.PERTURB_ROTATE);
  const rotate = ctx?.perturbRotate;
  const ringDesc = rotateDescs.find((desc) => desc?.variant === 'ring');
  if (ringDesc && rotate) {
    hidePerturbTranslate(ctx);
    rotate.ring.visible = true;
    rotate.ring.position.set(
      Number(ringDesc.position?.[0]) || 0,
      Number(ringDesc.position?.[1]) || 0,
      Number(ringDesc.position?.[2]) || 0,
    );
    rotate.ring.quaternion.set(
      Number(ringDesc.quaternion?.[0]) || 0,
      Number(ringDesc.quaternion?.[1]) || 0,
      Number(ringDesc.quaternion?.[2]) || 0,
      Number(ringDesc.quaternion?.[3]) || 1,
    );
    const ringRadius = Math.max(1e-4, Number(ringDesc.radius) || 0);
    rotate.ring.scale.setScalar(ringRadius);
    const ringMat = rotate.ring.material;
    if (ringMat) {
      ringMat.color.setHex(Number(ringDesc.colorHex) || PERTURB_COLOR_RING);
      const opacity = Number(ringDesc.opacity);
      ringMat.opacity = Number.isFinite(opacity) ? opacity : 0.45;
      ringMat.transparent = ringMat.opacity < 0.999;
      ringMat.needsUpdate = true;
    }
    const arrowMap = new Map();
    rotateDescs.forEach((desc) => {
      if (desc?.variant === 'arrow' && Number.isFinite(Number(desc.arrowIndex))) {
        arrowMap.set(Number(desc.arrowIndex), desc);
      }
    });
    rotate.arrows.forEach((arrow, idx) => {
      const desc = arrowMap.get(idx);
      if (!desc) {
        if (arrow?.node) arrow.node.visible = false;
        return;
      }
      arrow.node.visible = true;
      arrow.node.position.set(
        Number(desc.position?.[0]) || 0,
        Number(desc.position?.[1]) || 0,
        Number(desc.position?.[2]) || 0,
      );
      const tangent = PERTURB_TEMP_TANGENT.set(
        Number(desc.direction?.[0]) || 0,
        Number(desc.direction?.[1]) || 0,
        Number(desc.direction?.[2]) || 0,
      );
      if (tangent.lengthSq() <= 0) {
        tangent.set(0, 1, 0);
      } else {
        tangent.normalize();
      }
      arrow.node.quaternion.copy(PERTURB_TEMP_QUAT.setFromUnitVectors(PERTURB_AXIS_DEFAULT, tangent));
      const shaftLength = Math.max(1e-4, Number(desc.shaftLength) || 0);
      const shaftRadius = Math.max(1e-4, Number(desc.shaftRadius) || 0);
      const headLength = Math.max(1e-4, Number(desc.headLength) || 0);
      if (arrow.shaft) {
        arrow.shaft.scale.set(shaftRadius, shaftLength, shaftRadius);
        arrow.shaft.position.set(0, shaftLength / 2, 0);
      }
      if (arrow.head) {
        arrow.head.scale.set(shaftRadius * 1.8, headLength, shaftRadius * 1.8);
        arrow.head.position.set(0, shaftLength + headLength / 2, 0);
      }
      const arrowMat = arrow.material;
      if (arrowMat) {
        arrowMat.color.setHex(Number(desc.colorHex) || PERTURB_COLOR_ARROW);
        const opacity = Number(desc.opacity);
        arrowMat.opacity = Number.isFinite(opacity) ? opacity : 1;
        arrowMat.transparent = arrowMat.opacity < 0.999;
        arrowMat.needsUpdate = true;
      }
    });
  } else if (rotate) {
    hidePerturbRotate(ctx);
  }
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
  const overlayCfg = ctx.fallback?.overlays || null;
  const overlayFallback =
    overlayCfg && Number.isFinite(overlayCfg.selectionOverlay)
      ? overlayCfg.selectionOverlay
      : null;
  const overlayMaterial = new THREE.MeshBasicMaterial({
    color: overlayFallback != null ? overlayFallback : SELECTION_OVERLAY_COLOR,
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

function buildLightOverlayDescriptors(snapshot, state, ctx) {
  const pos = snapshot?.light_xpos;
  const dir = snapshot?.light_xdir;
  if (!pos || !dir || pos.length < 3 || dir.length < 3) return [];
  const visScale = state?.model?.vis?.scale || {};
  const visRgba = state?.model?.vis?.rgba || {};
  const { meanSize, scaleAll } = computeMeanScale(state, ctx);
  const sizeScale = Math.max(1e-6, Number(visScale.light) || 1) * scaleAll;
  const overlayCfg = ctx?.fallback?.overlays || null;
  const lightFallback =
    overlayCfg && Number.isFinite(overlayCfg.light)
      ? overlayCfg.light
      : 0x8899ff;
  const colorHex = rgbaToHex(visRgba.light, lightFallback);
  const opacity = alphaFromArray(visRgba.light, 1);
  const count = Math.floor(pos.length / 3);
  const descriptors = [];
  for (let i = 0; i < count; i += 1) {
    const base = 3 * i;
    const px = Number(pos[base + 0]) || 0;
    const py = Number(pos[base + 1]) || 0;
    const pz = Number(pos[base + 2]) || 0;
    const dirBase = 3 * i;
    const direction = [
      Number(dir[dirBase + 0]) || 0,
      Number(dir[dirBase + 1]) || 0,
      Number(dir[dirBase + 2]) || 1,
    ];
    const offset = Math.max(1e-4, meanSize * sizeScale);
    const radius = Math.max(1e-4, meanSize * sizeScale * 0.8);
    const height = Math.max(1e-4, meanSize * sizeScale * 1.0);
    descriptors.push({
      kind: 'overlay',
      subtype: OVERLAY_SUBTYPE.LIGHT,
      index: i,
      position: [px, py, pz],
      direction,
      radius,
      height,
      offset,
      colorHex,
      opacity,
    });
  }
  return descriptors;
}

function applyLightOverlayDescriptors(ctx, descriptors) {
  if (!ctx) return;
  const group = ensureLightGroup(ctx);
  if (!Array.isArray(descriptors) || descriptors.length === 0) {
    hideLightGroup(ctx);
    return;
  }
  const pool = ctx.lightPool || (ctx.lightPool = []);
  let used = 0;
  const tmpDir = LIGHT_TMP_DIR;
  for (const desc of descriptors) {
    if (!desc || desc.subtype !== OVERLAY_SUBTYPE.LIGHT) continue;
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
      mesh = new THREE.Mesh(LIGHT_GIZMO_GEOMETRY, mat);
      mesh.userData.overlayKind = 'overlay';
      mesh.userData.overlaySubtype = OVERLAY_SUBTYPE.LIGHT;
      mesh.renderOrder = 54;
      pool[used] = mesh;
      group.add(mesh);
    }
    mesh.visible = true;
    tmpDir.set(desc.direction[0], desc.direction[1], desc.direction[2]).normalize();
    LIGHT_TMP_QUAT.setFromUnitVectors(PERTURB_AXIS_DEFAULT, tmpDir);
    mesh.quaternion.copy(LIGHT_TMP_QUAT);
    const offset = desc.offset || 0;
    mesh.position.set(
      desc.position[0] - tmpDir.x * offset,
      desc.position[1] - tmpDir.y * offset,
      desc.position[2] - tmpDir.z * offset,
    );
    mesh.scale.set(desc.radius, desc.height, desc.radius);
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

function buildComOverlayDescriptors(snapshot, state, ctx) {
  const xipos = snapshot?.xipos;
  if (!xipos || xipos.length < 3) return [];
  const visScale = state?.model?.vis?.scale || {};
  const visRgba = state?.model?.vis?.rgba || {};
  const { meanSize, scaleAll } = computeMeanScale(state, ctx);
  const sizeScale = Math.max(1e-6, Number(visScale.com) || 1) * scaleAll;
  const overlayCfg = ctx?.fallback?.overlays || null;
  const comFallback =
    overlayCfg && Number.isFinite(overlayCfg.com)
      ? overlayCfg.com
      : 0xe6e6e6;
  const colorHex = rgbaToHex(visRgba.com, comFallback);
  const opacity = alphaFromArray(visRgba.com, 1);
  const count = Math.floor(xipos.length / 3);
  const bodyParent = state?.model?.bodyParentId || null;
  const descriptors = [];
  const maxIndex = bodyParent && typeof bodyParent.length === 'number'
    ? Math.min(count, bodyParent.length)
    : count;
  for (let i = 1; i < maxIndex; i += 1) { // skip world body 0
    if (bodyParent && typeof bodyParent.length === 'number') {
      const parentId = Number(bodyParent[i]);
      if (Number.isFinite(parentId) && parentId !== 0) continue;
    }
    const base = 3 * i;
    const position = [
      Number(xipos[base + 0]) || 0,
      Number(xipos[base + 1]) || 0,
      Number(xipos[base + 2]) || 0,
    ];
    const radius = Math.max(1e-4, meanSize * sizeScale);
    descriptors.push({
      kind: 'overlay',
      subtype: OVERLAY_SUBTYPE.COM,
      index: i,
      position,
      radius,
      colorHex,
      opacity,
    });
  }
  return descriptors;
}

function applyComOverlayDescriptors(ctx, descriptors) {
  if (!ctx) return;
  const group = ensureComGroup(ctx);
  if (!Array.isArray(descriptors) || descriptors.length === 0) {
    hideComGroup(ctx);
    return;
  }
  const pool = ctx.comPool || (ctx.comPool = []);
  let used = 0;
  for (const desc of descriptors) {
    if (!desc || desc.subtype !== OVERLAY_SUBTYPE.COM) continue;
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
      mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 14, 10), mat);
      mesh.userData.overlayKind = 'overlay';
      mesh.userData.overlaySubtype = OVERLAY_SUBTYPE.COM;
      mesh.renderOrder = 53;
      pool[used] = mesh;
      group.add(mesh);
    }
    mesh.visible = true;
    mesh.position.set(desc.position[0], desc.position[1], desc.position[2]);
    mesh.scale.set(desc.radius, desc.radius, desc.radius);
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

function buildRangefinderOverlayDescriptors(snapshot, state, ctx) {
  const sensorAssets =
    state?.rendering?.assets?.sensors ||
    snapshot?.renderAssets?.sensors ||
    null;
  const sensorType = sensorAssets?.type || snapshot?.sensor_type;
  const sensorObj = sensorAssets?.objid || snapshot?.sensor_objid;
  const sensorAdr = sensorAssets?.adr || null;
  const sensordata = snapshot?.sensordata;
  const siteXpos = snapshot?.site_xpos;
  const siteXmat = snapshot?.site_xmat;
  if (!sensorType || !sensorObj || !sensordata || !siteXpos || !siteXmat) {
    return [];
  }
  const visRgba = state?.model?.vis?.rgba || {};
  const overlayCfg = ctx?.fallback?.overlays || null;
  const rangefinderFallback =
    overlayCfg && Number.isFinite(overlayCfg.rangefinder)
      ? overlayCfg.rangefinder
      : 0xffff66;
  const colorHex = rgbaToHex(visRgba.rangefinder, rangefinderFallback);
  const opacity = alphaFromArray(visRgba.rangefinder, 1);
  const maxIndex = Math.min(sensorType.length, sensorObj.length);
  const descriptors = [];
  let descriptorIndex = 0;
  const ns = Math.floor(siteXpos.length / 3);
  for (let i = 0; i < maxIndex; i += 1) {
    const stype = Number(sensorType[i]) | 0;
    const adr = sensorAdr && i < sensorAdr.length ? (sensorAdr[i] | 0) : (i | 0);
    if (stype === MJ_SENSOR.RANGEFINDER) {
      const sid = Number(sensorObj[i]) | 0;
      if (sid < 0 || sid >= ns) continue;
      if (adr < 0 || adr >= sensordata.length) continue;
      const dist = Number(sensordata[adr]) || 0;
      if (dist < 0) continue;
      const base = 3 * sid;
      const px = Number(siteXpos[base + 0]) || 0;
      const py = Number(siteXpos[base + 1]) || 0;
      const pz = Number(siteXpos[base + 2]) || 0;
      const rotBase = 9 * sid;
      const dx = Number(siteXmat[rotBase + 2]) || 0;
      const dy = Number(siteXmat[rotBase + 5]) || 0;
      const dz = Number(siteXmat[rotBase + 8]) || 0;
      descriptors.push({
        kind: 'overlay',
        subtype: OVERLAY_SUBTYPE.RANGEFINDER,
        index: descriptorIndex,
        position: [px, py, pz],
        target: [px + dx * dist, py + dy * dist, pz + dz * dist],
        colorHex,
        opacity,
      });
      descriptorIndex += 1;
      continue;
    }
    if (stype === MJ_SENSOR.GEOMFROMTO) {
      if (adr < 0 || (adr + 5) >= sensordata.length) continue;
      const fx = Number(sensordata[adr + 0]) || 0;
      const fy = Number(sensordata[adr + 1]) || 0;
      const fz = Number(sensordata[adr + 2]) || 0;
      const tx = Number(sensordata[adr + 3]) || 0;
      const ty = Number(sensordata[adr + 4]) || 0;
      const tz = Number(sensordata[adr + 5]) || 0;
      if (!(fx || fy || fz || tx || ty || tz)) continue;
      descriptors.push({
        kind: 'overlay',
        subtype: OVERLAY_SUBTYPE.RANGEFINDER,
        index: descriptorIndex,
        position: [fx, fy, fz],
        target: [tx, ty, tz],
        colorHex,
        opacity,
      });
      descriptorIndex += 1;
    }
  }
  return descriptors;
}

function applyRangefinderOverlayDescriptors(ctx, descriptors) {
  if (!ctx) return;
  const group = ensureRangefinderGroup(ctx);
  if (!Array.isArray(descriptors) || descriptors.length === 0) {
    hideRangefinderGroup(ctx);
    return;
  }
  const pool = ctx.rangefinderPool || (ctx.rangefinderPool = []);
  let used = 0;
  for (const desc of descriptors) {
    if (!desc || desc.subtype !== OVERLAY_SUBTYPE.RANGEFINDER) continue;
    let line = pool[used];
    if (!line) {
      const geom = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(0, 0, 1),
      ]);
      const mat = new THREE.LineBasicMaterial({
        color: desc.colorHex,
        transparent: desc.opacity < 0.999,
        opacity: desc.opacity,
        depthWrite: false,
        fog: false,
      });
      line = new THREE.Line(geom, mat);
      line.renderOrder = 49;
      pool[used] = line;
      group.add(line);
    }
    line.visible = true;
    const origin = desc.position;
    const target = desc.target;
    if (line.geometry?.attributes?.position && origin && target) {
      const attr = line.geometry.attributes.position;
      attr.setXYZ(0, Number(origin[0]) || 0, Number(origin[1]) || 0, Number(origin[2]) || 0);
      attr.setXYZ(1, Number(target[0]) || 0, Number(target[1]) || 0, Number(target[2]) || 0);
      attr.needsUpdate = true;
      line.geometry.computeBoundingSphere?.();
    }
    const mat = line.material;
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

function ensureBvhGroup(ctx) {
  if (!ctx) return null;
  if (!ctx.bvhGroup) {
    const group = new THREE.Group();
    group.name = 'overlay:bvh';
    if (ctx.root) ctx.root.add(group);
    ctx.bvhGroup = group;
    ctx.bvhPool = [];
    ctx._bvhUnitGeometry = new THREE.EdgesGeometry(new THREE.BoxGeometry(2, 2, 2));
  }
  return ctx.bvhGroup;
}

function hideBvhGroup(ctx) {
  if (!ctx) return;
  const group = ctx.bvhGroup || null;
  if (group) group.visible = false;
  if (Array.isArray(ctx.bvhPool)) {
    for (const mesh of ctx.bvhPool) {
      if (mesh) mesh.visible = false;
    }
  }
}

function ensureBvhBox(ctx, poolIndex) {
  const group = ensureBvhGroup(ctx);
  if (!group) return null;
  const pool = Array.isArray(ctx.bvhPool) ? ctx.bvhPool : (ctx.bvhPool = []);
  let box = pool[poolIndex];
  if (!box) {
    const geom = ctx._bvhUnitGeometry || (ctx._bvhUnitGeometry = new THREE.EdgesGeometry(new THREE.BoxGeometry(2, 2, 2)));
    const mat = new THREE.LineBasicMaterial({
      color: 0xffffff,
      transparent: false,
      opacity: 1,
      depthWrite: false,
      toneMapped: false,
      fog: false,
    });
    box = new THREE.LineSegments(geom, mat);
    box.frustumCulled = false;
    box.renderOrder = 42;
    pool[poolIndex] = box;
    group.add(box);
  }
  return box;
}

function updateBvhOverlays(ctx, snapshot, state, assets, options = {}) {
  if (!ctx) return 0;
  const vopt = Array.isArray(options.voptFlags) ? options.voptFlags : (state?.rendering?.voptFlags || []);
  const showBodyBvh = voptEnabled(vopt, MJ_VIS.BODYBVH);
  const showMeshBvh = voptEnabled(vopt, MJ_VIS.MESHBVH);
  if (!showBodyBvh && !showMeshBvh) {
    hideBvhGroup(ctx);
    return 0;
  }
  if (options.hideAllGeometry) {
    hideBvhGroup(ctx);
    return 0;
  }
  const bvh = assets?.bvh || null;
  if (!bvh) {
    hideBvhGroup(ctx);
    return 0;
  }
  const group = ensureBvhGroup(ctx);
  const pool = Array.isArray(ctx.bvhPool) ? ctx.bvhPool : (ctx.bvhPool = []);
  const bvhDepth = Number.isFinite(state?.rendering?.bvhDepth) ? (state.rendering.bvhDepth | 0) : 0;
  const vis = state?.model?.vis || {};
  const rgba = vis.rgba || {};
  const global = vis.global || {};
  const overlayCfg = ctx?.fallback?.overlays || null;
  const bvFallback = overlayCfg && Number.isFinite(overlayCfg.bvh) ? overlayCfg.bvh : 0x66ccff;
  const bvActiveFallback = overlayCfg && Number.isFinite(overlayCfg.bvhActive) ? overlayCfg.bvhActive : 0xffcc66;
  const baseColorHex = rgbaToHex(rgba.bv, bvFallback);
  const activeColorHex = rgbaToHex(rgba.bvactive, bvActiveFallback);
  const baseOpacity = alphaFromArray(rgba.bv, 1);
  const activeEnabled = (global.bvactive | 0) === 1;

  const bvhChild = bvh.child;
  const bvhDepthArr = bvh.depth;
  const bvhNodeId = bvh.nodeid;
  const bvhAabb = bvh.aabb;
  const geomAabb = bvh.geom_aabb;
  const bvhActive = snapshot?.bvh_active || null;
  const bvhAabbDyn = snapshot?.bvh_aabb_dyn || null;
  const nbvh = bvh.count | 0;
  const nbvhstatic = bvh.nbvhstatic | 0;
  const nbvhdynamic = bvh.nbvhdynamic | 0;

  const isLeaf = (nodeIndex) => {
    if (!bvhChild || (2 * nodeIndex + 1) >= bvhChild.length) return false;
    const left = bvhChild[2 * nodeIndex] | 0;
    const right = bvhChild[2 * nodeIndex + 1] | 0;
    return left === -1 && right === -1;
  };
  const shouldRenderNode = (nodeIndex) => {
    if (!(nodeIndex >= 0) || nodeIndex >= nbvh) return false;
    if (!bvhDepthArr || nodeIndex >= bvhDepthArr.length) return true;
    const depthVal = bvhDepthArr[nodeIndex] | 0;
    if (depthVal === bvhDepth) return true;
    const leaf = isLeaf(nodeIndex);
    if (!leaf || depthVal > bvhDepth) return false;
    return true;
  };
  const pickColor = (nodeIndex, meshSkipInactive = false) => {
    if (!activeEnabled || !bvhActive || nodeIndex < 0 || nodeIndex >= bvhActive.length) {
      return { colorHex: baseColorHex, opacity: baseOpacity, skip: false };
    }
    const active = (bvhActive[nodeIndex] | 0) !== 0;
    if (meshSkipInactive && !active) return { colorHex: baseColorHex, opacity: baseOpacity, skip: true };
    return { colorHex: active ? activeColorHex : baseColorHex, opacity: baseOpacity, skip: false };
  };
  const setBoxPose = (box, px, py, pz, rotArr, sx, sy, sz, colorHex, opacity) => {
    box.visible = true;
    box.position.set(px, py, pz);
    if (rotArr && rotArr.length >= 9) {
      TEMP_MAT4.set(
        rotArr[0], rotArr[1], rotArr[2], 0,
        rotArr[3], rotArr[4], rotArr[5], 0,
        rotArr[6], rotArr[7], rotArr[8], 0,
        0, 0, 0, 1,
      );
      box.quaternion.setFromRotationMatrix(TEMP_MAT4);
    } else {
      box.quaternion.set(0, 0, 0, 1);
    }
    box.scale.set(Math.max(0, sx) * 2, Math.max(0, sy) * 2, Math.max(0, sz) * 2);
    const mat = box.material;
    if (mat) {
      mat.color.setHex(colorHex);
      mat.opacity = opacity;
      mat.transparent = opacity < 0.999;
      mat.needsUpdate = true;
    }
  };

  let used = 0;

  // Body BVH (static).
  if (showBodyBvh) {
    const bodyBvhAdr = bvh.body_bvhadr;
    const bodyBvhNum = bvh.body_bvhnum;
    const xipos = snapshot?.xipos || null;
    const ximat = snapshot?.ximat || null;
    const xpos = snapshot?.xpos || null;
    const xmat = snapshot?.xmat || null;
    const ngeom = snapshot?.ngeom | 0;
    const nbody = assets?.bodies?.count | 0;
    if (bodyBvhAdr && bodyBvhNum && xipos && ximat && xpos && xmat && geomAabb && bvhAabb) {
      let bodyId = 0;
      for (let i = 0; i < Math.min(nbvhstatic, nbvh); i += 1) {
        if (!shouldRenderNode(i)) continue;
        while (bodyId < nbody && (i >= ((bodyBvhAdr[bodyId] | 0) + (bodyBvhNum[bodyId] | 0)))) {
          bodyId += 1;
        }
        if (bodyId >= nbody) break;
        const { colorHex, opacity } = pickColor(i, false);
        if (isLeaf(i)) {
          const geomId = bvhNodeId && i < bvhNodeId.length ? (bvhNodeId[i] | 0) : -1;
          if (geomId < 0 || geomId >= ngeom) continue;
          const aabbBase = 6 * geomId;
          if ((aabbBase + 5) >= geomAabb.length) continue;
          const cx = Number(geomAabb[aabbBase + 0]) || 0;
          const cy = Number(geomAabb[aabbBase + 1]) || 0;
          const cz = Number(geomAabb[aabbBase + 2]) || 0;
          const sx = Number(geomAabb[aabbBase + 3]) || 0;
          const sy = Number(geomAabb[aabbBase + 4]) || 0;
          const sz = Number(geomAabb[aabbBase + 5]) || 0;
          const posBase = 3 * geomId;
          const rotBase = 9 * geomId;
          if ((posBase + 2) >= xpos.length || (rotBase + 8) >= xmat.length) continue;
          const ox = Number(xpos[posBase + 0]) || 0;
          const oy = Number(xpos[posBase + 1]) || 0;
          const oz = Number(xpos[posBase + 2]) || 0;
          const rot = [
            xmat[rotBase + 0], xmat[rotBase + 1], xmat[rotBase + 2],
            xmat[rotBase + 3], xmat[rotBase + 4], xmat[rotBase + 5],
            xmat[rotBase + 6], xmat[rotBase + 7], xmat[rotBase + 8],
          ];
          const rx = (Number(rot[0]) || 0) * cx + (Number(rot[1]) || 0) * cy + (Number(rot[2]) || 0) * cz;
          const ry = (Number(rot[3]) || 0) * cx + (Number(rot[4]) || 0) * cy + (Number(rot[5]) || 0) * cz;
          const rz = (Number(rot[6]) || 0) * cx + (Number(rot[7]) || 0) * cy + (Number(rot[8]) || 0) * cz;
          const box = ensureBvhBox(ctx, used);
          if (!box) continue;
          setBoxPose(box, ox + rx, oy + ry, oz + rz, rot, sx, sy, sz, colorHex, opacity);
          used += 1;
        } else {
          const aabbBase = 6 * i;
          if ((aabbBase + 5) >= bvhAabb.length) continue;
          const cx = Number(bvhAabb[aabbBase + 0]) || 0;
          const cy = Number(bvhAabb[aabbBase + 1]) || 0;
          const cz = Number(bvhAabb[aabbBase + 2]) || 0;
          const sx = Number(bvhAabb[aabbBase + 3]) || 0;
          const sy = Number(bvhAabb[aabbBase + 4]) || 0;
          const sz = Number(bvhAabb[aabbBase + 5]) || 0;
          const posBase = 3 * bodyId;
          const rotBase = 9 * bodyId;
          if ((posBase + 2) >= xipos.length || (rotBase + 8) >= ximat.length) continue;
          const ox = Number(xipos[posBase + 0]) || 0;
          const oy = Number(xipos[posBase + 1]) || 0;
          const oz = Number(xipos[posBase + 2]) || 0;
          const rot = [
            ximat[rotBase + 0], ximat[rotBase + 1], ximat[rotBase + 2],
            ximat[rotBase + 3], ximat[rotBase + 4], ximat[rotBase + 5],
            ximat[rotBase + 6], ximat[rotBase + 7], ximat[rotBase + 8],
          ];
          const rx = (Number(rot[0]) || 0) * cx + (Number(rot[1]) || 0) * cy + (Number(rot[2]) || 0) * cz;
          const ry = (Number(rot[3]) || 0) * cx + (Number(rot[4]) || 0) * cy + (Number(rot[5]) || 0) * cz;
          const rz = (Number(rot[6]) || 0) * cx + (Number(rot[7]) || 0) * cy + (Number(rot[8]) || 0) * cz;
          const box = ensureBvhBox(ctx, used);
          if (!box) continue;
          setBoxPose(box, ox + rx, oy + ry, oz + rz, rot, sx, sy, sz, colorHex, opacity);
          used += 1;
        }
      }
    }
  }

  // Mesh BVH (static nodes only).
  if (showMeshBvh) {
    const geoms = assets?.geoms || null;
    const meshBvhAdr = bvh.mesh_bvhadr;
    const meshBvhNum = bvh.mesh_bvhnum;
    const meshOctAdr = bvh.mesh_octadr;
    const xpos = snapshot?.xpos || null;
    const xmat = snapshot?.xmat || null;
    const ngeom = snapshot?.ngeom | 0;
    if (geoms && meshBvhAdr && meshBvhNum && xpos && xmat && bvhAabb) {
      for (let geomId = 0; geomId < ngeom; geomId += 1) {
        const meshId = geoms.dataid && geomId < geoms.dataid.length ? (geoms.dataid[geomId] | 0) : -1;
        if (meshId < 0) continue;
        const octAdr = meshOctAdr && meshId < meshOctAdr.length ? (meshOctAdr[meshId] | 0) : -1;
        if (octAdr >= 0) continue;
        const bvhAdr = meshBvhAdr && meshId < meshBvhAdr.length ? (meshBvhAdr[meshId] | 0) : -1;
        const bvhNum = meshBvhNum && meshId < meshBvhNum.length ? (meshBvhNum[meshId] | 0) : 0;
        if (!(bvhNum > 0) || bvhAdr < 0) continue;
        const posBase = 3 * geomId;
        const rotBase = 9 * geomId;
        if ((posBase + 2) >= xpos.length || (rotBase + 8) >= xmat.length) continue;
        const ox = Number(xpos[posBase + 0]) || 0;
        const oy = Number(xpos[posBase + 1]) || 0;
        const oz = Number(xpos[posBase + 2]) || 0;
        const rot = [
          xmat[rotBase + 0], xmat[rotBase + 1], xmat[rotBase + 2],
          xmat[rotBase + 3], xmat[rotBase + 4], xmat[rotBase + 5],
          xmat[rotBase + 6], xmat[rotBase + 7], xmat[rotBase + 8],
        ];
        for (let b = 0; b < bvhNum; b += 1) {
          const nodeIndex = (bvhAdr + b) | 0;
          if (nodeIndex < 0 || nodeIndex >= nbvhstatic) continue;
          if (!shouldRenderNode(nodeIndex)) continue;
          const { colorHex, opacity, skip } = pickColor(nodeIndex, true);
          if (skip) continue;
          const aabbBase = 6 * nodeIndex;
          if ((aabbBase + 5) >= bvhAabb.length) continue;
          const cx = Number(bvhAabb[aabbBase + 0]) || 0;
          const cy = Number(bvhAabb[aabbBase + 1]) || 0;
          const cz = Number(bvhAabb[aabbBase + 2]) || 0;
          const sx = Number(bvhAabb[aabbBase + 3]) || 0;
          const sy = Number(bvhAabb[aabbBase + 4]) || 0;
          const sz = Number(bvhAabb[aabbBase + 5]) || 0;
          const rx = (Number(rot[0]) || 0) * cx + (Number(rot[1]) || 0) * cy + (Number(rot[2]) || 0) * cz;
          const ry = (Number(rot[3]) || 0) * cx + (Number(rot[4]) || 0) * cy + (Number(rot[5]) || 0) * cz;
          const rz = (Number(rot[6]) || 0) * cx + (Number(rot[7]) || 0) * cy + (Number(rot[8]) || 0) * cz;
          const box = ensureBvhBox(ctx, used);
          if (!box) continue;
          setBoxPose(box, ox + rx, oy + ry, oz + rz, rot, sx, sy, sz, colorHex, opacity);
          used += 1;
        }
      }
    }

    // Mesh octrees (simulate: addMeshOctreeGeoms, gated on mjVIS_MESHBVH).
    const meshOctNum = bvh.mesh_octnum;
    const octDepth = bvh.oct_depth;
    const octAabb = bvh.oct_aabb;
    if (geoms && meshOctAdr && meshOctNum && octDepth && octAabb && xpos && xmat) {
      for (let geomId = 0; geomId < ngeom; geomId += 1) {
        const meshId = geoms.dataid && geomId < geoms.dataid.length ? (geoms.dataid[geomId] | 0) : -1;
        if (meshId < 0) continue;
        const gType = geoms.type && geomId < geoms.type.length ? (geoms.type[geomId] | 0) : -1;
        if (gType === MJ_GEOM.HFIELD) continue;
        const octAdr = meshOctAdr && meshId < meshOctAdr.length ? (meshOctAdr[meshId] | 0) : -1;
        const octNum = meshOctNum && meshId < meshOctNum.length ? (meshOctNum[meshId] | 0) : 0;
        if (!(octNum > 0) || octAdr < 0) continue;
        const posBase = 3 * geomId;
        const rotBase = 9 * geomId;
        if ((posBase + 2) >= xpos.length || (rotBase + 8) >= xmat.length) continue;
        const ox = Number(xpos[posBase + 0]) || 0;
        const oy = Number(xpos[posBase + 1]) || 0;
        const oz = Number(xpos[posBase + 2]) || 0;
        const rot = [
          xmat[rotBase + 0], xmat[rotBase + 1], xmat[rotBase + 2],
          xmat[rotBase + 3], xmat[rotBase + 4], xmat[rotBase + 5],
          xmat[rotBase + 6], xmat[rotBase + 7], xmat[rotBase + 8],
        ];
        for (let b = 0; b < octNum; b += 1) {
          const nodeIndex = (octAdr + b) | 0;
          if (nodeIndex < 0 || nodeIndex >= octDepth.length) continue;
          if ((octDepth[nodeIndex] | 0) !== bvhDepth) continue;
          const aabbBase = 6 * nodeIndex;
          if ((aabbBase + 5) >= octAabb.length) continue;
          const cx = Number(octAabb[aabbBase + 0]) || 0;
          const cy = Number(octAabb[aabbBase + 1]) || 0;
          const cz = Number(octAabb[aabbBase + 2]) || 0;
          const sx = Number(octAabb[aabbBase + 3]) || 0;
          const sy = Number(octAabb[aabbBase + 4]) || 0;
          const sz = Number(octAabb[aabbBase + 5]) || 0;
          const rx = (Number(rot[0]) || 0) * cx + (Number(rot[1]) || 0) * cy + (Number(rot[2]) || 0) * cz;
          const ry = (Number(rot[3]) || 0) * cx + (Number(rot[4]) || 0) * cy + (Number(rot[5]) || 0) * cz;
          const rz = (Number(rot[6]) || 0) * cx + (Number(rot[7]) || 0) * cy + (Number(rot[8]) || 0) * cz;
          const box = ensureBvhBox(ctx, used);
          if (!box) continue;
          setBoxPose(box, ox + rx, oy + ry, oz + rz, rot, sx, sy, sz, baseColorHex, baseOpacity);
          used += 1;
        }
      }
    }

    // Flex BVH (simulate: addFlexBvhGeoms AABBs).
    const flexAssets = assets?.flexes || null;
    const flexBvhAdr = bvh.flex_bvhadr;
    const flexBvhNum = bvh.flex_bvhnum;
    const flexGroupIds = options.flexGroupIds || flexAssets?.group || null;
    const flexGroupMask = options.flexGroupMask || null;
    if (flexAssets && flexBvhAdr && flexBvhNum && bvhAabbDyn && (nbvhdynamic > 0) && (nbvhstatic >= 0)) {
      const nflex = flexAssets.count | 0;
      for (let f = 0; f < nflex; f += 1) {
        const groupId = flexGroupIds && f < flexGroupIds.length ? (flexGroupIds[f] | 0) : 0;
        if (flexGroupMask && Array.isArray(flexGroupMask)) {
          if (groupId >= 0 && groupId < flexGroupMask.length && !flexGroupMask[groupId]) continue;
        }
        const adr = flexBvhAdr && f < flexBvhAdr.length ? (flexBvhAdr[f] | 0) : -1;
        const num = flexBvhNum && f < flexBvhNum.length ? (flexBvhNum[f] | 0) : 0;
        if (!(num > 0) || adr < 0) continue;
        for (let b = 0; b < num; b += 1) {
          const nodeIndex = (adr + b) | 0;
          if (nodeIndex < nbvhstatic) continue;
          if (!shouldRenderNode(nodeIndex)) continue;
          const dynIndex = (nodeIndex - nbvhstatic) | 0;
          if (dynIndex < 0 || dynIndex >= nbvhdynamic) continue;
          const aabbBase = 6 * dynIndex;
          if ((aabbBase + 5) >= bvhAabbDyn.length) continue;
          const cx = Number(bvhAabbDyn[aabbBase + 0]) || 0;
          const cy = Number(bvhAabbDyn[aabbBase + 1]) || 0;
          const cz = Number(bvhAabbDyn[aabbBase + 2]) || 0;
          const sx = Number(bvhAabbDyn[aabbBase + 3]) || 0;
          const sy = Number(bvhAabbDyn[aabbBase + 4]) || 0;
          const sz = Number(bvhAabbDyn[aabbBase + 5]) || 0;
          const { colorHex, opacity } = pickColor(nodeIndex, false);
          const box = ensureBvhBox(ctx, used);
          if (!box) continue;
          setBoxPose(box, cx, cy, cz, null, sx, sy, sz, colorHex, opacity);
          used += 1;
        }
      }
    }
  }

  for (let i = used; i < pool.length; i += 1) {
    if (pool[i]) pool[i].visible = false;
  }
  if (group) group.visible = used > 0;
  ctx.bvhPool = pool;
  return used;
}

function ensureInertiaGroup(ctx) {
  if (!ctx) return null;
  if (!ctx.inertiaGroup) {
    const group = new THREE.Group();
    group.name = 'overlay:inertia';
    if (ctx.root) ctx.root.add(group);
    ctx.inertiaGroup = group;
    ctx.inertiaPool = [];
    ctx._inertiaBoxGeometry = new THREE.BoxGeometry(2, 2, 2);
    ctx._inertiaEllipsoidGeometry = new THREE.SphereGeometry(1, 16, 12);
  }
  return ctx.inertiaGroup;
}

function hideInertiaGroup(ctx) {
  if (!ctx) return;
  const group = ctx.inertiaGroup || null;
  if (group) group.visible = false;
  if (Array.isArray(ctx.inertiaPool)) {
    for (const mesh of ctx.inertiaPool) {
      if (mesh) mesh.visible = false;
    }
  }
}

function ensureInertiaMesh(ctx, poolIndex, ellipsoid) {
  const group = ensureInertiaGroup(ctx);
  if (!group) return null;
  const pool = Array.isArray(ctx.inertiaPool) ? ctx.inertiaPool : (ctx.inertiaPool = []);
  let mesh = pool[poolIndex];
  const want = ellipsoid ? 1 : 0;
  if (!mesh || (mesh.userData?.ellipsoid | 0) !== want) {
    const geom = ellipsoid
      ? (ctx._inertiaEllipsoidGeometry || (ctx._inertiaEllipsoidGeometry = new THREE.SphereGeometry(1, 16, 12)))
      : (ctx._inertiaBoxGeometry || (ctx._inertiaBoxGeometry = new THREE.BoxGeometry(2, 2, 2)));
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: false,
      opacity: 1,
      depthWrite: false,
      toneMapped: false,
      fog: false,
    });
    const next = new THREE.Mesh(geom, mat);
    next.frustumCulled = false;
    next.renderOrder = 41;
    next.userData = next.userData || {};
    next.userData.ellipsoid = want;
    if (mesh) {
      group.remove(mesh);
    }
    group.add(next);
    pool[poolIndex] = next;
    mesh = next;
  }
  return mesh;
}

function updateInertiaOverlays(ctx, snapshot, state, assets, options = {}) {
  if (!ctx) return 0;
  const vopt = Array.isArray(options.voptFlags) ? options.voptFlags : (state?.rendering?.voptFlags || []);
  if (!voptEnabled(vopt, MJ_VIS.INERTIA) || options.hideAllGeometry) {
    hideInertiaGroup(ctx);
    return 0;
  }
  const bodies = assets?.bodies || null;
  const xipos = snapshot?.xipos || null;
  const ximat = snapshot?.ximat || null;
  if (!bodies || !xipos || !ximat) {
    hideInertiaGroup(ctx);
    return 0;
  }
  const massArr = bodies.mass || null;
  const inertiaArr = bodies.inertia || null;
  if (!massArr || !inertiaArr) {
    hideInertiaGroup(ctx);
    return 0;
  }
  const showStatic = voptEnabled(vopt, MJ_VIS.STATIC);
  const weldIdView = bodies.weldid || null;
  const mocapIdView = bodies.mocapid || null;
  const canStaticCheck = !!weldIdView && !!mocapIdView;
  const isBodyStatic = (bodyId) => {
    if (!canStaticCheck) return false;
    const bid = bodyId | 0;
    if (bid < 0 || bid >= weldIdView.length || bid >= mocapIdView.length) return false;
    return (weldIdView[bid] | 0) === 0 && (mocapIdView[bid] | 0) === -1;
  };
  const ellipsoid = ((state?.model?.vis?.global?.ellipsoidinertia | 0) === 1);
  const scaleInertia = ellipsoid ? Math.sqrt(5) : Math.sqrt(3);
  const scaledDensity = voptEnabled(vopt, MJ_VIS.SCLINERTIA);
  const visRgba = state?.model?.vis?.rgba || {};
  const overlayCfg = ctx?.fallback?.overlays || null;
  const inertiaFallback = overlayCfg && Number.isFinite(overlayCfg.inertia) ? overlayCfg.inertia : 0xff6666;
  const colorHex = rgbaToHex(visRgba.inertia, inertiaFallback);
  const opacity = alphaFromArray(visRgba.inertia, 0.35);
  const group = ensureInertiaGroup(ctx);
  const pool = Array.isArray(ctx.inertiaPool) ? ctx.inertiaPool : (ctx.inertiaPool = []);
  const nbody = bodies.count | 0;
  let used = 0;
  for (let i = 1; i < nbody; i += 1) {
    if (!showStatic && isBodyStatic(i)) continue;
    const mass = Number(massArr[i]) || 0;
    if (!(mass > 1e-12)) continue;
    const Ixx = Number(inertiaArr[3 * i + 0]) || 0;
    const Iyy = Number(inertiaArr[3 * i + 1]) || 0;
    const Izz = Number(inertiaArr[3 * i + 2]) || 0;
    let sx = Math.sqrt(Math.max(0, (Iyy + Izz - Ixx) / (2 * mass))) * scaleInertia;
    let sy = Math.sqrt(Math.max(0, (Ixx + Izz - Iyy) / (2 * mass))) * scaleInertia;
    let sz = Math.sqrt(Math.max(0, (Ixx + Iyy - Izz) / (2 * mass))) * scaleInertia;
    if (scaledDensity) {
      const volumeScale = ellipsoid ? (4.0 / 3.0) * Math.PI : 8.0;
      const volume = volumeScale * sx * sy * sz;
      const density = mass / Math.max(1e-12, volume);
      const scale = Math.pow(density * 0.001, 1 / 3);
      sx *= scale;
      sy *= scale;
      sz *= scale;
    }
    const posBase = 3 * i;
    const rotBase = 9 * i;
    if ((posBase + 2) >= xipos.length || (rotBase + 8) >= ximat.length) continue;
    const mesh = ensureInertiaMesh(ctx, used, ellipsoid);
    if (!mesh) continue;
    mesh.visible = true;
    mesh.position.set(
      Number(xipos[posBase + 0]) || 0,
      Number(xipos[posBase + 1]) || 0,
      Number(xipos[posBase + 2]) || 0,
    );
    TEMP_MAT4.set(
      ximat[rotBase + 0] ?? 1, ximat[rotBase + 1] ?? 0, ximat[rotBase + 2] ?? 0, 0,
      ximat[rotBase + 3] ?? 0, ximat[rotBase + 4] ?? 1, ximat[rotBase + 5] ?? 0, 0,
      ximat[rotBase + 6] ?? 0, ximat[rotBase + 7] ?? 0, ximat[rotBase + 8] ?? 1, 0,
      0, 0, 0, 1,
    );
    mesh.quaternion.setFromRotationMatrix(TEMP_MAT4);
    mesh.scale.set(Math.max(0, sx), Math.max(0, sy), Math.max(0, sz));
    const mat = mesh.material;
    if (mat) {
      mat.color.setHex(colorHex);
      mat.opacity = opacity;
      mat.transparent = opacity < 0.999;
      mat.needsUpdate = true;
    }
    used += 1;
  }
  for (let i = used; i < pool.length; i += 1) {
    if (pool[i]) pool[i].visible = false;
  }
  if (group) group.visible = used > 0;
  ctx.inertiaPool = pool;
  return used;
}

function ensureAutoConnectGroup(ctx) {
  if (!ctx) return null;
  if (!ctx.autoconnectGroup) {
    const group = new THREE.Group();
    group.name = 'overlay:autoconnect';
    if (ctx.root) ctx.root.add(group);
    ctx.autoconnectGroup = group;
    ctx.autoconnectPool = [];
    ctx._autoconnectUnitGeometry = new THREE.CylinderGeometry(1, 1, 1, 10, 1, false);
  }
  return ctx.autoconnectGroup;
}

function hideAutoConnectGroup(ctx) {
  if (!ctx) return;
  const group = ctx.autoconnectGroup || null;
  if (group) group.visible = false;
  if (Array.isArray(ctx.autoconnectPool)) {
    for (const mesh of ctx.autoconnectPool) {
      if (mesh) mesh.visible = false;
    }
  }
}

function ensureAutoConnectMesh(ctx, poolIndex) {
  const group = ensureAutoConnectGroup(ctx);
  if (!group) return null;
  const pool = Array.isArray(ctx.autoconnectPool) ? ctx.autoconnectPool : (ctx.autoconnectPool = []);
  let mesh = pool[poolIndex];
  if (!mesh) {
    const geom = ctx._autoconnectUnitGeometry || (ctx._autoconnectUnitGeometry = new THREE.CylinderGeometry(1, 1, 1, 10, 1, false));
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: false,
      opacity: 1,
      depthWrite: false,
      toneMapped: false,
      fog: false,
    });
    mesh = new THREE.Mesh(geom, mat);
    mesh.frustumCulled = false;
    mesh.renderOrder = 40;
    pool[poolIndex] = mesh;
    group.add(mesh);
  }
  return mesh;
}

function updateAutoConnectOverlays(ctx, snapshot, state, assets, options = {}) {
  if (!ctx) return 0;
  const vopt = Array.isArray(options.voptFlags) ? options.voptFlags : (state?.rendering?.voptFlags || []);
  if (!voptEnabled(vopt, MJ_VIS.AUTOCONNECT) || options.hideAllGeometry) {
    hideAutoConnectGroup(ctx);
    return 0;
  }
  const bodies = assets?.bodies || null;
  const xipos = snapshot?.xipos || null;
  const xanchor = snapshot?.xanchor || null;
  if (!bodies || !xipos || !xanchor) {
    hideAutoConnectGroup(ctx);
    return 0;
  }
  const parentid = bodies.parentid || null;
  const jntadr = bodies.jntadr || null;
  const jntnum = bodies.jntnum || null;
  if (!parentid || !jntadr || !jntnum) {
    hideAutoConnectGroup(ctx);
    return 0;
  }
  const visScale = state?.model?.vis?.scale || {};
  const visRgba = state?.model?.vis?.rgba || {};
  const { meanSize, scaleAll } = computeMeanScale(state, ctx);
  const radius = Math.max(1e-4, meanSize * 0.03 * Math.max(Number(visScale.connect) || 1, 1e-6) * scaleAll);
  const overlayCfg = ctx?.fallback?.overlays || null;
  const connectFallback = overlayCfg && Number.isFinite(overlayCfg.connect) ? overlayCfg.connect : 0x3344dd;
  const colorHex = rgbaToHex(visRgba.connect, connectFallback);
  const opacity = alphaFromArray(visRgba.connect, 1);
  const group = ensureAutoConnectGroup(ctx);
  const pool = Array.isArray(ctx.autoconnectPool) ? ctx.autoconnectPool : (ctx.autoconnectPool = []);
  const nbody = bodies.count | 0;
  let used = 0;
  for (let i = 1; i < nbody; i += 1) {
    const parent = parentid[i] | 0;
    if (parent === 0) continue;
    const posBase = 3 * i;
    if ((posBase + 2) >= xipos.length) continue;
    __TMP_VEC3_A.set(
      Number(xipos[posBase + 0]) || 0,
      Number(xipos[posBase + 1]) || 0,
      Number(xipos[posBase + 2]) || 0,
    );
    const adr = jntadr[i] | 0;
    const num = jntnum[i] | 0;
    if (num > 0) {
      for (let j = adr + num - 1; j >= adr; j -= 1) {
        const aBase = 3 * j;
        if ((aBase + 2) >= xanchor.length) continue;
        __TMP_VEC3_B.set(
          Number(xanchor[aBase + 0]) || 0,
          Number(xanchor[aBase + 1]) || 0,
          Number(xanchor[aBase + 2]) || 0,
        );
        const dir = __TMP_VEC3_C.copy(__TMP_VEC3_B).sub(__TMP_VEC3_A);
        const length = dir.length();
        if (!(length > 1e-9)) {
          __TMP_VEC3_A.copy(__TMP_VEC3_B);
          continue;
        }
        dir.normalize();
        const center = __TMP_VEC3_D.copy(__TMP_VEC3_A).add(__TMP_VEC3_B).multiplyScalar(0.5);
        const mesh = ensureAutoConnectMesh(ctx, used);
        if (!mesh) continue;
        mesh.visible = true;
        mesh.position.copy(center);
        LIGHT_TMP_QUAT.setFromUnitVectors(PERTURB_AXIS_DEFAULT, dir);
        mesh.quaternion.copy(LIGHT_TMP_QUAT);
        mesh.scale.set(radius, length, radius);
        const mat = mesh.material;
        if (mat) {
          mat.color.setHex(colorHex);
          mat.opacity = opacity;
          mat.transparent = opacity < 0.999;
          mat.needsUpdate = true;
        }
        used += 1;
        __TMP_VEC3_A.copy(__TMP_VEC3_B);
      }
    }
    const parentBase = 3 * parent;
    if ((parentBase + 2) >= xipos.length) continue;
    __TMP_VEC3_B.set(
      Number(xipos[parentBase + 0]) || 0,
      Number(xipos[parentBase + 1]) || 0,
      Number(xipos[parentBase + 2]) || 0,
    );
    const dir = __TMP_VEC3_C.copy(__TMP_VEC3_B).sub(__TMP_VEC3_A);
    const length = dir.length();
    if (!(length > 1e-9)) continue;
    dir.normalize();
    const center = __TMP_VEC3_D.copy(__TMP_VEC3_A).add(__TMP_VEC3_B).multiplyScalar(0.5);
    const mesh = ensureAutoConnectMesh(ctx, used);
    if (!mesh) continue;
    mesh.visible = true;
    mesh.position.copy(center);
    LIGHT_TMP_QUAT.setFromUnitVectors(PERTURB_AXIS_DEFAULT, dir);
    mesh.quaternion.copy(LIGHT_TMP_QUAT);
    mesh.scale.set(radius, length, radius);
    const mat = mesh.material;
    if (mat) {
      mat.color.setHex(colorHex);
      mat.opacity = opacity;
      mat.transparent = opacity < 0.999;
      mat.needsUpdate = true;
    }
    used += 1;
  }
  for (let i = used; i < pool.length; i += 1) {
    if (pool[i]) pool[i].visible = false;
  }
  if (group) group.visible = used > 0;
  ctx.autoconnectPool = pool;
  return used;
}

function ensureExternalPerturbGroup(ctx) {
  if (!ctx) return null;
  if (!ctx.externalPerturbGroup) {
    const group = new THREE.Group();
    group.name = 'overlay:external-perturb';
    if (ctx.root) ctx.root.add(group);
    ctx.externalPerturbGroup = group;
    ctx.externalPerturbPool = [];
  }
  return ctx.externalPerturbGroup;
}

function hideExternalPerturbGroup(ctx) {
  if (!ctx) return;
  const group = ctx.externalPerturbGroup || null;
  if (group) group.visible = false;
  if (Array.isArray(ctx.externalPerturbPool)) {
    for (const entry of ctx.externalPerturbPool) {
      if (entry?.node) entry.node.visible = false;
    }
  }
}

function updateExternalPerturbOverlays(ctx, snapshot, state, options = {}) {
  if (!ctx) return 0;
  const vopt = Array.isArray(options.voptFlags) ? options.voptFlags : (state?.rendering?.voptFlags || []);
  if (!voptEnabled(vopt, MJ_VIS.PERTFORCE)) {
    hideExternalPerturbGroup(ctx);
    return 0;
  }
  const xfrc = snapshot?.xfrc_applied || null;
  const xipos = snapshot?.xipos || null;
  if (!xfrc || !xipos) {
    hideExternalPerturbGroup(ctx);
    return 0;
  }
  const vis = state?.model?.vis || {};
  const stat = state?.model?.stat || {};
  const meanMass = Number(stat.meanmass) > 1e-12 ? Number(stat.meanmass) : 1;
  const mapForce = Number(vis.map?.force);
  const forceScale = (Number.isFinite(mapForce) ? mapForce : 0.005) / meanMass;
  const visRgba = vis.rgba || {};
  const overlayCfg = ctx?.fallback?.overlays || null;
  const forceFallback = overlayCfg && Number.isFinite(overlayCfg.force) ? overlayCfg.force : 0xff6666;
  const colorHex = rgbaToHex(visRgba.force, forceFallback);
  const opacity = alphaFromArray(visRgba.force, 1);
  const { meanSize, scaleAll } = computeMeanScale(state, ctx);
  const shaftRadius = Math.max(1e-5, meanSize * Math.max(Number(vis.scale?.forcewidth) || 0.1, 1e-6) * scaleAll);
  const minLength = Math.max(shaftRadius * 2.0, meanSize * 0.01);
  const maxLength = Math.max(meanSize * 5, (ctx.bounds?.radius || meanSize) * 8);

  const group = ensureExternalPerturbGroup(ctx);
  const pool = Array.isArray(ctx.externalPerturbPool) ? ctx.externalPerturbPool : (ctx.externalPerturbPool = []);
  if (!ctx.externalPerturbMaterial) {
    ctx.externalPerturbMaterial = new THREE.MeshBasicMaterial({
      color: colorHex,
      transparent: opacity < 0.999,
      opacity,
      depthWrite: true,
      toneMapped: false,
      fog: false,
    });
  } else {
    ctx.externalPerturbMaterial.color.setHex(colorHex);
    ctx.externalPerturbMaterial.opacity = opacity;
    ctx.externalPerturbMaterial.transparent = opacity < 0.999;
    ctx.externalPerturbMaterial.depthWrite = true;
  }
  const material = ctx.externalPerturbMaterial;
  const nbody = Math.min(Math.floor(xipos.length / 3), Math.floor(xfrc.length / 6));
  let used = 0;
  for (let i = 1; i < nbody; i += 1) {
    const forceBase = 6 * i;
    if ((forceBase + 2) >= xfrc.length) continue;
    const fx = Number(xfrc[forceBase + 0]) || 0;
    const fy = Number(xfrc[forceBase + 1]) || 0;
    const fz = Number(xfrc[forceBase + 2]) || 0;
    const mag = Math.hypot(fx, fy, fz);
    if (!(mag > 1e-12)) continue;
    const posBase = 3 * i;
    if ((posBase + 2) >= xipos.length) continue;
    const fromX = Number(xipos[posBase + 0]) || 0;
    const fromY = Number(xipos[posBase + 1]) || 0;
    const fromZ = Number(xipos[posBase + 2]) || 0;
    const vecX = fx * forceScale * scaleAll;
    const vecY = fy * forceScale * scaleAll;
    const vecZ = fz * forceScale * scaleAll;
    const dirLen = Math.hypot(vecX, vecY, vecZ);
    if (!(dirLen > 1e-12)) continue;
    const dx = vecX / dirLen;
    const dy = vecY / dirLen;
    const dz = vecZ / dirLen;
    const length = Math.min(maxLength, Math.max(minLength, dirLen));
    let headLength = Math.max(length * 0.3, shaftRadius * 3);
    headLength = Math.min(headLength, length * 0.6);
    const headRadius = Math.max(shaftRadius * 1.6, headLength * 0.4);
    let rawShaft = Math.max(length - headLength, shaftRadius * 1.5);
    const totalRaw = rawShaft + headLength;
    const scaleFactor = totalRaw > 1e-12 ? (length / totalRaw) : 1;
    rawShaft *= scaleFactor;
    const finalHeadLength = headLength * scaleFactor;

    if (used >= pool.length) {
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
    const arrow = pool[used];
    arrow.node.visible = true;
    arrow.node.position.set(fromX, fromY, fromZ);
    CONTACT_FORCE_DIR.set(dx, dy, dz);
    CONTACT_FORCE_TMP_QUAT.setFromUnitVectors(CONTACT_FORCE_AXIS, CONTACT_FORCE_DIR);
    arrow.node.quaternion.copy(CONTACT_FORCE_TMP_QUAT);
    arrow.shaft.scale.set(shaftRadius, rawShaft, shaftRadius);
    arrow.shaft.position.set(0, rawShaft / 2, 0);
    arrow.head.scale.set(headRadius, finalHeadLength, headRadius);
    arrow.head.position.set(0, rawShaft + finalHeadLength / 2, 0);
    used += 1;
  }
  for (let i = used; i < pool.length; i += 1) {
    const arrow = pool[i];
    if (arrow?.node) arrow.node.visible = false;
  }
  if (group) group.visible = used > 0;
  ctx.externalPerturbPool = pool;
  return used;
}

function ensureTactileGroup(ctx) {
  if (!ctx) return null;
  if (!ctx.tactileGroup) {
    const group = new THREE.Group();
    group.name = 'overlay:tactile';
    if (ctx.root) ctx.root.add(group);
    ctx.tactileGroup = group;
    ctx.tactilePool = new Map();
  }
  return ctx.tactileGroup;
}

function hideTactileGroup(ctx) {
  if (!ctx) return;
  const group = ctx.tactileGroup || null;
  if (group) group.visible = false;
  const pool = ctx.tactilePool instanceof Map ? ctx.tactilePool : null;
  if (!pool) return;
  for (const entry of pool.values()) {
    if (entry?.mesh) entry.mesh.visible = false;
  }
}

function ensureTactileEntry(ctx, sensorId) {
  const group = ensureTactileGroup(ctx);
  if (!group) return null;
  if (!(ctx.tactilePool instanceof Map)) ctx.tactilePool = new Map();
  const key = sensorId | 0;
  let entry = ctx.tactilePool.get(key);
  if (!entry) {
    const geom = new THREE.BufferGeometry();
    const mat = new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
      fog: false,
    });
    const mesh = new THREE.Mesh(geom, mat);
    mesh.frustumCulled = false;
    mesh.renderOrder = 39;
    mesh.userData = mesh.userData || {};
    mesh.userData.sensorId = key;
    group.add(mesh);
    entry = { mesh, geom };
    ctx.tactilePool.set(key, entry);
  }
  return entry;
}

function updateTactileOverlays(ctx, snapshot, state, assets, options = {}) {
  if (!ctx) return 0;
  const vopt = Array.isArray(options.voptFlags) ? options.voptFlags : (state?.rendering?.voptFlags || []);
  if (!voptEnabled(vopt, MJ_VIS.CONTACTPOINT)) {
    hideTactileGroup(ctx);
    return 0;
  }
  const sensordata = snapshot?.sensordata || null;
  const xpos = snapshot?.xpos || null;
  const xmat = snapshot?.xmat || null;
  const sensors = assets?.sensors || null;
  const meshes = assets?.meshes || null;
  if (!sensordata || !xpos || !xmat || !sensors || !meshes) {
    hideTactileGroup(ctx);
    return 0;
  }
  const typeArr = sensors.type || null;
  const objArr = sensors.objid || null;
  const refArr = sensors.refid || null;
  const dimArr = sensors.dim || null;
  const adrArr = sensors.adr || null;
  if (!typeArr || !objArr || !refArr || !dimArr || !adrArr) {
    hideTactileGroup(ctx);
    return 0;
  }
  if (!meshes.vertnum || !meshes.vertadr || !meshes.facenum || !meshes.faceadr || !meshes.vert || !meshes.face) {
    hideTactileGroup(ctx);
    return 0;
  }
  ensureTactileGroup(ctx);
  const used = new Set();
  const nsensor = sensors.count | 0;
  for (let sid = 0; sid < nsensor; sid += 1) {
    if ((typeArr[sid] | 0) !== MJ_SENSOR.TACTILE) continue;
    const meshId = objArr[sid] | 0;
    const geomId = refArr[sid] | 0;
    const adr = adrArr[sid] | 0;
    if (meshId < 0 || geomId < 0 || adr < 0) continue;
    if (meshId >= meshes.vertnum.length || meshId >= meshes.vertadr.length) continue;
    if (meshId >= meshes.facenum.length || meshId >= meshes.faceadr.length) continue;
    const vertnum = meshes.vertnum[meshId] | 0;
    const vertadr = meshes.vertadr[meshId] | 0;
    const facenum = meshes.facenum[meshId] | 0;
    const faceadr = meshes.faceadr[meshId] | 0;
    if (!(vertnum > 0) || !(facenum > 0)) continue;
    const dim = dimArr[sid] | 0;
    const nchannel = Math.floor(dim / vertnum);
    if (!(nchannel > 0)) continue;
    if (adr + vertnum > sensordata.length) continue;
    let maxval = 0;
    for (let j = 0; j < vertnum; j += 1) {
      const v = Math.abs(Number(sensordata[adr + j]) || 0);
      if (v > maxval) maxval = v;
    }
    if (!(maxval > 0)) continue;
    const entry = ensureTactileEntry(ctx, sid);
    if (!entry || !entry.mesh || !entry.geom) continue;
    used.add(sid);

    const posBase = 3 * geomId;
    const rotBase = 9 * geomId;
    if ((posBase + 2) >= xpos.length || (rotBase + 8) >= xmat.length) continue;
    entry.mesh.visible = true;
    entry.mesh.position.set(
      Number(xpos[posBase + 0]) || 0,
      Number(xpos[posBase + 1]) || 0,
      Number(xpos[posBase + 2]) || 0,
    );
    TEMP_MAT4.set(
      xmat[rotBase + 0] ?? 1, xmat[rotBase + 1] ?? 0, xmat[rotBase + 2] ?? 0, 0,
      xmat[rotBase + 3] ?? 0, xmat[rotBase + 4] ?? 1, xmat[rotBase + 5] ?? 0, 0,
      xmat[rotBase + 6] ?? 0, xmat[rotBase + 7] ?? 0, xmat[rotBase + 8] ?? 1, 0,
      0, 0, 0, 1,
    );
    entry.mesh.quaternion.setFromRotationMatrix(TEMP_MAT4);

    const faceStart = 3 * faceadr;
    const faceEnd = faceStart + 3 * facenum;
    const vertStart = 3 * vertadr;
    const vertEnd = vertStart + 3 * vertnum;
    if (faceStart < 0 || faceEnd > meshes.face.length) continue;
    if (vertStart < 0 || vertEnd > meshes.vert.length) continue;
    const positions = new Float32Array(facenum * 9);
    const colors = new Float32Array(facenum * 9);
    const channelLimit = Math.min(nchannel, 3);
    for (let f = 0; f < facenum; f += 1) {
      const fi = faceStart + 3 * f;
      const a = meshes.face[fi + 0] | 0;
      const b = meshes.face[fi + 1] | 0;
      const c = meshes.face[fi + 2] | 0;
      if (a < 0 || a >= vertnum || b < 0 || b >= vertnum || c < 0 || c >= vertnum) continue;
      const outBase = 9 * f;
      positions[outBase + 0] = meshes.vert[vertStart + 3 * a + 0] || 0;
      positions[outBase + 1] = meshes.vert[vertStart + 3 * a + 1] || 0;
      positions[outBase + 2] = meshes.vert[vertStart + 3 * a + 2] || 0;
      positions[outBase + 3] = meshes.vert[vertStart + 3 * b + 0] || 0;
      positions[outBase + 4] = meshes.vert[vertStart + 3 * b + 1] || 0;
      positions[outBase + 5] = meshes.vert[vertStart + 3 * b + 2] || 0;
      positions[outBase + 6] = meshes.vert[vertStart + 3 * c + 0] || 0;
      positions[outBase + 7] = meshes.vert[vertStart + 3 * c + 1] || 0;
      positions[outBase + 8] = meshes.vert[vertStart + 3 * c + 2] || 0;
      let r0 = 0;
      let r1 = 0;
      let r2 = 0;
      for (let r = 0; r < channelLimit; r += 1) {
        const chBase = adr + r * vertnum;
        const va = Math.abs(Number(sensordata[chBase + a]) || 0);
        const vb = Math.abs(Number(sensordata[chBase + b]) || 0);
        const vc = Math.abs(Number(sensordata[chBase + c]) || 0);
        const value = (va + vb + vc) / (3 * maxval);
        if (r === 0) r0 = value;
        else if (r === 1) r1 = value;
        else if (r === 2) r2 = value;
      }
      for (let k = 0; k < 3; k += 1) {
        colors[outBase + 3 * k + 0] = Math.max(0, Math.min(1, r0));
        colors[outBase + 3 * k + 1] = Math.max(0, Math.min(1, r1));
        colors[outBase + 3 * k + 2] = Math.max(0, Math.min(1, r2));
      }
    }
    entry.geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    entry.geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    entry.geom.computeVertexNormals();
    entry.geom.computeBoundingSphere();
  }
  if (ctx.tactilePool instanceof Map) {
    for (const [sid, entry] of ctx.tactilePool.entries()) {
      if (!used.has(sid) && entry?.mesh) entry.mesh.visible = false;
    }
  }
  if (ctx.tactileGroup) ctx.tactileGroup.visible = used.size > 0;
  return used.size;
}

function buildConstraintOverlayDescriptors(snapshot, state, ctx) {
  const eqType = snapshot?.eq_type;
  const eqObj1 = snapshot?.eq_obj1id;
  const eqObj2 = snapshot?.eq_obj2id;
  const eqObjType = snapshot?.eq_objtype;
  const eqActive = snapshot?.eq_active;
  const bxpos = snapshot?.bxpos;
  const siteXpos = snapshot?.site_xpos;
  if (!eqType || !eqObj1 || !eqObj2 || !eqObjType) {
    return [];
  }
  const visScale = state?.model?.vis?.scale || {};
  const visRgba = state?.model?.vis?.rgba || {};
  const { meanSize, scaleAll } = computeMeanScale(state, ctx);
  const radiusConst = Math.max(1e-4, meanSize * 0.03 * Math.max(Number(visScale.constraint) || 1, 1e-6) * scaleAll);
  const radiusConnect = Math.max(1e-4, meanSize * 0.03 * Math.max(Number(visScale.connect) || 1, 1e-6) * scaleAll);
  const overlayCfg = ctx?.fallback?.overlays || null;
  const connectFallback =
    overlayCfg && Number.isFinite(overlayCfg.connect)
      ? overlayCfg.connect
      : 0x3344dd;
  const constraintFallback =
    overlayCfg && Number.isFinite(overlayCfg.constraint)
      ? overlayCfg.constraint
      : 0xdd3333;
  const colorConnect = rgbaToHex(visRgba.connect, connectFallback);
  const colorConstraint = rgbaToHex(visRgba.constraint, constraintFallback);
  const opacityConnect = alphaFromArray(visRgba.connect, 1);
  const opacityConstraint = alphaFromArray(visRgba.constraint, 1);
  const neq = Math.min(eqType.length, eqObj1.length, eqObj2.length, eqObjType.length);
  const descriptors = [];
  let descriptorIndex = 0;
  const nsite = siteXpos ? Math.floor(siteXpos.length / 3) : 0;
  const nbody = bxpos ? Math.floor(bxpos.length / 3) : 0;
  const getPose = (objType, objId) => {
    if (objType === MJ_OBJ.SITE && objId >= 0 && objId < nsite && siteXpos) {
      const base = 3 * objId;
      const pos = PERTURB_TEMP_ANCHOR.set(
        Number(siteXpos[base + 0]) || 0,
        Number(siteXpos[base + 1]) || 0,
        Number(siteXpos[base + 2]) || 0,
      );
      return { pos: pos.clone() };
    }
    if (objType === MJ_OBJ.BODY && objId >= 0 && objId < nbody && bxpos) {
      const base = 3 * objId;
      const pos = PERTURB_TEMP_ANCHOR.set(
        Number(bxpos[base + 0]) || 0,
        Number(bxpos[base + 1]) || 0,
        Number(bxpos[base + 2]) || 0,
      );
      return { pos: pos.clone() };
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
    descriptors.push({
      kind: 'overlay',
      subtype: OVERLAY_SUBTYPE.CONSTRAINT,
      index: descriptorIndex,
      position: pose1.pos.toArray(),
      radius: radiusConnect,
      colorHex: colorConnect,
      opacity: opacityConnect,
    });
    descriptorIndex += 1;
    descriptors.push({
      kind: 'overlay',
      subtype: OVERLAY_SUBTYPE.CONSTRAINT,
      index: descriptorIndex,
      position: pose2.pos.toArray(),
      radius: radiusConst,
      colorHex: colorConstraint,
      opacity: opacityConstraint,
    });
    descriptorIndex += 1;
  }
  return descriptors;
}

function applyConstraintOverlayDescriptors(ctx, descriptors) {
  if (!ctx) return;
  const group = ensureConstraintGroup(ctx);
  if (!Array.isArray(descriptors) || descriptors.length === 0) {
    hideConstraintGroup(ctx);
    return;
  }
  const pool = ctx.constraintPool || (ctx.constraintPool = []);
  let used = 0;
  for (const desc of descriptors) {
    if (!desc || desc.subtype !== OVERLAY_SUBTYPE.CONSTRAINT) continue;
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
      mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), mat);
      mesh.renderOrder = 48;
      pool[used] = mesh;
      group.add(mesh);
    }
    mesh.visible = true;
    mesh.position.set(
      Number(desc.position?.[0]) || 0,
      Number(desc.position?.[1]) || 0,
      Number(desc.position?.[2]) || 0,
    );
    const radius = Math.max(1e-4, Number(desc.radius) || 0.1);
    mesh.scale.set(radius, radius, radius);
    if (mesh.material) {
      mesh.material.color.setHex(desc.colorHex);
      mesh.material.opacity = desc.opacity;
      mesh.material.transparent = desc.opacity < 0.999;
      mesh.material.needsUpdate = true;
    }
    used += 1;
  }
  for (let i = used; i < pool.length; i += 1) {
    if (pool[i]) pool[i].visible = false;
  }
  group.visible = used > 0;
}

function buildContactPointOverlayDescriptors(snapshot, state, ctx, options = {}) {
  const contacts = snapshot?.contacts || null;
  if (!contacts || typeof contacts.n !== 'number' || !contacts.pos) {
    if (contacts && typeof contacts.n === 'number' && !contacts.pos) {
      try { warnLog('[render] contact points enabled but no position array in snapshot; n=', contacts.n); } catch {}
    }
    return { descriptors: [], radius: 0, thickness: 0, offsetScale: 0, colorHex: 0, opacity: 0 };
  }
  const contactCount = Math.max(0, contacts.n | 0);
  if (contactCount <= 0) return { descriptors: [], radius: 0, thickness: 0, offsetScale: 0, colorHex: 0, opacity: 0 };
  const visStruct = state?.model?.vis || {};
  const { meanSize, scaleAll } = computeMeanScale(state, ctx);
  const base = Math.max(1e-6, meanSize * scaleAll);
  const widthScale = Number(visStruct?.scale?.contactwidth);
  const heightScale = Number(visStruct?.scale?.contactheight);
  const radius = Number.isFinite(widthScale) && widthScale > 0
    ? Math.max(0.0015, widthScale * base)
    : Math.max(0.002, Math.min(base * 0.02, base * 0.1));
  const thickness = Number.isFinite(heightScale) && heightScale > 0
    ? Math.max(0.0015, heightScale * base)
    : Math.max(0.001, radius * 0.65);
  const offsetScale = Math.max(thickness * 0.5, 0.003);
  const overlayCfg = ctx?.fallback?.overlays || null;
  const contactFallback =
    overlayCfg && Number.isFinite(overlayCfg.contactPoint)
      ? overlayCfg.contactPoint
      : CONTACT_POINT_FALLBACK_COLOR;
  const segmentEnabled = options.segmentEnabled === true;
  const contactColorHex = segmentEnabled
    ? segmentColorForIndex(contacts?.n ? contacts.n + 1 : 0)
    : rgbaToHex(visStruct?.rgba?.contact, contactFallback);
  const contactOpacity = segmentEnabled ? 1 : alphaFromArray(visStruct?.rgba?.contact, 0.85);
  const frame = ArrayBuffer.isView(contacts.frame) ? contacts.frame : null;
  const pos = contacts.pos;
  const descriptors = [];
  for (let i = 0; i < contactCount; i += 1) {
    const baseIdx = 3 * i;
    const x = Number(pos[baseIdx + 0]) || 0;
    const y = Number(pos[baseIdx + 1]) || 0;
    const z = Number(pos[baseIdx + 2]) || 0;
    let nx = 0;
    let ny = 0;
    let nz = 1;
    if (frame && frame.length >= 9 * (i + 1)) {
      const rotBase = 9 * i;
      nx = Number(frame[rotBase + 0]) || 0;
      ny = Number(frame[rotBase + 1]) || 0;
      nz = Number(frame[rotBase + 2]) || 1;
      const inv = 1 / (Math.hypot(nx, ny, nz) || 1);
      nx *= inv;
      ny *= inv;
      nz *= inv;
    }
    descriptors.push({
      kind: 'overlay',
      subtype: OVERLAY_SUBTYPE.CONTACT_POINT,
      index: i,
      position: [x, y, z],
      normal: [nx, ny, nz],
      radius,
      thickness,
      colorHex: contactColorHex,
      opacity: contactOpacity,
    });
  }
  return {
    descriptors,
    radius,
    thickness,
    offsetScale,
    colorHex: contactColorHex,
    opacity: contactOpacity,
  };
}

function applyContactPointOverlayDescriptors(ctx, payload) {
  if (!ctx || !payload) return;
  const descriptors = Array.isArray(payload.descriptors) ? payload.descriptors : [];
  const radius = Number(payload.radius) || 0;
  const thickness = Number(payload.thickness) || 0;
  const offsetScale = Number(payload.offsetScale) || 0;
  const colorHex = Number(payload.colorHex) || 0;
  const opacity = Number(payload.opacity);
  if (descriptors.length === 0) {
    if (ctx.contactGroup) ctx.contactGroup.visible = false;
    return;
  }
  const group = ensureContactGroup(ctx);
  const pool = Array.isArray(ctx.contactPool) ? ctx.contactPool : (ctx.contactPool = []);
  const currentGeom = group.userData.geometry;
  if (
    radius > 0 &&
    thickness > 0 &&
    (
      !currentGeom
      || currentGeom.parameters?.radiusTop !== radius
      || currentGeom.parameters?.height !== thickness
    )
  ) {
    try { currentGeom?.dispose?.(); } catch {}
    const cyl = new THREE.CylinderGeometry(radius * 0.85, radius * 0.85, thickness, 24, 1);
    cyl.rotateX(Math.PI / 2);
    group.userData.geometry = cyl;
    for (const mesh of pool) {
      if (mesh) mesh.geometry = cyl;
    }
  }
  if (!group.userData.material) {
    group.userData.material = new THREE.MeshBasicMaterial({
      color: colorHex,
      side: THREE.DoubleSide,
      transparent: opacity < 0.999,
      opacity,
      depthTest: true,
      depthWrite: true,
      toneMapped: false,
      fog: false,
    });
  } else {
    group.userData.material.color.setHex(colorHex);
    group.userData.material.opacity = opacity;
    group.userData.material.transparent = opacity < 0.999;
    group.userData.material.depthWrite = true;
  }
  const material = group.userData.material;
  const geometry = group.userData.geometry;
  for (let i = pool.length; i < descriptors.length; i += 1) {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.matrixAutoUpdate = true;
    mesh.frustumCulled = false;
    pool.push(mesh);
    group.add(mesh);
  }
  for (let idx = 0; idx < pool.length; idx += 1) {
    const mesh = pool[idx];
    if (!mesh) continue;
    if (idx < descriptors.length) {
      const desc = descriptors[idx];
      mesh.visible = true;
      const nx = Number(desc.normal?.[0]) || 0;
      const ny = Number(desc.normal?.[1]) || 0;
      const nz = Number(desc.normal?.[2]) || 1;
      const normal = CONTACT_TMP_NORMAL.set(nx, ny, nz);
      if (normal.lengthSq() <= 0) normal.set(0, 0, 1);
      normal.normalize();
      mesh.quaternion.setFromUnitVectors(CONTACT_UP, normal);
      const pos = desc.position;
      const offset = offsetScale || 0;
      mesh.position.set(
        (pos?.[0] || 0) + normal.x * offset,
        (pos?.[1] || 0) + normal.y * offset,
        (pos?.[2] || 0) + normal.z * offset,
      );
    } else {
      mesh.visible = false;
    }
  }
  ctx.contactPool = pool;
  group.visible = descriptors.length > 0;
}

function buildContactForceOverlayDescriptors(snapshot, state, ctx, options = {}) {
  const contacts = snapshot?.contacts || null;
  if (!contacts || typeof contacts.n !== 'number' || contacts.n <= 0) {
    return { descriptors: [], colorHex: 0, opacity: 0 };
  }
  const visStruct = state?.model?.vis || {};
  const statStruct = state?.model?.stat || null;
  const meanMass = (() => {
    const value = Number(statStruct?.meanmass);
    if (Number.isFinite(value) && value > 1e-9) return value;
    return 1;
  })();
  const { meanSize, scaleAll } = computeMeanScale(state, ctx);
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
  const maxLength = Math.max(meanSize * 6, (ctx.bounds?.radius || meanSize) * 8);
  const lengthScale = (mapForce / meanMass) * scaleAll;
  const overlayCfg = ctx?.fallback?.overlays || null;
  const forceFallback =
    overlayCfg && Number.isFinite(overlayCfg.contactForce)
      ? overlayCfg.contactForce
      : CONTACT_FORCE_FALLBACK_COLOR;
  const colorHex = (options.segmentEnabled ? segmentColorForIndex((contacts.n || 0) + 2) : rgbaToHex(visStruct?.rgba?.contactforce, forceFallback));
  const opacity = options.segmentEnabled ? 1 : alphaFromArray(visStruct?.rgba?.contactforce, 0.8);
  const frame = ArrayBuffer.isView(contacts.frame) ? contacts.frame : null;
  const forceValues = ArrayBuffer.isView(contacts.force) ? contacts.force : null;
  const positionValues = ArrayBuffer.isView(contacts.pos) ? contacts.pos : null;
  const descriptors = [];
  const count = Math.max(0, contacts.n | 0);
  for (let i = 0; i < count; i += 1) {
    if (!positionValues) break;
    const base = 3 * i;
    const x = Number(positionValues[base + 0]) || 0;
    const y = Number(positionValues[base + 1]) || 0;
    const z = Number(positionValues[base + 2]) || 0;
    let magnitude = 0;
    let dx = 0;
    let dy = 0;
    let dz = 0;
    if (forceValues && forceValues.length >= base + 3) {
      const fx = Number(forceValues[base + 0]) || 0;
      const fy = Number(forceValues[base + 1]) || 0;
      const fz = Number(forceValues[base + 2]) || 0;
      dx = fx;
      dy = fy;
      dz = fz;
      magnitude = Math.hypot(fx, fy, fz);
    }
    let directionReady = false;
    if (magnitude > CONTACT_FORCE_EPS) {
      const inv = 1 / magnitude;
      dx *= inv;
      dy *= inv;
      dz *= inv;
      directionReady = true;
    }
    if (!directionReady) {
      if (frame && frame.length >= 9 * (i + 1)) {
        const rotBase = 9 * i;
        dx = Number(frame[rotBase + 0]) || 0;
        dy = Number(frame[rotBase + 1]) || 0;
        dz = Number(frame[rotBase + 2]) || 0;
        const len = Math.hypot(dx, dy, dz);
        if (len <= CONTACT_FORCE_EPS) {
          dx = CONTACT_UP.x;
          dy = CONTACT_UP.y;
          dz = CONTACT_UP.z;
        } else {
          const inv = 1 / len;
          dx *= inv;
          dy *= inv;
          dz *= inv;
        }
      } else {
        dx = CONTACT_UP.x;
        dy = CONTACT_UP.y;
        dz = CONTACT_UP.z;
      }
    }
    const scaledLength = magnitude > CONTACT_FORCE_EPS ? magnitude * lengthScale : fallbackLength;
    const length = Math.min(maxLength, Math.max(minLength, scaledLength));
    let headLength = Math.max(length * 0.3, shaftRadius * 3);
    headLength = Math.min(headLength, length * 0.6);
    const headRadius = Math.max(shaftRadius * 1.6, headLength * 0.4);
    let rawShaft = Math.max(length - headLength, shaftRadius * 1.5);
    const totalRaw = rawShaft + headLength;
    const scaleFactor = totalRaw > CONTACT_FORCE_EPS ? (length / totalRaw) : 1;
    rawShaft *= scaleFactor;
    const finalHeadLength = headLength * scaleFactor;
    descriptors.push({
      kind: 'overlay',
      subtype: OVERLAY_SUBTYPE.CONTACT_FORCE,
      index: i,
      position: [x, y, z],
      direction: [dx, dy, dz],
      shaftLength: rawShaft,
      headLength: finalHeadLength,
      shaftRadius,
      headRadius,
      colorHex,
      opacity,
    });
  }
  return { descriptors, colorHex, opacity };
}

function applyContactForceOverlayDescriptors(ctx, payload) {
  if (!ctx || !payload) return;
  const descriptors = Array.isArray(payload.descriptors) ? payload.descriptors : [];
  const colorHex = Number(payload.colorHex) || 0;
  const opacity = Number(payload.opacity);
  if (!descriptors.length) {
    if (ctx.contactForceGroup) ctx.contactForceGroup.visible = false;
    return;
  }
  const group = ensureContactForceGroup(ctx);
  const pool = Array.isArray(ctx.contactForcePool) ? ctx.contactForcePool : (ctx.contactForcePool = []);
  if (!ctx.contactForceMaterial) {
    ctx.contactForceMaterial = new THREE.MeshBasicMaterial({
      color: colorHex,
      transparent: opacity < 0.999,
      opacity,
      depthWrite: true,
      toneMapped: false,
      fog: false,
    });
  } else {
    ctx.contactForceMaterial.color.setHex(colorHex);
    ctx.contactForceMaterial.opacity = opacity;
    ctx.contactForceMaterial.transparent = opacity < 0.999;
    ctx.contactForceMaterial.depthWrite = true;
  }
  const material = ctx.contactForceMaterial;
  for (let i = pool.length; i < descriptors.length; i += 1) {
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
  for (let idx = 0; idx < pool.length; idx += 1) {
    const arrow = pool[idx];
    if (!arrow || !arrow.node) continue;
    if (idx < descriptors.length) {
      const desc = descriptors[idx];
      arrow.node.visible = true;
      const pos = desc.position || [0, 0, 0];
      arrow.node.position.set(
        Number(pos[0]) || 0,
        Number(pos[1]) || 0,
        Number(pos[2]) || 0,
      );
      const dir = desc.direction || [0, 1, 0];
      CONTACT_FORCE_DIR.set(dir[0] || 0, dir[1] || 0, dir[2] || 1);
      if (CONTACT_FORCE_DIR.lengthSq() <= 0) {
        CONTACT_FORCE_DIR.copy(CONTACT_FORCE_AXIS);
      } else {
        CONTACT_FORCE_DIR.normalize();
      }
      CONTACT_FORCE_TMP_QUAT.setFromUnitVectors(CONTACT_FORCE_AXIS, CONTACT_FORCE_DIR);
      arrow.node.quaternion.copy(CONTACT_FORCE_TMP_QUAT);
      const shaft = arrow.shaft;
      const head = arrow.head;
      if (shaft) {
        shaft.scale.set(desc.shaftRadius, desc.shaftLength, desc.shaftRadius);
        shaft.position.set(0, desc.shaftLength / 2, 0);
      }
      if (head) {
        head.scale.set(desc.headRadius, desc.headLength, desc.headRadius);
        head.position.set(0, desc.shaftLength + desc.headLength / 2, 0);
      }
    } else {
      arrow.node.visible = false;
    }
  }
  ctx.contactForcePool = pool;
  group.visible = descriptors.length > 0;
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
  const overlayCfg = ctx.fallback?.overlays || null;
  const selectFallback =
    overlayCfg && Number.isFinite(overlayCfg.selectPoint)
      ? overlayCfg.selectPoint
      : SELECT_POINT_FALLBACK_COLOR;
  const colorHex = rgbaToHex(rgbaStruct.selectpoint, selectFallback);
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
