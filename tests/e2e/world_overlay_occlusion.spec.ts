import { expect, test } from '@playwright/test';
import { waitForViewerReady } from './test-utils';

test('overlay3d layer assignment applies to nested object trees', async ({ page }) => {
  test.setTimeout(120_000);

  await waitForViewerReady(page, '/index.html?model=raj&ver=3.5.0&snapshot=1&log=0', { timeoutMs: 90_000 });

  const layerState = await page.evaluate(async () => {
    const host = (window as any).__PLAY_HOST__;
    const overlay = host?.renderer?.overlay3d?.get?.() ?? host?.renderer?.getOverlay3D?.();
    if (!overlay?.createScope) throw new Error('overlay3d manager missing');
    const existing = (window as any).__testOverlayScope;
    if (existing?.dispose) existing.dispose();

    const groupRoot = overlay.layers?.worldOpaque;
    const ground = (window as any).__renderCtx?.ground;
    const GroupCtor = groupRoot?.constructor;
    const MeshCtor = ground?.constructor;
    const GeometryCtor = ground?.geometry?.constructor;
    const MaterialCtor = ground?.material?.constructor;
    if (!GroupCtor || !MeshCtor || !GeometryCtor || !MaterialCtor) {
      throw new Error('three constructors unavailable');
    }

    const scope = overlay.createScope('test:world-occlusion-tree');
    const root = new GroupCtor();
    const childGroup = new GroupCtor();
    const childMesh = new MeshCtor(
      new GeometryCtor(0.1, 0.1),
      new MaterialCtor({ color: 0xff00ff, opacity: 0.6, transparent: false, depthWrite: true })
    );
    childGroup.add(childMesh);
    root.add(childGroup);
    scope.addObject3D(root, { layer: 'worldOverlay' });
    (window as any).__testOverlayScope = scope;

    return {
      rootLayer: root.userData?.overlay3dLayer ?? null,
      childLayer: childMesh.userData?.overlay3dLayer ?? null,
      rootRenderOrder: root.renderOrder,
      childRenderOrder: childMesh.renderOrder,
      childTransparent: !!childMesh.material?.transparent,
      childDepthWrite: !!childMesh.material?.depthWrite,
      childDepthTest: !!childMesh.material?.depthTest,
      childOpacity: Number(childMesh.material?.opacity ?? NaN),
    };
  });

  expect(layerState.rootLayer).toBe('worldOverlay');
  expect(layerState.childLayer).toBe('worldOverlay');
  expect(layerState.rootRenderOrder).toBe(10);
  expect(layerState.childRenderOrder).toBe(10);
  expect(layerState.childTransparent).toBeTruthy();
  expect(layerState.childDepthWrite).toBe(false);
  expect(layerState.childDepthTest).toBe(true);
  expect(layerState.childOpacity).toBeCloseTo(0.6, 3);

  await page.evaluate(() => {
    const existing = (window as any).__testOverlayScope;
    if (existing?.dispose) existing.dispose();
    (window as any).__testOverlayScope = null;
  });
});

test('worldOverlay batches remain occluded by ground and visible above it', async ({ page }) => {
  test.setTimeout(120_000);

  await waitForViewerReady(page, '/index.html?model=raj&ver=3.5.0&snapshot=1&log=0', { timeoutMs: 90_000 });

  await page.evaluate(() => {
    const ctx = (window as any).__renderCtx;
    const cam = ctx?.camera;
    if (!cam) throw new Error('render camera missing');
    const ack = Number(ctx?.viewerCameraSyncSeqAck ?? 0) | 0;
    ctx.viewerCameraSyncSeqSent = ack + 1;
    ctx.viewerCameraSynced = false;
    cam.position.set(0, -3.2, 1.2);
    cam.up.set(0, 0, 1);
    cam.lookAt(0, 0, 0.15);
    cam.updateMatrixWorld(true);
    cam.updateProjectionMatrix?.();
  });
  await page.waitForTimeout(200);

  const sampleOverlayPixel = async (z: number, rgb: [number, number, number]) => page.evaluate(async ({ zValue, color }) => {
    const host = (window as any).__PLAY_HOST__;
    const overlay = host?.renderer?.overlay3d?.get?.() ?? host?.renderer?.getOverlay3D?.();
    if (!overlay?.createScope) throw new Error('overlay3d manager missing');
    const existing = (window as any).__testOverlayScope;
    if (existing?.dispose) existing.dispose();
    const scope = overlay.createScope('test:world-occlusion');
    const batch = scope.createPointsBatch({
      name: 'test:world-occlusion-point',
      layer: 'worldOverlay',
      capacity: 1,
      size: 180,
      sizeAttenuation: false,
      opacity: 1,
    });
    batch.writer.pos[0] = 0;
    batch.writer.pos[1] = 0;
    batch.writer.pos[2] = zValue;
    batch.writer.rgb[0] = color[0];
    batch.writer.rgb[1] = color[1];
    batch.writer.rgb[2] = color[2];
    batch.commit({ count: 1 });
    (window as any).__testOverlayScope = scope;

    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

    const ctx = (window as any).__renderCtx;
    const canvas = ctx?.renderer?.domElement;
    if (!(canvas instanceof HTMLCanvasElement)) throw new Error('viewer canvas missing');
    const sampleCanvas = document.createElement('canvas');
    sampleCanvas.width = canvas.width;
    sampleCanvas.height = canvas.height;
    const sampleCtx = sampleCanvas.getContext('2d');
    if (!sampleCtx) throw new Error('2d sample context missing');
    sampleCtx.drawImage(canvas, 0, 0);
    const cx = Math.max(3, Math.min(sampleCanvas.width - 4, Math.floor(sampleCanvas.width / 2)));
    const cy = Math.max(3, Math.min(sampleCanvas.height - 4, Math.floor(sampleCanvas.height / 2)));
    let sumR = 0;
    let sumG = 0;
    let sumB = 0;
    let count = 0;
    for (let dy = -3; dy <= 3; dy += 1) {
      for (let dx = -3; dx <= 3; dx += 1) {
        const pixel = sampleCtx.getImageData(cx + dx, cy + dy, 1, 1).data;
        sumR += pixel[0];
        sumG += pixel[1];
        sumB += pixel[2];
        count += 1;
      }
    }
    return {
      r: sumR / count,
      g: sumG / count,
      b: sumB / count,
    };
  }, { zValue: z, color: rgb });

  const below = await sampleOverlayPixel(-0.25, [1, 0, 0]);
  const above = await sampleOverlayPixel(0.35, [0, 1, 0]);

  expect(below.r).toBeLessThan(180);
  expect(above.g).toBeGreaterThan(160);
  expect(above.g).toBeGreaterThan(above.r + 40);
  expect(above.g).toBeGreaterThan(below.g + 60);

  await page.evaluate(() => {
    const existing = (window as any).__testOverlayScope;
    if (existing?.dispose) existing.dispose();
    (window as any).__testOverlayScope = null;
  });
});
