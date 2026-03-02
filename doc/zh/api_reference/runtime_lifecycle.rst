运行时生命周期（端到端）
========================

本页面把 Play 的运行时“过程”映射到具体的代码位置，目的是用可追溯的函数/模块引用来减少含糊的架构讨论。

入口点
------

主线程：

- ``index.html``：静态 HTML 外壳 + import map + mount 元素。
- ``app/main.mjs``：主入口点（UI 组装 + renderer + backend + 暴露插件 Host）。

Worker：

- ``worker/physics.worker.mjs``：module Worker 入口点（forge/WASM 加载 + MuJoCo 步进 + snapshots）。

后端模块：

- ``backend/backend_core.mjs``：导出 ``createBackend(...)``，用于启动 Worker，并向 UI/插件提供更高层 API。

启动序列
--------

1. **HTML 加载** ``app/main.mjs`` （ESM）。
2. **消费 URL/全局配置**：

   - URL 辅助函数在 ``core/viewer_runtime.mjs`` （``consumeViewerParams(...)``、
     ``buildWorkerUrl(...)``、strict/verbose 开关等）。
3. **创建 backend**：

   - ``app/main.mjs`` 调用 ``backend/backend_core.mjs`` 的
     ``createBackend(...)``。
   - backend 以 **module Worker** 的形式启动 ``worker/physics.worker.mjs``，并开始命令/事件握手。
4. **Worker 内解析并加载 forge dist**：

   - Worker 解析 forge ``dist/<ver>/`` 基址（来自 ``forgeBase=...`` 或本地回退）。
   - 动态导入 ``mujoco.js`` 并加载 ``mujoco.wasm``。
5. **Ready**：

   - Worker 发出 ``ready``。
   - 主线程完成 UI 连线并启动渲染循环。

命令/事件传输
-------------

主线程与 Worker 通过 ``postMessage`` 通信：

- 命令：main → worker，形如 ``{ cmd: string, ...payload }``。
- 事件：worker → main，形如 ``{ kind: string, ...payload }``。

协议的单一事实来源：

- ``tools/worker_protocol.json`` （IDL）。
  - 生成的运行时辅助模块：

  - ``worker/protocol.gen.mjs`` （列表 + 字段规范 + transfer 字段）
  - ``worker/dispatch.gen.mjs`` （encode/decode/dispatch）

见 :doc:`/api_reference/worker_messages`。

快照管线（Worker → Main）
-------------------------

高频状态通过 ``snapshot`` 事件投递。

Worker 侧：

- 内部运行步进（MuJoCo/WASM）。
- 发出 ``snapshot`` 事件，其中经常包含 TypedArray view，并通过 transfer list 避免拷贝。

主线程侧：

- 通过 backend 的订阅 API 接收 snapshots。
- 将 snapshot 字段合并进 viewer store：

  - ``mergeBackendSnapshot(...)`` 在 ``ui/state.mjs`` 中实现并导出。
  - ``app/main.mjs`` 也会维护一个 ``latestSnapshot`` 便于快速访问
    （并为调试暴露 ``window.__lastSnapshot``）。

UI tick 与“车道（lanes）”
-------------------------

Play 有意解耦：

- Worker 步进
- 快照投递（自适应，由 worker 驱动）
- UI 更新（为 DOM 工作提供节流的 lanes）

主入口点安装了一个小型 clock/订阅系统，提供：

- ``onSnapshot``：与 snapshot 对齐的工作（状态派生）
- ``onFrame``：渲染帧屏障（overlay commits / 逐帧动画）
- ``onUiTick`` / ``onUiMainTick``：普通 DOM 更新（默认 ~30Hz）
- ``onUiControlsTick``：用于昂贵控件同步的慢速 lane
- ``onUiSlowTick``：用于重型卡片/表格的慢速 lane

这些 hook 会通过 Host API 暴露给插件（见 :doc:`/reference/plugin_contract`）。

渲染管线
--------

渲染在主线程运行，由 snapshots + viewer state 驱动。

关键模块：

- ``renderer/pipeline.mjs`` 导出 ``createRendererManager(...)`` （场景 + 渲染循环）。
- ``renderer/controllers.mjs`` 导出：

  - ``createCameraController(...)`` （相机交互与同步）
  - ``createPickingController(...)`` （picking/selection）
- ``environment/environment.mjs`` 导出 ``createEnvironmentManager(...)`` （sky / environment 管理）。

renderer 会：

- 消费 snapshots（姿态、scene SoA 字段、render assets 等）。
- 更新 Three.js 场景对象与材质。
- 在渲染帧屏障处刷新 overlay3d commits，以保持 overlays 与 MuJoCo 场景同步。

模型加载（终端用户 vs 开发者）
--------------------------------------------------

终端用户：

- 使用 ``model=...`` 选择内置别名，或 ``model/`` 下的路径（本地私有文件可放到 ``local_model/``）。

开发者：

- 使用 ``host.backend.loadXmlText(...)`` 加载 raw XML 字符串。
- 使用 ``host.backend.loadXmlBundle(...)`` 显式提供 XML + 引用资产文件。

相关工具：

- ``core/xml_refs.mjs``：解析 MJCF 文件引用、构建虚拟 bundle 的辅助函数。
- ``bridge/``：forge/WASM heap 辅助函数，以及用于访问模块 heap 的 ``MjSimLite`` 封装。

插件生命周期（主线程）
----------------------

插件是动态导入的 ESM 模块，期望导出 ``registerPlayPlugin(host)`` （或默认导出）。

加载来源：

- URL 查询参数：``plugins=...``
- 全局变量：``globalThis.PLAY_PLUGINS = [...]`` （必须在主模块运行之前设置）

关于 mounts、UI 注入、overlay3d 与 Worker 边界约束，见 :doc:`/reference/plugin_contract`。

Strict 模式与诊断
-----------------

strict/verbose/perf 辅助函数在 ``core/viewer_runtime.mjs``：

- ``strictCatch(...)`` / ``strictEnsure(...)`` / ``strictOverride(...)``
- ``perfMark(...)`` / ``perfSample(...)`` / ``perfSummary()``
- 日志辅助（``logStatus``、``logWarn``、``logError``）

开发者调试全局变量见 :doc:`/reference/configuration`。
