URL 参数
==============

Play 主要通过 URL 查询参数进行配置。参数在主线程解析，并（对后端相关的开关）传播到 Worker。

本页面偏向终端用户，只记录最常用的开关。

布尔 token
--------------

对于布尔参数，Play 接受以下 token（不区分大小写）：

- true：``1``、``true``、``yes``、``on``
- false：``0``、``false``、``no``、``off``

对于详细日志，也接受 ``log=debug``。

参数列表
----------

.. list-table::
  :header-rows: 1
  :widths: 18 10 12 10 50

  * - 键
    - 类型
    - 默认值
    - 作用域
    - 说明

  * - ``model``
    - string
    - 内置默认值
    - main → worker (load)
    - ``model/`` 下的 MJCF 路径（本地私有文件可放到 ``local_model/``），或内置别名（例如 ``raj``、``cards``）。

  * - ``forgeBase``
    - string (URL)
    - （自动）
    - main → worker
    - forge ``dist/<ver>/`` 的 base URL（必须包含 ``mujoco.js`` 与 ``mujoco.wasm``）。
      若省略，Worker 会使用本地开发布局。

  * - ``ver``
    - string
    - ``site_config.js``（``PLAY_VER``）
    - main → worker
    - MuJoCo/forge dist 的版本 token。用于展开默认 forge base 模板中的 ``{ver}``
      （``/forge/dist/{ver}/``），并传播到 Worker 用于诊断信息。

  * - ``plugins``
    - string list
    - empty
    - main
    - 以逗号分隔的 ESM ``import()`` specifier/URL 列表。每个条目都会通过动态 ``import()`` 加载。
      相对 specifier（``./``/``../``）相对于仓库根目录（与 ``index.html`` 同级的目录）解析。

  * - ``embed``
    - bool
    - false
    - main
    - 面向 iframe/容器托管的嵌入模式。Play 会按父容器尺寸布局，而不是强制使用 ``100vh``，
      其余运行时行为与默认面板可见性保持不变。

  * - ``theme``
    - string
    - dark
    - main
    - 初始 UI 主题。支持 ``dark`` 与 ``light``。

  * - ``font``
    - string
    - ``100``
    - main
    - 初始 UI 字号预设。支持 ``50``、``75``、``100``、``150``、``200``，
      与内置字体选择器的百分比档位一致。

开发者/调试参数
--------------------------

Play 还支持一批开发者/调试用的 URL 参数（strict 模式、verbose 日志、渲染器调试、tick-rate clamp 等）。为避免本页过于“开发者向”，这些参数统一记录在 :doc:`configuration`。

其中一个常用的调试开关：

- ``cacheBust=always``：强制对 Worker URL 与 forge 资源 URL 做 cache-bust（添加 ``cb=...``）。
  默认模式不会自动添加 ``cb``。

已弃用 / 保留参数
--------------------------------

这些参数会被运行时识别，但当前处于弃用/内部使用状态，或对用户无可见效果：

- ``mode=...``：已弃用并被忽略（Play 仅支持 Worker 模式）。
- ``cb=...``：内部 cache-bust 参数（仅在启用 ``cacheBust=always`` 时使用）。
- ``hide`` / ``dump`` / ``find`` / ``hide_big`` / ``big_n`` / ``big_factor`` / ``hide_index``：会被旧参数解析器解析，但当前不会应用。
