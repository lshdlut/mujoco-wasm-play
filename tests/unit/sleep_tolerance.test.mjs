import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { OPTION_LAYOUT, detectOptionSupport, readOptionStruct, writeOptionField } from '../../core/viewer_structs.mjs';

test('Sleep Tol preserves official position, float range and model-owned default', () => {
  const spec = JSON.parse(fs.readFileSync(new URL('../../spec/ui_spec.json', import.meta.url)));
  const items = spec.left_panel.find(section => section.section_id === 'physics').items;
  const index = items.findIndex(item => item.item_id === 'physics.sleep_tolerance');
  assert.equal(items[index - 1].item_id, 'physics.ccd_tolerance');
  assert.equal(items[index + 1].item_id, 'physics.sdf_iterations');
  assert.deepEqual(items[index], { item_id: 'physics.sleep_tolerance', type: 'edit_float', label: 'Sleep Tol', binding: 'mjOption::sleep_tolerance', default: 'model.opt.sleep_tolerance', range: '[0,1]' });
  assert.deepEqual(OPTION_LAYOUT.sleep_tolerance, { type: 'f64', count: 1 });
});

test('generic option access reads the native Sleep Tol value and writes only its float64 slot', () => {
  const heap = new Float64Array(8);
  heap[2] = .125;
  heap[3] = 987;
  const mod = { HEAPF64: heap, _mjwf_model_opt_sleep_tolerance_ptr: handle => { assert.equal(handle, 7); return 16; } };
  assert.equal(readOptionStruct(mod, 7).sleep_tolerance, .125);
  assert.equal(writeOptionField(mod, 7, ['sleep_tolerance'], 'float', .375), true);
  assert.equal(heap[2], .375);
  assert.equal(heap[3], 987);
  assert.deepEqual(detectOptionSupport(mod).pointers, ['_mjwf_model_opt_sleep_tolerance_ptr']);
});

test('missing Sleep Tol native pointer does not fabricate a read or successful write', () => {
  const mod = { HEAPF64: new Float64Array(8), _mjwf_model_opt_ptr: () => 16 };
  assert.equal(readOptionStruct(mod, 7), null);
  assert.equal(writeOptionField(mod, 7, ['sleep_tolerance'], 'float', .375), false);
  assert.equal(detectOptionSupport(mod).pointers.includes('_mjwf_model_opt_sleep_tolerance_ptr'), false);
});
