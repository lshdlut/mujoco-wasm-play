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

async function setVisualSource(page, label) {
  const target = label.toLowerCase().startsWith('preset') ? 'preset' : 'model';
  const control = page.getByTestId(VISUAL_SOURCE_TEST_ID);
  await control.getByText(label, { exact: true }).click();
  await expect.poll(async () => {
    return page.evaluate(() => (window as any).__viewerStore?.get?.()?.visualSourceMode);
  }).toBe(target);
}

async function setSkyboxState(page, enabled) {
  const state = await page.evaluate(readSkyState);
  if (state.flag === enabled) return;
  await page.getByTestId(SKYBOX_TEST_ID).click();
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
