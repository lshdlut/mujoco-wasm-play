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
  const dir = path.resolve(process.cwd(), 'tests', 'unit');
  if (!fs.existsSync(dir)) return [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.test.mjs'))
    .map((entry) => path.join('tests', 'unit', entry.name))
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
if (fileExists('ui/state.mjs')) {
  run('syntax: ui_state', ['--check', 'ui/state.mjs']);
}
if (fileExists('ui/control_manager.mjs')) {
  run('syntax: ui_control_manager', ['--check', 'ui/control_manager.mjs']);
}
if (fileExists('renderer/pipeline.mjs')) {
  run('syntax: renderer_pipeline', ['--check', 'renderer/pipeline.mjs']);
}
if (fileExists('renderer/controllers.mjs')) {
  run('syntax: renderer_controllers', ['--check', 'renderer/controllers.mjs']);
}
run('syntax: physics.worker', ['--check', 'worker/physics.worker.mjs']);
if (fileExists('worker/snapshot_pool.mjs')) {
  run('syntax: snapshot_pool', ['--check', 'worker/snapshot_pool.mjs']);
}
run('syntax: app_main', ['--check', 'app/main.mjs']);
if (fileExists('backend/backend_core.mjs')) {
  run('syntax: backend_core', ['--check', 'backend/backend_core.mjs']);
}
if (fileExists('bridge/heap_views.mjs')) {
  run('syntax: bridge_heap_views', ['--check', 'bridge/heap_views.mjs']);
}

console.log('[checks] OK');
