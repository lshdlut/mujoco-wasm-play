import { expect, test } from '@playwright/test';
import { waitForViewerReady } from './test-utils';

function readGroundState() {
  const ctx = (window as any).__renderCtx;
  const ground =
    ctx?.ground ||
    (Array.isArray(ctx?.meshes) ? ctx.meshes.find((m: any) => m?.userData?.infinitePlane) : null);
  const mat = ground?.material;
  const occluder = ground?.userData?.infiniteGround?.occluder || null;
  const occluderMat = occluder?.material || null;
  return {
    found: !!ground,
    transparent: !!mat?.transparent,
    depthWrite: !!mat?.depthWrite,
    opacity: typeof mat?.opacity === 'number' ? mat.opacity : null,
    renderOrder: typeof ground?.renderOrder === 'number' ? ground.renderOrder : null,
    occluderFound: !!occluder,
    occluderTransparent: !!occluderMat?.transparent,
    occluderDepthWrite: !!occluderMat?.depthWrite,
    occluderColorWrite: !!occluderMat?.colorWrite,
    occluderRenderOrder: typeof occluder?.renderOrder === 'number' ? occluder.renderOrder : null,
  };
}

for (const model of ['raj', 'humanoid']) {
  test(`infinite ground keeps visual and depth occlusion stable above/below the plane (${model})`, async ({ page }) => {
    test.setTimeout(120_000);

    await waitForViewerReady(page, `/index.html?model=${model}&ver=3.5.0&snapshot=1&log=0`, { timeoutMs: 90_000 });

    const above = await page.evaluate(readGroundState);
    expect(above.found).toBeTruthy();
    expect(above.transparent).toBeTruthy();
    expect(above.depthWrite).toBe(false);
    expect(typeof above.opacity).toBe('number');
    expect(typeof above.renderOrder).toBe('number');
    expect(Number(above.renderOrder)).toBeLessThan(0);
    expect(above.occluderFound).toBeTruthy();
    expect(above.occluderTransparent).toBe(false);
    expect(above.occluderDepthWrite).toBe(true);
    expect(above.occluderColorWrite).toBe(false);
    expect(typeof above.occluderRenderOrder).toBe('number');
    expect(Number(above.occluderRenderOrder)).toBeLessThan(Number(above.renderOrder));

    await page.evaluate(() => {
      const ctx = (window as any).__renderCtx;
      const cam = ctx?.camera;
      if (!cam) throw new Error('render camera missing');
      const ack = Number(ctx?.viewerCameraSyncSeqAck ?? 0) | 0;
      ctx.viewerCameraSyncSeqSent = ack + 1;
      ctx.viewerCameraSynced = false;
      cam.position.set(0, -1.5, -1.0);
      cam.up.set(0, 0, 1);
      cam.lookAt(0, 0, 0);
      cam.updateMatrixWorld(true);
    });
    await page.waitForTimeout(200);

    const below = await page.evaluate(readGroundState);
    expect(below.found).toBeTruthy();
    expect(below.transparent).toBeTruthy();
    expect(below.depthWrite).toBe(false);
    expect(typeof below.renderOrder).toBe('number');
    expect(below.renderOrder).toBe(above.renderOrder);
    expect(below.occluderFound).toBeTruthy();
    expect(below.occluderTransparent).toBe(false);
    expect(below.occluderDepthWrite).toBe(true);
    expect(below.occluderColorWrite).toBe(false);
    expect(typeof below.occluderRenderOrder).toBe('number');
    expect(below.occluderRenderOrder).toBe(above.occluderRenderOrder);
  });
}
