import { test, expect } from '@playwright/test';

import { waitForViewerReady } from './test-utils';

const MODEL_URL = '/index.html?model=model/mujoco_Rajagopal2015_simple.xml&mode=worker';

test('ui: kit primitives available (plugin)', async ({ page }) => {
  await page.addInitScript(() => {
    (globalThis as any).PLAY_PLUGINS = [];
  });

  await waitForViewerReady(
    page,
    `${MODEL_URL}&plugins=./plugins/test_ui_sections_plugin.mjs`,
  );

  const sel = page.locator('[data-testid="plugin.test_ui_kit.select"]');
  await expect(sel).toHaveCount(1);
  await expect(sel).toHaveValue('b');

  const seg = page.locator('[data-testid="plugin.test_ui_kit.segmented"]');
  await seg.waitFor({ state: 'attached' });
  await expect(seg).toHaveClass(/segmented/);
  await expect(seg.locator('input[type="radio"]')).toHaveCount(2);

  const ta = page.locator('[data-testid="plugin.test_ui_kit.textarea"]');
  await expect(ta).toHaveCount(1);
  await expect(ta).toHaveClass(/code-textarea/);

  const pre = page.locator('[data-testid="plugin.test_ui_kit.codebox"]');
  await expect(pre).toHaveCount(1);
  await expect(pre).toHaveClass(/codebox/);
  await expect(pre).toContainText('codebox');
});

test('ui: plugin dynamic body clears and rebuilds without stale bindings', async ({ page }) => {
  await page.addInitScript(() => {
    (globalThis as any).PLAY_PLUGINS = [];
  });

  await waitForViewerReady(
    page,
    `${MODEL_URL}&plugins=./plugins/test_ui_sections_plugin.mjs`,
  );

  const toggle = page.locator('[data-testid="plugin.test_ui_dynamic.toggle"]');
  const status = page.locator('[data-testid="plugin.test_ui_dynamic.status"]');
  const item0 = page.locator('[data-testid="plugin.test_ui_dynamic.item.0"]');
  const item1 = page.locator('[data-testid="plugin.test_ui_dynamic.item.1"]');

  await expect(item0).toHaveCount(1);
  await expect(item1).toHaveCount(1);
  await expect(status).toContainText('dynamic body enabled');

  await item0.click();
  await expect(status).toContainText('dynamic click 0:1');

  await toggle.click();
  await expect(item0).toHaveCount(0);
  await expect(item1).toHaveCount(0);
  await expect(status).toContainText('dynamic body disabled');

  await toggle.click();
  await expect(item0).toHaveCount(1);
  await expect(item1).toHaveCount(1);
  await expect(status).toContainText('dynamic body enabled');

  await item1.click();
  await expect(status).toContainText('dynamic click 1:2');
});
