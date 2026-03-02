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
- Mounts stable prefixes:
  - ``/mujoco-wasm-play/`` → repo root
  - ``/mujoco-wasm-forge/`` → sibling forge repo, if present

Environment variables
---------------------

- ``PLAY_DEV_SERVER_DEBUG_MOUNTS=1``: prints mount/path debug logs to stderr.

Source of truth
---------------

See ``tools/dev_server.py``.
