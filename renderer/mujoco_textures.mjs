// MuJoCo texture/texcoord helpers for the renderer.
// Keep behaviour identical; do not swallow errors.

import * as THREE from 'three';
import { strictEnsure } from '../core/viewer_runtime.mjs';
import { MJ_GEOM, MJ_MINVAL, MJ_TEXTURE } from './mujoco_constants.mjs';
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
export {
  resolveMaterialTextureDescriptor,
  quantize1e6,
  quantize1e3,
  applyMuJoCoTextureToMesh,
};
