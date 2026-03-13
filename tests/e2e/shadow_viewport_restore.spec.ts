import { expect, test } from '@playwright/test';
import { SCENE_FLAG_INDICES } from '../../core/viewer_defaults.mjs';
import { waitForViewerReady } from './test-utils';

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
