import { Page, expect, test } from '@playwright/test';
import { waitForViewerReady } from './test-utils';

const MODEL = 'mujoco_Rajagopal2015_simple.xml';
const FORGE_BASE = '/dist/3.4.0/';

async function pauseSimulation(page: Page) {
  await page.evaluate(async () => {
    const controls: any = (window as any).__viewerControls;
    if (!controls?.toggleControl) throw new Error('viewer controls not ready');
    await controls.toggleControl('simulation.run', 0);
  });
  await page.waitForFunction(() => {
    const snapshot = (window as any).__PLAY_HOST__?.getSnapshot?.() ?? null;
    return snapshot?.paused === true;
  }, { timeout: 20_000, polling: 250 });
}

test('transparent strict mode sorts instanced batches by depth', async ({ page }) => {
  const tbins = 1;
  const url =
    `/?model=${encodeURIComponent(MODEL)}` +
    `&mode=worker&snapshot=1&log=0&forceBasic=1` +
    `&tbins=${tbins}&tmode=strict` +
    `&forgeBase=${encodeURIComponent(FORGE_BASE)}`;
  await waitForViewerReady(page, url);
  await pauseSimulation(page);

  const diag = await page.evaluate((wantBins) => {
    const ctx: any = (window as any).__renderCtx;
    const inst: any = ctx?._instancing || null;
    if (!ctx || !inst || !(inst.batches instanceof Map)) return { ok: false, reason: 'instancing not active' };

    let found = 0;
    let checked = 0;
    const bad: any[] = [];

    for (const batch of inst.batches.values()) {
      const mesh = batch?.mesh || null;
      const used = batch?.used | 0;
      if (!mesh || !(used > 1)) continue;
      if (!mesh.material?.transparent) continue;
      const key = String(batch.key || '');
      const m = key.match(/:tb(-?\d+)/);
      const bin = m ? (Number(m[1]) | 0) : -1;
      if (bin < 0) continue;
      found += 1;

      const ro = (Number(mesh.renderOrder) || 0) | 0;
      const orderPart = (ro >> 16) | 0;
      const depthPart = ro & 0xffff;
      const expectedOrder = ((wantBins | 0) - 1 - (bin | 0)) | 0;

      const ranks: any = batch.instanceOrderRank || null;
      const canCheckRanks = ranks && typeof ranks.length === 'number' && ranks.length >= used;
      let monotonic = true;
      if (canCheckRanks) {
        for (let i = 1; i < used; i += 1) {
          if ((ranks[i - 1] | 0) > (ranks[i] | 0)) {
            monotonic = false;
            break;
          }
        }
      } else {
        monotonic = false;
      }

      const ok = orderPart === expectedOrder && monotonic;
      if (!ok && bad.length < 12) {
        bad.push({
          key,
          used,
          ro,
          orderPart,
          depthPart,
          expectedOrder,
          monotonic,
        });
      }

      checked += 1;
      if (checked >= 40) break;
    }

    return { ok: true, found, checked, bad };
  }, tbins);

  expect(diag.ok).toBeTruthy();
  expect(diag.found, diag.reason || '').toBeGreaterThan(0);
  expect(diag.bad, JSON.stringify(diag.bad, null, 2)).toHaveLength(0);
});

