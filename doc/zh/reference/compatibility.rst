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

- ``version.json``（可选；verbose/perf 模式下可用于诊断）

已验证的 forge 基线
----------------------

当前 Play 默认基线是 MuJoCo 3.8.1。

核心 CI 对 forge 3.6.0、3.7.0、3.8.0 与 3.8.1 保留了明确的外部 OBJ
mesh smoke。它覆盖 MuJoCo 3.6+ 引入的 resource decoder 注册路径，但不在
Play 侧添加 decoder workaround。

当旧版本仍存在于 ``dist/<ver>/`` 下时，ABI metadata 仍会被生成，以便已有的固定版本 demo 继续工作。

Viewer ABI 扩展
--------------------------------

Play 会校验已加载的 forge 模块是否导出了必需的 viewer ABI 集合。若缺少任何导出，Worker 会抛出错误并报告缺失的符号。

权威列表位于 ``worker/physics.worker.mjs``：

.. literalinclude:: ../../../worker/physics.worker.mjs
  :language: js
  :start-after: const required = [
  :end-before: const missing =

说明：

- 这是一个 *viewer* 契约（scene packing、vopt/camera/perturb 指针，以及 mjv 辅助函数）。
- 如果你自行构建 forge bundle，请确保启用了 viewer 扩展。

本地开发 vs 托管布局
---------------------------

当省略 ``forgeBase=`` 时，Play 会解析默认 forge base 模板并传播到 Worker：

- single 入口：``/forge/dist/{ver}/``
- pthreads 入口：``/forge/dist/{ver}/pthreads/``

本地开发服务器（``tools/dev_server.py``）会把 ``/forge/`` 挂载到同级的
``../mujoco-wasm-forge``（如果存在），否则回退到 Play 仓库根目录以支持本地镜像。

为了明确控制（发布 demo 时推荐），请始终传入 ``forgeBase=...`` 并将其固定到不可变的 forge commit。

Pthreads（SharedArrayBuffer）
----------------------------

如果你使用 pthreads 入口（``/pthreads/index.html``）：

- forge bundle 必须存在于 ``dist/<ver>/pthreads/``（至少包含 ``mujoco.js`` 与 ``mujoco.wasm``），并且
- 页面必须满足 cross-origin isolation（``crossOriginIsolated === true``），需要 COOP/COEP 头。

当缺少 cross-origin isolation 时，Play 会尽早硬失败并给出明确提示。
