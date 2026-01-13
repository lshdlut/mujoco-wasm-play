import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';

test('loads humanoid100 model references', async ({ page }) => {
  const repoRoot = path.resolve(__dirname, '..', '..');
  const devRoot = path.join(repoRoot, 'dev');
  const modelPath = path.join(devRoot, 'model', 'humanoid', 'humanoid100.xml');
  if (!fs.existsSync(modelPath)) {
    test.skip(true, `Missing local model: ${modelPath}`);
  }

  const consoleErrors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      consoleErrors.push(msg.text());
    }
  });

  await page.goto('/index.html?mode=worker&model=model/humanoid/humanoid100.xml&log=1');

  await page.waitForFunction(
    () => {
      const snap = (window as any).__lastSnapshot;
      return snap && ((snap.scn_ngeom | 0) > 0);
    },
    null,
    { timeout: 30_000 },
  );

  const combined = consoleErrors.join('\n');
  expect(combined).not.toContain('XML load failed:');
});
