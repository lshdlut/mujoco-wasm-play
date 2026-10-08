import test from 'node:test';
import assert from 'node:assert/strict';
import { classicLightScale } from '../../renderer/light_compatibility.mjs';

test('classical RGB strength is unchanged for zero, unit and photometric light intensity', () => {
  const diffuse = [.75, .72, .65];
  const ambient = [.1, .2, .3];
  for (const photometric of [0, 1, 1200000]) {
    const scale = classicLightScale(photometric);
    assert.equal(scale, 1);
    assert.deepEqual(diffuse.map(value => value * scale), diffuse);
    assert.deepEqual(ambient.map(value => value * scale), ambient);
  }
});
