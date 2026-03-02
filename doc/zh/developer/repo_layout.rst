仓库结构
===========

顶层目录
---------------------

- ``app/``：主线程入口点 + Host contract 装配
- ``backend/``：Worker backend 封装（启动 Worker，对 UI/插件暴露更友好的 API）
- ``bridge/``：forge/WASM bridge 辅助（heap views、``MjSimLite``）
- ``core/``：共享运行时默认值/类型/URL 参数辅助/日志辅助
- ``environment/``：sky/environment 管理器
- ``renderer/``：renderer pipeline + controllers + overlays
- ``ui/``：UI store/state/actions + control manager + panels/sections
- ``worker/``：module Worker 入口点 + 生成的 protocol/dispatch
- ``assets/``：静态资源（例如 HDRIs）
- ``model/``：内置 demo 模型
- ``plugins/``：内置 demo 插件
- ``tools/``：生成器以及小型 CI/维护脚本
- ``tests/``：测试与工具（单元测试：``tests/unit/``；Playwright：``tests/e2e/``）
- ``local_tools/``：仅本地使用的工具/产物（gitignored）

关键运行时入口点
-----------------------

- ``index.html``：静态页面 + import map
- ``app/main.mjs``：主入口点（UI + renderer + Worker backend + Host API）
- ``worker/physics.worker.mjs``：Worker 入口点（加载 forge + 运行 MuJoCo）

关键运行时模块
-------------------

- ``backend/backend_core.mjs``：backend（``createBackend(...)``；封装 Worker 协议）
- ``core/viewer_runtime.mjs``：日志、strict/compat/perf 辅助、URL 参数辅助
- ``ui/state.mjs``：viewer store/state/actions + snapshot merge
- ``ui/control_manager.mjs``：DOM 装配 + UI panels/controls
- ``renderer/pipeline.mjs``：renderer pipeline + ``createRendererManager(...)``
- ``renderer/controllers.mjs``：camera + picking controllers
- ``environment/environment.mjs``：sky/environment 预设 + 运行时管理器
- ``bridge/heap_views.mjs`` / ``bridge/mj_sim_lite.mjs``：forge/WASM bridge 辅助
- ``worker/snapshot_pool.mjs``：worker snapshot pool 策略与状态

已提交的生成产物
------------------------------

为了静态运行时与 GitHub Pages，生成文件会被提交到仓库。

- Worker protocol:
  - Source: ``tools/worker_protocol.json``
  - Generator: ``tools/generate_worker_protocol.mjs``
  - Outputs: ``worker/protocol.gen.mjs``, ``worker/dispatch.gen.mjs``

- UI artifacts / types:
  - Source: ``spec/ui_spec.json`` (+ schema/index)
  - Generator: ``tools/generate_ui_artifacts.mjs``
  - Outputs (examples): ``core/viewer_structs.mjs``, ``core/viewer_state_types.ts``

Forge dist bundle（分发包）
---------------------------

本仓库可能在 ``dist/<ver>/`` 下 vendor 一个或多个 forge bundle 以便本地/演示使用，但这些产物的构建流水线位于 forge 仓库（``mujoco-wasm-forge``）。
