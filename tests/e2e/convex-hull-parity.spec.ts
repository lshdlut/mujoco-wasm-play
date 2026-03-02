import { expect, test } from '@playwright/test';
import { waitForViewerReady } from './test-utils';

test('convex hull toggles mesh geometry variant', async ({ page }) => {
  const MODEL = 'model/convex_hull/hull_mesh.xml';
  const FORGE_BASE = '/dist/3.4.0/';
  const url =
    `/index.html?model=${encodeURIComponent(MODEL)}` +
    `&mode=worker&snapshot=1&log=0` +
    `&forgeBase=${encodeURIComponent(FORGE_BASE)}`;
  await waitForViewerReady(page, url);

  const hasGraphAssets = await page.evaluate(() => {
    const store = (window as any).__viewerStore;
    const state = store?.get?.() || null;
    const assets = state?.rendering?.assets || null;
    return !!assets?.meshes?.graphadr && !!assets?.meshes?.graph;
  });
  expect(hasGraphAssets).toBeTruthy();

  await page.waitForFunction(() => !!(window as any).__lastSnapshot, { timeout: 30_000, polling: 250 });
  const status = await page.evaluate(() => {
    const store = (window as any).__viewerStore;
    const state = store?.get?.() || null;
    const assets = state?.rendering?.assets || null;
    const snap = (window as any).__lastSnapshot || null;
    const gtype = snap?.gtype;
    let meshTypes = 0;
    const gtLen = gtype && typeof gtype.length === 'number' ? (gtype.length | 0) : 0;
    for (let i = 0; i < gtLen; i += 1) {
      const t = gtype[i] | 0;
      if (t === 7 || t === 8) meshTypes += 1;
    }
    return {
      hasAssets: !!assets,
      geomKeys: assets?.geoms ? Object.keys(assets.geoms) : null,
      meshKeys: assets?.meshes ? Object.keys(assets.meshes) : null,
      nmesh: assets?.meshes?.count ?? 0,
      nmeshgraph: assets?.meshes?.nmeshgraph ?? 0,
      hasGraphAdr: !!assets?.meshes?.graphadr,
      hasGraph: !!assets?.meshes?.graph,
      meshTypes,
      diag: assets?.extras?.diagnostics || null,
    };
  });
  expect(status.hasAssets).toBeTruthy();
  expect(status.meshTypes).toBeGreaterThan(0);
  expect(status.hasGraphAdr).toBeTruthy();
  expect(status.hasGraph).toBeTruthy();
  expect(Number(status.nmeshgraph) || 0).toBeGreaterThan(0);

  await page.evaluate(() => {
    const win = window as any;
    const renderer = win.__viewerRenderer;
    const store = win.__viewerStore;
    const snap = win.__lastSnapshot;
    if (renderer?.renderScene && store?.get && snap) {
      renderer.renderScene(snap, store.get());
    }
  });

  const candidate = await page.evaluate(() => {
    const store = (window as any).__viewerStore;
    const assets = store?.get?.()?.rendering?.assets || null;
    const ctx = (window as any).__viewerRenderer?.getContext?.();
    const meshes = ctx?.meshes;
    if (!assets || !ctx || !Array.isArray(meshes)) return null;

    const graphadr = assets?.meshes?.graphadr || null;
    const graph = assets?.meshes?.graph || null;
    if (!graphadr || !graph) return null;

    for (let i = 0; i < meshes.length; i += 1) {
      const mesh = meshes[i];
      if (!mesh?.visible || mesh?.userData?.infinitePlane) continue;
      const geomType = mesh.userData?.geomType | 0;
      if (geomType !== 7 && geomType !== 8) continue;

      const rawDataId = typeof mesh.userData?.geomModelDataId === 'number' ? (mesh.userData.geomModelDataId | 0) : -1;
      if (!(rawDataId >= 0 && rawDataId < graphadr.length)) continue;
      if ((graphadr[rawDataId] | 0) < 0) continue;

      return { geomIndex: i };
    }

    return null;
  });

  expect(candidate).not.toBeNull();

  const readHullState = async (geomIndex: number) => {
    return page.evaluate((geomIndex) => {
      const ctx = (window as any).__viewerRenderer?.getContext?.();
      const mesh = ctx?.meshes?.[geomIndex] || null;
      const did = mesh?.userData?.geomDataId ?? -1;
      const MASK = 1 << 30;
      const encoded = ((did | 0) & MASK) !== 0;
      return {
        exists: !!mesh,
        encoded,
        hull: encoded ? (((did | 0) & 1) !== 0) : false,
        hasIndex: !!mesh?.geometry?.index,
      };
    }, geomIndex);
  };

  const initialHull = await readHullState(candidate!.geomIndex);
  if (initialHull.hull) {
    await page.keyboard.press('H');
    await page.waitForFunction((geomIndex) => {
      const ctx = (window as any).__viewerRenderer?.getContext?.();
      const mesh = ctx?.meshes?.[geomIndex] || null;
      const did = mesh?.userData?.geomDataId ?? -1;
      const MASK = 1 << 30;
      const encoded = ((did | 0) & MASK) !== 0;
      const hull = encoded ? (((did | 0) & 1) !== 0) : false;
      const hasIndex = !!mesh?.geometry?.index;
      return !!mesh && encoded && !hull && hasIndex;
    }, candidate!.geomIndex, { timeout: 20_000, polling: 200 });
  }

  await page.keyboard.press('H');
  await page.waitForFunction((geomIndex) => {
    const ctx = (window as any).__viewerRenderer?.getContext?.();
    const mesh = ctx?.meshes?.[geomIndex] || null;
    const did = mesh?.userData?.geomDataId ?? -1;
    const MASK = 1 << 30;
    const encoded = ((did | 0) & MASK) !== 0;
    const hull = encoded ? (((did | 0) & 1) !== 0) : false;
    const hasIndex = !!mesh?.geometry?.index;
    return !!mesh && encoded && hull && !hasIndex;
  }, candidate!.geomIndex, { timeout: 20_000, polling: 200 });

  const afterOn = await readHullState(candidate!.geomIndex);
  expect(afterOn.encoded).toBeTruthy();
  expect(afterOn.hull).toBeTruthy();
  expect(afterOn.hasIndex).toBeFalsy();

  await page.keyboard.press('H');
  await page.waitForFunction((geomIndex) => {
    const ctx = (window as any).__viewerRenderer?.getContext?.();
    const mesh = ctx?.meshes?.[geomIndex] || null;
    const did = mesh?.userData?.geomDataId ?? -1;
    const MASK = 1 << 30;
    const encoded = ((did | 0) & MASK) !== 0;
    const hull = encoded ? (((did | 0) & 1) !== 0) : false;
    const hasIndex = !!mesh?.geometry?.index;
    return !!mesh && encoded && !hull && hasIndex;
  }, candidate!.geomIndex, { timeout: 20_000, polling: 200 });
});
