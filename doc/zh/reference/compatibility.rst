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

当前 Play 默认基线是 MuJoCo 3.15.0。

核心 CI 包含 forge 3.6.0 至 3.15.0 的外部 OBJ mesh smoke，保留 3.8.1 基线。
3.15.0 另有 single-thread 和隔离 pthreads 的带纹理 bundle、Reload、仿真控制、
加载失败与恢复、资产错误传播及中断请求回归。中间版本的 mesh smoke 不代表完整功能或性能认证。

``loadXmlText`` / ``loadXmlBundle`` 在编译、有效初始 snapshot 和所需 render assets
交付后完成；替换模型或 dispose 会拒绝未完成请求。Reload 重放 XML 路径及所有引用文件。

``ver`` 用于选择 bundle 位置，显式 ``forgeBase`` 可覆盖该位置。typed ABI 根据已加载引擎的
``mj_versionString`` 读取，snapshot 的 ``engineVersion`` 可核对真实版本。

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

控制与保存状态兼容性
------------------------------------

当 native model 定义了 ``nactuator`` 时，actuator metadata 使用它；scalar
control buffer 与 range 仍使用 ``nu``。控制面板根据 native
``actuator_ctrladr``/``actuator_ctrlnum`` 映射每个 scalar slot，并使用
``mj_actuatorInputName`` 标注输入。旧的 single-input model 仍保持每个 actuator 一个 slot。
支持时，Clear all 调用 native ``mj_resetCtrl``，包括 identity-quaternion neutral input；
旧的 single-input 版本重置为零值。

历史记录与自定义 keyframe 使用从已加载 Forge metadata 生成的官方
``mjSTATE_INTEGRATION`` enum，其中包括 plugin state。但提供的 Forge bundle 不含可执行的
stateful-plugin fixture，因此不覆盖非零第三方 plugin-state round trip。MuJoCo IPC multiplier
不在 native state 规范覆盖范围内，history playback 与 custom saved state 不保证精确 IPC replay。

Integrator 选项遵循 native enum metadata；加载到 ``discrete`` 时只显示该值，不修改模型 integrator。
经典模型灯光使用有效 ambient/diffuse RGB，不乘 photometric intensity。Play 保留现有 point-light
扩展（native classical rendering 忽略 point/image lights）；photometric rendering 与完整视觉 parity
尚未实现。非零、非单位 photometric intensity 的模型在该修正后可能出现视觉差异；零值或单位值的
经典模型保留原有 RGB scaling。
