import { test, expect } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { waitForViewerReady, ensureSectionExpanded } from './test-utils';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const FORGE_BASE = '/dist/3.3.7/';
const HORSE_MODEL = 'horse_17D50M_full.xml';
const RAJ_XML_PATH = path.join(__dirname, '..', '..', 'mujoco_Rajagopal2015_simple.xml');

test('horse(default) -> Raj(load) -> run -> reset memory behaviour', async ({ page }) => {
  const url =
    `/?model=${encodeURIComponent(HORSE_MODEL)}` +
    `&mode=worker&snapshot=1&log=0` +
    `&forgeBase=${encodeURIComponent(FORGE_BASE)}`;
  await waitForViewerReady(page, url);

  await page.waitForTimeout(3000);
  const horseInit = await page.evaluate(() => Number((window as any).__lastSnapshot?.t) || 0);
  expect(horseInit).toBeGreaterThanOrEqual(0);

  await ensureSectionExpanded(page, 'file');
  const xmlText = await fs.readFile(RAJ_XML_PATH, 'utf8');
  await page.evaluate(({ xml, label }) => {
    const controls = (window as any).__viewerControls;
    if (!controls?.loadXmlTextAsModel) throw new Error('Missing __viewerControls.loadXmlTextAsModel');
    controls.loadXmlTextAsModel(xml, label);
  }, { xml: xmlText, label: 'mujoco_Rajagopal2015_simple.xml' });

  await page.waitForFunction(() => {
    const snap = (window as any).__lastSnapshot;
    const t = Number(snap?.t);
    const scnNgeom = Number(snap?.scn_ngeom) | 0;
    return scnNgeom > 0 && Number.isFinite(t) && t < 0.1;
  }, { timeout: 60_000 });
  const rajAfterLoad = await page.evaluate(() => Number((window as any).__lastSnapshot?.t) || 0);

  await page.waitForTimeout(3000);
  const beforePause = await page.evaluate(() => Number((window as any).__lastSnapshot?.t) || 0);
  expect(beforePause).toBeGreaterThanOrEqual(rajAfterLoad);

  await page.keyboard.press('Space');
  await page.waitForFunction(() => {
    const store = (window as any).__viewerStore;
    return store?.get?.()?.simulation?.run === false;
  }, { timeout: 10_000 });

  await page.evaluate(() => {
    const active = document.activeElement;
    if (active && typeof (active as any).blur === 'function') {
      (active as any).blur();
    }
    if (document.body && typeof (document.body as any).focus === 'function') {
      (document.body as any).focus();
    }
  });
  await page.keyboard.press('Backspace');
  await page.waitForFunction(() => {
    const store = (window as any).__viewerStore;
    const toast = store?.get?.()?.toast;
    const msg = typeof toast?.message === 'string' ? toast.message : '';
    return msg.toLowerCase().includes('reset');
  }, { timeout: 10_000 });
  await page.waitForFunction(() => {
    const snap = (window as any).__lastSnapshot;
    const t = Number(snap?.t);
    const scnNgeom = Number(snap?.scn_ngeom) | 0;
    return scnNgeom > 0 && Number.isFinite(t) && t < 0.5;
  }, { timeout: 30_000 });
  const tReset = await page.evaluate(() => Number((window as any).__lastSnapshot?.t) || 0);
  expect(Number.isFinite(tReset)).toBeTruthy();
  expect(tReset).toBeLessThanOrEqual(0.5);
});
