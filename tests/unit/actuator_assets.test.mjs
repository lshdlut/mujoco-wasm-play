import test from 'node:test';
import assert from 'node:assert/strict';
import { collectRenderAssetsFromModule } from '../../bridge/render_assets_collect.mjs';
import { controlSlotOwners } from '../../bridge/play_compatibility.mjs';

test('zero-input actuator keeps per-actuator assets while the control slot list is empty', () => {
  const buffer = new ArrayBuffer(128);
  new Int32Array(buffer, 16, 2).set([7, -1]);
  new Int32Array(buffer, 24, 1)[0] = 3;
  new Float64Array(buffer, 32, 1)[0] = 1.75;
  const fields = {
    _mjwf_model_nu: () => 0,
    _mjwf_model_nactuator: () => 1,
    _mjwf_model_actuator_trnid_ptr: () => 16,
    _mjwf_model_actuator_trntype_ptr: () => 24,
    _mjwf_model_actuator_cranklength_ptr: () => 32,
  };
  const mod = new Proxy({ __mujocoVer: '3.15.0', HEAPU8: new Uint8Array(buffer) }, {
    get(target, key) {
      if (key in fields) return fields[key];
      if (typeof key === 'string' && key.startsWith('_mjwf_')) return () => 0;
      return target[key];
    },
  });
  const assets = collectRenderAssetsFromModule(mod, 1);
  assert.equal(assets.actuators.count, 1);
  assert.deepEqual([...assets.actuators.trnid], [7, -1]);
  assert.deepEqual([...assets.actuators.trntype], [3]);
  assert.deepEqual([...assets.actuators.cranklength], [1.75]);
  assert.deepEqual(controlSlotOwners(0, 1, [0], [0]), []);
});
