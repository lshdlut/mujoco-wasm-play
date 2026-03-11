import { expect, test } from '@playwright/test';

import { waitForViewerReady } from './test-utils';

async function setRunState(page: any, run: boolean) {
  await page.evaluate(async (nextRun) => {
    const backend = (window as any).__PLAY_HOST__?.backend;
    if (!backend?.setRunState) throw new Error('backend.setRunState not available');
    await backend.setRunState(nextRun, 'test');
  }, run);
  await page.waitForFunction((nextRun) => {
    const snapshot = (window as any).__PLAY_HOST__?.getSnapshot?.() ?? null;
    return !!snapshot && (snapshot.paused === !nextRun);
  }, run, { timeout: 20_000, polling: 100 });
}

async function reloadRajModel(page: any) {
  await page.evaluate(async () => {
    const backend = (window as any).__PLAY_HOST__?.backend;
    if (!backend?.loadXmlText) throw new Error('backend.loadXmlText not available');
    const response = await fetch('/model/mujoco_Rajagopal2015_simple.xml');
    if (!response.ok) {
      throw new Error(`failed to fetch raj xml: ${response.status}`);
    }
    const xmlText = await response.text();
    await backend.loadXmlText(xmlText);
  });
  await page.waitForFunction(() => {
    const snapshot = (window as any).__PLAY_HOST__?.getSnapshot?.() ?? null;
    const scnNgeom = Number(snapshot?.scn_ngeom) | 0;
    const historyCount = Number(snapshot?.history?.count) | 0;
    return !!snapshot && scnNgeom > 0 && historyCount <= 2;
  }, { timeout: 20_000, polling: 100 });
}

async function scrubHistory(page: any, direction: number, expectedOffset: number) {
  await page.evaluate(async (nextDirection) => {
    const backend = (window as any).__PLAY_HOST__?.backend;
    if (!backend?.step) throw new Error('backend.step not available');
    await backend.step(nextDirection);
  }, direction);
  await page.waitForFunction((nextOffset) => {
    const snapshot = (window as any).__PLAY_HOST__?.getSnapshot?.() ?? null;
    return !!snapshot && Number(snapshot?.history?.scrubIndex) === nextOffset;
  }, expectedOffset, { timeout: 20_000, polling: 100 });
}

test('history stepping stays aligned with simulation steps', async ({ page }) => {
  await waitForViewerReady(page, '/index.html?model=raj&font=100');
  await reloadRajModel(page);
  await setRunState(page, false);

  const before = await page.evaluate(() => {
    const snapshot = (window as any).__PLAY_HOST__?.getSnapshot?.() ?? null;
    return {
      count: Number(snapshot?.history?.count) || 0,
      time: Number(snapshot?.t) || 0,
      dt: Number(snapshot?.options?.timestep) || 0.002,
    };
  });

  await setRunState(page, true);
  await page.waitForFunction((startTime) => {
    const snapshot = (window as any).__PLAY_HOST__?.getSnapshot?.() ?? null;
    return !!snapshot && Number(snapshot?.t) >= (startTime + 0.05);
  }, before.time, { timeout: 20_000, polling: 50 });
  await setRunState(page, false);

  const live = await page.evaluate(() => {
    const snapshot = (window as any).__PLAY_HOST__?.getSnapshot?.() ?? null;
    return {
      count: Number(snapshot?.history?.count) || 0,
      time: Number(snapshot?.t) || 0,
      dt: Number(snapshot?.options?.timestep) || 0.002,
    };
  });
  expect(live.count).toBeGreaterThan(10);

  await scrubHistory(page, -1, -1);
  const stepBackOne = await page.evaluate(() => {
    const snapshot = (window as any).__PLAY_HOST__?.getSnapshot?.() ?? null;
    return Number(snapshot?.t) || 0;
  });

  await scrubHistory(page, -1, -2);
  const stepBackTwo = await page.evaluate(() => {
    const snapshot = (window as any).__PLAY_HOST__?.getSnapshot?.() ?? null;
    return Number(snapshot?.t) || 0;
  });

  const oneStepDelta = live.time - stepBackOne;
  const twoStepDelta = live.time - stepBackTwo;
  const tolerance = live.dt * 0.55;

  expect(oneStepDelta).toBeGreaterThan(live.dt - tolerance);
  expect(oneStepDelta).toBeLessThan(live.dt + tolerance);
  expect(twoStepDelta).toBeGreaterThan((2 * live.dt) - tolerance);
  expect(twoStepDelta).toBeLessThan((2 * live.dt) + tolerance);
});
