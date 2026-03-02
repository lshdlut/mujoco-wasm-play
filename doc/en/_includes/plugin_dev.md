# Plugin Development Contract

Status: experimental. This surface may change.

This repo supports optional, external plugins that can inject UI/behavior without forking `mujoco-wasm-play`.

This document defines:
- Stable DOM mounts: where plugins render UI.
- The Host API: `window.__PLAY_HOST__`, plus clock semantics.
- The worker boundary: where MuJoCo/forge runs, and how to extend the worker protocol for new WASM ABI calls.
- Data-flow expectations: snapshots vs. events, plus refresh-rate guidelines.

## Key Constraints: Worker Backend

The default entrypoint is `index.html` → `app/main.mjs`. It runs MuJoCo/forge inside a Web Worker.

Implications:
- UI plugins run on the main thread and **cannot** directly access WASM exports. In worker mode there is no `window.__forgeModule`.
- Any new ABI, for example `mjwf_smocap_*` or `mjwf_sik_*`, must be invoked inside the worker and exposed to plugins via worker RPC or via data written into existing snapshot fields.

## Loading plugins

Plugins are loaded via dynamic `import()` and must be ESM.

Supported configuration:
- Query parameter: `?plugins=<url1>,<url2>`
- Global. Must be set before the main module runs: `globalThis.PLAY_PLUGINS = ['<url1>', '<url2>']`

Example: local dev loading the built-in demo plugin:
- `http://127.0.0.1:8000/index.html?model=raj&plugins=./plugins/test_ui_sections_plugin.mjs`

Notes:
- Each entry must be a valid ESM module URL/specifier for `import()`.
- For cross-origin URLs, the server must allow CORS and serve JavaScript with a correct MIME type.
- Import specifiers that start with `./` or `../` are resolved relative to the repo root, i.e. the `index.html` folder.

Plugin load failures are reported via `logError` + `strictCatch(..., { allow: true })` and do not stop the main app.

## Stable DOM mounts

Plugins should render only into the plugin mounts, or use `host.ui.sections.register(...)` for first-class foldable sections. Avoid directly mutating the core panel mounts.

Plugin mounts:
- `host.mounts.leftPanelPlugin`: left panel plugin area
- `host.mounts.rightPanelPlugin`: right panel plugin area, intended for complex demo UI
- `host.mounts.leftPanelAfterFilePlugin`: left panel slot rendered immediately after the built-in `File` section. Preferred for "File → Plugin → Option" UX.
- `host.mounts.overlayRoot`: viewer overlay root, such as progress bars, status cards, and HUD overlays

Core mounts. Owned by the viewer:
- `host.mounts.leftPanel`
- `host.mounts.rightPanel`

HTML source of these mounts:
- `index.html` uses `data-play-mount="leftPanel|rightPanel|overlayRoot|leftPanelPlugin|rightPanelPlugin"`.
- `ui/control_manager.mjs` inserts `data-play-mount="leftPanelAfterFilePlugin"` immediately after rendering the built-in `File` section.

## Host API

At runtime the viewer exposes `window.__PLAY_HOST__` and passes the same object into each plugin register function.

### `host.store`

State container with:
- `host.store.get(): State`
- `host.store.update((state) => void): void`
- `host.store.replace(nextState): void`
- `host.store.subscribe((state) => void): () => void`

Guidance:
- Read current viewer state such as panels/overlays, hud, rendering options.
- Write demo-specific state under a dedicated namespace, for example `state.demo.<yourDemoName>`.

### `host.backend`

Backend instance. In `app/main.mjs` it is worker-only.

Typical methods used by plugins:
- `host.backend.apply(...)`: send UI/apply commands
- `host.backend.subscribe((snapshot) => void)`: raw snapshot stream
- `host.backend.snapshot()`: fetch latest snapshot
- `host.backend.loadXmlText(xmlText)` / `host.backend.loadXmlBundle(...)`: reload model
- `host.backend.step(n)` / `host.backend.setRate(rate)` / `host.backend.setRunState(running, source?)`

Important:
- In worker mode, plugins **must not** rely on reading WASM exports directly; always go through `backend` and/or snapshots.
- The backend surface may evolve; prefer feature-detecting optional calls via `typeof host.backend.foo === 'function'`.

### `host.controls`

Convenience helpers around the built-in UI spec:
- `host.controls.toggleControl(id, value?)`
- `host.controls.listIds(prefix?)`
- `host.controls.getControl(id)`
- `host.controls.loadXmlTextAsModel(xmlText, label?)`

Control IDs and shortcuts come from `spec/ui_spec.json`.

### `host.ui`

Plugins should **prefer `host.ui`** over hand-rolling foldable blocks or mutating core panel DOM.

#### Panel actions

- `host.ui.panel('left').collapseAll()`
- `host.ui.panel('left').expandAll()`
- `host.ui.panel('left').toggleAll()`
- `host.ui.panel('right')...`: same

These actions operate on all Play sections inside the selected panel, including built-in and plugin sections, and persist collapsed state.

Collapsed state persistence:
- Storage: `localStorage` key `play:ui:v1:section_collapsed`
- Keying: based on `panel` and `sectionId`, so left/right can share names without fighting
- Precedence: saved state > `defaultOpen` / `default_open` > open

#### Registering sections

Create a native-behaving foldable section without copying header logic:

- `host.ui.sections.register({ panel, sectionId, title, defaultOpen, after, before, mount, render })`

Notes:
- `sectionId` **must** be namespaced and start with `plugin:`. Example: `plugin:sik_c3d`.
- `after`/`before` insert relative to existing `sectionId`s within the same panel.
- For the common "insert after File" case, use `panel: 'left', after: 'file'` or `mount: 'leftPanelAfterFilePlugin'`.
- If `mount` is provided, for example `leftPanelPlugin` or `rightPanelPlugin`, it must match `panel`. Play also infers `panel` from `mount` if `panel` is omitted.

The `render(body, ctx)` callback receives:
- `body`: the `.section-body` element to populate
- `ctx`: `{ panel, sectionId, sectionEl, body, host }`
If `render(...)` returns a function or `{ dispose() }`, Play calls it on `unregister(...)`.

Unregister:
- `host.ui.sections.unregister(sectionId)`

#### Data attribute contract

Advanced. Manual DOM.

If you build foldable sections manually, this is not recommended. Play only treats elements as sections if they expose stable `data-play-*` attributes:

- Section root: `data-play-role="section"` + `data-play-section-id="..."`
- Header: `data-play-role="section-header"`. Double-click triggers panel expand/collapse-all via event delegation.
- Toggle button: `data-play-role="section-toggle"`. aria-expanded is managed by Play.
- Body: `data-play-role="section-body"`

#### UI kit

Optional primitives.

Small DOM helpers that match Play styling patterns:

- `host.ui.kit.namedRow(labelText)` → `{ row, label, field }`
- `host.ui.kit.fullRow()` → `{ row, field }`
- `host.ui.kit.button({ label, variant, testId, onClick })`
- `host.ui.kit.textbox({ value, placeholder, testId, onInput, onChange })`
- `host.ui.kit.textarea({ value, placeholder, rows, variant, testId, onInput, onChange })` (`variant: 'default'|'code'`)
- `host.ui.kit.select({ value, options, testId, onChange })`
- `host.ui.kit.number({ value, min, max, step, testId, onInput, onChange })`
- `host.ui.kit.range({ value, min, max, step, testId, onInput, onChange })`
- `host.ui.kit.segmented({ options, value, testId, onChange })` → `{ root, inputs, value(), setValue(v) }`
- `host.ui.kit.codebox({ value, testId })` (`<pre class="codebox">`)
- `host.ui.kit.boolButton({ label, value, disabled, testId, onChange })` → `{ root, input, text }`

### `host.renderer`

Renderer helpers:
- `host.renderer.getContext()`
- `host.renderer.ensureLoop()`
- `host.renderer.renderScene(snapshot, state)`
- `host.renderer.getStats()`

### `host.renderer.overlay3d`

The viewer provides a formal, plugin-friendly 3D overlay system that renders directly in the Three.js world scene.

Goals:
- Let plugins draw *world-occluded* primitives/meshes without going through the worker → `mjvScene` path.
- Provide stable **layer semantics** such as world vs HUD, plus a formal **transparency policy** so plugins don't fight over `renderOrder`/`depthWrite`.
- Provide a scoped **AssetRegistry**. It is refcounted and auto-released on scope dispose to prevent GPU/memory leaks and accidental shared-resource frees.

Entry points:
- `host.renderer.getOverlay3D()` → returns the overlay manager. Returns `null` if renderer is not ready.
- `host.renderer.overlay3d.get()` → same as above
- `host.renderer.overlay3d.createScope(scopeId, options?)` → convenience wrapper: `get()` + `createScope`
- `host.renderer.overlay3d.getScope(scopeId)` → convenience wrapper: `get()` + `getScope`

#### Layers

Each scope has per-layer roots. These strings are used in the APIs below:
- `worldOpaque`: normal world objects, depth-tested, intended for opaque materials
- `worldTransparent`: normal world objects intended for alpha blending, depth-tested; depth-write defaults to off when opacity < 1
- `worldOverlay`: world-occluded overlays that should draw after the base world, for example selection highlights and gizmos
- `hud`: always-on-top overlays, depth-test defaults to off

#### Instanced primitives

Use instancing for lots of lightweight primitives such as markers and arrows. This is the recommended path for large counts.

`scope.createInstancedMeshBatch({ ... })` returns:
- `batch.writer.pos`: `Float32Array`, length = `capacity * 3`
- `batch.writer.quat`: `Float32Array`, length = `capacity * 4`, quaternion xyzw
- `batch.writer.scale`: `Float32Array`, length = `capacity * 3`
- `batch.writer.rgb`: `Float32Array`, length = `capacity * 3`, linear rgb multipliers
- `batch.commit({ count })`: latches author buffers; flushed atomically at the frame barrier
- `batch.setTransparency(spec)`: updates transparency policy and sorting

Commit is **deferred**: it does not immediately upload to the GPU. Play flushes all pending overlay commits
once per render frame, after the core MuJoCo scene update. The frame hook comes from `host.clock.onFrame`.
As a result, overlays never get
ahead/behind the model pose.

Key options:
- `primitive`: `'sphere' | 'box' | 'cylinder' | 'capsule' | 'cone'`. Shared geometry via AssetRegistry.
- `capacity`: max instances in this batch
- `layer`: one of the layer ids above
- `transparency`: policy object, see below

#### Transparency policy

Transparent instancing is a system-level problem: instances are not automatically depth-sorted by Three.js.
The overlay system provides an explicit policy surface to avoid per-plugin hacks.

`transparency` fields. Supported on `createInstancedMeshBatch` and `batch.setTransparency`:
- `mode`: `'opaque' | 'blend'`. Defaults to `'blend'` for `worldTransparent`, else `'opaque'`.
- `opacity`: `0..1`. When `< 1`, enables blend mode.
- `sortMode`: `'nosort' | 'bins' | 'strict' | 'inherit'`
  - `nosort`: no per-instance ordering; fastest
  - `bins`: coarse depth bins; good default for large counts
  - `strict`: per-instance depth sort; best quality, higher CPU cost
- `bins`: `1..16`. Used when `sortMode='bins'`.
- `update`: `'commit' | 'frame' | 'inherit'`
  - `commit`: sort/upload only when `commit()` is flushed. This is the frame barrier.
  - `frame`: also re-sorts when the camera moves. This comes from the render-loop hook.
- `every`: integer `>= 1`. When `update='frame'`, only resort every N frames.
- `depthTest`, `depthWrite`, `toneMapped`: advanced material toggles, optional

Global defaults for new batches:
- `overlay = host.renderer.overlay3d.get()`
- `overlay.setTransparencyDefaults({ sortMode, bins, update, every })`

#### Assets

Each scope exposes `scope.assets` helpers. Handles acquired through `scope.assets.*` are auto-released when the scope is disposed.

Useful helpers:
- `scope.assets.geometryPrimitive(kind)` → `{ asset: BufferGeometry, release() }`
- `scope.assets.texture2DFromUrl(url, options?)` → `{ asset: Texture, release() }`
- `scope.assets.acquire(key, createFn, { dispose? })` → generic refcounted asset handle

#### Example: instanced transparent markers

```js
export function registerPlayPlugin(host) {
  const overlay = host.renderer.overlay3d.get();
  const scope = overlay.createScope('demo:markers');

  const batch = scope.createInstancedMeshBatch({
    primitive: 'sphere',
    capacity: 2000,
    layer: 'worldTransparent',
    transparency: { mode: 'blend', opacity: 0.35, sortMode: 'bins', bins: 8, update: 'frame' },
  });

  const { pos, quat, scale, rgb } = batch.writer;
  const tmp = { x: 0, y: 0, z: 0 };

  const off = host.clock.onFrame(() => {
    const n = 2000;
    for (let i = 0; i < n; i += 1) {
      const p = i * 3;
      pos[p + 0] = (i % 50) * 0.05;
      pos[p + 1] = Math.floor(i / 50) * 0.05;
      pos[p + 2] = 0.2;
      scale[p + 0] = 0.01;
      scale[p + 1] = 0.01;
      scale[p + 2] = 0.01;
      rgb[p + 0] = 1;
      rgb[p + 1] = 0.2;
      rgb[p + 2] = 0.2;
      const q = i * 4;
      quat[q + 0] = 0;
      quat[q + 1] = 0;
      quat[q + 2] = 0;
      quat[q + 3] = 1;
    }
    batch.commit({ count: n });
  });

  return () => {
    off();
    scope.dispose();
  };
}
```

### `host.getSnapshot`

Signature: `host.getSnapshot()`

Returns the last snapshot currently held by the UI thread (may be `null` during initial load).

### `host.clock`

Time hooks for different workloads:
- `host.clock.onSnapshot(fn)`: called after each backend snapshot merges into the store (`fn({ snapshot, state, nowMs })`).
- `host.clock.onFrame(fn)`: render-frame barrier (`fn({ snapshot, state, nowMs, frame })`, can be 60Hz+).
- UI lanes (throttled; intended for DOM/UI work):
  - `host.clock.onUiMainTick(fn)` (alias: `onUiTick`): main UI tick (default `ui_ms=33`, not snapshot-aligned).
  - `host.clock.onUiControlsTick(fn)`: slower UI lane used for expensive control syncing (interval = `max(ui_ms, 120ms)`, quantized by the UI main tick).
  - `host.clock.onUiSlowTick(fn)`: slow UI lane for heavy cards/tables (default `ui_slow_ms=1000`, quantized by the UI main tick).

Recommended usage:
- Use `onSnapshot` for snapshot-aligned logic/state derivation.
- Use `onFrame` for render-visible work (overlay commits, per-frame animation).
- Use `onUiMainTick`/`onUiTick` for ordinary DOM updates (labels, cards, progress bars).
- Use `onUiControlsTick` for expensive DOM work that does not need 30–60Hz.
- Use `onUiSlowTick` for very heavy UI work (1–5Hz).

### Logging and error reporting

Plugins should use the host logging utilities:
- `host.logStatus(...)`, `host.logWarn(...)`, `host.logError(...)`
- `host.strictCatch(err, context, { allow?: boolean })`

## Plugin Module Contract

A plugin module should export either:
- `export function registerPlayPlugin(host) { ... }`, or
- `export default function (host) { ... }`

The register function may optionally return:
- a disposer function `() => { ... }`, or
- an object with `dispose()`

Disposers are called on page unload (`beforeunload`). Plugins should clean up:
- `store.subscribe()` unsubscribers
- `clock.on*()` unsubscribers
- DOM event listeners
- timers / `requestAnimationFrame` loops

## Worker protocol extensions

If your demo needs new functionality implemented inside the forge WASM (e.g. smocap/SIK), you will need a worker RPC surface.

### Why this is required

In worker backend mode, MuJoCo/forge is instantiated and owned by the worker (`worker/physics.worker.mjs`). The main thread cannot access WASM exports, pointers, or heaps. Therefore any new ABI calls must be:
1) invoked inside the worker, and
2) driven by commands sent from the main thread, and
3) observed either via existing snapshots (preferred) or via new events (when needed).

### Protocol is generated and validated

The worker command/event allow-list lives in generated files:
- `worker/protocol.gen.mjs` (command/event lists + field schemas + transfer fields)
- `worker/dispatch.gen.mjs` (runtime validation/dispatch)

Do not edit these by hand. Update the generator and re-run it:
- Generator: `tools/generate_worker_protocol.mjs`
- Regenerate: `npm run generate:protocol`

### Where to implement new commands/events

Typical touch points:
- Worker handlers: `worker/physics.worker.mjs` (add a new handler under the command dispatch map).
- Main-thread wrapper: `backend/backend_core.mjs` (expose a method on `backend` and/or route through `backend.apply`).
- Optional store merge: `ui/state.mjs` (only if you want to reflect worker snapshots/events into `store` in a structured way).

### Design rules

Recommended.

- Prefer writing results into `mjData` so they naturally show up in existing snapshots.
  - Example: if smocap produces target poses, write to mocap bodies, qpos, ctrl, etc.
- Use a dedicated event (low frequency) for “debug/status” data that is not part of sim state:
  - error code + message, solver residuals, active marker list, etc.
- Keep payloads structured-clone friendly: primitives, plain objects/arrays, and TypedArrays.
- For large binary payloads, use `ArrayBuffer`/TypedArrays and transfer buffers in `postMessage(..., [buffer])` to avoid copies.

## Data Flow: Snapshots vs. Events

The main high-frequency data channel is the worker `snapshot` event. Many snapshot fields are TypedArrays and are transferred (zero-copy) via `postMessage` transfer lists.

Guidance for demos:
- If you can express your feature by updating sim state (mjData/mjModel-dependent state), do that in worker and consume it from snapshots on the UI side.
- Only add custom events when you need extra data that:
  - is not part of `mjData`/render state, and/or
  - is too expensive/large to ship every snapshot.

If you do add a new snapshot field, you must also consider:
- whether it should be included in the snapshot transfer list (to avoid copies),
- and whether it affects snapshot size/latency (especially at 60–120Hz).

## Refresh rate guidance

This viewer intentionally decouples:
- physics stepping (worker internal tick) and
- snapshot delivery (adaptive snapshotHz) and
- DOM updates (UI tick, default ~30Hz).

Recommended tiers:
- Simulation/pose rendering: follow snapshotHz (adaptive; worker controlled).
- Main UI panel updates: ~30Hz (`onUiMainTick`/`onUiTick` + change detection).
- Control-heavy UI sync: ~8Hz (`onUiControlsTick`, default `max(ui_ms, 120ms)`).
- Heavy status cards / debug tables: 1–5Hz (`onUiSlowTick`, default `ui_slow_ms=1000`).

Useful URL parameters:
- `ui_ms=<16..2000>`: UI tick interval in milliseconds.
- `ui_slow_ms=<200..10000>`: slower UI interval used by some built-in cards.

## Forge Dist / Custom WASM Artifacts

To consume a custom forge build (e.g. MuJoCo + smocap extensions), use:
- `forgeBase=<dist-base-url>` (query parameter), or
- `window.__FORGE_DIST_BASE__` (must be set before the main module runs).

In worker mode, the worker URL inherits `forgeBase` from the page URL at spawn time. Switching forge artifacts at runtime is not currently part of the stable plugin contract; expect to reload the page when changing `forgeBase`.

## Minimal Example

```js
export function registerPlayPlugin(host) {
  const root = host.mounts.rightPanelPlugin;
  const card = document.createElement('section');
  card.className = 'plugin-card';
  card.textContent = 'Hello from plugin';
  root.appendChild(card);

  const onUiMain = host.clock.onUiMainTick || host.clock.onUiTick;
  const off = onUiMain(({ state }) => {
    card.dataset.run = state?.simulation?.run ? '1' : '0';
  });

  return () => {
    off();
    card.remove();
  };
}
```

## References

- Mounts and layout: `index.html`
- Host API + plugin loader: `app/main.mjs`
- Backend implementation (worker spawn, subscription API): `backend/backend_core.mjs`
- Store snapshot merge helpers: `ui/state.mjs` (`mergeBackendSnapshot`)
- Worker runtime (MuJoCo/forge owner): `worker/physics.worker.mjs`
- Protocol generator: `tools/generate_worker_protocol.mjs`
- Built-in UI controls + shortcuts: `spec/ui_spec.json`
- Overlay implementation (scopes/layers/transparency/assets): `renderer/overlay3d.mjs` (`ensureOverlay3D`)
