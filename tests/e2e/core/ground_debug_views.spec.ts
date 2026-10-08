import { expect, test, type Page } from '@playwright/test';
import { SCENE_FLAG_INDICES } from '../../../core/viewer_defaults.mjs';
import { waitForViewerReady } from '../test-utils';

async function switchVisualSource(page: Page, target: 'PresetSun' | 'PresetMoon') {
  await page.evaluate(async (mode) => {
    const controls = (window as any).__viewerControls;
    if (!controls?.toggleControl) {
      throw new Error('Missing __viewerControls.toggleControl');
    }
    await controls.toggleControl('option.visual_source', mode);
  }, target);
}

async function setSceneFlag(page: Page, flagIndex: number, value: boolean) {
  await page.evaluate(async ({ flagIndex, value }) => {
    const controls = (window as any).__viewerControls;
    if (!controls?.listIds || !controls.toggleControl || !controls.getControl) {
      throw new Error('__viewerControls helpers are not available');
    }
    const ids: string[] = controls.listIds('rendering.opengl_flags.');
    const target = ids.find((id) => controls.getControl(id)?.binding === `mjvScene::flags[${flagIndex}]`);
    if (!target) throw new Error(`scene flag control not found: ${flagIndex}`);
    await controls.toggleControl(target, value);
    const win = window as any;
    (win.__groundFlagObservations ||= []).push({ wall: Date.now(), requested: { flagIndex, value },
      flags: win.__PLAY_HOST__?.getSnapshot()?.sceneFlags?.slice(), ground: win.__renderCtx?.ground?.userData?.infiniteGround?.debugMode });
  }, { flagIndex, value });
}

test.afterEach(async ({ page }, info) => {
  if (info.status === info.expectedStatus) return;
  const observation = await page.evaluate(() => {
    const win = window as any;
    return { commands: win.__groundFlagObservations, flags: win.__PLAY_HOST__?.getSnapshot()?.sceneFlags,
      ground: win.__renderCtx?.ground?.userData?.infiniteGround?.debugMode, frame: win.__frameCounter };
  });
  await info.attach('ground-flags', { body: JSON.stringify(observation), contentType: 'application/json' });
});

function readGroundDebugInfo() {
  const ctx = (window as any).__renderCtx;
  const ground =
    ctx?.ground ||
    (Array.isArray(ctx?.meshes) ? ctx.meshes.find((m: any) => m?.userData?.infinitePlane) : null);
  const infiniteGround = ground?.userData?.infiniteGround || null;
  const material = ground?.material || null;
  const visibleGeomColorHexes = Array.isArray(ctx?.meshes)
    ? ctx.meshes
      .filter((m: any) => m?.visible && m?.userData && m.userData.geomIndex >= 0 && !m.userData.infinitePlane)
      .map((m: any) => (typeof m?.material?.color?.getHex === 'function' ? m.material.color.getHex() : null))
      .filter((value: number | null) => value != null)
    : [];
  return {
    found: !!ground,
    visible: !!ground?.visible,
    materialType: material?.type || null,
    hasInfiniteUniforms: !!material?.userData?.infiniteUniforms,
    hasGenericSegmentMaterial: !!ground?.userData?.segmentMaterial,
    debugMode: infiniteGround?.debugMode || null,
    wireframe: typeof material?.wireframe === 'boolean' ? material.wireframe : null,
    colorHex: typeof material?.color?.getHex === 'function' ? material.color.getHex() : null,
    visibleGeomColorHexes,
    presetSunDrawComplete: !!(window as any).__groundSunDrawComplete,
  };
}

test('infinite ground uses dedicated debug behavior for wireframe and segment modes', async ({ page }) => {
  await waitForViewerReady(page, '/index.html?model=raj&ver=3.5.0&snapshot=1&log=0');
  await page.evaluate(() => {
    const win = window as any;
    const ctx = win.__renderCtx;
    const renderer = ctx.renderer;
    const render = renderer.render;
    renderer.render = function (...args: any[]) {
      const result = render.apply(this, args);
      // A mode change is optimistic: require the new preset's resources in a
      // completed main draw, not the preceding model frame's ground state.
      if (args[0] === ctx.sceneWorld && renderer.getRenderTarget() === null) {
        const uniforms = ctx.ground?.userData?.infiniteGround?.uniforms;
        win.__groundSunDrawComplete = win.__viewerStore.get().visualSourceMode === 'preset-sun'
          && ctx.hdriReady && !ctx.hdriLoading
          && ctx.sceneWorld.background?.userData?.backgroundKind === 'hdri'
          && uniforms?.uPresetAlbedoGain?.value === 1.8
          && ['Albedo', 'Normal', 'Roughness'].every(name => {
            const image = uniforms?.[`uPreset${name}Map`]?.value?.image;
            return uniforms?.[`uPreset${name}Enabled`]?.value === 1 && image?.width > 0;
          });
      }
      return result;
    };
  });
  await switchVisualSource(page, 'PresetSun');

  await expect.poll(async () => (await page.evaluate(readGroundDebugInfo)).presetSunDrawComplete).toBe(true);

  await expect.poll(async () => {
    const info = await page.evaluate(readGroundDebugInfo);
    return info.debugMode;
  }).toBe('normal');

  const initial = await page.evaluate(readGroundDebugInfo);
  expect(initial.found).toBeTruthy();
  expect(initial.visible).toBeTruthy();
  expect(initial.hasInfiniteUniforms).toBeTruthy();
  expect(initial.hasGenericSegmentMaterial).toBe(false);

  await setSceneFlag(page, SCENE_FLAG_INDICES.WIREFRAME, true);
  await expect.poll(async () => {
    const info = await page.evaluate(readGroundDebugInfo);
    return `${info.debugMode}:${info.visible}`;
  }).toBe('wire-hidden:false');

  const wire = await page.evaluate(readGroundDebugInfo);
  expect(wire.hasInfiniteUniforms).toBeTruthy();
  expect(wire.hasGenericSegmentMaterial).toBe(false);
  expect(wire.wireframe).toBe(false);

  await setSceneFlag(page, SCENE_FLAG_INDICES.WIREFRAME, false);
  await expect.poll(async () => {
    const info = await page.evaluate(readGroundDebugInfo);
    return info.debugMode;
  }).toBe('normal');

  await setSceneFlag(page, SCENE_FLAG_INDICES.SEGMENT, true);
  await expect.poll(async () => {
    const info = await page.evaluate(readGroundDebugInfo);
    return `${info.debugMode}:${info.materialType}:${info.visible}`;
  }).toBe('segment-solid:MeshBasicMaterial:true');

  const segment = await page.evaluate(readGroundDebugInfo);
  expect(segment.hasInfiniteUniforms).toBeTruthy();
  expect(segment.hasGenericSegmentMaterial).toBe(false);
  expect(segment.wireframe).toBe(false);
  expect(segment.colorHex).not.toBeNull();
  expect(segment.visibleGeomColorHexes.length).toBeGreaterThan(0);
  expect(segment.visibleGeomColorHexes).not.toContain(segment.colorHex);

  await setSceneFlag(page, SCENE_FLAG_INDICES.WIREFRAME, true);
  await expect.poll(async () => {
    const info = await page.evaluate(readGroundDebugInfo);
    return `${info.debugMode}:${info.materialType}:${info.visible}`;
  }).toBe('segment-solid:MeshBasicMaterial:true');

  const segmentWire = await page.evaluate(readGroundDebugInfo);
  expect(segmentWire.hasInfiniteUniforms).toBeTruthy();
  expect(segmentWire.hasGenericSegmentMaterial).toBe(false);
  expect(segmentWire.wireframe).toBe(false);
  expect(segmentWire.visibleGeomColorHexes.length).toBeGreaterThan(0);
  expect(segmentWire.visibleGeomColorHexes).not.toContain(segmentWire.colorHex);
});
