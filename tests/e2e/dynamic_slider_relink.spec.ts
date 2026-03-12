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

async function clickGroupToggle(page: any, groupIndex: number) {
  await page.click(`input[type="checkbox"][data-testid="group.joint${groupIndex}"]`, { force: true });
}

async function switchBuiltinModel(page: any, labelFragment: string) {
  await ensureSectionExpanded(page, 'file');
  await page.evaluate((fragment) => {
    const select = document.querySelector('[data-testid="file.model_select"]');
    if (!(select instanceof HTMLSelectElement)) {
      throw new Error('file.model_select not found');
    }
    const option = Array.from(select.options).find((entry) => (entry.textContent || '').includes(fragment));
    if (!option) {
      throw new Error(`model option not found: ${fragment}`);
    }
    select.value = option.value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  }, labelFragment);
  await page.waitForFunction((fragment) => {
    const label = (window as any).__viewerStore?.get?.()?.shell?.modelLabel || '';
    return String(label).includes(fragment);
  }, labelFragment, { timeout: 120_000 });
}

async function setRangeValueByInput(page: any, testId: string, value: number) {
  await page.evaluate(({ nextTestId, nextValue }) => {
    const slider = document.querySelector(`input[type="range"][data-testid="${nextTestId}"]`);
    if (!(slider instanceof HTMLInputElement)) {
      throw new Error(`range input not found: ${nextTestId}`);
    }
    slider.value = String(nextValue);
    slider.dispatchEvent(new Event('input', { bubbles: true }));
  }, { nextTestId: testId, nextValue: value });
}

test('dynamic joint sliders relink after source disappears and comes back', async ({ page }) => {
  await waitForViewerReady(page, '/index.html?model=raj&font=100');
  await setRunState(page, false);
  await ensureSectionExpanded(page, 'group');
  await ensureSectionExpanded(page, 'joint');

  await page.waitForFunction(() => {
    return document.querySelectorAll('input[type="range"][data-testid^="joint."]').length > 0;
  }, { timeout: 20_000, polling: 100 });

  const initialEnabledGroups = await page.evaluate(() => {
    const snapshot = (window as any).__PLAY_HOST__?.getSnapshot?.() ?? null;
    return Array.isArray(snapshot?.groups?.joint)
      ? snapshot.groups.joint.map((enabled: any) => !!enabled)
      : [];
  });

  const initiallyEnabledIndices = initialEnabledGroups
    .map((enabled: boolean, index: number) => (enabled ? index : -1))
    .filter((index: number) => index >= 0);

  expect(initiallyEnabledIndices.length).toBeGreaterThan(0);

  for (const groupIndex of initiallyEnabledIndices) {
    await clickGroupToggle(page, groupIndex);
  }

  await page.waitForFunction(() => {
    const snapshot = (window as any).__PLAY_HOST__?.getSnapshot?.() ?? null;
    const groups = Array.isArray(snapshot?.groups?.joint) ? snapshot.groups.joint : [];
    const allDisabled = groups.every((enabled: any) => !enabled);
    const sliderCount = document.querySelectorAll('input[type="range"][data-testid^="joint."]').length;
    return allDisabled && sliderCount === 0;
  }, { timeout: 20_000, polling: 100 });

  for (const groupIndex of initiallyEnabledIndices) {
    await clickGroupToggle(page, groupIndex);
  }

  await page.waitForFunction((expectedGroups) => {
    const snapshot = (window as any).__PLAY_HOST__?.getSnapshot?.() ?? null;
    const groups = Array.isArray(snapshot?.groups?.joint) ? snapshot.groups.joint : [];
    const sliderCount = document.querySelectorAll('input[type="range"][data-testid^="joint."]').length;
    if (!(sliderCount > 0)) return false;
    return groups.slice(0, 6).every((enabled: any, index: number) => !!enabled === !!(expectedGroups[index]));
  }, initialEnabledGroups, { timeout: 20_000, polling: 100 });

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

  await setRangeValueByInput(page, `joint.${sliderInfo.index}`, target);

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

test('dynamic actuator sliders relink after builtin model source disappears and comes back', async ({ page }) => {
  await waitForViewerReady(page, '/index.html?model=raj&font=100&snapshot=1');
  await setRunState(page, false);
  await ensureSectionExpanded(page, 'control');

  await page.waitForFunction(() => {
    return document.querySelectorAll('input[type="range"][data-testid^="control.act."]').length > 0;
  }, { timeout: 20_000, polling: 100 });

  const actuatorBefore = await page.evaluate(() => {
    const snapshot = (window as any).__PLAY_HOST__?.getSnapshot?.() ?? null;
    const actuators = Array.isArray(snapshot?.actuators) ? snapshot.actuators : [];
    return {
      count: document.querySelectorAll('input[type="range"][data-testid^="control.act."]').length,
      metaCount: actuators.length,
    };
  });
  expect(actuatorBefore.count).toBeGreaterThan(0);
  expect(actuatorBefore.metaCount).toBeGreaterThan(0);

  await switchBuiltinModel(page, 'cards/cards');

  await page.waitForFunction(() => {
    const snapshot = (window as any).__PLAY_HOST__?.getSnapshot?.() ?? null;
    const actuators = Array.isArray(snapshot?.actuators) ? snapshot.actuators : [];
    const sliderCount = document.querySelectorAll('input[type="range"][data-testid^="control.act."]').length;
    return actuators.length === 0 && sliderCount === 0;
  }, { timeout: 120_000, polling: 100 });

  await switchBuiltinModel(page, 'raj');

  await page.waitForFunction(() => {
    const snapshot = (window as any).__PLAY_HOST__?.getSnapshot?.() ?? null;
    const actuators = Array.isArray(snapshot?.actuators) ? snapshot.actuators : [];
    const sliderCount = document.querySelectorAll('input[type="range"][data-testid^="control.act."]').length;
    return actuators.length > 0 && sliderCount > 0;
  }, { timeout: 120_000, polling: 100 });

  const sliderInfo = await page.evaluate(() => {
    const slider = document.querySelector('input[type="range"][data-testid^="control.act."]');
    if (!(slider instanceof HTMLInputElement)) {
      throw new Error('actuator slider not found after model restore');
    }
    const testId = String(slider.getAttribute('data-testid') || '');
    const prefix = 'control.act.';
    const index = Number(testId.startsWith(prefix) ? testId.slice(prefix.length) : '-1');
    return {
      index,
      testId,
      min: Number(slider.min),
      max: Number(slider.max),
      value: Number(slider.value),
    };
  });

  const target = sliderInfo.value <= ((sliderInfo.min + sliderInfo.max) / 2)
    ? sliderInfo.max
    : sliderInfo.min;

  await setRangeValueByInput(page, sliderInfo.testId, target);

  await page.waitForFunction(({ index, expected }) => {
    const snapshot = (window as any).__PLAY_HOST__?.getSnapshot?.() ?? null;
    const ctrl = Array.isArray(snapshot?.ctrl) ? snapshot.ctrl : null;
    if (!ctrl || index < 0 || index >= ctrl.length) return false;
    return Math.abs(Number(ctrl[index]) - expected) < 1e-6;
  }, { index: sliderInfo.index, expected: target }, { timeout: 20_000, polling: 100 });

  await page.waitForFunction(({ testId, expected }) => {
    const slider = document.querySelector(`input[type="range"][data-testid="${testId}"]`);
    if (!(slider instanceof HTMLInputElement)) return false;
    return Math.abs(Number(slider.value) - expected) < 1e-6;
  }, { testId: sliderInfo.testId, expected: target }, { timeout: 20_000, polling: 100 });
});
