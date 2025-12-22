import { test } from '@playwright/test';

// Debug helper to mimic GitHub Pages + forgeBase chain locally.
test('remote forge worker debug', async ({ page }) => {
  page.on('console', (msg) => {
    // eslint-disable-next-line no-console
    console.log('[console]', msg.type(), msg.text());
  });
  page.on('pageerror', (err) => {
    // eslint-disable-next-line no-console
    console.log('[pageerror]', err.message);
  });
  page.on('requestfailed', (req) => {
    // eslint-disable-next-line no-console
    console.log('[requestfailed]', req.url(), req.failure()?.errorText);
  });

  page.on('worker', (worker) => {
    // eslint-disable-next-line no-console
    console.log('[worker]', worker.url());
    worker.on('close', () => {
      // eslint-disable-next-line no-console
      console.log('[worker closed]', worker.url());
    });
  });

  const forgeBase =
    'https://cdn.jsdelivr.net/gh/lshdlut/mujoco-wasm-forge@forge-3.3.7-r1/dist/3.3.7/';

  const url =
    `/?model=RKOB_simplified_upper_with_marker_CAMS.xml` +
    `&mode=worker&debug=1&log=1` +
    `&forgeBase=${encodeURIComponent(forgeBase)}`;

  // Sanity-check dynamic import of forge mujoco.js from this origin.
  await page.evaluate(async (src) => {
    try {
      const mod = await import(/* webpackIgnore: true */ src);
      // eslint-disable-next-line no-console
      console.log('[forge-import-ok]', typeof mod?.default);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[forge-import-fail]', String(err));
    }
  }, `${forgeBase}mujoco.js`);

  // Sanity-check importing worker module as a normal module (static graph / syntax).
  await page.evaluate(async () => {
    try {
      const mod = await import('/physics.worker.mjs');
      // eslint-disable-next-line no-console
      console.log('[worker-module-import-ok]', typeof mod);
    } catch (err: any) {
      // eslint-disable-next-line no-console
      console.error('[worker-module-import-fail]', String(err?.message || err));
    }
  });

  await page.goto(url);
  await page.waitForTimeout(8000);
});
