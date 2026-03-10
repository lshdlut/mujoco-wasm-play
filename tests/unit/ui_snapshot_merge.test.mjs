import test from 'node:test';
import assert from 'node:assert/strict';

import { DEFAULT_VIEWER_STATE, createViewerStore, mergeBackendSnapshot } from '../../ui/state.mjs';

function clone(value) {
  return structuredClone(value);
}

test('ui: mergeBackendSnapshot only clamps tracking geom against current snapshot geoms', () => {
  createViewerStore(clone(DEFAULT_VIEWER_STATE));

  const draft = clone(DEFAULT_VIEWER_STATE);
  draft.runtime.trackingGeom = 8;
  const snapshot = {
    geoms: [
      { index: 0, name: 'g0' },
      { index: 1, name: 'g1' },
      { index: 2, name: 'g2' },
    ],
  };

  mergeBackendSnapshot(draft, snapshot);

  assert.equal(draft.runtime.trackingGeom, 2);
  assert.equal(draft.theme.color, DEFAULT_VIEWER_STATE.theme.color);
  assert.equal(draft.panels.left, DEFAULT_VIEWER_STATE.panels.left);
  assert.equal('simulation' in draft, false);
  assert.equal('hud' in draft, false);
});

test('ui: mergeBackendSnapshot clears tracking geom when snapshot geom metadata disappears', () => {
  createViewerStore(clone(DEFAULT_VIEWER_STATE));

  const draft = clone(DEFAULT_VIEWER_STATE);
  draft.runtime.trackingGeom = 3;

  mergeBackendSnapshot(draft, { geoms: [] });
  assert.equal(draft.runtime.trackingGeom, -1);
});
