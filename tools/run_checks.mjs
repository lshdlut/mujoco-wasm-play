import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

function run(label, args, options = {}) {
  const cmd = process.execPath;
  const result = spawnSync(cmd, args, {
    stdio: 'inherit',
    cwd: options.cwd || process.cwd(),
    env: options.env || process.env,
  });
  if (result.status !== 0) {
    throw new Error(`[checks] ${label} failed with exit code ${result.status}`);
  }
}

function listNodeTests() {
  const dir = path.resolve(process.cwd(), 'test');
  if (!fs.existsSync(dir)) return [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.test.mjs'))
    .map((entry) => path.join('test', entry.name))
    .sort();
}

function fileExists(relPath) {
  return fs.existsSync(path.resolve(process.cwd(), relPath));
}

run('forbid_patterns', ['tools/forbid_patterns.mjs']);

if (fileExists('tools/check_module_boundaries.mjs')) {
  run('module_boundaries', ['tools/check_module_boundaries.mjs']);
}

const tests = listNodeTests();
if (tests.length) {
  run('node_tests', ['--test', ...tests]);
}

  // Syntax-only checks for browser-only entrypoints.
  run('syntax: main_renderer', ['--check', 'dev/main_renderer.mjs']);
  if (fileExists('dev/renderer/renderer_core.mjs')) {
    run('syntax: renderer_core', ['--check', 'dev/renderer/renderer_core.mjs']);
  }
  if (fileExists('dev/renderer/pipeline.mjs')) {
    run('syntax: renderer_pipeline', ['--check', 'dev/renderer/pipeline.mjs']);
  }
  if (fileExists('dev/renderer/controllers.mjs')) {
    run('syntax: renderer_controllers', ['--check', 'dev/renderer/controllers.mjs']);
  }
  run('syntax: physics.worker', ['--check', 'dev/physics.worker.mjs']);
  if (fileExists('dev/worker/snapshot_pool.mjs')) {
    run('syntax: snapshot_pool', ['--check', 'dev/worker/snapshot_pool.mjs']);
  }
  run('syntax: main.nobuild', ['--check', 'dev/main.nobuild.mjs']);
  if (fileExists('dev/backend/backend_core.mjs')) {
    run('syntax: backend_core', ['--check', 'dev/backend/backend_core.mjs']);
  }
  if (fileExists('dev/bridge/bridge_core.mjs')) {
    run('syntax: bridge_core', ['--check', 'dev/bridge/bridge_core.mjs']);
  }

console.log('[checks] OK');
