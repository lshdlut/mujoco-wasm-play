export const HISTORY_DEFAULT_CAPTURE_HZ = 30;

function normaliseHz(value, fallback = 0) {
  const hz = Number(value);
  return Number.isFinite(hz) && hz > 0 ? hz : fallback;
}

export function resolveHistorySamplingPlan(stepHz, requestedCaptureHz, fallbackCaptureHz = HISTORY_DEFAULT_CAPTURE_HZ) {
  const resolvedStepHz = normaliseHz(stepHz, 0);
  const fallbackHz = normaliseHz(fallbackCaptureHz, HISTORY_DEFAULT_CAPTURE_HZ);
  const desiredCaptureHz = normaliseHz(
    requestedCaptureHz,
    resolvedStepHz > 0 ? resolvedStepHz : fallbackHz,
  );

  if (!(resolvedStepHz > 0)) {
    return {
      stepHz: 0,
      captureHz: desiredCaptureHz,
      captureStepStride: 1,
    };
  }

  const targetCaptureHz = Math.min(desiredCaptureHz, resolvedStepHz);
  const captureStepStride = Math.max(1, Math.round(resolvedStepHz / targetCaptureHz));
  const effectiveCaptureHz = resolvedStepHz / captureStepStride;

  return {
    stepHz: resolvedStepHz,
    captureHz: effectiveCaptureHz,
    captureStepStride,
  };
}
