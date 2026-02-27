内部模块索引（按文件）
======================

本页面是运行时关键模块及其导出 surface 的索引。若需要“机械式完整”的 exports 与声明（文件级 + 嵌套）清单（覆盖仓库范围），见 :doc:`code_inventory`。

核心运行时模块（dev/）
----------------------

``dev/main.nobuild.mjs``
  主入口点。组装 UI/store，启动 backend，安装 clock lanes，并驱动渲染。同时暴露 ``window.__PLAY_HOST__``。

``dev/viewer_backend.mjs``
  backend façade。导出 ``createBackend(...)``，并把 Worker 协议包装成 UI/插件更易用的 API。

``dev/physics.worker.mjs``
  Worker 运行时：解析 forge dist，加载 MuJoCo/WASM，校验必需的 forge 导出，运行步进，并发出 events/snapshots。

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

``dev/main_renderer.mjs``
  Three.js renderer 与 controllers。导出：

  - ``createRendererManager(...)``
  - ``createCameraController(...)``
  - ``createPickingController(...)``

``dev/main_environment.mjs``
  Environment/sky 管理。导出：

  - ``createEnvironmentManager(...)``
  - ``pushSkyDebug(...)`` （开发/调试辅助）

``dev/bridge.mjs``
  forge/WASM bridge 辅助函数与一个小型 simulator wrapper：

  - heap view 辅助（``heapViewF64``/``heapViewF32`` 等）
  - ``collectRenderAssetsFromModule(...)``
  - ``MjSimLite`` （最小封装）

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
