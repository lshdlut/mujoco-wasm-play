import { test, expect } from '@playwright/test';

import { waitForViewerReady } from './test-utils';

test('ui: kit primitives available (plugin)', async ({ page }) => {
  await page.addInitScript(() => {
    (globalThis as any).PLAY_PLUGINS = [];
  });

  await waitForViewerReady(
    page,
    '/index.html?model=demo_box.xml&mode=worker&plugins=./plugins/test_ui_sections_plugin.mjs',
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

