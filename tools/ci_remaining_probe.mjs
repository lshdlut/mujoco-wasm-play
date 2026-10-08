import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = process.env.PLAY_PROBE_ROOT
  ? path.resolve(process.env.PLAY_PROBE_ROOT)
  : await fs.mkdtemp(path.join(os.tmpdir(), 'play-remaining-probe-'));
await fs.mkdir(root, { recursive: true });
const core = path.join(repo, 'tests/e2e/core');
const selected = (await fs.readdir(core)).filter(name => name.endsWith('.spec.ts') && name >= 'preset_ground_surface.spec.ts').sort();
const config = `
import base from ${JSON.stringify(pathToFileURL(path.join(repo, 'tests/playwright.config.mjs')).href)};
export default { ...base, testDir: ${JSON.stringify(core)}, testMatch: ${JSON.stringify(selected)},
  outputDir: ${JSON.stringify(path.join(root, 'results'))},
  reporter: [['list'], ['json', { outputFile: ${JSON.stringify(path.join(root, 'results.json'))} }]] };
`;
const configPath = path.join(root, 'remaining.config.mjs');
await fs.writeFile(configPath, config);
console.log(`[remaining-probe] ${selected.length} original core files, no fail-fast; original browser, quality, assertions and deadlines unchanged; NOT a publication gate`);
const result = spawnSync(process.execPath, [path.join(repo, 'node_modules/@playwright/test/cli.js'), 'test', '--config', configPath, '--max-failures=0'], { cwd: repo, env: process.env, stdio: 'inherit' });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
