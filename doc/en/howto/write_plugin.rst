Write a plugin
==============

Plugins are ESM modules that are dynamically imported at runtime. A plugin
register function receives the Host API (``window.__PLAY_HOST__``).

Minimal example
---------------

This repo ships a small demo plugin you can load directly:

.. code-block:: text

  http://127.0.0.1:8000/index.html?model=raj&plugins=./plugins/test_ui_sections_plugin.mjs

The plugin exports ``registerPlayPlugin(host)`` (or a default export) and can
return a disposer:

.. code-block:: js

  export function registerPlayPlugin(host) {
    const handle = host.ui.sections.register({
      panel: "left",
      sectionId: "plugin:hello",
      title: "Hello",
      defaultOpen: true,
      after: "file",
      render: (body) => {
        body.textContent = "Hello from plugin";
      },
    });
    return () => handle?.dispose?.();
  }

Loading
-------

Supported configurations:

- URL parameter: ``?plugins=<url1>,<url2>``
- Global (must be set before the main module runs):
  ``globalThis.PLAY_PLUGINS = ['<url1>', '<url2>']``

Worker boundary (important)
---------------------------

In the default Worker backend, plugins cannot access WASM exports directly.
Use:

- ``host.backend`` for commands
- snapshot streams (``host.backend.subscribe(...)`` / ``host.clock.onSnapshot``)

For the full contract (mounts, Host API, UI kit, overlay3d), see
:doc:`/reference/plugin_contract`.

