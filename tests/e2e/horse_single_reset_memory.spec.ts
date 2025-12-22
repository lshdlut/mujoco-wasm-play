import { test, expect } from '@playwright/test';
import { waitForViewerReady } from './test-utils';

const MODEL = 'horse_17D50M_full.xml';
const FORGE_BASE = '/dist/3.3.7/';

test('single-horse load -> run -> reset memory behaviour', async ({ page }) => {
  const url =
    `/?model=${encodeURIComponent(MODEL)}` +
    `&mode=worker&snapshot=1&log=0` +
    `&forgeBase=${encodeURIComponent(FORGE_BASE)}`;
  await waitForViewerReady(page, url);

  // Wait a bit for initial horse load.
  await page.waitForTimeout(3000);
  const tInit = await page.evaluate(() => Number((window as any).__lastSnapshot?.t) || 0);

  // Run briefly.
  await page.keyboard.press(' ');
  await page.waitForTimeout(1000);
  const tAfterRun = await page.evaluate(() => Number((window as any).__lastSnapshot?.t) || 0);
  expect(tAfterRun).toBeGreaterThanOrEqual(tInit);

  // UI reset: Backspace.
  await page.keyboard.press('Backspace');
  await page.waitForTimeout(2500);
  const tReset = await page.evaluate(() => Number((window as any).__lastSnapshot?.t) || 0);
  expect(Number.isFinite(tReset)).toBeTruthy();
  expect(tReset).toBeLessThanOrEqual(tInit + 1e-3);
});
