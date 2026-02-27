Limitations
===========

Worker-only backend
-------------------

Play currently runs MuJoCo in a module Worker. The legacy ``mode=...`` query
parameter is deprecated and ignored.

Plugin boundary
---------------

Plugins run on the main thread and must not assume direct access to WASM exports
(no ``window.__forgeModule`` in Worker mode). Use ``host.backend`` and snapshot
streams.

Model asset references
----------------------

The default loader supports bundling of **local, relative** file references.
Remote/absolute references are rejected by default.

If you need advanced asset loading, use ``host.backend.loadXmlBundle(...)``.

Network dependencies (Three.js CDN)
-----------------------------------

``dev/index.html`` imports Three.js from a CDN via an import map. Offline
deployments should vendor Three.js and update the import map accordingly.

Reserved parameters and debug hooks
-----------------------------------

Some URL parameters and globals exist for debugging or future work and may have
no effect in the current build. See :doc:`url_parameters` and
:doc:`configuration`.

