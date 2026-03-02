JavaScript API
==========================

This page documents developer-facing JavaScript surfaces beyond the UI.

The primary entrypoint for plugins is :doc:`plugin_api`: ``window.__PLAY_HOST__``.

Backend API
-----------

The backend instance is exposed as:

- ``window.__PLAY_HOST__.backend``

It is implemented in ``backend/backend_core.mjs`` and wraps a Worker that speaks
the protocol defined in :doc:`worker_messages`.

Interface summary
-----------------

These methods exist today, even if some are currently no-ops. Most methods
return the latest locally-known snapshot immediately after sending a command.

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

``backend.apply(...)`` accepts two main shapes:

- UI apply: used by core UI. Plugins may use it for advanced cases.

  .. code-block:: ts

    {
      kind: "ui";
      id: string;        // control id (e.g. "simulation.run")
      value: unknown;    // control value
      control?: object;  // optional control metadata
    }

- Gesture apply: advanced. Forwarded to the Worker.

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

Model loading bundles
---------------------

``backend.loadXmlBundle(...)`` writes the XML and referenced assets into the
forge/Emscripten virtual FS before calling the helper loader.

File entries must be:

- ``path``: a POSIX-style path (``/`` separators)
- ``data``: an ``ArrayBuffer`` or a TypedArray view

Debug globals
-------------

For developer debugging, Play also exposes:

- ``window.__viewerStore``: same as ``__PLAY_HOST__.store``
- ``window.__viewerControls``: control-manager instance
- ``window.__viewerRenderer``: renderer manager, including ``overlay3d`` helpers
- ``window.__lastSnapshot``: latest snapshot observed on the main thread

See :doc:`/reference/configuration` for the full list of debug hooks.
