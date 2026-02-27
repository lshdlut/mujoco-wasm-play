Worker message protocol
=======================

Play uses a module Worker to run MuJoCo and communicate with the main thread.
Messages use ``postMessage`` and are validated/encoded by generated helpers.

Message shapes
--------------

- Commands (main → worker): objects with ``{ cmd: string, ...payload }``
- Events (worker → main): objects with ``{ kind: string, ...payload }``

The canonical protocol spec is the JSON IDL:

.. literalinclude:: ../../../tools/worker_protocol.json
  :language: json

Generated helpers
-----------------

``tools/generate_worker_protocol.mjs`` generates:

- ``dev/protocol.gen.mjs`` (lists, field specs)
- ``dev/dispatch.gen.mjs`` (encode/decode/dispatch helpers)

These modules:

- reject unknown command/event kinds
- assert required payload fields

Command/event catalogs
----------------------

The spec above is the single source of truth. For quick scanning, these are the
current catalogs:

Commands (main → worker):

.. code-block:: text

  strictReport, load, snapshot, setPaused, setRate, setSnapshotHz, setCameraMode,
  setField, setLabelMode, setFrameMode, setVisualOption, setVoptFlag, setSceneFlag,
  setGroupState, setCtrl, setQpos, setEqualityActive, historyScrub, historyConfig,
  keyframeSelect, keyframeSave, keyframeLoad, setWatch, step, reset, gesture,
  align, copyState, applyPerturb, setSelection, selectAt, setCtrlNoise

Events (worker → main):

.. code-block:: text

  strict_report, run_state, ready, struct_state, meta_cameras, meta_geoms,
  meta_joints, meta, snapshot, keyframes, history, watch, render_assets,
  gesture, align, copyState, options, selection, latency_probe, log, error
