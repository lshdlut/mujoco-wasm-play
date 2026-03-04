以静态文件托管
====================

Play 是一个静态 Web 应用。任何静态托管（GitHub Pages、Nginx、S3 + CDN 等）都可以，只要满足一些基本要求。

MIME 类型
----------

这些必须正确，否则浏览器会拒绝加载模块/WASM：

- ``.mjs`` / ``.js`` → ``text/javascript; charset=utf-8``
- ``.wasm`` → ``application/wasm``

如果你看到 Worker 或模块加载失败，请在 DevTools 的 Network 中检查响应的 ``Content-Type``。

CORS
--------------------------------------

如果 ``forgeBase=`` 指向不同的 origin，forge 托管端必须为以下资源允许 CORS：

- ``mujoco.js``
- ``mujoco.wasm``
- ``version.json`` (optional but recommended)

缓存
-------

开发时通常最安全的做法是禁用缓存（``Cache-Control: no-store``），以避免由于 Worker/模块缓存过期或不一致导致的困惑行为。

本仓库自带的开发服务器（``tools/dev_server.py``）是刻意偏向开发体验的：

- 对 ``.mjs``/``.js``/``.wasm`` 发送 ``Cache-Control: no-store``（避免不小心跑到旧代码），并且
- 对 ESM/WASM 禁用条件缓存（始终返回 200 且带响应体）。

因此在本地开发环境里，刷新或切换模型往往会 *显得更慢*，因为浏览器无法复用缓存的模块/WASM。

Play 默认是缓存友好的：

- 除非你显式设置 ``cacheBust=always``，否则不会自动给 Worker URL 添加 ``cb=...``。

生产/演示托管时应当反过来：推荐使用不可变 URL（用 commit SHA 固定 forge），并配合长生命周期的缓存头（最好带 ``immutable``）。

``version.json`` 是可选项。Play 可能会在开启 verbose/perf 日志时用 ``no-store`` 拉取它用于诊断，但它不是正确缓存所必需的。

内置开发服务器是一个不错的参考实现：``tools/dev_server.py``。
