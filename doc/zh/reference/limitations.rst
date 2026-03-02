限制
===========

仅 Worker 后端
-------------------

Play 当前在 module Worker 中运行 MuJoCo。旧的 ``mode=...`` 查询参数已弃用并被忽略。

插件边界
---------------

插件在主线程运行，且不能假设可直接访问 WASM 导出（Worker 模式下没有 ``window.__forgeModule``）。请使用 ``host.backend`` 与快照流。

模型资产引用
----------------------

默认 loader 支持打包 **本地的、相对的** 文件引用。远程/绝对引用默认会被拒绝。

如果你需要更高级的资产加载，请使用 ``host.backend.loadXmlBundle(...)``。

网络依赖（Three.js CDN）
-----------------------------------

``index.html`` 通过 import map 从 CDN 导入 Three.js。离线部署时应将 Three.js vendor 到本地，并相应更新 import map。

保留参数与调试 hook
-----------------------------------

部分 URL 参数与全局变量用于调试或未来工作，可能在当前构建中没有效果。见 :doc:`url_parameters` 与 :doc:`configuration`。
