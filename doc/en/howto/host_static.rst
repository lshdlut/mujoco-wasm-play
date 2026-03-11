Host as static files
====================

Play is a static web app. Any static host (GitHub Pages, Nginx, S3 + CDN, ...)
works as long as a few requirements are met.

MIME types
----------

These must be correct, otherwise the browser will refuse to load modules/WASM:

- ``.mjs`` / ``.js`` → ``text/javascript; charset=utf-8``
- ``.wasm`` → ``application/wasm``

If you see Worker or module load failures, check the response ``Content-Type``
in DevTools Network.

CORS
--------------------------------------

If ``forgeBase=`` points to a different origin, the forge host must allow CORS
for:

- ``mujoco.js``
- ``mujoco.wasm``
- ``version.json`` (optional but recommended)

If you move built-in environment preset assets to another origin via
``envAssetBase=`` or ``PLAY_ENV_ASSET_BASE``, that host must also allow CORS
for the HDRI/EXR files.

Caching
-------

For development, it's often safest to disable caching (``Cache-Control:
no-store``) to avoid confusing stale Worker/module behavior.

The local dev server (``tools/dev_server.py``) is intentionally dev-biased:

- it serves ``.mjs``/``.js``/``.wasm`` with ``Cache-Control: no-store`` (so you
  never run old code by accident), and
- it disables conditional caching for ESM/WASM (always returns a 200 with a body).

This makes reloads and model switching *appear slower* in local dev, because the
browser cannot reuse cached modules/WASM.

Play itself is cache-friendly by default:

- it does **not** add a ``cb=...`` cache-bust query unless you explicitly set
  ``cacheBust=always``.

For production/demo hosting, do the opposite: prefer immutable URLs (pin forge
by commit SHA) and serve with long-lived caching headers (ideally
``immutable``).

``version.json`` is optional. Play may fetch it with ``no-store`` for
diagnostics when verbose/perf logging is enabled, but it is not required for
correct caching.

Environment preset assets follow the same model: by default they come from the
repo-local ``assets/env/`` directory, but you can point them at a shared CDN or
object store with ``envAssetBase=`` (or ``PLAY_ENV_ASSET_BASE`` in
``site_config.js``). If those remote files fail to load, Play keeps the preset
lighting and falls back to the existing cached/gradient environment path rather
than failing the viewer.

The included dev server is a good reference implementation:
``tools/dev_server.py``.
