界面与操作
===============

Play 尽量复刻 *MuJoCo Simulate* 的布局（在可行范围内尽量 1:1 复制）：

- **左侧面板**：文件/模型加载、较高层级的仿真控制、查看器选项。
- **右侧面板**：与模型相关的控制（actuators/joints/equalities）以及每个模型的密集数据。
- **覆盖层**：帮助/信息/Profiler 卡片、视窗内 HUD 统计信息（FPS、每步耗时 ms/step、内存、求解器统计等）以及短暂的 toast 提示。

具体快捷键与面板可能会演进；目标是“与 Simulate 尽量一致（parity）”。

分区行为
----------------

UI 面板由 **可折叠分区** 组成（内置分区与插件分区）。

- 折叠状态会保存在 ``localStorage`` 中的 ``play:ui:v1:section_collapsed``（按 ``(panel, sectionId)`` 区分）。
- 插件应通过 ``host.ui.sections.register(...)`` 注册分区，以获得原生行为（折叠状态、面板动作、样式）。

手势与选取
----------------------

鼠标/触摸手势（旋转/平移/缩放）以及选取会被转发到 Worker 后端。插件可观察并响应：

- ``host.backend.subscribe((snapshot) => ...)``
- ``host.clock.onSnapshot(({ snapshot, state }) => ...)``

关于插件 UI 原语与稳定挂载点（mount），见 :doc:`/reference/plugin_contract`。
