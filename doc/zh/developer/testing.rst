测试
=======

端到端
-----------------------

Playwright 安装在仓库根目录（见 ``package.json``）。

安装依赖：

.. code-block:: bash

  npm ci

运行一个小型 smoke test：

.. code-block:: bash

  npm run smoke

运行完整的 E2E 套件：

.. code-block:: bash

  npm run test:e2e

环境变量
---------------------

Playwright 配置支持：

- ``PLAYWRIGHT_PORT`` / ``PLAYWRIGHT_HOST`` / ``PLAYWRIGHT_BASE_URL``
- ``PYTHON_EXE``（或 ``PYTHON``），用于选择开发服务器所用的 Python 解释器

默认配置会自动启动 ``tools/dev_server.py``。

规范/工具检查
-------------------

- ``npm run spec:lint``：校验 UI spec 契约
- ``npm run ci:guard``：运行基于模式的 guard（见 ``tools/forbid_patterns.mjs``）
- ``node tools/run_checks.mjs``：运行一套快速本地检查（guards + 模块边界 + Node 单元测试 + 语法检查）

Node 单元测试
---------------

仓库在 ``tests/unit/`` 下提供了一小套无需额外依赖的 Node 测试。

.. code-block:: bash

  node --test tests/unit/*.test.mjs
