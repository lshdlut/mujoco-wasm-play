Architecture
============

Play uses a Worker-first architecture to keep MuJoCo/WASM work off the main
thread.

Dataflow
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

Key boundaries
--------------

Worker backend:

- Runs MuJoCo and holds the WASM module instance.
- Owns the authoritative simulation state.
- Emits snapshot events (often containing TypedArray views).

Main thread:

- Owns UI state (panels, overlays, section collapse state, etc).
- Renders the 3D scene from snapshots.
- Hosts plugins.

Plugins:

- Run on the main thread.
- Must **not** assume direct access to WASM exports in Worker mode.
- Interact with the simulation via ``host.backend`` and snapshot streams.

Lifecycle
---------

1. Page loads → main module initializes state and UI.
2. Main spawns the Worker and subscribes to Worker events.
3. Worker loads forge ``dist/<ver>/`` (``mujoco.js`` + ``mujoco.wasm``) and
   validates required viewer ABI exports.
4. Worker emits ``ready`` → main thread finishes UI wiring and rendering.
5. During runtime:
   - main thread sends commands (run/pause, set fields/options, gestures)
   - worker emits snapshots and metadata events

For the authoritative command/event list, see
:doc:`/api_reference/worker_messages`.
