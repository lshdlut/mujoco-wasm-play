JavaScript API
==========================

本页面记录 UI 之外的、面向开发者的 JavaScript surface。

插件的主要入口点是 :doc:`plugin_api`：``window.__PLAY_HOST__``。

后端 API
-----------

后端实例暴露为：

- ``window.__PLAY_HOST__.backend``

它实现于 ``backend/backend_core.mjs``，并封装了一个 Worker，该 Worker 使用 :doc:`worker_messages` 定义的协议。

接口概览
----------------

这些方法当前存在，即使其中一些目前是 no-op。大多数方法会在发送命令后立即返回本地已知的最新 snapshot。

.. code-block:: ts

  interface Backend {
    kind: "worker";
    apply(payload: unknown): Promise<unknown>; // see below
    snapshot(): unknown;
    subscribe(fn: (snapshot: unknown) => void): () => void;
    step(direction?: number): Promise<unknown>;
    setCameraIndex(): Promise<unknown>; // currently a no-op
    setRunState(running: boolean, source?: string, notifyBackend?: boolean): unknown;
    setRate(rate: number, source?: string): unknown;
    applyPerturb(options: {
      phase: "begin" | "move" | "end";
      mode?: "rotate" | "translate";
      shiftKey?: boolean;
      reldx?: number;
      reldy?: number;
      bodyId?: number;
      localpos?: [number, number, number] | number[];
      scale?: number;
      cam?: { lookat?: [number, number, number] | number[]; distance?: number; azimuth?: number; elevation?: number; orthographic?: boolean };
    }): Promise<unknown>;
    setSelection(options: { bodyId: number; localpos?: [number, number, number] | number[] }): Promise<unknown>;
    selectAt(options: { relx: number; rely: number; aspect: number }): Promise<unknown>;
    setVisualState(payload: { visual?: object; sceneFlags?: boolean[] }): unknown;
    loadXmlText(xmlText: string): Promise<unknown>;
    loadXmlBundle(payload: { xmlText: string; xmlPath?: string; files?: Array<{ path: string; data: ArrayBuffer | ArrayBufferView }> }): Promise<unknown>;
    getStrictReport(): Promise<{ main: unknown; worker: unknown }>;
    getInitialModelInfo(): { token: string; file: string | null; label: string } | null;
    getBuiltinModels(): Array<{ file: string; label: string }>;
    dispose(): void;
  }

``apply`` payloads
-----------------------

``backend.apply(...)`` 主要接受两种 shape：

- UI apply：核心 UI 使用。插件在高级场景下也可以使用。

  .. code-block:: ts

    {
      kind: "ui";
      id: string;        // control id (e.g. "simulation.run")
      value: unknown;    // control value
      control?: object;  // optional control metadata
    }

- Gesture apply：高级用法。会被转发到 Worker。

  .. code-block:: ts

    {
      kind: "gesture";
      mode?: "rotate" | "translate" | "zoom" | "idle";
      phase?: "begin" | "move" | "update" | "end";
      pointer?: { x: number; y: number; dx?: number; dy?: number; buttons?: number; pressure?: number };
      drag?: { dx: number; dy: number };
      reldx?: number;
      reldy?: number;
      shiftKey?: boolean;
      cam?: { lookat?: number[]; distance?: number; azimuth?: number; elevation?: number; orthographic?: boolean };
      camSyncSeq?: number | null;
      gestureType?: string | null;
    }

模型加载 bundle
---------------------

``backend.loadXmlBundle(...)`` 会在调用辅助 loader 之前，将 XML 与引用的资产写入 forge/Emscripten 的虚拟 FS。

文件条目必须为：

- ``path``：POSIX 风格路径（使用 ``/`` 分隔符）
- ``data``：``ArrayBuffer`` 或 TypedArray view

调试全局变量
--------------

为便于开发调试，Play 还暴露了：

- ``window.__viewerStore``：与 ``__PLAY_HOST__.store`` 相同
- ``window.__viewerControls``：control-manager 实例
- ``window.__viewerRenderer``：renderer manager，包含 ``overlay3d`` 辅助
- ``window.__lastSnapshot``：主线程观察到的最新 snapshot

完整调试 hook 列表见 :doc:`/reference/configuration`。
