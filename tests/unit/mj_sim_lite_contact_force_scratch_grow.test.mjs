import test from 'node:test';
import assert from 'node:assert/strict';

import { MjSimLite } from '../../bridge/mj_sim_lite.mjs';

test('bridge: MjSimLite contactForce scratch view refreshes after WASM heap growth', () => {
  const memory = new WebAssembly.Memory({ initial: 1, maximum: 3, shared: true });
  assert.ok(memory.buffer instanceof SharedArrayBuffer);

  const mod = {
    wasmExports: { memory },
    _malloc: () => 64,
    _free: () => {},
  };

  const sim = new MjSimLite(mod);

  const first = sim._acquireContactForceScratch();
  assert.ok(first?.view);
  const buf0 = first.view.buffer;
  assert.equal(buf0, memory.buffer);

  memory.grow(1);
  const second = sim._acquireContactForceScratch();
  assert.ok(second?.view);
  const buf1 = second.view.buffer;
  assert.equal(buf1, memory.buffer);
  assert.notEqual(buf1, buf0);
});

