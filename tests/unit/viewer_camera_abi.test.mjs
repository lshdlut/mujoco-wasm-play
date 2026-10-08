import test from 'node:test';
import assert from 'node:assert/strict';
import { createMoveCameraAdapter } from '../../bridge/viewer_camera_abi.mjs';

test('native camera adapter passes the camera pointer in the correct ABI position', () => {
  for (const [version, expected] of [
    ['3.8.1', [111, 5, .1, .2, 222, 333]],
    ['3.10.0', [111, 5, .1, .2, 222, 333]],
    ['3.11.0', [111, 5, .1, .2, 333]],
    ['3.15.0', [111, 5, .1, .2, 333]],
  ]) {
    const mod = { __mujocoVer: version, _mjwf_mjv_moveCamera(...args) {
      assert.equal(this, mod);
      assert.deepEqual(args, expected);
    } };
    createMoveCameraAdapter(mod)(111, 5, .1, .2, 222, 333);
  }
});

test('camera adapter rejects unknown metadata or missing native export', () => {
  assert.throws(() => createMoveCameraAdapter({ __mujocoVer: 'unknown' }), /Unknown mjv_moveCamera ABI/);
  assert.throws(() => createMoveCameraAdapter({ __mujocoVer: '3.15.0' }), /Missing Forge/);
});
