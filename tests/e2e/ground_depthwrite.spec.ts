import { test, expect } from '@playwright/test';
import { waitForViewerReady } from './test-utils';

function readGroundState() {
  const ctx = (window as any).__renderCtx;
  const ground =
    ctx?.ground ||
    (Array.isArray(ctx?.meshes) ? ctx.meshes.find((m: any) => m?.userData?.infinitePlane) : null);
  const mat = ground?.material;
  return {
    found: !!ground,
    transparent: !!mat?.transparent,
    depthWrite: !!mat?.depthWrite,
    opacity: typeof mat?.opacity === 'number' ? mat.opacity : null,
    renderOrder: typeof ground?.renderOrder === 'number' ? ground.renderOrder : null,
  };
}

for (const model of ['raj', 'humanoid']) {
  test(`infinite ground toggles depthWrite and order for underside view (${model})`, async ({ page }) => {
    test.setTimeout(120_000);

    await waitForViewerReady(page, `/index.html?model=${model}&ver=3.5.0&snapshot=1&log=0`, { timeoutMs: 90_000 });

    const above = await page.evaluate(readGroundState);
    expect(above.found).toBeTruthy();
    expect(above.transparent).toBeTruthy();
    expect(above.depthWrite).toBe(true);
    expect(typeof above.opacity).toBe('number');
    expect(typeof above.renderOrder).toBe('number');
    expect(Number(above.renderOrder)).toBeLessThan(0);

    await page.evaluate(() => {
      const ctx = (window as any).__renderCtx;
      const cam = ctx?.camera;
      if (!cam) throw new Error('render camera missing');
      // Disable wasm-camera snapshot override so we can force a below-plane pose.
      // (In the real app, the worker-driven camera can also go below; this just
      // keeps the test deterministic.)
      const ack = Number(ctx?.viewerCameraSyncSeqAck ?? 0) | 0;
      ctx.viewerCameraSyncSeqSent = ack + 1;
      ctx.viewerCameraSynced = false;
      cam.position.set(0, -1.5, -1.0);
      cam.up.set(0, 0, 1);
      cam.lookAt(0, 0, 0);
      cam.updateMatrixWorld(true);
    });
    await page.waitForFunction(() => {
      const ctx = (window as any).__renderCtx;
      const ground =
        ctx?.ground ||
        (Array.isArray(ctx?.meshes) ? ctx.meshes.find((m: any) => m?.userData?.infinitePlane) : null);
      const mat = ground?.material;
      if (!mat) return false;
      return mat.depthWrite === false && typeof ground?.renderOrder === 'number' && ground.renderOrder > 0;
    });

    const below = await page.evaluate(readGroundState);
    expect(below.found).toBeTruthy();
    expect(below.transparent).toBeTruthy();
    expect(below.depthWrite).toBe(false);
    expect(typeof below.renderOrder).toBe('number');
    expect(Number(below.renderOrder)).toBeGreaterThan(0);
  });
}
