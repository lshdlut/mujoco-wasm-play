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

function expectVec4Close(actual: number[] | null, expected: number[]) {
  expect(actual).not.toBeNull();
  expect(actual?.length).toBe(4);
  for (let i = 0; i < 4; i += 1) {
    expect(actual?.[i]).toBeCloseTo(expected[i], 5);
  }
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
    directSpecularScale: Number(uniforms?.uPresetDirectSpecularScale?.value ?? NaN),
    reflectance: Number(ground?.userData?.reflectance ?? NaN),
    envMapIntensity: typeof activeMaterial?.envMapIntensity === 'number' ? activeMaterial.envMapIntensity : NaN,
    envBaseIntensity:
      Number.isFinite(activeMaterial?.envMapIntensity) && Number(ground?.userData?.reflectance) > 1e-6
        ? Number(activeMaterial.envMapIntensity) / Number(ground.userData.reflectance)
        : NaN,
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
    roughness: typeof activeMaterial?.roughness === 'number' ? activeMaterial.roughness : NaN,
  };
}

function readPresetSceneInfo() {
  const ctx = (window as any).__renderCtx;
  const state = (window as any).__viewerStore?.get?.() || null;
  const snapshot = (window as any).__PLAY_HOST__?.getSnapshot?.() || null;
  const scene = ctx?.sceneWorld || ctx?.scene || null;
  const appearance = state?.rendering?.appearance || null;
  const background = scene?.background || null;
  const environment = scene?.environment || null;
  const mjLightRig = ctx?._mjLightRig || null;
  const mjVisibleLights = Array.isArray(mjLightRig?.slots)
    ? mjLightRig.slots.filter((slot: any) => !!slot?.light?.visible && (Number(slot?.light?.intensity) || 0) > 0).length
    : 0;
  const fogRgbaRaw = snapshot?.visual?.rgba?.fog;
  const hazeRgbaRaw = snapshot?.visual?.rgba?.haze;
  return {
    mode: state?.visualSourceMode || null,
    backgroundMode: appearance?.backgroundMode || null,
    exposure: Number(appearance?.exposure ?? NaN),
    envIntensity: Number(appearance?.envIntensity ?? NaN),
    ambientIntensity: Number(appearance?.ambient?.intensity ?? NaN),
    hemiIntensity: Number(appearance?.hemi?.intensity ?? NaN),
    fillIntensity: Number(appearance?.fill?.intensity ?? NaN),
    dirIntensity: Number(appearance?.dir?.intensity ?? NaN),
    backgroundHex: Number(appearance?.background ?? NaN),
    backgroundBottomHex: Number(appearance?.backgroundBottom ?? NaN),
    fogstart: Number(snapshot?.visual?.map?.fogstart ?? NaN),
    fogend: Number(snapshot?.visual?.map?.fogend ?? NaN),
    haze: Number(snapshot?.visual?.map?.haze ?? NaN),
    fogRgba: (Array.isArray(fogRgbaRaw) || ArrayBuffer.isView(fogRgbaRaw)) ? Array.from(fogRgbaRaw).slice(0, 4) : null,
    hazeRgba: (Array.isArray(hazeRgbaRaw) || ArrayBuffer.isView(hazeRgbaRaw)) ? Array.from(hazeRgbaRaw).slice(0, 4) : null,
    headlightActive: Number(snapshot?.visual?.headlight?.active ?? 1),
    hasEnvironment: !!environment,
    backgroundKind: background?.userData?.backgroundKind || (background?.isColor ? 'color' : background?.isTexture ? 'texture' : 'none'),
    mjLightRigVisible: !!mjLightRig?.group?.visible,
    mjVisibleLights,
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
  expect(moon.albedoGain).toBeCloseTo(1.0, 5);
  expect(moon.normalRepeatX).toBeCloseTo(0.95, 5);
  expect(moon.normalRepeatY).toBeCloseTo(0.95, 5);
  expect(moon.roughnessRepeatX).toBeCloseTo(0.95, 5);
  expect(moon.roughnessRepeatY).toBeCloseTo(0.95, 5);
  expect(moon.normalScaleX).toBeCloseTo(0.5, 5);
  expect(moon.normalScaleY).toBeCloseTo(0.5, 5);
  expect(moon.directSpecularScale).toBeCloseTo(0.6, 5);
  expect(moon.roughness).toBeCloseTo(0.94, 5);
  expect(moon.reflectance).toBeGreaterThan(0);
  expect(moon.envBaseIntensity).toBeCloseTo(0.0, 2);
  expect(moon.fadePow).toBeCloseTo(2.5, 5);
  expect(moon.fadeEnd).toBeCloseTo(2000, 5);
  expect(moon.fadeStart).toBeCloseTo(1200, 5);
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
  expect(sun.albedoGain).toBeCloseTo(1.8, 5);
  expect(sun.normalRepeatX).toBeCloseTo(0.95, 5);
  expect(sun.normalRepeatY).toBeCloseTo(0.95, 5);
  expect(sun.roughnessRepeatX).toBeCloseTo(0.95, 5);
  expect(sun.roughnessRepeatY).toBeCloseTo(0.95, 5);
  expect(sun.normalScaleX).toBeCloseTo(0.36, 5);
  expect(sun.normalScaleY).toBeCloseTo(0.36, 5);
  expect(sun.colorHex).not.toBe(moon.colorHex);
  expect(sun.fadePow).toBeCloseTo(2.5, 5);
  expect(sun.fadeEnd).toBeCloseTo(2000, 5);
  expect(sun.fadeStart).toBeCloseTo(1200, 5);
  expect(sun.opacity).toBeCloseTo(1, 5);
  expect(warnings.filter((line) => line.includes('Texture marked for update but no image data found'))).toEqual([]);
});

test('preset sun and moon split atmosphere/background behavior without leaking into model mode', async ({ page }) => {
  await waitForViewerReady(page, '/index.html?model=raj&ver=3.5.0&snapshot=1&log=0');

  await switchVisualSource(page, 'PresetSun');
  await expect.poll(async () => page.evaluate(readPresetSceneInfo)).toMatchObject({
    mode: 'preset-sun',
    backgroundMode: 'hdri',
    backgroundKind: 'hdri',
    hasEnvironment: true,
    mjLightRigVisible: false,
  });

  const sun = await page.evaluate(readPresetSceneInfo);
  expect(sun.exposure).toBeCloseTo(0.82, 5);
  expect(sun.envIntensity).toBeCloseTo(0.48, 5);
  expect(sun.ambientIntensity).toBeCloseTo(0.15, 5);
  expect(sun.hemiIntensity).toBeCloseTo(0.24, 5);
  expect(sun.fillIntensity).toBeCloseTo(0.16, 5);
  expect(sun.dirIntensity).toBeCloseTo(3.1, 5);
  expect(sun.fogstart).toBeCloseTo(6, 5);
  expect(sun.fogend).toBeCloseTo(24, 5);
  expect(sun.haze).toBeCloseTo(0.28, 5);
  expect(sun.backgroundHex).toBe(0x8fb8ec);
  expect(sun.backgroundBottomHex).toBe(0xf3f6fb);
  expectVec4Close(sun.fogRgba, [0.8392157, 0.8901961, 0.9647059, 1]);
  expectVec4Close(sun.hazeRgba, [0.9490196, 0.9686275, 1, 1]);
  expect(sun.mjVisibleLights).toBe(0);

  await switchVisualSource(page, 'PresetMoon');
  await expect.poll(async () => page.evaluate(readPresetSceneInfo)).toMatchObject({
    mode: 'preset-moon',
    backgroundMode: 'hdri',
    backgroundKind: 'hdri',
    hasEnvironment: true,
    mjLightRigVisible: false,
  });

  const moon = await page.evaluate(readPresetSceneInfo);
  expect(moon.exposure).toBeCloseTo(0.68, 5);
  expect(moon.envIntensity).toBeCloseTo(0.16, 5);
  expect(moon.ambientIntensity).toBeCloseTo(0.40, 5);
  expect(moon.hemiIntensity).toBeCloseTo(0.30, 5);
  expect(moon.fillIntensity).toBeCloseTo(0.36, 5);
  expect(moon.dirIntensity).toBeCloseTo(1.55, 5);
  expect(moon.fogstart).toBeCloseTo(6, 5);
  expect(moon.fogend).toBeCloseTo(20, 5);
  expect(moon.haze).toBeCloseTo(0.22, 5);
  expectVec4Close(moon.fogRgba, [0.0666667, 0.0823529, 0.1137255, 1]);
  expectVec4Close(moon.hazeRgba, [0.1058824, 0.1215686, 0.1647059, 1]);
  expect(moon.mjVisibleLights).toBe(0);

  await page.evaluate(async () => {
    const controls = (window as any).__viewerControls;
    if (!controls?.toggleControl) throw new Error('Missing __viewerControls.toggleControl');
    await controls.toggleControl('option.visual_source', 'Model');
  });
  await expect.poll(async () => page.evaluate(readPresetSceneInfo)).toMatchObject({
    mode: 'model',
    backgroundMode: null,
    headlightActive: 1,
    mjLightRigVisible: true,
  });
});

test('model-mode infinite ground starts haze fade closer to the camera', async ({ page }) => {
  await waitForViewerReady(page, '/index.html?model=raj&ver=3.5.0&snapshot=1&log=0');

  await expect
    .poll(async () => page.evaluate(readPresetGroundInfo), {
      message: 'waiting for model-mode infinite ground uniforms',
    })
    .toMatchObject({
      found: true,
      projection: 'infinite',
      infiniteVisible: true,
    });

  const info = await page.evaluate(readPresetGroundInfo);
  expect(info.enabled).toBe(0);
  expect(info.fadePow).toBeGreaterThan(0);
  expect(info.fadeEnd).toBeGreaterThan(0);
  expect(info.fadeStart).toBeGreaterThan(0);
  expect(info.fadeStart).toBeLessThan(info.fadeEnd);
  expect(info.fadeStart / info.fadeEnd).toBeCloseTo(0.6, 3);
});
