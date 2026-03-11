import test from 'node:test';
import assert from 'node:assert/strict';

import { MjSimLite } from '../../bridge/mj_sim_lite.mjs';

test('scene views re-read volatile scene pointers after scene update', () => {
  const buffer = new ArrayBuffer(64);
  const heapU8 = new Uint8Array(buffer);
  const heapI32 = new Int32Array(buffer);
  heapI32[1] = 2;
  heapI32[2] = 7;
  heapI32[3] = 100;
  heapI32[4] = 103;

  let sceneTypePtr = 4;
  let typePtrCalls = 0;

  const mod = {
    HEAPU8: heapU8,
    wasmExports: { memory: { buffer } },
    _mjwf_scene_ngeom() { return 2; },
    _mjwf_scene_geoms_type_ptr() {
      typePtrCalls += 1;
      return sceneTypePtr;
    },
    _mjwf_scene_update_and_pack() {
      sceneTypePtr = 12;
      return 1;
    },
  };

  const sim = new MjSimLite(mod);
  sim.h = 1;

  assert.deepEqual(Array.from(sim.sceneGeomTypeView()), [2, 7]);
  assert.equal(sim.sceneUpdateAndPack(7), 1);
  assert.deepEqual(Array.from(sim.sceneGeomTypeView()), [100, 103]);
  assert.equal(typePtrCalls, 2);
});

test('_cachedPtr rejects volatile scene pointer exports', () => {
  const sim = new MjSimLite({});
  sim.h = 1;
  assert.throws(
    () => sim._cachedPtr('_mjwf_scene_geoms_type_ptr'),
    /Volatile pointer export must not be cached/,
  );
});
