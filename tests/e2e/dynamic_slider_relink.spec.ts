import { expect, test } from '@playwright/test';

import { ensureSectionExpanded, waitForViewerReady } from './test-utils';

async function setRunState(page: any, run: boolean) {
  await page.evaluate(async (nextRun) => {
    const backend = (window as any).__PLAY_HOST__?.backend;
    if (!backend?.setRunState) throw new Error('backend.setRunState not available');
    await backend.setRunState(nextRun, 'test');
  }, run);
  await page.waitForFunction((nextRun) => {
    const snapshot = (window as any).__PLAY_HOST__?.getSnapshot?.() ?? null;
    return !!snapshot && snapshot.paused === !nextRun;
  }, run, { timeout: 20_000, polling: 100 });
}

async function applyUiControl(page: any, id: string, value: any) {
  await page.evaluate(async ({ nextId, nextValue }) => {
    const backend = (window as any).__PLAY_HOST__?.backend;
    if (!backend?.apply) throw new Error('backend.apply not available');
    await backend.apply({ kind: 'ui', id: nextId, value: nextValue });
  }, { nextId: id, nextValue: value });
}

test('dynamic joint sliders relink after source disappears and comes back', async ({ page }) => {
  await waitForViewerReady(page, '/index.html?model=raj&font=100');
  await setRunState(page, false);
  await ensureSectionExpanded(page, 'group');
  await ensureSectionExpanded(page, 'joint');

  await page.waitForFunction(() => {
    return document.querySelectorAll('input[type="range"][data-testid^="joint."]').length > 0;
  }, { timeout: 20_000, polling: 100 });

  for (let groupIndex = 0; groupIndex < 6; groupIndex += 1) {
    await applyUiControl(page, `group.joint${groupIndex}`, false);
  }

  await page.waitForFunction(() => {
    return document.querySelectorAll('input[type="range"][data-testid^="joint."]').length === 0;
  }, { timeout: 20_000, polling: 100 });

  for (let groupIndex = 0; groupIndex < 6; groupIndex += 1) {
    await applyUiControl(page, `group.joint${groupIndex}`, true);
  }

  await page.waitForFunction(() => {
    return document.querySelectorAll('input[type="range"][data-testid^="joint."]').length > 0;
  }, { timeout: 20_000, polling: 100 });

  const sliderInfo = await page.evaluate(() => {
    const slider = document.querySelector('input[type="range"][data-testid^="joint."]');
    if (!(slider instanceof HTMLInputElement)) {
      throw new Error('joint slider not found after re-enable');
    }
    const testId = String(slider.getAttribute('data-testid') || '');
    const prefix = 'joint.';
    const index = Number(testId.startsWith(prefix) ? testId.slice(prefix.length) : '-1');
    return {
      index,
      min: Number(slider.min),
      max: Number(slider.max),
      value: Number(slider.value),
    };
  });

  const target = sliderInfo.value <= ((sliderInfo.min + sliderInfo.max) / 2)
    ? sliderInfo.max
    : sliderInfo.min;

  await applyUiControl(page, 'joint.slider', {
    index: sliderInfo.index,
    value: target,
    min: sliderInfo.min,
    max: sliderInfo.max,
  });

  await page.waitForFunction(({ index, expected }) => {
    const snapshot = (window as any).__PLAY_HOST__?.getSnapshot?.() ?? null;
    if (!snapshot?.qpos) return false;
    const qposValue = Number(snapshot.qpos[index]);
    return Math.abs(qposValue - expected) < 1e-6;
  }, { index: sliderInfo.index, expected: target }, { timeout: 20_000, polling: 100 });

  await page.waitForFunction(({ index, expected }) => {
    const slider = document.querySelector(`input[type="range"][data-testid="joint.${index}"]`);
    if (!(slider instanceof HTMLInputElement)) return false;
    return Math.abs(Number(slider.value) - expected) < 1e-6;
  }, { index: sliderInfo.index, expected: target }, { timeout: 20_000, polling: 100 });

  const visibleValue = await page.evaluate((index) => {
    const slider = document.querySelector(`input[type="range"][data-testid="joint.${index}"]`);
    if (!(slider instanceof HTMLInputElement)) {
      throw new Error(`joint slider joint.${index} missing at validation`);
    }
    return Number(slider.value);
  }, sliderInfo.index);

  expect(Math.abs(visibleValue - target)).toBeLessThan(1e-6);
});
