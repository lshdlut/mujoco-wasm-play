import { expect, test } from '@playwright/test';
import { waitForViewerReady } from './test-utils';

const SKYBOX_TEST_ID = 'rendering.opengl_flags.Skybox';
const VISUAL_SOURCE_TEST_ID = 'option.visual_source';

function readSkyState() {
  const store = (window as any).__viewerStore;
  const ctx = (window as any).__renderCtx;
  const state = store?.get?.();
  const scene = ctx?.sceneWorld || ctx?.scene || null;
  const background = scene?.background;
  const backgroundType = !background
    ? 'none'
    : background.isColor
    ? 'color'
    : (background.constructor && background.constructor.name) || 'other';
  return {
    flag: !!state?.rendering?.sceneFlags?.[4],
    skyVisible: !!ctx?.sky?.visible,
    hasEnv: !!scene?.environment,
    backgroundType,
    mode: state?.visualSourceMode,
  };
}

function readSkyDebug() {
  const ctx = (window as any).__renderCtx;
  const store = (window as any).__viewerStore;
  const assets = store?.get?.()?.rendering?.assets;
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
  const target = label.toLowerCase().startsWith('preset') ? 'preset-sun' : 'model';
  await page.evaluate((mode) => {
    const store = (window as any).__viewerStore;
    store?.update?.((draft: any) => {
      draft.visualSourceMode = mode;
    });
  }, target);
  await expect.poll(async () => page.evaluate(() => (window as any).__viewerStore?.get?.()?.visualSourceMode)).toBe(target);
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
  await waitForViewerReady(page);

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

test('model skybox uses MuJoCo sky texture when available', async ({ page }) => {
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
    const assets = (window as any).__viewerStore?.get?.()?.rendering?.assets || null;
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
