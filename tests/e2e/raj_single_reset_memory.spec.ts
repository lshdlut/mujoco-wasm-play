import { test, expect } from '@playwright/test';
import { waitForViewerReady } from './test-utils';

test('single-Raj default -> run -> reset memory behaviour', async ({ page }) => {
  test.setTimeout(180_000);

  const url =
    `/index.html?model=${encodeURIComponent('mujoco_Rajagopal2015_simple.xml')}` +
    `&mode=worker&snapshot=1`;

  await waitForViewerReady(page, url);

  const readTime = async () => {
    return page.evaluate(() => {
      const snap = (window as any).__lastSnapshot;
      const t = Number(snap?.t);
      return Number.isFinite(t) ? t : NaN;
    });
  };

  await page.waitForTimeout(500);
  const init = await readTime();
  // eslint-disable-next-line no-console
  console.log('[raj-single] initial time:', init);

  await page.keyboard.press(' ');
  await page.waitForTimeout(1000);
  const afterRun = await readTime();
  // eslint-disable-next-line no-console
  console.log('[raj-single] after run time:', afterRun);

  await page.keyboard.press('Backspace');
  await page.waitForTimeout(2500);
  const afterReset = await readTime();
  // eslint-disable-next-line no-console
  console.log('[raj-single] after reset time:', afterReset);

  expect(Number.isFinite(afterReset)).toBeTruthy();
  expect(afterRun).toBeGreaterThanOrEqual(init);
  expect(afterReset).toBeLessThanOrEqual(init + 1e-3);
});
