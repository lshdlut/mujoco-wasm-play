import { test } from '@playwright/test';
import { waitForViewerReady } from './test-utils';

const MODEL = 'mujoco_Rajagopal2015_simple.xml';
const FORGE_BASE = '/dist/3.4.0/';

test('diag: mjvScene types and skin asset sizes (worker)', async ({ page }) => {
  test.setTimeout(180_000);
  const url =
    `/index.html?model=${encodeURIComponent(MODEL)}` +
    `&mode=worker&snapshot=1&log=0` +
    `&forgeBase=${encodeURIComponent(FORGE_BASE)}`;

  await waitForViewerReady(page, url);

  // eslint-disable-next-line no-console
  console.log('mjvscene-skin-diag', await page.evaluate(() => {
    const store = (window as any).__viewerStore;
    const state = store?.get ? store.get() : null;
    const assets = state?.rendering?.assets || null;
    const snap = (window as any).__lastSnapshot || null;
    const types = snap?.scn_type || null;
    const typeCounts: Record<string, number> = {};
    if (types && typeof types.length === 'number') {
      const n = types.length | 0;
      for (let i = 0; i < n; i += 1) {
        const t = types[i] | 0;
        const k = String(t);
        typeCounts[k] = (typeCounts[k] || 0) + 1;
      }
    }
    const skins = assets?.skins || null;
    const skinCount = skins?.count ?? 0;
    const vertnum = skins?.vertnum || null;
    const facenum = skins?.facenum || null;
    const bonevertnum = skins?.bonevertnum || null;
    const totalVerts = vertnum && typeof vertnum.length === 'number'
      ? Array.from(vertnum).reduce((a, b) => a + (b | 0), 0)
      : 0;
    const totalFaces = facenum && typeof facenum.length === 'number'
      ? Array.from(facenum).reduce((a, b) => a + (b | 0), 0)
      : 0;
    const totalBoneWeights = bonevertnum && typeof bonevertnum.length === 'number'
      ? Array.from(bonevertnum).reduce((a, b) => a + (b | 0), 0)
      : 0;
    return {
      scn_ngeom: snap?.scn_ngeom ?? null,
      ngeom: snap?.ngeom ?? null,
      typeCounts,
      skinCount,
      totalVerts,
      totalFaces,
      totalBoneWeights,
    };
  }));
});

