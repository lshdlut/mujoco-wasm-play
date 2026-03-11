import test from 'node:test';
import assert from 'node:assert/strict';

import { HISTORY_DEFAULT_CAPTURE_HZ, resolveHistorySamplingPlan } from '../../worker/history_sampling.mjs';

test('history sampling defaults to every simulation step when the step rate is known', () => {
  const plan = resolveHistorySamplingPlan(500, 500, HISTORY_DEFAULT_CAPTURE_HZ);
  assert.equal(plan.stepHz, 500);
  assert.equal(plan.captureStepStride, 1);
  assert.equal(plan.captureHz, 500);
});

test('history sampling down-samples by whole-step stride when requested capture rate is lower', () => {
  const plan = resolveHistorySamplingPlan(500, 60, HISTORY_DEFAULT_CAPTURE_HZ);
  assert.equal(plan.captureStepStride, 8);
  assert.equal(plan.captureHz, 62.5);
});

test('history sampling falls back to requested/default capture rate when step rate is unknown', () => {
  const plan = resolveHistorySamplingPlan(0, 24, HISTORY_DEFAULT_CAPTURE_HZ);
  assert.equal(plan.stepHz, 0);
  assert.equal(plan.captureStepStride, 1);
  assert.equal(plan.captureHz, 24);
});
