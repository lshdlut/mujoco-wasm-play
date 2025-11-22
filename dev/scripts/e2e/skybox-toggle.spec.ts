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
  // Ensure left panel (Option) is visible
  await page.evaluate(() => {
    const store = (window as any).__viewerStore;
    store?.update?.((draft: any) => {
      if (!draft.panels) draft.panels = {};
      draft.panels.left = true;
      draft.overlays = draft.overlays || {};
      draft.overlays.fullscreen = false;
    });
  });
  const target = label.toLowerCase().startsWith('preset') ? 'preset' : 'model';
  await page.evaluate((lbl) => {
    const control = document.querySelector('[data-testid=\"option.visual_source\"]') as HTMLElement | null;
    if (!control) return;
    control.style.display = 'flex';
    control.style.visibility = 'visible';
    control.style.minHeight = '32px';
    const buttons = Array.from(control.querySelectorAll('input,button,span,label'));
    const match = buttons.find((node) => (node.textContent || '').trim().toLowerCase() === lbl.toLowerCase());
    if (match && 'click' in match) {
      (match as HTMLElement).click();
    }
  }, label);
  await expect.poll(async () => {
    return page.evaluate(() => (window as any).__viewerStore?.get?.()?.visualSourceMode);
  }).toBe(target);
}

async function setSkyboxState(page, enabled) {
  const state = await page.evaluate(readSkyState);
  if (state.flag === enabled) return;
  await page.evaluate((value) => {
    const store = (window as any).__viewerStore;
    store?.update?.((draft: any) => {
      if (!draft.rendering) draft.rendering = {};
      if (!Array.isArray(draft.rendering.sceneFlags)) {
        draft.rendering.sceneFlags = Array.from({ length: 10 }, () => true);
      }
      draft.rendering.sceneFlags[4] = !!value;
    });
  }, enabled);
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
