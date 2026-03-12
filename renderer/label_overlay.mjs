import * as THREE from 'three';
import { strictCatch, strictEnsure } from '../core/viewer_runtime.mjs';
import { MJ_LABEL_STRIDE, getDecodedSceneLabelsCached } from './label_text_cache.mjs';

const LABEL_FONT_PX = 12;
const LABEL_TEXT_COLOR = 'rgba(255, 255, 255, 1)';
const LABEL_SHADOW_COLOR = 'rgba(0, 0, 0, 0.5)';
const LABEL_FONT = `${LABEL_FONT_PX}px "Segoe UI", "Helvetica Neue", Arial, sans-serif`;
const __TMP_LABEL_VEC3 = new THREE.Vector3();

function resolveLabelOverlayMount(ctx) {
  return ctx?.overlayRoot || ctx?.renderer?.domElement?.parentElement || null;
}

function ensureLabelOverlay(ctx) {
  if (ctx?.labelOverlay?.canvas && ctx?.labelOverlay?.context2d) {
    return ctx.labelOverlay;
  }
  if (typeof document === 'undefined') return null;
  const mount = resolveLabelOverlayMount(ctx);
  if (!mount || typeof mount.appendChild !== 'function') return null;
  const canvas = document.createElement('canvas');
  canvas.className = 'overlay-labels';
  canvas.setAttribute('data-testid', 'overlay-labels');
  canvas.setAttribute('aria-hidden', 'true');
  const context2d = canvas.getContext('2d');
  if (!context2d) return null;
  mount.appendChild(canvas);
  const overlay = {
    canvas,
    context2d,
    width: 0,
    height: 0,
    dpr: 1,
    drawnCount: 0,
    fontPx: LABEL_FONT_PX,
    sample: null,
    visible: false,
  };
  ctx.labelOverlay = overlay;
  strictEnsure('ensureLabelOverlay', { reason: 'create' });
  return overlay;
}

function syncLabelOverlayViewport(ctx) {
  const overlay = ensureLabelOverlay(ctx);
  if (!overlay) return null;
  const renderCanvas = ctx?.renderer?.domElement || null;
  if (!renderCanvas) return overlay;
  let width = 1;
  let height = 1;
  if (typeof renderCanvas.getBoundingClientRect === 'function') {
    const rect = renderCanvas.getBoundingClientRect();
    width = Math.max(1, Math.floor(rect.width || renderCanvas.width || 1));
    height = Math.max(1, Math.floor(rect.height || renderCanvas.height || 1));
  } else {
    width = Math.max(1, renderCanvas.width || renderCanvas.clientWidth || 1);
    height = Math.max(1, renderCanvas.height || renderCanvas.clientHeight || 1);
  }
  const dpr =
    (ctx?.renderer && typeof ctx.renderer.getPixelRatio === 'function')
      ? Math.max(1, Number(ctx.renderer.getPixelRatio()) || 1)
      : (typeof window !== 'undefined' ? Math.min(window.devicePixelRatio || 1, 2) : 1);
  const pixelWidth = Math.max(1, Math.round(width * dpr));
  const pixelHeight = Math.max(1, Math.round(height * dpr));
  if (overlay.canvas.width !== pixelWidth) overlay.canvas.width = pixelWidth;
  if (overlay.canvas.height !== pixelHeight) overlay.canvas.height = pixelHeight;
  overlay.canvas.style.width = `${width}px`;
  overlay.canvas.style.height = `${height}px`;
  overlay.width = width;
  overlay.height = height;
  overlay.dpr = dpr;
  return overlay;
}

function clearLabelOverlay(ctx) {
  const overlay = syncLabelOverlayViewport(ctx);
  if (!overlay) return;
  const { context2d, width, height, dpr } = overlay;
  context2d.setTransform(dpr, 0, 0, dpr, 0, 0);
  context2d.clearRect(0, 0, width, height);
  overlay.drawnCount = 0;
  overlay.fontPx = LABEL_FONT_PX;
  overlay.sample = null;
  overlay.visible = false;
}

function renderLabelOverlay(ctx, snapshot, state, options = {}) {
  const overlay = syncLabelOverlayViewport(ctx);
  if (!overlay || !ctx?.camera) return;
  const { context2d, width, height, dpr } = overlay;
  context2d.setTransform(dpr, 0, 0, dpr, 0, 0);
  context2d.clearRect(0, 0, width, height);
  overlay.drawnCount = 0;
  overlay.fontPx = LABEL_FONT_PX;
  overlay.sample = null;
  overlay.visible = false;

  const scnNgeom = snapshot?.scn_ngeom | 0;
  const labelBytes = snapshot?.scn_label || null;
  const posView = snapshot?.scn_pos || null;
  if (!(scnNgeom > 0) || !labelBytes || !posView) return;
  if (labelBytes.length < scnNgeom * MJ_LABEL_STRIDE || posView.length < scnNgeom * 3) return;
  if (!!options.hideAllGeometry || !!state?.rendering?.hideAllGeometry) return;
  const decodedLabels = getDecodedSceneLabelsCached(overlay, snapshot);
  if (!decodedLabels) return;

  context2d.font = LABEL_FONT;
  context2d.textAlign = 'left';
  context2d.textBaseline = 'alphabetic';
  context2d.fillStyle = LABEL_TEXT_COLOR;
  context2d.shadowColor = LABEL_SHADOW_COLOR;
  context2d.shadowBlur = 0;
  context2d.shadowOffsetX = 1;
  context2d.shadowOffsetY = 1;

  let sample = null;
  let drawnCount = 0;
  const camera = ctx.camera;
  for (let si = 0; si < scnNgeom; si += 1) {
    const text = decodedLabels[si];
    if (!text) continue;
    const pbase = si * 3;
    const px = Number(posView[pbase + 0]);
    const py = Number(posView[pbase + 1]);
    const pz = Number(posView[pbase + 2]);
    if (!Number.isFinite(px) || !Number.isFinite(py) || !Number.isFinite(pz)) continue;

    const projected = __TMP_LABEL_VEC3.set(px, py, pz).project(camera);
    if (!Number.isFinite(projected.x) || !Number.isFinite(projected.y) || !Number.isFinite(projected.z)) continue;
    if (projected.z < -1 || projected.z > 1) continue;

    const screenX = (projected.x * 0.5 + 0.5) * width;
    const screenY = (-projected.y * 0.5 + 0.5) * height;
    context2d.fillText(text, screenX, screenY);
    drawnCount += 1;
    if (!sample) {
      sample = {
        text,
        anchorWorld: [px, py, pz],
        screen: [screenX, screenY],
        ndc: [projected.x, projected.y, projected.z],
        sourceIndex: si,
      };
    }
  }

  overlay.drawnCount = drawnCount;
  overlay.sample = sample;
  overlay.visible = drawnCount > 0;
}

function disposeLabelOverlay(ctx) {
  const overlay = ctx?.labelOverlay || null;
  if (!overlay) return;
  if (overlay.canvas?.parentNode) {
    try {
      overlay.canvas.parentNode.removeChild(overlay.canvas);
    } catch (err) {
      strictCatch(err, 'main:labelOverlay_dispose');
    }
  }
  ctx.labelOverlay = null;
}

export {
  clearLabelOverlay,
  disposeLabelOverlay,
  renderLabelOverlay,
  syncLabelOverlayViewport,
};
