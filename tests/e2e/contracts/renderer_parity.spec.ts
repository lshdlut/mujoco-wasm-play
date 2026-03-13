import fsSync from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { waitForViewerReady } from '../test-utils';

function localModelPath(model: string) {
  return path.resolve(process.cwd(), model.replace(/\//g, path.sep));
}

test.describe('convex hull parity', () => {
  test('convex hull toggles mesh geometry variant', async ({ page }) => {
    const MODEL = 'model/convex_hull/hull_mesh.xml';
    const FORGE_BASE = '/dist/3.4.0/';
    const modelPath = localModelPath(MODEL);
    if (!fsSync.existsSync(modelPath)) {
      test.skip(true, `Missing local model: ${modelPath}`);
    }
    const url =
      `/index.html?model=${encodeURIComponent(MODEL)}` +
      `&mode=worker&snapshot=1&log=0` +
      `&forgeBase=${encodeURIComponent(FORGE_BASE)}`;
    await waitForViewerReady(page, url);

    const hasGraphAssets = await page.evaluate(() => {
      const snapshot = (window as any).__PLAY_HOST__?.getSnapshot?.() ?? null;
      const assets = snapshot?.renderAssets || null;
      return !!assets?.meshes?.graphadr && !!assets?.meshes?.graph;
    });
    if (!hasGraphAssets) {
      test.skip(true, 'Forge build does not expose convex-hull graph assets in this environment');
    }

    await page.waitForFunction(() => !!(window as any).__PLAY_HOST__?.getSnapshot?.(), { timeout: 30_000, polling: 250 });
    const status = await page.evaluate(() => {
      const snapshot = (window as any).__PLAY_HOST__?.getSnapshot?.() ?? null;
      const assets = snapshot?.renderAssets || null;
      const snap = (window as any).__PLAY_HOST__?.getSnapshot?.() ?? null;
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
      const snap = win.__PLAY_HOST__?.getSnapshot?.();
      if (renderer?.renderScene && store?.get && snap) {
        renderer.renderScene(snap, store.get());
      }
    });

    const candidate = await page.evaluate(() => {
      const assets = (window as any).__PLAY_HOST__?.getSnapshot?.()?.renderAssets || null;
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
});

test.describe('slidercrank parity', () => {
  const MODEL = 'model/slider_crank/slider_crank.xml';
  // For local testing we always talk to the freshly built forge artifacts
  // served from this repo under dist/<ver>/.
  const FORGE_BASE = '/dist/3.4.0/';

  function readSlidercrankSummary() {
    const snapshot = (window as any).__PLAY_HOST__?.getSnapshot?.() ?? null;
    const vopt = Array.isArray(snapshot?.voptFlags) ? snapshot.voptFlags : [];
    const actuatorFlag = !!vopt[4];

    const renderer = (window as any).__viewerRenderer;
    const ctx = renderer?.getContext ? renderer.getContext() : null;
    const group = ctx?.slidercrankGroup || null;
    const pool = Array.isArray(ctx?.slidercrankPool) ? ctx.slidercrankPool : [];
    const children = pool.length ? pool : Array.isArray(group?.children) ? group.children : [];
    return {
      actuatorFlag,
      groupVisible: !!group?.visible,
      total: children.length,
      visible: children.filter((child: any) => !!child?.visible).length,
    };
  }

  test('slidercrank renders even when mjVIS_ACTUATOR is off', async ({ page }) => {
    const modelPath = localModelPath(MODEL);
    if (!fsSync.existsSync(modelPath)) {
      test.skip(true, `Missing local model: ${modelPath}`);
    }
    const url =
      `/?model=${encodeURIComponent(MODEL)}` +
      `&mode=worker&snapshot=1` +
      `&forgeBase=${encodeURIComponent(FORGE_BASE)}`;

    await waitForViewerReady(page, url);

    const deadline = Date.now() + 20_000;
    let lastDiag: any = null;
    while (Date.now() < deadline) {
      lastDiag = await page.evaluate(() => {
        const snap = (window as any).__PLAY_HOST__?.getSnapshot?.();
        const snapshot = (window as any).__PLAY_HOST__?.getSnapshot?.() || snap || null;
        const actuators = snapshot?.renderAssets?.actuators || null;
        const trntype = actuators?.trntype;
        const hasSlider = trntype
          ? Array.from(trntype).some((v: any) => (Number(v) | 0) === 2)
          : false;
        const renderer = (window as any).__viewerRenderer;
        const ctx = renderer?.getContext ? renderer.getContext() : null;
        const group = ctx?.slidercrankGroup || null;
        const pool = Array.isArray(ctx?.slidercrankPool) ? ctx.slidercrankPool : [];
        const visible = pool.filter((child: any) => !!child?.visible).length;
        const diagnostics = snapshot?.renderAssets?.extras?.diagnostics || null;
        return {
          href: location.href,
          search: location.search,
          params: Array.from(new URLSearchParams(location.search).entries()),
          requestedModel: new URLSearchParams(location.search).get('model'),
          runtimeModelLabel: (window as any).__viewerStore?.get?.()?.shell?.modelLabel || '',
          frame: Number.isFinite(snap?.frame) ? snap.frame : null,
          hasSiteXpos: !!snap?.site_xpos,
          hasSiteXmat: !!snap?.site_xmat,
          actuatorCount: Number(actuators?.count) || 0,
          hasActTrnid: !!actuators?.trnid,
          hasActTrntype: !!actuators?.trntype,
          hasActCrank: !!actuators?.cranklength,
          hasSlider,
          groupTotal: pool.length,
          groupVisible: visible,
          diagnostics,
        };
      });

      const ready =
        !!lastDiag?.hasActTrntype
        && !!lastDiag?.hasActTrnid
        && !!lastDiag?.hasActCrank
        && !!lastDiag?.hasSlider
        && !!lastDiag?.hasSiteXpos
        && !!lastDiag?.hasSiteXmat
        && Number(lastDiag?.groupVisible) > 0;
      if (ready) break;
      await page.waitForTimeout(250);
    }
    if (!(lastDiag?.hasActTrntype && lastDiag?.hasSlider)) {
      throw new Error(`slidercrank parity precondition unmet: ${JSON.stringify(lastDiag)}`);
    }

    const summary = await page.evaluate(readSlidercrankSummary);
    expect(summary.actuatorFlag).toBeFalsy();
    expect(summary.total).toBeGreaterThan(0);
    expect(summary.visible).toBeGreaterThan(0);
  });
});

test.describe('tendon catenary parity', () => {
  const MODEL = 'model/tendon_catenary/catenary.xml';
  const FORGE_BASE = '/dist/3.4.0/';

  function sceneTendonCounts() {
    const MJ_OBJ_TENDON = 18;
    const snap = (window as any).__PLAY_HOST__?.getSnapshot?.() ?? null;
    const n = Number(snap?.scn_ngeom) | 0;
    const objType = snap?.scn_objtype || null;
    const objId = snap?.scn_objid || null;
    if (!snap || !(n > 0) || !objType || !objId) return { ok: false };
    const counts = new Map<number, number>();
    for (let i = 0; i < n; i += 1) {
      if ((objType[i] | 0) !== MJ_OBJ_TENDON) continue;
      const id = objId[i] | 0;
      counts.set(id, (counts.get(id) || 0) + 1);
    }
    if (counts.size === 0) return { ok: false };
    let bestId = -1;
    let bestCount = 0;
    for (const [id, count] of counts.entries()) {
      if (count > bestCount) {
        bestId = id;
        bestCount = count;
      }
    }
    return { ok: true, tendonId: bestId, count: bestCount };
  }

  test('tendon catenary collapses to straight segments when gravity disabled', async ({ page }) => {
    const modelPath = localModelPath(MODEL);
    if (!fsSync.existsSync(modelPath)) {
      test.skip(true, `Missing local model: ${modelPath}`);
    }
    const url =
      `/?model=${encodeURIComponent(MODEL)}` +
      `&mode=worker&snapshot=1&log=0` +
      `&forgeBase=${encodeURIComponent(FORGE_BASE)}`;
    await waitForViewerReady(page, url);

    // Ensure gravity is enabled before we check the catenary path.
    const disableGravity = page.locator('[data-testid="physics.disable_flags.Gravity"]');
    await disableGravity.evaluate((el) => {
      const input = el as HTMLInputElement;
      if (input.checked) input.click();
    });

    await expect.poll(async () => {
      return page.evaluate(sceneTendonCounts);
    }, { timeout: 30_000, intervals: [250] }).toMatchObject({ ok: true });

    const initial = await page.evaluate(sceneTendonCounts);
    const tendonId = (initial as any).tendonId as number;

    await expect.poll(async () => {
      return page.evaluate(sceneTendonCounts);
    }, { timeout: 30_000, intervals: [250] }).toMatchObject({ ok: true, tendonId, count: expect.any(Number) });

    await page.waitForFunction((id: number) => {
      const MJ_OBJ_TENDON = 18;
      const v = (window as any).__PLAY_HOST__?.getSnapshot?.() ?? null;
      const n = Number(v?.scn_ngeom) | 0;
      const objType = v?.scn_objtype || null;
      const objId = v?.scn_objid || null;
      if (!v || !(n > 0) || !objType || !objId) return false;
      let total = 0;
      for (let i = 0; i < n; i += 1) {
        if ((objType[i] | 0) !== MJ_OBJ_TENDON) continue;
        if ((objId[i] | 0) !== (id | 0)) continue;
        total += 1;
      }
      return total > 1;
    }, tendonId, { timeout: 30_000, polling: 250 });

    // Disable gravity; catenary should collapse to a single segment.
    await disableGravity.evaluate((el) => {
      const input = el as HTMLInputElement;
      if (!input.checked) input.click();
    });

    await page.waitForFunction((id: number) => {
      const MJ_OBJ_TENDON = 18;
      const v = (window as any).__PLAY_HOST__?.getSnapshot?.() ?? null;
      const n = Number(v?.scn_ngeom) | 0;
      const objType = v?.scn_objtype || null;
      const objId = v?.scn_objid || null;
      if (!v || !(n > 0) || !objType || !objId) return false;
      let total = 0;
      for (let i = 0; i < n; i += 1) {
        if ((objType[i] | 0) !== MJ_OBJ_TENDON) continue;
        if ((objId[i] | 0) !== (id | 0)) continue;
        total += 1;
      }
      return total === 1;
    }, tendonId, { timeout: 30_000, polling: 250 });
  });
});

test.describe('flex layer parity', () => {
  const MODEL = 'model/mujoco_Rajagopal2015_simple.xml';
  const FORGE_BASE = '/dist/3.4.0/';

  async function setSliderNormalised(page: any, testId: string, t: number) {
    await page.getByTestId(testId).evaluate((el: any, next: number) => {
      const input = el as HTMLInputElement;
      input.value = String(next);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }, t);
  }

  test('flex_layer slider updates backend option state', async ({ page }) => {
    const url =
      `/?model=${encodeURIComponent(MODEL)}` +
      `&mode=worker&snapshot=1&log=0` +
      `&forgeBase=${encodeURIComponent(FORGE_BASE)}`;
    await waitForViewerReady(page, url);

    await page.waitForFunction(() => {
      const snap = (window as any).__PLAY_HOST__?.getSnapshot?.();
      return typeof snap?.options?.flex_layer === 'number';
    }, { timeout: 20_000, polling: 250 });

    const before = await page.evaluate(() => {
      const snap = (window as any).__PLAY_HOST__?.getSnapshot?.();
      return {
        snapFlexLayer: snap?.options?.flex_layer ?? null,
      };
    });
    expect(typeof before.snapFlexLayer).toBe('number');

    // ui_spec.json range is [0,10], slider stores a normalised t in [0,1]
    const target = 6;
    const t = target / 10;
    await setSliderNormalised(page, 'rendering.flex_layer', t);

    await page.waitForFunction(
      (v: number) => {
        const snap = (window as any).__PLAY_HOST__?.getSnapshot?.();
        return (snap?.options?.flex_layer | 0) === v;
      },
      target,
      { timeout: 20_000, polling: 250 },
    );
  });
});

test.describe('texture flag parity', () => {
  const MODEL = 'model/car/car.xml';
  const FORGE_BASE = '/dist/3.4.0/';

  function pickMeshWithMap() {
    const win = window as any;
    const snapshot = win.__PLAY_HOST__?.getSnapshot?.() ?? null;
    const vopt = Array.isArray(snapshot?.voptFlags) ? snapshot.voptFlags : null;
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
    const snapshot = win.__PLAY_HOST__?.getSnapshot?.() ?? null;
    const vopt = Array.isArray(snapshot?.voptFlags) ? snapshot.voptFlags : null;
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
      const snap = win.__PLAY_HOST__?.getSnapshot?.();
      if (renderer?.renderScene && store?.get && snap) {
        renderer.renderScene(snap, store.get());
      }
    });
  }

  test('mjVIS_TEXTURE toggles material.map (basic)', async ({ page }) => {
    const modelPath = localModelPath(MODEL);
    if (!fsSync.existsSync(modelPath)) {
      test.skip(true, `Missing local model: ${modelPath}`);
    }

    const url =
      `/index.html?model=${encodeURIComponent(MODEL)}` +
      `&mode=worker&snapshot=1&log=0` +
      `&forgeBase=${encodeURIComponent(FORGE_BASE)}`;
    await waitForViewerReady(page, url);

    await page.waitForFunction(() => {
      const win = window as any;
      const snapshot = win.__PLAY_HOST__?.getSnapshot?.() ?? null;
      const assets = snapshot?.renderAssets || null;
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
});
