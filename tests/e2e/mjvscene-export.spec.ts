import { expect, test } from '@playwright/test';
import { waitForViewerReady } from './test-utils';

const MODEL = 'mujoco_Rajagopal2015_simple.xml';
const FORGE_BASE = '/dist/3.4.0/';

test('mjvScene SoA snapshot exists and drives base meshes', async ({ page }) => {
  test.setTimeout(180_000);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });

  const url =
    `/?model=${encodeURIComponent(MODEL)}` +
    `&mode=worker&snapshot=1&log=0` +
    `&forgeBase=${encodeURIComponent(FORGE_BASE)}`;
  await waitForViewerReady(page, url);

  // One-off diagnostics (kept lightweight) to help debug missing scn_* fields.
  // eslint-disable-next-line no-console
  console.log('mjvscene-export diag', await page.evaluate(() => {
    const snap = (window as any).__lastSnapshot || null;
    const keys = snap ? Object.keys(snap).filter((k) => k.startsWith('scn_')).sort() : [];
    return {
      hasSnap: !!snap,
      scnKeys: keys,
      scn_ngeom: snap?.scn_ngeom ?? null,
      ngeom: snap?.ngeom ?? null,
    };
  }));

  // eslint-disable-next-line no-console
  console.log('mjvscene-export poll sample', await page.evaluate(() => {
    const snap = (window as any).__lastSnapshot || null;
    const ngeom = snap?.ngeom ?? 0;
    const scn = snap?.scn_ngeom ?? 0;
    return {
      ngeom,
      scn_ngeom: scn,
      hasScnPos: !!snap?.scn_pos,
      scnPosLen: snap?.scn_pos?.length ?? 0,
      scnMatLen: snap?.scn_mat?.length ?? 0,
      okLen: (snap?.scn_pos?.length ?? 0) === (scn * 3) && (snap?.scn_mat?.length ?? 0) === (scn * 9),
      okGrow: scn >= ngeom && scn > 0,
    };
  }));

  {
    const deadline = Date.now() + 30_000;
    let last: any = null;
    while (Date.now() < deadline) {
      last = await page.evaluate(() => {
        const snap = (window as any).__lastSnapshot || null;
        if (!snap) return { ok: false, reason: 'no-snapshot' };
        const ngeom = snap.ngeom ?? 0;
        const scn = snap.scn_ngeom ?? 0;
        const scnPosLen = snap.scn_pos?.length ?? 0;
        const scnMatLen = snap.scn_mat?.length ?? 0;
        return {
          ok: (
            scn > 0 &&
            scn >= ngeom &&
            !!snap.scn_pos &&
            !!snap.scn_mat &&
            (scnPosLen === scn * 3) &&
            (scnMatLen === scn * 9)
          ),
          ngeom,
          scn_ngeom: scn,
          scnPosLen,
          scnMatLen,
        };
      });
      if (last?.ok) break;
      await page.waitForTimeout(250);
    }
    expect(last?.ok, `mjvScene SoA snapshot not ready: ${JSON.stringify(last)}`).toBe(true);
  }

  {
    const deadline = Date.now() + 30_000;
    let last: any = null;
    while (Date.now() < deadline) {
      last = await page.evaluate(() => {
        const snap = (window as any).__lastSnapshot || null;
        const store = (window as any).__viewerStore;
        const renderer = (window as any).__viewerRenderer;
        const ctx = renderer?.getContext?.() || null;
        const state = store?.get ? store.get() : null;
        if (!snap) return { ok: false, reason: 'no-snapshot' };
        if (!state) return { ok: false, reason: 'no-state' };
        if (!renderer?.renderScene) return { ok: false, reason: 'no-renderScene' };
        if (!Array.isArray(ctx?.meshes)) return { ok: false, reason: 'no-mesh-pool' };
        renderer.renderScene(snap, state);
        const baseNgeom = snap?.ngeom ?? 0;
        const meshes = ctx.meshes;
        const visibleCount = meshes.filter((m: any) => m?.visible && !m?.userData?.infinitePlane).length;
        const hasSceneIndex = meshes.some((m: any) => (m?.userData?.geomIndex ?? -1) >= baseNgeom);
        return {
          ok: visibleCount > 0 && hasSceneIndex,
          baseNgeom,
          poolLen: meshes.length,
          visibleCount,
          hasSceneIndex,
        };
      });
      if (last?.ok) break;
      await page.waitForTimeout(250);
    }
    expect(last?.ok, `renderer not driven by mjvScene: ${JSON.stringify(last)}`).toBe(true);
  }
});
