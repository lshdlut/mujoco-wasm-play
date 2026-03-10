import { expect, test } from '@playwright/test';
import { waitForViewerReady } from './test-utils';

const MODEL = 'model/mujoco_Rajagopal2015_simple.xml';
const FORGE_BASE = '/dist/3.4.0/';

async function setSliderNormalised(page: any, testId: string, t: number) {
  await page.getByTestId(testId).evaluate((el: any, next: number) => {
    const input = el as HTMLInputElement;
    input.value = String(next);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }, t);
}

test('flex_layer slider updates backend option state', async ({ page }) => {
  const url =
    `/?model=${encodeURIComponent(MODEL)}` +
    `&mode=worker&snapshot=1&log=0` +
    `&forgeBase=${encodeURIComponent(FORGE_BASE)}`;
  await waitForViewerReady(page, url);

  await page.waitForFunction(() => {
    const snap = (window as any).__PLAY_HOST__?.getSnapshot?.();
    return typeof snap?.options?.flex_layer === 'number';
  }, { timeout: 20_000, polling: 250 });

  const before = await page.evaluate(() => {
    const snap = (window as any).__PLAY_HOST__?.getSnapshot?.();
    return {
      snapFlexLayer: snap?.options?.flex_layer ?? null,
    };
  });
  expect(typeof before.snapFlexLayer).toBe('number');

  // ui_spec.json range is [0,10], slider stores a normalised t in [0,1]
  const target = 6;
  const t = target / 10;
  await setSliderNormalised(page, 'rendering.flex_layer', t);

  await page.waitForFunction(
    (v: number) => {
      const snap = (window as any).__PLAY_HOST__?.getSnapshot?.();
      return (snap?.options?.flex_layer | 0) === v;
    },
    target,
    { timeout: 20_000, polling: 250 },
  );
});

