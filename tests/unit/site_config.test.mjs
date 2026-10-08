import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const source = fs.readFileSync(new URL('../../site_config.js', import.meta.url), 'utf8');

test('bare GitHub Pages pins the validated Forge commit and version', () => {
  const context = { location: { hostname: 'lshdlut.github.io' } };
  vm.runInNewContext(source, context);
  assert.equal(context.PLAY_VER, '3.15.0');
  assert.equal(context.__FORGE_DIST_BASE__, 'https://cdn.jsdelivr.net/gh/lshdlut/mujoco-wasm-forge@592e1d9ae39587b6697b39387d1a4ec2699bc56a/deliverables/{ver}/');
});

test('local and aggregator mounts are not overwritten', () => {
  for (const hostname of ['localhost', '127.0.0.1', 'lshdlut.com']) {
    const context = { location: { hostname }, __FORGE_DIST_BASE__: '/custom/{ver}/' };
    vm.runInNewContext(source, context);
    assert.equal(context.__FORGE_DIST_BASE__, '/custom/{ver}/');
  }
});
