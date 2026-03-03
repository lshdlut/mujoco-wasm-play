Python dev server
=================

Play includes a small Python HTTP server for local development:

.. code-block:: bash

  python tools/dev_server.py --root . --port 8000

What it does
------------

- Serves static files under ``--root``.
- Ensures correct MIME types for:
  - ``.mjs`` / ``.js`` → JavaScript
  - ``.wasm`` → ``application/wasm``
- Adds security/cache headers:
  - ``X-Content-Type-Options: nosniff``
  - ``Cache-Control``: dev-friendly defaults
- For ``.mjs``/``.js``/``.wasm``, it forces ``Cache-Control: no-store`` and
  disables conditional caching (to avoid stale modules/WASM and confusing 304s).
  This is deliberate for local development, but it will make reloads and model
  switching slower than a production/static host.
- Mounts stable prefixes:
  - ``/mujoco-wasm-play/`` → repo root
  - ``/mujoco-wasm-forge/`` → sibling forge repo, if present

Environment variables
---------------------

- ``PLAY_DEV_SERVER_DEBUG_MOUNTS=1``: prints mount/path debug logs to stderr.

Source of truth
---------------

See ``tools/dev_server.py``.
