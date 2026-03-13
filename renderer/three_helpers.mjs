// Renderer-local three.js helpers extracted from pipeline.mjs.
// Keep behaviour identical; do not swallow errors.

import { strictCatch } from '../core/viewer_runtime.mjs';

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

function computeGeometryBounds(geometry) {
  geometry?.computeBoundingBox?.();
  geometry?.computeBoundingSphere?.();
}

function disposeMaterialOnce(material, disposed, scope) {
  if (!material || material.userData?.pooled || typeof material.dispose !== 'function') return;
  if (disposed?.has(material)) return;
  try {
    material.dispose();
  } catch (err) {
    strictCatch(err, scope);
  }
  disposed?.add(material);
}

function disposeInfiniteGroundMaterials(userData, activeMaterial, disposed, scope) {
  const infiniteGround = userData?.infiniteGround || null;
  if (!infiniteGround) return;
  const extras = [
    infiniteGround.baseMaterial,
    infiniteGround.segmentMaterial,
  ];
  for (const material of extras) {
    if (!material || material === activeMaterial) continue;
    disposeMaterialOnce(material, disposed, scope);
  }
  infiniteGround.baseMaterial = null;
  infiniteGround.segmentMaterial = null;
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
  if (Array.isArray(mesh.children) && mesh.children.length > 0) {
    disposeObject3DTree(mesh);
    return;
  }
  const userData = mesh.userData || null;
  const parent = mesh.parent;
  if (parent && typeof parent.remove === 'function') {
    parent.remove(mesh);
  }
  const ownGeometry = userData?.ownGeometry !== false;
  const disposedMaterials = new Set();
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
      disposeMaterialOnce(mat, disposedMaterials, 'main:dispose_mesh');
    }
  } else {
    disposeMaterialOnce(material, disposedMaterials, 'main:dispose_mesh');
  }
  disposeInfiniteGroundMaterials(userData, material, disposedMaterials, 'main:dispose_mesh');
  const segMat = userData?.segmentMaterial || null;
  if (segMat) {
    let disposed = false;
    if (Array.isArray(material)) disposed = material.includes(segMat);
    else disposed = material === segMat || disposedMaterials.has(segMat);
    if (!disposed) disposeMaterialOnce(segMat, disposedMaterials, 'main:dispose_mesh');
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
    const disposedMaterials = new Set();
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
        disposeMaterialOnce(mat, disposedMaterials, 'main:dispose_tree');
      }
    } else {
      disposeMaterialOnce(material, disposedMaterials, 'main:dispose_tree');
    }
    disposeInfiniteGroundMaterials(userData, material, disposedMaterials, 'main:dispose_tree');
  });
}

export {
  computeGeometryBounds,
  disposeMeshObject,
  disposeObject3DTree,
  getWorldScene,
  renderWorldScene,
};
