import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  SCENE_FLAG_DEFAULTS,
  SCENE_FLAG_INDICES,
  VIEWER_GROUP_DEFAULTS,
} from '../../core/viewer_defaults.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..');

async function readSpec() {
  const specPath = path.join(repoRoot, 'spec', 'ui_spec.json');
  return JSON.parse(await readFile(specPath, 'utf8'));
}

function getSection(spec, sectionId) {
  return spec.left_panel.find((section) => section.section_id === sectionId);
}

test('rendering OpenGL flags match MuJoCo 3.5.0 order with Depth at index 7', async () => {
  const spec = await readSpec();
  const rendering = getSection(spec, 'rendering');
  const entries = rendering.trail_groups.find((group) => group.group_id === 'rendering.opengl_flags').entries;
  const names = entries.map((entry) => entry.name);
  assert.equal(entries.length, 11);
  assert.equal(names[SCENE_FLAG_INDICES.DEPTH], 'Depth');
  assert.equal(names[SCENE_FLAG_INDICES.SEGMENT], 'Segment');
  assert.equal(names[SCENE_FLAG_INDICES.ID_COLOR], 'Id Color');
  assert.equal(names[SCENE_FLAG_INDICES.CULL_FACE], 'Cull Face');
  assert.equal(entries[SCENE_FLAG_INDICES.DEPTH].binding, 'mjvScene::flags[7]');
  assert.equal(entries[SCENE_FLAG_INDICES.SEGMENT].binding, 'mjvScene::flags[8]');
  assert.equal(SCENE_FLAG_DEFAULTS.length, 11);
});

test('tracking geom stays explicitly marked as a Play extension', async () => {
  const spec = await readSpec();
  const rendering = getSection(spec, 'rendering');
  const trackingGeom = rendering.items.find((item) => item.item_id === 'rendering.tracking_geom');
  assert.equal(trackingGeom?.binding, 'Simulate::tracking_geom');
  assert.match(String(trackingGeom?.notes ?? ''), /Play extension/i);
});

test('visualization drift labels match upstream MuJoCo text', async () => {
  const spec = await readSpec();
  const visualization = getSection(spec, 'visualization');
  const labels = Object.fromEntries(visualization.items.map((item) => [item.item_id, item.label]));
  assert.equal(labels['visualization.map_stiffness'], 'Stiffness');
  assert.equal(labels['visualization.map_stiffnessrot'], 'Rot stiffness');
  assert.equal(labels['visualization.map_force'], 'Force');
  assert.equal(labels['visualization.map_torque'], 'Torque');
  assert.equal(labels['visualization.map_alpha'], 'Alpha');
  assert.equal(labels['visualization.map_fogstart'], 'Fog start');
  assert.equal(labels['visualization.map_fogend'], 'Fog end');
  assert.equal(labels['visualization.map_zfar'], 'Z far');
  assert.equal(labels['visualization.map_haze'], 'Haze');
  assert.equal(labels['visualization.map_shadowclip'], 'Shadow clip');
  assert.equal(labels['visualization.map_shadowscale'], 'Shadow scale');
  assert.equal(labels['visualization.rgba_actuatornegative'], 'actnegative');
  assert.equal(labels['visualization.rgba_actuatorpositive'], 'actpositive');
});

test('group enable defaults match official viewer defaults', async () => {
  const spec = await readSpec();
  const group = getSection(spec, 'group');
  const expected = [1, 1, 1, 0, 0, 0];
  const groupTypes = ['geom', 'site', 'joint', 'tendon', 'actuator', 'flex', 'skin'];
  for (const type of groupTypes) {
    const defaults = Array.from({ length: 6 }, (_, index) => {
      const item = group.items.find((entry) => entry.item_id === `group.${type}${index}`);
      return item.default;
    });
    assert.deepEqual(defaults, expected);
    assert.deepEqual(VIEWER_GROUP_DEFAULTS[type].map((enabled) => (enabled ? 1 : 0)), expected);
  }
});
