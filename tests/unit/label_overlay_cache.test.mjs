import test from 'node:test';
import assert from 'node:assert/strict';

import { getDecodedSceneLabelsCached } from '../../renderer/label_text_cache.mjs';

const LABEL_STRIDE = 100;

function makeSceneLabelBytes(labels) {
  const encoder = new TextEncoder();
  const bytes = new Uint8Array(labels.length * LABEL_STRIDE);
  for (let i = 0; i < labels.length; i += 1) {
    const encoded = encoder.encode(labels[i]);
    bytes.set(encoded.subarray(0, LABEL_STRIDE - 1), i * LABEL_STRIDE);
  }
  return bytes;
}

test('label overlay caches decoded labels while scn_label reference is stable', () => {
  const cacheOwner = {};
  const scnLabel = makeSceneLabelBytes(['pelvis', '', 'knee']);
  const snapshot = { scn_ngeom: 3, scn_label: scnLabel };

  const first = getDecodedSceneLabelsCached(cacheOwner, snapshot);
  const second = getDecodedSceneLabelsCached(cacheOwner, snapshot);

  assert.deepEqual(first, ['pelvis', '', 'knee']);
  assert.equal(second, first);
});

test('label overlay rebuilds decoded labels when scn_label reference changes', () => {
  const cacheOwner = {};
  const firstSnapshot = { scn_ngeom: 2, scn_label: makeSceneLabelBytes(['site_a', 'site_b']) };
  const secondSnapshot = { scn_ngeom: 2, scn_label: makeSceneLabelBytes(['site_a', 'site_c']) };

  const first = getDecodedSceneLabelsCached(cacheOwner, firstSnapshot);
  const second = getDecodedSceneLabelsCached(cacheOwner, secondSnapshot);

  assert.deepEqual(first, ['site_a', 'site_b']);
  assert.deepEqual(second, ['site_a', 'site_c']);
  assert.notEqual(second, first);
});
