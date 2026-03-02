本地运行
===========

使用仓库内置的 Python 开发服务器为仓库根目录提供静态文件服务：

.. code-block:: bash

  python tools/dev_server.py --root . --port 8000

打开：

.. code-block:: text

  http://127.0.0.1:8000/index.html?model=raj

Forge bundle 解析
-----------------------

Play 需要一个 forge ``dist/<ver>/`` bundle（``mujoco.js`` + ``mujoco.wasm``）。

开发服务器会挂载：

- ``/mujoco-wasm-play/`` → 本仓库根目录
- ``/mujoco-wasm-forge/`` → 同级目录的 ``../mujoco-wasm-forge`` 检出（如果存在）

因此在 ``localhost`` 上，Play 可从以下路径拉取 forge 工件：

.. code-block:: text

  /mujoco-wasm-forge/dist/<ver>/

如果你想指向不同的 bundle，可传入 ``forgeBase=``：

.. code-block:: text

  http://127.0.0.1:8000/index.html?model=raj&forgeBase=../dist/3.4.0/

完整说明见 :doc:`/reference/url_parameters`。
