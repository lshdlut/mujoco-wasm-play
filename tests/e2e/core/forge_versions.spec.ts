import { expect, test } from '@playwright/test';
import { waitForViewerReady } from '../test-utils';

const FORGE_MESH_VERSIONS = ['3.6.0', '3.7.0', '3.8.0', '3.8.1', '3.9.0', '3.10.0', '3.11.0', '3.12.0', '3.13.0', '3.14.0', '3.15.0'];

test.describe('forge runtime version compatibility', () => {
  for (const ver of FORGE_MESH_VERSIONS) {
    test(`cards external OBJ mesh loads with MuJoCo ${ver}`, async ({ page }) => {
      test.setTimeout(120_000);

      await waitForViewerReady(page, `/index.html?model=cards&ver=${ver}&snapshot=1&log=0`, { timeoutMs: 120_000 });

      const diag = await page.evaluate(() => {
        const config = (window as any).__PLAY_RUNTIME_CONFIG__ || null;
        const snapshot = (window as any).__PLAY_HOST__?.getSnapshot?.() ?? null;
        const gtype = snapshot?.gtype || [];
        const meshGeomCount = Array.from(gtype).filter((value) => (Number(value) | 0) === 7).length;
        return {
          ver: String(config?.startup?.ver || ''),
          actual: snapshot?.engineVersion,
          ngeom: Number(snapshot?.ngeom) | 0,
          scnNgeom: Number(snapshot?.scn_ngeom) | 0,
          meshGeomCount,
        };
      });

      expect(diag.ver).toBe(ver);
      expect(diag.actual).toBe(ver);
      expect(diag.ngeom).toBeGreaterThan(0);
      expect(diag.scnNgeom).toBeGreaterThan(0);
      expect(diag.meshGeomCount).toBeGreaterThan(0);
    });
  }
});
