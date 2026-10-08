import test from 'node:test';
import assert from 'node:assert/strict';
import { controlSlotOwners, integrationStateSpec, playCompatibility, readMjtSize } from '../../bridge/play_compatibility.mjs';
import { MjSimLite } from '../../bridge/mj_sim_lite.mjs';

test('control slots preserve scalar indexing and multi-input actuator ownership', () => {
  assert.deepEqual(controlSlotOwners(2, 2).map(x => [x.index, x.actuator, x.input]), [[0, 0, 0], [1, 1, 0]]);
  assert.deepEqual(controlSlotOwners(3, 1, [0], [3]).map(x => [x.index, x.actuator, x.input]), [[0, 0, 0], [1, 0, 1], [2, 0, 2]]);
  const orientation = controlSlotOwners(10, 5, [0, 1, 2, 3, 6], [1, 1, 1, 3, 4]);
  const groups = [0, 1, 2, 3, 5];
  assert.deepEqual(orientation.map(x => groups[x.actuator]), [0, 1, 2, 3, 3, 3, 5, 5, 5, 5]);
  assert.throws(() => controlSlotOwners(3, 2, [0, 0], [2, 1]), /Overlapping/);
  assert.throws(() => controlSlotOwners(3, 1, [0], [2]), /Incomplete/);
  assert.throws(() => controlSlotOwners(3, 1, [2], [3]), /Invalid/);
});

test('generated compatibility follows actual engine identity and native enum support', () => {
  assert.equal(playCompatibility({ __mujocoVer: '3.8.1' }).hasNactuator, false);
  assert.equal(playCompatibility({ __mujocoVer: '3.15.0' }).hasNactuator, true);
  assert.equal(playCompatibility({ __mujocoVer: '3.8.1' }).integrators.length, 4);
  assert.deepEqual(playCompatibility({ __mujocoVer: '3.15.0' }).integrators[4], { name: 'mjINT_DISCRETE', value: 4 });
  assert.throws(() => integrationStateSpec({ __mujocoVer: 'unknown' }), /Unknown native/);
});

test('native state APIs receive full integration mask and retain plugin sentinel (synthetic ABI unit, not real plugin acceptance)', () => {
  for (const version of ['3.8.1', '3.15.0']) {
    const buffer = new ArrayBuffer(512);
    const mod = { __mujocoVer: version, HEAPU8: new Uint8Array(buffer), _malloc: () => 64, _free() {}, _mjwf_mj_forward() {} };
    let sentinel = 123.5;
    const expected = integrationStateSpec(mod);
    assert.ok(expected & 8192, 'official plugin state bit is included');
    mod._mjwf_mj_stateSize = (model, sig) => { assert.equal(model, 16); assert.equal(sig, expected); return 2; };
    mod._mjwf_mj_getState = (model, data, ptr, sig) => { assert.equal(model, 16); assert.equal(data, 32); assert.equal(sig, expected); new Float64Array(buffer, ptr, 2).set([.2, sentinel]); };
    mod._mjwf_mj_setState = (model, data, ptr, sig) => { assert.equal(model, 16); assert.equal(data, 32); assert.equal(sig, expected); sentinel = new Float64Array(buffer, ptr, 2)[1]; };
    const sim = new MjSimLite(mod);
    sim.h = 1; sim.modelPtr = 16; sim.dataPtr = 32;
    const saved = sim.captureState();
    sentinel = 0;
    assert.equal(sim.applyState(saved), true);
    assert.equal(sentinel, 123.5);
  }
});

test('mjtSize HUD reads all 64 bits without signed i32 truncation', () => {
  const buffer = new ArrayBuffer(32);
  const view = new DataView(buffer);
  const mod = { __mujocoVer: '3.15.0', HEAPU8: new Uint8Array(buffer) };
  view.setBigInt64(8, 0x123456789n, true);
  assert.equal(readMjtSize(mod, 8), 0x123456789);
  view.setBigInt64(8, 9007199254740992n, true);
  assert.throws(() => readMjtSize(mod, 8), /safe HUD/);
});

test('id2name and resetCtrl use native model/data pointers, not helper handle', () => {
  const mod = { __mujocoVer: '3.15.0', _mjwf_mj_id2name(model, type, id) { assert.deepEqual([model, type, id], [16, 17, 0]); return 48; },
    _mjwf_mj_resetCtrl(model, data) { assert.deepEqual([model, data], [16, 32]); }, _mjwf_mj_forward() {} };
  const sim = new MjSimLite(mod);
  sim.h = 1; sim.modelPtr = 16; sim.dataPtr = 32; sim._cstr = ptr => ptr === 48 ? 'named equality' : '';
  assert.equal(sim.id2name(17, 0), 'named equality');
  sim.resetCtrl();
});
