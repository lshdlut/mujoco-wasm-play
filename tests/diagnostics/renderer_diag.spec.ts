import fsSync from 'node:fs';
import { test, expect } from '@playwright/test';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { waitForViewerReady } from '../e2e/test-utils';

test.describe('mjvscene skin diag', () => {
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
      const snapshot = (window as any).__PLAY_HOST__?.getSnapshot?.() ?? null;
      const assets = snapshot?.renderAssets || null;
      const snap = (window as any).__PLAY_HOST__?.getSnapshot?.() ?? null;
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
});

test.describe('geomorder dump', () => {
  const fs = fsPromises;

  const MODEL = 'mujoco_Rajagopal2015_simple.xml';
  const FORGE_BASE = '/dist/3.4.0/';

  test('dump MuJoCo-like geomorder (Raj)', async ({ page }) => {
    test.setTimeout(180_000);
    const url =
      `/?model=${encodeURIComponent(MODEL)}` +
      `&mode=worker&snapshot=1&log=0` +
      `&forgeBase=${encodeURIComponent(FORGE_BASE)}`;
    await waitForViewerReady(page, url);

    const diag = await page.evaluate(() => {
      const snap = (window as any).__PLAY_HOST__?.getSnapshot?.() ?? null;
      if (!snap) return { ok: false, reason: 'no-snapshot' };
      const n = Number(snap.scn_ngeom) | 0;
      const camdist = snap.scn_camdist || null;
      const transparent = snap.scn_transparent || null;
      const objtype = snap.scn_objtype || null;
      if (!(n > 0)) return { ok: false, reason: 'scn_ngeom<=0' };
      if (!camdist || camdist.length < n) return { ok: false, reason: 'missing scn_camdist' };
      if (!transparent || transparent.length < n) return { ok: false, reason: 'missing scn_transparent' };
      if (!objtype || objtype.length < n) return { ok: false, reason: 'missing scn_objtype' };
      let min = Number.POSITIVE_INFINITY;
      let max = Number.NEGATIVE_INFINITY;
      let zero = 0;
      let finite = 0;
      const perType: Record<string, { count: number; min: number; max: number }> = {};
      const label = (t: number) => {
        if ((t | 0) === 5) return 'GEOM';
        if ((t | 0) === 6) return 'SITE';
        if ((t | 0) === 18) return 'TENDON';
        return String(t | 0);
      };
      for (let i = 0; i < n; i += 1) {
        const v = Number(camdist[i]);
        if (!Number.isFinite(v)) continue;
        finite += 1;
        if (v === 0) zero += 1;
        if (v < min) min = v;
        if (v > max) max = v;
        if ((transparent[i] | 0) === 0) continue;
        const key = label(objtype[i] | 0);
        const slot = perType[key] || (perType[key] = { count: 0, min: Number.POSITIVE_INFINITY, max: Number.NEGATIVE_INFINITY });
        slot.count += 1;
        if (v < slot.min) slot.min = v;
        if (v > slot.max) slot.max = v;
      }
      return {
        ok: true,
        n,
        camdist: {
          len: camdist.length,
          finite,
          zero,
          min: Number.isFinite(min) ? min : null,
          max: Number.isFinite(max) ? max : null,
        },
        transparentNonZero: Array.from({ length: n }, (_, i) => (transparent[i] | 0) !== 0).filter(Boolean).length,
        transparentCamdistRangesByObjType: perType,
      };
    });
    expect(diag?.ok, `geomorder diag failed: ${JSON.stringify(diag)}`).toBe(true);

    const payload = await page.evaluate(() => {
      const dump = (window as any).__PLAY_DUMP_GEOMORDER;
      if (typeof dump !== 'function') throw new Error('__PLAY_DUMP_GEOMORDER missing');
      return dump({ log: false });
    });

    expect(payload?.scn_ngeom > 0).toBeTruthy();
    expect(Array.isArray(payload?.order)).toBeTruthy();
    expect(payload.order.length).toBe(payload.scn_ngeom);

    const outDir = path.resolve(process.cwd(), '..', 'local_tools', 'out');
    await fs.mkdir(outDir, { recursive: true });
    const outPath = path.join(outDir, `geomorder_${MODEL.replace(/\\.xml$/i, '')}.json`);
    await fs.writeFile(outPath, JSON.stringify({ diag, payload }, null, 2), 'utf-8');

    // eslint-disable-next-line no-console
    console.log('geomorder dump written', { outPath });
  });
});

test.describe('humanoid100 model refs', () => {
  test('loads humanoid100 model references', async ({ page }) => {
    const modelPath = path.resolve(process.cwd(), 'model', 'humanoid', 'humanoid100.xml');
    if (!fsSync.existsSync(modelPath)) {
      test.skip(true, `Missing local model: ${modelPath}`);
    }

    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });

    await page.goto('/index.html?mode=worker&model=model/humanoid/humanoid100.xml&log=1');

    await page.waitForFunction(
      () => {
        const snap = (window as any).__PLAY_HOST__?.getSnapshot?.();
        return snap && ((snap.scn_ngeom | 0) > 0);
      },
      null,
      { timeout: 30_000 },
    );

    const combined = consoleErrors.join('\n');
    expect(combined).not.toContain('XML load failed:');
  });
});

test.describe('mjvscene export', () => {
  const MODEL = 'mujoco_Rajagopal2015_simple.xml';
  const FORGE_BASE = '/dist/3.4.0/';

  test('mjvScene SoA snapshot exists and remains internally consistent', async ({ page }) => {
    test.setTimeout(180_000);
    const url =
      `/?model=${encodeURIComponent(MODEL)}` +
      `&mode=worker&snapshot=1&log=0` +
      `&forgeBase=${encodeURIComponent(FORGE_BASE)}`;
    await waitForViewerReady(page, url);

    await expect.poll(async () => {
      return page.evaluate(() => {
        const snap = (window as any).__PLAY_HOST__?.getSnapshot?.() ?? null;
        if (!snap) return { ok: false, reason: 'no-snapshot' };
        const ngeom = Number(snap.ngeom) || 0;
        const scn = Number(snap.scn_ngeom) || 0;
        const scnPosLen = snap.scn_pos?.length ?? 0;
        const scnMatLen = snap.scn_mat?.length ?? 0;
        return {
          ok: scn > 0 && scn >= ngeom && scnPosLen === scn * 3 && scnMatLen === scn * 9,
          ngeom,
          scn_ngeom: scn,
          scnPosLen,
          scnMatLen,
        };
      });
    }, { timeout: 30_000, intervals: [250] }).toMatchObject({ ok: true });
  });
});
