import { expect, test } from '@playwright/test';

import { ensureSectionExpanded, waitForViewerReady } from '../test-utils';

async function readThemeState(page: any) {
  return page.evaluate(() => {
    const store = (window as any).__viewerStore;
    const style = getComputedStyle(document.documentElement);
    return {
      bodyClass: document.body.className,
      color: store.get()?.theme?.color ?? null,
      font: store.get()?.theme?.font ?? null,
      fontScale: style.getPropertyValue('--viewer-font-scale').trim(),
      prepaintAttr: document.documentElement.getAttribute('data-play-theme'),
      runtimeConfig: (window as any).__PLAY_RUNTIME_CONFIG__ ?? null,
    };
  });
}

async function switchBuiltinModel(page: any, labelFragment: string) {
  await ensureSectionExpanded(page, 'file');
  await page.evaluate((fragment) => {
    const select = document.querySelector('[data-testid="file.model_select"]');
    if (!(select instanceof HTMLSelectElement)) {
      throw new Error('file.model_select not found');
    }
    const option = Array.from(select.options).find((entry) => (entry.textContent || '').includes(fragment));
    if (!option) {
      throw new Error(`model option not found: ${fragment}`);
    }
    select.value = option.value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  }, labelFragment);
  await page.waitForFunction((fragment) => {
    const label = (window as any).__viewerStore?.get?.()?.shell?.modelLabel || '';
    return String(label).includes(fragment);
  }, labelFragment);
}

async function loadInlineModel(page: any, label: string) {
  const xml = `
    <mujoco model="inline_box">
      <worldbody>
        <body>
          <geom type="box" size="0.1 0.1 0.1"/>
        </body>
      </worldbody>
    </mujoco>
  `;
  const before = await page.evaluate(() => ({
    frame: Number((window as any).__PLAY_HOST__?.getSnapshot?.()?.frame) || 0,
    time: Number((window as any).__PLAY_HOST__?.getSnapshot?.()?.t) || 0,
  }));
  await page.evaluate(async ({ xmlText, modelLabel }) => {
    const controls = (window as any).__viewerControls;
    if (!controls?.loadXmlTextAsModel) {
      throw new Error('Missing __viewerControls.loadXmlTextAsModel');
    }
    await controls.loadXmlTextAsModel(xmlText, modelLabel);
  }, { xmlText: xml, modelLabel: label });
  await page.waitForFunction(({ expectedLabel, prevFrame, prevTime }) => {
    const select = document.querySelector('[data-testid="file.model_select"]');
    const hasEntry = select instanceof HTMLSelectElement
      && Array.from(select.options).some((entry) => (entry.textContent || '') === expectedLabel);
    if (!hasEntry) return false;
    const snapshot = (window as any).__PLAY_HOST__?.getSnapshot?.() ?? null;
    const frame = Number(snapshot?.frame) || 0;
    const time = Number(snapshot?.t);
    if (!Number.isFinite(time)) return false;
    return frame > prevFrame || time < Math.max(0.1, prevTime);
  }, { expectedLabel: label, prevFrame: before.frame, prevTime: before.time });
}

test.describe('runtime config behavior', () => {
  test('theme=light sets initial UI theme', async ({ page }) => {
    await waitForViewerReady(page, '/index.html?model=raj&theme=light');
    const result = await readThemeState(page);

    expect(result.bodyClass).toContain('theme-light');
    expect(result.color).toBe(1);
    expect(result.prepaintAttr).toBeNull();
  });

  test('font=150 sets initial UI font preset', async ({ page }) => {
    await waitForViewerReady(page, '/index.html?model=raj&font=150');
    const result = await readThemeState(page);

    expect(result.font).toBe(3);
    expect(result.fontScale).toBe('1.5');
  });

  test('default spacing is wide', async ({ page }) => {
    await waitForViewerReady(page, '/index.html?model=raj');
    const result = await readThemeState(page);

    expect(result.bodyClass).toContain('spacing-wide');
    expect(result.runtimeConfig?.ui?.spacing).toBe(1);
  });

  test('theme and font URL settings persist across builtin model switches', async ({ page }) => {
    await waitForViewerReady(page, '/index.html?model=raj&theme=light&font=50');
    await switchBuiltinModel(page, 'humanoid/humanoid');

    const result = await readThemeState(page);
    expect(result.bodyClass).toContain('theme-light');
    expect(result.color).toBe(1);
    expect(result.font).toBe(0);
    expect(result.fontScale).toBe('0.5');
    expect(result.runtimeConfig?.ui?.themeColor).toBe(1);
    expect(result.runtimeConfig?.ui?.fontIndex).toBe(0);
  });

  test('theme and font URL settings persist across xml reload', async ({ page }) => {
    await waitForViewerReady(page, '/index.html?model=raj&theme=light&font=50');
    await loadInlineModel(page, 'inline_box.xml');

    const result = await readThemeState(page);
    expect(result.bodyClass).toContain('theme-light');
    expect(result.color).toBe(1);
    expect(result.font).toBe(0);
    expect(result.fontScale).toBe('0.5');
  });

  test('user theme and font changes persist across builtin model switches', async ({ page }) => {
    await waitForViewerReady(page, '/index.html?model=raj&theme=light&font=50');

    await page.evaluate(() => {
      const controls = (window as any).__viewerControls;
      if (!controls?.toggleControl) {
        throw new Error('Missing __viewerControls.toggleControl');
      }
      controls.toggleControl('option.color', 'Dark');
      controls.toggleControl('option.font', '150 %');
    });

    await page.waitForFunction(() => {
      const state = (window as any).__viewerStore?.get?.();
      return state?.theme?.color === 0 && state?.theme?.font === 3;
    });

    await switchBuiltinModel(page, 'humanoid/humanoid');

    const result = await readThemeState(page);
    expect(result.bodyClass).not.toContain('theme-light');
    expect(result.color).toBe(0);
    expect(result.font).toBe(3);
    expect(result.fontScale).toBe('1.5');
    expect(result.runtimeConfig?.ui?.themeColor).toBe(0);
    expect(result.runtimeConfig?.ui?.fontIndex).toBe(3);
  });

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

  test('envAssetBase routes preset HDRI URLs through runtime config', async ({ page }) => {
    await waitForViewerReady(page, '/index.html?model=raj&envAssetBase=/shared-env/');

    const expectedBase = new URL('/shared-env/', page.url()).href;
    const expectedBundledBase = new URL('/assets/env/', page.url()).href;
    const configBase = await page.evaluate(() => (window as any).__PLAY_RUNTIME_CONFIG__?.rendering?.environmentAssetBase ?? null);
    expect(configBase).toBe(expectedBase);

    await page.evaluate(async () => {
      const controls = (window as any).__viewerControls;
      if (!controls?.toggleControl) {
        throw new Error('Missing __viewerControls.toggleControl');
      }
      await controls.toggleControl('option.visual_source', 'PresetSun');
    });

    await expect.poll(async () => page.evaluate(() => {
      const state = (window as any).__viewerStore?.get?.();
      return state?.rendering?.appearance?.hdri ?? null;
    })).toBe(`${expectedBase}rustig_koppie_puresky_4k.hdr`);

    await expect.poll(async () => page.evaluate(() => {
      const state = (window as any).__viewerStore?.get?.();
      return state?.rendering?.appearance?.hdriFallback ?? null;
    })).toBe(`${expectedBundledBase}rustig_koppie_puresky_4k.hdr`);

    await expect.poll(async () => page.evaluate(() => {
      const state = (window as any).__viewerStore?.get?.();
      return state?.rendering?.appearance?.ground?.surface?.albedo ?? null;
    })).toBe(`${expectedBase}preset-ground/sandy_gravel_diff_2k.jpg`);

    await expect.poll(async () => page.evaluate(() => {
      const state = (window as any).__viewerStore?.get?.();
      return state?.rendering?.appearance?.ground?.surface?.albedoFallback ?? null;
    })).toBe(`${expectedBundledBase}preset-ground/sandy_gravel_diff_2k.jpg`);

    await expect.poll(async () => page.evaluate(() => {
      const state = (window as any).__viewerStore?.get?.();
      return state?.rendering?.appearance?.ground?.surface?.normal ?? null;
    })).toBe(`${expectedBase}preset-ground/sandy_gravel_nor_gl_2k.png`);

    await expect.poll(async () => page.evaluate(() => {
      const state = (window as any).__viewerStore?.get?.();
      return state?.rendering?.appearance?.ground?.surface?.normalFallback ?? null;
    })).toBe(`${expectedBundledBase}preset-ground/sandy_gravel_nor_gl_2k.png`);

    await expect.poll(async () => page.evaluate(() => {
      const state = (window as any).__viewerStore?.get?.();
      return state?.rendering?.appearance?.ground?.surface?.roughness ?? null;
    })).toBe(`${expectedBase}preset-ground/sandy_gravel_rough_2k.png`);

    await expect.poll(async () => page.evaluate(() => {
      const state = (window as any).__viewerStore?.get?.();
      return state?.rendering?.appearance?.ground?.surface?.roughnessFallback ?? null;
    })).toBe(`${expectedBundledBase}preset-ground/sandy_gravel_rough_2k.png`);
  });
});
