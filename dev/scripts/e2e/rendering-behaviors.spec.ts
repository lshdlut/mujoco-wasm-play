import { expect, test } from '@playwright/test';
import { firstVisibleGeomSummary, waitForViewerReady } from './test-utils';

test('segment mode switches to unlit materials', async ({ page }) => {
  await waitForViewerReady(page);

  const initial = await page.evaluate(firstVisibleGeomSummary);
  expect(initial?.materialType).not.toBe('MeshBasicMaterial');

  await page.evaluate(() => {
    const store = (window as any).__viewerStore;
    store?.update?.((draft) => {
      draft.rendering = draft.rendering || {};
      if (!Array.isArray(draft.rendering.sceneFlags)) {
        draft.rendering.sceneFlags = [];
      }
      draft.rendering.sceneFlags[7] = true;
    });
    const renderer = (window as any).__viewerRenderer;
    const snapshot = (window as any).__testSnapshot;
    if (renderer?.renderScene && snapshot) {
      renderer.renderScene(snapshot, store?.get?.() || {});
    }
  });

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

  await page.getByRole('button', { name: 'Visualization' }).click();

  const ambientInput = page.getByTestId('visualization.headlight_ambient');
  await ambientInput.fill('0.6 0.2 0.1');
  await ambientInput.press('Enter');

  await expect.poll(async () => {
    return page.evaluate(() => {
      const store = (window as any).__viewerStore;
      return store?.get?.()?.model?.vis?.headlight?.ambient;
    });
  }).toEqual([0.6, 0.2, 0.1]);

  await ambientInput.fill('0.6 0.2');
  await ambientInput.press('Enter');

  const toast = page.getByTestId('toast');
  await expect(toast).toContainText('invalid vector input');
  await expect(ambientInput).toHaveValue('0.6 0.2 0.1');
});
