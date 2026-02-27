兼容性
=============

本页面定义以下三者之间的兼容性契约：

- Play (this repo)
- forge dist bundles (``mujoco-wasm-forge`` outputs)
- browsers (module Workers + WASM)

浏览器
--------

Play 需要：

- 主线程支持 ES modules
- **module Workers** (``new Worker(url, { type: 'module' })``)
- WebAssembly

大多数现代版本的 Chromium/Firefox/Safari 都满足这些要求。

Forge dist bundle 要求
-----------------------------

Play 期望 forge 的 ``dist/<ver>/`` 目录至少包含：

- ``mujoco.js`` (ESM-capable loader)
- ``mujoco.wasm``

推荐（可选）：

- ``version.json`` (用于缓存标记与诊断)

Viewer ABI 扩展（必需）
--------------------------------

Play 会校验已加载的 forge 模块是否导出了必需的 viewer ABI 集合。若缺少任何导出，Worker 会抛出错误并报告缺失的符号。

权威列表位于 ``dev/physics.worker.mjs``：

.. literalinclude:: ../../../dev/physics.worker.mjs
  :language: js
  :start-after: const required = [
  :end-before: const missing =

说明：

- 这是一个 *viewer* 契约（scene packing、vopt/camera/perturb 指针，以及 mjv 辅助函数）。
- 如果你自行构建 forge bundle，请确保启用了 viewer 扩展。

本地开发 vs 托管布局
---------------------------

当省略 ``forgeBase=`` 时，Worker 会使用本地回退布局：

- 在 ``localhost`` / ``127.0.0.1``：会尝试 ``/mujoco-wasm-forge/dist/<ver>/``（如果存在同级 forge 检出，则由 ``dev/dev_server.py`` 挂载）
- 否则：会尝试应用相对路径 ``dev/dist/<ver>/``

为了明确控制（发布 demo 时推荐），请始终传入 ``forgeBase=...`` 并将其固定到不可变的 forge commit。
