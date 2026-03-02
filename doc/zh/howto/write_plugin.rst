编写插件
==============

插件是运行时动态导入的 ESM 模块。插件的注册函数会收到 Host API：``window.__PLAY_HOST__``。

最小示例
---------------

本仓库提供了一个小型演示插件，你可以直接加载：

.. code-block:: text

  http://127.0.0.1:8000/index.html?model=raj&plugins=./plugins/test_ui_sections_plugin.mjs

插件导出 ``registerPlayPlugin(host)``，也可以默认导出。注册函数可以返回 disposer：

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

加载
-------

支持的配置：

- URL 参数：``?plugins=<url1>,<url2>``
- 全局变量。必须在主模块运行之前设置：
  ``globalThis.PLAY_PLUGINS = ['<url1>', '<url2>']``

Worker 边界：重要
---------------------------

在默认的 Worker 后端下，插件无法直接访问 WASM 导出。请使用：

- ``host.backend`` for commands
- snapshot streams：``host.backend.subscribe(...)`` 或 ``host.clock.onSnapshot``

完整契约见 :doc:`/reference/plugin_contract`。
