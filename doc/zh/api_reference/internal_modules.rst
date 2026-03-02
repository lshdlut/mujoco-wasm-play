内部模块索引
======================

本页面是运行时关键模块及其导出 surface 的索引。若需要“机械式完整”的 exports 与声明清单，包含文件级与嵌套声明，并覆盖仓库范围，见 :doc:`code_inventory`。

核心运行时模块
--------------

``app/main.mjs``
  主入口点。组装 UI/store，启动 backend，安装 clock lanes，并驱动渲染。同时暴露 ``window.__PLAY_HOST__``。

  - Host contract 辅助：``app/play_host.mjs``

``backend/backend_core.mjs``
  主线程 backend。导出 ``createBackend(...)``，并把 Worker 协议包装成 UI/插件更易用的 API。

``worker/physics.worker.mjs``
  Worker 运行时：解析 forge dist，加载 MuJoCo/WASM，校验必需的 forge 导出，运行步进，并发出 events/snapshots。

  - 内部辅助：
    - ``worker/snapshot_pool.mjs``

``core/viewer_runtime.mjs``
  主线程与 worker 共享的运行时辅助函数：

  - URL 参数解析：``consumeViewerParams(...)`` 及各类 reader
  - strict/compat/verbose/perf 辅助：``strictCatch``/``perfSample`` 等
  - 日志辅助

``ui/state.mjs``
  viewer store/state/actions 与 snapshot merge。导出：

  - ``createViewerStore(...)``：viewer store
  - ``applySpecAction(...)`` / ``applyGesture(...)``：UI → backend 命令
  - ``mergeBackendSnapshot(...)``：snapshot → store 合并

``ui/control_manager.mjs``
  DOM 装配与 controls/panels 渲染。导出 ``createControlManager(...)``。

  - 文件/模型 section 辅助：``ui/file_section.mjs``

``renderer/pipeline.mjs``
  Three.js renderer pipeline 与 renderer manager。导出 ``createRendererManager(...)``，以及少量供 controllers 复用的相机辅助函数。

  - Scene-SoA 几何/instancing/material 辅助：``renderer/scene_soa_geoms.mjs``

``renderer/controllers.mjs``
  输入 controllers：camera + picking。导出：

  - ``createCameraController(...)``
  - ``createPickingController(...)``

``environment/environment.mjs``
  Environment/sky 管理。导出：

  - ``createEnvironmentManager(...)``
  - ``pushSkyDebug(...)``：开发/调试辅助

``bridge/``
  forge/WASM bridge 辅助函数与一个小型 simulator wrapper 位于 ``bridge/`` 目录下：

  - heap view 辅助：``heapViewF64``/``heapViewF32`` 等
  - ``collectRenderAssetsFromModule(...)``
  - ``MjSimLite``：最小封装

拆分后的内部模块
----------------

仓库把巨型运行时模块拆到各自的顶层目录下；主入口会直接 import 这些子模块。

UI 内部模块
  - ``ui/state.mjs``：store/state/actions/snapshot merge
  - ``ui/bindings.mjs``：binding spec 解析 + 值归一化辅助
  - ``ui/panel_sections.mjs``：section 折叠状态持久化 + DOM 辅助
  - ``ui/file_section.mjs``：文件/模型加载 + model picker UI
  - ``ui/control_manager.mjs``：DOM 装配 + UI panels

Renderer 内部模块
  - ``renderer/pipeline.mjs``：Three.js renderer pipeline + renderer manager
  - ``renderer/controllers.mjs``：camera + picking controllers
  - ``renderer/overlay3d.mjs``：overlay3d 管理器：scopes + batches
  - ``renderer/three_helpers.mjs``：共享 Three.js helpers：dispose, bounds, scene
  - ``renderer/depth_sort.mjs``：depth/transparency 排序 helpers
  - ``renderer/mujoco_shadows.mjs``：MuJoCo shadow-map 贴近 Simulate 的辅助
  - ``renderer/mujoco_constants.mjs``：MuJoCo enums/constants
  - ``renderer/mujoco_textures.mjs``：MuJoCo textures + 生成 texcoords 的辅助
  - ``renderer/deformables.mjs``：flex/skin mesh 辅助
  - ``renderer/scene_soa_geoms.mjs``：Scene-SoA 几何/instancing/material 辅助，从 pipeline 拆出

Backend 内部模块
  - ``backend/backend_core.mjs``：backend 实现
  - ``backend/snapshot_utils.mjs``：backend snapshot 辅助函数
  - ``backend/model_candidates.mjs``：内建 model aliases + candidate 解析

Bridge 内部模块
  - ``bridge/heap_views.mjs``：typed heap views 与 C-string 辅助
  - ``bridge/render_assets_collect.mjs``：从 forge module 提取 render-assets
  - ``bridge/mj_sim_lite.mjs``：``MjSimLite`` 封装

Worker 内部模块
  - ``worker/snapshot_pool.mjs``：snapshot pool 策略与状态

模块依赖方向
--------------------

Play 运行时是分层设计。``tools/check_module_boundaries.mjs`` 会强制一个粗粒度的依赖 DAG。
可通过 ``node tools/run_checks.mjs`` 运行：

- ``base``：共享运行时工具。``core/viewer_*.mjs``、``core/xml_refs.mjs``、``core/fallbacks.mjs``、``app/play_host.mjs``
- ``bridge``：低层 forge/WASM helpers。``bridge/*.mjs``
- ``protocol``：生成的 Worker 协议 glue。``worker/protocol.gen.mjs``、``worker/dispatch.gen.mjs``
- ``worker``：physics worker。``worker/physics.worker.mjs``、``worker/**``
- ``backend``：主线程 backend。``backend/**``
- ``environment``：环境 preset 与 sky helpers。``environment/environment.mjs``
- ``ui``：store + UI。``ui/**``
- ``renderer``：Three.js renderer + controllers。``renderer/**``
- ``entry``：应用组装。``app/main.mjs``

目标是隔离 worker/backend 语义，并避免 UI 与 renderer 互相依赖。renderer 不再 import UI。

协议与生成辅助
--------------

``tools/worker_protocol.json``
  main ↔ worker 消息的 command/event IDL。

``worker/protocol.gen.mjs``
  生成的协议目录与 snapshot transfer 辅助函数。

``worker/dispatch.gen.mjs``
  生成的 encode/decode/dispatch 辅助函数，用于校验消息形状并拒绝未知 commands/events。

``spec/ui_spec.json``
  UI spec 契约：control ids、fields、bindings。

``core/viewer_state_types.ts``
  viewer store state 的 TypeScript 定义。这里是最完整的字段清单。

``core/viewer_structs.mjs`` / ``core/viewer_shared.mjs`` / ``core/viewer_defaults.mjs``
  struct layouts、defaults 与共享状态操作的生成/工具模块。

其它工具
--------

``core/xml_refs.mjs``
  MJCF XML 文件引用解析与 bundle 构建，用于 ``loadXmlBundle(...)`` 相关流程。

``tools/dev_server.py``
  小型 Python 开发服务器：提供静态文件并确保 ESM/WASM 的 MIME 类型正确。
