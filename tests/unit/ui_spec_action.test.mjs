import test from 'node:test';
import assert from 'node:assert/strict';

import { DEFAULT_VIEWER_STATE, createViewerStore } from '../../ui/state.mjs';
import { applySpecAction } from '../../ui/viewer_actions.mjs';

function clone(value) {
  return structuredClone(value);
}

test('ui: applySpecAction forwards backend snapshot without merging it into store', async () => {
  const store = createViewerStore(clone(DEFAULT_VIEWER_STATE));
  const expectedSnapshot = {
    t: 0.25,
    ngeom: 7,
    contacts: { n: 1 },
    paused: false,
  };
  const backend = {
    async apply() {
      return expectedSnapshot;
    },
  };
  let receivedSnapshot = null;

  await applySpecAction(
    store,
    backend,
    { item_id: 'test.control', type: 'select' },
    123,
    (snapshot) => {
      receivedSnapshot = snapshot;
    },
  );

  const state = store.get();
  assert.equal(receivedSnapshot, expectedSnapshot);
  assert.equal(state.theme.color, DEFAULT_VIEWER_STATE.theme.color);
  assert.equal(state.panels.right, DEFAULT_VIEWER_STATE.panels.right);
  assert.equal('hud' in state, false);
  assert.equal('simulation' in state, false);
});

test('ui: applySpecAction updates sticky local theme state only for local controls', async () => {
  const runtimeConfig = {
    startup: {
      entryVariant: 'single',
      model: '',
      fallbackMode: 'auto',
      debugMode: false,
      dumpToken: '',
      findToken: '',
      bigN: 8,
      skyOverride: null,
      skyDebugMode: null,
      cacheBustMode: 'none',
      ver: '3.5.0',
      forgeBaseTemplate: '/forge/dist/{ver}/',
      strict: false,
      compat: false,
      logToken: '',
    },
    verboseDebug: false,
    snapshotDebug: false,
    plugins: [],
    ui: {
      embedMode: false,
      themeColor: 0,
      spacing: 0,
      fontIndex: 2,
    },
    timing: {
      uiUpdateIntervalMs: 33,
      uiSlowUpdateIntervalMs: 1000,
      snapshotHzMax: 120,
    },
    rendering: {
      hideAllGeometryDefault: false,
      forceBasic: false,
      instancingEnabled: true,
      transparentBins: 16,
      transparentSortMode: 'strict',
    },
  };
  const previousConfig = globalThis.__PLAY_RUNTIME_CONFIG__;
  globalThis.__PLAY_RUNTIME_CONFIG__ = runtimeConfig;
  try {
    const store = createViewerStore(clone(DEFAULT_VIEWER_STATE));
    const backend = {
      async apply() {
        return null;
      },
    };

    await applySpecAction(store, backend, {
      item_id: 'option.color',
      binding: 'Simulate::color',
      type: 'select',
      options: ['Dark', 'Light'],
    }, 'Light');

    const state = store.get();
    assert.equal(state.theme.color, 1);
    assert.equal(runtimeConfig.ui.themeColor, 1);
  } finally {
    if (previousConfig === undefined) {
      delete globalThis.__PLAY_RUNTIME_CONFIG__;
    } else {
      globalThis.__PLAY_RUNTIME_CONFIG__ = previousConfig;
    }
  }
});
