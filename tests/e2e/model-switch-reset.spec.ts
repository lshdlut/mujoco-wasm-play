import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs/promises';
import { ensureSectionExpanded, waitForViewerReady } from './test-utils';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const MODEL = 'mujoco_Rajagopal2015_simple.xml';
const FORGE_BASE = '/dist/3.3.7/';

test('loading a new xml resets timer and registers dropdown entry', async ({ page }) => {
  const url =
    `/?model=${encodeURIComponent(MODEL)}` +
    `&mode=worker&snapshot=1&log=0` +
    `&forgeBase=${encodeURIComponent(FORGE_BASE)}`;
  await waitForViewerReady(page, url);

  await ensureSectionExpanded(page, 'file');

  await page.waitForTimeout(700);
  const beforeTime = await page.evaluate(() => Number((window as any).__lastSnapshot?.t) || 0);
  expect(beforeTime).toBeGreaterThan(0);

  const pendulumPath = path.join(__dirname, '..', '..', 'pendulum.xml');
  const xmlText = await fs.readFile(pendulumPath, 'utf8');
  await page.evaluate(async ({ xml, label }) => {
    const controls = (window as any).__viewerControls;
    if (!controls?.loadXmlTextAsModel) throw new Error('Missing __viewerControls.loadXmlTextAsModel');
    await controls.loadXmlTextAsModel(xml, label);
  }, { xml: xmlText, label: 'pendulum.xml' });

  const optionTexts = await page.evaluate(() => {
    const select = document.querySelector('[data-testid="file.model_select"]');
    if (!(select instanceof HTMLSelectElement)) return [];
    return Array.from(select.options).map((opt) => opt.textContent || '');
  });
  expect(optionTexts.join('\n')).toContain('pendulum.xml');

  // Timer should drop near zero shortly after reload.
  await page.waitForFunction(() => {
    const t = Number((window as any).__lastSnapshot?.t);
    return Number.isFinite(t) && t < 0.1;
  }, { timeout: 10_000 });
});
