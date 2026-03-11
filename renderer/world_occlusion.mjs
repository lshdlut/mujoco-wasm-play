const WORLD_LAYER = Object.freeze({
  WORLD_OPAQUE: 'worldOpaque',
  WORLD_TRANSPARENT: 'worldTransparent',
  WORLD_OVERLAY: 'worldOverlay',
  HUD: 'hud',
});

const WORLD_LAYER_RENDER_ORDER = Object.freeze({
  [WORLD_LAYER.WORLD_OPAQUE]: 0,
  [WORLD_LAYER.WORLD_TRANSPARENT]: 0,
  [WORLD_LAYER.WORLD_OVERLAY]: 10,
  [WORLD_LAYER.HUD]: 998,
});

const WORLD_SPECIAL_RENDER_ORDER = Object.freeze({
  groundOccluder: -100,
  groundVisual: -50,
});

function clampOpacity(value) {
  const v = Number(value);
  if (!Number.isFinite(v)) return 1;
  if (v <= 0) return 0;
  if (v >= 1) return 1;
  return v;
}

function normalizeWorldLayer(layer, fallback = WORLD_LAYER.WORLD_OPAQUE) {
  const raw = String(layer || '').trim();
  if (raw === WORLD_LAYER.WORLD_TRANSPARENT) return WORLD_LAYER.WORLD_TRANSPARENT;
  if (raw === WORLD_LAYER.WORLD_OVERLAY) return WORLD_LAYER.WORLD_OVERLAY;
  if (raw === WORLD_LAYER.HUD) return WORLD_LAYER.HUD;
  if (raw === WORLD_LAYER.WORLD_OPAQUE) return WORLD_LAYER.WORLD_OPAQUE;
  return fallback;
}

function resolveWorldMaterialState(layer, {
  opacity = 1,
  toneMapped = null,
  colorWrite = true,
} = {}) {
  const worldLayer = normalizeWorldLayer(layer);
  const alpha = clampOpacity(opacity);
  switch (worldLayer) {
    case WORLD_LAYER.HUD:
      return {
        layer: worldLayer,
        transparent: true,
        opacity: alpha,
        depthTest: false,
        depthWrite: false,
        toneMapped: toneMapped == null ? false : !!toneMapped,
        colorWrite: !!colorWrite,
      };
    case WORLD_LAYER.WORLD_OVERLAY:
      return {
        layer: worldLayer,
        transparent: true,
        opacity: alpha,
        depthTest: true,
        depthWrite: false,
        toneMapped: toneMapped == null ? true : !!toneMapped,
        colorWrite: !!colorWrite,
      };
    case WORLD_LAYER.WORLD_TRANSPARENT:
      return {
        layer: worldLayer,
        transparent: true,
        opacity: alpha,
        depthTest: true,
        depthWrite: false,
        toneMapped: toneMapped == null ? true : !!toneMapped,
        colorWrite: !!colorWrite,
      };
    case WORLD_LAYER.WORLD_OPAQUE:
    default:
      return {
        layer: WORLD_LAYER.WORLD_OPAQUE,
        transparent: false,
        opacity: 1,
        depthTest: true,
        depthWrite: true,
        toneMapped: toneMapped == null ? true : !!toneMapped,
        colorWrite: !!colorWrite,
      };
  }
}

function applyWorldMaterialState(materialOrArray, layer, options = {}) {
  const state = resolveWorldMaterialState(layer, options);
  const materials = Array.isArray(materialOrArray) ? materialOrArray : [materialOrArray];
  for (const material of materials) {
    if (!material || typeof material !== 'object') continue;
    let changed = false;
    if ('transparent' in material && material.transparent !== state.transparent) {
      material.transparent = state.transparent;
      changed = true;
    }
    if ('opacity' in material && material.opacity !== state.opacity) {
      material.opacity = state.opacity;
      changed = true;
    }
    if ('depthTest' in material && material.depthTest !== state.depthTest) {
      material.depthTest = state.depthTest;
      changed = true;
    }
    if ('depthWrite' in material && material.depthWrite !== state.depthWrite) {
      material.depthWrite = state.depthWrite;
      changed = true;
    }
    if ('colorWrite' in material && material.colorWrite !== state.colorWrite) {
      material.colorWrite = state.colorWrite;
      changed = true;
    }
    if ('toneMapped' in material && material.toneMapped !== state.toneMapped) {
      material.toneMapped = state.toneMapped;
      changed = true;
    }
    if (changed && 'needsUpdate' in material) {
      material.needsUpdate = true;
    }
  }
  return state;
}

function resolveSceneWorldLayer({ infinitePlane = false, opacity = 1 } = {}) {
  if (infinitePlane) return WORLD_LAYER.WORLD_TRANSPARENT;
  return clampOpacity(opacity) < 0.999 ? WORLD_LAYER.WORLD_TRANSPARENT : WORLD_LAYER.WORLD_OPAQUE;
}

function worldLayerRenderOrder(layer) {
  const worldLayer = normalizeWorldLayer(layer);
  return WORLD_LAYER_RENDER_ORDER[worldLayer] ?? 0;
}

function worldItemRenderOrder(layer, localOrder = 0) {
  const local = Number.isFinite(localOrder) ? (localOrder | 0) : 0;
  return (worldLayerRenderOrder(layer) | 0) + local;
}

export {
  WORLD_LAYER,
  WORLD_LAYER_RENDER_ORDER,
  WORLD_SPECIAL_RENDER_ORDER,
  applyWorldMaterialState,
  normalizeWorldLayer,
  resolveSceneWorldLayer,
  resolveWorldMaterialState,
  worldItemRenderOrder,
  worldLayerRenderOrder,
};
