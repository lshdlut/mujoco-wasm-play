以静态文件托管
====================

Play 是一个静态 Web 应用。任何静态托管（GitHub Pages、Nginx、S3 + CDN 等）都可以，只要满足一些基本要求。

MIME 类型
----------

这些必须正确，否则浏览器会拒绝加载模块/WASM：

- ``.mjs`` / ``.js`` → ``text/javascript; charset=utf-8``
- ``.wasm`` → ``application/wasm``

如果你看到 Worker 或模块加载失败，请在 DevTools 的 Network 中检查响应的 ``Content-Type``。

CORS（使用远程 ``forgeBase`` 时）
--------------------------------------

如果 ``forgeBase=`` 指向不同的 origin，forge 托管端必须为以下资源允许 CORS：

- ``mujoco.js``
- ``mujoco.wasm``
- ``version.json`` (optional but recommended)

缓存
-------

开发时通常最安全的做法是禁用缓存（``Cache-Control: no-store``），以避免由于 Worker/模块缓存过期或不一致导致的困惑行为。

生产/演示托管时，推荐使用不可变 URL（用 commit SHA 固定 forge），并配合长生命周期的缓存头。

内置开发服务器是一个不错的参考实现：``dev/dev_server.py``。
