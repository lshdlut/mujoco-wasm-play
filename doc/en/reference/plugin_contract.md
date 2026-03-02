# Plugin contract

This is the authoritative reference.

This page is the **authoritative** plugin development contract for Play.

- Scope: UI injection, stable DOM mounts, the Host API (`window.__PLAY_HOST__`),
  Worker boundary constraints, and the 3D overlay system.
- Status: experimental (expect iteration), but changes should stay compatible
  where practical.

```{include} ../_includes/plugin_dev.md
```

## Addendum: Host API notes

The runtime Host object includes a few utility fields that are useful when
writing plugins:

- `host.apiVersion`: numeric contract version.
- `host.contract`: metadata for the active contract (currently `{ apiVersion: 1 }`).
- `host.getSnapshot()`: returns the latest snapshot observed by the main thread.
- `host.capabilities` / `host.getCapability(name)`: feature flags for optional
  surfaces.
- `host.extensions`: plugin-owned bag for stashing state (the Host object is
  frozen via `Object.freeze`).
- `host.clock`: subscription helpers:
  - `onUiTick` / `onUiMainTick`
  - `onUiControlsTick`
  - `onUiSlowTick`
  - `onSnapshot`
  - `onFrame` (renderer frame callbacks)
- Logging helpers: `host.logStatus`, `host.logWarn`, `host.logError`.
- `host.strictCatch(err, context, options?)`: strict-mode error accounting.
