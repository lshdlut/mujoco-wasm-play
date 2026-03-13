import { test, expect } from '@playwright/test';

test('strict gate: six action sequences', async ({ page }) => {
  await page.goto('/index.html?model=simplest.xml&strict=1&compat=0');
  await page.waitForFunction(() => window.__viewerControls && window.__viewerStore && window.__PLAY_HOST__?.getSnapshot?.());

  await page.evaluate(() => {
    if (typeof window.__PLAY_STRICT_CLEAR__ === 'function') {
      window.__PLAY_STRICT_CLEAR__();
    }
  });

  const canvas = page.locator('[data-testid="viewer-canvas"]');
  await canvas.click({ position: { x: 10, y: 10 } });

  // 1) Load minimal model (initial URL already sets simplest.xml).
  await page.waitForFunction(() => window.__PLAY_HOST__?.getSnapshot?.() && typeof window.__PLAY_HOST__?.getSnapshot?.().ngeom === 'number');

  // 2) Run/pause/step.
  await page.keyboard.press('Space');
  await page.waitForTimeout(150);
  await page.keyboard.press('Space');
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(100);

  // 3) Camera control + picking.
  const box = await canvas.boundingBox();
  if (!box) throw new Error('viewer canvas not found');
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down({ button: 'left' });
  await page.mouse.move(cx + 40, cy + 20);
  await page.mouse.up();
  await page.mouse.click(cx, cy);

  // 4) Toggle overlay/info/watch.
  await page.evaluate(async () => {
    const controls = window.__viewerControls;
    if (!controls?.toggleControl) throw new Error('viewer controls missing');
    await controls.toggleControl('option.info', true);
    await controls.toggleControl('option.info', false);
    await controls.toggleControl('watch.field', 'qpos');
    await controls.toggleControl('watch.index', 0);
  });

  // 5) Switch UI presets.
  await page.evaluate(async () => {
    const controls = window.__viewerControls;
    if (!controls?.toggleControl) throw new Error('viewer controls missing');
    await controls.toggleControl('option.visual_source', 'PresetSun');
    await controls.toggleControl('option.visual_source', 'PresetMoon');
    await controls.toggleControl('option.visual_source', 'Model');
  });

  // 6) Reload xml/mjb (reload current model).
  await page.evaluate(async () => {
    const controls = window.__viewerControls;
    if (!controls?.toggleControl) throw new Error('viewer controls missing');
    await controls.toggleControl('simulation.reload');
  });
  await page.waitForTimeout(200);

  const report = await page.evaluate(() => window.__PLAY_STRICT_REPORT__?.());
  const mainReport = report?.main ?? report;
  const workerReport = report?.worker ?? null;
  expect(mainReport?.enabled).toBe(true);
  if (workerReport) {
    expect(workerReport.enabled).toBe(true);
  }
  const counts = [
    ...(mainReport?.counts || []),
    ...(workerReport?.counts || []),
  ];
  const fallbackCount = counts.filter((entry) => entry.kind === 'fallback').length;
  expect(fallbackCount).toBe(0);
});

