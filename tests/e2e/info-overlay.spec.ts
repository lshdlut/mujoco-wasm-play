import { test, expect } from '@playwright/test';
import { waitForViewerReady } from './test-utils';

async function openInfoOverlay(page: any, url = '/index.html?model=demo_box.xml') {
  await waitForViewerReady(page, url);
  // Ensure viewer loop is running for FPS and info updates.
  await page.evaluate(() => {
    const renderer = (window as any).__viewerRenderer;
    const store = (window as any).__viewerStore;
    if (renderer?.ensureLoop && store?.get) {
      renderer.ensureLoop();
    }
    const s = store?.get?.();
    if (s && s.overlays && !s.overlays.info && typeof store.update === 'function') {
      store.update((draft: any) => {
        draft.overlays.info = true;
      });
    }
  });
  const card = page.locator('[data-testid="overlay-info"]');
  await expect(card).toBeVisible();
  return card;
}

test.describe('F2 info overlay stats', () => {
  test('Size row shows nefc/ncon when running', async ({ page }) => {
    const card = await openInfoOverlay(page);
    // Let a few frames render to populate info.
    await page.waitForTimeout(500);
    const sizeText = await card.locator('.info-value[data-info-field="size"]').innerText();
    // At minimum we expect something like "nefc (ncon con)".
    expect(sizeText).toMatch(/\d+\s*\(\d+\s+con\)/);
  });

  test('FPS row reports positive fps while running', async ({ page }) => {
    const card = await openInfoOverlay(page);
    // Wait for render loop and FPS estimate to stabilise.
    await page.waitForFunction(() => {
      const store = (window as any).__viewerStore;
      const state = store?.get?.();
      if (!state) return false;
      const textEl = document.querySelector('.info-value[data-info-field="fps"]');
      if (!textEl) return false;
      const text = textEl.textContent || '';
      const num = Number.parseFloat(text);
      return Number.isFinite(num) && num > 0.5;
    }, { timeout: 5000 });
    const fpsText = await card.locator('.info-value[data-info-field="fps"]').innerText();
    const value = Number.parseFloat(fpsText);
    expect(Number.isFinite(value)).toBe(true);
    expect(value).toBeGreaterThan(0.5);
  });

  test('Memory/Energy/Islands rows do not stay all-n/a after warmup', async ({ page }) => {
    const card = await openInfoOverlay(page);
    // Warm up a bit to give the backend time to collect stats.
    await page.waitForTimeout(1000);
    const memoryText = await card.locator('.info-value[data-info-field="memory"]').innerText();
    const energyText = await card.locator('.info-value[data-info-field="energy"]').innerText();
    const islandsText = await card.locator('.info-value[data-info-field="islands"]').innerText();

    // Allow "n/a" for fields that the current ABI cannot populate,
    // but require at least one of {memory, energy, islands} to carry a numeric payload.
    const hasNumericMemory = /[0-9]/.test(memoryText) && !/n\/a/i.test(memoryText);
    const energyVal = Number.parseFloat(energyText);
    const islandsVal = Number.parseInt(islandsText, 10);

    expect(
      hasNumericMemory ||
      (Number.isFinite(energyVal) && energyVal !== 0) ||
      (Number.isFinite(islandsVal) && islandsVal >= 0),
    ).toBe(true);
  });

  test('Raj debug snapshot pipeline carries info payload', async ({ page }) => {
    // Mirror the user flow: debug=1&snapshot=1, default model (Raj alias).
    await waitForViewerReady(page, '/index.html?debug=1&snapshot=1');
    const card = await openInfoOverlay(page, '/index.html?debug=1&snapshot=1');
    await page.waitForTimeout(800);
    const infoDump = await page.evaluate(() => {
      const store = (window as any).__viewerStore;
      const state = store?.get?.();
      const hudInfo = state?.hud?.info ?? null;
      const lastSnap = (window as any).__lastSnapshot ?? null;
      return {
        hudInfo,
        hudTime: state?.hud?.time ?? null,
        simRun: !!state?.simulation?.run,
        snapshotInfo: lastSnap?.info ?? null,
        debugInfo: (window as any).__infoDebug ?? null,
      };
    });
    // Log to test output for debugging.
    console.log('raj-debug-info', JSON.stringify(infoDump));
    // At minimum, snapshot.info should exist and be an object when running.
    expect(infoDump.snapshotInfo && typeof infoDump.snapshotInfo === 'object').toBe(true);
    expect(infoDump.simRun).toBe(true);
  });
});
