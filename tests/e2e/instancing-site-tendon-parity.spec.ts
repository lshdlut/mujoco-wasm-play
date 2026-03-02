import { Page, expect, test } from '@playwright/test';
import { waitForViewerReady } from './test-utils';

const MODEL = 'mujoco_Rajagopal2015_simple.xml';
const FORGE_BASE = '/dist/3.4.0/';

async function pauseSimulation(page: Page) {
  await page.evaluate(async () => {
    const controls: any = (window as any).__viewerControls;
    if (!controls?.toggleControl) throw new Error('viewer controls not ready');
    await controls.toggleControl('simulation.run', 0);
  });
  await page.waitForFunction(() => {
    const store: any = (window as any).__viewerStore;
    const state = store?.get ? store.get() : null;
    return state?.simulation?.run === false;
  }, { timeout: 20_000, polling: 250 });
}

test('instancing keeps tendon/site colors and renderOrder consistent', async ({ page }) => {
  const url =
    `/?model=${encodeURIComponent(MODEL)}` +
    `&mode=worker&snapshot=1&log=0` +
    `&tbins=8&tmode=bins` +
    `&forgeBase=${encodeURIComponent(FORGE_BASE)}`;
  await waitForViewerReady(page, url);
  await pauseSimulation(page);

	  const diag = await page.evaluate(() => {
	    const MJ_OBJ_SITE = 6;
	    const MJ_OBJ_TENDON = 18;
      const tbins = 8;
    const ctx: any = (window as any).__renderCtx;
    const inst: any = ctx?._instancing || null;
    const snap: any = (window as any).__lastSnapshot || null;
    const n = Number(snap?.scn_ngeom) | 0;
    const baseNgeom = Number(snap?.ngeom) | 0;
    if (!ctx || !inst || !(inst.batches instanceof Map)) return { ok: false, reason: 'instancing not active' };
    if (!snap || !(n > 0)) return { ok: false, reason: 'scene snapshot missing' };

    const objTypeView: any = snap.scn_objtype || null;
    const rgbaView: any = snap.scn_rgba || null;
    const geomOrderRank: any = ctx._scnGeomOrderRank || null;
    const geomToScn: any = ctx._geomToScn || null;
    const extras: any = ctx._scnExtras || null;
    if (!objTypeView || !rgbaView || !geomOrderRank) return { ok: false, reason: 'missing scene arrays' };

	    const colorTol = 1e-4;
	    let siteInstances = 0;
	    let tendonInstances = 0;
	    let transparentSiteTendonInstances = 0;
	    const transparentSiteTendonSamples: any[] = [];
	    const relevantBatches: any[] = [];
	    const orderMismatches: any[] = [];
	    const colorMismatches: any[] = [];

    const resolveScnIndex = (geomIndex: number) => {
      const gi = geomIndex | 0;
      if (!(gi >= 0)) return -1;
      if (gi < baseNgeom) {
        const si = geomToScn && gi < geomToScn.length ? (geomToScn[gi] | 0) : -1;
        return si >= 0 && si < n ? si : -1;
      }
      const extraIdx = gi - baseNgeom;
      if (Array.isArray(extras) && extraIdx >= 0 && extraIdx < extras.length) {
        const si = extras[extraIdx] | 0;
        return si >= 0 && si < n ? si : -1;
      }
      return -1;
    };

    for (const batch of inst.batches.values()) {
      if (!batch?.mesh) continue;
      const used = batch.used | 0;
      if (!(used > 0)) continue;
      const mesh = batch.mesh;
      const geomIndexArr: any = batch.instanceToGeomIndex || null;
      const colorArr: any = mesh.instanceColor?.array || null;
      if (!geomIndexArr || geomIndexArr.length < used) continue;

      let orderMin = Number.POSITIVE_INFINITY;
      let orderMax = Number.NEGATIVE_INFINITY;
      let batchSite = 0;
      let batchTendon = 0;

      for (let instanceId = 0; instanceId < used; instanceId += 1) {
        const geomIndex = geomIndexArr[instanceId] | 0;
        const si = resolveScnIndex(geomIndex);
        if (si < 0) continue;
        const orderRank = geomOrderRank && si < geomOrderRank.length ? (geomOrderRank[si] | 0) : si;
        if (Number.isFinite(orderRank)) {
          if (orderRank < orderMin) orderMin = orderRank;
          if (orderRank > orderMax) orderMax = orderRank;
        }
	        const objType = objTypeView[si] | 0;
	        if (objType === MJ_OBJ_SITE || objType === MJ_OBJ_TENDON) {
	          const alpha = rgbaView && (si * 4 + 3) < rgbaView.length ? (Number(rgbaView[si * 4 + 3]) || 0) : 0;
	          if (alpha < 0.999) {
	            transparentSiteTendonInstances += 1;
	            if (transparentSiteTendonSamples.length < 10) {
	              transparentSiteTendonSamples.push({
	                batchKey: String(batch.key || ''),
	                instanceId,
	                geomIndex,
	                scnIndex: si,
	                objType,
	                alpha,
	              });
	            }
	          }
	          if (objType === MJ_OBJ_SITE) {
	            batchSite += 1;
	            siteInstances += 1;
	          } else {
            batchTendon += 1;
            tendonInstances += 1;
          }
          if (colorArr && rgbaView && (si * 4 + 2) < rgbaView.length && (instanceId * 3 + 2) < colorArr.length) {
            const expR = Number(rgbaView[si * 4 + 0]) || 0;
            const expG = Number(rgbaView[si * 4 + 1]) || 0;
            const expB = Number(rgbaView[si * 4 + 2]) || 0;
            const actR = Number(colorArr[instanceId * 3 + 0]) || 0;
            const actG = Number(colorArr[instanceId * 3 + 1]) || 0;
            const actB = Number(colorArr[instanceId * 3 + 2]) || 0;
            const dr = Math.abs(expR - actR);
            const dg = Math.abs(expG - actG);
            const db = Math.abs(expB - actB);
            if (dr > colorTol || dg > colorTol || db > colorTol) {
              if (colorMismatches.length < 20) {
                colorMismatches.push({
                  batchKey: String(batch.key || ''),
                  instanceId,
                  geomIndex,
                  scnIndex: si,
                  objType,
                  exp: [expR, expG, expB],
                  act: [actR, actG, actB],
                });
              }
            }
          }
        }
      }

      const ro = Number(mesh.renderOrder || 0) | 0;
      const batchKeyStr = String(batch.key || '');
      const binMatch = batchKeyStr.match(/:tb(-?\d+)/);
      const bin = binMatch ? (Number(binMatch[1]) | 0) : -1;
      const expectRo =
        mesh.material?.transparent && bin >= 0
          ? ((tbins - 1 - bin) | 0)
          : (Number.isFinite(orderMin) ? (Number(orderMin) | 0) : null);
      if (expectRo != null && ro !== expectRo) {
        if (orderMismatches.length < 20) {
          orderMismatches.push({
            batchKey: batchKeyStr,
            ro,
            expect: expectRo,
            orderMin: Number.isFinite(orderMin) ? (Number(orderMin) | 0) : null,
            orderMax: Number.isFinite(orderMax) ? (Number(orderMax) | 0) : null,
            bin,
            used,
            siteInstances: batchSite,
            tendonInstances: batchTendon,
          });
        }
      }
      if (batchSite > 0 || batchTendon > 0) {
        relevantBatches.push({
          batchKey: batchKeyStr,
          used,
          ro,
          orderMin: Number.isFinite(orderMin) ? (Number(orderMin) | 0) : null,
          orderMax: Number.isFinite(orderMax) ? (Number(orderMax) | 0) : null,
          siteInstances: batchSite,
          tendonInstances: batchTendon,
          transparent: !!mesh.material?.transparent,
        });
      }
    }

	    return {
	      ok: true,
	      siteInstances,
	      tendonInstances,
	      transparentSiteTendonInstances,
	      transparentSiteTendonSamples,
	      relevantBatches,
	      orderMismatches,
	      colorMismatches,
	    };
	  });

	  expect(diag.ok).toBeTruthy();
	  expect(diag.siteInstances, JSON.stringify(diag.relevantBatches.slice(0, 5), null, 2)).toBeGreaterThan(0);
	  expect(diag.tendonInstances, JSON.stringify(diag.relevantBatches.slice(0, 5), null, 2)).toBeGreaterThan(0);
	  expect(diag.transparentSiteTendonInstances, JSON.stringify(diag.transparentSiteTendonSamples, null, 2)).toBeGreaterThan(0);
	  expect(diag.orderMismatches, JSON.stringify(diag.orderMismatches, null, 2)).toHaveLength(0);
	  expect(diag.colorMismatches, JSON.stringify(diag.colorMismatches, null, 2)).toHaveLength(0);
	});
