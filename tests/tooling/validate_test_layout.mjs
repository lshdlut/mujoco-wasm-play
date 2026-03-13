import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const repoRoot = process.cwd();

function fail(message) {
  throw new Error(`[test-layout] ${message}`);
}

function assert(condition, message) {
  if (!condition) fail(message);
}

function walkTests(dirRel = 'tests') {
  const dirAbs = path.resolve(repoRoot, dirRel);
  const out = [];
  const entries = fs.readdirSync(dirAbs, { withFileTypes: true });
  for (const entry of entries) {
    const absPath = path.join(dirAbs, entry.name);
    const relPath = path.relative(repoRoot, absPath).replace(/\\/g, '/');
    if (entry.isDirectory()) {
      out.push(...walkTests(relPath));
      continue;
    }
    out.push(relPath);
  }
  return out;
}

async function loadConfig(relPath) {
  const absPath = path.resolve(repoRoot, relPath);
  return import(pathToFileURL(absPath).href);
}

const presentTests = walkTests();
const localSpecs = presentTests.filter((entry) => /\.local\.spec\.[cm]?[jt]s$/.test(entry));
assert(localSpecs.length === 0, `local-only specs remain on disk: ${localSpecs.join(', ')}`);

const deletedSpecDestinations = new Map([
  ['tests/e2e/default-init-debug.spec.ts', 'tests/e2e/core/viewer_boot.spec.ts'],
  ['tests/e2e/worker-time-advances.spec.ts', 'tests/e2e/core/viewer_boot.spec.ts'],
  ['tests/e2e/raj_single_reset_memory.spec.ts', 'tests/e2e/core/viewer_boot.spec.ts'],
  ['tests/e2e/theme_param.spec.ts', 'tests/e2e/core/runtime_config.spec.ts'],
  ['tests/e2e/embed_mode.spec.ts', 'tests/e2e/core/runtime_config.spec.ts'],
  ['tests/e2e/environment_asset_base.spec.ts', 'tests/e2e/core/runtime_config.spec.ts'],
  ['tests/e2e/ui_sections_contract.spec.ts', 'tests/e2e/core/panel_state.spec.ts'],
  ['tests/e2e/ui_kit_contract.spec.ts', 'tests/e2e/core/plugin_ui.spec.ts'],
  ['tests/e2e/dynamic_slider_relink.spec.ts', 'tests/e2e/core/dynamic_panels.spec.ts'],
  ['tests/e2e/equality-panel.spec.ts', 'tests/e2e/core/dynamic_panels.spec.ts'],
  ['tests/e2e/group_enable_filtering.spec.ts', 'tests/e2e/core/dynamic_panels.spec.ts'],
  ['tests/e2e/physics-options.spec.ts', 'tests/e2e/core/dynamic_panels.spec.ts'],
  ['tests/e2e/align_stable.spec.ts', 'tests/e2e/core/camera_reload.spec.ts'],
  ['tests/e2e/model-switch-camera-reset.spec.ts', 'tests/e2e/core/camera_reload.spec.ts'],
  ['tests/e2e/model-switch-reset.spec.ts', 'tests/e2e/core/camera_reload.spec.ts'],
  ['tests/e2e/rendering-behaviors.spec.ts', 'tests/e2e/core/render_modes.spec.ts'],
  ['tests/e2e/tracking-and-frame-site.spec.ts', 'tests/e2e/core/render_modes.spec.ts'],
  ['tests/e2e/shadow_viewport_restore.spec.ts', 'tests/e2e/core/render_modes.spec.ts'],
  ['tests/e2e/skybox-toggle.spec.ts', 'tests/e2e/core/render_modes.spec.ts'],
  ['tests/e2e/texture-flag-parity.spec.ts', 'tests/e2e/contracts/renderer_parity.spec.ts'],
  ['tests/e2e/info-overlay.spec.ts', 'tests/e2e/core/scene_features.spec.ts'],
  ['tests/e2e/label_anchor_site.spec.ts', 'tests/e2e/core/scene_features.spec.ts'],
  ['tests/e2e/history_sampling.spec.ts', 'tests/e2e/core/scene_features.spec.ts'],
  ['tests/e2e/hfield-touch-grid.spec.ts', 'tests/e2e/core/scene_features.spec.ts'],
  ['tests/e2e/raj-site-tendon-rgba.spec.ts', 'tests/e2e/core/scene_features.spec.ts'],
  ['tests/e2e/humanoid100-model-ref-load.spec.ts', 'tests/diagnostics/renderer_diag.spec.ts'],
  ['tests/e2e/mjvscene-export.spec.ts', 'tests/diagnostics/renderer_diag.spec.ts'],
  ['tests/e2e/pthreads_requires_coi.spec.ts', 'tests/e2e/core/pthreads.spec.ts'],
  ['tests/e2e/pthreads_raj_joint_names.spec.ts', 'tests/e2e/core/pthreads.spec.ts'],
  ['tests/e2e/convex-hull-parity.spec.ts', 'tests/e2e/contracts/renderer_parity.spec.ts'],
  ['tests/e2e/slidercrank-parity.spec.ts', 'tests/e2e/contracts/renderer_parity.spec.ts'],
  ['tests/e2e/tendon-catenary-parity.spec.ts', 'tests/e2e/contracts/renderer_parity.spec.ts'],
  ['tests/e2e/flex-layer-parity.spec.ts', 'tests/e2e/contracts/renderer_parity.spec.ts'],
  ['tests/e2e/instancing-visual-parity.spec.ts', 'tests/e2e/contracts/instancing_parity.spec.ts'],
  ['tests/e2e/instancing-site-tendon-parity.spec.ts', 'tests/e2e/contracts/instancing_parity.spec.ts'],
  ['tests/e2e/instancing-instancecolor-attr.spec.ts', 'tests/e2e/contracts/instancing_parity.spec.ts'],
  ['tests/e2e/static-transparent-parity.spec.ts', 'tests/e2e/contracts/transparency_occlusion.spec.ts'],
  ['tests/e2e/transparent-strict-ordering.spec.ts', 'tests/e2e/contracts/transparency_occlusion.spec.ts'],
  ['tests/e2e/ground_depthwrite.spec.ts', 'tests/e2e/contracts/transparency_occlusion.spec.ts'],
  ['tests/e2e/world_overlay_occlusion.spec.ts', 'tests/e2e/contracts/transparency_occlusion.spec.ts'],
  ['tests/e2e/contact_overlays_humanoid_debug.spec.ts', 'tests/diagnostics/contact_overlays_debug.spec.ts'],
  ['tests/e2e/mjvscene-skin-diag.spec.ts', 'tests/diagnostics/renderer_diag.spec.ts'],
  ['tests/e2e/geomorder-dump.spec.ts', 'tests/diagnostics/renderer_diag.spec.ts'],
  ['tests/e2e/strict_gate.spec.mjs', 'tests/diagnostics/strict_gate.spec.mjs'],
  ['tests/e2e/perf-phases.spec.ts', 'tests/perf/perf_phases.spec.ts'],
  ['tests/microbench/flex.microbench.spec.ts', 'tests/perf/flex_microbench.spec.ts'],
  ['tests/e2e/model-scan.local.spec.ts', 'tests/diagnostics/contact_overlays_debug.spec.ts'],
]);

for (const [oldSpec, newSuite] of deletedSpecDestinations.entries()) {
  const oldExists = fs.existsSync(path.resolve(repoRoot, oldSpec));
  assert(!oldExists, `${oldSpec} still exists on disk`);
  assert(fs.existsSync(path.resolve(repoRoot, newSuite)), `destination suite missing: ${newSuite}`);
}

const defaultConfig = (await loadConfig('tests/playwright.config.mjs')).default;
const contractsConfig = (await loadConfig('tests/playwright.contract.config.mjs')).default;
const diagnosticsConfig = (await loadConfig('tests/playwright.diagnostics.config.mjs')).default;
const perfConfig = (await loadConfig('tests/playwright.perf.config.mjs')).default;

assert(defaultConfig.testDir === './e2e/core', `default config testDir drifted: ${defaultConfig.testDir}`);
assert(contractsConfig.testDir === './e2e/contracts', `contracts config testDir drifted: ${contractsConfig.testDir}`);
assert(diagnosticsConfig.testDir === './diagnostics', `diagnostics config testDir drifted: ${diagnosticsConfig.testDir}`);
assert(perfConfig.testDir === './perf', `perf config testDir drifted: ${perfConfig.testDir}`);

const packageJson = JSON.parse(fs.readFileSync(path.resolve(repoRoot, 'package.json'), 'utf8'));
const scripts = packageJson.scripts || {};
assert(String(scripts.smoke || '').includes('tests/e2e/core/viewer_boot.spec.ts'), 'smoke script does not point to viewer_boot.spec.ts');
assert(String(scripts['test:e2e'] || '').includes('tests/playwright.config.mjs'), 'test:e2e does not use default core config');
assert(String(scripts['test:e2e:contracts'] || '').includes('tests/playwright.contract.config.mjs'), 'test:e2e:contracts missing contract config');
assert(String(scripts['test:e2e:diagnostics'] || '').includes('tests/playwright.diagnostics.config.mjs'), 'test:e2e:diagnostics missing diagnostics config');
assert(String(scripts['test:e2e:perf'] || '').includes('tests/playwright.perf.config.mjs'), 'test:e2e:perf missing perf config');

console.log('TEST LAYOUT OK');
