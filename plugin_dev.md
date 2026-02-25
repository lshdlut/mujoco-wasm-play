# Plugin Development Contract (Experimental)

This repo supports optional, external plugins that can inject UI/behavior without forking `mujoco-wasm-play`.

This document defines:
- Stable DOM mounts (where plugins render UI).
- The Host API (`window.__PLAY_HOST__`) and clock semantics.
- The worker boundary (where MuJoCo/forge runs) and how to extend the worker protocol for new WASM ABI calls.
- Data-flow expectations (snapshots vs. events) and refresh-rate guidelines.

## Key Constraints (Worker Backend)

The default entrypoint (`dev/index.html` -> `dev/main.nobuild.mjs`) runs MuJoCo/forge inside a Web Worker.

Implications:
- UI plugins run on the main thread and **cannot** directly access WASM exports (no `window.__forgeModule` in worker mode).
- Any new ABI (e.g., `mjwf_smocap_*`, `mjwf_sik_*`) must be invoked inside the worker and exposed to plugins via worker RPC (commands/events) or via data written into existing snapshot fields.

## Loading Plugins

Plugins are loaded via dynamic `import()` (ESM only).

Supported configuration:
- Query parameter: `?plugins=<url1>,<url2>`
- Global (must be set before the main module runs): `globalThis.PLAY_PLUGINS = ['<url1>', '<url2>']`

Example (local dev): load the built-in demo plugin:
- `http://127.0.0.1:8000/index.html?model=raj&plugins=./plugins/test_ui_sections_plugin.mjs`

Notes:
- Each entry must be a valid ESM module URL/specifier for `import()`.
- For cross-origin URLs, the server must allow CORS and serve JavaScript with a correct MIME type.
- Import specifiers that start with `./` or `../` are resolved relative to `dev/main.nobuild.mjs` (i.e., under `dev/`).

Plugin load failures are reported via `logError` + `strictCatch(..., { allow: true })` and do not stop the main app.

## Stable DOM Mounts

Plugins should render only into the plugin mounts, or use `host.ui.sections.register(...)` for first-class foldable sections. Avoid directly mutating the core panel mounts.

Plugin mounts:
- `host.mounts.leftPanelPlugin`: left panel plugin area
- `host.mounts.rightPanelPlugin`: right panel plugin area (intended for complex demo UI)
- `host.mounts.leftPanelAfterFilePlugin`: left panel slot rendered immediately after the built-in `File` section (preferred for "File → Plugin → Option" UX)
- `host.mounts.overlayRoot`: viewer overlay root (progress bars, status cards, HUD overlays)

Core mounts (owned by the viewer):
- `host.mounts.leftPanel`
- `host.mounts.rightPanel`

HTML source of these mounts:
- `dev/index.html` uses `data-play-mount="leftPanel|rightPanel|overlayRoot|leftPanelPlugin|rightPanelPlugin"`.
- `dev/main_ui.mjs` dynamically inserts `data-play-mount="leftPanelAfterFilePlugin"` after rendering the `File` section.

## Host API (`window.__PLAY_HOST__`)

At runtime the viewer exposes `window.__PLAY_HOST__` and passes the same object into each plugin register function.

### `host.store`

State container with:
- `host.store.get(): State`
- `host.store.update((state) => void): void`
- `host.store.replace(nextState): void`
- `host.store.subscribe((state) => void): () => void`

Guidance:
- Read current viewer state (panels/overlays, hud, rendering options).
- Write demo-specific state under a dedicated namespace (recommend: `state.demo.<yourDemoName>`).

### `host.backend`

Backend instance (worker-only in `main.nobuild.mjs`).

Typical methods used by plugins:
- `host.backend.apply(...)` (send UI/apply commands)
- `host.backend.subscribe((snapshot) => void)` (raw snapshot stream)
- `host.backend.snapshot()` (fetch latest snapshot)
- `host.backend.loadXmlText(xmlText)` / `host.backend.loadXmlBundle(...)` (reload model)
- `host.backend.step(n)` / `host.backend.setRate(rate)` / `host.backend.setRunState(running, source?)`

Important:
- In worker mode, plugins **must not** rely on reading WASM exports directly; always go through `backend` and/or snapshots.
- The backend surface may evolve; prefer feature-detecting (`typeof host.backend.foo === 'function'`) for optional calls.

### `host.controls`

Convenience helpers around the built-in UI spec:
- `host.controls.toggleControl(id, value?)`
- `host.controls.listIds(prefix?)`
- `host.controls.getControl(id)`
- `host.controls.loadXmlTextAsModel(xmlText, label?)`

Control IDs and shortcuts come from `dev/spec/ui_spec.json`.

### `host.ui` (UI sections + kit)

Plugins should **prefer `host.ui`** over hand-rolling foldable blocks or mutating core panel DOM.

#### Panel actions

- `host.ui.panel('left').collapseAll()`
- `host.ui.panel('left').expandAll()`
- `host.ui.panel('left').toggleAll()`
- `host.ui.panel('right')...` (same)

These actions operate on all Play sections inside the selected panel (built-in + plugin sections) and persist collapsed state.

Collapsed state persistence:
- Storage: `localStorage` key `play:ui:v1:section_collapsed`
- Keying: per `(panel, sectionId)` (so left/right can share names without fighting)
- Precedence: saved state > `defaultOpen` / `default_open` > open

#### Registering sections (foldable blocks)

Create a native-behaving foldable section without copying header logic:

- `host.ui.sections.register({ panel, sectionId, title, defaultOpen, after, before, mount, render })`

Notes:
- `sectionId` **must** be namespaced and start with `plugin:` (example: `plugin:sik_c3d`).
- `after`/`before` insert relative to existing `sectionId`s within the same panel.
- For the common "insert after File" case, use `panel: 'left', after: 'file'` or `mount: 'leftPanelAfterFilePlugin'`.
- If `mount` is provided (`leftPanelPlugin`, `rightPanelPlugin`, ...), it must match `panel` (Play also infers `panel` from `mount` if `panel` is omitted).

The `render(body, ctx)` callback receives:
- `body`: the `.section-body` element to populate
- `ctx`: `{ panel, sectionId, sectionEl, body, host }`
If `render(...)` returns a function (or `{ dispose() }`), Play calls it on `unregister(...)`.

Unregister:
- `host.ui.sections.unregister(sectionId)`

#### Data attribute contract (advanced / manual DOM)

If you build foldable sections manually (not recommended), Play only treats elements as sections if they expose stable `data-play-*` attributes:

- Section root: `data-play-role="section"` + `data-play-section-id="..."`
- Header: `data-play-role="section-header"` (double-click triggers panel expand/collapse-all via event delegation)
- Toggle button: `data-play-role="section-toggle"` (aria-expanded is managed by Play)
- Body: `data-play-role="section-body"`

#### UI kit (optional primitives)

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

### `host.renderer.overlay3d` (3D Overlay / Plugin 3D Layer)

The viewer provides a formal, plugin-friendly 3D overlay system that renders directly in the Three.js world scene.

Goals:
- Let plugins draw *world-occluded* primitives/meshes without going through the worker → `mjvScene` path.
- Provide stable **layer semantics** (world vs HUD) and a formal **transparency policy** so plugins don't fight over `renderOrder`/`depthWrite`.
- Provide a scoped **AssetRegistry** (refcounted, auto-released on scope dispose) to prevent GPU/memory leaks and accidental shared-resource frees.

Entry points:
- `host.renderer.getOverlay3D()` → returns the overlay manager (or `null` if renderer not ready)
- `host.renderer.overlay3d.get()` → same as above
- `host.renderer.overlay3d.createScope(scopeId, options?)` → convenience wrapper (`get()` + `createScope`)
- `host.renderer.overlay3d.getScope(scopeId)` → convenience wrapper (`get()` + `getScope`)

#### Layers

Each scope has per-layer roots (strings used in the APIs below):
- `worldOpaque`: normal world objects (depth-tested; intended for opaque materials)
- `worldTransparent`: normal world objects intended for alpha blending (depth-tested; depth-write defaults to off when opacity < 1)
- `worldOverlay`: world-occluded overlays that should draw after the base world (selection highlights, gizmos)
- `hud`: always-on-top overlays (depth-test defaults to off)

#### Instanced Primitives (SoA writer + commit)

Use instancing for lots of lightweight primitives (markers/arrows/etc). This is the recommended path for large counts.

`scope.createInstancedMeshBatch({ ... })` returns:
- `batch.writer.pos` (`Float32Array`, length = `capacity * 3`)
- `batch.writer.quat` (`Float32Array`, length = `capacity * 4`, quaternion xyzw)
- `batch.writer.scale` (`Float32Array`, length = `capacity * 3`)
- `batch.writer.rgb` (`Float32Array`, length = `capacity * 3`, linear rgb multipliers)
- `batch.commit({ count })` (rebuilds and uploads the instance buffer)
- `batch.setTransparency(spec)` (updates transparency policy and sorting)

Key options:
- `primitive`: `'sphere' | 'box' | 'cylinder' | 'capsule' | 'cone'` (shared geometry via AssetRegistry)
- `capacity`: max instances in this batch
- `layer`: one of the layer ids above
- `transparency`: policy object (see below)

#### Transparency Policy (instancing)

Transparent instancing is a system-level problem: instances are not automatically depth-sorted by Three.js.
The overlay system provides an explicit policy surface to avoid per-plugin hacks.

`transparency` fields (supported on `createInstancedMeshBatch` and `batch.setTransparency`):
- `mode`: `'opaque' | 'blend'` (defaults to `'blend'` for `worldTransparent`, else `'opaque'`)
- `opacity`: `0..1` (when `< 1`, enables blend mode)
- `sortMode`: `'nosort' | 'bins' | 'strict' | 'inherit'`
  - `nosort`: no per-instance ordering; fastest
  - `bins`: coarse depth bins; good default for large counts
  - `strict`: per-instance depth sort; best quality, higher CPU cost
- `bins`: `1..16` (used when `sortMode='bins'`)
- `update`: `'commit' | 'frame' | 'inherit'`
  - `commit`: sort/upload only when `commit()` is called
  - `frame`: also re-sorts when the camera moves (render-loop hook)
- `every`: integer `>= 1` (when `update='frame'`, only resort every N frames)
- `depthTest`, `depthWrite`, `toneMapped`: advanced material toggles (optional)

Global defaults for new batches:
- `overlay = host.renderer.overlay3d.get()`
- `overlay.setTransparencyDefaults({ sortMode, bins, update, every })`

#### Assets (refcounted, scoped)

Each scope exposes `scope.assets` helpers. Handles acquired through `scope.assets.*` are auto-released when the scope is disposed.

Useful helpers:
- `scope.assets.geometryPrimitive(kind)` → `{ asset: BufferGeometry, release() }`
- `scope.assets.texture2DFromUrl(url, options?)` → `{ asset: Texture, release() }`
- `scope.assets.acquire(key, createFn, { dispose? })` → generic refcounted asset handle

#### Example (instanced transparent markers)

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

### `host.getSnapshot()`

Returns the last snapshot currently held by the UI thread (may be `null` during initial load).

### `host.clock`

Time hooks for different workloads:
- `host.clock.onSnapshot(fn)`: called after each backend snapshot merges into the store.
- `host.clock.onUiTick(fn)`: throttled UI tick for DOM/UI work (default `ui_ms=33`, not snapshot-aligned).
- `host.clock.onFrame(fn)`: per-frame hook (RAF render loop; can be 60Hz+).

Recommended usage:
- Use `onSnapshot` for snapshot-aligned logic/state derivation.
- Use `onUiTick` for DOM updates (labels, cards, progress bars).
- Use `onFrame` only for animation that must track render frames.

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

## Worker Protocol Extensions (for new WASM ABI calls)

If your demo needs new functionality implemented inside the forge WASM (e.g. smocap/SIK), you will need a worker RPC surface.

### Why this is required

In worker backend mode, MuJoCo/forge is instantiated and owned by the worker (`dev/physics.worker.mjs`). The main thread cannot access WASM exports, pointers, or heaps. Therefore any new ABI calls must be:
1) invoked inside the worker, and
2) driven by commands sent from the main thread, and
3) observed either via existing snapshots (preferred) or via new events (when needed).

### Protocol is generated and validated

The worker command/event allow-list lives in generated files:
- `dev/protocol.gen.mjs` (command/event lists + field schemas + transfer fields)
- `dev/dispatch.gen.mjs` (runtime validation/dispatch)

Do not edit these by hand. Update the generator and re-run it:
- Generator: `tools/generate_worker_protocol.mjs`
- Regenerate: `cd dev && npm run generate:protocol`

### Where to implement new commands/events

Typical touch points:
- Worker handlers: `dev/physics.worker.mjs` (add a new handler under the command dispatch map).
- Main-thread wrapper: `dev/viewer_backend.mjs` (expose a method on `backend` and/or route through `backend.apply`).
- Optional state merge: `dev/main_ui.mjs` (only if you want to reflect worker events into `store` in a structured way).

### Design rules (recommended)

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

## Refresh-Rate Guidance

This viewer intentionally decouples:
- physics stepping (worker internal tick) and
- snapshot delivery (adaptive snapshotHz) and
- DOM updates (UI tick, default ~30Hz).

Recommended tiers:
- Simulation/pose rendering: follow snapshotHz (adaptive; worker controlled).
- Main UI panel updates: ~30Hz (`onUiTick` + change detection).
- Heavy status cards / debug tables: 1–5Hz (`onUiTick` with additional throttling).

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

  const off = host.clock.onUiTick(({ state }) => {
    card.dataset.run = state?.simulation?.run ? '1' : '0';
  });

  return () => {
    off();
    card.remove();
  };
}
```

## References

- Mounts and layout: `dev/index.html`
- Host API + plugin loader: `dev/main.nobuild.mjs`
- Backend implementation (worker spawn, snapshot merge): `dev/viewer_backend.mjs`
- Worker runtime (MuJoCo/forge owner): `dev/physics.worker.mjs`
- Protocol generator: `tools/generate_worker_protocol.mjs`
- Built-in UI controls + shortcuts: `dev/spec/ui_spec.json`
- Overlay implementation (scopes/layers/transparency/assets): `dev/main_renderer.mjs` (`ensureOverlay3D`)
