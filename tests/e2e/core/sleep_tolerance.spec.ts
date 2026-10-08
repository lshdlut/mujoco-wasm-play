import { expect, test } from '@playwright/test';
import { ensureSectionExpanded, waitForViewerReady } from '../test-utils';

const xml = '<mujoco model="sleep option fixture"><option sleep_tolerance="0.125"/><worldbody><geom type="plane" size="2 2 .1"/><body pos="0 0 1"><joint name="hinge"/><geom type="box" size=".1 .1 .1"/></body></worldbody></mujoco>';
const state = () => {
  const snapshot = (window as any).__PLAY_HOST__.getSnapshot();
  const options = snapshot.options || {};
  return { version: snapshot.engineVersion, value: options.sleep_tolerance, flags: [options.disableflags, options.enableflags], time: snapshot.t, qpos: Array.from(snapshot.qpos || []), support: snapshot.optionSupport };
};

for (const version of ['3.15.0', '3.8.1']) for (const entry of ['index.html', 'pthreads/index.html']) {
  test(`Sleep Tol native read/write/default/reload ${version} ${entry}`, async ({ page }, info) => {
    test.skip(entry.startsWith('pthreads') && process.env.PLAY_DEV_SERVER_COI !== '1', 'Requires isolated server');
    const errors: string[] = [];
    const network: string[] = [];
    page.on('pageerror', error => errors.push(String(error)));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    page.on('requestfailed', request => network.push(`${request.url()} ${request.failure()?.errorText}`));
    await waitForViewerReady(page, `/${entry}?model=cards&ver=${version}&log=0`);
    await page.evaluate(async text => {
      const backend = (window as any).__PLAY_HOST__.backend;
      await backend.setRunState(false, 'Sleep Tol test');
      await backend.loadXmlText(text);
      await backend.setRunState(false, 'Sleep Tol test');
      await backend.getStrictReport();
    }, xml);
    await page.waitForFunction(() => (window as any).__PLAY_HOST__.getSnapshot().paused);
    await ensureSectionExpanded(page, 'physics');
    const input = page.getByTestId('physics.sleep_tolerance');
    await expect(input).toBeEnabled();
    await expect(input).toHaveValue('0.125');
    const position = await page.evaluate(() => {
      const items = Array.from(document.querySelectorAll('[data-testid="section-physics"] [data-testid]')).map(element => element.getAttribute('data-testid'));
      const index = items.indexOf('physics.sleep_tolerance');
      return items.slice(index - 1, index + 2);
    });
    expect(position).toEqual(['physics.ccd_tolerance', 'physics.sleep_tolerance', 'physics.sdf_iterations']);
    const before = await page.evaluate(state);
    expect(before.version).toBe(version);
    expect(before.value).toBe(.125);
    await input.fill('0.375');
    await input.press('Enter');
    await expect.poll(() => page.evaluate(state)).toMatchObject({ value: .375, flags: before.flags, qpos: before.qpos, time: before.time });
    const after = await page.evaluate(state);
    await page.getByTestId('simulation.reload').click();
    await expect.poll(() => page.evaluate(state)).toMatchObject({ value: .125, flags: before.flags });
    await expect(input).toHaveValue('0.125');
    const reloaded = await page.evaluate(state);
    expect(errors).toEqual([]);
    expect(network).toEqual([]);
    await info.attach('native-option', { body: JSON.stringify({ position, before, after, reloaded, errors, network }), contentType: 'application/json' });
  });
}

test('Sleep Tol is unavailable on native 3.3.7, without fabricated reads', async ({ page }, info) => {
  await waitForViewerReady(page, '/index.html?model=cards&ver=3.3.7&log=0');
  await ensureSectionExpanded(page, 'physics');
  await expect(page.getByTestId('physics.sleep_tolerance')).toBeDisabled();
  const snapshot = await page.evaluate(state);
  expect(snapshot.version).toBe('3.3.7');
  expect(snapshot.value).toBeUndefined();
  expect(snapshot.support.pointers).not.toContain('_mjwf_model_opt_sleep_tolerance_ptr');
  // Other present fields remain editable rather than disabling the whole Physics panel.
  await expect(page.getByTestId('physics.timestep')).toBeEnabled();
  await info.attach('unsupported-option', { body: JSON.stringify(snapshot), contentType: 'application/json' });
});
