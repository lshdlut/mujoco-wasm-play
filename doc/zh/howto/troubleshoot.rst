故障排查
============

本页面按症状组织。如果你正在发布一个 demo，建议先验证 MIME 类型、CORS 以及 forge bundle 的 URL 是否正确。

空白页 / 模块加载失败
----------------------------------

- 确认 ``.mjs`` 以 JavaScript 形式提供（而不是 ``text/plain``）。
- 确认托管端支持 ESM（不要对 ``.mjs`` 做 HTML 重写/代理）。

Worker 无法加载 ``mujoco.wasm``
------------------------------------

最常见原因：

- ``.wasm`` 的 ``Content-Type`` 错误（必须是 ``application/wasm``）
- 使用远程 ``forgeBase=`` 时缺少 CORS 响应头
- ``mujoco.js`` 与 ``mujoco.wasm`` 的缓存不一致（使用不可变的 forge URL；调试时可追加 ``cacheBust=always``）

Forge ABI 缺少导出
-------------------------

如果你看到类似错误：

.. code-block:: text

  [forge] Missing viewer ABI exports ...

你的 forge bundle 并未启用 Play 所需的 viewer 扩展。请使用兼容的 forge 构建（或更新你所指向的 forge commit/version）。

插件无法加载
--------------------

- 确保插件是 ESM 模块，并以正确的 JavaScript MIME 类型提供。
- 对于跨域插件 URL，确保启用了 CORS。
- 在 Console 中查看 ``[plugins] load failed`` 日志。

性能异常缓慢
--------------------------------

- 浏览器扩展可能会显著影响 Worker/WASM 的计时。
- 保持标签页在前台，并关闭“效率/省电”模式。
- 对比 ``localhost`` 与 GitHub Pages；站点级策略可能不同。

Strict 模式报错
--------------------

如果启用 ``strict=1``, 大部分被捕获的错误（不在 allowlist 中）会被重新抛出。面向最终用户的 demo 建议使用 ``strict=0`` (默认)，strict 更适合调试/模糊测试场景。
