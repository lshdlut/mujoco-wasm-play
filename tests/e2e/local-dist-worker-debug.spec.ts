import { test } from '@playwright/test';

// Debug helper to exercise worker against local dist/3.3.7.
test('local dist worker debug', async ({ page }) => {
  page.on('console', (msg) => {
    // eslint-disable-next-line no-console
    console.log('[console]', msg.type(), msg.text());
  });

  const url =
    `/?model=RKOB_simplified_upper_with_marker_CAMS.xml` +
    `&mode=worker&debug=1&log=1`;

  await page.goto(url);
  await page.waitForTimeout(8000);
});

