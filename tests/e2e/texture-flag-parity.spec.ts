import { expect, test } from '@playwright/test';
import { waitForViewerReady } from './test-utils';

const MODEL = 'model/car/car.xml';
const FORGE_BASE = '/dist/3.3.7/';

function pickMeshWithMap() {
  const win = window as any;
  const store = win.__viewerStore;
  const state = store?.get ? store.get() : null;
  const vopt = Array.isArray(state?.rendering?.voptFlags) ? state.rendering.voptFlags : null;
  const voptTextureFlag = vopt && vopt.length > 1 ? !!vopt[1] : null;
  const ctx = win.__renderCtx || win.__viewerRenderer?.getContext?.();
  const meshes = Array.isArray(ctx?.meshes) ? ctx.meshes : [];
  for (let i = 0; i < meshes.length; i += 1) {
    const mesh = meshes[i];
    if (!mesh?.visible || !mesh?.material) continue;
    if (mesh?.userData?.infinitePlane) continue;
    const map = mesh.material?.map || null;
    if (!map) continue;
    return {
      ok: true,
      voptTextureFlag,
      index: i,
      meshName: mesh.name || '',
      hasMap: true,
      mapType: map?.type || null,
      mapRepeat: map?.repeat ? [map.repeat.x, map.repeat.y] : null,
    };
  }
  return {
    voptTextureFlag,
    ok: false,
    reason: 'no_visible_mesh_with_map',
    meshCount: meshes.length,
  };
}

function meshMapState(geomIndex: number) {
  const win = window as any;
  const store = win.__viewerStore;
  const state = store?.get ? store.get() : null;
  const vopt = Array.isArray(state?.rendering?.voptFlags) ? state.rendering.voptFlags : null;
  const voptTextureFlag = vopt && vopt.length > 1 ? !!vopt[1] : null;
  const ctx = win.__renderCtx || win.__viewerRenderer?.getContext?.();
  const mesh = Array.isArray(ctx?.meshes) ? ctx.meshes[geomIndex] : null;
  return {
    ok: !!mesh,
    voptTextureFlag,
    hasMap: !!mesh?.material?.map,
    meshName: mesh?.name || '',
  };
}

async function forceRender(page: any) {
  await page.evaluate(() => {
    const win = window as any;
    const renderer = win.__viewerRenderer;
    const store = win.__viewerStore;
    const snap = win.__lastSnapshot;
    if (renderer?.renderScene && store?.get && snap) {
      renderer.renderScene(snap, store.get());
    }
  });
}

test('mjVIS_TEXTURE toggles material.map (basic)', async ({ page }) => {
  const url =
    `/index.html?model=${encodeURIComponent(MODEL)}` +
    `&mode=worker&snapshot=1&log=0` +
    `&forgeBase=${encodeURIComponent(FORGE_BASE)}`;
  await waitForViewerReady(page, url);

  await page.waitForFunction(() => {
    const win = window as any;
    const store = win.__viewerStore;
    const state = store?.get ? store.get() : null;
    const assets = state?.rendering?.assets || null;
    return !!assets?.textures && !!assets?.materials;
  }, { timeout: 30_000 });

  await forceRender(page);

  const picked = await page.evaluate(pickMeshWithMap);
  expect(picked, JSON.stringify(picked)).toMatchObject({ ok: true, hasMap: true });

  await page.evaluate(async ({ id, value }) => {
    const controls = (window as any).__viewerControls;
    if (!controls?.toggleControl) throw new Error('Missing __viewerControls.toggleControl');
    await controls.toggleControl(id, value);
  }, { id: 'rendering.model_flags.Texture', value: false });
  await forceRender(page);

  await expect.poll(async () => {
    await forceRender(page);
    return page.evaluate(meshMapState, (picked as any).index);
  }, { timeout: 10_000 }).toMatchObject({ ok: true, hasMap: false, voptTextureFlag: false });

  await page.evaluate(async ({ id, value }) => {
    const controls = (window as any).__viewerControls;
    if (!controls?.toggleControl) throw new Error('Missing __viewerControls.toggleControl');
    await controls.toggleControl(id, value);
  }, { id: 'rendering.model_flags.Texture', value: true });
  await forceRender(page);

  await expect.poll(async () => {
    await forceRender(page);
    return page.evaluate(meshMapState, (picked as any).index);
  }, { timeout: 10_000 }).toMatchObject({ ok: true, hasMap: true, voptTextureFlag: true });
});
