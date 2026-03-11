import { expect, test } from '@playwright/test';
import { waitForViewerReady } from './test-utils';

test('envAssetBase routes preset HDRI URLs through runtime config', async ({ page }) => {
  await waitForViewerReady(page, '/index.html?model=raj&envAssetBase=/shared-env/');

  const expectedBase = new URL('/shared-env/', page.url()).href;
  const configBase = await page.evaluate(() => (window as any).__PLAY_RUNTIME_CONFIG__?.rendering?.environmentAssetBase ?? null);
  expect(configBase).toBe(expectedBase);

  await page.evaluate(async () => {
    const controls = (window as any).__viewerControls;
    if (!controls?.toggleControl) {
      throw new Error('Missing __viewerControls.toggleControl');
    }
    await controls.toggleControl('option.visual_source', 'PresetSun');
  });

  await expect.poll(async () => page.evaluate(() => {
    const state = (window as any).__viewerStore?.get?.();
    return state?.rendering?.appearance?.hdri ?? null;
  })).toBe(`${expectedBase}rustig_koppie_puresky_4k.hdr`);
});
