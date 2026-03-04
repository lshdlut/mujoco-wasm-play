import { test, expect } from '@playwright/test';

test('pthreads entry hard-fails without cross-origin isolation', async ({ page }) => {
  await page.goto('/pthreads/index.html');
  await expect(page.getByText('Pthreads build requires cross-origin isolation')).toBeVisible();
  await expect(page.locator('[data-testid="viewer-canvas"]')).toHaveCount(0);
});

