加载模型
===========

最简单的方式是使用 ``model=`` URL 参数。

别名
-------

Play 为演示方便支持一小组别名：

- ``raj`` (Rajagopal2015)
- ``humanoid``
- ``humanoid100``
- ``cards``
- ``sensor``

示例：

.. code-block:: text

  /index.html?model=raj
  /index.html?model=cards

``dev/`` 下的路径
--------------------

你也可以传入 ``dev/`` 下的相对 MJCF 路径：

.. code-block:: text

  /index.html?model=model/cards/cards.xml

如果你省略 ``.xml`` 后缀，Play 会自动补上。

资产与文件引用
--------------------------

默认 loader 支持 **相对的、本地的** 文件引用，这些引用可以随静态托管一起打包（网格、纹理等）。

默认 loader 会刻意拒绝远程或绝对路径的文件引用。如果你需要自定义资产处理（远程拉取、带鉴权的端点、自定义映射等），请使用开发者 API：

- ``host.backend.loadXmlBundle(...)``

后端方法见 :doc:`/api_reference/js_api`。
