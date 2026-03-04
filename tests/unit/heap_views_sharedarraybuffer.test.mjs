import test from 'node:test';
import assert from 'node:assert/strict';

import { heapViewI32, readCString, resolveHeapBuffer } from '../../bridge/heap_views.mjs';

test('bridge: heap views support SharedArrayBuffer heaps (pthreads)', () => {
  const memory = new WebAssembly.Memory({ initial: 1, maximum: 3, shared: true });
  assert.ok(memory.buffer instanceof SharedArrayBuffer);

  const mod = { wasmExports: { memory } };

  const i32 = new Int32Array(memory.buffer);
  const ptr = 16;
  i32[ptr >> 2] = 42;
  i32[(ptr >> 2) + 1] = -7;
  i32[(ptr >> 2) + 2] = 123456;

  const view = heapViewI32(mod, ptr, 3);
  assert.ok(view instanceof Int32Array);
  assert.deepEqual(Array.from(view), [42, -7, 123456]);

  const cstrPtr = 100;
  const u8 = new Uint8Array(memory.buffer);
  const text = 'hello';
  for (let i = 0; i < text.length; i += 1) {
    u8[cstrPtr + i] = text.charCodeAt(i);
  }
  u8[cstrPtr + text.length] = 0;
  assert.equal(readCString(mod, cstrPtr), 'hello');

  const heapBuf = resolveHeapBuffer(mod);
  assert.ok(heapBuf instanceof SharedArrayBuffer);

  // Memory growth should update resolveHeapBuffer() even if __heapBuffer was cached.
  const before = heapBuf;
  const beforeBytes = before.byteLength;
  memory.grow(1);
  const after = resolveHeapBuffer(mod);
  assert.ok(after instanceof SharedArrayBuffer);
  assert.notEqual(after, before);
  assert.ok(after.byteLength > beforeBytes);

  // Newly grown region must be readable via heap views.
  const newPtr = beforeBytes + 16;
  const i32After = new Int32Array(after);
  i32After[newPtr >> 2] = 99;
  const grownView = heapViewI32(mod, newPtr, 1);
  assert.deepEqual(Array.from(grownView), [99]);
});
