import { test, expect } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { waitForViewerReady } from './test-utils';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const FORGE_BASE = '/dist/3.3.7/';
const MODELS = [
  'horse_17D50M_full.xml',
  'RKOB_full_no_hand_STAR_OSSO.xml',
];

test('multi-model pause/reset/step smoke', async ({ page }) => {
  test.setTimeout(300_000);

  for (const name of MODELS) {
    const url =
      `/?model=${encodeURIComponent(name)}` +
      `&mode=worker&snapshot=1&log=0` +
      `&forgeBase=${encodeURIComponent(FORGE_BASE)}`;
    await waitForViewerReady(page, url);

    await page.keyboard.press('Space');
    await page.waitForFunction(() => {
      const store = (window as any).__viewerStore;
      return store?.get?.()?.simulation?.run === false;
    }, { timeout: 15_000 });

    await page.keyboard.press('Backspace');
    await page.waitForFunction(() => {
      const t = Number((window as any).__lastSnapshot?.t);
      return Number.isFinite(t) && t < 0.5;
    }, { timeout: 30_000 });
    const tReset = await page.evaluate(() => Number((window as any).__lastSnapshot?.t) || 0);
    expect(tReset).toBeLessThanOrEqual(0.5);

    const tBeforeStep = await page.evaluate(() => Number((window as any).__lastSnapshot?.t) || 0);
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(800);
    const tAfterStep = await page.evaluate(() => Number((window as any).__lastSnapshot?.t) || 0);
    expect(tAfterStep).toBeGreaterThanOrEqual(tBeforeStep);
  }
});
