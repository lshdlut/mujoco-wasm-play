import { test, expect } from '@playwright/test';

import { waitForViewerReady } from './test-utils';

const PLAY_STATE_KEY = 'play:ui:v2:panel_state:play';
const CUSTOM_STATE_KEY = 'play:ui:v2:panel_state:custom-profile';
const LEGACY_STATE_KEY = 'play:ui:v1:section_collapsed';
const MODEL_URL = '/index.html?model=model/mujoco_Rajagopal2015_simple.xml&mode=worker';

async function bootstrapUiState(page, options = {}) {
  const {
    clearStorage = true,
    playState = null,
    customState = null,
    legacyState = null,
    profileId = null,
    storageNamespace = null,
    builtInDefaultOpen = null,
    sectionDefaultOpen = null,
  } = options;
  await page.addInitScript(({ clearStorage, playState, customState, legacyState, profileId, storageNamespace, builtInDefaultOpen, sectionDefaultOpen }) => {
    const bootKey = '__play_ui_bootstrap_done__';
    if (clearStorage && !sessionStorage.getItem(bootKey)) {
      localStorage.removeItem('play:ui:v2:panel_state:play');
      localStorage.removeItem('play:ui:v2:panel_state:custom-profile');
      localStorage.removeItem('play:ui:v1:section_collapsed');
      sessionStorage.setItem(bootKey, '1');
    }
    if (playState) localStorage.setItem('play:ui:v2:panel_state:play', JSON.stringify(playState));
    if (customState) localStorage.setItem('play:ui:v2:panel_state:custom-profile', JSON.stringify(customState));
    if (legacyState) localStorage.setItem('play:ui:v1:section_collapsed', JSON.stringify(legacyState));
    (globalThis as any).PLAY_PLUGINS = [];
    if (profileId) (globalThis as any).PLAY_UI_PROFILE = profileId;
    if (storageNamespace) (globalThis as any).PLAY_UI_STORAGE_NAMESPACE = storageNamespace;
    if (builtInDefaultOpen != null) (globalThis as any).PLAY_UI_BUILTIN_DEFAULT_OPEN = builtInDefaultOpen;
    if (sectionDefaultOpen) (globalThis as any).PLAY_UI_SECTION_DEFAULT_OPEN = sectionDefaultOpen;
  }, { clearStorage, playState, customState, legacyState, profileId, storageNamespace, builtInDefaultOpen, sectionDefaultOpen });
}

test('ui: play built-in sections default open and ignore legacy/custom persisted state', async ({ page }) => {
  await bootstrapUiState(page, {
    legacyState: { '["right","joint"]': true, '["left","file"]': true },
    customState: {
      panels: { left: false, right: true },
      sectionsCollapsed: {
        left: { file: true },
        right: { joint: true, control: true },
      },
    },
  });
  await waitForViewerReady(page, MODEL_URL);

  await expect(page.locator('[data-play-section-id="file"]')).not.toHaveClass(/is-collapsed/);
  await expect(page.locator('[data-play-section-id="option"]')).not.toHaveClass(/is-collapsed/);
  await expect(page.locator('[data-play-section-id="joint"]')).not.toHaveClass(/is-collapsed/);
  await expect(page.locator('[data-testid="panel-left"]')).not.toHaveClass(/is-hidden/);
  await expect(page.locator('[data-testid="panel-right"]')).not.toHaveClass(/is-hidden/);
});

test('ui: play remembers section + panel state in its own namespace', async ({ page }) => {
  await bootstrapUiState(page);
  const url = MODEL_URL;
  await waitForViewerReady(page, url);

  const control = page.locator('[data-play-section-id="control"]');
  await control.locator('[data-play-role="section-toggle"]').click();
  await expect(control).toHaveClass(/is-collapsed/);

  await page.keyboard.press('Tab');
  await expect(page.locator('[data-testid="panel-left"]')).toHaveClass(/is-hidden/);

  await waitForViewerReady(page, url);
  await expect(page.locator('[data-play-section-id="control"]')).toHaveClass(/is-collapsed/);
  await expect(page.locator('[data-play-section-id="joint"]')).not.toHaveClass(/is-collapsed/);
  await expect(page.locator('[data-testid="panel-left"]')).toHaveClass(/is-hidden/);

  const persisted = await page.evaluate((key) => JSON.parse(localStorage.getItem(key) || 'null'), PLAY_STATE_KEY);
  expect(persisted).toMatchObject({
    panels: { left: false, right: true },
    sectionsCollapsed: { right: { control: true } },
  });
});

test('ui: custom profile uses app-scoped namespace without polluting play', async ({ browser }) => {
  const context = await browser.newContext();
  const playPage = await context.newPage();
  await bootstrapUiState(playPage, {
    playState: {
      panels: { left: true, right: true },
      sectionsCollapsed: {
        left: {},
        right: { control: true },
      },
    },
    customState: {
      panels: { left: false, right: true },
      sectionsCollapsed: {
        left: {},
        right: { joint: true, control: false },
      },
    },
  });
  await waitForViewerReady(playPage, MODEL_URL);
  await expect(playPage.locator('[data-play-section-id="control"]')).toHaveClass(/is-collapsed/);
  await expect(playPage.locator('[data-play-section-id="joint"]')).not.toHaveClass(/is-collapsed/);
  await expect(playPage.locator('[data-testid="panel-left"]')).not.toHaveClass(/is-hidden/);

  const customPage = await context.newPage();
  await bootstrapUiState(customPage, {
    clearStorage: false,
    profileId: 'custom-profile',
    storageNamespace: 'custom-profile',
    builtInDefaultOpen: false,
    sectionDefaultOpen: { right: { joint: false, control: true } },
  });
  await waitForViewerReady(customPage, MODEL_URL);
  await expect(customPage.locator('[data-play-section-id="joint"]')).toHaveClass(/is-collapsed/);
  await expect(customPage.locator('[data-play-section-id="control"]')).not.toHaveClass(/is-collapsed/);
  await expect(customPage.locator('[data-testid="panel-left"]')).toHaveClass(/is-hidden/);

  const customPersisted = await customPage.evaluate((key) => JSON.parse(localStorage.getItem(key) || 'null'), CUSTOM_STATE_KEY);
  expect(customPersisted).toMatchObject({
    panels: { left: false, right: true },
    sectionsCollapsed: { right: { joint: true, control: false } },
  });

  await customPage.close();
  await waitForViewerReady(playPage, MODEL_URL);
  await expect(playPage.locator('[data-play-section-id="control"]')).toHaveClass(/is-collapsed/);
  await expect(playPage.locator('[data-play-section-id="joint"]')).not.toHaveClass(/is-collapsed/);
  await expect(playPage.locator('[data-testid="panel-left"]')).not.toHaveClass(/is-hidden/);
  await context.close();
});

test('ui: plugin section still falls back to plugin defaultOpen', async ({ page }) => {
  await bootstrapUiState(page);
  await waitForViewerReady(
    page,
    '/index.html?model=model/mujoco_Rajagopal2015_simple.xml&mode=worker&plugins=./plugins/test_ui_sections_plugin.mjs',
  );
  await expect(page.locator('[data-play-section-id="plugin:test_ui_sections"]')).not.toHaveClass(/is-collapsed/);
});

test('ui: file section model label reflects the loaded model, not the last builtin entry', async ({ page }) => {
  await bootstrapUiState(page);
  await waitForViewerReady(page, MODEL_URL);
  const label = await page.evaluate(() => (window as any).__viewerStore?.get?.()?.shell?.modelLabel || '');
  expect(label).toContain('mujoco_Rajagopal2015_simple.xml');
  expect(label).not.toContain('touch_grid');
});
