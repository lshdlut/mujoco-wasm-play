import test from 'node:test';
import assert from 'node:assert/strict';
import { MjSimLite } from '../../bridge/mj_sim_lite.mjs';

test('contact fields gather records using Forge byte stride, not contiguous field width', () => {
  const buffer = new ArrayBuffer(2048);
  const view = new DataView(buffer);
  for (let i = 0; i < 2; i++) {
    view.setInt32(40 + i * 640, i + 7, true);
    view.setFloat64(64 + i * 640, i + 0.5, true);
    view.setFloat64(72 + i * 640, i + 1.5, true);
    view.setFloat64(80 + i * 640, i + 2.5, true);
  }
  const sim = new MjSimLite({ wasmExports: { memory: { buffer } },
    _mjwf_data_ncon: () => 2, _mjwf_data_contact_stride: () => 640,
    _mjwf_data_contact_geom1_ptr: () => 40, _mjwf_data_contact_pos_ptr: () => 64 });
  sim.h = 1;
  assert.deepEqual([...sim.contactGeom1View()], [7, 8]);
  assert.deepEqual([...sim.contactPosView()], [0.5, 1.5, 2.5, 1.5, 2.5, 3.5]);
});
