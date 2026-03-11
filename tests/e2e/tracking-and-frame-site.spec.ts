import { expect, test } from '@playwright/test';
import { waitForViewerReady } from './test-utils';

test('camera mode switches to tracking and enables tracking geom select', async ({ page }) => {
  await waitForViewerReady(page, '/index.html?model=raj&ver=3.5.0&snapshot=1&log=0', { timeoutMs: 120_000 });

  await page.evaluate(async () => {
    const controls = (window as any).__viewerControls;
    if (!controls?.toggleControl) throw new Error('__viewerControls.toggleControl not found');
    await controls.toggleControl('rendering.camera_mode', 1);
  });

  await page.waitForFunction(() => {
    const snapshot = (window as any).__PLAY_HOST__?.getSnapshot?.() ?? null;
    return (Number(snapshot?.cameraMode) | 0) === 1;
  }, { timeout: 20_000, polling: 200 });

  await page.waitForFunction(() => {
    const ctx = (window as any).__renderCtx;
    return (Number(ctx?.currentCameraMode) | 0) === 1;
  }, { timeout: 20_000, polling: 200 });

  await page.waitForFunction(() => {
    const select = document.querySelector('[data-testid="rendering.tracking_geom"]');
    if (!(select instanceof HTMLSelectElement)) return false;
    return !select.disabled;
  }, { timeout: 20_000, polling: 200 });
});

test('frame/site does not leave stale geom meshes visible', async ({ page }) => {
  await waitForViewerReady(page, '/index.html?model=raj&ver=3.5.0&snapshot=1&log=0', { timeoutMs: 120_000 });

  const readSceneIntegrity = () => page.evaluate(() => {
    const validGeomTypes = new Set([0, 1, 2, 3, 4, 5, 6, 7, 8, 100, 101, 102, 103, 104, 105, 106, 107, 108, 1001]);
    const validObjTypes = new Set([
      0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25,
      100, 101, 102,
    ]);
    const snapshot = (window as any).__PLAY_HOST__?.getSnapshot?.() ?? null;
    const ctx = (window as any).__renderCtx;
    const invalidTypes: Array<{ index: number; value: number }> = [];
    const invalidObjTypes: Array<{ index: number; value: number }> = [];
    const scnNgeom = Number(snapshot?.scn_ngeom) | 0;
    for (let i = 0; i < scnNgeom; i += 1) {
      const geomType = Number(snapshot?.scn_type?.[i]) | 0;
      const objType = Number(snapshot?.scn_objtype?.[i]) | 0;
      if (!validGeomTypes.has(geomType) && invalidTypes.length < 8) {
        invalidTypes.push({ index: i, value: geomType });
      }
      if (!validObjTypes.has(objType) && invalidObjTypes.length < 8) {
        invalidObjTypes.push({ index: i, value: objType });
      }
    }
    const visibleGeomMeshes = Array.isArray(ctx?.meshes)
      ? ctx.meshes.filter(
          (m: any) => m?.visible && m.userData && m.userData.geomIndex >= 0 && !m.userData.infinitePlane,
        ).length
      : null;
    return {
      scnNgeom,
      frameMode: Number(snapshot?.frameMode) | 0,
      invalidTypes,
      invalidObjTypes,
      visibleGeomMeshes,
      meshCount: Array.isArray(ctx?.meshes) ? ctx.meshes.length : 0,
      tSim: Number(snapshot?.tSim) || 0,
    };
  });

  const before = await readSceneIntegrity();
  expect(before.invalidTypes).toEqual([]);
  expect(before.invalidObjTypes).toEqual([]);
  expect(before.visibleGeomMeshes).toBeTruthy();
  expect(before.scnNgeom).toBeGreaterThan(0);

  await page.evaluate(async () => {
    const controls = (window as any).__viewerControls;
    if (!controls?.toggleControl) throw new Error('__viewerControls.toggleControl not found');
    await controls.toggleControl('rendering.frame_mode', 3);
  });

  await page.waitForFunction(() => {
    const snapshot = (window as any).__PLAY_HOST__?.getSnapshot?.() ?? null;
    return (Number(snapshot?.frameMode) | 0) === 3;
  }, { timeout: 20_000, polling: 200 });
  await page.waitForTimeout(250);

  const frameSite = await readSceneIntegrity();
  expect(frameSite.frameMode).toBe(3);
  expect(frameSite.invalidTypes).toEqual([]);
  expect(frameSite.invalidObjTypes).toEqual([]);
  expect(frameSite.visibleGeomMeshes).toBeTruthy();
  expect(frameSite.meshCount).toBeGreaterThanOrEqual(frameSite.visibleGeomMeshes!);

  await page.evaluate(async () => {
    const controls = (window as any).__viewerControls;
    if (!controls?.toggleControl) throw new Error('__viewerControls.toggleControl not found');
    await controls.toggleControl('rendering.frame_mode', 0);
  });

  await page.waitForFunction(() => {
    const snapshot = (window as any).__PLAY_HOST__?.getSnapshot?.() ?? null;
    return (Number(snapshot?.frameMode) | 0) === 0;
  }, { timeout: 20_000, polling: 200 });
  await page.waitForTimeout(250);

  const after = await readSceneIntegrity();
  expect(after.frameMode).toBe(0);
  expect(after.invalidTypes).toEqual([]);
  expect(after.invalidObjTypes).toEqual([]);
  expect(after.visibleGeomMeshes).toBeTruthy();
  expect(after.meshCount).toBeGreaterThanOrEqual(after.visibleGeomMeshes!);

  // The renderer should not keep old geom meshes visible after the frame-mode rebuild.
  expect(after.visibleGeomMeshes!).toBeLessThanOrEqual(after.scnNgeom + 25);
});
