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

export {
  computeGeometryBounds,
  disposeMeshObject,
  disposeObject3DTree,
  getWorldScene,
  renderWorldScene,
};
