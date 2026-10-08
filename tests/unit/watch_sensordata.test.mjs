import test from 'node:test';
import assert from 'node:assert/strict';
import { MjSimLite } from '../../bridge/mj_sim_lite.mjs';
import { applyWatchPayload } from '../../backend/snapshot_utils.mjs';

test('sensor views resolve the current heap after memory growth, without caching a typed array', () => {
  let pointerCalls = 0;
  const mod = { wasmExports: { memory: new WebAssembly.Memory({ initial: 1 }) }, _mjwf_model_nsensordata: () => 1, _mjwf_data_sensordata_ptr: () => { pointerCalls++; return 8; } };
  const sim = new MjSimLite(mod);sim.h = 1;
  new Float64Array(mod.wasmExports.memory.buffer)[1] = .375;
  const first = sim.sensordataView();
  assert.equal(first[0], .375);
  mod.wasmExports.memory.grow(1);
  new Float64Array(mod.wasmExports.memory.buffer)[1] = .625;
  const next = sim.sensordataView();
  assert.equal(next[0], .625);
  assert.notEqual(next.buffer, first.buffer);
  assert.equal(first.buffer.byteLength, 0);
  assert.equal(pointerCalls, 1);
});

test('sensor pointer/count caches follow a new model handle and zero dimensions', () => {
  const mod = { HEAPF64: new Float64Array(16), _mjwf_model_nsensordata: handle => handle === 1 ? 1 : handle === 2 ? 2 : 0, _mjwf_data_sensordata_ptr: handle => handle === 1 ? 8 : 32 };
  mod.HEAPF64.set([.375], 1);mod.HEAPF64.set([.625, -.125], 4);
  const sim = new MjSimLite(mod);sim.h = 1;
  assert.deepEqual(Array.from(sim.sensordataView()), [.375]);
  sim.h = 2;
  assert.deepEqual(Array.from(sim.sensordataView()), [.625, -.125]);
  sim.h = 3;
  assert.equal(sim.sensordataView(), undefined);
  sim.h = 0;
  assert.equal(sim.sensordataView(), undefined);
});

test('missing sensor export does not fabricate a zero reading', () => {
  const sim = new MjSimLite({ HEAPF64: new Float64Array(8), _mjwf_model_nsensordata: () => 1 });sim.h = 1;
  assert.equal(sim.sensordataView(), undefined);
});

test('Watch preserves missing value/extrema as null while retaining a valid numeric zero', () => {
  const target = {};
  applyWatchPayload(target, { field: 'sensordata', index: 5, value: null, min: null, max: null, valid: false, status: 'invalid' }, { computeSummary: true });
  assert.deepEqual([target.watch.value, target.watch.min, target.watch.max], [null, null, null]);
  assert.equal(target.watch.summary, '—');
  applyWatchPayload(target, { value: 0, min: 0, max: 0, valid: true, status: 'ok' }, { computeSummary: true });
  assert.deepEqual([target.watch.value, target.watch.min, target.watch.max], [0, 0, 0]);
  assert.equal(target.watch.summary, '0.00000');
});
