import { test, expect } from '@playwright/test';
import { waitForViewerReady } from './test-utils';

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

async function triggerAlignAndReadCamera(page: any) {
  const beforeSeq = await page.evaluate(() => Number((window as any).__viewerStore?.get()?.runtime?.lastAlign?.seq) || 0);
  await page.evaluate(() => (window as any).__PLAY_HOST__?.backend?.apply?.({ kind: 'ui', id: 'simulation.align' }));
  await page.waitForFunction((seq) => {
    const next = Number((window as any).__viewerStore?.get()?.runtime?.lastAlign?.seq) || 0;
    return next > (Number(seq) || 0);
  }, beforeSeq, { timeout: 60_000 });
  await page.waitForTimeout(150);
  return page.evaluate(() => {
    const ctx = (window as any).__renderCtx;
    const cam = ctx?.camera;
    const alignCam = (window as any).__viewerStore?.get()?.runtime?.lastAlign?.camera ?? null;
    if (!cam) return null;
    return {
      pos: { x: Number(cam.position?.x) || 0, y: Number(cam.position?.y) || 0, z: Number(cam.position?.z) || 0 },
      alignCamera: alignCam,
    };
  });
}

test('Align view is stable across joint translation', async ({ page }) => {
  test.setTimeout(180_000);

  const url = `/index.html?model=raj&ver=3.5.0&snapshot=1&log=1`;
  await waitForViewerReady(page, url, { timeoutMs: 120_000 });

  const posA = await triggerAlignAndReadCamera(page);
  expect(posA).toBeTruthy();
  expect(posA.alignCamera).toBeTruthy();
  const expectedA = expectedPosFromMjv(posA.alignCamera);
  expect(expectedA).toBeTruthy();
  const da =
    Math.abs(Number(expectedA!.x) - Number(posA.pos.x)) +
    Math.abs(Number(expectedA!.y) - Number(posA.pos.y)) +
    Math.abs(Number(expectedA!.z) - Number(posA.pos.z));
  expect(da).toBeLessThan(1e-3);

  const moved = await page.evaluate(async () => {
    const snap: any = (window as any).__lastSnapshot;
    const names: any = snap?.jnt_names;
    const adr: any = snap?.jnt_qposadr;
    if (!Array.isArray(names) || !adr) {
      return { ok: false, reason: 'missing joint meta' };
    }
    const j = names.findIndex((name: any) => String(name) === 'pelvis_tx');
    if (j < 0) {
      return { ok: false, reason: 'pelvis_tx not found' };
    }
    const qposIndex = (adr[j] | 0);
    if (!(qposIndex >= 0)) {
      return { ok: false, reason: 'invalid qpos index' };
    }

    const range: any = snap?.jnt_range;
    let lo = -1;
    let hi = 1;
    if (range && typeof range.length === 'number' && range.length >= (j * 2 + 2)) {
      const rLo = Number(range[j * 2]) || 0;
      const rHi = Number(range[j * 2 + 1]) || 0;
      if (Number.isFinite(rLo) && Number.isFinite(rHi) && rHi > rLo) {
        lo = rLo;
        hi = rHi;
      }
    }
    const target = lo + (hi - lo) * 0.75;

    const backend = (window as any).__PLAY_HOST__?.backend;
    if (!backend?.apply) return { ok: false, reason: 'backend unavailable' };
    await backend.apply({ kind: 'ui', id: 'joint.slider', value: { index: qposIndex, value: target, min: lo, max: hi } });
    return { ok: true, qposIndex, target };
  });
  expect(moved.ok, moved.reason).toBeTruthy();

  await page.waitForTimeout(400);

  const posB = await triggerAlignAndReadCamera(page);
  expect(posB).toBeTruthy();
  expect(posB.alignCamera).toBeTruthy();

  const dx = Math.abs(Number(posA.pos.x) - Number(posB.pos.x));
  const dy = Math.abs(Number(posA.pos.y) - Number(posB.pos.y));
  const dz = Math.abs(Number(posA.pos.z) - Number(posB.pos.z));
  expect(dx + dy + dz).toBeLessThan(1e-3);
});
