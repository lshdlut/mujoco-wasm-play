import { expect, test } from '@playwright/test';
import { waitForViewerReady } from '../test-utils';

const valid = `<mujoco><worldbody><body pos="0 0 1"><joint name="slide" type="slide" axis="1 0 0"/><geom type="box" size=".1 .1 .1" mass="1"/></body></worldbody><actuator><motor joint="slide" ctrlrange="-1 1" ctrllimited="true"/></actuator></mujoco>`;
const textured = `<mujoco><asset><mesh name="tetra" file="tetra.obj"/><texture name="checker" type="2d" builtin="checker" width="32" height="32" rgb1=".2 .5 .8" rgb2=".8 .5 .2"/><material name="mat" texture="checker"/></asset><worldbody><geom type="plane" size="1 1 .1" material="mat"/><body pos="0 0 1"><joint name="slide" type="slide" axis="1 0 0"/><geom type="mesh" mesh="tetra" material="mat" mass="1"/></body></worldbody><actuator><motor joint="slide" ctrlrange="-1 1" ctrllimited="true"/></actuator></mujoco>`;
const obj = 'v 0 0 0\nv 0.2 0 0\nv 0 0.2 0\nv 0 0 0.2\nf 1 3 2\nf 1 2 4\nf 1 4 3\nf 2 3 4\n';

for (const entry of ['single', 'pthreads']) {
  test(`3.15 ${entry}: complete textured bundle, controls, reload and Worker lifetime`, async ({ page }, testInfo) => {
    test.skip(entry === 'pthreads' && process.env.PLAY_DEV_SERVER_COI !== '1', 'Requires isolated server');
    test.setTimeout(180000);
    const errors: string[] = [];
    const network: string[] = [];
    let created = 0;
    let closed = 0;
    page.on('pageerror', error => errors.push(String(error)));
    page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
    page.on('requestfailed', request => network.push(`${request.url()} ${request.failure()?.errorText}`));
    page.on('response', response => { if (response.status() >= 400) network.push(`${response.status()} ${response.url()}`); });
    page.on('worker', worker => {
      if (!worker.url().includes('physics.worker.mjs')) return;
      created++; worker.on('close', () => closed++);
    });
    await waitForViewerReady(page, `${entry === 'single' ? '/index.html' : '/pthreads/index.html'}?model=cards&ver=3.15.0&log=0`, { timeoutMs: 120000 });
    const first = await page.evaluate(async ({ xml, obj }) => {
      const backend = (window as any).__PLAY_HOST__.backend;
      const bytes = new TextEncoder().encode(obj);
      await backend.loadXmlBundle({ xmlText: xml, xmlPath: '/mem/fixture/main.xml', files: [{ path: '/mem/fixture/tetra.obj', data: bytes.buffer }] });
      const snap = backend.snapshot();
      return { load: snap.loadState, engineVersion: snap.engineVersion, tex: snap.renderAssets?.textures?.count, mesh: snap.renderAssets?.meshes?.count,
        qpos: [...snap.qpos], isolated: crossOriginIsolated, generation: snap.loadState.generation };
    }, { xml: textured, obj });
    expect(first.load.status).toBe('ready');
    expect(first.engineVersion).toBe('3.15.0');
    expect(first.tex).toBeGreaterThan(0);
    expect(first.mesh).toBeGreaterThan(0);
    expect(first.qpos.every(Number.isFinite)).toBeTruthy();
    if (entry === 'pthreads') expect(first.isolated).toBeTruthy();
    await page.evaluate(() => (window as any).__PLAY_HOST__.backend.setRunState(false, 'test'));
    await page.waitForFunction(() => (window as any).__PLAY_HOST__.getSnapshot().paused);
    const pausedT = await page.evaluate(() => (window as any).__PLAY_HOST__.getSnapshot().t);
    await page.waitForTimeout(150);
    expect(await page.evaluate(() => (window as any).__PLAY_HOST__.getSnapshot().t)).toBe(pausedT);
    await page.evaluate(() => (window as any).__PLAY_HOST__.backend.apply({ kind: 'ui', id: 'simulation.reset' }));
    await page.waitForFunction(() => (window as any).__PLAY_HOST__.getSnapshot().t === 0);
    await page.evaluate(() => (window as any).__PLAY_HOST__.backend.apply({ kind: 'ui', id: 'control.actuator', value: { index: 0, value: .4 } }));
    await page.waitForFunction(() => Math.abs((window as any).__PLAY_HOST__.getSnapshot().ctrl[0] - .4) < 1e-6);
    await page.evaluate(() => (window as any).__PLAY_HOST__.backend.apply({ kind: 'ui', id: 'simulation.align' }));
    await page.waitForFunction(() => !!(window as any).__PLAY_HOST__.getSnapshot().align?.camera);
    await page.evaluate(() => (window as any).__PLAY_HOST__.backend.setRunState(true, 'test'));
    await page.waitForFunction(() => (window as any).__PLAY_HOST__.getSnapshot().t > .05);
    const timerStats = await page.evaluate(() => (window as any).__PLAY_HOST__.getSnapshot().info);
    expect(Number.isFinite(timerStats.cpuStepMs)).toBeTruthy();
    expect(Number.isFinite(timerStats.cpuForwardMs)).toBeTruthy();
    expect(timerStats.cpuStepMs).toBeGreaterThanOrEqual(0);
    expect(timerStats.cpuForwardMs).toBeGreaterThanOrEqual(0);
    const reloaded = await page.evaluate(async () => {
      const backend = (window as any).__PLAY_HOST__.backend;
      await backend.apply({ kind: 'ui', id: 'simulation.reload' });
      const snap = backend.snapshot();
      return { load: snap.loadState, tex: snap.renderAssets.textures.count, mesh: snap.renderAssets.meshes.count, qpos: [...snap.qpos] };
    });
    expect(reloaded.load.status).toBe('ready');
    expect(reloaded.load.generation).toBeGreaterThan(first.generation);
    expect(reloaded.tex).toBe(first.tex);
    expect(reloaded.mesh).toBe(first.mesh);
    expect(reloaded.qpos.every(Number.isFinite)).toBeTruthy();
    await expect(page.locator('[data-testid="viewer-canvas"]')).toBeVisible();
    await page.waitForTimeout(200);
    await page.screenshot({ path: testInfo.outputPath(`315-${entry}.png`) });
    expect(closed).toBeGreaterThanOrEqual(2);
    expect(created - closed).toBe(1);
    expect(errors).toEqual([]);
    expect(network).toEqual([]);
    await testInfo.attach('315-receipt', { body: JSON.stringify({ first, reloaded, workers: { created, closed }, errors, network }), contentType: 'application/json' });
  });
}

test('invalid XML rejects, then a complete model recovers', async ({ page }) => {
  await waitForViewerReady(page, '/index.html?model=cards&ver=3.15.0&log=0');
  const outcome = await page.evaluate(async xml => {
    const backend = (window as any).__PLAY_HOST__.backend;
    const message = await backend.loadXmlText('<mujoco><broken/></mujoco>').then(() => '', (error: Error) => String(error));
    const failed = backend.snapshot().loadState.status;
    await backend.loadXmlText(xml);
    return { message, failed, status: backend.snapshot().loadState.status, nq: backend.snapshot().nq };
  }, valid);
  expect(outcome.message).toContain('XML load failed');
  expect(outcome.failed).toBe('failed');
  expect(outcome.status).toBe('ready');
  expect(outcome.nq).toBe(1);
});

test('asset extraction failure rejects load and is visible in backend, then recovers', async ({ page }) => {
  await page.route('**/bridge/render_assets_collect.mjs*', async route => {
    const response = await route.fetch();
    const body = (await response.text()).replace('if (ntex > 0) {', 'if (ntex > 0) { throw new Error("asset extraction fixture failure");');
    await route.fulfill({ response, body });
  });
  await waitForViewerReady(page, '/index.html?model=model/test/left_panel_groups.xml&ver=3.15.0&log=0');
  const outcome = await page.evaluate(async ({ textured, obj, valid }) => {
    const backend = (window as any).__PLAY_HOST__.backend;
    const message = await backend.loadXmlBundle({ xmlText: textured, xmlPath: '/mem/main.xml', files: [{ path: '/mem/tetra.obj', data: new TextEncoder().encode(obj).buffer }] }).then(() => '', (error: Error) => String(error));
    const failure = backend.snapshot();
    await backend.loadXmlText(valid);
    return { message, state: failure.loadState.status, error: failure.backendError, recovered: backend.snapshot().loadState.status };
  }, { textured, obj, valid });
  expect(outcome.message).toContain('asset extraction fixture failure');
  expect(outcome.error).toContain('asset extraction fixture failure');
  expect(outcome.state).toBe('failed');
  expect(outcome.recovered).toBe('ready');
});

test('replacement cancels interrupted report/load and latest generation owns the result', async ({ page }) => {
  await waitForViewerReady(page, '/index.html?model=cards&ver=3.15.0&log=0');
  const outcome = await page.evaluate(async xml => {
    const backend = (window as any).__PLAY_HOST__.backend;
    const report = backend.getStrictReport().catch((error: Error) => String(error));
    const first = backend.loadXmlText(xml).catch((error: Error) => String(error));
    const second = backend.loadXmlText(xml.replace('.1 .1 .1', '.2 .1 .1'));
    const [reportResult, firstResult] = await Promise.all([report, first, second]);
    return { reportResult, firstResult, status: backend.snapshot().loadState.status, size: backend.snapshot().gsize[0] };
  }, valid);
  expect(outcome.reportResult).toContain('cancelled');
  expect(outcome.firstResult).toContain('cancelled');
  expect(outcome.status).toBe('ready');
  expect(outcome.size).toBe(.2);
});

test('report deadline, Worker failure and disposal settle pending requests', async ({ page }) => {
  test.setTimeout(60000);
  await page.addInitScript(() => {
    const NativeWorker = Worker;
    (window as any).__testWorkers = [];
    (window as any).Worker = class extends NativeWorker {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        if (String(url).includes('physics.worker.mjs')) (window as any).__testWorkers.push(this);
      }
      postMessage(message: any, transfers: any = []) {
        if (message.cmd === 'strictReport') return;
        super.postMessage(message, transfers);
      }
    };
  });
  await waitForViewerReady(page, '/index.html?model=model/test/left_panel_groups.xml&ver=3.15.0&log=0');
  const outcome = await page.evaluate(async xml => {
    const backend = (window as any).__PLAY_HOST__.backend;
    const timeout = await backend.getStrictReport().catch((error: Error) => String(error));
    const failed = backend.getStrictReport().catch((error: Error) => String(error));
    (window as any).__testWorkers.at(-1).dispatchEvent(new ErrorEvent('error', { message: 'fixture Worker failure' }));
    const failure = await failed;
    await backend.loadXmlText(xml);
    const disposed = backend.getStrictReport().catch((error: Error) => String(error));
    backend.dispose();
    const disposal = await disposed;
    return { timeout, failure, disposal };
  }, valid);
  expect(outcome.timeout).toContain('timed out');
  expect(outcome.failure).toContain('fixture Worker failure');
  expect(outcome.disposal).toContain('dispose');
});

test('Forge base override uses the actual engine ABI even when the default version differs', async ({ page }) => {
  await waitForViewerReady(page, '/index.html?model=raj&forgeBase=/forge/dist/3.4.0/&log=0');
  const result = await page.evaluate(() => {
    const snapshot = (window as any).__PLAY_HOST__.getSnapshot();
    return { requested: (window as any).__PLAY_RUNTIME_CONFIG__.startup.ver,
      actual: snapshot.engineVersion, textures: snapshot.renderAssets.textures.count,
      state: snapshot.loadState.status };
  });
  expect(result.requested).toBe('3.15.0');
  expect(result.actual).toBe('3.4.0');
  expect(result.state).toBe('ready');
  expect(result.textures).toBeGreaterThan(0);
});
