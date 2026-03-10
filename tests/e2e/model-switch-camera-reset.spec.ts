import { test, expect } from '@playwright/test';
import { ensureSectionExpanded, waitForViewerReady } from './test-utils';

function expectedPosFromMjv(cam: any) {
  const dist = Number(cam?.distance);
  const az = Number(cam?.azimuth);
  const el = Number(cam?.elevation);
  const lookat = Array.isArray(cam?.lookat) ? cam.lookat : null;
  if (!Number.isFinite(dist) || dist <= 0) return null;
  if (!Number.isFinite(az) || !Number.isFinite(el)) return null;
  if (!lookat || lookat.length < 3) return null;
  const azRad = az * Math.PI / 180;
  const elRad = el * Math.PI / 180;
  const ca = Math.cos(azRad);
  const sa = Math.sin(azRad);
  const ce = Math.cos(elRad);
  const se = Math.sin(elRad);
  return {
    x: (Number(lookat[0]) || 0) - dist * (ce * ca),
    y: (Number(lookat[1]) || 0) - dist * (ce * sa),
    z: (Number(lookat[2]) || 0) - dist * (se),
  };
}

test('switching builtin model resets camera via load-align', async ({ page }) => {
  test.setTimeout(180_000);

  await waitForViewerReady(page, '/index.html?model=raj&ver=3.5.0&snapshot=1&log=0', { timeoutMs: 120_000 });
  await ensureSectionExpanded(page, 'file');

  // Ensure renderer has seen align seq > 1, so a worker restart would normally wrap.
  await page.evaluate(() => (window as any).__PLAY_HOST__?.backend?.apply?.({ kind: 'ui', id: 'simulation.align' }));
  await page.waitForFunction(() => {
    const seq = Number((window as any).__PLAY_HOST__?.getSnapshot?.()?.align?.seq) || 0;
    return seq >= 2;
  }, { timeout: 60_000 });

  const before = await page.evaluate(() => {
    const snapshot = (window as any).__PLAY_HOST__?.getSnapshot?.() || null;
    const alignTs = Number(snapshot?.align?.timestamp) || 0;
    const ctx = (window as any).__renderCtx;
    const cam = ctx?.camera;
    return {
      ts: alignTs,
      pos: cam ? { x: Number(cam.position?.x) || 0, y: Number(cam.position?.y) || 0, z: Number(cam.position?.z) || 0 } : null,
    };
  });
  expect(before.pos).toBeTruthy();

  await page.evaluate(() => {
    const select = document.querySelector('[data-testid="file.model_select"]');
    if (!(select instanceof HTMLSelectElement)) throw new Error('file.model_select not found');
    const opt = Array.from(select.options).find((o) => (o.textContent || '').includes('humanoid/humanoid'));
    if (!opt) throw new Error('humanoid/humanoid option not found');
    select.value = opt.value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });

  await page.waitForFunction(() => {
    const label = (window as any).__viewerStore?.get()?.shell?.modelLabel || '';
    return String(label) === 'humanoid/humanoid';
  }, { timeout: 120_000 });

  await page.waitForFunction((prevTs) => {
    const a = (window as any).__PLAY_HOST__?.getSnapshot?.()?.align;
    if (!a) return false;
    const ts = Number(a.timestamp) || 0;
    return a.source === 'load' && !!a.camera && ts > (Number(prevTs) || 0);
  }, before.ts, { timeout: 120_000 });

  await page.waitForTimeout(200);

  const after = await page.evaluate(() => {
    const snapshot = (window as any).__PLAY_HOST__?.getSnapshot?.() || null;
    const alignCam = snapshot?.align?.camera ?? null;
    const ctx = (window as any).__renderCtx;
    const cam = ctx?.camera;
    return {
      pos: cam ? { x: Number(cam.position?.x) || 0, y: Number(cam.position?.y) || 0, z: Number(cam.position?.z) || 0 } : null,
      alignCamera: alignCam,
    };
  });
  expect(after.pos).toBeTruthy();
  expect(after.alignCamera).toBeTruthy();

  const expected = expectedPosFromMjv(after.alignCamera);
  expect(expected).toBeTruthy();
  const d =
    Math.abs(Number(expected!.x) - Number(after.pos!.x)) +
    Math.abs(Number(expected!.y) - Number(after.pos!.y)) +
    Math.abs(Number(expected!.z) - Number(after.pos!.z));
  expect(d).toBeLessThan(1e-3);

  const moved =
    Math.abs(Number(before.pos!.x) - Number(after.pos!.x)) +
    Math.abs(Number(before.pos!.y) - Number(after.pos!.y)) +
    Math.abs(Number(before.pos!.z) - Number(after.pos!.z));
  expect(moved).toBeGreaterThan(1e-2);
});
