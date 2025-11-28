import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function parseSimTime(text: string): number {
  const match = text.match(/([0-9]+(?:\.[0-9]+)?)/);
  return match ? Number(match[1]) : NaN;
}

test('loading a new xml resets timer and registers dropdown entry', async ({ page }) => {
  await page.goto('/');

  const simTime = page.getByTestId('sim-time');
  await expect(simTime).toBeVisible();

   // Ensure File section is expanded (collapsed by default on left panel).
  const fileSection = page.getByTestId('section-file');
  await expect(fileSection).toBeVisible();
  const isCollapsed = await fileSection.evaluate((el) => el.classList.contains('is-collapsed'));
  if (isCollapsed) {
    await fileSection.locator('.section-header').click();
  }

  // Let the simulation run a bit to ensure time > 0 before reload.
  await page.waitForTimeout(700);
  const beforeText = await simTime.textContent();
  const beforeTime = parseSimTime(beforeText || '');
  expect(beforeTime).toBeGreaterThanOrEqual(0);

  const loadButton = page.getByTestId('file.load_xml_custom');
  await expect(loadButton).toBeVisible();

  const pendulumPath = path.join(__dirname, '..', '..', 'pendulum.xml');
  const [fileChooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    loadButton.click(),
  ]);
  await fileChooser.setFiles(pendulumPath);

  const modelSelect = page.getByTestId('file.model_select');
  await expect(modelSelect).toBeEnabled();
  await expect(modelSelect.locator('option')).toContainText(['pendulum.xml']);

  const afterText = await simTime.textContent();
  console.log('sim time after reload text:', afterText);

  // Timer should drop near zero shortly after reload.
  await page.waitForFunction(
    (selector) => {
      const el = document.querySelector(selector);
      if (!el) return false;
      const match = el.textContent?.match(/([0-9]+(?:\.[0-9]+)?)/);
      if (!match) return false;
      const t = Number(match[1]);
      return Number.isFinite(t) && t < 0.1;
    },
    '[data-testid="sim-time"]',
    { timeout: 10_000 },
  );
});
