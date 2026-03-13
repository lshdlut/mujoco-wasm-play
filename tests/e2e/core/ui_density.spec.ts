import { expect, test } from '@playwright/test';

import { ensureSectionExpanded, waitForViewerReady } from '../test-utils';

test.use({ viewport: { width: 1600, height: 960 } });

type UiMeasure = {
  panelLeftWidth: number;
  panelRightWidth: number;
  runHeight: number;
  loadHeight: number;
  boolHeight: number;
  segmentedHeight: number;
  selectHeight: number;
  runRadius: number;
  boolRadius: number;
  selectRadius: number;
  runStyles: { whiteSpace: string; overflowX: string; textOverflow: string };
  loadStyles: { whiteSpace: string; overflowX: string; textOverflow: string };
  boolStyles: { whiteSpace: string; overflowX: string; textOverflow: string };
  segmentedStyles: { whiteSpace: string; overflowX: string; textOverflow: string };
  selectStyles: { whiteSpace: string; overflowX: string; textOverflow: string; textAlign: string; textAlignLast: string };
  treeDepthSliderWidth: number;
  treeDepthValueWidth: number;
  flexLayerSliderWidth: number;
  flexLayerValueWidth: number;
};

async function ensureUiSections(page: any) {
  await ensureSectionExpanded(page, 'file');
  await ensureSectionExpanded(page, 'option');
  await ensureSectionExpanded(page, 'simulation');
  await ensureSectionExpanded(page, 'rendering');
}

async function readUiMeasure(page: any): Promise<UiMeasure> {
  return page.evaluate(() => {
    const requireElement = (selector: string) => {
      const element = document.querySelector(selector);
      if (!(element instanceof HTMLElement)) {
        throw new Error(`missing element: ${selector}`);
      }
      return element;
    };
    const styleInfo = (element: HTMLElement) => {
      const style = getComputedStyle(element);
      return {
        whiteSpace: style.whiteSpace,
        overflowX: style.overflowX || style.overflow,
        textOverflow: style.textOverflow,
      };
    };
    const leftPanel = requireElement('[data-testid="panel-left"]');
    const rightPanel = requireElement('[data-testid="panel-right"]');
    const runButton = requireElement('[data-testid="simulation.run"]');
    const loadLabel = requireElement('[data-testid="file.load_xml_custom"]');
    const boolInput = requireElement('[data-testid="option.help"]');
    const boolButton = boolInput.closest('label.bool-button');
    if (!(boolButton instanceof HTMLElement)) {
      throw new Error('missing bool surface');
    }
    const segmented = requireElement('[data-testid="option.visual_source"] .segmented-option span');
    const select = requireElement('[data-testid="option.font"]');
    const treeDepthSlider = requireElement('[data-testid="rendering.tree_depth"]');
    const treeDepthValue = treeDepthSlider.parentElement?.querySelector('.slider-value');
    if (!(treeDepthValue instanceof HTMLElement)) {
      throw new Error('missing tree depth slider value');
    }
    const flexLayerSlider = requireElement('[data-testid="rendering.flex_layer"]');
    const flexLayerValue = flexLayerSlider.parentElement?.querySelector('.slider-value');
    if (!(flexLayerValue instanceof HTMLElement)) {
      throw new Error('missing flex layer slider value');
    }
    const selectStyle = getComputedStyle(select);
    const runStyle = getComputedStyle(runButton);
    const boolStyle = getComputedStyle(boolButton);
    return {
      panelLeftWidth: leftPanel.getBoundingClientRect().width,
      panelRightWidth: rightPanel.getBoundingClientRect().width,
      runHeight: runButton.getBoundingClientRect().height,
      loadHeight: loadLabel.getBoundingClientRect().height,
      boolHeight: boolButton.getBoundingClientRect().height,
      segmentedHeight: segmented.getBoundingClientRect().height,
      selectHeight: select.getBoundingClientRect().height,
      runRadius: Number.parseFloat(runStyle.borderTopLeftRadius) || 0,
      boolRadius: Number.parseFloat(boolStyle.borderTopLeftRadius) || 0,
      selectRadius: Number.parseFloat(selectStyle.borderTopLeftRadius) || 0,
      runStyles: styleInfo(runButton),
      loadStyles: styleInfo(loadLabel),
      boolStyles: styleInfo(boolButton),
      segmentedStyles: styleInfo(segmented),
      selectStyles: {
        ...styleInfo(select),
        textAlign: selectStyle.textAlign,
        textAlignLast: (selectStyle as any).textAlignLast || '',
      },
      treeDepthSliderWidth: treeDepthSlider.getBoundingClientRect().width,
      treeDepthValueWidth: treeDepthValue.getBoundingClientRect().width,
      flexLayerSliderWidth: flexLayerSlider.getBoundingClientRect().width,
      flexLayerValueWidth: flexLayerValue.getBoundingClientRect().width,
    };
  });
}

test('ui density scales panels and controls with font only', async ({ page }) => {
  await waitForViewerReady(page, '/index.html?model=raj&font=100');
  await ensureUiSections(page);
  const baseline = await readUiMeasure(page);

  await waitForViewerReady(page, '/index.html?model=raj&font=100&embed=1');
  await ensureUiSections(page);
  const embed = await readUiMeasure(page);

  await waitForViewerReady(page, '/index.html?model=raj&font=150');
  await ensureUiSections(page);
  const scaled = await readUiMeasure(page);

  expect(Math.abs(baseline.panelLeftWidth - baseline.panelRightWidth)).toBeLessThan(2);
  expect(Math.abs(baseline.panelLeftWidth - embed.panelLeftWidth)).toBeLessThan(2);
  expect(Math.abs(baseline.panelRightWidth - embed.panelRightWidth)).toBeLessThan(2);

  for (const [name, baselineValue, scaledValue] of [
    ['panel', baseline.panelLeftWidth, scaled.panelLeftWidth],
    ['run', baseline.runHeight, scaled.runHeight],
    ['load', baseline.loadHeight, scaled.loadHeight],
    ['bool', baseline.boolHeight, scaled.boolHeight],
    ['segmented', baseline.segmentedHeight, scaled.segmentedHeight],
    ['select', baseline.selectHeight, scaled.selectHeight],
  ] as const) {
    const ratio = scaledValue / baselineValue;
    expect(ratio, `${name} ratio`).toBeGreaterThan(1.45);
    expect(ratio, `${name} ratio`).toBeLessThan(1.55);
  }

  const baselineHeights = [
    baseline.runHeight,
    baseline.loadHeight,
    baseline.boolHeight,
    baseline.segmentedHeight,
    baseline.selectHeight,
  ];
  expect(Math.max(...baselineHeights) - Math.min(...baselineHeights)).toBeLessThan(3);
  expect(baseline.runRadius).toBeGreaterThan(baseline.boolRadius);
  expect(baseline.boolRadius).toBeGreaterThan(baseline.selectRadius);
});

test('single-line controls clip without stretching', async ({ page }) => {
  await waitForViewerReady(page, '/index.html?model=raj&font=100');
  await ensureUiSections(page);
  const before = await readUiMeasure(page);

  await page.evaluate(() => {
    const longText = 'VeryLongUiLabel0123456789'.repeat(6);
    const runButton = document.querySelector('[data-testid="simulation.run"]');
    if (runButton instanceof HTMLElement) runButton.textContent = longText;

    const loadLabel = document.querySelector('[data-testid="file.load_xml_custom"]');
    if (loadLabel instanceof HTMLElement && loadLabel.firstChild?.nodeType === Node.TEXT_NODE) {
      loadLabel.firstChild.textContent = longText;
    }

    const boolText = document.querySelector('[data-testid="option.help"]')?.closest('label.bool-button')?.querySelector('.bool-text');
    if (boolText instanceof HTMLElement) boolText.textContent = longText;

    const segmentedText = document.querySelector('[data-testid="option.visual_source"] .segmented-option span');
    if (segmentedText instanceof HTMLElement) segmentedText.textContent = longText;

    const select = document.querySelector('[data-testid="option.font"]');
    if (select instanceof HTMLSelectElement && select.selectedIndex >= 0) {
      select.options[select.selectedIndex].text = longText;
      select.dispatchEvent(new Event('change', { bubbles: true }));
    }
  });

  const after = await readUiMeasure(page);

  expect(Math.abs(after.runHeight - before.runHeight)).toBeLessThan(1.5);
  expect(Math.abs(after.loadHeight - before.loadHeight)).toBeLessThan(1.5);
  expect(Math.abs(after.boolHeight - before.boolHeight)).toBeLessThan(1.5);
  expect(Math.abs(after.segmentedHeight - before.segmentedHeight)).toBeLessThan(1.5);
  expect(Math.abs(after.selectHeight - before.selectHeight)).toBeLessThan(1.5);
  expect(Math.abs(after.panelLeftWidth - before.panelLeftWidth)).toBeLessThan(1.5);
  expect(Math.abs(after.panelRightWidth - before.panelRightWidth)).toBeLessThan(1.5);

  for (const styles of [
    after.runStyles,
    after.loadStyles,
    after.boolStyles,
    after.segmentedStyles,
  ]) {
    expect(styles.whiteSpace).toBe('nowrap');
    expect(styles.overflowX).toBe('hidden');
    expect(styles.textOverflow).toBe('clip');
  }

  expect(after.selectStyles.whiteSpace).toBe('nowrap');
});

test('single-column sliders keep a wider track and tighter value slot', async ({ page }) => {
  await waitForViewerReady(page, '/index.html?model=raj&font=100');
  await ensureUiSections(page);
  const measure = await readUiMeasure(page);

  expect(measure.treeDepthSliderWidth).toBeGreaterThan(measure.treeDepthValueWidth * 2.4);
  expect(measure.flexLayerSliderWidth).toBeGreaterThan(measure.flexLayerValueWidth * 2.4);
  expect(measure.treeDepthValueWidth).toBeLessThan(40);
  expect(measure.flexLayerValueWidth).toBeLessThan(40);
});
