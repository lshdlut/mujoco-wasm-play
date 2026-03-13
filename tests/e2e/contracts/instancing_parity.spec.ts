import { Page, expect, test } from '@playwright/test';
import { waitForViewerReady } from '../test-utils';

test.describe('instancing visual parity', () => {
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

  type CameraPose = {
    pos: [number, number, number];
    quat: [number, number, number, number];
    up: [number, number, number];
  };

  type SamplePoint = {
    x: number;
    y: number;
    rgba: [number, number, number, number];
  };

  type Baseline = {
    ok: boolean;
    reason?: string;
    width?: number;
    height?: number;
    pose?: CameraPose;
    samples?: SamplePoint[];
  };

  test('instancing keeps site/tendon pixels close to non-instanced (forceBasic)', async ({ page }) => {
    test.setTimeout(180_000);

    const baseUrl =
      `/?model=${encodeURIComponent(MODEL)}` +
      `&mode=worker&snapshot=1&log=0&forceBasic=1` +
      `&tbins=1&tmode=strict` +
      `&forgeBase=${encodeURIComponent(FORGE_BASE)}`;

    await waitForViewerReady(page, baseUrl);
    await pauseSimulation(page);

    const compared = await page.evaluate(() => {
      const MJ_OBJ_SITE = 6;
      const MJ_OBJ_TENDON = 18;
      const ctx: any = (window as any).__renderCtx;
      const snap: any = (window as any).__PLAY_HOST__?.getSnapshot?.() ?? null;
      const store: any = (window as any).__viewerStore;
      const state = store?.get ? store.get() : null;
      const rendererApi: any = (window as any).__viewerRenderer;
      if (!ctx?.renderer?.domElement || !ctx?.camera) return { ok: false, reason: 'renderer not ready' };
      if (!snap || !(Number(snap?.scn_ngeom) > 0)) return { ok: false, reason: 'scene snapshot not ready' };
      if (!rendererApi?.renderScene || !state) return { ok: false, reason: 'viewer renderer/state not ready' };

      const canvas: HTMLCanvasElement = ctx.renderer.domElement;
      const width = canvas.width | 0;
      const height = canvas.height | 0;
      if (!(width > 10 && height > 10)) return { ok: false, reason: `bad canvas size: ${width}x${height}` };

      const cam = ctx.camera;
      const pose: CameraPose = {
        pos: [Number(cam.position.x) || 0, Number(cam.position.y) || 0, Number(cam.position.z) || 0],
        quat: [Number(cam.quaternion.x) || 0, Number(cam.quaternion.y) || 0, Number(cam.quaternion.z) || 0, Number(cam.quaternion.w) || 1],
        up: [Number(cam.up.x) || 0, Number(cam.up.y) || 0, Number(cam.up.z) || 1],
      };

      const posView: any = snap.scn_pos || null;
      const objTypeView: any = snap.scn_objtype || null;
      const n = Number(snap.scn_ngeom) | 0;
      if (!posView || !objTypeView) return { ok: false, reason: 'missing scn_pos/scn_objtype' };

      const Vector3 = cam.position.constructor;
      const v = new Vector3();
      const margin = 4;
      const samplePatchFromCanvas = (g2d: CanvasRenderingContext2D, x: number, y: number, r = 1) => {
        const ix = Math.max(0, Math.min(width - 1, x | 0));
        const iy = Math.max(0, Math.min(height - 1, y | 0));
        const x0 = Math.max(0, ix - r);
        const y0 = Math.max(0, iy - r);
        const x1 = Math.min(width - 1, ix + r);
        const y1 = Math.min(height - 1, iy + r);
        const w = x1 - x0 + 1;
        const h = y1 - y0 + 1;
        const data = g2d.getImageData(x0, y0, w, h).data;
        let sr = 0;
        let sg = 0;
        let sb = 0;
        let sa = 0;
        const nn = w * h;
        for (let i = 0; i < data.length; i += 4) {
          sr += data[i + 0] || 0;
          sg += data[i + 1] || 0;
          sb += data[i + 2] || 0;
          sa += data[i + 3] || 0;
        }
        return [sr / (255 * nn), sg / (255 * nn), sb / (255 * nn), sa / (255 * nn)] as [number, number, number, number];
      };

      const projectScnToPixel = (si: number) => {
        const base = (si | 0) * 3;
        v.set(posView[base + 0] || 0, posView[base + 1] || 0, posView[base + 2] || 0);
        v.project(cam);
        if (!Number.isFinite(v.x) || !Number.isFinite(v.y) || !Number.isFinite(v.z)) return null;
        if (v.z < -1 || v.z > 1) return null;
        const x = Math.round((v.x * 0.5 + 0.5) * width);
        const y = Math.round((-v.y * 0.5 + 0.5) * height);
        if (x < margin || x >= width - margin || y < margin || y >= height - margin) return null;
        return { x, y };
      };

      const samplePixels = (disableInstancing: boolean, scnIndices: number[]) => {
        (globalThis as any).PLAY_DISABLE_INSTANCING = disableInstancing;
        cam.position.set(pose.pos[0], pose.pos[1], pose.pos[2]);
        cam.quaternion.set(pose.quat[0], pose.quat[1], pose.quat[2], pose.quat[3]);
        cam.up.set(pose.up[0], pose.up[1], pose.up[2]);
        cam.updateMatrixWorld(true);
        if (typeof cam.updateProjectionMatrix === 'function') cam.updateProjectionMatrix();

        // Warm up a few frames to let instancing/binning settle after toggles.
        for (let i = 0; i < 20; i += 1) {
          rendererApi.renderScene(snap, state);
        }
        ctx.renderer.setRenderTarget?.(null);
        ctx.renderer.render(ctx.sceneWorld, cam);

        const tmp = document.createElement('canvas');
        tmp.width = width;
        tmp.height = height;
        const g2d = tmp.getContext('2d', { willReadFrequently: true });
        if (!g2d) throw new Error('2d context not available');
        g2d.drawImage(canvas, 0, 0);

        const out = [];
        for (const si of scnIndices) {
          const pixel = projectScnToPixel(si);
          if (!pixel) {
            out.push(null);
            continue;
          }
          out.push(samplePatchFromCanvas(g2d, pixel.x, pixel.y, 1));
        }
        return out;
      };

      const resolveMeshIndex = (si: number) => {
        const objIdView: any = snap.scn_objid || null;
        const baseNgeom = Number(snap.ngeom) | 0;
        const objType = objTypeView[si] | 0;
        if (objType === 5 && objIdView) {
          const gid = objIdView[si] | 0;
          if (gid >= 0 && gid < baseNgeom) return gid;
        }
        const extras: any = ctx._scnExtras || null;
        if (Array.isArray(extras)) {
          const k = extras.indexOf(si);
          if (k >= 0) return baseNgeom + k;
        }
        return -1;
      };

      const warmupNonInstancedMeshes = (indices: number[]) => {
        (globalThis as any).PLAY_DISABLE_INSTANCING = true;
        const meshIndices = indices.map(resolveMeshIndex).filter((idx) => idx >= 0);
        const maxFrames = 240;
        for (let frame = 0; frame < maxFrames; frame += 1) {
          rendererApi.renderScene(snap, state);
          let ready = true;
          for (const meshIndex of meshIndices) {
            const mesh = Array.isArray(ctx.meshes) ? ctx.meshes[meshIndex] : null;
            if (!mesh || !mesh.isObject3D || mesh.userData?.proxy) {
              ready = false;
              break;
            }
          }
          if (ready) return true;
        }
        return false;
      };

      const want = 24;
      const scnIndices: number[] = [];
      cam.updateMatrixWorld(true);
      if (typeof cam.updateProjectionMatrix === 'function') cam.updateProjectionMatrix();
      for (let si = 0; si < n && scnIndices.length < want; si += 1) {
        const ot = objTypeView[si] | 0;
        if (ot !== MJ_OBJ_SITE && ot !== MJ_OBJ_TENDON) continue;
        const pixel = projectScnToPixel(si);
        if (!pixel) continue;
        scnIndices.push(si);
      }
      if (scnIndices.length < 8) return { ok: false, reason: `not enough scn sample indices: ${scnIndices.length}` };

      let baseline: ([number, number, number, number] | null)[] | null = null;
      let instanced: ([number, number, number, number] | null)[] | null = null;
      try {
        warmupNonInstancedMeshes(scnIndices);
        baseline = samplePixels(true, scnIndices);
        instanced = samplePixels(false, scnIndices);
      } finally {
        (globalThis as any).PLAY_DISABLE_INSTANCING = null;
      }
      if (!baseline || !instanced || baseline.length !== instanced.length) {
        return { ok: false, reason: 'sampling failed' };
      }

      let maxL1 = 0;
      let worst: any = null;
      const diffs: number[] = [];
      for (let i = 0; i < baseline.length; i += 1) {
        const base = baseline[i];
        const curr = instanced[i];
        if (!base || !curr) continue;
        const l1 =
          Math.abs(curr[0] - base[0]) +
          Math.abs(curr[1] - base[1]) +
          Math.abs(curr[2] - base[2]) +
          Math.abs(curr[3] - base[3]);
        diffs.push(l1);
        if (l1 > maxL1) {
          maxL1 = l1;
          worst = { scnIndex: scnIndices[i], base, curr, l1 };
        }
      }
      if (worst && typeof worst.scnIndex === 'number') {
        const si = worst.scnIndex | 0;
        const typeView: any = snap.scn_type || null;
        const rgbaView: any = snap.scn_rgba || null;
        const objIdView: any = snap.scn_objid || null;
        const geomOrderRank: any = ctx._scnGeomOrderRank || null;
        const expected =
          rgbaView && (si * 4 + 3) < rgbaView.length
            ? [
                Number(rgbaView[si * 4 + 0]) || 0,
                Number(rgbaView[si * 4 + 1]) || 0,
                Number(rgbaView[si * 4 + 2]) || 0,
                Number(rgbaView[si * 4 + 3]) || 0,
              ]
            : null;
        const objType = objTypeView[si] | 0;
        const gtype = typeView ? (typeView[si] | 0) : -1;
        const orderRank = geomOrderRank && si < geomOrderRank.length ? (geomOrderRank[si] | 0) : null;
        const baseNgeom = Number(snap.ngeom) | 0;
        let meshIndex = -1;
        if (objType === 5 && objIdView) {
          const gid = objIdView[si] | 0;
          if (gid >= 0 && gid < baseNgeom) meshIndex = gid;
        }
        if (meshIndex < 0 && Array.isArray(ctx._scnExtras)) {
          const k = ctx._scnExtras.indexOf(si);
          if (k >= 0) meshIndex = baseNgeom + k;
        }
        const mesh = Array.isArray(ctx.meshes) ? ctx.meshes[meshIndex] : null;
        const inst = ctx._instancing || null;
        const ref = inst?.geomRefs?.[meshIndex] || null;
        const runStartArr: any = ctx._instOrderRunStart || null;
        const runLenArr: any = ctx._instOrderRunLen || null;
        const runStart =
          runStartArr && (si >= 0) && (si < runStartArr.length)
            ? (runStartArr[si] | 0)
            : null;
        worst.meta = {
          objType,
          gtype,
          orderRank,
          expected,
          meshIndex,
          meshVisible: !!mesh?.visible,
          meshType: mesh?.type || null,
          meshIsProxy: !!mesh?.userData?.proxy,
          meshMatType: mesh?.material?.type || null,
          refKind: ref?.kind || null,
          refBatchKey: ref?.batchKey || null,
          refInstanceId: typeof ref?.instanceId === 'number' ? (ref.instanceId | 0) : null,
          runStart,
          runLen:
            runStart != null && runLenArr && runStart >= 0 && runStart < runLenArr.length
              ? (runLenArr[runStart] | 0)
              : null,
        };
      }
      diffs.sort((a, b) => a - b);
      const p90 = diffs.length ? diffs[Math.floor(diffs.length * 0.9)] : null;
      return { ok: true, maxL1, p90, worst };
    });

    expect(compared.ok, compared.reason || 'compare failed').toBeTruthy();
    expect(typeof compared.p90 === 'number' && Number.isFinite(compared.p90)).toBeTruthy();
    expect(compared.p90, JSON.stringify(compared.worst, null, 2)).toBeLessThan(0.3);
  });
});

test.describe('instancing site tendon parity', () => {
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
      const snap: any = (window as any).__PLAY_HOST__?.getSnapshot?.() ?? null;
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
});

test.describe('instancing instancecolor attr', () => {
  const MODEL = 'mujoco_Rajagopal2015_simple.xml';
  const FORGE_BASE = '/dist/3.4.0/';

  async function pauseSimulation(page: any) {
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

  test('instanced meshes expose instanceColor in geometry attributes', async ({ page }) => {
    const url =
      `/?model=${encodeURIComponent(MODEL)}` +
      `&mode=worker&snapshot=1&log=0` +
      `&tbins=8&tmode=strict` +
      `&forgeBase=${encodeURIComponent(FORGE_BASE)}`;
    await waitForViewerReady(page, url);
    await pauseSimulation(page);

    const diag = await page.evaluate(() => {
      const MJ_OBJ_SITE = 6;
      const MJ_OBJ_TENDON = 18;
      const ctx: any = (window as any).__renderCtx;
      const inst: any = ctx?._instancing || null;
      if (!ctx || !inst || !(inst.batches instanceof Map)) return { ok: false, reason: 'instancing not active' };

      let batchesUsed = 0;
      let withMeshInstanceColor = 0;
      let withGeomInstanceColor = 0;
      let overlayBatches = 0;
      let overlayWithGeomInstanceColor = 0;
      const samples: any[] = [];

      for (const batch of inst.batches.values()) {
        const mesh = batch?.mesh || null;
        const used = batch?.used | 0;
        if (!mesh || !(used > 0)) continue;
        batchesUsed += 1;
        if (mesh.instanceColor) withMeshInstanceColor += 1;
        const geomAttr = mesh.geometry?.attributes?.instanceColor || null;
        if (geomAttr) withGeomInstanceColor += 1;
        const ot = typeof batch.objType === 'number' ? (batch.objType | 0) : null;
        const overlay = ot === MJ_OBJ_SITE || ot === MJ_OBJ_TENDON;
        if (overlay) {
          overlayBatches += 1;
          if (geomAttr) overlayWithGeomInstanceColor += 1;
        }
        if (samples.length < 12) {
          samples.push({
            key: String(batch.key || ''),
            used,
            objType: ot,
            material: mesh.material?.type || null,
            vertexColors: !!mesh.material?.vertexColors,
            meshHasInstanceColor: !!mesh.instanceColor,
            geomHasInstanceColor: !!geomAttr,
          });
        }
      }
      return {
        ok: true,
        batchesUsed,
        withMeshInstanceColor,
        withGeomInstanceColor,
        overlayBatches,
        overlayWithGeomInstanceColor,
        samples,
      };
    });

    expect(diag.ok).toBeTruthy();
    expect(diag.batchesUsed).toBeGreaterThan(0);
    expect(diag.withMeshInstanceColor).toBe(diag.batchesUsed);
    expect(diag.withGeomInstanceColor, JSON.stringify(diag.samples, null, 2)).toBe(diag.batchesUsed);
    expect(diag.overlayBatches).toBeGreaterThan(0);
    expect(diag.overlayWithGeomInstanceColor, JSON.stringify(diag.samples, null, 2)).toBe(diag.overlayBatches);
  });
});
