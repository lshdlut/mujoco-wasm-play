Worker 消息协议
=======================

Play 使用 module Worker 来运行 MuJoCo，并与主线程通信。消息通过 ``postMessage`` 传递，并由生成的辅助代码完成校验/编码。

消息形状
--------------

- 命令（main → worker）：形如 ``{ cmd: string, ...payload }`` 的对象
- 事件（worker → main）：形如 ``{ kind: string, ...payload }`` 的对象

权威协议规范是 JSON IDL：

.. literalinclude:: ../../../tools/worker_protocol.json
  :language: json

生成的辅助代码
-----------------

``tools/generate_worker_protocol.mjs`` generates:

- ``worker/protocol.gen.mjs`` (lists, field specs)
- ``worker/dispatch.gen.mjs`` (encode/decode/dispatch helpers)

这些模块会：

- 拒绝未知的 command/event kind
- 断言 payload 中的必需字段存在

命令/事件目录
----------------------

上述 spec 是单一事实来源。为了快速浏览，下面是当前目录：

命令（main → worker）：

.. code-block:: text

  strictReport, load, snapshot, setPaused, setRate, setSnapshotHz, setCameraMode,
  setField, setLabelMode, setFrameMode, setVisualOption, setVoptFlag, setSceneFlag,
  setGroupState, setCtrl, setQpos, setEqualityActive, historyScrub, historyConfig,
  keyframeSelect, keyframeSave, keyframeLoad, setWatch, step, reset, gesture,
  align, copyState, applyPerturb, setSelection, selectAt, setCtrlNoise

事件（worker → main）：

.. code-block:: text

  strict_report, run_state, ready, struct_state, meta_cameras, meta_geoms,
  meta_joints, meta, snapshot, keyframes, history, watch, render_assets,
  gesture, align, copyState, options, selection, latency_probe, log, error
