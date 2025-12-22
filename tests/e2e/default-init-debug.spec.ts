import { test } from '@playwright/test';

// Debug helper: hit the same URL as local dev_server usage
// and stream console output, to inspect worker / WASM loading.
test('default index init debug', async ({ page }) => {
  page.on('console', (msg) => {
    // eslint-disable-next-line no-console
    console.log('[console]', msg.type(), msg.text());
  });

  const url = `/index.html?debug=1&snapshot=1&log=1`;

  await page.goto(url);
  await page.waitForTimeout(8000);
});

