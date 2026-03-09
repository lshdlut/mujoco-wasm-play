import { test, expect } from '@playwright/test';

test('embed mode keeps normal panel defaults while marking the embed shell', async ({ page }) => {
  await page.goto('/index.html?model=raj&embed=1');

  await page.waitForFunction(() => {
    const store = (window as any).__viewerStore;
    return typeof store?.get === 'function';
  });

  const result = await page.evaluate(() => {
    const store = (window as any).__viewerStore;
    const state = store.get();
    const leftPanel = document.querySelector('[data-testid="panel-left"]');
    const rightPanel = document.querySelector('[data-testid="panel-right"]');
    return {
      htmlEmbed: document.documentElement.getAttribute('data-play-embed'),
      bodyClass: document.body.className,
      leftVisible: !!state?.panels?.left,
      rightVisible: !!state?.panels?.right,
      leftHiddenClass: leftPanel?.classList.contains('is-hidden') ?? false,
      rightHiddenClass: rightPanel?.classList.contains('is-hidden') ?? false,
    };
  });

  expect(result.htmlEmbed).toBe('1');
  expect(result.bodyClass).toContain('layout-3col');
  expect(result.leftVisible).toBe(true);
  expect(result.rightVisible).toBe(true);
  expect(result.leftHiddenClass).toBe(false);
  expect(result.rightHiddenClass).toBe(false);
});
