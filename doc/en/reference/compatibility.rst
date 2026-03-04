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

- ``version.json`` (optional; used for diagnostics in verbose/perf mode)

Viewer ABI extensions
--------------------------------

Play validates that the loaded forge module exports a required viewer ABI set.
If any export is missing, the Worker throws an error and reports the missing
symbols.

The canonical list lives in ``worker/physics.worker.mjs``:

.. literalinclude:: ../../../worker/physics.worker.mjs
  :language: js
  :start-after: const required = [
  :end-before: const missing =

Notes:

- This is a *viewer* contract (scene packing, vopt/camera/perturb pointers, and
  mjv helpers).
- If you build your own forge bundle, ensure viewer extensions are enabled.

Local dev vs hosted layouts
---------------------------

When ``forgeBase=`` is omitted, Play resolves a default forge base template and
propagates it to the Worker:

- single entry: ``/forge/dist/{ver}/``
- pthreads entry: ``/forge/dist/{ver}/pthreads/``

The local dev server (``tools/dev_server.py``) mounts ``/forge/`` to a sibling
``../mujoco-wasm-forge`` checkout if present (otherwise it falls back to the
Play repo root for local-only mirrors).

For explicit control (recommended for published demos), always pass
``forgeBase=...`` and pin it to an immutable forge commit.

Pthreads (SharedArrayBuffer)
----------------------------

If you use the pthreads entry (``/pthreads/index.html``):

- the forge bundle must exist under ``dist/<ver>/pthreads/`` (at least
  ``mujoco.js`` + ``mujoco.wasm``), and
- the page must be cross-origin isolated (``crossOriginIsolated === true``),
  which requires COOP/COEP headers.

Play hard-fails early if cross-origin isolation is missing.
