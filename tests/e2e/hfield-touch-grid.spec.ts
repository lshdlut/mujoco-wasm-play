import { test, expect } from '@playwright/test';
import { waitForViewerReady } from './test-utils';

function readHfieldMeshSummary() {
  const ctx = (window as any).__renderCtx;
  const meshes = Array.isArray(ctx?.meshes) ? ctx.meshes : [];
  const mesh =
    meshes.find((m: any) => m?.userData?.geomName === 'a') ||
    meshes.find((m: any) => (m?.userData?.geomType | 0) === 1) ||
    null;
  const geom = mesh?.geometry || null;
  const pos = geom?.getAttribute?.('position') || null;
  const index = geom?.getIndex?.() || null;
  const bb = geom?.boundingBox || null;
  return {
    found: !!mesh,
    geomType: mesh?.userData?.geomType ?? null,
    positionCount: typeof pos?.count === 'number' ? pos.count : 0,
    indexCount: typeof index?.count === 'number' ? index.count : 0,
    bboxZSpan: bb ? (Number(bb.max?.z) - Number(bb.min?.z)) : null,
  };
}

test('touch_grid hfield geom "a" renders as heightfield (not a plane)', async ({ page }) => {
  test.setTimeout(120_000);

  await waitForViewerReady(page, '/index.html?model=sensor&ver=3.5.0&snapshot=1&log=0', { timeoutMs: 90_000 });

  await page.waitForFunction(() => {
    const ctx = (window as any).__renderCtx;
    const meshes = Array.isArray(ctx?.meshes) ? ctx.meshes : [];
    const mesh =
      meshes.find((m: any) => m?.userData?.geomName === 'a') ||
      meshes.find((m: any) => (m?.userData?.geomType | 0) === 1) ||
      null;
    const pos = mesh?.geometry?.getAttribute?.('position') || null;
    return !!pos && typeof pos.count === 'number' && pos.count > 16;
  }, { timeout: 30_000 });

  const summary = await page.evaluate(readHfieldMeshSummary);
  expect(summary.found).toBeTruthy();
  expect(summary.positionCount).toBeGreaterThan(16);
  expect(summary.bboxZSpan == null || summary.bboxZSpan > 0).toBeTruthy();
});
