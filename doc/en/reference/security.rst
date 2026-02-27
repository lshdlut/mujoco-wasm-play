Security model
==============

Play is a viewer. It does not try to sandbox code beyond what the browser
already provides.

The two primary "code loading" surfaces are:

- forge bundles (``mujoco.js`` from ``forgeBase=...``)
- plugins (``plugins=...`` / ``PLAY_PLUGINS``)

Treat both as **trusted code**.

Plugins = executing JavaScript
------------------------------

The plugin mechanism dynamically imports arbitrary ESM modules. A plugin has
the same privileges as any script running on the page (DOM access, network
requests, etc).

Best practices:

- only load plugins you trust
- host plugins on the same origin when possible
- for public demos, avoid accepting user-provided plugin URLs

forgeBase = executing JavaScript (plus WASM)
--------------------------------------------

``forgeBase`` points to a directory that serves ``mujoco.js`` and
``mujoco.wasm``.

Best practices:

- pin to immutable URLs (commit SHA)
- prefer HTTPS
- ensure correct MIME types and CORS headers

Model loading and assets
------------------------

The default model loader only supports local, relative file references that can
be fetched from the static host. Remote or absolute references are rejected by
default.

If you need to fetch assets from custom endpoints, do so explicitly in your own
code and call ``host.backend.loadXmlBundle(...)``.

