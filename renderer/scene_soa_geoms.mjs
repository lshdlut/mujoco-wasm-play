// Scene-SoA geometry + instancing helpers extracted from pipeline.
// Keep behaviour identical; do not swallow errors.

import * as THREE from 'three';
import { compatFallback } from '../core/fallbacks.mjs';
import { logDebug, strictCatch, strictEnsure } from '../core/viewer_runtime.mjs';
import { computeGeometryBounds, disposeMeshObject, disposeObject3DTree } from './three_helpers.mjs';
import { onBeforeShadowMuJoCo } from './mujoco_shadows.mjs';
import { MJ_GEOM, MJ_OBJ } from './mujoco_constants.mjs';

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

const GROUND_DISTANCE = 2000;
const PLANE_SIZE_EPS = 1e-9;
const RENDER_ORDER = Object.freeze({
  GROUND: -50,
});
const TRANSPARENT_BIN_CAM_POS = new THREE.Vector3();
const TRANSPARENT_BIN_CAM_DIR = new THREE.Vector3();

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

function createHfieldGeometryFromAssets(assets, dataId) {
  if (!assets || !assets.hfields) return null;
  const hid = dataId | 0;
  if (!(hid >= 0)) return null;
  const hfields = assets.hfields;
  const countGuess = Number.isFinite(hfields.count)
    ? (hfields.count | 0)
    : (hfields.nrow ? (hfields.nrow.length | 0) : 0);
  if (!(countGuess > 0) || hid >= countGuess) return null;

  const size = hfields.size || null;
  const nrow = hfields.nrow || null;
  const ncol = hfields.ncol || null;
  const adr = hfields.adr || null;
  const data = hfields.data || null;
  if (!size || !nrow || !ncol || !adr || !data) return null;

  const nr = nrow[hid] | 0;
  const nc = ncol[hid] | 0;
  const start = adr[hid] | 0;
  if (!(nr > 1) || !(nc > 1) || start < 0) return null;

  const total = nr * nc;
  const end = start + total;
  if (end > data.length) return null;

  const base = 4 * hid;
  if (base + 3 >= size.length) return null;
  const sx = Number(size[base + 0]) || 0;
  const sy = Number(size[base + 1]) || 0;
  const szTop = Number(size[base + 2]) || 0;
  const szBottom = Number(size[base + 3]) || 0;

  const EPS = 1e-9;
  const halfX = Math.max(Math.abs(sx), EPS);
  const halfY = Math.max(Math.abs(sy), EPS);
  const zScale = Number.isFinite(szTop) ? szTop : 0;
  const bottomDepth = Number.isFinite(szBottom) ? Math.max(0, szBottom) : 0;
  const includeSides = bottomDepth > EPS;
  const includeBottom = bottomDepth > EPS;

  const topVertexCount = total;
  const topIndexCount = (nr - 1) * (nc - 1) * 6;
  const sideQuadCount = includeSides ? (2 * (nr - 1) + 2 * (nc - 1)) : 0;
  const sideVertexCount = sideQuadCount * 4;
  const sideIndexCount = sideQuadCount * 6;
  const bottomVertexCount = includeBottom ? 4 : 0;
  const bottomIndexCount = includeBottom ? 6 : 0;

  const vertexCount = topVertexCount + sideVertexCount + bottomVertexCount;
  const indexCount = topIndexCount + sideIndexCount + bottomIndexCount;
  const IndexArray = vertexCount > 65535 ? Uint32Array : Uint16Array;

  const positions = new Float32Array(vertexCount * 3);
  const indices = new IndexArray(indexCount);

  const invNr1 = 1 / Math.max(1, nr - 1);
  const invNc1 = 1 / Math.max(1, nc - 1);
  for (let r = 0; r < nr; r += 1) {
    const y = halfY * (2 * (r * invNr1) - 1);
    const rowBase = start + r * nc;
    const vRowBase = r * nc;
    for (let c = 0; c < nc; c += 1) {
      const x = halfX * (2 * (c * invNc1) - 1);
      const raw = data[rowBase + c];
      const h = Number.isFinite(raw) ? Number(raw) : 0;
      const z = h * zScale;
      const v = vRowBase + c;
      const p = 3 * v;
      positions[p + 0] = x;
      positions[p + 1] = y;
      positions[p + 2] = z;
    }
  }

  let k = 0;
  for (let r = 0; r < nr - 1; r += 1) {
    const base0 = r * nc;
    const base1 = (r + 1) * nc;
    for (let c = 0; c < nc - 1; c += 1) {
      const i0 = base0 + c;
      const i1 = i0 + 1;
      const i2 = base1 + c;
      const i3 = i2 + 1;
      indices[k++] = i0;
      indices[k++] = i1;
      indices[k++] = i2;
      indices[k++] = i1;
      indices[k++] = i3;
      indices[k++] = i2;
    }
  }

  const zBottom = -bottomDepth;
  const writeVertex = (v, x, y, z) => {
    const p = 3 * v;
    positions[p + 0] = x;
    positions[p + 1] = y;
    positions[p + 2] = z;
  };
  let vBase = topVertexCount;

  const emitQuad = (v0, v1, v2, v3) => {
    indices[k++] = v0;
    indices[k++] = v1;
    indices[k++] = v2;
    indices[k++] = v0;
    indices[k++] = v2;
    indices[k++] = v3;
  };

  if (includeSides) {
    // Left side (x = -halfX)
    for (let r = 0; r < nr - 1; r += 1) {
      const a = (r * nc + 0) * 3;
      const b = ((r + 1) * nc + 0) * 3;
      const y0 = positions[a + 1];
      const y1 = positions[b + 1];
      const z0 = positions[a + 2];
      const z1 = positions[b + 2];
      writeVertex(vBase + 0, -halfX, y0, zBottom);
      writeVertex(vBase + 1, -halfX, y0, z0);
      writeVertex(vBase + 2, -halfX, y1, z1);
      writeVertex(vBase + 3, -halfX, y1, zBottom);
      emitQuad(vBase + 0, vBase + 1, vBase + 2, vBase + 3);
      vBase += 4;
    }
    // Right side (x = +halfX)
    for (let r = 0; r < nr - 1; r += 1) {
      const a = (r * nc + (nc - 1)) * 3;
      const b = ((r + 1) * nc + (nc - 1)) * 3;
      const y0 = positions[a + 1];
      const y1 = positions[b + 1];
      const z0 = positions[a + 2];
      const z1 = positions[b + 2];
      writeVertex(vBase + 0, +halfX, y0, zBottom);
      writeVertex(vBase + 1, +halfX, y1, zBottom);
      writeVertex(vBase + 2, +halfX, y1, z1);
      writeVertex(vBase + 3, +halfX, y0, z0);
      emitQuad(vBase + 0, vBase + 1, vBase + 2, vBase + 3);
      vBase += 4;
    }
    // Front side (y = -halfY): row 0
    for (let c = 0; c < nc - 1; c += 1) {
      const a = (0 * nc + c) * 3;
      const b = (0 * nc + (c + 1)) * 3;
      const x0 = positions[a + 0];
      const x1 = positions[b + 0];
      const z0 = positions[a + 2];
      const z1 = positions[b + 2];
      writeVertex(vBase + 0, x0, -halfY, zBottom);
      writeVertex(vBase + 1, x1, -halfY, zBottom);
      writeVertex(vBase + 2, x1, -halfY, z1);
      writeVertex(vBase + 3, x0, -halfY, z0);
      emitQuad(vBase + 0, vBase + 1, vBase + 2, vBase + 3);
      vBase += 4;
    }
    // Back side (y = +halfY): last row
    for (let c = 0; c < nc - 1; c += 1) {
      const a = ((nr - 1) * nc + c) * 3;
      const b = ((nr - 1) * nc + (c + 1)) * 3;
      const x0 = positions[a + 0];
      const x1 = positions[b + 0];
      const z0 = positions[a + 2];
      const z1 = positions[b + 2];
      writeVertex(vBase + 0, x0, +halfY, zBottom);
      writeVertex(vBase + 1, x0, +halfY, z0);
      writeVertex(vBase + 2, x1, +halfY, z1);
      writeVertex(vBase + 3, x1, +halfY, zBottom);
      emitQuad(vBase + 0, vBase + 1, vBase + 2, vBase + 3);
      vBase += 4;
    }
  }

  if (includeBottom) {
    writeVertex(vBase + 0, -halfX, -halfY, zBottom);
    writeVertex(vBase + 1, -halfX, +halfY, zBottom);
    writeVertex(vBase + 2, +halfX, +halfY, zBottom);
    writeVertex(vBase + 3, +halfX, -halfY, zBottom);
    emitQuad(vBase + 0, vBase + 1, vBase + 2, vBase + 3);
    vBase += 4;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.computeVertexNormals();
  computeGeometryBounds(geometry);
  return geometry;
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
  if (ctx.assetCache && ctx.assetCache.hfieldGeometries instanceof Map) {
    for (const geometry of ctx.assetCache.hfieldGeometries.values()) {
      if (geometry && typeof geometry.dispose === 'function') {
        try {
          geometry.dispose();
        } catch (err) {
          strictCatch(err, 'main:assetCache_dispose');
        }
      }
    }
    ctx.assetCache.hfieldGeometries.clear();
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
    hfieldGeometries: new Map(),
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
  const forceBasicFlag = !!forceBasic;
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

function ensureAssetCache(ctx) {
  if (!ctx || !ctx.assetCache || typeof ctx.assetCache !== 'object') {
    ctx.assetCache = {};
  }
  const cache = ctx.assetCache;
  if (!(cache.meshGeometries instanceof Map)) cache.meshGeometries = new Map();
  if (!(cache.hfieldGeometries instanceof Map)) cache.hfieldGeometries = new Map();
  if (!(cache.mjTextures instanceof Map)) cache.mjTextures = new Map();
  return cache;
}

function getSharedMeshGeometry(ctx, assets, dataId) {
  const cache = ensureAssetCache(ctx).meshGeometries;
  if (cache.has(dataId)) return cache.get(dataId);
  const geometry = createMeshGeometryFromAssets(assets, dataId);
  if (geometry) {
    cache.set(dataId, geometry);
  }
  return geometry || null;
}

function getSharedHfieldGeometry(ctx, assets, dataId) {
  const cache = ensureAssetCache(ctx).hfieldGeometries;
  if (cache.has(dataId)) return cache.get(dataId);
  const geometry = createHfieldGeometryFromAssets(assets, dataId);
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

function applyMaterialFlags(mesh, index, sceneFlagsOverride = null) {
  if (!mesh || !mesh.material) return;
  const sceneFlags = Array.isArray(sceneFlagsOverride) ? sceneFlagsOverride : [];
  mesh.material.wireframe = !!sceneFlags[1];
}

function clampUnit(value) {
  if (!Number.isFinite(value)) return 0;
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
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

function ensureGeomMesh(ctx, index, gtype, assets, dataId, sizeVec, options = {}, state = null, sceneFlagsOverride = null) {
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
       if (!geometryInfo && gtype === MJ_GEOM.HFIELD && assets && dataId >= 0) {
         const hfieldGeometry = getSharedHfieldGeometry(ctx, assets, dataId);
         if (hfieldGeometry) {
           const lightGray = 0xd0d0d0;
           geometryInfo = {
             geometry: hfieldGeometry,
             materialOpts: {
               color: lightGray,
               metalness: 0.0,
               roughness: 0.82,
             },
             postCreate: null,
             ownGeometry: false,
           };
         } else if (!ctx.hfieldAssetMissingLogged) {
           logDebug('[render] hfield geometry missing', { dataId });
           ctx.hfieldAssetMissingLogged = true;
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
          const sceneFlags = Array.isArray(sceneFlagsOverride) ? sceneFlagsOverride : [];
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

export {
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
};
