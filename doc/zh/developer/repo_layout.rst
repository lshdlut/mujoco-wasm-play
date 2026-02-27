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

- ``dev/viewer_backend.mjs``：backend façade（启动 Worker，将 UI/手势动作翻译为命令）
- ``dev/viewer_runtime.mjs``：日志、strict/compat/perf 辅助、URL 参数辅助
- ``dev/main_ui.mjs``：UI spec 组装、store、control manager、分区行为
- ``dev/main_renderer.mjs``：Three.js renderer manager 与 overlay3d 系统
- ``dev/bridge.mjs``：forge/WASM bridge 辅助（FS 写入、typed view、资产）

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
