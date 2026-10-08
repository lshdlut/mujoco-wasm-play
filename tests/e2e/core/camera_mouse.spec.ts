import { expect, test } from '@playwright/test';
import { waitForViewerReady } from '../test-utils';

for (const version of ['3.15.0', '3.8.1']) {
  for (const entry of ['index.html', 'pthreads/index.html']) {
    test(`native mouse camera ${version} ${entry}: rotation, pan and wheel change camera and projection`, async ({ page }, testInfo) => {
      test.skip(entry.startsWith('pthreads') && process.env.PLAY_DEV_SERVER_COI !== '1', 'Requires isolated server');
      const errors: string[] = [];
      const network: string[] = [];
      page.on('pageerror', error => errors.push(String(error)));
      page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
      page.on('requestfailed', request => network.push(request.url()));
      page.on('response', response => { if (response.status() >= 400) network.push(`${response.status()} ${response.url()}`); });
      await waitForViewerReady(page, `/${entry}?model=cards&ver=${version}&log=0`);
      await page.evaluate(() => (window as any).__PLAY_HOST__.backend.setRunState(false, 'camera regression'));
      await page.waitForFunction(() => {
        const snapshot = (window as any).__PLAY_HOST__.getSnapshot();
        return snapshot.paused && snapshot.viewerCamera && (window as any).__renderCtx.viewerCameraSynced;
      });
      const state = () => page.evaluate(() => {
        const snapshot = (window as any).__PLAY_HOST__.getSnapshot();
        const camera = (window as any).__renderCtx.camera;
        const projection = camera.position.clone().set(.1, 0, .3).project(camera);
        return { actual: snapshot.engineVersion, camera: snapshot.viewerCamera, projection: projection.toArray(),
          t: snapshot.t, qpos: [...snapshot.qpos], ngeom: snapshot.ngeom, scnNgeom: snapshot.scn_ngeom };
      });
      const canvas = page.getByTestId('viewer-canvas');
      const box = await canvas.boundingBox();
      expect(box).toBeTruthy();
      const x = box!.x + box!.width * .5;
      const y = box!.y + box!.height * .5;
      await page.mouse.move(x, y);
      const before = await state();
      expect(before.actual).toBe(version);
      const beforePixels = await canvas.screenshot({ path: testInfo.outputPath('before.png') });
      await page.mouse.down({ button: 'left' });
      await page.mouse.move(x + 100, y + 55, { steps: 8 });
      await page.mouse.up({ button: 'left' });
      await expect.poll(async () => (await state()).camera.azimuth).not.toBe(before.camera.azimuth);
      await expect.poll(async () => (await state()).projection).not.toEqual(before.projection);
      const rotated = await state();
      const rotatedPixels = await canvas.screenshot({ path: testInfo.outputPath('rotated.png') });
      expect(rotatedPixels.equals(beforePixels)).toBe(false);
      await page.mouse.down({ button: 'right' });
      await page.mouse.move(x + 135, y + 90, { steps: 8 });
      await page.mouse.up({ button: 'right' });
      await expect.poll(async () => (await state()).camera.lookat).not.toEqual(rotated.camera.lookat);
      await expect.poll(async () => (await state()).projection).not.toEqual(rotated.projection);
      const panned = await state();
      const pannedPixels = await canvas.screenshot({ path: testInfo.outputPath('panned.png') });
      expect(pannedPixels.equals(rotatedPixels)).toBe(false);
      await page.mouse.wheel(0, 160);
      await expect.poll(async () => (await state()).camera.distance).not.toBe(panned.camera.distance);
      await expect.poll(async () => (await state()).projection).not.toEqual(panned.projection);
      const zoomed = await state();
      const zoomedPixels = await canvas.screenshot({ path: testInfo.outputPath('zoomed.png') });
      expect(zoomedPixels.equals(pannedPixels)).toBe(false);
      expect(zoomed.t).toBe(before.t);
      expect(zoomed.qpos).toEqual(before.qpos);
      expect(zoomed.ngeom).toBe(before.ngeom);
      expect(zoomed.scnNgeom).toBe(before.scnNgeom);
      for (const result of [before, rotated, panned, zoomed]) expect(result.projection.every(Number.isFinite)).toBe(true);
      // The same native chain must work while stepping, not only while paused.
      await page.evaluate(() => (window as any).__PLAY_HOST__.backend.setRunState(true, 'camera regression'));
      await page.mouse.move(x, y);
      await page.mouse.down({ button: 'left' });
      await page.mouse.move(x - 50, y - 30, { steps: 5 });
      await page.mouse.up({ button: 'left' });
      await expect.poll(async () => (await state()).camera.azimuth).not.toBe(zoomed.camera.azimuth);
      await expect.poll(async () => (await state()).t).toBeGreaterThan(before.t);
      expect(errors).toEqual([]);
      expect(network).toEqual([]);
      await testInfo.attach('mouse-camera-receipt', { body: JSON.stringify({ before, rotated, panned, zoomed, errors, network }), contentType: 'application/json' });
    });
  }
}
