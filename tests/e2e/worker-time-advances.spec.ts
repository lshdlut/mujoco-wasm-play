import { expect, test } from '@playwright/test';
import { waitForViewerReady } from './test-utils';

const MODEL = 'mujoco_Rajagopal2015_simple.xml';
const FORGE_BASE = '/dist/3.4.0/';

test('worker simulation time advances', async ({ page }) => {
  const url =
    `/index.html?model=${encodeURIComponent(MODEL)}` +
    `&mode=worker&snapshot=1&log=0` +
    `&forgeBase=${encodeURIComponent(FORGE_BASE)}`;

  await waitForViewerReady(page, url);

  const t0 = await page.evaluate(() => {
    const snap = (window as any).__lastSnapshot ?? null;
    return typeof snap?.t === 'number' ? snap.t : null;
  });
  expect(t0).not.toBeNull();

  await page.waitForTimeout(750);

  const t1 = await page.evaluate(() => {
    const snap = (window as any).__lastSnapshot ?? null;
    return typeof snap?.t === 'number' ? snap.t : null;
  });
  expect(t1).not.toBeNull();
  expect((t1 as number) - (t0 as number)).toBeGreaterThan(1e-3);
});
