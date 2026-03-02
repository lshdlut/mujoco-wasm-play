import { expect, test } from '@playwright/test';
import { waitForViewerReady } from './test-utils';

const MODEL = 'mujoco_Rajagopal2015_simple.xml';
const FORGE_BASE = '/dist/3.4.0/';

async function pauseSimulation(page: any) {
  await page.evaluate(async () => {
    const controls: any = (window as any).__viewerControls;
    if (!controls?.toggleControl) throw new Error('viewer controls not ready');
    await controls.toggleControl('simulation.run', 0);
  });
  await page.waitForFunction(() => {
    const store: any = (window as any).__viewerStore;
    const state = store?.get ? store.get() : null;
    return state?.simulation?.run === false;
  }, { timeout: 20_000, polling: 250 });
}

test('instanced meshes expose instanceColor in geometry attributes', async ({ page }) => {
  const url =
    `/?model=${encodeURIComponent(MODEL)}` +
    `&mode=worker&snapshot=1&log=0` +
    `&tbins=8&tmode=strict` +
    `&forgeBase=${encodeURIComponent(FORGE_BASE)}`;
  await waitForViewerReady(page, url);
  await pauseSimulation(page);

  const diag = await page.evaluate(() => {
    const MJ_OBJ_SITE = 6;
    const MJ_OBJ_TENDON = 18;
    const ctx: any = (window as any).__renderCtx;
    const inst: any = ctx?._instancing || null;
    if (!ctx || !inst || !(inst.batches instanceof Map)) return { ok: false, reason: 'instancing not active' };

    let batchesUsed = 0;
    let withMeshInstanceColor = 0;
    let withGeomInstanceColor = 0;
    let overlayBatches = 0;
    let overlayWithGeomInstanceColor = 0;
    const samples: any[] = [];

    for (const batch of inst.batches.values()) {
      const mesh = batch?.mesh || null;
      const used = batch?.used | 0;
      if (!mesh || !(used > 0)) continue;
      batchesUsed += 1;
      if (mesh.instanceColor) withMeshInstanceColor += 1;
      const geomAttr = mesh.geometry?.attributes?.instanceColor || null;
      if (geomAttr) withGeomInstanceColor += 1;
      const ot = typeof batch.objType === 'number' ? (batch.objType | 0) : null;
      const overlay = ot === MJ_OBJ_SITE || ot === MJ_OBJ_TENDON;
      if (overlay) {
        overlayBatches += 1;
        if (geomAttr) overlayWithGeomInstanceColor += 1;
      }
      if (samples.length < 12) {
        samples.push({
          key: String(batch.key || ''),
          used,
          objType: ot,
          material: mesh.material?.type || null,
          vertexColors: !!mesh.material?.vertexColors,
          meshHasInstanceColor: !!mesh.instanceColor,
          geomHasInstanceColor: !!geomAttr,
        });
      }
    }
    return {
      ok: true,
      batchesUsed,
      withMeshInstanceColor,
      withGeomInstanceColor,
      overlayBatches,
      overlayWithGeomInstanceColor,
      samples,
    };
  });

  expect(diag.ok).toBeTruthy();
  expect(diag.batchesUsed).toBeGreaterThan(0);
  expect(diag.withMeshInstanceColor).toBe(diag.batchesUsed);
  expect(diag.withGeomInstanceColor, JSON.stringify(diag.samples, null, 2)).toBe(diag.batchesUsed);
  expect(diag.overlayBatches).toBeGreaterThan(0);
  expect(diag.overlayWithGeomInstanceColor, JSON.stringify(diag.samples, null, 2)).toBe(diag.overlayBatches);
});

