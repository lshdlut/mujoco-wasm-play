MuJoCo WASM Play
================

MuJoCo WASM Play 是一个静态的、基于浏览器的 MuJoCo 查看器，把 *MuJoCo Simulate* 的工作流带到 Web：打开一个 URL 就能开始模拟。

Play 面向终端用户：加载模型、运行/暂停/单步、查看选项与统计信息，并分享可复现的链接。

在线演示
--------

`在线演示（Rajagopal2015, MuJoCo 3.4.0） <https://lshdlut.github.io/mujoco-wasm-play/index.html?model=raj&forgeBase=https://cdn.jsdelivr.net/gh/lshdlut/mujoco-wasm-forge@3a963f1cd3379e10e63f6c5f5c7d6d9006aa3680/dist/3.4.0/>`_

快速开始
----------------

在本地服务仓库根目录，然后打开一个 URL：

::

  python tools/dev_server.py --root . --port 8000
  http://127.0.0.1:8000/index.html?model=raj

亮点
----

* 浏览器里的 Simulate 风格 UI（面板与控件）。
* 可分享、可复现的链接：通过 URL 参数（``model=``、``forgeBase=``）。
* 性能优先的运行时：MuJoCo 在 Worker 中运行；内置 HUD（按 ``F2``）展示 CPU 耗时与统计信息。
* 可扩展：插件可添加可折叠区块、面板动作和 3D overlay（见 :doc:`reference/plugin_contract`）。

从这里开始
----------

.. toctree::
  :maxdepth: 2

  user_guide/index
  howto/index
  reference/index
  faq

面向开发者
--------------

.. toctree::
  :maxdepth: 2

  developer/index
  api_reference/index
  contributing
  changelog
