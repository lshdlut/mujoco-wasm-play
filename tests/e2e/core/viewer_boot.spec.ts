import { expect, test } from '@playwright/test';

import { waitForViewerReady } from '../test-utils';

test.describe('viewer boot and basic progression', () => {
  test('default index init debug', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (err) => {
      pageErrors.push(err?.stack || String(err));
    });
    page.on('console', (msg) => {
      console.log('[console]', msg.type(), msg.text());
    });

    const url = process.env.MJWF_INIT_URL || `/index.html?debug=1&snapshot=1&log=1`;
    const timeoutMsRaw = process.env.MJWF_INIT_TIMEOUT_MS || '';
    const timeoutMs = Number.parseInt(timeoutMsRaw, 10);
    const timeout = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 60_000;

    await page.goto(url);
    await page.waitForFunction(() => {
      const store = (window as any).__viewerStore;
      const ctx = (window as any).__renderCtx;
      const controls = (window as any).__viewerControls;
      const snap = (window as any).__PLAY_HOST__?.getSnapshot?.();
      const scnNgeom = Number(snap?.scn_ngeom) | 0;
      return !!ctx?.initialized && !!store?.get && !!controls && scnNgeom > 0;
    }, { timeout });

    const canvas = page.locator('[data-testid="viewer-canvas"]');
    const box = await canvas.boundingBox();
    expect(box).toBeTruthy();
    const cx = (box?.x || 0) + (box?.width || 0) / 2;
    const cy = (box?.y || 0) + (box?.height || 0) / 2;
    await page.mouse.move(cx, cy);
    await page.mouse.down({ button: 'left' });
    await page.mouse.move(cx + 32, cy + 16);
    await page.mouse.up();
    await page.mouse.click(cx, cy);
    expect(pageErrors, pageErrors.join('\n\n')).toEqual([]);
    await page.waitForTimeout(1500);
  });

  test('worker simulation time advances', async ({ page }) => {
    const url =
      `/index.html?model=${encodeURIComponent('mujoco_Rajagopal2015_simple.xml')}` +
      `&mode=worker&snapshot=1&log=0` +
      `&forgeBase=${encodeURIComponent('/dist/3.4.0/')}`;

    await waitForViewerReady(page, url);

    const t0 = await page.evaluate(() => {
      const snap = (window as any).__PLAY_HOST__?.getSnapshot?.() ?? null;
      return typeof snap?.t === 'number' ? snap.t : null;
    });
    expect(t0).not.toBeNull();

    await page.waitForTimeout(750);

    const t1 = await page.evaluate(() => {
      const snap = (window as any).__PLAY_HOST__?.getSnapshot?.() ?? null;
      return typeof snap?.t === 'number' ? snap.t : null;
    });
    expect(t1).not.toBeNull();
    expect((t1 as number) - (t0 as number)).toBeGreaterThan(1e-3);
  });

  test('single-Raj default -> run -> reset memory behaviour', async ({ page }) => {
    test.setTimeout(180_000);

    const url =
      `/index.html?model=${encodeURIComponent('mujoco_Rajagopal2015_simple.xml')}` +
      `&mode=worker&snapshot=1`;

    await waitForViewerReady(page, url);

    const readTime = async () => {
      return page.evaluate(() => {
        const snap = (window as any).__PLAY_HOST__?.getSnapshot?.();
        const t = Number(snap?.t);
        return Number.isFinite(t) ? t : NaN;
      });
    };

    await page.waitForTimeout(500);
    const init = await readTime();
    await page.keyboard.press(' ');
    await page.waitForTimeout(1000);
    const afterRun = await readTime();

    await page.keyboard.press('Backspace');
    await page.waitForTimeout(2500);
    const afterReset = await readTime();

    expect(Number.isFinite(afterReset)).toBeTruthy();
    expect(afterRun).toBeGreaterThanOrEqual(init);
    expect(afterReset).toBeLessThanOrEqual(init + 1e-3);
  });
});
