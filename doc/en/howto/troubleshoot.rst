Troubleshoot
============

This page is symptom-driven. If you are publishing a demo, start by validating
MIME types, CORS, and forge bundle URLs.

Blank page / module failed to load
----------------------------------

- Verify ``.mjs`` is served as JavaScript (not ``text/plain``).
- Confirm the host supports ESM (no HTML rewriting/proxying for ``.mjs``).

Worker fails to load ``mujoco.wasm``
------------------------------------

Most common causes:

- wrong ``Content-Type`` for ``.wasm`` (must be ``application/wasm``)
- missing CORS headers when using remote ``forgeBase=``
- stale/mismatched caching of ``mujoco.js`` vs ``mujoco.wasm`` (use immutable
  forge URLs; for debugging append ``cacheBust=always``)

Forge ABI missing exports
-------------------------

If you see an error like:

.. code-block:: text

  [forge] Missing viewer ABI exports ...

Your forge bundle is not built with viewer extensions required by Play. Use a
compatible forge build (or update the forge commit/version you are pointing
at).

Plugin does not load
--------------------

- Ensure the plugin is an ESM module and served with a correct JavaScript MIME
  type.
- For cross-origin plugin URLs, ensure CORS is enabled.
- Check console logs for ``[plugins] load failed``.

Performance is unexpectedly slow
--------------------------------

- Browser extensions can significantly affect Worker/WASM timing.
- Keep the tab in the foreground and disable "efficiency/power saving" modes.
- Compare ``localhost`` vs GitHub Pages; site-level policies may differ.

Strict mode failures
--------------------

If ``strict=1`` is enabled, caught errors (outside allowlists) will re-throw.
Use ``strict=0`` (default) for end-user demos, and enable strict only when
debugging/fuzzing.
