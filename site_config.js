// Site-level defaults for mujoco-wasm-play.
//
// Aggregator deployments can override this file to pin a default MuJoCo/forge
// dist id without patching any Play JS modules.
globalThis.PLAY_VER = '3.15.0';

// Bare GitHub Pages has no sibling /forge/ mount. Pin the published Forge
// source; local development and aggregator overrides keep their own mounts.
if (location.hostname === 'lshdlut.github.io') {
  globalThis.__FORGE_DIST_BASE__ = 'https://cdn.jsdelivr.net/gh/lshdlut/mujoco-wasm-forge@592e1d9ae39587b6697b39387d1a4ec2699bc56a/deliverables/{ver}/';
}

// Optional: host built-in HDRI/EXR environment assets from a shared CDN bucket
// or object store instead of the repo-local `assets/env/` directory.
// globalThis.PLAY_ENV_ASSET_BASE = 'https://static.example.com/play-env/';
