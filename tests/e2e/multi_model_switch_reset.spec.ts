import { test, expect } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { waitForViewerReady } from './test-utils';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const FORGE_BASE = '/dist/3.3.7/';
const MODELS = [
  'mujoco_Rajagopal2015_simple.xml',
  'horse_17D50M_full.xml',
  'RKOB_full_no_hand_STAR_OSSO.xml',
  'RKOB_simplified_upper_STAR_OSSO.xml',
  'stark2021_with_muscles.xml',
];

function devXmlPath(file: string) {
  return path.join(__dirname, '..', '..', file);
}

async function openWithModel(page: any, file: string) {
  const url =
    `/?model=${encodeURIComponent(file)}` +
    `&mode=worker&snapshot=1&log=0` +
    `&forgeBase=${encodeURIComponent(FORGE_BASE)}`;
  await waitForViewerReady(page, url);
}

async function loadXmlTextModel(page: any, file: string) {
  const xmlText = await fs.readFile(devXmlPath(file), 'utf8');
  await page.evaluate(({ xml, label }) => {
    const controls = (window as any).__viewerControls;
    if (!controls?.loadXmlTextAsModel) throw new Error('Missing __viewerControls.loadXmlTextAsModel');
    controls.loadXmlTextAsModel(xml, label);
  }, { xml: xmlText, label: file });
  await page.waitForFunction((label) => {
    const snap = (window as any).__lastSnapshot;
    const scnNgeom = Number(snap?.scn_ngeom) | 0;
    const store = (window as any).__viewerStore;
    const modelLabel = String(store?.get?.()?.hud?.modelLabel ?? '');
    return scnNgeom > 0 && modelLabel.includes(label);
  }, file, { timeout: 180_000 });
}

async function pauseAndReset(page: any) {
  await page.keyboard.press('Space');
  await page.waitForFunction(() => {
    const store = (window as any).__viewerStore;
    return store?.get?.()?.simulation?.run === false;
  }, { timeout: 15_000 });
  await page.keyboard.press('Backspace');
  await page.waitForFunction(() => {
    const snap = (window as any).__lastSnapshot;
    const t = Number(snap?.t);
    return Number.isFinite(t) && t < 0.5;
  }, { timeout: 30_000 });
}

test('single-model default pause/reset across models', async ({ page }) => {
  test.setTimeout(300_000);

  for (const file of MODELS) {
    await openWithModel(page, file);
    await page.waitForTimeout(1500);
    await pauseAndReset(page);
    const tReset = await page.evaluate(() => Number((window as any).__lastSnapshot?.t) || 0);
    expect(tReset).toBeLessThanOrEqual(0.5);
  }
});

test('pairwise switch: Raj<->horse and RKOB', async ({ page }) => {
  test.setTimeout(300_000);

  const pairs: Array<[string, string]> = [
    ['mujoco_Rajagopal2015_simple.xml', 'horse_17D50M_full.xml'],
    ['horse_17D50M_full.xml', 'mujoco_Rajagopal2015_simple.xml'],
    ['mujoco_Rajagopal2015_simple.xml', 'RKOB_full_no_hand_STAR_OSSO.xml'],
    ['RKOB_full_no_hand_STAR_OSSO.xml', 'mujoco_Rajagopal2015_simple.xml'],
  ];

  for (const [from, to] of pairs) {
    await openWithModel(page, from);
    await page.waitForTimeout(1000);
    await loadXmlTextModel(page, to);
    await page.waitForTimeout(1000);
    await pauseAndReset(page);
    const tReset = await page.evaluate(() => Number((window as any).__lastSnapshot?.t) || 0);
    expect(tReset).toBeLessThanOrEqual(0.5);
  }
});

test('sequential switching smoke (Raj -> horse)', async ({ page }) => {
  test.setTimeout(180_000);

  await openWithModel(page, 'mujoco_Rajagopal2015_simple.xml');
  await loadXmlTextModel(page, 'horse_17D50M_full.xml');
  await pauseAndReset(page);
  const tReset = await page.evaluate(() => Number((window as any).__lastSnapshot?.t) || 0);
  expect(tReset).toBeLessThanOrEqual(0.5);
});
