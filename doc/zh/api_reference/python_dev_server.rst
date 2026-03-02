Python 开发服务器
=================

Play 内置了一个用于本地开发的小型 Python HTTP 服务器：

.. code-block:: bash

  python tools/dev_server.py --root . --port 8000

功能
------------

- 在 ``--root`` 下提供静态文件服务。
- 确保以下扩展名的 MIME 类型正确：
  - ``.mjs`` / ``.js`` → JavaScript
  - ``.wasm`` → ``application/wasm``
- 添加安全/缓存相关响应头：
  - ``X-Content-Type-Options: nosniff``
  - ``Cache-Control`` (dev-friendly defaults)
- 挂载稳定前缀：
  - ``/mujoco-wasm-play/`` → 仓库根目录
  - ``/mujoco-wasm-forge/`` → 同级 forge 仓库（若存在）

环境变量
---------------------

- ``PLAY_DEV_SERVER_DEBUG_MOUNTS=1``：将 mount/path 调试日志打印到 stderr。

权威实现
---------------

见 ``tools/dev_server.py``。
