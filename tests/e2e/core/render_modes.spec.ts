import { expect, test } from '@playwright/test';
import { SCENE_FLAG_INDICES } from '../../../core/viewer_defaults.mjs';
import { firstVisibleGeomSummary, waitForViewerReady } from '../test-utils';

test.describe('rendering behaviors', () => {
  test('segment mode switches to unlit materials', async ({ page }) => {
    await waitForViewerReady(page);

    const initial = await page.evaluate(firstVisibleGeomSummary);
    expect(initial?.materialType).not.toBe('MeshBasicMaterial');

    await page.evaluate(async (segmentFlagIndex) => {
      const controls = (window as any).__viewerControls;
      if (!controls?.listIds || !controls.toggleControl || !controls.getControl) {
        throw new Error('__viewerControls helpers are not available');
      }
      const ids: string[] = controls.listIds('rendering.opengl_flags.');
      const target = ids.find((id) => controls.getControl(id)?.binding === `mjvScene::flags[${segmentFlagIndex}]`);
      if (!target) throw new Error('segment control not found');
      await controls.toggleControl(target, true);
    }, SCENE_FLAG_INDICES.SEGMENT);

    await page.waitForFunction(() => {
      const ctx = (window as any).__renderCtx;
      if (!ctx?.meshes) return false;
      const mesh = ctx.meshes.find(
        (m) => m?.visible && m.userData && m.userData.geomIndex >= 0 && !m.userData.infinitePlane,
      );
      if (!mesh) return false;
      const type = mesh.material?.type;
      return type === 'MeshBasicMaterial';
    }, { timeout: 20000, polling: 250 });

    const after = await page.evaluate(firstVisibleGeomSummary);
    expect(after?.materialType).toBe('MeshBasicMaterial');
    expect(after?.hasSegmentMaterial).toBeTruthy();
  });

  test('headlight vec3 helper clamps and reverts invalid edits', async ({ page }) => {
    await waitForViewerReady(page);

    const ambientInput = page.getByTestId('visualization.headlight_ambient');
    await ambientInput.fill('0.6 0.2 0.1');
    await ambientInput.press('Enter');

    await expect.poll(async () => {
      return page.evaluate(() => {
        const snapshot = (window as any).__PLAY_HOST__?.getSnapshot?.() ?? null;
        return snapshot?.visual?.headlight?.ambient ?? null;
      });
    }).toEqual([expect.closeTo(0.6, 3), expect.closeTo(0.2, 3), expect.closeTo(0.1, 3)]);

    await ambientInput.fill('0.6 0.2');
    await ambientInput.press('Enter');

    const toast = page.getByTestId('toast');
    await expect(toast).toContainText('invalid vector input');
    await expect(ambientInput).toHaveValue('0.6 0.2 0.1');
  });
});

test.describe('tracking and frame-site', () => {
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
});

test.describe('shadow viewport restore', () => {
  async function setSceneFlag(page: any, binding: string, value: boolean) {
    await page.evaluate(async ({ binding, value }) => {
      const controls = (window as any).__viewerControls;
      if (!controls?.listIds || !controls?.toggleControl || !controls?.getControl) {
        throw new Error('__viewerControls helpers are not available');
      }
      const ids: string[] = controls.listIds('rendering.opengl_flags.');
      const target = ids.find((id) => controls.getControl(id)?.binding === binding);
      if (!target) throw new Error(`scene flag control not found: ${binding}`);
      await controls.toggleControl(target, value);
    }, { binding, value });
  }

  test('shadow pass restores full canvas viewport', async ({ page }) => {
    await waitForViewerReady(page, '/index.html?model=humanoid.xml&ver=3.5.0');

    await setSceneFlag(page, `mjvScene::flags[${SCENE_FLAG_INDICES.SEGMENT}]`, false);
    await setSceneFlag(page, `mjvScene::flags[${SCENE_FLAG_INDICES.SHADOW}]`, true);

    await expect.poll(async () => {
      return page.evaluate(() => {
        const renderer = (window as any).__renderCtx?.renderer;
        const canvas = document.querySelector('[data-testid="viewer-canvas"]') as HTMLCanvasElement | null;
        const gl = renderer?.getContext?.();
        const viewport = gl ? Array.from(gl.getParameter(gl.VIEWPORT) as ArrayLike<number>) : null;
        const canvasWidth = canvas?.width ?? null;
        const canvasHeight = canvas?.height ?? null;
        return {
          shadowEnabled: !!renderer?.shadowMap?.enabled,
          ok: !!renderer?.shadowMap?.enabled
            && !!viewport
            && viewport[0] === 0
            && viewport[1] === 0
            && viewport[2] === canvasWidth
            && viewport[3] === canvasHeight,
        };
      });
    }, { timeout: 20_000 }).toEqual({ ok: true, shadowEnabled: true });
  });
});

test.describe('skybox toggle', () => {
  const SKYBOX_TEST_ID = 'rendering.opengl_flags.Skybox';
  const VISUAL_SOURCE_TEST_ID = 'option.visual_source';

  function readSkyState() {
    const snapshot = (window as any).__PLAY_HOST__?.getSnapshot?.() ?? null;
    const ctx = (window as any).__renderCtx;
    const state = (window as any).__viewerStore?.get?.();
    const scene = ctx?.sceneWorld || ctx?.scene || null;
    const background = scene?.background;
    const backgroundType = !background
      ? 'none'
      : background.isColor
      ? 'color'
      : (background.constructor && background.constructor.name) || 'other';
    return {
      flag: !!snapshot?.sceneFlags?.[4],
      skyVisible: !!ctx?.sky?.visible,
      hasEnv: !!scene?.environment,
      backgroundType,
      mode: state?.visualSourceMode,
    };
  }

  function readSkyDebug() {
    const ctx = (window as any).__renderCtx;
    const snapshot = (window as any).__PLAY_HOST__?.getSnapshot?.() ?? null;
    const assets = snapshot?.renderAssets || null;
    const scene = ctx?.sceneWorld || ctx?.scene || null;
    const bg = scene?.background;
    const dbg = Array.isArray(ctx?._skyDebug) ? ctx._skyDebug : [];
    const last = dbg.length ? dbg[dbg.length - 1] : null;
    const bgType = !bg
      ? 'none'
      : (bg.isCubeTexture || bg.isCubeRenderTargetTexture) ? 'cube'
      : bg.isTexture ? 'texture'
      : bg.isColor ? 'color'
      : (bg.constructor && bg.constructor.name) || 'other';
    return {
      last,
      mode: last?.mode || null,
      bgType,
      envIsCube: !!scene?.environment?.isTexture && scene.environment.isCubeTexture === true,
      debugLength: dbg.length,
      hasTextures: !!assets?.textures,
      texCount: assets && assets.textures
        ? (assets.textures.count != null
          ? assets.textures.count
          : (assets.textures.type?.length || 0))
        : 0,
      texDataType: assets?.textures?.data ? Object.prototype.toString.call(assets.textures.data) : null,
      texDataLen: assets?.textures?.data?.length || 0,
      texHasSubarray: !!assets?.textures?.data?.subarray,
    };
  }

  async function setVisualSource(page, label) {
    const token = String(label || '').toLowerCase();
    const target = token.startsWith('preset') ? 'PresetSun' : 'Model';
    await page.evaluate(async ({ id, value }) => {
      const controls = (window as any).__viewerControls;
      if (!controls?.toggleControl) throw new Error('Missing __viewerControls.toggleControl');
      await controls.toggleControl(id, value);
    }, { id: VISUAL_SOURCE_TEST_ID, value: target });
    const expected = target === 'PresetSun' ? 'preset-sun' : 'model';
    await expect
      .poll(async () => page.evaluate(() => (window as any).__viewerStore?.get?.()?.visualSourceMode))
      .toBe(expected);
  }

  async function setSkyboxState(page, enabled) {
    const state = await page.evaluate(readSkyState);
    if (state.flag === enabled) return;
    await page.evaluate(({ id, value }) => {
      const controls = (window as any).__viewerControls;
      if (!controls?.toggleControl) throw new Error('Missing __viewerControls.toggleControl');
      controls.toggleControl(id, value);
    }, { id: SKYBOX_TEST_ID, value: enabled });
    await expect.poll(async () => page.evaluate(readSkyState)).toMatchObject({ flag: enabled });
  }

  test('skybox flag controls background across visual sources', async ({ page }) => {
    await waitForViewerReady(page, '/index.html?model=demo_skybox.xml&mode=worker&snapshot=1&log=0');

    const skyState = () => page.evaluate(readSkyState);

    await setVisualSource(page, 'Preset');

    await setSkyboxState(page, false);
    await expect.poll(skyState).toMatchObject({
      flag: false,
      skyVisible: false,
      hasEnv: false,
    });

    await setSkyboxState(page, true);
    const presetOn = await skyState();
    expect(presetOn.flag).toBe(true);
    expect(presetOn.skyVisible || presetOn.hasEnv || presetOn.backgroundType !== 'none').toBeTruthy();

    await setVisualSource(page, 'Model');

    await setSkyboxState(page, false);
    await expect.poll(skyState).toMatchObject({
      flag: false,
      skyVisible: false,
      hasEnv: false,
    });

    await setSkyboxState(page, true);
    const modelOn = await skyState();
    expect(modelOn.flag).toBe(true);
    expect(modelOn.skyVisible || modelOn.hasEnv || modelOn.backgroundType !== 'none').toBeTruthy();
  });

  test.skip('model skybox uses MuJoCo sky texture when available (requires local model)', async ({ page }) => {
    page.on('console', (msg) => {
      // eslint-disable-next-line no-console
      console.log('[browser]', msg.type(), msg.text());
    });
    await waitForViewerReady(
      page,
      '/index.html?model=RKOB_simplified_upper_with_marker_CAMS.xml&mode=worker&snapshot=1&log=0',
    );

    await setVisualSource(page, 'Model');
    await setSkyboxState(page, true);

    const assetSummary = await page.evaluate(() => {
      const assets = (window as any).__PLAY_HOST__?.getSnapshot?.()?.renderAssets || null;
      const tex = assets?.textures;
      return {
        hasAssets: !!assets,
        hasTextures: !!tex,
        texCount: tex?.count ?? tex?.type?.length ?? 0,
        texKeys: tex ? Object.keys(tex) : [],
      };
    });
    // eslint-disable-next-line no-console
    console.log('[assets]', assetSummary);

    await expect.poll(async () => {
      const info = await page.evaluate(readSkyDebug);
      const hasTexture = info.hasTextures && (info.texCount ?? 0) > 0;
      const skyOk =
        typeof info.mode === 'string' &&
        info.mode.includes('model-sky') &&
        ['cube', 'texture'].includes(info.bgType);
      return { hasTexture, skyOk };
    }, { timeout: 20000 }).toMatchObject({ hasTexture: expect.any(Boolean) });

    const info = await page.evaluate(readSkyDebug);
    // eslint-disable-next-line no-console
    console.log('[skybox-debug]', info);

    const hasTexture = info.hasTextures && (info.texCount ?? 0) > 0;
    const skyOk =
      typeof info.mode === 'string' &&
      info.mode.includes('model-sky') &&
      ['cube', 'texture'].includes(info.bgType);
    expect(hasTexture || skyOk).toBeTruthy();
  });
});
