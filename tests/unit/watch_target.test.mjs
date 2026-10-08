import test from 'node:test';
import assert from 'node:assert/strict';
import { createBackendRuntime } from '../../backend/backend_runtime.mjs';
import { resolveWatchTargetPatch } from '../../core/watch_target.mjs';
import { encodeCommand, decodeCommand } from '../../worker/dispatch.gen.mjs';

for (const order of [['watch.index', 'watch.field'], ['watch.field', 'watch.index']]) {
  test(`rapid Watch edits preserve both components with a stale snapshot: ${order.join(' -> ')}`, async () => {
    const messages = [];
    const snapshot = { watch: { field: 'qpos', index: 0 } };
    const runtime = createBackendRuntime({
      clientRef: { current: { postMessage: message => messages.push(message) } },
      lastSnapshotRef: { current: snapshot }, lastLoadPayloadRef: { current: null },
      readPublishedSnapshot: () => snapshot, publishMutation: () => snapshot,
    });
    for (const id of order) {
      await runtime.apply({ kind: 'ui', id, value: id === 'watch.index' ? 1 : 'sensordata' });
    }
    assert.deepEqual(snapshot.watch, { field: 'qpos', index: 0 }, 'Worker publications deliberately remain delayed');
    let target = { field: 'qpos', index: 0 };
    for (const message of messages) {
      const { cmd, ...payload } = message;
      const decoded = decodeCommand(encodeCommand(cmd, payload));
      target = resolveWatchTargetPatch(target, decoded.payload);
    }
    assert.deepEqual(target, { field: 'sensordata', index: 1 });
    assert.deepEqual(messages.find(message => Object.hasOwn(message, 'index')), { cmd: 'setWatch', index: 1 });
    assert.deepEqual(messages.find(message => Object.hasOwn(message, 'field')), { cmd: 'setWatch', field: 'sensordata' });
  });
}

test('Watch full legacy payload still replaces both target components', () => {
  const decoded = decodeCommand(encodeCommand('setWatch', { field: 'sensordata', index: 2 }));
  assert.deepEqual(resolveWatchTargetPatch({ field: 'qpos', index: 0 }, decoded.payload), { field: 'sensordata', index: 2 });
});

test('Watch partial normalization preserves omitted components and explicit zero', () => {
  const current = { field: 'qpos', index: 7 };
  assert.deepEqual(resolveWatchTargetPatch(current, { field: ' sensordata ' }), { field: 'sensordata', index: 7 });
  assert.deepEqual(resolveWatchTargetPatch(current, { index: '2.75' }), { field: 'qpos', index: 2 });
  assert.deepEqual(resolveWatchTargetPatch(current, { index: 0 }), { field: 'qpos', index: 0 });
  assert.deepEqual(resolveWatchTargetPatch(current, { index: -1 }), { field: 'qpos', index: 0 });
  assert.equal(resolveWatchTargetPatch(current, {}), null);
  assert.deepEqual(current, { field: 'qpos', index: 7 });
});

test('Watch explicit null/invalid values preserve legacy normalization, distinct from omission', () => {
  for (const index of [null, undefined, false, '', ' ', 'bad', NaN, Infinity, 2147483648]) {
    assert.deepEqual(resolveWatchTargetPatch({ field: 'qpos', index: 7 }, { index }), { field: 'qpos', index: 0 });
  }
  assert.deepEqual(resolveWatchTargetPatch({ field: 'qpos', index: 7 }, { index: -2147483649 }), { field: 'qpos', index: 2147483647 });
  for (const field of [null, undefined, false]) {
    assert.deepEqual(resolveWatchTargetPatch({ field: 'qpos', index: 7 }, { field }), { field: 'qpos', index: 7 });
  }
  assert.deepEqual(resolveWatchTargetPatch({ field: 'qpos', index: 7 }, { field: ' ' }), { field: '', index: 7 });
});
