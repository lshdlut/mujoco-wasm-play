import { test, expect } from '@playwright/test';

// Debug helper: hit the same URL as local dev_server usage
// and stream console output, to inspect worker / WASM loading.
test('default index init debug', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (err) => {
    pageErrors.push(err?.stack || String(err));
  });
  page.on('console', (msg) => {
    // eslint-disable-next-line no-console
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
    const snap = (window as any).__lastSnapshot;
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
