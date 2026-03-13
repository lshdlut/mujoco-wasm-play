import fsSync from 'node:fs';
import path from 'node:path';
import { Page, expect, test } from '@playwright/test';
import { waitForViewerReady } from '../test-utils';

function localModelPath(model: string) {
  return path.resolve(process.cwd(), model.replace(/\//g, path.sep));
}

test.describe('static transparent parity', () => {
  const MODEL = 'model/slider_crank/slider_crank.xml';
  const FORGE_BASE = '/dist/3.4.0/';

  const MJ_VIS = {
    TRANSPARENT: 18,
    STATIC: 22,
  } as const;

  test('mjVIS_STATIC hides static-body geoms; mjVIS_TRANSPARENT fades dynamic', async ({ page }) => {
    const modelPath = localModelPath(MODEL);
    if (!fsSync.existsSync(modelPath)) {
      test.skip(true, `Missing local model: ${modelPath}`);
    }
    const url =
      `/?model=${encodeURIComponent(MODEL)}` +
      `&mode=worker&snapshot=1` +
      `&forgeBase=${encodeURIComponent(FORGE_BASE)}`;
    await waitForViewerReady(page, url);

    await page.waitForFunction(() => {
      const snapshot = (window as any).__PLAY_HOST__?.getSnapshot?.() ?? null;
      const assets = snapshot?.renderAssets || null;
      const bodies = assets?.bodies || null;
      return (bodies?.count | 0) > 0 && !!bodies?.weldid && !!bodies?.mocapid;
    }, { timeout: 20_000, polling: 250 });

    const diag = await page.evaluate(() => {
      const snapshot = (window as any).__PLAY_HOST__?.getSnapshot?.() ?? null;
      const assets = snapshot?.renderAssets || null;
      const bodies = assets?.bodies || null;
      const weldid = bodies?.weldid || null;
      const mocapid = bodies?.mocapid || null;
      const alpha = Number(snapshot?.visual?.map?.alpha);
      const geomBodyId = snapshot?.geom_bodyid || null;
      return {
        nbody: Number(bodies?.count) || 0,
        worldStatic: weldid && mocapid ? ((weldid[0] | 0) === 0 && (mocapid[0] | 0) === -1) : null,
        alpha: Number.isFinite(alpha) ? alpha : null,
        hasGeomBodyId: !!geomBodyId,
      };
    });
    expect(diag.nbody).toBeGreaterThan(0);
    expect(diag.worldStatic).toBeTruthy();

    const picked = await page.evaluate(() => {
      const snapshot = (window as any).__PLAY_HOST__?.getSnapshot?.() ?? null;
      const bodies = snapshot?.renderAssets?.bodies || null;
      const weldid = bodies?.weldid || null;
      const mocapid = bodies?.mocapid || null;
      const ctx = (window as any).__renderCtx;
      const meshes = Array.isArray(ctx?.meshes) ? ctx.meshes : [];
      if (!meshes.length || !weldid || !mocapid) return null;
      const isStatic = (bid: number) => {
        const id = bid | 0;
        if (id < 0 || id >= weldid.length || id >= mocapid.length) return false;
        return (weldid[id] | 0) === 0 && (mocapid[id] | 0) === -1;
      };
      let staticGeom = -1;
      let dynamicGeom = -1;
      for (let i = 0; i < meshes.length; i += 1) {
        const mesh = meshes[i];
        if (!mesh?.material) continue;
        if (mesh?.userData?.infinitePlane) continue;
        const bid = mesh?.userData?.geomBodyId;
        if (typeof bid !== 'number' || !Number.isFinite(bid)) continue;
        if (staticGeom < 0 && isStatic(bid)) staticGeom = i;
        if (dynamicGeom < 0 && !isStatic(bid)) dynamicGeom = i;
        if (staticGeom >= 0 && dynamicGeom >= 0) break;
      }
      if (staticGeom < 0 || dynamicGeom < 0) return null;
      const dynMat = meshes[dynamicGeom]?.material;
      const dynOpacity = typeof dynMat?.opacity === 'number' ? dynMat.opacity : null;
      const rawAlpha = Number(snapshot?.visual?.map?.alpha);
      const alphaScale = Number.isFinite(rawAlpha) ? rawAlpha : 0;
      return { staticGeom, dynamicGeom, dynOpacity, alphaScale };
    });
    expect(picked).not.toBeNull();

    await page.waitForFunction(
      (idx: number) => {
        const ctx = (window as any).__renderCtx;
        const mesh = Array.isArray(ctx?.meshes) ? ctx.meshes[idx] : null;
        return !!mesh && !!mesh.visible;
      },
      picked!.staticGeom,
      { timeout: 20_000, polling: 250 },
    );

    const staticBox = page.getByRole('switch', { name: 'Static Body' });
    await staticBox.scrollIntoViewIfNeeded();
    if (await staticBox.isChecked()) {
      await staticBox.click();
    }

    await page.waitForFunction(
      (geomIndex: number) => {
        const ctx = (window as any).__renderCtx;
        const mesh = Array.isArray(ctx?.meshes) ? ctx.meshes[geomIndex] : null;
        return !!mesh && !mesh.visible;
      },
      picked!.staticGeom,
      { timeout: 20_000, polling: 250 },
    );

    const transparentBox = page.getByRole('switch', { name: 'Transparent' });
    await transparentBox.scrollIntoViewIfNeeded();
    if (!(await transparentBox.isChecked())) {
      await transparentBox.click();
    }

    const deadline = Date.now() + 20_000;
    let last: any = null;
    while (Date.now() < deadline) {
      last = await page.evaluate(({ geomIndex }: { geomIndex: number }) => {
        const snapshot = (window as any).__PLAY_HOST__?.getSnapshot?.() ?? null;
        const flags = Array.isArray(snapshot?.voptFlags) ? snapshot.voptFlags : [];
        const alphaRaw = Number(snapshot?.visual?.map?.alpha);
        const alphaScale = Number.isFinite(alphaRaw) ? alphaRaw : 0;
        const ctx = (window as any).__renderCtx;
        const mesh = Array.isArray(ctx?.meshes) ? ctx.meshes[geomIndex] : null;
        const mat = mesh?.material;
        const opacity = typeof mat?.opacity === 'number' ? mat.opacity : null;
        return {
          voptTransparent: !!flags[18],
          alphaScale,
          hasMesh: !!mesh,
          visible: !!mesh?.visible,
          opacity,
          matType: mat?.type || null,
        };
      }, { geomIndex: picked!.dynamicGeom });
      const opacity = typeof last?.opacity === 'number' && Number.isFinite(last.opacity) ? last.opacity : null;
      if (last?.voptTransparent && opacity != null) {
        if (last.alphaScale < 0.999) {
          const before = typeof picked!.dynOpacity === 'number' ? picked!.dynOpacity : null;
          if (before != null && opacity < before - 1e-6) break;
        } else if (opacity < 0.999) {
          break;
        } else {
          // alphaScale ~ 1: expect no visible change; accept immediately.
          break;
        }
      }
      await page.waitForTimeout(250);
    }
    if (!last?.voptTransparent) {
      throw new Error(`mjVIS_TRANSPARENT did not latch: ${JSON.stringify(last)}`);
    }
    if (last.alphaScale < 0.999) {
      if (!(typeof last.opacity === 'number' && typeof picked!.dynOpacity === 'number' && last.opacity < picked!.dynOpacity - 1e-6)) {
        throw new Error(`mjVIS_TRANSPARENT did not fade dynamic geom: ${JSON.stringify(last)}`);
      }
    }
  });
});

test.describe('transparent strict ordering', () => {
  const MODEL = 'mujoco_Rajagopal2015_simple.xml';
  const FORGE_BASE = '/dist/3.4.0/';

  async function pauseSimulation(page: Page) {
    await page.evaluate(async () => {
      const controls: any = (window as any).__viewerControls;
      if (!controls?.toggleControl) throw new Error('viewer controls not ready');
      await controls.toggleControl('simulation.run', 0);
    });
    await page.waitForFunction(() => {
      const snapshot = (window as any).__PLAY_HOST__?.getSnapshot?.() ?? null;
      return snapshot?.paused === true;
    }, { timeout: 20_000, polling: 250 });
  }

  test('transparent strict mode sorts instanced batches by depth', async ({ page }) => {
    const tbins = 1;
    const url =
      `/?model=${encodeURIComponent(MODEL)}` +
      `&mode=worker&snapshot=1&log=0&forceBasic=1` +
      `&tbins=${tbins}&tmode=strict` +
      `&forgeBase=${encodeURIComponent(FORGE_BASE)}`;
    await waitForViewerReady(page, url);
    await pauseSimulation(page);

    const diag = await page.evaluate((wantBins) => {
      const ctx: any = (window as any).__renderCtx;
      const inst: any = ctx?._instancing || null;
      if (!ctx || !inst || !(inst.batches instanceof Map)) return { ok: false, reason: 'instancing not active' };

      let found = 0;
      let checked = 0;
      const bad: any[] = [];

      for (const batch of inst.batches.values()) {
        const mesh = batch?.mesh || null;
        const used = batch?.used | 0;
        if (!mesh || !(used > 1)) continue;
        if (!mesh.material?.transparent) continue;
        const key = String(batch.key || '');
        const m = key.match(/:tb(-?\d+)/);
        const bin = m ? (Number(m[1]) | 0) : -1;
        if (bin < 0) continue;
        found += 1;

        const ro = (Number(mesh.renderOrder) || 0) | 0;
        const orderPart = (ro >> 16) | 0;
        const depthPart = ro & 0xffff;
        const expectedOrder = ((wantBins | 0) - 1 - (bin | 0)) | 0;

        const ranks: any = batch.instanceOrderRank || null;
        const canCheckRanks = ranks && typeof ranks.length === 'number' && ranks.length >= used;
        let monotonic = true;
        if (canCheckRanks) {
          for (let i = 1; i < used; i += 1) {
            if ((ranks[i - 1] | 0) > (ranks[i] | 0)) {
              monotonic = false;
              break;
            }
          }
        } else {
          monotonic = false;
        }

        const ok = orderPart === expectedOrder && monotonic;
        if (!ok && bad.length < 12) {
          bad.push({
            key,
            used,
            ro,
            orderPart,
            depthPart,
            expectedOrder,
            monotonic,
          });
        }

        checked += 1;
        if (checked >= 40) break;
      }

      return { ok: true, found, checked, bad };
    }, tbins);

    expect(diag.ok).toBeTruthy();
    expect(diag.found, diag.reason || '').toBeGreaterThan(0);
    expect(diag.bad, JSON.stringify(diag.bad, null, 2)).toHaveLength(0);
  });
});

test.describe('ground depthwrite', () => {
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
});

test.describe('world overlay occlusion', () => {
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
});
