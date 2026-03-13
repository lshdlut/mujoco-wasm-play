import { expect, test } from '@playwright/test';
import { waitForViewerReady } from '../test-utils';

test.describe('info overlay', () => {
  const MODEL_URL = '/index.html?model=model/mujoco_Rajagopal2015_simple.xml';

  async function openInfoOverlay(page: any, url = MODEL_URL) {
    await waitForViewerReady(page, url);
    // Ensure viewer loop is running for FPS and info updates.
    await page.evaluate(() => {
      const renderer = (window as any).__viewerRenderer;
      const store = (window as any).__viewerStore;
      if (renderer?.ensureLoop && store?.get) {
        renderer.ensureLoop();
      }
      const s = store?.get?.();
      if (s && s.overlays && !s.overlays.info && typeof store.update === 'function') {
        store.update((draft: any) => {
          draft.overlays.info = true;
        });
      }
    });
    const card = page.locator('[data-testid="overlay-info"]');
    await expect(card).toBeVisible();
    return card;
  }

  test.describe('F2 info overlay stats', () => {
    test('Size row shows nefc/ncon when running', async ({ page }) => {
      const card = await openInfoOverlay(page);
      // Let a few frames render to populate info.
      await page.waitForTimeout(500);
      const sizeText = await card.locator('.info-value[data-info-field="size"]').innerText();
      // At minimum we expect something like "nefc (ncon con)".
      expect(sizeText).toMatch(/\d+\s*\(\d+\s+con\)/);
    });

    test('FPS row reports positive fps while running', async ({ page }) => {
      const card = await openInfoOverlay(page);
      // Wait for render loop and FPS estimate to stabilise.
      await page.waitForFunction(() => {
        const store = (window as any).__viewerStore;
        const state = store?.get?.();
        if (!state) return false;
        const textEl = document.querySelector('.info-value[data-info-field="fps"]');
        if (!textEl) return false;
        const text = textEl.textContent || '';
        const num = Number.parseFloat(text);
        return Number.isFinite(num) && num > 0.5;
      }, { timeout: 5000 });
      const fpsText = await card.locator('.info-value[data-info-field="fps"]').innerText();
      const value = Number.parseFloat(fpsText);
      expect(Number.isFinite(value)).toBe(true);
      expect(value).toBeGreaterThan(0.5);
    });

    test('Memory/Energy/Islands rows do not stay all-n/a after warmup', async ({ page }) => {
      const card = await openInfoOverlay(page);
      // Warm up a bit to give the backend time to collect stats.
      await page.waitForTimeout(1000);
      const memoryText = await card.locator('.info-value[data-info-field="memory"]').innerText();
      const energyText = await card.locator('.info-value[data-info-field="energy"]').innerText();
      const islandsText = await card.locator('.info-value[data-info-field="islands"]').innerText();

      // Allow "n/a" for fields that the current ABI cannot populate,
      // but require at least one of {memory, energy, islands} to carry a numeric payload.
      const hasNumericMemory = /[0-9]/.test(memoryText) && !/n\/a/i.test(memoryText);
      const energyVal = Number.parseFloat(energyText);
      const islandsVal = Number.parseInt(islandsText, 10);

      expect(
        hasNumericMemory ||
        (Number.isFinite(energyVal) && energyVal !== 0) ||
        (Number.isFinite(islandsVal) && islandsVal >= 0),
      ).toBe(true);
    });

    test('Raj debug snapshot pipeline carries info payload', async ({ page }) => {
      // Mirror the user flow: debug=1&snapshot=1, default model (Raj alias).
      const card = await openInfoOverlay(page, '/index.html?debug=1&snapshot=1');
      await page.waitForTimeout(800);
      const infoDump = await page.evaluate(() => {
        const snapshot = (window as any).__PLAY_HOST__?.getSnapshot?.() ?? null;
        return {
          hudInfo: snapshot?.info ?? null,
          hudTime: snapshot?.t ?? null,
          simRun: snapshot?.paused === false,
          snapshotInfo: snapshot?.info ?? null,
          debugInfo: (window as any).__infoDebug ?? null,
        };
      });
      // Log to test output for debugging.
      console.log('raj-debug-info', JSON.stringify(infoDump));
      // At minimum, snapshot.info should exist and be an object when running.
      expect(infoDump.snapshotInfo && typeof infoDump.snapshotInfo === 'object').toBe(true);
      expect(infoDump.simRun).toBe(true);
    });
  });
});

test.describe('label anchors', () => {
  async function enableSiteLabels(page: any) {
    await page.evaluate(async () => {
      const controls = (window as any).__viewerControls;
      if (!controls?.listIds || !controls?.toggleControl || !controls?.getControl) {
        throw new Error('__viewerControls helpers are not available');
      }
      const ids: string[] = controls.listIds('');
      const labelId = ids.find((id) => controls.getControl(id)?.binding === 'mjvOption::label');
      if (!labelId) throw new Error('label mode control not found');
      await controls.toggleControl(labelId, 4);
      (window as any).__viewerRenderer?.renderScene?.(
        (window as any).__PLAY_HOST__?.getSnapshot?.(),
        (window as any).__viewerStore?.get?.(),
      );
    });
  }

  test('site labels use projected scene anchors and are no longer capped at 120', async ({ page }) => {
    await waitForViewerReady(page, '/index.html?model=raj&ver=3.5.0');
    await enableSiteLabels(page);

    await expect.poll(async () => {
      return page.evaluate(() => (window as any).__renderCtx?.labelOverlay?.drawnCount ?? 0);
    }, { timeout: 20_000 }).toBeGreaterThan(120);

    await expect.poll(async () => {
      return page.evaluate(() => {
        const ctx = (window as any).__renderCtx;
        const overlay = ctx?.labelOverlay || null;
        const camera = ctx?.camera || null;
        const sample = overlay?.sample || null;
        if (!overlay || !camera || !sample) return null;
        const anchor = camera.position.clone();
        anchor.set(sample.anchorWorld[0], sample.anchorWorld[1], sample.anchorWorld[2]);
        anchor.project(camera);
        const x = (anchor.x * 0.5 + 0.5) * overlay.width;
        const y = (-anchor.y * 0.5 + 0.5) * overlay.height;
        return Math.hypot(x - sample.screen[0], y - sample.screen[1]);
      });
    }, { timeout: 20_000 }).toBeLessThan(0.5);

    await expect.poll(async () => {
      return page.evaluate(() => (window as any).__renderCtx?.labelOverlay?.fontPx ?? null);
    }, { timeout: 20_000 }).toBe(12);
  });

  test('site labels keep fixed pixel size when the camera moves', async ({ page }) => {
    await waitForViewerReady(page, '/index.html?model=raj&ver=3.5.0');
    await enableSiteLabels(page);

    await expect.poll(async () => {
      return page.evaluate(() => (window as any).__renderCtx?.labelOverlay?.fontPx ?? null);
    }, { timeout: 20_000 }).toBe(12);
    const before = await page.evaluate(() => (window as any).__renderCtx?.labelOverlay?.fontPx ?? null);

    await page.evaluate(async () => {
      const ctx = (window as any).__renderCtx;
      if (!ctx?.camera) throw new Error('render camera missing');
      ctx.camera.position.multiplyScalar(0.6);
      ctx.camera.updateProjectionMatrix?.();
      ctx.camera.updateMatrixWorld?.();
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    });

    await expect.poll(async () => {
      return page.evaluate(() => (window as any).__renderCtx?.labelOverlay?.fontPx ?? null);
    }, { timeout: 20_000 }).toBe(before);
  });

  test('site labels stay suppressed when hideAllGeometry is active', async ({ page }) => {
    await waitForViewerReady(page, '/index.html?model=raj&ver=3.5.0');
    await enableSiteLabels(page);

    await expect.poll(async () => {
      return page.evaluate(() => (window as any).__renderCtx?.labelOverlay?.drawnCount ?? 0);
    }, { timeout: 20_000 }).toBeGreaterThan(0);

    await page.evaluate(() => {
      const store = (window as any).__viewerStore;
      const renderer = (window as any).__viewerRenderer;
      const snapshot = (window as any).__PLAY_HOST__?.getSnapshot?.();
      if (!store?.update) throw new Error('__viewerStore.update unavailable');
      store.update((draft: any) => {
        if (!draft.rendering) draft.rendering = {};
        draft.rendering.hideAllGeometry = true;
      });
      renderer?.renderScene?.(snapshot, store.get());
    });

    await expect.poll(async () => {
      return page.evaluate(() => (window as any).__renderCtx?.labelOverlay?.drawnCount ?? -1);
    }, { timeout: 20_000 }).toBe(0);
  });
});

test.describe('history sampling', () => {
  async function setRunState(page: any, run: boolean) {
    await page.evaluate(async (nextRun) => {
      const backend = (window as any).__PLAY_HOST__?.backend;
      if (!backend?.setRunState) throw new Error('backend.setRunState not available');
      await backend.setRunState(nextRun, 'test');
    }, run);
    await page.waitForFunction((nextRun) => {
      const snapshot = (window as any).__PLAY_HOST__?.getSnapshot?.() ?? null;
      return !!snapshot && (snapshot.paused === !nextRun);
    }, run, { timeout: 20_000, polling: 100 });
  }

  async function scrubHistory(page: any, direction: number, expectedOffset: number) {
    await page.evaluate(async (nextDirection) => {
      const backend = (window as any).__PLAY_HOST__?.backend;
      if (!backend?.step) throw new Error('backend.step not available');
      await backend.step(nextDirection);
    }, direction);
    await page.waitForFunction((nextOffset) => {
      const snapshot = (window as any).__PLAY_HOST__?.getSnapshot?.() ?? null;
      return !!snapshot && Number(snapshot?.history?.scrubIndex) === nextOffset;
    }, expectedOffset, { timeout: 20_000, polling: 100 });
  }

  test('history stepping stays aligned with simulation steps', async ({ page }) => {
    await waitForViewerReady(page, '/index.html?model=raj&font=100');
    await setRunState(page, false);

    const before = await page.evaluate(() => {
      const snapshot = (window as any).__PLAY_HOST__?.getSnapshot?.() ?? null;
      return {
        count: Number(snapshot?.history?.count) || 0,
        time: Number(snapshot?.t) || 0,
        dt: Number(snapshot?.options?.timestep) || 0.002,
      };
    });

    await setRunState(page, true);
    await page.waitForFunction((startTime) => {
      const snapshot = (window as any).__PLAY_HOST__?.getSnapshot?.() ?? null;
      return !!snapshot && Number(snapshot?.t) >= (startTime + 0.05);
    }, before.time, { timeout: 20_000, polling: 50 });
    await setRunState(page, false);

    const live = await page.evaluate(() => {
      const snapshot = (window as any).__PLAY_HOST__?.getSnapshot?.() ?? null;
      return {
        count: Number(snapshot?.history?.count) || 0,
        time: Number(snapshot?.t) || 0,
        dt: Number(snapshot?.options?.timestep) || 0.002,
      };
    });
    expect(live.count).toBeGreaterThan(10);

    await scrubHistory(page, -1, -1);
    const stepBackOne = await page.evaluate(() => {
      const snapshot = (window as any).__PLAY_HOST__?.getSnapshot?.() ?? null;
      return Number(snapshot?.t) || 0;
    });

    await scrubHistory(page, -1, -2);
    const stepBackTwo = await page.evaluate(() => {
      const snapshot = (window as any).__PLAY_HOST__?.getSnapshot?.() ?? null;
      return Number(snapshot?.t) || 0;
    });

    const oneStepDelta = live.time - stepBackOne;
    const twoStepDelta = live.time - stepBackTwo;
    const tolerance = live.dt * 0.55;

    expect(oneStepDelta).toBeGreaterThan(live.dt - tolerance);
    expect(oneStepDelta).toBeLessThan(live.dt + tolerance);
    expect(twoStepDelta).toBeGreaterThan((2 * live.dt) - tolerance);
    expect(twoStepDelta).toBeLessThan((2 * live.dt) + tolerance);
  });
});

test.describe('hfield touch grid', () => {
  function readHfieldMeshSummary() {
    const ctx = (window as any).__renderCtx;
    const meshes = Array.isArray(ctx?.meshes) ? ctx.meshes : [];
    const mesh =
      meshes.find((m: any) => m?.userData?.geomName === 'a') ||
      meshes.find((m: any) => (m?.userData?.geomType | 0) === 1) ||
      null;
    const geom = mesh?.geometry || null;
    const pos = geom?.getAttribute?.('position') || null;
    const index = geom?.getIndex?.() || null;
    const bb = geom?.boundingBox || null;
    return {
      found: !!mesh,
      geomType: mesh?.userData?.geomType ?? null,
      positionCount: typeof pos?.count === 'number' ? pos.count : 0,
      indexCount: typeof index?.count === 'number' ? index.count : 0,
      bboxZSpan: bb ? (Number(bb.max?.z) - Number(bb.min?.z)) : null,
    };
  }

  test('touch_grid hfield geom "a" renders as heightfield (not a plane)', async ({ page }) => {
    test.setTimeout(120_000);

    await waitForViewerReady(page, '/index.html?model=sensor&ver=3.5.0&snapshot=1&log=0', { timeoutMs: 90_000 });

    await page.waitForFunction(() => {
      const ctx = (window as any).__renderCtx;
      const meshes = Array.isArray(ctx?.meshes) ? ctx.meshes : [];
      const mesh =
        meshes.find((m: any) => m?.userData?.geomName === 'a') ||
        meshes.find((m: any) => (m?.userData?.geomType | 0) === 1) ||
        null;
      const pos = mesh?.geometry?.getAttribute?.('position') || null;
      return !!pos && typeof pos.count === 'number' && pos.count > 16;
    }, { timeout: 30_000 });

    const summary = await page.evaluate(readHfieldMeshSummary);
    expect(summary.found).toBeTruthy();
    expect(summary.positionCount).toBeGreaterThan(16);
    expect(summary.bboxZSpan == null || summary.bboxZSpan > 0).toBeTruthy();
  });
});

test.describe('raj site tendon rgba', () => {
  const MODEL = 'mujoco_Rajagopal2015_simple.xml';
  const FORGE_BASE = '/dist/3.4.0/';

  type Stats = {
    n: number;
    r: { min: number | null; max: number | null; mean: number | null };
    g: { min: number | null; max: number | null; mean: number | null };
    b: { min: number | null; max: number | null; mean: number | null };
    a: { min: number | null; max: number | null; mean: number | null };
  };

  function summarize(values: number[]) {
    if (!values.length) return { min: null, max: null, mean: null };
    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;
    let sum = 0;
    for (const v of values) {
      if (v < min) min = v;
      if (v > max) max = v;
      sum += v;
    }
    return { min, max, mean: sum / values.length };
  }

  test('raj site/tendon scn_rgba ranges', async ({ page }) => {
    const url =
      `/?model=${encodeURIComponent(MODEL)}` +
      `&mode=worker&snapshot=1&log=0` +
      `&forgeBase=${encodeURIComponent(FORGE_BASE)}`;
    await waitForViewerReady(page, url);

    const diag = await page.evaluate(() => {
      const MJ_OBJ_SITE = 6;
      const MJ_OBJ_TENDON = 18;
      const snap: any = (window as any).__PLAY_HOST__?.getSnapshot?.() ?? null;
      if (!snap) return { ok: false, reason: 'no snapshot' };
      const n = Number(snap.scn_ngeom) | 0;
      const objType: any = snap.scn_objtype || null;
      const rgba: any = snap.scn_rgba || null;
      if (!objType || !rgba || rgba.length < n * 4) return { ok: false, reason: 'missing scn_objtype/scn_rgba' };

      const out = {
        ok: true,
        n,
        site: { r: [], g: [], b: [], a: [] } as any,
        tendon: { r: [], g: [], b: [], a: [] } as any,
        siteGtypes: Object.create(null) as Record<string, number>,
        tendonGtypes: Object.create(null) as Record<string, number>,
      };
      const gtype: any = snap.scn_type || null;

      for (let si = 0; si < n; si += 1) {
        const ot = objType[si] | 0;
        if (ot !== MJ_OBJ_SITE && ot !== MJ_OBJ_TENDON) continue;
        const base = si * 4;
        const r = Number(rgba[base + 0]) || 0;
        const g = Number(rgba[base + 1]) || 0;
        const b = Number(rgba[base + 2]) || 0;
        const a = Number(rgba[base + 3]) || 0;
        const dst = ot === MJ_OBJ_SITE ? out.site : out.tendon;
        dst.r.push(r);
        dst.g.push(g);
        dst.b.push(b);
        dst.a.push(a);
        if (gtype) {
          const gt = gtype[si] | 0;
          const map = ot === MJ_OBJ_SITE ? out.siteGtypes : out.tendonGtypes;
          const key = String(gt);
          map[key] = (map[key] || 0) + 1;
        }
      }
      return out;
    });

    expect(diag.ok).toBeTruthy();

    const siteR = summarize(diag.site.r);
    const siteG = summarize(diag.site.g);
    const siteB = summarize(diag.site.b);
    const siteA = summarize(diag.site.a);
    const tendonR = summarize(diag.tendon.r);
    const tendonG = summarize(diag.tendon.g);
    const tendonB = summarize(diag.tendon.b);
    const tendonA = summarize(diag.tendon.a);

    const siteStats: Stats = { n: diag.site.r.length, r: siteR, g: siteG, b: siteB, a: siteA };
    const tendonStats: Stats = { n: diag.tendon.r.length, r: tendonR, g: tendonG, b: tendonB, a: tendonA };

    // eslint-disable-next-line no-console
    console.log('[raj] site scn_rgba stats', siteStats, 'gtypes', diag.siteGtypes);
    // eslint-disable-next-line no-console
    console.log('[raj] tendon scn_rgba stats', tendonStats, 'gtypes', diag.tendonGtypes);

    expect(siteStats.n).toBeGreaterThan(0);
    expect(tendonStats.n).toBeGreaterThan(0);
  });
});
