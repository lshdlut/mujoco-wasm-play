import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { ensureSectionExpanded, waitForViewerReady } from '../test-utils';

const fixtures = JSON.parse(fs.readFileSync(new URL('../fixtures/compatibility_315.json', import.meta.url), 'utf8'));
const require = createRequire(import.meta.url);
const { PNG } = require(path.join(path.dirname(require.resolve('playwright-core/package.json')), 'lib/utilsBundle.js'));
const scalar = '<mujoco><worldbody><body pos="0 0 1"><joint name="slide" type="slide" axis="1 0 0"/><geom type="box" size=".1 .1 .1" mass="1"/></body></worldbody><actuator><motor name="drive" joint="slide" group="2" ctrlrange="-1 1" ctrllimited="true"/></actuator><equality><joint name="named equality" joint1="slide" active="false"/></equality></mujoco>';
// Pinned MuJoCo 3.15.0 test/xml/xml_native_writer_test.cc: KeepsDCMotorNoInputs.
const zeroInput = '<mujoco><worldbody><body><joint name="jnt"/><geom size="1"/></body></worldbody><actuator><dcmotor joint="jnt" motorconst="0.05" resistance="2.0" input="none"/></actuator></mujoco>';

async function loadPaused(page: any, xml: string, observations?: any[]) {
  await page.evaluate(async (text: string) => {
    const backend = (window as any).__PLAY_HOST__.backend;
    await backend.setRunState(false, 'compatibility test');
    await backend.loadXmlText(text);
    await backend.setRunState(false, 'compatibility test');
  }, xml);
  await pause(page, observations);
}
async function pause(page: any, observations?: any[]) {
  observations?.push({ stage: 'before_pause_command', state: await snapshot(page) });
  const frame = await page.evaluate(async () => {
    const backend = (window as any).__PLAY_HOST__.backend;
    await backend.setRunState(false, 'compatibility test');
    await backend.getStrictReport(); // Ordered Worker acknowledgement, not optimistic local paused state.
    return backend.snapshot().frameId;
  });
  observations?.push({ stage: 'after_ordered_worker_ack', acknowledgedFrame: frame, state: await snapshot(page) });
  await page.waitForFunction((previous: number) => {
    const s = (window as any).__PLAY_HOST__.getSnapshot();
    return s.paused && s.frameId > previous;
  }, frame);
  observations?.push({ stage: 'after_fresh_paused_frame', state: await snapshot(page) });
}
const snapshot = (page: any) => page.evaluate(() => {
  const s = (window as any).__PLAY_HOST__.getSnapshot();
  return { actual: s.engineVersion, rows: s.actuators, ctrl: [...(s.ctrl || [])], qpos: [...s.qpos], t: s.t,
    wallMs: Date.now(), frameId: s.frameId, paused: s.paused, pausedSource: s.pausedSource, infoTime: s.info?.time,
    eqNames: s.eq_names, integrator: s.options.integrator, history: s.history, keyframes: s.keyframes, keyIndex: s.keyIndex,
    assets: { count: s.renderAssets.actuators?.count, trnidLength: s.renderAssets.actuators?.trnid?.length } };
});
async function setSlider(page: any, index: number, value: number) {
  await page.getByTestId(`control.act.${index}`).evaluate((element: HTMLInputElement, target: number) => {
    element.value = String(target);
    element.dispatchEvent(new Event('input', { bubbles: true }));
  }, value);
}

for (const entry of ['index.html', 'pthreads/index.html']) {
  test(`zero-input passive actuator retains assets without controls ${entry}`, async ({ page }, info) => {
    test.skip(entry.startsWith('pthreads') && process.env.PLAY_DEV_SERVER_COI !== '1', 'Requires isolated server');
    const errors: string[] = []; const network: string[] = [];
    page.on('pageerror', e => errors.push(String(e)));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('requestfailed', r => network.push(r.url()));
    page.on('response', r => { if (r.status() >= 400) network.push(`${r.status()} ${r.url()}`); });
    const observations: any[] = [];
    try {
      await waitForViewerReady(page, `/${entry}?model=cards&ver=3.15.0&log=0`);
      await loadPaused(page, zeroInput, observations);
      const before = await snapshot(page);
      observations.push({ stage: 'before_clear', state: before });
      expect(before.actual).toBe('3.15.0');
      expect(before.rows).toEqual([]);
      expect(before.ctrl).toEqual([]);
      expect(before.assets).toEqual({ count: 1, trnidLength: 2 });
      await ensureSectionExpanded(page, 'control');
      await expect(page.locator('[data-dynamic="actuators"] input[type="range"]')).toHaveCount(0);
      await page.getByTestId('control.clear').click();
      await pause(page, observations);
      observations.push({ stage: 'after_clear_before_assertions', state: await snapshot(page) });
      expect((await snapshot(page)).ctrl).toEqual([]);
      expect((await snapshot(page)).qpos).toEqual(before.qpos);
      expect((await snapshot(page)).t).toBe(before.t);
      await page.evaluate(() => (window as any).__PLAY_HOST__.backend.setRunState(true, 'zero-input compatibility'));
      await page.waitForFunction((t: number) => (window as any).__PLAY_HOST__.getSnapshot().t > t + .01, before.t);
      await pause(page, observations);
      const after = await snapshot(page);
      expect(after.qpos.every(Number.isFinite)).toBe(true);
      expect(errors).toEqual([]); expect(network).toEqual([]);
      await info.attach('zero-input', { body: JSON.stringify({ before, after, errors, network }), contentType: 'application/json' });
    } finally {
      await info.attach('zero-input-command-observations', { body: JSON.stringify({ observations, errors, network }), contentType: 'application/json' });
    }
  });
  for (const version of ['3.15.0', '3.8.1']) {
    test(`scalar control, equality names, keyframe and history ${version} ${entry}`, async ({ page }, info) => {
      test.skip(entry.startsWith('pthreads') && process.env.PLAY_DEV_SERVER_COI !== '1', 'Requires isolated server');
      const errors: string[] = []; const network: string[] = [];
      page.on('pageerror', e => errors.push(String(e)));
      page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
      page.on('requestfailed', r => network.push(r.url()));
      page.on('response', r => { if (r.status() >= 400) network.push(`${r.status()} ${r.url()}`); });
      await waitForViewerReady(page, `/${entry}?model=cards&ver=${version}&log=0`);
      await loadPaused(page, scalar);
      await expect.poll(async () => (await snapshot(page)).eqNames).toEqual(['named equality']);
      const before = await snapshot(page);
      expect(before.actual).toBe(version);
      expect(before.rows).toMatchObject([{ index: 0, actuator: 0, input: 0, inputCount: 1, name: 'drive', group: 2 }]);
      await ensureSectionExpanded(page, 'control');
      await setSlider(page, 0, .4);
      await expect.poll(async () => (await snapshot(page)).ctrl).toEqual([.4]);
      await ensureSectionExpanded(page, 'simulation');
      await page.getByTestId('simulation.save_key').click();
      await page.waitForFunction(() => (window as any).__PLAY_HOST__.getSnapshot().keyframes.lastSaved >= 0);
      const saved = await snapshot(page);
      await page.getByTestId('control.clear').click();
      await expect.poll(async () => (await snapshot(page)).ctrl).toEqual([0]);
      expect((await snapshot(page)).qpos).toEqual(saved.qpos);
      expect((await snapshot(page)).t).toBe(saved.t);
      await page.getByTestId('simulation.load_key').click();
      await expect.poll(async () => (await snapshot(page)).ctrl).toEqual([.4]);
      expect((await snapshot(page)).qpos).toEqual(saved.qpos);
      await page.evaluate(() => (window as any).__PLAY_HOST__.backend.setRunState(true, 'compatibility test'));
      await page.waitForFunction((t: number) => (window as any).__PLAY_HOST__.getSnapshot().t > t + .03, saved.t);
      await pause(page);
      const live = await snapshot(page);
      await page.evaluate(() => (window as any).__PLAY_HOST__.backend.step(-1));
      await page.waitForFunction(() => (window as any).__PLAY_HOST__.getSnapshot().history.scrubIndex === -1);
      await expect.poll(async () => (await snapshot(page)).t).toBeLessThan(live.t);
      const historical = await snapshot(page);
      expect(historical.t).toBeLessThan(live.t);
      expect(historical.qpos.every(Number.isFinite)).toBe(true);
      await page.evaluate(() => (window as any).__PLAY_HOST__.backend.setRunState(true, 'compatibility test'));
      await page.waitForFunction((t: number) => (window as any).__PLAY_HOST__.getSnapshot().t > t, live.t);
      await loadPaused(page, scalar.replace('name="drive"', 'name="renamed drive"').replace('ctrlrange="-1 1"', 'ctrlrange="-2 2"'));
      await expect(page.locator('[data-dynamic="actuators"] .control-label')).toHaveText('renamed drive');
      await expect(page.getByTestId('control.act.0')).toHaveAttribute('min', '-2');
      await expect(page.getByTestId('control.act.0')).toHaveAttribute('max', '2');
      expect(errors).toEqual([]); expect(network).toEqual([]);
      await info.attach('compatibility', { body: JSON.stringify({ before, saved, live, historical, errors, network }), contentType: 'application/json' });
    });
  }

  test(`multi-input ownership, slot actions and quaternion Clear all 3.15.0 ${entry}`, async ({ page }, info) => {
    test.skip(entry.startsWith('pthreads') && process.env.PLAY_DEV_SERVER_COI !== '1', 'Requires isolated server');
    const errors: string[] = []; const network: string[] = [];
    page.on('pageerror', e => errors.push(String(e)));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('requestfailed', r => network.push(r.url()));
    page.on('response', r => { if (r.status() >= 400) network.push(`${r.status()} ${r.url()}`); });
    await waitForViewerReady(page, `/${entry}?model=cards&ver=3.15.0&log=0`);
    await loadPaused(page, fixtures.pid);
    await ensureSectionExpanded(page, 'control');
    const pid = await snapshot(page);
    expect(pid.rows.map((r: any) => [r.index, r.actuator, r.input, r.name])).toEqual([[0, 0, 0, 'pid / pos'], [1, 0, 1, 'pid / vel'], [2, 0, 2, 'pid / ff']]);
    expect(pid.assets).toEqual({ count: 1, trnidLength: 2 });
    await setSlider(page, 2, .25);
    await expect.poll(async () => (await snapshot(page)).ctrl).toEqual([0, 0, .25]);
    await page.getByTestId('control.clear').click();
    await expect.poll(async () => (await snapshot(page)).ctrl).toEqual([0, 0, 0]);
    // Only UI group IDs differ from the pinned fixture; lighting is unchanged.
    const xml = fixtures.orientation.replace('name="expmap" joint="expmap" kp=', 'name="expmap" group="3" joint="expmap" kp=').replace('name="quat" joint="quat" input=', 'name="quat" group="5" joint="quat" input=');
    await loadPaused(page, xml);
    const orientation = await snapshot(page);
    expect(orientation.actual).toBe('3.15.0');
    expect(orientation.rows.map((r: any) => r.actuator)).toEqual([0, 1, 2, 3, 3, 3, 4, 4, 4, 4]);
    expect(orientation.rows.map((r: any) => r.group)).toEqual([0, 0, 0, 3, 3, 3, 5, 5, 5, 5]);
    expect(orientation.rows.slice(3).every((r: any) => r.name.startsWith(r.actuator === 3 ? 'expmap / ' : 'quat / '))).toBe(true);
    expect(orientation.assets).toEqual({ count: 5, trnidLength: 10 });
    await ensureSectionExpanded(page, 'group');
    await page.getByTestId('group.actuator3').click();
    await expect(page.getByTestId('group.actuator3')).toBeChecked();
    await page.getByTestId('group.actuator5').click();
    await expect(page.getByTestId('group.actuator5')).toBeChecked();
    await setSlider(page, 4, .3);
    await expect.poll(async () => (await snapshot(page)).ctrl[4]).toBeCloseTo(.3);
    await setSlider(page, 8, .4);
    await expect.poll(async () => (await snapshot(page)).ctrl[8]).toBeCloseTo(.4);
    const changed = await snapshot(page);
    expect(changed.ctrl.filter((_: any, i: number) => i !== 4 && i !== 8)).toEqual(orientation.ctrl.filter((_: any, i: number) => i !== 4 && i !== 8));
    await page.getByTestId('control.clear').click();
    await expect.poll(async () => (await snapshot(page)).ctrl).toEqual([0, 0, 0, 0, 0, 0, 1, 0, 0, 0]);
    const cleared = await snapshot(page);
    expect(cleared.qpos).toEqual(changed.qpos); expect(cleared.t).toBe(changed.t);
    await page.screenshot({ path: info.outputPath('orientation-controls.png') });
    expect(errors).toEqual([]); expect(network).toEqual([]);
    await info.attach('multi-input', { body: JSON.stringify({ pid, orientation, changed, cleared, errors, network }), contentType: 'application/json' });
  });

  test(`loaded discrete integrator is displayed without mutation 3.15.0 ${entry}`, async ({ page }) => {
    test.skip(entry.startsWith('pthreads') && process.env.PLAY_DEV_SERVER_COI !== '1', 'Requires isolated server');
    await waitForViewerReady(page, `/${entry}?model=cards&ver=3.15.0&log=0`);
    await loadPaused(page, scalar.replace('<worldbody>', '<option integrator="discrete"/><worldbody>'));
    await ensureSectionExpanded(page, 'physics');
    expect((await snapshot(page)).integrator).toBe(4);
    await expect(page.getByTestId('physics.integrator')).toHaveValue('discrete');
    expect((await snapshot(page)).integrator).toBe(4);
  });

  test(`official photometric orientation uses bounded classical RGB lighting 3.15.0 ${entry}`, async ({ page }, info) => {
    test.skip(entry.startsWith('pthreads') && process.env.PLAY_DEV_SERVER_COI !== '1', 'Requires isolated server');
    const errors: string[] = []; const network: string[] = [];
    page.on('pageerror', e => errors.push(String(e)));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('requestfailed', r => network.push(r.url()));
    page.on('response', r => { if (r.status() >= 400) network.push(`${r.status()} ${r.url()}`); });
    await waitForViewerReady(page, `/${entry}?model=cards&ver=3.15.0&log=0`);
    await loadPaused(page, fixtures.orientation);
    await page.waitForFunction(() => (window as any).__renderCtx._mjLightRig?.slots?.length === 6);
    const mapped = () => page.evaluate(() => {
      const s = (window as any).__PLAY_HOST__.getSnapshot();
      const rig = (window as any).__renderCtx._mjLightRig;
      return { actual: s.engineVersion, t: s.t, qpos: [...s.qpos], ctrl: [...s.ctrl], camera: s.viewerCamera,
        raw: [...s.renderAssets.lights.intensity], ngeom: s.ngeom, sceneGeoms: s.scn_ngeom,
        slots: rig.slots.map((slot: any) => ({ kind: slot.kind, intensity: slot.light.intensity, color: slot.light.color.toArray(), visible: slot.light.visible })), ambient: rig.ambient.color.toArray() };
    });
    const before = await mapped();
    expect(before.actual).toBe('3.15.0');
    expect(before.raw).toEqual([1200000, 100000, 100000, 100000, 15000]);
    expect(before.slots.map((s: any) => s.intensity)).toEqual([1, 1, 1, 1, 1, 1]);
    expect(before.ngeom).toBeGreaterThanOrEqual(4);
    expect(before.camera.distance).toBeCloseTo(1.35);
    const canvas = page.getByTestId('viewer-canvas');
    const original = await canvas.screenshot({ path: info.outputPath('official-original-intensity.png') });
    const pixels = PNG.sync.read(original);
    let white = 0;
    for (let i = 0; i < pixels.data.length; i += 4) if (pixels.data[i] >= 250 && pixels.data[i + 1] >= 250 && pixels.data[i + 2] >= 250) white++;
    const whiteFraction = white / (pixels.width * pixels.height);
    expect(whiteFraction).toBeLessThan(.95);
    const variants = [];
    for (const raw of [0, 1]) {
      // Change only renderer input metadata, keeping the native model/state/camera fixed.
      await page.evaluate((value: number) => (window as any).__PLAY_HOST__.getSnapshot().renderAssets.lights.intensity.fill(value), raw);
      await page.waitForTimeout(50);
      const next = await mapped();
      expect(next.slots).toEqual(before.slots); expect(next.ambient).toEqual(before.ambient);
      expect(next.t).toBe(before.t); expect(next.qpos).toEqual(before.qpos); expect(next.ctrl).toEqual(before.ctrl); expect(next.camera).toEqual(before.camera);
      variants.push(next);
    }
    expect(errors).toEqual([]); expect(network).toEqual([]);
    await info.attach('classical-lighting', { body: JSON.stringify({ before, variants, whiteFraction, errors, network }), contentType: 'application/json' });
  });
}
