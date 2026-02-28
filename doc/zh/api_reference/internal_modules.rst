内部模块索引（按文件）
======================

本页面是运行时关键模块及其导出 surface 的索引。若需要“机械式完整”的 exports 与声明（文件级 + 嵌套）清单（覆盖仓库范围），见 :doc:`code_inventory`。

核心运行时模块（dev/）
----------------------

``dev/main.nobuild.mjs``
  主入口点。组装 UI/store，启动 backend，安装 clock lanes，并驱动渲染。同时暴露 ``window.__PLAY_HOST__``。

``dev/viewer_backend.mjs``
  backend façade。导出 ``createBackend(...)``，并把 Worker 协议包装成 UI/插件更易用的 API。

  - 实现：``dev/backend/backend_core.mjs``

``dev/physics.worker.mjs``
  Worker 运行时：解析 forge dist，加载 MuJoCo/WASM，校验必需的 forge 导出，运行步进，并发出 events/snapshots。

  - 内部辅助：``dev/worker/snapshot_pool.mjs``

``dev/viewer_runtime.mjs``
  主线程与 worker 共享的运行时辅助函数：

  - URL 参数解析（``consumeViewerParams(...)`` 及各类 reader）
  - strict/compat/verbose/perf 辅助（``strictCatch``/``perfSample`` 等）
  - 日志辅助

``dev/main_ui.mjs``
  UI 与状态组装。导出：

  - ``createViewerStore(...)`` （viewer store）
  - ``createControlManager(...)`` （UI spec bindings）
  - ``applySpecAction(...)`` / ``applyGesture(...)`` （UI → backend 命令）
  - ``mergeBackendSnapshot(...)`` （snapshot → store 合并）

  该文件为稳定 façade 入口点（用于保持 import 路径稳定）；内部拆分模块位于 ``dev/ui/``。

``dev/main_renderer.mjs``
  Three.js renderer 与 controllers。导出：

  - ``createRendererManager(...)``
  - ``createCameraController(...)``
  - ``createPickingController(...)``

  该文件为稳定 façade 入口点（用于保持 import 路径稳定）；内部拆分模块位于 ``dev/renderer/``。

``dev/main_environment.mjs``
  Environment/sky 管理。导出：

  - ``createEnvironmentManager(...)``
  - ``pushSkyDebug(...)`` （开发/调试辅助）

``dev/bridge.mjs``
  forge/WASM bridge 辅助函数与一个小型 simulator wrapper：

  - heap view 辅助（``heapViewF64``/``heapViewF32`` 等）
  - ``collectRenderAssetsFromModule(...)``
  - ``MjSimLite`` （最小封装）

  - 实现：``dev/bridge/bridge_core.mjs``

拆分后的内部模块（dev 子模块）
------------------------------

仓库保留稳定的 façade 入口（``dev/*.mjs``），同时把巨型模块拆到 ``dev/**`` 下的子模块中。

UI 内部模块
  - ``dev/ui/ui_core.mjs``：聚合入口
  - ``dev/ui/state.mjs``：store/state/actions/snapshot merge
  - ``dev/ui/control_manager.mjs``：DOM 装配 + UI panels

Renderer 内部模块
  - ``dev/renderer/renderer_core.mjs``：聚合入口
  - ``dev/renderer/pipeline.mjs``：Three.js renderer pipeline + renderer manager
  - ``dev/renderer/controllers.mjs``：camera + picking controllers

Backend 内部模块
  - ``dev/backend/backend_core.mjs``：backend 实现

Bridge 内部模块
  - ``dev/bridge/bridge_core.mjs``：forge/WASM bridge 实现

Worker 内部模块
  - ``dev/worker/snapshot_pool.mjs``：snapshot pool 策略与状态

模块依赖方向（强制）
--------------------

Play 运行时是分层设计。``tools/check_module_boundaries.mjs``（可通过 ``node tools/run_checks.mjs`` 运行）
会强制一个粗粒度的依赖 DAG：

- ``base``：共享运行时工具（``dev/viewer_*.mjs``、``dev/xml_refs.mjs``、``dev/fallbacks.mjs``）
- ``bridge``：低层 forge/WASM helpers（``dev/bridge*.mjs``）
- ``protocol``：生成的 Worker 协议 glue（``dev/protocol.gen.mjs``、``dev/dispatch.gen.mjs``）
- ``worker``：physics worker（``dev/physics.worker.mjs``、``dev/worker/**``）
- ``backend``：主线程 backend wrapper（``dev/viewer_backend.mjs``、``dev/backend/**``）
- ``environment``：环境 preset + sky helpers（``dev/main_environment.mjs``）
- ``ui``：store + UI（``dev/main_ui.mjs``、``dev/ui/**``）
- ``renderer``：Three.js renderer + controllers（``dev/main_renderer.mjs``、``dev/renderer/**``）
- ``entry``：应用组装（``dev/main.nobuild.mjs``）

目标是隔离 worker/backend 语义，并避免 UI 与 renderer 互相依赖（renderer 不再 import UI）。

协议与生成辅助
--------------

``tools/worker_protocol.json``
  main ↔ worker 消息的 command/event IDL。

``dev/protocol.gen.mjs``
  生成的协议目录与 snapshot transfer 辅助函数。

``dev/dispatch.gen.mjs``
  生成的 encode/decode/dispatch 辅助函数，用于校验消息形状并拒绝未知 commands/events。

``dev/spec/ui_spec.json``
  UI spec 契约（control ids、fields、bindings）。

``dev/viewer_state_types.ts``
  viewer store state 的 TypeScript 定义（最完整的字段清单）。

``dev/viewer_structs.mjs`` / ``dev/viewer_shared.mjs`` / ``dev/viewer_defaults.mjs``
  struct layouts、defaults 与共享状态操作的生成/工具模块。

其它工具
--------

``dev/xml_refs.mjs``
  MJCF XML 文件引用解析与 bundle 构建（用于 ``loadXmlBundle(...)`` 相关流程）。

``dev/dev_server.py``
  小型 Python 开发服务器：提供静态文件并确保 ESM/WASM 的 MIME 类型正确。
