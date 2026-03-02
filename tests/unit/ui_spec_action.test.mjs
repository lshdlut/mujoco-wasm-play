import test from 'node:test';
import assert from 'node:assert/strict';

import { DEFAULT_VIEWER_STATE, applySpecAction, createViewerStore } from '../../ui/state.mjs';

test('ui: applySpecAction calls backend.apply and merges snapshot', async () => {
  const store = createViewerStore(DEFAULT_VIEWER_STATE);
  const backend = {
    async apply() {
      return { t: 0, ngeom: 7, contacts: { n: 1 }, paused: false, pausedSource: 'test', rateSource: 'test' };
    },
  };

  await applySpecAction(store, backend, { item_id: 'test.control', type: 'select' }, 123);
  const state = store.get();

  assert.equal(state.hud.time, 0);
  assert.equal(state.hud.ngeom, 7);
  assert.equal(state.hud.contacts, 1);
  assert.equal(state.simulation.run, true);
});
