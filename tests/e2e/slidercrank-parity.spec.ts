import { expect, test } from '@playwright/test';
import { waitForViewerReady } from './test-utils';

const MODEL = 'model/slider_crank/slider_crank.xml';
// For local testing we always talk to the freshly built forge artifacts
// served from this repo under dist/<ver>/.
const FORGE_BASE = '/dist/3.4.0/';

function readSlidercrankSummary() {
  const store = (window as any).__viewerStore;
  const state = store?.get ? store.get() : null;
  const vopt = Array.isArray(state?.rendering?.voptFlags) ? state.rendering.voptFlags : [];
  const actuatorFlag = !!vopt[4];

  const renderer = (window as any).__viewerRenderer;
  const ctx = renderer?.getContext ? renderer.getContext() : null;
  const group = ctx?.slidercrankGroup || null;
  const pool = Array.isArray(ctx?.slidercrankPool) ? ctx.slidercrankPool : [];
  const children = pool.length ? pool : Array.isArray(group?.children) ? group.children : [];
  return {
    actuatorFlag,
    groupVisible: !!group?.visible,
    total: children.length,
    visible: children.filter((child: any) => !!child?.visible).length,
  };
}

test('slidercrank renders even when mjVIS_ACTUATOR is off', async ({ page }) => {
  const url =
    `/?model=${encodeURIComponent(MODEL)}` +
    `&mode=worker&snapshot=1` +
    `&forgeBase=${encodeURIComponent(FORGE_BASE)}`;

  await waitForViewerReady(page, url);

  const deadline = Date.now() + 20_000;
  let lastDiag: any = null;
  while (Date.now() < deadline) {
    lastDiag = await page.evaluate(() => {
      const snap = (window as any).__lastSnapshot;
      const store = (window as any).__viewerStore;
      const state = store?.get ? store.get() : null;
      const actuators = state?.rendering?.assets?.actuators || null;
      const trntype = actuators?.trntype;
      const hasSlider = trntype
        ? Array.from(trntype).some((v: any) => (Number(v) | 0) === 2)
        : false;
      const renderer = (window as any).__viewerRenderer;
      const ctx = renderer?.getContext ? renderer.getContext() : null;
      const group = ctx?.slidercrankGroup || null;
      const pool = Array.isArray(ctx?.slidercrankPool) ? ctx.slidercrankPool : [];
      const visible = pool.filter((child: any) => !!child?.visible).length;
      const diagnostics = state?.rendering?.assets?.extras?.diagnostics || null;
      return {
        href: location.href,
        search: location.search,
        params: Array.from(new URLSearchParams(location.search).entries()),
        requestedModel: new URLSearchParams(location.search).get('model'),
        runtimeModelLabel: state?.runtime?.modelLabel || '',
        frame: Number.isFinite(snap?.frame) ? snap.frame : null,
        hasSiteXpos: !!snap?.site_xpos,
        hasSiteXmat: !!snap?.site_xmat,
        actuatorCount: Number(actuators?.count) || 0,
        hasActTrnid: !!actuators?.trnid,
        hasActTrntype: !!actuators?.trntype,
        hasActCrank: !!actuators?.cranklength,
        hasSlider,
        groupTotal: pool.length,
        groupVisible: visible,
        diagnostics,
      };
    });

    const ready =
      !!lastDiag?.hasActTrntype
      && !!lastDiag?.hasActTrnid
      && !!lastDiag?.hasActCrank
      && !!lastDiag?.hasSlider
      && !!lastDiag?.hasSiteXpos
      && !!lastDiag?.hasSiteXmat
      && Number(lastDiag?.groupVisible) > 0;
    if (ready) break;
    await page.waitForTimeout(250);
  }
  if (!(lastDiag?.hasActTrntype && lastDiag?.hasSlider)) {
    throw new Error(`slidercrank parity precondition unmet: ${JSON.stringify(lastDiag)}`);
  }

  const summary = await page.evaluate(readSlidercrankSummary);
  expect(summary.actuatorFlag).toBeFalsy();
  expect(summary.total).toBeGreaterThan(0);
  expect(summary.visible).toBeGreaterThan(0);
});
