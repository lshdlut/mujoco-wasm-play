// Overlay3D manager extracted from pipeline.mjs.
// Keep behaviour identical; do not swallow errors.

import * as THREE from 'three';
import { strictCatch, strictEnsure } from '../core/viewer_runtime.mjs';
import { computeGeometryBounds, disposeObject3DTree, getWorldScene } from './three_helpers.mjs';
import { transparentBinFromDepthNorm, transparentDepthNorm01 } from './depth_sort.mjs';
import {
  WORLD_LAYER,
  applyWorldMaterialState,
  normalizeWorldLayer,
  worldLayerRenderOrder,
} from './world_occlusion.mjs';

const OVERLAY3D_API_VERSION = 1;

class RefCountedAssetRegistry {
  constructor({ label = 'assets', disposeContext = 'main:assets_dispose' } = {}) {
    this.label = String(label || 'assets');
    this.disposeContext = String(disposeContext || 'main:assets_dispose');
    this.entries = new Map();
  }

  acquire(key, create, { dispose = null } = {}) {
    const k = String(key || '').trim();
    if (!k) throw new Error(`${this.label}.acquire: key is required`);
    let entry = this.entries.get(k) || null;
    if (!entry) {
      if (typeof create !== 'function') throw new Error(`${this.label}.acquire: create() is required for new key "${k}"`);
      const asset = create();
      if (!asset) throw new Error(`${this.label}.acquire: create() returned null for key "${k}"`);
      const disposeFn = (typeof dispose === 'function')
        ? dispose
        : (asset && typeof asset.dispose === 'function' ? () => asset.dispose() : null);
      entry = { asset, refCount: 0, dispose: disposeFn };
      this.entries.set(k, entry);
    }

    entry.refCount += 1;
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      const current = this.entries.get(k) || null;
      if (!current) return;
      current.refCount -= 1;
      if (current.refCount > 0) return;
      this.entries.delete(k);
      if (typeof current.dispose === 'function') {
        try {
          current.dispose();
        } catch (err) {
          strictCatch(err, this.disposeContext);
        }
      }
    };
    return { key: k, asset: entry.asset, release, refCount: entry.refCount };
  }

  get(key) {
    const k = String(key || '').trim();
    if (!k) return null;
    const entry = this.entries.get(k) || null;
    return entry ? entry.asset : null;
  }

  disposeAll() {
    for (const entry of this.entries.values()) {
      if (!entry) continue;
      if (typeof entry.dispose === 'function') {
        try {
          entry.dispose();
        } catch (err) {
          strictCatch(err, this.disposeContext);
        }
      }
    }
    this.entries.clear();
  }

  stats() {
    let total = 0;
    for (const entry of this.entries.values()) {
      if (!entry) continue;
      total += 1;
    }
    return { total };
  }
}

function ensureOverlay3D(ctx) {
  if (!ctx) return null;
  const existing = ctx._overlay3d || ctx.overlay3d || null;
  const manager = (existing && existing.apiVersion === OVERLAY3D_API_VERSION) ? existing : { apiVersion: OVERLAY3D_API_VERSION };
  const worldScene = getWorldScene(ctx);
  if (!worldScene) return null;

  if (!manager.assets || !(manager.assets instanceof RefCountedAssetRegistry)) {
    manager.assets = new RefCountedAssetRegistry({ label: 'overlay3dAssets', disposeContext: 'main:overlay3d_assets_dispose' });
  }
  if (!manager._textureLoader) {
    manager._textureLoader = new THREE.TextureLoader();
    if (typeof manager._textureLoader.setCrossOrigin === 'function') {
      manager._textureLoader.setCrossOrigin('anonymous');
    }
  }

  if (!manager.root) {
    manager.root = new THREE.Group();
    manager.root.name = 'overlay3d:root';
    manager.root.renderOrder = 0;
    strictEnsure('ensureOverlay3D', { reason: 'create_root' });
  }
  try {
    const parent = manager.root.parent || null;
    if (parent && parent !== worldScene && typeof parent.remove === 'function') {
      parent.remove(manager.root);
    }
  } catch (err) {
    strictCatch(err, 'main:overlay3d_attach');
  }
  if (manager.root.parent !== worldScene) {
    worldScene.add(manager.root);
  }

  if (!manager.layers) manager.layers = {};
  const layers = manager.layers;
  if (!layers.worldOpaque) {
    layers.worldOpaque = new THREE.Group();
    layers.worldOpaque.name = 'overlay3d:worldOpaque';
    layers.worldOpaque.renderOrder = worldLayerRenderOrder(WORLD_LAYER.WORLD_OPAQUE);
    manager.root.add(layers.worldOpaque);
    strictEnsure('ensureOverlay3D', { reason: 'create_layer', layer: 'worldOpaque' });
  }
  if (!layers.worldTransparent) {
    layers.worldTransparent = new THREE.Group();
    layers.worldTransparent.name = 'overlay3d:worldTransparent';
    layers.worldTransparent.renderOrder = worldLayerRenderOrder(WORLD_LAYER.WORLD_TRANSPARENT);
    manager.root.add(layers.worldTransparent);
    strictEnsure('ensureOverlay3D', { reason: 'create_layer', layer: 'worldTransparent' });
  }
  if (!layers.worldOverlay) {
    layers.worldOverlay = new THREE.Group();
    layers.worldOverlay.name = 'overlay3d:worldOverlay';
    layers.worldOverlay.renderOrder = worldLayerRenderOrder(WORLD_LAYER.WORLD_OVERLAY);
    manager.root.add(layers.worldOverlay);
    strictEnsure('ensureOverlay3D', { reason: 'create_layer', layer: 'worldOverlay' });
  }
  if (!layers.hud) {
    layers.hud = new THREE.Group();
    layers.hud.name = 'overlay3d:hud';
    layers.hud.renderOrder = worldLayerRenderOrder(WORLD_LAYER.HUD);
    manager.root.add(layers.hud);
    strictEnsure('ensureOverlay3D', { reason: 'create_layer', layer: 'hud' });
  }

  if (!(manager.scopes instanceof Map)) manager.scopes = new Map();
  if (typeof manager.getScope !== 'function') {
    manager.getScope = (scopeId) => {
      const id = String(scopeId || '').trim();
      if (!id) return null;
      return manager.scopes.get(id) || null;
    };
  }
  if (typeof manager.createScope !== 'function') {
    manager.createScope = (scopeId, options = {}) => {
      const id = String(scopeId || '').trim();
      if (!id) throw new Error('overlay3d.createScope: scopeId is required');
      const existingScope = manager.scopes.get(id) || null;
      if (existingScope) return existingScope;

      const scopeName = typeof options?.name === 'string' && options.name.trim() ? options.name.trim() : id;
      const groups = {
        worldOpaque: new THREE.Group(),
        worldTransparent: new THREE.Group(),
        worldOverlay: new THREE.Group(),
        hud: new THREE.Group(),
      };
      groups.worldOpaque.name = `overlay3d:scope:${id}:worldOpaque`;
      groups.worldTransparent.name = `overlay3d:scope:${id}:worldTransparent`;
      groups.worldOverlay.name = `overlay3d:scope:${id}:worldOverlay`;
      groups.hud.name = `overlay3d:scope:${id}:hud`;

      layers.worldOpaque.add(groups.worldOpaque);
      layers.worldTransparent.add(groups.worldTransparent);
      layers.worldOverlay.add(groups.worldOverlay);
      layers.hud.add(groups.hud);

      const disposers = [];
      const scopeAssetHandles = [];

      const scopeAssets = {
        acquire: (key, create, opts = {}) => {
          const handle = manager.assets.acquire(key, create, opts);
          scopeAssetHandles.push(handle);
          return handle;
        },
        geometryPrimitive: (kind) => {
          const k = String(kind || '').trim().toLowerCase();
          const key = `geom:primitive:${k}`;
          return scopeAssets.acquire(key, () => {
            let geometry = null;
            switch (k) {
              case 'sphere': geometry = new THREE.SphereGeometry(1, 16, 12); break;
              case 'box': geometry = new THREE.BoxGeometry(2, 2, 2); break;
              case 'cylinder': {
                geometry = new THREE.CylinderGeometry(1, 1, 2, 16, 1);
                geometry.rotateX(Math.PI / 2);
                break;
              }
              case 'capsule': geometry = new THREE.CapsuleGeometry(1, 2, 12, 8); break;
              case 'cone': {
                geometry = new THREE.ConeGeometry(1, 2, 16, 1);
                geometry.rotateX(Math.PI / 2);
                break;
              }
              default: geometry = new THREE.SphereGeometry(1, 16, 12); break;
            }
            computeGeometryBounds(geometry);
            return geometry;
          });
        },
        texture2DFromUrl: (url, options = {}) => {
          const u = String(url || '').trim();
          if (!u) throw new Error('overlay3d.scopeAssets.texture2DFromUrl: url is required');
          const flipY = options.flipY === true;
          const colorSpace = options.colorSpace || null;
          const wrapS = options.wrapS || null;
          const wrapT = options.wrapT || null;
          const key = `tex2d:${u}|fy${flipY ? 1 : 0}|cs:${colorSpace || ''}|ws:${wrapS || ''}|wt:${wrapT || ''}`;
          return scopeAssets.acquire(key, () => {
            const loader = manager._textureLoader;
            const tex = loader.load(u);
            if (typeof tex.flipY === 'boolean') tex.flipY = flipY;
            if (colorSpace && 'colorSpace' in tex) tex.colorSpace = colorSpace;
            if (wrapS && 'wrapS' in tex) tex.wrapS = wrapS;
            if (wrapT && 'wrapT' in tex) tex.wrapT = wrapT;
            if (options.anisotropy != null && 'anisotropy' in tex) {
              tex.anisotropy = Math.max(0, Number(options.anisotropy) || 0);
            }
            if (options.generateMipmaps != null && 'generateMipmaps' in tex) {
              tex.generateMipmaps = !!options.generateMipmaps;
            }
            tex.needsUpdate = true;
            return tex;
          });
        },
      };

      const applyLayerToObjectTree = (object3d, layerKey, { applyLayerMaterial = true } = {}) => {
        if (!object3d || typeof object3d.traverse !== 'function') return;
        const renderOrder = worldLayerRenderOrder(layerKey);
        object3d.traverse((node) => {
          if (!node || typeof node !== 'object') return;
          node.userData = node.userData || {};
          node.userData.overlay3dScope = id;
          node.userData.overlay3dLayer = layerKey;
          if (typeof node.renderOrder === 'number') {
            node.renderOrder = renderOrder;
          }
          if (applyLayerMaterial && node.material) {
            applyWorldMaterialState(node.material, layerKey, {
              opacity: Number.isFinite(node.material.opacity) ? node.material.opacity : 1,
              toneMapped: ('toneMapped' in node.material) ? !!node.material.toneMapped : undefined,
            });
          }
        });
      };

      const addObject3D = (object3d, { layer = 'worldOpaque', owned = false, name = null, applyLayerMaterial = true } = {}) => {
        if (!object3d) return null;
        const key = normalizeWorldLayer(layer);
        const parent =
          key === WORLD_LAYER.WORLD_TRANSPARENT ? groups.worldTransparent :
          key === WORLD_LAYER.WORLD_OVERLAY ? groups.worldOverlay :
          key === WORLD_LAYER.HUD ? groups.hud :
          groups.worldOpaque;
        parent.add(object3d);
        if (name && typeof object3d.name === 'string') object3d.name = String(name);
        applyLayerToObjectTree(object3d, key, { applyLayerMaterial });
        if (owned) {
          disposers.push(() => disposeObject3DTree(object3d));
        }
        return object3d;
      };

      const createInstancedMeshBatch = ({
        name = null,
        primitive = null,
        geometry = null,
        material = null,
        materialKey = null,
        transparency = null,
        ownsGeometry = null,
        ownsMaterial = null,
        capacity = 1,
        layer = 'worldOpaque',
        castShadow = false,
        receiveShadow = false,
      } = {}) => {
        const cap = Math.max(1, capacity | 0);
        let geomHandle = null;
        let geom = geometry || null;
        const primitiveKey = primitive ? String(primitive || '').trim() : '';
        if (!geom) {
          geomHandle = scopeAssets.geometryPrimitive(primitiveKey || 'sphere');
          geom = geomHandle.asset;
        }
        const ownGeom = (ownsGeometry == null) ? !geomHandle : !!ownsGeometry;

        let matHandle = null;
        let mat = material || null;
        if (!mat) {
          const key = String(materialKey || '').trim();
          if (key) {
            matHandle = scopeAssets.acquire(key, () => new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.55, metalness: 0.0 }));
            mat = matHandle.asset;
          } else {
            mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.55, metalness: 0.0 });
          }
        }
        const ownMat = (ownsMaterial == null) ? !matHandle : !!ownsMaterial;
        const mesh = new THREE.InstancedMesh(geom, mat, cap);
        mesh.name = name ? String(name) : 'overlay3d:instanced';
        mesh.frustumCulled = false;
        mesh.castShadow = !!castShadow;
        mesh.receiveShadow = !!receiveShadow;
        if (mesh.instanceMatrix && typeof mesh.instanceMatrix.setUsage === 'function') {
          mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        }

        const authorPos = new Float32Array(cap * 3);
        const authorQuat = new Float32Array(cap * 4);
        const authorScale = new Float32Array(cap * 3);
        const authorRgb = new Float32Array(cap * 3);
        const authorMat4 = new Float32Array(cap * 16);
        for (let i = 0; i < cap; i += 1) {
          authorQuat[i * 4 + 3] = 1;
          authorScale[i * 3 + 0] = 1;
          authorScale[i * 3 + 1] = 1;
          authorScale[i * 3 + 2] = 1;
          authorRgb[i * 3 + 0] = 1;
          authorRgb[i * 3 + 1] = 1;
          authorRgb[i * 3 + 2] = 1;
        }

        const gpuColorAttr = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
        gpuColorAttr.setUsage(THREE.DynamicDrawUsage);
        mesh.instanceColor = gpuColorAttr;

        const resolveTransparency = (spec = null) => {
          const defaults = manager.transparencyDefaults || {};
          const src = (spec && typeof spec === 'object')
            ? spec
            : ((transparency && typeof transparency === 'object') ? transparency : {});
          const layerKey = normalizeWorldLayer(layer);
          const defaultMode = layerKey === WORLD_LAYER.WORLD_TRANSPARENT ? 'blend' : 'opaque';
          const mode = (src.mode === 'opaque' || src.mode === 'blend') ? src.mode : defaultMode;
          const opacityRaw = Number.isFinite(src.opacity) ? Number(src.opacity) : Number(mat?.opacity);
          const opacity = Number.isFinite(opacityRaw) ? Math.max(0, Math.min(1, opacityRaw)) : 1;
          const toneMapped = (src.toneMapped != null) ? !!src.toneMapped : (layerKey !== WORLD_LAYER.HUD);
          const materialState = applyWorldMaterialState(mat, layerKey, { opacity, toneMapped });

          const sortModeRaw = String(src.sortMode || 'inherit');
          let sortMode = (sortModeRaw === 'inherit') ? String(defaults.sortMode || 'bins') : sortModeRaw;
          if (sortMode !== 'strict' && sortMode !== 'bins' && sortMode !== 'nosort') sortMode = 'bins';
          const binsRaw = Number.isFinite(src.bins) ? Number(src.bins) : Number(defaults.bins);
          const bins = Math.max(1, Math.min(16, Number.isFinite(binsRaw) ? (binsRaw | 0) : 8));
          const updateRaw = String(src.update || 'inherit');
          let update = (updateRaw === 'inherit') ? String(defaults.update || 'frame') : updateRaw;
          if (update !== 'commit' && update !== 'frame') update = 'frame';
          const everyRaw = Number.isFinite(src.every) ? Number(src.every) : Number(defaults.every);
          const every = Math.max(1, Number.isFinite(everyRaw) ? (everyRaw | 0) : 1);

          if (layerKey !== WORLD_LAYER.WORLD_TRANSPARENT || !materialState.transparent) sortMode = 'nosort';

          return {
            layer: layerKey,
            mode: materialState.transparent ? 'blend' : 'opaque',
            opacity: materialState.opacity,
            sortMode,
            bins,
            update,
            every,
          };
        };

        let transparencyPolicy = resolveTransparency(transparency);
        let batch = null;
        let frameRegistered = false;
        const wantsFrameSort = (policy) => (
          policy?.layer === WORLD_LAYER.WORLD_TRANSPARENT &&
          policy?.mode === 'blend' &&
          policy?.sortMode !== 'nosort' &&
          policy?.update === 'frame'
        );
        const updateFrameRegistration = () => {
          const set = manager._frameBatches;
          if (!batch || !(set instanceof Set)) return;
          const want = wantsFrameSort(transparencyPolicy);
          if (want && !frameRegistered) {
            set.add(batch);
            frameRegistered = true;
          } else if (!want && frameRegistered) {
            set.delete(batch);
            frameRegistered = false;
          }
        };

        const tmpPos = new THREE.Vector3();
        const tmpQuat = new THREE.Quaternion();
        const tmpScale = new THREE.Vector3();
        const tmpMat4 = new THREE.Matrix4();
        const tmpCamPos = new THREE.Vector3();
        const tmpCamDir = new THREE.Vector3();
        const lastCamPos = new THREE.Vector3();
        const lastCamDir = new THREE.Vector3();
        let lastCamValid = false;
        let dirty = true;
        let lastFrameSorted = -1;
        let depthRange = null;
        const sortDepth = new Float32Array(cap);
        const sortIdx = new Int32Array(cap);
        const binKey = new Uint8Array(cap);
        const binCounts = new Int32Array(16);
        const binCursor = new Int32Array(16);

        const updateBoundingSphere = (n) => {
          if (n <= 0) return;
          if (!mesh.boundingSphere) {
            mesh.boundingSphere = new THREE.Sphere();
          }
          let minX = authorPos[0];
          let minY = authorPos[1];
          let minZ = authorPos[2];
          let maxX = minX;
          let maxY = minY;
          let maxZ = minZ;
          let maxScale = 1;
          for (let i = 0; i < n; i += 1) {
            const pBase = i * 3;
            const x = authorPos[pBase + 0];
            const y = authorPos[pBase + 1];
            const z = authorPos[pBase + 2];
            if (x < minX) minX = x;
            if (y < minY) minY = y;
            if (z < minZ) minZ = z;
            if (x > maxX) maxX = x;
            if (y > maxY) maxY = y;
            if (z > maxZ) maxZ = z;
            const sx = Math.abs(authorScale[pBase + 0]) || 0;
            const sy = Math.abs(authorScale[pBase + 1]) || 0;
            const sz = Math.abs(authorScale[pBase + 2]) || 0;
            const s = Math.max(sx, sy, sz);
            if (s > maxScale) maxScale = s;
          }
          const cx = (minX + maxX) * 0.5;
          const cy = (minY + maxY) * 0.5;
          const cz = (minZ + maxZ) * 0.5;
          let maxDist2 = 0;
          for (let i = 0; i < n; i += 1) {
            const pBase = i * 3;
            const dx = authorPos[pBase + 0] - cx;
            const dy = authorPos[pBase + 1] - cy;
            const dz = authorPos[pBase + 2] - cz;
            const d2 = dx * dx + dy * dy + dz * dz;
            if (d2 > maxDist2) maxDist2 = d2;
          }
          const baseRadius = (geom && geom.boundingSphere && typeof geom.boundingSphere.radius === 'number')
            ? Math.max(0, Number(geom.boundingSphere.radius) || 0)
            : 1;
          mesh.boundingSphere.center.set(cx, cy, cz);
          mesh.boundingSphere.radius = Math.sqrt(Math.max(0, maxDist2)) + baseRadius * maxScale;
        };

        const syncToGpu = (camera, { force = false, frame = null } = {}) => {
          const n = used | 0;
          mesh.count = n;
          mesh.visible = n > 0;
          if (n <= 0) {
            dirty = false;
            return;
          }

          const policy = transparencyPolicy;
          const sortMode = policy?.sortMode || 'nosort';
          const update = policy?.update || 'commit';
          const every = Math.max(1, policy?.every | 0);
          if (!force && update === 'commit' && !dirty) return;
          if (!force && update === 'frame' && frame != null && every > 1 && (frame | 0) % every !== 0 && !dirty) return;

          const wantsSort = sortMode !== 'nosort';
          let cameraReady = false;
          if (wantsSort && camera && typeof camera.getWorldPosition === 'function' && typeof camera.getWorldDirection === 'function') {
            camera.getWorldPosition(tmpCamPos);
            camera.getWorldDirection(tmpCamDir);
            cameraReady = true;
            if (!force && update === 'frame' && lastCamValid && !dirty) {
              const dx = tmpCamPos.x - lastCamPos.x;
              const dy = tmpCamPos.y - lastCamPos.y;
              const dz = tmpCamPos.z - lastCamPos.z;
              const dp = dx * dx + dy * dy + dz * dz;
              const dot = tmpCamDir.x * lastCamDir.x + tmpCamDir.y * lastCamDir.y + tmpCamDir.z * lastCamDir.z;
              if (dp < 1e-10 && (1 - dot) < 1e-8) return;
            }
          }

          if (cameraReady) {
            lastCamPos.copy(tmpCamPos);
            lastCamDir.copy(tmpCamDir);
            lastCamValid = true;
          } else {
            lastCamValid = false;
          }

          const outMat = mesh.instanceMatrix?.array || null;
          const outRgb = mesh.instanceColor?.array || null;
          if (!outMat || !outRgb) return;

          if (!wantsSort || !cameraReady) {
            outMat.set(authorMat4.subarray(0, n * 16), 0);
            outRgb.set(authorRgb.subarray(0, n * 3), 0);
          } else if (sortMode === 'strict') {
            const camX = tmpCamPos.x;
            const camY = tmpCamPos.y;
            const camZ = tmpCamPos.z;
            const dirX = tmpCamDir.x;
            const dirY = tmpCamDir.y;
            const dirZ = tmpCamDir.z;
            for (let i = 0; i < n; i += 1) {
              const pBase = i * 3;
              const px = authorPos[pBase + 0];
              const py = authorPos[pBase + 1];
              const pz = authorPos[pBase + 2];
              const dx = px - camX;
              const dy = py - camY;
              const dz = pz - camZ;
              sortDepth[i] = dx * dirX + dy * dirY + dz * dirZ;
              sortIdx[i] = i;
            }
            const idxView = sortIdx.subarray(0, n);
            idxView.sort((a, b) => {
              const da = sortDepth[a];
              const db = sortDepth[b];
              if (db > da) return 1;
              if (db < da) return -1;
              return (a | 0) - (b | 0);
            });
            for (let outI = 0; outI < n; outI += 1) {
              const srcI = idxView[outI] | 0;
              const srcBase = srcI * 16;
              const dstBase = outI * 16;
              for (let k = 0; k < 16; k += 1) {
                outMat[dstBase + k] = authorMat4[srcBase + k];
              }
              const cBase = outI * 3;
              const sBase = srcI * 3;
              outRgb[cBase + 0] = authorRgb[sBase + 0];
              outRgb[cBase + 1] = authorRgb[sBase + 1];
              outRgb[cBase + 2] = authorRgb[sBase + 2];
            }
          } else if (sortMode === 'bins') {
            const bins = Math.max(1, Math.min(16, policy.bins | 0));
            const camX = tmpCamPos.x;
            const camY = tmpCamPos.y;
            const camZ = tmpCamPos.z;
            const dirX = tmpCamDir.x;
            const dirY = tmpCamDir.y;
            const dirZ = tmpCamDir.z;
            let min = 0;
            let max = 0;
            for (let i = 0; i < n; i += 1) {
              const pBase = i * 3;
              const px = authorPos[pBase + 0];
              const py = authorPos[pBase + 1];
              const pz = authorPos[pBase + 2];
              const dx = px - camX;
              const dy = py - camY;
              const dz = pz - camZ;
              const depth = dx * dirX + dy * dirY + dz * dirZ;
              sortDepth[i] = depth;
              if (i === 0) {
                min = depth;
                max = depth;
              } else {
                if (depth < min) min = depth;
                if (depth > max) max = depth;
              }
            }
            if (!Number.isFinite(min) || !Number.isFinite(max)) {
              min = 0;
              max = 1;
            } else if (max - min < 1e-6) {
              max = min + 1;
            }
            const ema = 0.2;
            if (depthRange && Number.isFinite(depthRange.min) && Number.isFinite(depthRange.max)) {
              depthRange.min = depthRange.min + (min - depthRange.min) * ema;
              depthRange.max = depthRange.max + (max - depthRange.max) * ema;
              min = depthRange.min;
              max = depthRange.max;
            } else {
              depthRange = { min, max };
            }
            const span = Math.max(1e-6, max - min);
            const margin = Math.max(1e-3, span * 0.05);
            const depthMin = min - margin;
            const invSpan = 1 / Math.max(1e-6, (max + margin) - (min - margin));

            binCounts.fill(0);
            for (let i = 0; i < n; i += 1) {
              const norm = transparentDepthNorm01(sortDepth[i], depthMin, invSpan);
              const b = transparentBinFromDepthNorm(norm, bins);
              binKey[i] = b;
              binCounts[b] += 1;
            }
            let cursor = 0;
            for (let b = bins - 1; b >= 0; b -= 1) {
              binCursor[b] = cursor;
              cursor += binCounts[b] | 0;
            }
            for (let i = 0; i < n; i += 1) {
              const b = binKey[i] | 0;
              const outI = binCursor[b] | 0;
              binCursor[b] = outI + 1;
              const srcBase = i * 16;
              const dstBase = outI * 16;
              for (let k = 0; k < 16; k += 1) {
                outMat[dstBase + k] = authorMat4[srcBase + k];
              }
              const cBase = outI * 3;
              const sBase = i * 3;
              outRgb[cBase + 0] = authorRgb[sBase + 0];
              outRgb[cBase + 1] = authorRgb[sBase + 1];
              outRgb[cBase + 2] = authorRgb[sBase + 2];
            }
          } else {
            outMat.set(authorMat4.subarray(0, n * 16), 0);
            outRgb.set(authorRgb.subarray(0, n * 3), 0);
          }

          if (mesh.instanceMatrix) {
            if (typeof mesh.instanceMatrix.clearUpdateRanges === 'function') mesh.instanceMatrix.clearUpdateRanges();
            if (typeof mesh.instanceMatrix.addUpdateRange === 'function') mesh.instanceMatrix.addUpdateRange(0, n * 16);
            mesh.instanceMatrix.needsUpdate = true;
          }
          if (mesh.instanceColor) {
            if (typeof mesh.instanceColor.clearUpdateRanges === 'function') mesh.instanceColor.clearUpdateRanges();
            if (typeof mesh.instanceColor.addUpdateRange === 'function') mesh.instanceColor.addUpdateRange(0, n * 3);
            mesh.instanceColor.needsUpdate = true;
          }

          dirty = false;
          lastFrameSorted = Number.isFinite(frame) ? (frame | 0) : lastFrameSorted;
        };

        let used = 0;
        mesh.count = 0;
        mesh.visible = false;

        const flushCommit = (camera = null, frame = null) => {
          const n = used | 0;
          if (n > 0) {
            for (let i = 0; i < n; i += 1) {
              const pBase = i * 3;
              const qBase = i * 4;
              tmpPos.set(authorPos[pBase + 0], authorPos[pBase + 1], authorPos[pBase + 2]);
              tmpQuat.set(authorQuat[qBase + 0], authorQuat[qBase + 1], authorQuat[qBase + 2], authorQuat[qBase + 3]);
              tmpScale.set(authorScale[pBase + 0], authorScale[pBase + 1], authorScale[pBase + 2]);
              tmpMat4.compose(tmpPos, tmpQuat, tmpScale);
              authorMat4.set(tmpMat4.elements, i * 16);
            }
            updateBoundingSphere(n);
          }
          dirty = true;
          const f = Number.isFinite(frame) ? (frame | 0) : null;
          syncToGpu(camera || ctx?.camera || null, { force: true, frame: f });
        };

        const commit = ({ count = used } = {}) => {
          used = Math.max(0, Math.min(cap, count | 0));
          const queue = manager._commitTasks;
          if (queue instanceof Set) queue.add(flushCommit);
        };

        const onFrame = ({ camera = null, frame = null } = {}) => {
          if (transparencyPolicy.update !== 'frame') return;
          const f = Number.isFinite(frame) ? (frame | 0) : null;
          syncToGpu(camera || ctx?.camera || null, { force: false, frame: f });
        };

        addObject3D(mesh, { layer, owned: false, applyLayerMaterial: false });

        const setTransparency = (spec = null, { sync = true } = {}) => {
          const nextSpec = (spec && typeof spec === 'object') ? spec : {};
          transparencyPolicy = resolveTransparency(nextSpec);
          if (batch) batch.transparency = transparencyPolicy;
          updateFrameRegistration();
          dirty = true;
          if (sync) {
            const queue = manager._commitTasks;
            if (queue instanceof Set) queue.add(flushCommit);
          }
          return transparencyPolicy;
        };

        batch = {
          kind: 'instancedMesh',
          mesh,
          capacity: cap,
          ownsGeometry: ownGeom,
          ownsMaterial: ownMat,
          transparency: transparencyPolicy,
          writer: {
            pos: authorPos,
            quat: authorQuat,
            scale: authorScale,
            rgb: authorRgb,
          },
          commit,
          onFrame,
          setTransparency,
          dispose: null,
        };

        updateFrameRegistration();

        const dispose = () => {
          if (manager._frameBatches instanceof Set) {
            manager._frameBatches.delete(batch);
          }
          if (manager._commitTasks instanceof Set) {
            manager._commitTasks.delete(flushCommit);
          }
          frameRegistered = false;
          try {
            if (mesh.parent && typeof mesh.parent.remove === 'function') {
              mesh.parent.remove(mesh);
            }
          } catch (err) {
            strictCatch(err, 'main:overlay3d_dispose_batch');
          }
          if (geomHandle) {
            try { geomHandle.release(); } catch (err) { strictCatch(err, 'main:overlay3d_dispose_batch'); }
          } else if (ownGeom && geom && typeof geom.dispose === 'function') {
            try { geom.dispose(); } catch (err) { strictCatch(err, 'main:overlay3d_dispose_batch'); }
          }
          if (matHandle) {
            try { matHandle.release(); } catch (err) { strictCatch(err, 'main:overlay3d_dispose_batch'); }
          } else if (ownMat && mat && typeof mat.dispose === 'function') {
            try { mat.dispose(); } catch (err) { strictCatch(err, 'main:overlay3d_dispose_batch'); }
          }
        };
        batch.dispose = dispose;
        disposers.push(dispose);

        return batch;
      };

      const createPointsBatch = ({
        name = null,
        material = null,
        capacity = 1,
        layer = 'worldOpaque',
        size = 3,
        sizeAttenuation = true,
        opacity = 1,
      } = {}) => {
        const cap = Math.max(1, capacity | 0);
        const authorPos = new Float32Array(cap * 3);
        const authorRgb = new Float32Array(cap * 3);
        for (let i = 0; i < cap; i += 1) {
          authorRgb[i * 3 + 0] = 1;
          authorRgb[i * 3 + 1] = 1;
          authorRgb[i * 3 + 2] = 1;
        }

        const geometry = new THREE.BufferGeometry();
        const posAttr = new THREE.BufferAttribute(new Float32Array(cap * 3), 3);
        const colAttr = new THREE.BufferAttribute(new Float32Array(cap * 3), 3);
        if (typeof posAttr.setUsage === 'function') posAttr.setUsage(THREE.DynamicDrawUsage);
        if (typeof colAttr.setUsage === 'function') colAttr.setUsage(THREE.DynamicDrawUsage);
        geometry.setAttribute('position', posAttr);
        geometry.setAttribute('color', colAttr);

        const alpha = Number(opacity);
        const mat = material || new THREE.PointsMaterial({
          color: 0xffffff,
          vertexColors: true,
          size: Number(size) || 1,
          sizeAttenuation: !!sizeAttenuation,
          transparent: false,
          opacity: 1,
          depthTest: true,
          depthWrite: true,
        });
        if ('opacity' in mat) mat.opacity = Number.isFinite(alpha) ? alpha : 1;
        const points = new THREE.Points(geometry, mat);
        points.name = name ? String(name) : 'overlay3d:points';
        points.frustumCulled = false;
        geometry.setDrawRange(0, 0);
        points.visible = false;

        let used = 0;
        const flushCommit = () => {
          const n = used | 0;
          geometry.setDrawRange(0, n);
          points.visible = n > 0;
          if (n <= 0) return;
          posAttr.array.set(authorPos.subarray(0, n * 3), 0);
          colAttr.array.set(authorRgb.subarray(0, n * 3), 0);
          if (typeof posAttr.clearUpdateRanges === 'function') posAttr.clearUpdateRanges();
          if (typeof posAttr.addUpdateRange === 'function') posAttr.addUpdateRange(0, n * 3);
          if (typeof colAttr.clearUpdateRanges === 'function') colAttr.clearUpdateRanges();
          if (typeof colAttr.addUpdateRange === 'function') colAttr.addUpdateRange(0, n * 3);
          posAttr.needsUpdate = true;
          colAttr.needsUpdate = true;
        };

        const commit = ({ count = used } = {}) => {
          used = Math.max(0, Math.min(cap, count | 0));
          const queue = manager._commitTasks;
          if (queue instanceof Set) queue.add(flushCommit);
        };

        addObject3D(points, { layer, owned: false });
        const dispose = () => {
          if (manager._commitTasks instanceof Set) {
            manager._commitTasks.delete(flushCommit);
          }
          try { disposeObject3DTree(points); } catch (err) { strictCatch(err, 'main:overlay3d_dispose_batch'); }
        };
        disposers.push(dispose);

        return {
          kind: 'points',
          points,
          capacity: cap,
          writer: { pos: authorPos, rgb: authorRgb },
          commit,
          dispose,
        };
      };

      const createLineSegmentsBatch = ({
        name = null,
        material = null,
        capacity = 1,
        layer = 'worldOpaque',
        opacity = 1,
      } = {}) => {
        const cap = Math.max(1, capacity | 0);
        const authorPos = new Float32Array(cap * 2 * 3);
        const authorRgb = new Float32Array(cap * 2 * 3);
        for (let i = 0; i < cap * 2; i += 1) {
          authorRgb[i * 3 + 0] = 1;
          authorRgb[i * 3 + 1] = 1;
          authorRgb[i * 3 + 2] = 1;
        }

        const geometry = new THREE.BufferGeometry();
        const posAttr = new THREE.BufferAttribute(new Float32Array(cap * 2 * 3), 3);
        const colAttr = new THREE.BufferAttribute(new Float32Array(cap * 2 * 3), 3);
        if (typeof posAttr.setUsage === 'function') posAttr.setUsage(THREE.DynamicDrawUsage);
        if (typeof colAttr.setUsage === 'function') colAttr.setUsage(THREE.DynamicDrawUsage);
        geometry.setAttribute('position', posAttr);
        geometry.setAttribute('color', colAttr);

        const alpha = Number(opacity);
        const mat = material || new THREE.LineBasicMaterial({
          color: 0xffffff,
          vertexColors: true,
          transparent: false,
          opacity: 1,
          depthTest: true,
          depthWrite: true,
        });
        if ('opacity' in mat) mat.opacity = Number.isFinite(alpha) ? alpha : 1;
        const lines = new THREE.LineSegments(geometry, mat);
        lines.name = name ? String(name) : 'overlay3d:lines';
        lines.frustumCulled = false;
        geometry.setDrawRange(0, 0);
        lines.visible = false;

        let used = 0;
        const flushCommit = () => {
          const n = used | 0;
          geometry.setDrawRange(0, n * 2);
          lines.visible = n > 0;
          if (n <= 0) return;
          posAttr.array.set(authorPos.subarray(0, n * 2 * 3), 0);
          colAttr.array.set(authorRgb.subarray(0, n * 2 * 3), 0);
          if (typeof posAttr.clearUpdateRanges === 'function') posAttr.clearUpdateRanges();
          if (typeof posAttr.addUpdateRange === 'function') posAttr.addUpdateRange(0, n * 2 * 3);
          if (typeof colAttr.clearUpdateRanges === 'function') colAttr.clearUpdateRanges();
          if (typeof colAttr.addUpdateRange === 'function') colAttr.addUpdateRange(0, n * 2 * 3);
          posAttr.needsUpdate = true;
          colAttr.needsUpdate = true;
        };

        const commit = ({ count = used } = {}) => {
          used = Math.max(0, Math.min(cap, count | 0));
          const queue = manager._commitTasks;
          if (queue instanceof Set) queue.add(flushCommit);
        };

        addObject3D(lines, { layer, owned: false });
        const dispose = () => {
          if (manager._commitTasks instanceof Set) {
            manager._commitTasks.delete(flushCommit);
          }
          try { disposeObject3DTree(lines); } catch (err) { strictCatch(err, 'main:overlay3d_dispose_batch'); }
        };
        disposers.push(dispose);

        return {
          kind: 'lineSegments',
          lines,
          capacity: cap,
          writer: { pos: authorPos, rgb: authorRgb },
          commit,
          dispose,
        };
      };

      const createMesh = ({
        name = null,
        geometry = null,
        material = null,
        materialKey = null,
        ownsGeometry = true,
        ownsMaterial = true,
        layer = 'worldOpaque',
        castShadow = false,
        receiveShadow = false,
      } = {}) => {
        const geom = geometry || new THREE.BufferGeometry();
        let matHandle = null;
        let mat = material || null;
        if (!mat) {
          const key = String(materialKey || '').trim();
          if (key) {
            matHandle = scopeAssets.acquire(key, () => new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.55, metalness: 0.0 }));
            mat = matHandle.asset;
          } else {
            mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.55, metalness: 0.0 });
          }
        }
        const ownMat = matHandle ? false : !!ownsMaterial;
        const mesh = new THREE.Mesh(geom, mat);
        mesh.name = name ? String(name) : 'overlay3d:mesh';
        mesh.frustumCulled = false;
        mesh.castShadow = !!castShadow;
        mesh.receiveShadow = !!receiveShadow;
        addObject3D(mesh, { layer, owned: false });
        const dispose = () => {
          try {
            if (mesh.parent && typeof mesh.parent.remove === 'function') {
              mesh.parent.remove(mesh);
            }
          } catch (err) {
            strictCatch(err, 'main:overlay3d_dispose_batch');
          }
          if (ownsGeometry && geom && typeof geom.dispose === 'function') {
            try { geom.dispose(); } catch (err) { strictCatch(err, 'main:overlay3d_dispose_batch'); }
          }
          if (matHandle) {
            try { matHandle.release(); } catch (err) { strictCatch(err, 'main:overlay3d_dispose_batch'); }
          } else if (ownMat && mat && typeof mat.dispose === 'function') {
            try { mat.dispose(); } catch (err) { strictCatch(err, 'main:overlay3d_dispose_batch'); }
          }
        };
        disposers.push(dispose);
        return { kind: 'mesh', mesh, dispose };
      };

      const scope = {
        apiVersion: OVERLAY3D_API_VERSION,
        id,
        name: scopeName,
        groups,
        addObject3D,
        createInstancedMeshBatch,
        createPointsBatch,
        createLineSegmentsBatch,
        createMesh,
        assets: scopeAssets,
        dispose: () => {
          while (disposers.length) {
            const d = disposers.pop();
            if (!d) continue;
            try { d(); } catch (err) { strictCatch(err, 'main:overlay3d_scope_dispose'); }
          }
          while (scopeAssetHandles.length) {
            const handle = scopeAssetHandles.pop();
            if (!handle) continue;
            try { handle.release(); } catch (err) { strictCatch(err, 'main:overlay3d_scope_dispose'); }
          }
          try { disposeObject3DTree(groups.worldOpaque); } catch (err) { strictCatch(err, 'main:overlay3d_scope_dispose'); }
          try { disposeObject3DTree(groups.worldTransparent); } catch (err) { strictCatch(err, 'main:overlay3d_scope_dispose'); }
          try { disposeObject3DTree(groups.worldOverlay); } catch (err) { strictCatch(err, 'main:overlay3d_scope_dispose'); }
          try { disposeObject3DTree(groups.hud); } catch (err) { strictCatch(err, 'main:overlay3d_scope_dispose'); }
          try { manager.scopes.delete(id); } catch (err) { strictCatch(err, 'main:overlay3d_scope_dispose'); }
        },
      };
      manager.scopes.set(id, scope);
      strictEnsure('ensureOverlay3D', { reason: 'create_scope', scopeId: id });
      return scope;
    };
  }

  if (!manager.transparencyDefaults) {
    manager.transparencyDefaults = {
      sortMode: 'bins',
      bins: 8,
      update: 'frame',
      every: 1,
    };
  }
  if (typeof manager.getTransparencyDefaults !== 'function') {
    manager.getTransparencyDefaults = () => ({ ...manager.transparencyDefaults });
  }
  if (typeof manager.setTransparencyDefaults !== 'function') {
    manager.setTransparencyDefaults = (next = {}) => {
      const cur = manager.transparencyDefaults || {};
      const src = (next && typeof next === 'object') ? next : {};
      const sortMode = src.sortMode;
      const bins = src.bins;
      const update = src.update;
      const every = src.every;
      if (sortMode === 'strict' || sortMode === 'bins' || sortMode === 'nosort') cur.sortMode = sortMode;
      if (Number.isFinite(bins)) cur.bins = Math.max(1, Math.min(16, bins | 0));
      if (update === 'commit' || update === 'frame') cur.update = update;
      if (Number.isFinite(every)) cur.every = Math.max(1, every | 0);
      manager.transparencyDefaults = cur;
      return manager.getTransparencyDefaults();
    };
  }
  if (!(manager._frameBatches instanceof Set)) {
    manager._frameBatches = new Set();
  }
  if (!(manager._commitTasks instanceof Set)) {
    manager._commitTasks = new Set();
  }
  if (typeof manager.flushCommits !== 'function') {
    manager.flushCommits = ({ camera = null, frame = null } = {}) => {
      const tasks = manager._commitTasks;
      if (!(tasks instanceof Set) || tasks.size === 0) return;
      const cam = camera || ctx?.camera || null;
      const flushed = Array.from(tasks.values());
      tasks.clear();
      for (const task of flushed) {
        if (typeof task !== 'function') continue;
        try {
          task(cam, frame);
        } catch (err) {
          strictCatch(err, 'main:overlay3d_flushCommits');
        }
      }
    };
  }
  if (typeof manager.onFrame !== 'function') {
    manager.onFrame = ({ camera = null, frame = null } = {}) => {
      const cam = camera || ctx?.camera || null;
      if (!cam) return;
      const batches = manager._frameBatches;
      if (!(batches instanceof Set) || batches.size === 0) return;
      for (const batch of batches.values()) {
        if (!batch || typeof batch.onFrame !== 'function') continue;
        try {
          batch.onFrame({ camera: cam, frame });
        } catch (err) {
          strictCatch(err, 'main:overlay3d_onFrame');
        }
      }
    };
  }

  if (typeof manager.disposeAll !== 'function') {
    manager.disposeAll = () => {
      if (manager.scopes instanceof Map) {
        for (const scope of manager.scopes.values()) {
          if (!scope || typeof scope.dispose !== 'function') continue;
          scope.dispose();
        }
        manager.scopes.clear();
      }
      if (manager.root) {
        disposeObject3DTree(manager.root);
      }
      if (manager.assets && typeof manager.assets.disposeAll === 'function') {
        manager.assets.disposeAll();
      }
      if (manager._frameBatches instanceof Set) {
        manager._frameBatches.clear();
      }
      if (manager._commitTasks instanceof Set) {
        manager._commitTasks.clear();
      }
      manager.root = null;
      manager.layers = null;
    };
  }

  ctx._overlay3d = manager;
  ctx.overlay3d = manager;
  return manager;
}

function disposeOverlay3D(ctx) {
  const mgr = ctx?._overlay3d || ctx?.overlay3d || null;
  if (!mgr) return;
  if (typeof mgr.disposeAll === 'function') {
    try { mgr.disposeAll(); } catch (err) { strictCatch(err, 'main:overlay3d_dispose'); }
  } else if (mgr.root) {
    try { disposeObject3DTree(mgr.root); } catch (err) { strictCatch(err, 'main:overlay3d_dispose'); }
  }
  ctx._overlay3d = null;
  ctx.overlay3d = null;
}


export {
  disposeOverlay3D,
  ensureOverlay3D,
};
