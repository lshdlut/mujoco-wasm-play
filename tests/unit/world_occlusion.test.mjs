import test from 'node:test';
import assert from 'node:assert/strict';

import {
  WORLD_LAYER,
  WORLD_SPECIAL_RENDER_ORDER,
  resolveSceneWorldLayer,
  resolveWorldMaterialState,
  worldItemRenderOrder,
} from '../../renderer/world_occlusion.mjs';

test('resolveSceneWorldLayer classifies infinite ground and alpha-blended geoms consistently', () => {
  assert.equal(resolveSceneWorldLayer({ infinitePlane: true, opacity: 1 }), WORLD_LAYER.WORLD_TRANSPARENT);
  assert.equal(resolveSceneWorldLayer({ infinitePlane: false, opacity: 0.5 }), WORLD_LAYER.WORLD_TRANSPARENT);
  assert.equal(resolveSceneWorldLayer({ infinitePlane: false, opacity: 1 }), WORLD_LAYER.WORLD_OPAQUE);
});

test('resolveWorldMaterialState enforces canonical depth semantics per world layer', () => {
  const opaque = resolveWorldMaterialState(WORLD_LAYER.WORLD_OPAQUE, { opacity: 0.25 });
  assert.equal(opaque.transparent, false);
  assert.equal(opaque.depthTest, true);
  assert.equal(opaque.depthWrite, true);
  assert.equal(opaque.opacity, 1);

  const transparent = resolveWorldMaterialState(WORLD_LAYER.WORLD_TRANSPARENT, { opacity: 0.25 });
  assert.equal(transparent.transparent, true);
  assert.equal(transparent.depthTest, true);
  assert.equal(transparent.depthWrite, false);
  assert.equal(transparent.opacity, 0.25);

  const overlay = resolveWorldMaterialState(WORLD_LAYER.WORLD_OVERLAY, { opacity: 1 });
  assert.equal(overlay.transparent, true);
  assert.equal(overlay.depthTest, true);
  assert.equal(overlay.depthWrite, false);

  const hud = resolveWorldMaterialState(WORLD_LAYER.HUD, { opacity: 1 });
  assert.equal(hud.transparent, true);
  assert.equal(hud.depthTest, false);
  assert.equal(hud.depthWrite, false);
});

test('worldItemRenderOrder keeps ground occluder ahead of visual ground', () => {
  const visual = WORLD_SPECIAL_RENDER_ORDER.groundVisual;
  const occluder = WORLD_SPECIAL_RENDER_ORDER.groundOccluder;
  assert.ok(occluder < visual);
  assert.equal(worldItemRenderOrder(WORLD_LAYER.WORLD_OVERLAY, 0), 10);
});
