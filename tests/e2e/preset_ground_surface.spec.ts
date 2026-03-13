import { expect, test, type Page } from '@playwright/test';
import { waitForViewerReady } from './test-utils';

async function switchVisualSource(page: Page, target: 'PresetSun' | 'PresetMoon') {
  await page.evaluate(async (mode) => {
    const controls = (window as any).__viewerControls;
    if (!controls?.toggleControl) {
      throw new Error('Missing __viewerControls.toggleControl');
    }
    await controls.toggleControl('option.visual_source', mode);
  }, target);
}

function readPresetGroundInfo() {
  const ctx = (window as any).__renderCtx;
  const ground =
    ctx?.ground ||
    (Array.isArray(ctx?.meshes) ? ctx.meshes.find((m: any) => m?.userData?.infinitePlane) : null);
  const state = (window as any).__viewerStore?.get?.() || null;
  const projection = state?.rendering?.appearance?.ground?.surface?.projection || 'infinite';
  const infiniteUniforms = ground?.userData?.infiniteGround?.uniforms || null;
  const uniforms = infiniteUniforms;
  const activeMaterial = ground?.material || null;
  const texture = uniforms?.uPresetAlbedoMap?.value || null;
  const image = texture?.image || null;
  const normalTexture = uniforms?.uPresetNormalMap?.value || null;
  const roughnessTexture = uniforms?.uPresetRoughnessMap?.value || null;
  return {
    found: !!ground,
    projection,
    infiniteVisible: !!ground?.visible,
    enabled: Number(uniforms?.uPresetAlbedoEnabled?.value ?? 0),
    normalEnabled: Number(uniforms?.uPresetNormalEnabled?.value ?? 0),
    roughnessEnabled: Number(uniforms?.uPresetRoughnessEnabled?.value ?? 0),
    mjEnabled: Number(uniforms?.uMuJoCoTexEnabled?.value ?? 0),
    albedoRepeatX: Number(uniforms?.uPresetAlbedoTexScl?.value?.x ?? NaN),
    albedoRepeatY: Number(uniforms?.uPresetAlbedoTexScl?.value?.y ?? NaN),
    albedoGain: Number(uniforms?.uPresetAlbedoGain?.value ?? NaN),
    normalRepeatX: Number(uniforms?.uPresetNormalTexScl?.value?.x ?? NaN),
    normalRepeatY: Number(uniforms?.uPresetNormalTexScl?.value?.y ?? NaN),
    roughnessRepeatX: Number(uniforms?.uPresetRoughnessTexScl?.value?.x ?? NaN),
    roughnessRepeatY: Number(uniforms?.uPresetRoughnessTexScl?.value?.y ?? NaN),
    normalScaleX: Number(uniforms?.uPresetNormalScale?.value?.x ?? NaN),
    normalScaleY: Number(uniforms?.uPresetNormalScale?.value?.y ?? NaN),
    fadePow: Number(infiniteUniforms?.uFadePow?.value ?? NaN),
    fadeStart: Number(infiniteUniforms?.uFadeStart?.value ?? NaN),
    fadeEnd: Number(infiniteUniforms?.uFadeEnd?.value ?? NaN),
    src: texture?.userData?.sourceUrl || image?.currentSrc || image?.src || null,
    loaded: !!(image && (typeof image.complete !== 'boolean' || image.complete)),
    normalSrc: normalTexture?.userData?.sourceUrl || null,
    normalLoaded: !!(normalTexture && (normalTexture.image?.width > 0 || normalTexture.image?.height > 0 || normalTexture.image?.data?.byteLength > 0)),
    roughnessSrc: roughnessTexture?.userData?.sourceUrl || null,
    roughnessLoaded: !!(roughnessTexture && (roughnessTexture.image?.width > 0 || roughnessTexture.image?.height > 0 || roughnessTexture.image?.data?.byteLength > 0)),
    colorHex: typeof activeMaterial?.color?.getHex === 'function' ? activeMaterial.color.getHex() : null,
    opacity: typeof activeMaterial?.opacity === 'number' ? activeMaterial.opacity : null,
  };
}

test('preset sun/moon infinite ground binds the sandy gravel PBR textures', async ({ page }) => {
  const warnings: string[] = [];
  page.on('console', (msg) => {
    const text = msg.text?.() || '';
    if (msg.type?.() === 'warning' || text.includes('Texture marked for update but no image data found')) {
      warnings.push(text);
    }
  });

  await waitForViewerReady(page, '/index.html?model=raj&ver=3.5.0&snapshot=1&log=0');

  await switchVisualSource(page, 'PresetMoon');
  await expect.poll(async () => {
    const info = await page.evaluate(readPresetGroundInfo);
    return info.loaded && info.normalLoaded && info.roughnessLoaded && info.enabled === 1 ? (info.src || '') : '';
  }).toContain('sandy_gravel_diff_2k.jpg');

  const moon = await page.evaluate(readPresetGroundInfo);
  expect(moon.found).toBeTruthy();
  expect(moon.projection).toBe('infinite');
  expect(moon.infiniteVisible).toBeTruthy();
  expect(moon.enabled).toBe(1);
  expect(moon.normalEnabled).toBe(1);
  expect(moon.roughnessEnabled).toBe(1);
  expect(moon.normalLoaded).toBeTruthy();
  expect(moon.roughnessLoaded).toBeTruthy();
  expect(moon.normalSrc).toContain('sandy_gravel_nor_gl_2k.png');
  expect(moon.roughnessSrc).toContain('sandy_gravel_rough_2k.png');
  expect(moon.mjEnabled).toBe(0);
  expect(moon.albedoRepeatX).toBeCloseTo(0.95, 5);
  expect(moon.albedoRepeatY).toBeCloseTo(0.95, 5);
  expect(moon.albedoGain).toBeCloseTo(1.2, 5);
  expect(moon.normalRepeatX).toBeCloseTo(0.95, 5);
  expect(moon.normalRepeatY).toBeCloseTo(0.95, 5);
  expect(moon.roughnessRepeatX).toBeCloseTo(0.95, 5);
  expect(moon.roughnessRepeatY).toBeCloseTo(0.95, 5);
  expect(moon.normalScaleX).toBeCloseTo(0.4, 5);
  expect(moon.normalScaleY).toBeCloseTo(0.4, 5);
  expect(moon.fadePow).toBeCloseTo(0, 5);
  expect(moon.fadeStart).toBeCloseTo(0, 5);
  expect(moon.fadeEnd).toBeCloseTo(0, 5);
  expect(moon.opacity).toBeCloseTo(1, 5);

  await switchVisualSource(page, 'PresetSun');
  await expect.poll(async () => {
    const info = await page.evaluate(readPresetGroundInfo);
    return info.loaded && info.normalLoaded && info.roughnessLoaded && info.enabled === 1 ? (info.src || '') : '';
  }).toContain('sandy_gravel_diff_2k.jpg');

  const sun = await page.evaluate(readPresetGroundInfo);
  expect(sun.found).toBeTruthy();
  expect(sun.projection).toBe('infinite');
  expect(sun.infiniteVisible).toBeTruthy();
  expect(sun.enabled).toBe(1);
  expect(sun.normalEnabled).toBe(1);
  expect(sun.roughnessEnabled).toBe(1);
  expect(sun.normalLoaded).toBeTruthy();
  expect(sun.roughnessLoaded).toBeTruthy();
  expect(sun.normalSrc).toContain('sandy_gravel_nor_gl_2k.png');
  expect(sun.roughnessSrc).toContain('sandy_gravel_rough_2k.png');
  expect(sun.mjEnabled).toBe(0);
  expect(sun.albedoRepeatX).toBeCloseTo(0.95, 5);
  expect(sun.albedoRepeatY).toBeCloseTo(0.95, 5);
  expect(sun.albedoGain).toBeCloseTo(2.4, 5);
  expect(sun.normalRepeatX).toBeCloseTo(0.95, 5);
  expect(sun.normalRepeatY).toBeCloseTo(0.95, 5);
  expect(sun.roughnessRepeatX).toBeCloseTo(0.95, 5);
  expect(sun.roughnessRepeatY).toBeCloseTo(0.95, 5);
  expect(sun.normalScaleX).toBeCloseTo(0.3, 5);
  expect(sun.normalScaleY).toBeCloseTo(0.3, 5);
  expect(sun.colorHex).not.toBe(moon.colorHex);
  expect(sun.fadePow).toBeCloseTo(0, 5);
  expect(sun.fadeStart).toBeCloseTo(0, 5);
  expect(sun.fadeEnd).toBeCloseTo(0, 5);
  expect(sun.opacity).toBeCloseTo(1, 5);
  expect(warnings.filter((line) => line.includes('Texture marked for update but no image data found'))).toEqual([]);
});
