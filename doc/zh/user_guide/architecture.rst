架构
============

Play 使用以 Worker 为中心（Worker-first）的架构，把 MuJoCo/WASM 的工作从主线程移开。

数据流（概念）
---------------------

.. code-block:: text

   +-------------------------------+     postMessage      +------------------------------+
   | Main thread                   | <------------------> | Worker (MuJoCo + forge)      |
   |                               |                      |                              |
   | - UI panels (Simulate-style)  |   commands/events    | - loads dist/<ver>/mujoco.js |
   | - Plugin host API             | ------------------>  | - runs mujoco.wasm           |
   | - Three.js renderer           |  <------------------ | - emits snapshots (typed arr)|
   |                               |                      |                              |
   +-------------------------------+                      +------------------------------+

关键边界
--------------

Worker 后端：

- 运行 MuJoCo，并持有 WASM 模块实例。
- 持有权威的仿真状态。
- 发出快照事件（通常包含 TypedArray 视图）。

主线程：

- 持有 UI 状态（面板、覆盖层、分区折叠状态等）。
- 从快照渲染 3D 场景。
- 承载插件。

插件：

- 在主线程运行。
- 在 Worker 模式下 **不能** 假设可直接访问 WASM 导出。
- 通过 ``host.backend`` 与快照流与仿真交互。

生命周期
---------

1. 页面加载 → 主模块初始化状态与 UI。
2. 主线程启动 Worker，并订阅 Worker 事件。
3. Worker 加载 forge ``dist/<ver>/``（``mujoco.js`` + ``mujoco.wasm``），并校验必需的 viewer ABI 导出。
4. Worker 发出 ``ready`` → 主线程完成 UI 连线与渲染。
5. 运行期间：
   - 主线程发送命令（运行/暂停、设置字段/选项、手势）
   - Worker 发出快照与元数据事件

如需权威的命令/事件列表，请见 :doc:`/api_reference/worker_messages`。
