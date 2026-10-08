import { expect, test } from '@playwright/test';
import { ensureSectionExpanded, waitForViewerReady } from '../test-utils';

const xml = (count: number) => `<mujoco model="watch${count}"><compiler angle="radian"/><worldbody><body pos="0 0 1"><joint name="hinge" ref="0.375"/><geom type="box" size=".1 .1 .1"/></body></worldbody>${count ? `<sensor>${Array.from({ length: count }, (_, index) => `<jointpos name="angle${index}" joint="hinge"/>`).join('')}</sensor>` : ''}</mujoco>`;
const read = () => {
  const snapshot = (window as any).__PLAY_HOST__.getSnapshot();
  return { actual: snapshot.engineVersion, qpos: Array.from(snapshot.qpos || []), watch: snapshot.watch, time: snapshot.t };
};
async function load(page: any, count: number) {
  await page.evaluate(async text => {
    const backend = (window as any).__PLAY_HOST__.backend;
    await backend.setRunState(false, 'Watch test');
    await backend.loadXmlText(text);
    await backend.setRunState(false, 'Watch test');
    await backend.getStrictReport();
  }, xml(count));
  await ensureSectionExpanded(page, 'watch');
  await page.waitForFunction(() => (window as any).__PLAY_HOST__.getSnapshot().paused);
}
async function watch(page: any, field: string, index = 0) {
  await page.getByTestId('watch.index').fill(String(index));
  await page.getByTestId('watch.index').press('Enter');
  await page.getByTestId('watch.field').fill(field);
  await page.getByTestId('watch.field').press('Enter');
  await expect.poll(() => page.evaluate(read)).toMatchObject({ watch: { field, index } });
}
async function valid(page: any, value: number) {
  await expect.poll(() => page.evaluate(read)).toMatchObject({ watch: { value, valid: true, status: 'ok' } });
  await expect(page.locator('[data-testid="section-watch"] .static-value')).toHaveText(value.toPrecision(6));
}
async function invalid(page: any) {
  await expect.poll(() => page.evaluate(read)).toMatchObject({ watch: { value: null, valid: false, status: 'invalid' } });
  await expect(page.locator('[data-testid="section-watch"] .static-value')).toHaveText('—');
}
for (const version of ['3.15.0', '3.8.1']) for (const entry of ['index.html', 'pthreads/index.html']) {
  test(`Watch native sensor/update/reload/dimensions ${version} ${entry}`, async ({ page }, info) => {
    test.skip(entry.startsWith('pthreads') && process.env.PLAY_DEV_SERVER_COI !== '1', 'Requires isolated server');
    const errors: string[] = [], network: string[] = [], evidence: any[] = [];
    page.on('pageerror', error => errors.push(String(error)));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    page.on('requestfailed', request => network.push(request.url()));
    page.on('response', response => { if (response.status() >= 400) network.push(`${response.status()} ${response.url()}`); });
    await waitForViewerReady(page, `/${entry}?model=cards&ver=${version}&log=0`);
    await load(page, 1);
    expect((await page.evaluate(read)).actual).toBe(version);
    await watch(page, 'sensordata');await valid(page, .375);
    evidence.push({ stage: 'initial', ...await page.evaluate(read) });
    await page.evaluate(async () => {
      const backend = (window as any).__PLAY_HOST__.backend;
      await backend.apply({ kind: 'ui', id: 'joint.slider', value: { index: 0, value: .625 } });
      await backend.getStrictReport(); // Ordered setQpos/native forward acknowledgement.
    });
    await valid(page, .625);
    await expect.poll(() => page.evaluate(read)).toMatchObject({ qpos: [.625] });
    evidence.push({ stage: 'after_setQpos_forward', ...await page.evaluate(read) });
    await ensureSectionExpanded(page, 'simulation');
    await page.getByTestId('simulation.reload').click();
    await expect.poll(() => page.evaluate(read)).toMatchObject({ qpos: [.375], watch: { field: 'qpos', value: .375, valid: true } });
    await watch(page, 'sensordata');await valid(page, .375);
    evidence.push({ stage: 'reload', ...await page.evaluate(read) });
    await watch(page, 'sensordata', 1);await invalid(page);
    evidence.push({ stage: 'invalid_index', ...await page.evaluate(read) });
    await load(page, 2);await watch(page, 'sensordata', 1);await valid(page, .375);
    evidence.push({ stage: 'different_sensor_dimension', ...await page.evaluate(read) });
    await load(page, 0);await watch(page, 'sensordata', 0);await invalid(page);
    evidence.push({ stage: 'no_sensors', ...await page.evaluate(read) });
    await watch(page, 'qpos');await valid(page, .375);
    evidence.push({ stage: 'qpos_still_works', ...await page.evaluate(read) });
    expect(errors).toEqual([]);expect(network).toEqual([]);
    await info.attach('watch-evidence', { body: JSON.stringify({ evidence, errors, network }), contentType: 'application/json' });
  });
}
