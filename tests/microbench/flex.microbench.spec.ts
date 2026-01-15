import { test, Page } from '@playwright/test';
import { waitForViewerReady } from '../e2e/test-utils';

type SampleStatsEntry = {
  n: number;
  min?: number;
  max?: number;
  mean?: number;
  p50?: number;
  p90?: number;
  p95?: number;
  p99?: number;
};

type PerfSummary = {
  enabled?: boolean;
  sampleStats?: Record<string, SampleStatsEntry>;
  phases?: Record<string, number | null>;
} | null;

function pickStat(summary: PerfSummary, key: string): SampleStatsEntry {
  const entry = summary?.sampleStats?.[key];
  if (entry && typeof entry === 'object' && typeof entry.n === 'number') return entry;
  return { n: 0 };
}

function extractTopMs(summary: PerfSummary, { limit = 15, minMeanMs = 0.25 } = {}) {
  const stats = summary?.sampleStats;
  if (!stats) return [];
  const entries = Object.entries(stats)
    .filter(([bucket, entry]) => bucket.endsWith('_ms') && entry && typeof entry.mean === 'number' && entry.n > 0)
    .map(([bucket, entry]) => ({ bucket, ...entry }))
    .filter((entry) => typeof entry.mean === 'number' && entry.mean >= minMeanMs)
    .sort((a, b) => (b.mean ?? 0) - (a.mean ?? 0));
  return entries.slice(0, limit);
}

function meanFpsFromInterval(stat: SampleStatsEntry): number | null {
  const meanMs = typeof stat.mean === 'number' ? stat.mean : null;
  if (!meanMs || !(meanMs > 0)) return null;
  return 1000 / meanMs;
}

async function clearPerfSamples(page: Page) {
  await page.evaluate(() => {
    const clear = (globalThis as any).__PLAY_PERF_CLEAR_SAMPLES;
    if (typeof clear !== 'function') throw new Error('__PLAY_PERF_CLEAR_SAMPLES missing (open with ?log=1)');
    clear();
  });
}

async function readPerfSummary(page: Page): Promise<PerfSummary> {
  return page.evaluate(() => {
    const summaryFn = (globalThis as any).__PLAY_PERF_SUMMARY;
    if (typeof summaryFn !== 'function') throw new Error('__PLAY_PERF_SUMMARY missing (open with ?log=1)');
    return summaryFn();
  });
}

async function ensureSimRunning(page: Page) {
  await page.evaluate(async () => {
    const store = (window as any).__viewerStore;
    const controls = (window as any).__viewerControls;
    if (!store?.get || !controls?.toggleControl) throw new Error('viewer controls missing');
    const state = store.get();
    if (!state?.simulation?.run) {
      await controls.toggleControl('simulation.run', true);
    }
  });
}

async function minimizeUi(page: Page) {
  await page.evaluate(() => {
    const store = (window as any).__viewerStore;
    if (!store?.update) throw new Error('viewer store missing');
    store.update((draft: any) => {
      if (!draft.panels) draft.panels = {};
      draft.panels.left = false;
      draft.panels.right = false;
      if (!draft.overlays) draft.overlays = {};
      draft.overlays.help = false;
      draft.overlays.info = false;
      draft.overlays.profiler = false;
      draft.overlays.sensor = false;
    });
  });
}

async function rotateCameraFor(page: Page, durationMs: number) {
  const canvas = page.locator('[data-testid="viewer-canvas"]');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('viewer canvas not found');
  const centerX = box.x + box.width / 2;
  const centerY = box.y + box.height / 2;

  await canvas.click({ position: { x: 10, y: 10 } });
  await page.mouse.move(centerX, centerY);
  await page.mouse.down({ button: 'left' });
  const startWallMs = Date.now();
  const stepMs = 16;
  const radiusX = Math.max(40, Math.min(140, box.width * 0.25));
  const radiusY = Math.max(20, Math.min(100, box.height * 0.15));
  let step = 0;
  while (Date.now() - startWallMs < durationMs) {
    const phase = (step * stepMs) / 1000;
    const dx = Math.cos(phase * 2.2) * radiusX;
    const dy = Math.sin(phase * 1.7) * radiusY;
    await page.mouse.move(centerX + dx, centerY + dy);
    await page.waitForTimeout(stepMs);
    step += 1;
  }
  await page.mouse.up({ button: 'left' });
}

test('microbench: flex snapshot vs render (idle/rotate)', async ({ page }) => {
  test.setTimeout(600_000);

  const model = process.env.PLAY_MODEL ?? 'model/flex/flag.xml';
  const durationMsRaw = process.env.PLAY_DURATION_MS;
  const durationMsParsed = durationMsRaw ? Number.parseInt(String(durationMsRaw), 10) : NaN;
  const durationMs = Number.isFinite(durationMsParsed) && durationMsParsed > 0 ? durationMsParsed : 4000;

  const url = `/index.html?log=1&model=${encodeURIComponent(model)}`;
  await waitForViewerReady(page, url, { timeoutMs: 300_000 });
  await ensureSimRunning(page);
  await page.waitForTimeout(1500);

  const extract = (summary: PerfSummary) => ({
    backend_adaptive_snapshot_hz: pickStat(summary, 'backend:adaptive_snapshot_hz'),
    backend_listeners_count: pickStat(summary, 'backend:listeners_count'),
    backend_listener_ms: pickStat(summary, 'backend:listener_ms'),
    worker_to_main_probe_recv_interval_ms: pickStat(summary, 'worker_to_main:probe_recv_interval_ms'),
    worker_to_main_probe_transfer_ms: pickStat(summary, 'worker_to_main:probe_transfer_ms'),
    worker_to_main_snapshot_recv_interval_ms: pickStat(summary, 'worker_to_main:snapshot_recv_interval_ms'),
    snapshot_fps_estimate: meanFpsFromInterval(pickStat(summary, 'worker_to_main:snapshot_recv_interval_ms')),
    worker_snapshot_sent_interval_ms: pickStat(summary, 'worker:snapshot_sent_interval_ms'),
    snapshot_sent_fps_estimate: meanFpsFromInterval(pickStat(summary, 'worker:snapshot_sent_interval_ms')),
    worker_snapshot_ms: pickStat(summary, 'worker:snapshot_ms'),
    worker_snapshot_scene_pack_ms: pickStat(summary, 'worker:snapshot_scene_pack_ms'),
    worker_snapshot_copy_scene_ms: pickStat(summary, 'worker:snapshot_copy_scene_ms'),
    worker_snapshot_copy_flex_ms: pickStat(summary, 'worker:snapshot_copy_flex_ms'),
    worker_snapshot_post_message_prev_ms: pickStat(summary, 'worker:snapshot_post_message_prev_ms'),
    worker_snapshot_scene_bytes: pickStat(summary, 'worker:snapshot_scene_bytes'),
    worker_snapshot_flex_bytes: pickStat(summary, 'worker:snapshot_flex_bytes'),
    worker_snapshot_transfer_bytes: pickStat(summary, 'worker:snapshot_transfer_bytes'),
    worker_snapshot_transfer_buffers: pickStat(summary, 'worker:snapshot_transfer_buffers'),
    worker_step_tick_ms: pickStat(summary, 'worker:step_tick_ms'),
    worker_step_tick_steps: pickStat(summary, 'worker:step_tick_steps'),
    worker_step_sim_ms_per_step: pickStat(summary, 'worker:step_sim_ms_per_step'),
    worker_step_history_ms_per_step: pickStat(summary, 'worker:step_history_ms_per_step'),
    worker_step_perturb_ms_per_step: pickStat(summary, 'worker:step_perturb_ms_per_step'),
    worker_step_other_ms_per_step: pickStat(summary, 'worker:step_other_ms_per_step'),
    worker_ncon: pickStat(summary, 'worker:ncon'),
    worker_nefc: pickStat(summary, 'worker:nefc'),
    worker_nisland: pickStat(summary, 'worker:nisland'),
    worker_to_main_snapshot_transfer_ms: pickStat(summary, 'worker_to_main:snapshot_transfer_ms'),
    worker_to_main_snapshot_queue_after_post_ms: pickStat(summary, 'worker_to_main:snapshot_queue_after_post_ms'),
    backend_snapshot_decode_ms: pickStat(summary, 'backend:snapshot_decode_ms'),
    backend_notifyListeners_ms: pickStat(summary, 'backend:notifyListeners_ms'),
    main_mergeBackendSnapshot_ms: pickStat(summary, 'main:mergeBackendSnapshot_ms'),
    main_store_update_ms: pickStat(summary, 'main:store_update_ms'),
    main_store_subscriber_ms: pickStat(summary, 'main:store_subscriber_ms'),
    main_subscriber_scheduleRenderScene_ms: pickStat(summary, 'main:subscriber_scheduleRenderScene_ms'),
    main_subscriber_updateOverlays_ms: pickStat(summary, 'main:subscriber_updateOverlays_ms'),
    main_subscriber_updateRealtimeOverlay_ms: pickStat(summary, 'main:subscriber_updateRealtimeOverlay_ms'),
    main_subscriber_updatePanels_ms: pickStat(summary, 'main:subscriber_updatePanels_ms'),
    main_subscriber_queueResizeCanvas_ms: pickStat(summary, 'main:subscriber_queueResizeCanvas_ms'),
    main_subscriber_scheduleUiUpdate_ms: pickStat(summary, 'main:subscriber_scheduleUiUpdate_ms'),
    main_subscriber_ensureActuatorSliders_ms: pickStat(summary, 'main:subscriber_ensureActuatorSliders_ms'),
    main_subscriber_deriveJointDofs_ms: pickStat(summary, 'main:subscriber_deriveJointDofs_ms'),
    main_subscriber_ensureJointSliders_ms: pickStat(summary, 'main:subscriber_ensureJointSliders_ms'),
    main_subscriber_deriveEqualityList_ms: pickStat(summary, 'main:subscriber_deriveEqualityList_ms'),
    main_subscriber_ensureEqualityToggles_ms: pickStat(summary, 'main:subscriber_ensureEqualityToggles_ms'),
    main_raf_renderScene_ms: pickStat(summary, 'main:raf_renderScene_ms'),
    renderer_apply_scene_soa_ms: pickStat(summary, 'renderer:apply_scene_soa_ms'),
    renderer_transparent_sort_ms: pickStat(summary, 'renderer:transparent_sort_ms'),
    renderer_draw_ms: pickStat(summary, 'renderer:draw_ms'),
    renderer_draw_triangles: pickStat(summary, 'renderer:draw_triangles'),
    top_ms_buckets: extractTopMs(summary),
  });

  async function runPhase(label: string, action: () => Promise<void>) {
    await clearPerfSamples(page);
    await action();
    const summary = await readPerfSummary(page);
    // eslint-disable-next-line no-console
    console.log(`[flex-microbench][${label}][${model}]`, JSON.stringify(extract(summary), null, 2));
  }

  await runPhase('baseline:idle', async () => {
    await page.waitForTimeout(durationMs);
  });
  await runPhase('baseline:rotate', async () => {
    await rotateCameraFor(page, durationMs);
  });

  await minimizeUi(page);
  await page.waitForTimeout(250);

  await runPhase('ui_min:idle', async () => {
    await page.waitForTimeout(durationMs);
  });
  await runPhase('ui_min:rotate', async () => {
    await rotateCameraFor(page, durationMs);
  });
});
