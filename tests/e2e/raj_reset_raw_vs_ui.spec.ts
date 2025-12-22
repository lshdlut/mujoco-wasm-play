import { test, expect } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { waitForViewerReady, ensureSectionExpanded } from './test-utils';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const FORGE_BASE = '/dist/3.3.7/';
const RAJ_MODEL = 'mujoco_Rajagopal2015_simple.xml';
const HORSE_MODEL = 'horse_17D50M_full.xml';

test('UI reset vs worker restart (raw) smoke', async ({ page }) => {
  test.setTimeout(240_000);

  const url =
    `/?model=${encodeURIComponent(RAJ_MODEL)}` +
    `&mode=worker&snapshot=1&log=0` +
    `&forgeBase=${encodeURIComponent(FORGE_BASE)}`;
  await waitForViewerReady(page, url);
  await ensureSectionExpanded(page, 'file');

  const horseXml = await fs.readFile(path.join(__dirname, '..', '..', HORSE_MODEL), 'utf8');
  await page.evaluate(({ xml, label }) => {
    const controls = (window as any).__viewerControls;
    if (!controls?.loadXmlTextAsModel) throw new Error('Missing __viewerControls.loadXmlTextAsModel');
    controls.loadXmlTextAsModel(xml, label);
  }, { xml: horseXml, label: HORSE_MODEL });

  await page.waitForFunction((label) => {
    const snap = (window as any).__lastSnapshot;
    const scnNgeom = Number(snap?.scn_ngeom) | 0;
    const store = (window as any).__viewerStore;
    const modelLabel = String(store?.get?.()?.hud?.modelLabel ?? '');
    return scnNgeom > 0 && modelLabel.includes(label);
  }, HORSE_MODEL, { timeout: 120_000 });

  await page.keyboard.press('Space');
  await page.waitForFunction(() => {
    const store = (window as any).__viewerStore;
    return store?.get?.()?.simulation?.run === false;
  }, { timeout: 15_000 });

  await page.keyboard.press('Backspace');
  await page.waitForFunction(() => {
    const t = Number((window as any).__lastSnapshot?.t);
    return Number.isFinite(t) && t < 0.5;
  }, { timeout: 30_000 });
  const uiResetT = await page.evaluate(() => Number((window as any).__lastSnapshot?.t) || 0);
  expect(uiResetT).toBeLessThanOrEqual(0.5);

  await page.evaluate(({ xml, label }) => {
    const controls = (window as any).__viewerControls;
    if (!controls?.loadXmlTextAsModel) throw new Error('Missing __viewerControls.loadXmlTextAsModel');
    controls.loadXmlTextAsModel(xml, label);
  }, { xml: horseXml, label: HORSE_MODEL });

  await page.waitForFunction((label) => {
    const snap = (window as any).__lastSnapshot;
    const scnNgeom = Number(snap?.scn_ngeom) | 0;
    const t = Number(snap?.t);
    const store = (window as any).__viewerStore;
    const modelLabel = String(store?.get?.()?.hud?.modelLabel ?? '');
    return scnNgeom > 0 && modelLabel.includes(label) && Number.isFinite(t) && t < 0.5;
  }, HORSE_MODEL, { timeout: 120_000 });
  const rawResetT = await page.evaluate(() => Number((window as any).__lastSnapshot?.t) || 0);
  expect(rawResetT).toBeLessThanOrEqual(0.5);
});
