import { Page, expect, test } from '@playwright/test';
import { waitForViewerReady } from './test-utils';

const MODEL = 'mujoco_Rajagopal2015_simple.xml';
const FORGE_BASE = '/dist/3.3.7/';

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
    const snap: any = (window as any).__lastSnapshot || null;
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
