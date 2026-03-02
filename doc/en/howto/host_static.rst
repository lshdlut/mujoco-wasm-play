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

CORS (when using remote ``forgeBase``)
--------------------------------------

If ``forgeBase=`` points to a different origin, the forge host must allow CORS
for:

- ``mujoco.js``
- ``mujoco.wasm``
- ``version.json`` (optional but recommended)

Caching
-------

For development, it's often safest to disable caching (``Cache-Control:
no-store``) to avoid confusing stale Worker/module behavior.

For production/demo hosting, prefer immutable URLs (pin forge by commit SHA) and
serve with long-lived caching headers.

The included dev server is a good reference implementation:
``tools/dev_server.py``.
