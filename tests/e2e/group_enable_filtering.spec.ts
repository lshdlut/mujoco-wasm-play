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

async function toggleControlById(page: any, controlId: string, value: any) {
  await page.evaluate(async ({ nextId, nextValue }) => {
    const controls = (window as any).__viewerControls;
    if (!controls?.toggleControl) throw new Error('__viewerControls.toggleControl unavailable');
    await controls.toggleControl(nextId, nextValue);
  }, { nextId: controlId, nextValue: value });
}

async function readJointSliderIds(page: any) {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll('input[type="range"][data-testid^="joint."]'))
      .map((node) => String(node.getAttribute('data-testid') || ''))
      .sort(),
  );
}

async function readActuatorSliderIds(page: any) {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll('input[type="range"][data-testid^="control.act."]'))
      .map((node) => String(node.getAttribute('data-testid') || ''))
      .sort(),
  );
}

async function setRangeValueByTestId(page: any, testId: string, value: number) {
  await page.evaluate(({ nextTestId, nextValue }) => {
    const slider = document.querySelector(`input[type="range"][data-testid="${nextTestId}"]`);
    if (!(slider instanceof HTMLInputElement)) {
      throw new Error(`range input not found: ${nextTestId}`);
    }
    slider.value = String(nextValue);
    slider.dispatchEvent(new Event('input', { bubbles: true }));
  }, { nextTestId: testId, nextValue: value });
}

test('joint group toggles filter the right-panel Joint section by exact MuJoCo group', async ({ page }) => {
  await waitForViewerReady(page, '/index.html?model=model/test/left_panel_groups.xml&font=100&snapshot=1');
  await setRunState(page, false);
  await ensureSectionExpanded(page, 'group');
  await ensureSectionExpanded(page, 'joint');

  await expect.poll(async () => readJointSliderIds(page), { timeout: 20_000 }).toEqual(['joint.0', 'joint.1']);

  await toggleControlById(page, 'group.joint1', false);
  await expect.poll(async () => readJointSliderIds(page), { timeout: 20_000 }).toEqual(['joint.0']);

  await toggleControlById(page, 'group.joint0', false);
  await expect.poll(async () => readJointSliderIds(page), { timeout: 20_000 }).toEqual([]);

  await toggleControlById(page, 'group.joint1', true);
  await expect.poll(async () => readJointSliderIds(page), { timeout: 20_000 }).toEqual(['joint.1']);

  await setRangeValueByTestId(page, 'joint.1', 1);
  await page.waitForFunction(() => {
    const snapshot = (window as any).__PLAY_HOST__?.getSnapshot?.() ?? null;
    return !!snapshot?.qpos && Math.abs(Number(snapshot.qpos[1]) - 1) < 1e-6;
  }, { timeout: 20_000, polling: 100 });
});

test('actuator group toggles filter and remake the right-panel Control section by exact MuJoCo group', async ({ page }) => {
  await waitForViewerReady(page, '/index.html?model=model/test/left_panel_groups.xml&font=100&snapshot=1');
  await setRunState(page, false);
  await ensureSectionExpanded(page, 'group');
  await ensureSectionExpanded(page, 'control');

  await expect.poll(async () => readActuatorSliderIds(page), { timeout: 20_000 }).toEqual(['control.act.0', 'control.act.1']);

  await toggleControlById(page, 'group.actuator1', false);
  await expect.poll(async () => readActuatorSliderIds(page), { timeout: 20_000 }).toEqual(['control.act.0']);

  await toggleControlById(page, 'group.actuator0', false);
  await expect.poll(async () => readActuatorSliderIds(page), { timeout: 20_000 }).toEqual([]);

  await toggleControlById(page, 'group.actuator1', true);
  await expect.poll(async () => readActuatorSliderIds(page), { timeout: 20_000 }).toEqual(['control.act.1']);

  await setRangeValueByTestId(page, 'control.act.1', 1);
  await page.waitForFunction(() => {
    const snapshot = (window as any).__PLAY_HOST__?.getSnapshot?.() ?? null;
    const ctrl = Array.isArray(snapshot?.ctrl) ? snapshot.ctrl : null;
    return !!ctrl && Math.abs(Number(ctrl[1]) - 1) < 1e-6;
  }, { timeout: 20_000, polling: 100 });
});
