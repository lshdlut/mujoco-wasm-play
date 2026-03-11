import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_ENV_ASSET_BASE_URL,
  getFallbackPreset,
  resolveEnvironmentAssetBase,
  resolveEnvironmentAssetUrl,
} from '../../environment/environment.mjs';

function withRuntimeConfig(config, fn) {
  const previous = globalThis.__PLAY_RUNTIME_CONFIG__;
  globalThis.__PLAY_RUNTIME_CONFIG__ = config;
  try {
    return fn();
  } finally {
    if (typeof previous === 'undefined') {
      delete globalThis.__PLAY_RUNTIME_CONFIG__;
    } else {
      globalThis.__PLAY_RUNTIME_CONFIG__ = previous;
    }
  }
}

test('environment asset base defaults to repo-local assets/env/', () => {
  withRuntimeConfig({ rendering: {} }, () => {
    assert.equal(resolveEnvironmentAssetBase(), DEFAULT_ENV_ASSET_BASE_URL);
    assert.equal(
      resolveEnvironmentAssetUrl('rustig_koppie_puresky_4k.hdr'),
      new URL('rustig_koppie_puresky_4k.hdr', DEFAULT_ENV_ASSET_BASE_URL).href,
    );
  });
});

test('environment asset base override normalizes trailing slash and updates preset URLs', () => {
  withRuntimeConfig({
    rendering: {
      environmentAssetBase: 'https://static.example.com/play-env',
    },
  }, () => {
    assert.equal(resolveEnvironmentAssetBase(), 'https://static.example.com/play-env/');
    assert.equal(
      resolveEnvironmentAssetUrl('starmap_random_2020_4k_rot.exr'),
      'https://static.example.com/play-env/starmap_random_2020_4k_rot.exr',
    );
    assert.equal(
      getFallbackPreset('sun').hdri,
      'https://static.example.com/play-env/rustig_koppie_puresky_4k.hdr',
    );
    assert.equal(
      getFallbackPreset('moon').hdri,
      'https://static.example.com/play-env/starmap_random_2020_4k_rot.exr',
    );
  });
});
