import test from 'node:test';
import assert from 'node:assert/strict';
import { cloneLoadPayload } from '../../backend/load_payload.mjs';

test('model replay retains paths and exact subview bytes after Worker transfer', () => {
  const input = { xmlText: '<mujoco/>', xmlPath: '/mem/root/model.xml',
    files: [{ path: '/mem/root/mesh.obj', data: new Uint8Array([9, 1, 2, 8]).subarray(1, 3) }] };
  const retained = cloneLoadPayload(input);
  const outgoing = cloneLoadPayload(retained);
  structuredClone(outgoing, { transfer: [outgoing.files[0].data] });
  assert.equal(outgoing.files[0].data.byteLength, 0);
  const replay = cloneLoadPayload(retained);
  assert.equal(replay.xmlPath, input.xmlPath);
  assert.equal(replay.files[0].path, input.files[0].path);
  assert.deepEqual([...new Uint8Array(replay.files[0].data)], [1, 2]);
  assert.equal(input.files[0].data.byteLength, 2);
});

test('empty model fails before replacing the live Worker', () => {
  assert.throws(() => cloneLoadPayload({ xmlText: ' ' }), /XML is empty/);
});
