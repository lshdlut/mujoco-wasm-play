Compatibility
=============

This page defines the compatibility contract between:

- Play (this repo)
- forge dist bundles (``mujoco-wasm-forge`` outputs)
- browsers (module Workers + WASM)

Browsers
--------

Play requires:

- ES modules in the main thread
- **module Workers** (``new Worker(url, { type: 'module' })``)
- WebAssembly

Most modern Chromium/Firefox/Safari versions satisfy these requirements.

Forge dist bundle requirements
------------------------------

Play expects a forge ``dist/<ver>/`` directory that contains at least:

- ``mujoco.js`` (ESM-capable loader)
- ``mujoco.wasm``

Recommended (optional):

- ``version.json`` (used for cache tagging and diagnostics)

Viewer ABI extensions (required)
--------------------------------

Play validates that the loaded forge module exports a required viewer ABI set.
If any export is missing, the Worker throws an error and reports the missing
symbols.

The canonical list lives in ``dev/physics.worker.mjs``:

.. literalinclude:: ../../../dev/physics.worker.mjs
  :language: js
  :start-after: const required = [
  :end-before: const missing =

Notes:

- This is a *viewer* contract (scene packing, vopt/camera/perturb pointers, and
  mjv helpers).
- If you build your own forge bundle, ensure viewer extensions are enabled.

Local dev vs hosted layouts
---------------------------

When ``forgeBase=`` is omitted, the Worker uses a local fallback layout:

- on ``localhost`` / ``127.0.0.1``: it tries ``/mujoco-wasm-forge/dist/<ver>/``
  (mounted by ``dev/dev_server.py`` if you have a sibling forge checkout)
- otherwise: it tries ``dev/dist/<ver>/`` relative to the app

For explicit control (recommended for published demos), always pass
``forgeBase=...`` and pin it to an immutable forge commit.
