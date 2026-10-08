import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { SCENE_FLAG_INDICES } from '../core/viewer_defaults.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = process.env.PLAY_PROBE_ROOT
  ? path.resolve(process.env.PLAY_PROBE_ROOT)
  : await fs.mkdtemp(path.join(os.tmpdir(), 'play-browser-probe-'));
await fs.mkdir(root, { recursive: true });
const capture = process.env.PLAY_PROBE_SCREENSHOTS !== 'false';
const disableShadows = process.env.PLAY_PROBE_DISABLE_SHADOWS === 'true';
const channel = process.env.PLAY_PROBE_CHANNEL || undefined;
const compositedSwiftShader = process.env.PLAY_PROBE_COMPOSITED_SWIFTSHADER === 'true';
const groundProbe = process.env.PLAY_PROBE_CASE === 'ground';
const panelProbe = process.env.PLAY_PROBE_CASE === 'panel';
const pbrProbe = process.env.PLAY_PROBE_CASE === 'pbr';
const url = rel => pathToFileURL(path.join(repo, rel)).href;
const wrapper = `
import { test } from ${JSON.stringify(url('node_modules/@playwright/test/index.mjs'))};
import fs from 'node:fs/promises';
let cdp, browserSession, identity;
test.beforeEach(async ({ page, browser }) => {
  browserSession = await browser.newBrowserCDPSession();
  identity = { browser: await browserSession.send('Browser.getVersion'), gpu: await browserSession.send('SystemInfo.getInfo') };
  await browserSession.send('Tracing.start', { categories: 'devtools.timeline,blink,cc,gpu,renderer.scheduler', transferMode: 'ReturnAsStream' });
  if (${panelProbe}) return; // This assertion creates its own multi-page context; browser trace covers all targets.
  cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');
  await cdp.send('Profiler.enable');
  await cdp.send('Profiler.start');
  await page.addInitScript(({ disableShadows, shadowIndex }) => {
    window.__observation = { longtasks: [], renders: [], queries: [] };
    window.__observation.images = [];
    window.__observation.textureFrames = [];
    if (${pbrProbe}) {
      const descriptor = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src');
      Object.defineProperty(HTMLImageElement.prototype, 'src', { ...descriptor, set(value) {
        if (String(value).includes('sandy_gravel')) {
          const image = this;
          window.__observation.images.push({ event: 'src', url: String(value), time: performance.now() });
          image.addEventListener('load', () => window.__observation.images.push({ event: 'load', url: image.src, time: performance.now(), width: image.naturalWidth }), { once: true });
        }
        return descriptor.set.call(this, value);
      } });
    }
    new PerformanceObserver(list => window.__observation.longtasks.push(...list.getEntries().map(e => ({ start: e.startTime, duration: e.duration })))).observe({ entryTypes: ['longtask'] });
    const poll = setInterval(() => {
      const renderer = window.__renderCtx?.renderer;
      if (!renderer) return;
      clearInterval(poll);
      const draw = renderer.render.bind(renderer);
      renderer.render = (...args) => { const t = performance.now(); try { return draw(...args); } finally {
        window.__observation.renders.push(performance.now() - t);
        if (${pbrProbe}) {
          const ctx = window.__renderCtx, u = ctx.ground?.userData?.infiniteGround?.uniforms;
          window.__observation.textureFrames.push({ start: t, end: performance.now(), cache: Array.from(ctx.assetCache?.presetGroundTextures || [], ([key, texture]) => ({ key, width: texture?.image?.naturalWidth || texture?.image?.width || 0 })), normalEnabled: u?.uPresetNormalEnabled?.value });
        }
      } };
      const gl = renderer.getContext(), query = gl.getParameter.bind(gl);
      gl.getParameter = (...args) => { const t = performance.now(); try { return query(...args); } finally { window.__observation.queries.push({ parameter: args[0], duration: performance.now() - t }); } };
      const shadows = setInterval(() => {
        const controls = window.__viewerControls;
        if (!controls || !window.__PLAY_HOST__?.getSnapshot()?.scn_ngeom) return;
        clearInterval(shadows);
        if (disableShadows) {
          const id = controls.listIds('rendering.opengl_flags.').find(id => controls.getControl(id)?.binding === 'mjvScene::flags[' + shadowIndex + ']');
          if (!id) throw new Error('Shadow control unavailable in diagnostic');
          controls.toggleControl(id, false);
        }
      }, 50);
    }, 50);
  }, { disableShadows: ${disableShadows}, shadowIndex: ${SCENE_FLAG_INDICES.SHADOW} });
});
test.afterEach(async ({ page }, info) => {
  if (!${panelProbe}) {
  const profile = await cdp.send('Profiler.stop');
  const metrics = await cdp.send('Performance.getMetrics');
  const observation = await page.evaluate(() => window.__observation);
  const renderState = await page.evaluate(() => {
    const ctx = window.__renderCtx, renderer = ctx?.renderer;
    const lights = [];
    ctx?.sceneWorld?.traverse(item => { if (item.isLight) lights.push({ type: item.type, castShadow: item.castShadow, mapSize: item.shadow?.mapSize?.toArray(), visible: item.visible }); });
    return { nativeSceneFlags: window.__PLAY_HOST__?.getSnapshot()?.sceneFlags, shadowEnabled: renderer?.shadowMap?.enabled, lights,
      groundCommands: window.__groundFlagObservations, groundMode: ctx?.ground?.userData?.infiniteGround?.debugMode };
  });
  const file = info.outputPath('main-thread-profile.json');
  await fs.writeFile(file, JSON.stringify({ identity, metrics, observation, renderState, profile }));
  await info.attach('main-thread-profile', { path: file, contentType: 'application/json' });
  }
  if (${panelProbe}) await fs.writeFile(info.outputPath('browser-identity.json'), JSON.stringify(identity));
  const complete = new Promise(resolve => browserSession.once('Tracing.tracingComplete', resolve));
  await browserSession.send('Tracing.end');
  const { stream } = await complete;
  const chunks = [];
  for (;;) {
    const part = await browserSession.send('IO.read', { handle: stream });
    chunks.push(part.base64Encoded ? Buffer.from(part.data, 'base64').toString() : part.data);
    if (part.eof) break;
  }
  await browserSession.send('IO.close', { handle: stream });
  const nativeFile = info.outputPath('native-trace.json');
  await fs.writeFile(nativeFile, chunks.join(''));
  await info.attach('native-trace', { path: nativeFile, contentType: 'application/json' });
  await browserSession.detach();
});
await import(${JSON.stringify(url(pbrProbe ? 'tests/e2e/core/preset_ground_surface.spec.ts' : panelProbe ? 'tests/e2e/core/panel_state.spec.ts' : groundProbe ? 'tests/e2e/core/ground_debug_views.spec.ts' : 'tests/e2e/core/dynamic_panels.spec.ts'))});
`;
await fs.writeFile(path.join(root, 'probe.spec.mjs'), wrapper);
const config = `
import base from ${JSON.stringify(url('tests/playwright.config.mjs'))};
export default { ...base, testDir: ${JSON.stringify(root)}, testMatch: 'probe.spec.mjs', outputDir: ${JSON.stringify(path.join(root, 'results'))}, reporter: [['list'], ['json', { outputFile: ${JSON.stringify(path.join(root, 'results.json'))} }]], use: { ...base.use, channel: ${JSON.stringify(channel)}, ${compositedSwiftShader ? "launchOptions: { args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] }," : ''} trace: { mode: 'on', screenshots: ${capture} } } };
`;
const configPath = path.join(root, 'probe.config.mjs');
await fs.writeFile(configPath, config);
console.log(`[browser-probe] screenshots=${capture} disableShadows=${disableShadows} channel=${channel || 'default-shell'} compositedSwiftShader=${compositedSwiftShader} output=${root}; original assertions and 60s timeout unchanged; NOT a publication gate`);
const result = spawnSync(process.execPath, [path.join(repo, 'node_modules/@playwright/test/cli.js'), 'test', '--config', configPath, '--grep', pbrProbe ? 'binds the sandy gravel PBR' : panelProbe ? 'custom profile uses app-scoped namespace' : groundProbe ? 'infinite ground uses dedicated debug' : 'dynamic joint sliders relink', '--max-failures=1'], { cwd: repo, env: process.env, stdio: 'inherit' });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
