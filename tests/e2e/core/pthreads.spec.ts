import { expect, test } from '@playwright/test';
import { waitForViewerReady } from '../test-utils';

test.describe('pthreads coi gate', () => {
  test('pthreads entry hard-fails without cross-origin isolation', async ({ page }) => {
    await page.goto('/pthreads/index.html');
    await expect(page.getByText('Pthreads build requires cross-origin isolation')).toBeVisible();
    await expect(page.locator('[data-testid="viewer-canvas"]')).toHaveCount(0);
  });
});

test.describe('pthreads raj joint names', () => {
  test('pthreads-Raj exposes real joint names (SharedArrayBuffer heap)', async ({ page }) => {
    test.skip(process.env.PLAY_DEV_SERVER_COI !== '1', 'Requires PLAY_DEV_SERVER_COI=1 for crossOriginIsolated');
    test.setTimeout(180_000);

    const url =
      `/pthreads/index.html?model=${encodeURIComponent('mujoco_Rajagopal2015_simple.xml')}` +
      `&ver=3.5.0&snapshot=1&log=1`;

    await waitForViewerReady(page, url, { timeoutMs: 120_000 });

    const ok = await page.evaluate(() => {
      const names = (window as any).__PLAY_HOST__?.getSnapshot?.()?.jnt_names;
      if (!Array.isArray(names)) return false;
      return names.some((name) => typeof name === 'string' && name.length > 0 && !/^jnt\\s+\\d+$/.test(name));
    });
    expect(ok).toBeTruthy();
  });
});
