开发工作流
============

前置条件
-------------

- Python 3（用于开发服务器）
- Node.js（用于生成器与 Playwright）

运行查看器
--------------

.. code-block:: bash

  python tools/dev_server.py --root . --port 8000

然后打开：

.. code-block:: text

  http://127.0.0.1:8000/index.html?model=raj

安装 JS 依赖（Playwright + 工具链）
---------------------------------------------

依赖安装在仓库根目录：

.. code-block:: bash

  npm ci

重新生成已提交的产物
------------------------------

.. code-block:: bash

  npm run generate

这会运行：

- ``node tools/generate_ui_artifacts.mjs``
- ``node tools/generate_worker_protocol.mjs``

调试提示
-------------

- 详细日志/perf：
  - ``?log=1``（或 ``?verbose=1``）
- Strict 模式（除 allowlist 外，catch 点会重新抛出）：
  - ``?strict=1``
- 查看 Worker：
  - 在 Chromium DevTools 中：``Sources`` → ``Page`` → ``Workers``

Forge bundle 选择
----------------------

发布 demo 时，请始终用 commit SHA 固定 forge，并传入 ``forgeBase=...``。见 :doc:`/reference/compatibility`。
