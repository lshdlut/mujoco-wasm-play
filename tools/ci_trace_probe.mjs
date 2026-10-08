import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = process.env.PLAY_PROBE_ROOT
  ? path.resolve(process.env.PLAY_PROBE_ROOT)
  : await fs.mkdtemp(path.join(os.tmpdir(), 'play-browser-probe-'));
await fs.mkdir(root, { recursive: true });
const capture = process.env.PLAY_PROBE_SCREENSHOTS !== 'false';
const url = rel => pathToFileURL(path.join(repo, rel)).href;
const wrapper = `
import { test } from ${JSON.stringify(url('node_modules/@playwright/test/index.mjs'))};
import fs from 'node:fs/promises';
let cdp, identity;
test.beforeEach(async ({ page, browser }) => {
  const browserSession = await browser.newBrowserCDPSession();
  identity = { browser: await browserSession.send('Browser.getVersion'), gpu: await browserSession.send('SystemInfo.getInfo') };
  await browserSession.detach();
  cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');
  await cdp.send('Profiler.enable');
  await cdp.send('Profiler.start');
  await page.addInitScript(() => {
    window.__observation = { longtasks: [], renders: [], queries: [] };
    new PerformanceObserver(list => window.__observation.longtasks.push(...list.getEntries().map(e => ({ start: e.startTime, duration: e.duration })))).observe({ entryTypes: ['longtask'] });
    const poll = setInterval(() => {
      const renderer = window.__renderCtx?.renderer;
      if (!renderer) return;
      clearInterval(poll);
      const draw = renderer.render.bind(renderer);
      renderer.render = (...args) => { const t = performance.now(); try { return draw(...args); } finally { window.__observation.renders.push(performance.now() - t); } };
      const gl = renderer.getContext(), query = gl.getParameter.bind(gl);
      gl.getParameter = (...args) => { const t = performance.now(); try { return query(...args); } finally { window.__observation.queries.push({ parameter: args[0], duration: performance.now() - t }); } };
    }, 50);
  });
});
test.afterEach(async ({ page }, info) => {
  const profile = await cdp.send('Profiler.stop');
  const metrics = await cdp.send('Performance.getMetrics');
  const observation = await page.evaluate(() => window.__observation);
  const file = info.outputPath('main-thread-profile.json');
  await fs.writeFile(file, JSON.stringify({ identity, metrics, observation, profile }));
  await info.attach('main-thread-profile', { path: file, contentType: 'application/json' });
});
await import(${JSON.stringify(url('tests/e2e/core/dynamic_panels.spec.ts'))});
`;
await fs.writeFile(path.join(root, 'probe.spec.mjs'), wrapper);
const config = `
import base from ${JSON.stringify(url('tests/playwright.config.mjs'))};
export default { ...base, testDir: ${JSON.stringify(root)}, testMatch: 'probe.spec.mjs', outputDir: ${JSON.stringify(path.join(root, 'results'))}, reporter: [['list'], ['json', { outputFile: ${JSON.stringify(path.join(root, 'results.json'))} }]], use: { ...base.use, trace: { mode: 'on', screenshots: ${capture} } } };
`;
const configPath = path.join(root, 'probe.config.mjs');
await fs.writeFile(configPath, config);
console.log(`[browser-probe] screenshots=${capture} output=${root}; original assertions and 60s timeout unchanged; NOT a publication gate`);
const result = spawnSync(process.execPath, [path.join(repo, 'node_modules/@playwright/test/cli.js'), 'test', '--config', configPath, '--grep', 'dynamic joint sliders relink', '--max-failures=1'], { cwd: repo, env: process.env, stdio: 'inherit' });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
