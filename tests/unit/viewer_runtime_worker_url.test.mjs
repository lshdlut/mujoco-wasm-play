import test from 'node:test';
import assert from 'node:assert/strict';

import {
  applyVerTemplate,
  buildWorkerUrl,
  resolveCacheBustMode,
  resolveForgeBase,
  resolveForgeBaseTemplate,
  resolveVer,
} from '../../core/viewer_runtime.mjs';

test('runtime: resolveCacheBustMode defaults to none', () => {
  assert.equal(resolveCacheBustMode(new URLSearchParams('')), 'none');
});

test('runtime: resolveCacheBustMode parses always/none tokens', () => {
  assert.equal(resolveCacheBustMode(new URLSearchParams('cacheBust=always')), 'always');
  assert.equal(resolveCacheBustMode(new URLSearchParams('cacheBust=1')), 'always');
  assert.equal(resolveCacheBustMode(new URLSearchParams('cacheBust=true')), 'always');
  assert.equal(resolveCacheBustMode(new URLSearchParams('cacheBust=on')), 'always');

  assert.equal(resolveCacheBustMode(new URLSearchParams('cacheBust=none')), 'none');
  assert.equal(resolveCacheBustMode(new URLSearchParams('cacheBust=0')), 'none');
  assert.equal(resolveCacheBustMode(new URLSearchParams('cacheBust=false')), 'none');
  assert.equal(resolveCacheBustMode(new URLSearchParams('cacheBust=off')), 'none');
});

test('runtime: resolveVer prefers URL ver then playVer', () => {
  assert.equal(resolveVer(new URLSearchParams('ver=3.5.0'), { playVer: '3.4.0' }), '3.5.0');
  assert.equal(resolveVer(new URLSearchParams(''), { playVer: '3.5.0' }), '3.5.0');
});

test('runtime: resolveVer throws when missing', () => {
  assert.throws(() => resolveVer(new URLSearchParams(''), { playVer: '' }), /Missing MuJoCo version/i);
});

test('runtime: resolveForgeBaseTemplate priority (URL > global override > default)', () => {
  assert.equal(
    resolveForgeBaseTemplate(new URLSearchParams('forgeBase=/x/{ver}/'), { forgeDistBaseOverride: '/y/{ver}/' }),
    '/x/{ver}/',
  );
  assert.equal(
    resolveForgeBaseTemplate(new URLSearchParams(''), { forgeDistBaseOverride: '/y/{ver}/' }),
    '/y/{ver}/',
  );
  assert.equal(resolveForgeBaseTemplate(new URLSearchParams(''), { forgeDistBaseOverride: '' }), '/forge/dist/{ver}/');
});

test('runtime: applyVerTemplate expands {ver}', () => {
  assert.equal(applyVerTemplate('/forge/dist/{ver}/', '3.5.0'), '/forge/dist/3.5.0/');
});

test('runtime: resolveForgeBase expands template and normalizes trailing slash', () => {
  const params = new URLSearchParams('ver=3.5.0');
  assert.equal(resolveForgeBase(params, { playVer: 'x', forgeDistBaseOverride: '/forge/dist/{ver}' }), '/forge/dist/3.5.0/');
  assert.equal(resolveForgeBase(params, { playVer: 'x', forgeDistBaseOverride: '/forge/dist/3.4.0' }), '/forge/dist/3.4.0/');
});

test('runtime: buildWorkerUrl always propagates ver+forgeBase and does not cache-bust by default', () => {
  const base = new URL('worker/physics.worker.mjs', 'http://example.test/');
  const params = new URLSearchParams('ver=3.5.0&forgeBase=/forge/dist/{ver}/');
  const url = buildWorkerUrl(base, params);
  assert.equal(url.searchParams.get('ver'), '3.5.0');
  assert.equal(url.searchParams.get('forgeBase'), '/forge/dist/3.5.0/');
  assert.equal(url.searchParams.get('cacheBust'), null);
  assert.equal(url.searchParams.get('cb'), null);
});

test('runtime: buildWorkerUrl cacheBust=always adds cb and forwards cacheBust', () => {
  const base = new URL('worker/physics.worker.mjs', 'http://example.test/');
  const params = new URLSearchParams('ver=3.5.0&forgeBase=/forge/dist/{ver}/&cacheBust=always');
  const url = buildWorkerUrl(base, params);
  assert.equal(url.searchParams.get('cacheBust'), 'always');
  assert.ok(url.searchParams.get('cb'));
});

test('runtime: buildWorkerUrl throws if ver is missing', () => {
  const base = new URL('worker/physics.worker.mjs', 'http://example.test/');
  assert.throws(() => buildWorkerUrl(base, new URLSearchParams('forgeBase=/forge/dist/3.5.0/')), /Missing MuJoCo version/i);
});

