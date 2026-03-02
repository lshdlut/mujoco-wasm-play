import { test, expect } from '@playwright/test';

import { waitForViewerReady } from './test-utils';

test('ui: default_open honored + persisted collapse state wins', async ({ page }) => {
  await page.addInitScript(() => {
    // Ensure no locally-configured default plugins interfere with baseline UI tests.
    (globalThis as any).PLAY_PLUGINS = [];
  });
  const url = '/index.html?model=demo_box.xml&mode=worker';
  await waitForViewerReady(page, url);

  const joint = page.locator('[data-play-section-id="joint"]');
  await joint.waitFor({ state: 'attached' });

  // right_panel/joint has default_open=false in ui_spec.json
  await expect(joint).toHaveClass(/is-collapsed/);

  await joint.locator('[data-play-role="section-toggle"]').click();
  await expect(joint).not.toHaveClass(/is-collapsed/);

  // Reload: persisted state should override default_open.
  await waitForViewerReady(page, url);
  await expect(joint).not.toHaveClass(/is-collapsed/);
});

test('ui: plugin section inserted after File + dblclick toggles all (left panel)', async ({ page }) => {
  await page.addInitScript(() => {
    (globalThis as any).PLAY_PLUGINS = [];
  });
  await waitForViewerReady(
    page,
    '/index.html?model=demo_box.xml&mode=worker&plugins=./plugins/test_ui_sections_plugin.mjs',
  );

  const pluginSection = page.locator('[data-play-section-id="plugin:test_ui_sections"]');
  await pluginSection.waitFor({ state: 'attached' });

  // DOM order: File -> (plugin slot) -> Option.
  const order = await page.evaluate(() => {
    const file = document.querySelector('[data-play-section-id="file"]');
    const plugin = document.querySelector('[data-play-section-id="plugin:test_ui_sections"]');
    const option = document.querySelector('[data-play-section-id="option"]');
    if (!file || !plugin || !option) return null;
    const fileBeforePlugin = !!(file.compareDocumentPosition(plugin) & Node.DOCUMENT_POSITION_FOLLOWING);
    const pluginBeforeOption = !!(plugin.compareDocumentPosition(option) & Node.DOCUMENT_POSITION_FOLLOWING);
    return { fileBeforePlugin, pluginBeforeOption };
  });
  expect(order).toEqual({ fileBeforePlugin: true, pluginBeforeOption: true });

  const header = pluginSection.locator('[data-play-role="section-header"]');

  await header.dblclick();
  await expect(page.locator('[data-play-section-id="file"]')).toHaveClass(/is-collapsed/);
  await expect(pluginSection).toHaveClass(/is-collapsed/);

  await header.dblclick();
  await expect(page.locator('[data-play-section-id="file"]')).not.toHaveClass(/is-collapsed/);
  await expect(pluginSection).not.toHaveClass(/is-collapsed/);
});
