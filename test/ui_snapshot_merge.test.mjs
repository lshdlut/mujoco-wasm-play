import test from 'node:test';
import assert from 'node:assert/strict';

import { DEFAULT_VIEWER_STATE, createViewerStore, mergeBackendSnapshot } from '../dev/main_ui.mjs';

function clone(value) {
  return structuredClone(value);
}

test('ui: mergeBackendSnapshot applies basic HUD + runtime fields', () => {
  // Reset module-level time tracking.
  createViewerStore(DEFAULT_VIEWER_STATE);

  const draft = clone(DEFAULT_VIEWER_STATE);
  const snapshot = {
    t: 0,
    rate: 1,
    measuredSlowdown: 0.5,
    ngeom: 10,
    contacts: { n: 2 },
    paused: false,
    pausedSource: 'test',
    rateSource: 'test',
    gesture: { mode: 'rotate', phase: 'update', pointer: { x: 1, y: 2, dx: 3, dy: 4, buttons: 1, pressure: 0.25 } },
    drag: { dx: 0.1, dy: -0.2 },
  };

  mergeBackendSnapshot(draft, snapshot);

  assert.equal(draft.hud.time, 0);
  assert.equal(draft.hud.rate, 1);
  assert.equal(draft.hud.measuredSlowdown, 0.5);
  assert.equal(draft.hud.ngeom, 10);
  assert.equal(draft.hud.contacts, 2);
  assert.equal(draft.hud.pausedSource, 'test');
  assert.equal(draft.hud.rateSource, 'test');
  assert.equal(draft.simulation.run, true);
  assert.deepEqual(draft.runtime.gesture, {
    mode: 'rotate',
    phase: 'update',
    pointer: { x: 1, y: 2, dx: 3, dy: 4, buttons: 1, pressure: 0.25 },
  });
  assert.deepEqual(draft.runtime.drag, { dx: 0.1, dy: -0.2 });
});

test('ui: mergeBackendSnapshot is stable for identical snapshots', () => {
  createViewerStore(DEFAULT_VIEWER_STATE);

  const draft = clone(DEFAULT_VIEWER_STATE);
  const snapshot = {
    t: 0,
    rate: 1,
    ngeom: 3,
    contacts: { n: 0 },
    paused: true,
    pausedSource: 'test',
    rateSource: 'test',
  };

  mergeBackendSnapshot(draft, snapshot);
  const a = clone({
    hud: draft.hud,
    simulation: draft.simulation,
    runtime: draft.runtime,
  });

  mergeBackendSnapshot(draft, snapshot);
  const b = clone({
    hud: draft.hud,
    simulation: draft.simulation,
    runtime: draft.runtime,
  });

  assert.deepEqual(a, b);
});

