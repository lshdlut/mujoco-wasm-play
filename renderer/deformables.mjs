// MuJoCo flex/skin helpers for the renderer.
// Keep behaviour identical; do not swallow errors.

import * as THREE from 'three';
import { strictEnsure } from '../core/viewer_runtime.mjs';
import { disposeMeshObject, disposeObject3DTree } from './three_helpers.mjs';
import { applyMuJoCoTextureToMesh } from './mujoco_textures.mjs';

function clampUnit(value) {
  if (!Number.isFinite(value)) return 0;
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
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
export {
  ensureFlexGroup,
  hideFlexGroup,
  ensureFlexEntry,
  applyFlexAppearance,
  updateFlexFaces,
  ensureSkinGroup,
  hideSkinGroup,
  ensureSkinEntry,
  applySkinAppearance,
  updateSkinMesh,
};
