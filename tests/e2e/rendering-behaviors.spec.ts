import { expect, test } from '@playwright/test';
import { firstVisibleGeomSummary, waitForViewerReady } from './test-utils';

test('segment mode switches to unlit materials', async ({ page }) => {
  await waitForViewerReady(page);

  const initial = await page.evaluate(firstVisibleGeomSummary);
  expect(initial?.materialType).not.toBe('MeshBasicMaterial');

  await page.evaluate(async () => {
    const controls = (window as any).__viewerControls;
    if (!controls?.listIds || !controls.toggleControl || !controls.getControl) {
      throw new Error('__viewerControls helpers are not available');
    }
    const ids: string[] = controls.listIds('rendering.opengl_flags.');
    const target = ids.find((id) => controls.getControl(id)?.binding === 'mjvScene::flags[7]');
    if (!target) throw new Error('segment control not found');
    await controls.toggleControl(target, true);
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

