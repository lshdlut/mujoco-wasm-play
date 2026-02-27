# Plugin contract (authoritative)

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
- `host.getSnapshot()`: returns the latest snapshot observed by the main thread.
- `host.clock`: subscription helpers:
  - `onUiTick` / `onUiMainTick`
  - `onUiControlsTick`
  - `onUiSlowTick`
  - `onSnapshot`
  - `onFrame` (renderer frame callbacks)
- Logging helpers: `host.logStatus`, `host.logWarn`, `host.logError`.
- `host.strictCatch(err, context, options?)`: strict-mode error accounting.
