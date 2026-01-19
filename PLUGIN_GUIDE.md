# Plugin Development Guide (Experimental)

This repo supports optional, external plugins that can inject UI/behavior without forking `mujoco-wasm-play`.

This guide defines:
- Stable DOM mounts (where plugins render UI).
- The Host API (`window.__PLAY_HOST__`) and clock semantics.
- How plugins are loaded and how to clean up resources.

## Loading Plugins

Plugins are loaded via dynamic `import()` (ESM only).

Supported configuration:
- Query parameter: `?plugins=<url1>,<url2>`
- Global (must be set before the main module runs): `globalThis.PLAY_PLUGINS = ['<url1>', '<url2>']`

Notes:
- Each entry must be a valid ESM module URL/specifier for `import()`.
- For cross-origin URLs, the server must allow CORS and serve JavaScript with a correct MIME type.
- Import specifiers that start with `./` or `../` are resolved relative to `dev/main.nobuild.mjs` (i.e., under `dev/`).

Plugin load failures are reported via `logError` + `strictCatch(..., { allow: true })` and do not stop the main app.

## Stable DOM Mounts

Plugins should render only into the plugin mounts. Do not mutate the core panel mounts.

Available mounts:
- `host.mounts.leftPanelPlugin`: left panel plugin area
- `host.mounts.rightPanelPlugin`: right panel plugin area (intended for complex demo UI)
- `host.mounts.overlayRoot`: viewer overlay root (progress bars, status cards, HUD overlays)

Core mounts (owned by the viewer):
- `host.mounts.leftPanel`
- `host.mounts.rightPanel`

HTML source of these mounts:
- `dev/index.html` uses `data-play-mount="leftPanel|rightPanel|overlayRoot|leftPanelPlugin|rightPanelPlugin"`.

## Host API (`window.__PLAY_HOST__`)

At runtime the viewer exposes `window.__PLAY_HOST__` and passes the same object into each plugin register function.

### `host.store`

State container with:
- `host.store.get(): State`
- `host.store.update((state) => void): void`
- `host.store.subscribe((state) => void): () => void`

Plugins can read current UI state (panels/overlays, hud, rendering options) and write demo-specific state (recommend: under a dedicated namespace like `state.demo.<name>`).

### `host.backend`

Backend instance (worker/direct depending on viewer mode). Typical methods used by plugins:
- `host.backend.apply(...)` (send commands/patches)
- `host.backend.subscribe((snapshot) => void)` (raw snapshot stream)
- `host.backend.snapshot()` (fetch latest snapshot)
- `host.backend.loadXmlText(xmlText, options?)` (reload model)

The backend surface may evolve; prefer feature-detecting (`typeof host.backend.foo === 'function'`) for optional calls.

### `host.controls`

Convenience helpers around the built-in UI spec:
- `host.controls.toggleControl(id, value?)`
- `host.controls.listIds(prefix?)`
- `host.controls.getControl(id)`
- `host.controls.loadXmlTextAsModel(xmlText, label?)`

Control IDs and shortcuts come from `dev/spec/ui_spec.json`.

### `host.renderer`

Renderer helpers:
- `host.renderer.getContext()`
- `host.renderer.ensureLoop()`
- `host.renderer.renderScene(snapshot, state)`

### `host.clock`

Time hooks for different workloads:
- `host.clock.onSnapshot(fn)`: called after each backend snapshot merges into the store.
- `host.clock.onUiTick(fn)`: throttled UI tick for DOM/UI work (default `ui_ms=33`, not snapshot-aligned).
- `host.clock.onFrame(fn)`: per-frame hook (RAF render loop; can be 60Hz+).

Payload shape:
- `onSnapshot`: `{ snapshot, state, nowMs }`
- `onUiTick`: `{ snapshot | null, state, nowMs }`
- `onFrame`: `{ snapshot, state }`

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

## Tuning Refresh Rates

URL parameters:
- `ui_ms=<16..2000>`: UI tick interval in milliseconds.
- `ui_slow_ms=<200..10000>`: slower UI interval used by some built-in cards.

For demos that add heavy UI, keep `onUiTick` work minimal and prefer change-detection (only touch DOM when inputs changed).

## References

- Mounts and layout: `dev/index.html`
- Host API + plugin loader: `dev/main.nobuild.mjs`
- Built-in UI controls + shortcuts: `dev/spec/ui_spec.json`
- Overlay structure notes: `dev/spec/overlay_spec.md`
- End-to-end data flow notes: `dev/spec/flow.md`
