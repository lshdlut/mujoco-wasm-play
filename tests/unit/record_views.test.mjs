import test from 'node:test';
import assert from 'node:assert/strict';
import { readRecordScalar, solverRecordCapacity, solverLastRecordIndex } from '../../bridge/record_views.mjs';

test('timer and solver scalar fields advance by C record stride on ST and PT heaps', () => {
  for (const BufferCtor of [ArrayBuffer, SharedArrayBuffer]) {
    const buffer = new BufferCtor(1024);
    const mod = { wasmExports: { memory: { buffer } } };
    const view = new DataView(buffer);
    view.setFloat64(16, 0.5, true);
    view.setFloat64(32, 1.5, true);
    view.setInt32(24, 7, true);
    view.setInt32(40, 11, true);
    view.setFloat64(128 + 3 * 64, 0.125, true);
    assert.equal(readRecordScalar(mod, 16, 1, 16), 1.5);
    assert.equal(readRecordScalar(mod, 24, 1, 16, Int32Array), 11);
    assert.equal(readRecordScalar(mod, 128, 3, 64), 0.125);
    assert.throws(() => readRecordScalar(mod, 16, 1, 0), /Invalid Forge record/);
  }
});

test('generated Forge capacity selects last solver records for two islands beyond iteration 50', () => {
  const capacity = solverRecordCapacity('3.15.0');
  assert.equal(capacity, 200);
  const buffer = new ArrayBuffer(400 * 64 + 16);
  const mod = { wasmExports: { memory: { buffer } } };
  const view = new DataView(buffer);
  for (const [island, iterations, sentinel] of [[0, 73, 0.25], [1, 137, 0.75]]) {
    const index = solverLastRecordIndex(capacity, island, iterations);
    assert.equal(index, island * 200 + iterations - 1);
    view.setFloat64(16 + index * 64, sentinel, true);
    assert.equal(readRecordScalar(mod, 16, index, 64), sentinel);
  }
  assert.equal(solverLastRecordIndex(capacity, 1, 0), -1);
  assert.equal(solverRecordCapacity('unknown'), 0);
});
