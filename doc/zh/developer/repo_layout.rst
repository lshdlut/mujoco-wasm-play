仓库结构
===========

顶层目录
---------------------

- ``dev/``：静态 Web 应用（HTML + ESM 模块 + 资源 + vendored forge dist）
- ``tools/``：生成器以及小型 CI/维护脚本
- ``tests/``：Playwright 端到端测试与工具
- ``local_tools/``：仅本地使用的工具/产物（gitignored）

关键运行时入口点
-----------------------

- ``dev/index.html``：静态页面 + import map
- ``dev/main.nobuild.mjs``：主入口点（UI + renderer + Worker backend + Host API）
- ``dev/physics.worker.mjs``：Worker 入口点（加载 forge + 运行 MuJoCo）

关键运行时模块
-------------------

- ``dev/viewer_backend.mjs``：backend façade（稳定 import 路径）
  - 实现：``dev/backend/backend_core.mjs``
- ``dev/viewer_runtime.mjs``：日志、strict/compat/perf 辅助、URL 参数辅助
- ``dev/main_ui.mjs``：UI façade（稳定 import 路径）
  - 内部模块：``dev/ui/state.mjs`` + ``dev/ui/control_manager.mjs``
- ``dev/main_renderer.mjs``：renderer façade（稳定 import 路径）
  - 内部模块：``dev/renderer/pipeline.mjs`` + ``dev/renderer/controllers.mjs``
- ``dev/bridge.mjs``：bridge façade（稳定 import 路径）
  - 实现：``dev/bridge/bridge_core.mjs``
- ``dev/worker/snapshot_pool.mjs``：worker snapshot pool 策略与状态

已提交的生成产物
------------------------------

为了静态运行时与 GitHub Pages，生成文件会被提交到仓库。

- Worker protocol:
  - Source: ``tools/worker_protocol.json``
  - Generator: ``tools/generate_worker_protocol.mjs``
  - Outputs: ``dev/protocol.gen.mjs``, ``dev/dispatch.gen.mjs``

- UI artifacts / types:
  - Source: ``dev/spec/ui_spec.json`` (+ schema/index)
  - Generator: ``tools/generate_ui_artifacts.mjs``
  - Outputs (examples): ``dev/viewer_structs.mjs``, ``dev/viewer_state_types.ts``

Forge dist bundle（分发包）
---------------------------

本仓库可能在 ``dev/dist/<ver>/`` 下 vendor 一个或多个 forge bundle 以便本地/演示使用，但这些产物的构建流水线位于 forge 仓库（``mujoco-wasm-forge``）。
