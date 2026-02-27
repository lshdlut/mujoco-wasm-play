运行时配置
=====================

大部分配置通过 URL 参数完成（:doc:`url_parameters`）。本页面把开发者向的开关（URL 参数 + 非 URL 的全局变量）与调试 hook 集中记录在一起。

开发者 URL 参数
------------------------

这些 URL 参数主要用于调试与开发，并且可能随时间变化：

- ``strict=1``：除显式 allowlist 外，重新抛出大多数被捕获的错误。
- ``compat=1``：启用一小组（allowlist）兼容性回退行为。
- ``log=1`` / ``verbose=1`` / ``log=debug``：启用详细调试日志与性能插桩。
- ``debug=1``：在渲染器/UI 管线中启用额外调试行为。
- ``ui_ms=<16..2000>``：主 UI tick 间隔 clamp。
- ``ui_slow_ms=<200..10000>``：慢速 UI tick 间隔 clamp（用于重型卡片）。
- ``snapshot_hz_max=<30..120>``：自适应快照投递速率上界。
- ``snapshot=1`` / ``snapshot=debug``：启用快照调试模式（并保留 WebGL drawing buffer 以便检查）。
- ``nogeom=1``（别名：``no_geom``、``no-geom``、``hideall``、``hide_all``）：设置初始的“隐藏全部 geometry”渲染开关。
- ``forceBasic=1``：强制使用 basic materials（有助于调试光照/材质问题）。
- ``inst=0`` / ``instancing=0`` / ``noinst=1``：禁用 instanced rendering。
- ``tbins=<0|1|4|8|16>``：透明排序 bins。
- ``tmode=...``：透明排序模式（``nosort``/``fast``、``bins``，否则为 strict）。

全局变量（启动时读取）
----------------------------------

这些变量应在主模块运行 **之前** 设置（例如在导入应用之前的 script 标签中）：

- ``globalThis.PLAY_PLUGINS``: 插件 import specifier/URL 的数组 (``plugins=`` 查询参数的替代方案)。
- ``globalThis.PLAY_STRICT``: 强制开启/关闭 strict 模式 (覆盖 ``strict=``)。
- ``globalThis.PLAY_COMPAT``: 强制开启/关闭 compat 模式 (覆盖 ``compat=``)。
- ``globalThis.PLAY_VERBOSE_DEBUG``: 强制开启/关闭 verbose debug (覆盖 ``log=`` / ``verbose=``)。

渲染调试开关（启动时）
---------------------------------

- ``globalThis.PLAY_DISABLE_INSTANCING`` (boolean): 覆盖 instancing 是否启用。
- ``globalThis.PLAY_TRANSPARENT_BINS`` (number): 覆盖 ``tbins``。
- ``globalThis.PLAY_TRANSPARENT_SORT_MODE`` (string): ``strict`` / ``bins`` / ``nosort`` 之一 (覆盖 ``tmode``)。

运行时 hook / 调试全局变量
-----------------------------

这些偏开发者用途，可能会变化：

- ``window.__PLAY_HOST__``: 插件 Host API (见 :doc:`plugin_contract` 与 :doc:`/api_reference/plugin_api`)。
- ``window.__viewerStore``: viewer store 实例 (与 ``__PLAY_HOST__.store`` 为同一对象)。
- ``window.__viewerControls``: control-manager 的小型 façade。
- ``window.__viewerRenderer``: 渲染器辅助对象 (stats/context/overlay3d)。
- ``window.__lastSnapshot``: 主线程观察到的最新后端快照。
- ``window.__renderCtx``: renderer manager 的 context/debug 对象。
- ``window.PLAY_SNAPSHOT_DEBUG``: 是否启用快照调试模式。
- ``window.__snapshot``: 若设为 ``true``/``1``, 强制 WebGL ``preserveDrawingBuffer`` (用于截图/调试)。
- ``window.__envDebug`` / ``window.__skyDebug`` / ``window.__frameCounter``: 开发期间使用的渲染器/环境调试对象。
- ``window.__PLAY_DUMP_GEOMORDER()``: 调试 hook (取决于构建，可能是 stub)。

Strict/perf 辅助函数（开发者）
--------------------------------

在可用时，这些会被安装到 ``globalThis`` 上：

- ``__PLAY_STRICT_REPORT__()`` / ``__PLAY_STRICT_CLEAR__()``: strict-mode 事件记账。注意：当后端就绪时，主应用也会设置 ``__PLAY_STRICT_REPORT__`` 以包含 worker 报告 (``{ main, worker }``)。
- ``__PLAY_PERF_SUMMARY__()`` / ``__PLAY_PERF_CLEAR_SAMPLES__()``: 性能采样汇总与重置 (仅在启用 perf 时存在)。
