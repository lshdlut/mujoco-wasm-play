import { Page } from '@playwright/test';

export async function waitForViewerReady(page: Page, url = '/index.html?model=demo_box.xml') {
  await page.goto(url);
  await page.waitForFunction(() => {
    const ctx = (window as any).__renderCtx;
    const store = (window as any).__viewerStore;
    return !!ctx && !!store?.get && Array.isArray(ctx.meshes);
  });
  await page.evaluate(() => {
    const renderer = (window as any).__viewerRenderer;
    const store = (window as any).__viewerStore;
    if (!renderer?.renderScene || !store?.get) return;
    const state = store.get();
    state.rendering = state.rendering || {};
    state.rendering.sceneFlags = Array.isArray(state.rendering.sceneFlags)
      ? state.rendering.sceneFlags
      : Array.from({ length: 10 }, () => false);
    state.rendering.voptFlags = Array.isArray(state.rendering.voptFlags)
      ? state.rendering.voptFlags
      : Array.from({ length: 18 }, () => false);
    state.model = state.model || {};
    state.model.vis = state.model.vis || {};
    state.model.vis.headlight = state.model.vis.headlight || {
      active: 1,
      ambient: [0.1, 0.1, 0.1],
      diffuse: [0.4, 0.4, 0.4],
      specular: [0.5, 0.5, 0.5],
    };
    const snapshot = {
      ngeom: 1,
      xpos: [0, 0, 0],
      xmat: [1, 0, 0, 0, 1, 0, 0, 0, 1],
      gsize: [0.2, 0.2, 0.2],
      gtype: [6],
      gmatid: [-1],
      scene: {
        geoms: [
          {
            type: 'box',
            size: [0.2, 0.2, 0.2],
            xpos: [0, 0, 0],
            xmat: [1, 0, 0, 0, 1, 0, 0, 0, 1],
          },
        ],
      },
      bounds: { center: [0, 0, 0], radius: 1 },
      contacts: { n: 0 },
    };
    (window as any).__testSnapshot = snapshot;
    renderer.renderScene(snapshot, state);
    const ctx = (window as any).__renderCtx;
    const meshes = Array.isArray(ctx?.meshes) ? ctx.meshes : [];
    return { initialized: !!ctx?.initialized, meshCount: meshes.length };
  });
  const seeded = await page.evaluate(() => {
    const ctx = (window as any).__renderCtx;
    const meshes = Array.isArray(ctx?.meshes)
      ? ctx.meshes.filter((m) => m?.userData?.geomIndex >= 0 && !m.userData?.infinitePlane)
      : [];
    return { initialized: !!ctx?.initialized, meshCount: meshes.length };
  });
  if (!seeded.meshCount) {
    await page.evaluate(() => {
      const renderer = (window as any).__viewerRenderer;
      const snapshot = (window as any).__testSnapshot;
      const store = (window as any).__viewerStore;
      if (renderer?.renderScene && snapshot && store?.get) {
        renderer.renderScene(snapshot, store.get());
      }
    });
  }
  await page.waitForFunction(() => {
    const ctx = (window as any).__renderCtx;
    if (!ctx?.meshes) return false;
    const mesh = ctx.meshes.find(
      (m) => m?.visible && m.userData && m.userData.geomIndex >= 0 && !m.userData.infinitePlane,
    );
    return !!mesh;
  }, { timeout: 20000 });
}

export function firstVisibleGeomSummary() {
  const ctx = (window as any).__renderCtx;
  if (!ctx?.meshes) return null;
  const mesh = ctx.meshes.find(
    (m) => m?.visible && m.userData && m.userData.geomIndex >= 0 && !m.userData.infinitePlane,
  );
  if (!mesh) return null;
  return {
    materialType: mesh.material?.type,
    hasSegmentMaterial: !!mesh.userData.segmentMaterial,
    geomIndex: mesh.userData.geomIndex,
  };
}
