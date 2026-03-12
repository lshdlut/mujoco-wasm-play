import { expect, test } from '@playwright/test';
import { waitForViewerReady } from './test-utils';

async function enableSiteLabels(page: any) {
  await page.evaluate(async () => {
    const controls = (window as any).__viewerControls;
    if (!controls?.listIds || !controls?.toggleControl || !controls?.getControl) {
      throw new Error('__viewerControls helpers are not available');
    }
    const ids: string[] = controls.listIds('');
    const labelId = ids.find((id) => controls.getControl(id)?.binding === 'mjvOption::label');
    if (!labelId) throw new Error('label mode control not found');
    await controls.toggleControl(labelId, 4);
    (window as any).__viewerRenderer?.renderScene?.(
      (window as any).__PLAY_HOST__?.getSnapshot?.(),
      (window as any).__viewerStore?.get?.(),
    );
  });
}

test('site labels use projected scene anchors and are no longer capped at 120', async ({ page }) => {
  await waitForViewerReady(page, '/index.html?model=raj&ver=3.5.0');
  await enableSiteLabels(page);

  await expect.poll(async () => {
    return page.evaluate(() => (window as any).__renderCtx?.labelOverlay?.drawnCount ?? 0);
  }, { timeout: 20_000 }).toBeGreaterThan(120);

  await expect.poll(async () => {
    return page.evaluate(() => {
      const ctx = (window as any).__renderCtx;
      const overlay = ctx?.labelOverlay || null;
      const camera = ctx?.camera || null;
      const sample = overlay?.sample || null;
      if (!overlay || !camera || !sample) return null;
      const anchor = camera.position.clone();
      anchor.set(sample.anchorWorld[0], sample.anchorWorld[1], sample.anchorWorld[2]);
      anchor.project(camera);
      const x = (anchor.x * 0.5 + 0.5) * overlay.width;
      const y = (-anchor.y * 0.5 + 0.5) * overlay.height;
      return Math.hypot(x - sample.screen[0], y - sample.screen[1]);
    });
  }, { timeout: 20_000 }).toBeLessThan(0.5);

  await expect.poll(async () => {
    return page.evaluate(() => (window as any).__renderCtx?.labelOverlay?.fontPx ?? null);
  }, { timeout: 20_000 }).toBe(12);
});

test('site labels keep fixed pixel size when the camera moves', async ({ page }) => {
  await waitForViewerReady(page, '/index.html?model=raj&ver=3.5.0');
  await enableSiteLabels(page);

  await expect.poll(async () => {
    return page.evaluate(() => (window as any).__renderCtx?.labelOverlay?.fontPx ?? null);
  }, { timeout: 20_000 }).toBe(12);
  const before = await page.evaluate(() => (window as any).__renderCtx?.labelOverlay?.fontPx ?? null);

  await page.evaluate(async () => {
    const ctx = (window as any).__renderCtx;
    if (!ctx?.camera) throw new Error('render camera missing');
    ctx.camera.position.multiplyScalar(0.6);
    ctx.camera.updateProjectionMatrix?.();
    ctx.camera.updateMatrixWorld?.();
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });

  await expect.poll(async () => {
    return page.evaluate(() => (window as any).__renderCtx?.labelOverlay?.fontPx ?? null);
  }, { timeout: 20_000 }).toBe(before);
});

test('site labels stay suppressed when hideAllGeometry is active', async ({ page }) => {
  await waitForViewerReady(page, '/index.html?model=raj&ver=3.5.0');
  await enableSiteLabels(page);

  await expect.poll(async () => {
    return page.evaluate(() => (window as any).__renderCtx?.labelOverlay?.drawnCount ?? 0);
  }, { timeout: 20_000 }).toBeGreaterThan(0);

  await page.evaluate(() => {
    const store = (window as any).__viewerStore;
    const renderer = (window as any).__viewerRenderer;
    const snapshot = (window as any).__PLAY_HOST__?.getSnapshot?.();
    if (!store?.update) throw new Error('__viewerStore.update unavailable');
    store.update((draft: any) => {
      if (!draft.rendering) draft.rendering = {};
      draft.rendering.hideAllGeometry = true;
    });
    renderer?.renderScene?.(snapshot, store.get());
  });

  await expect.poll(async () => {
    return page.evaluate(() => (window as any).__renderCtx?.labelOverlay?.drawnCount ?? -1);
  }, { timeout: 20_000 }).toBe(0);
});
