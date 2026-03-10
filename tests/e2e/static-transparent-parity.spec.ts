import { expect, test } from '@playwright/test';
import { waitForViewerReady } from './test-utils';

const MODEL = 'model/slider_crank/slider_crank.xml';
const FORGE_BASE = '/dist/3.4.0/';

const MJ_VIS = {
  TRANSPARENT: 18,
  STATIC: 22,
} as const;

test('mjVIS_STATIC hides static-body geoms; mjVIS_TRANSPARENT fades dynamic', async ({ page }) => {
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

