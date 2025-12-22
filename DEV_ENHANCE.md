# Dev Enhancements (UI / main_ui)

Scope: `dev/main_ui.mjs` (UI + store + binding glue).

Goal: Remove confirmed bugs + redundant logic while keeping strict/audit behavior.

## Problem Inventory (evidence-based)

| ID | Problem | Evidence |
| --- | --- | --- |
| UI-001 | `ensureBindingIndex()` caches a rejected promise forever (transient fetch failure bricks UI until reload). | `dev/main_ui.mjs:53` |
| UI-002 | Undefined `addToast()` call can crash strict mode on invalid vector input. | `dev/main_ui.mjs:359` |
| UI-003 | Empty `try {}` block (dead code). | `dev/main_ui.mjs:2704` |
| UI-004 | Dead/unreachable code after `return` in `createControlManager`. | `dev/main_ui.mjs:4330` |
| UI-005 | Non-English comment in runtime code (breaks repo convention, hurts auditability). | `dev/main_ui.mjs:4268` |
| UI-006 | Boolean parsing duplicated/inconsistent (`toBoolean` vs `coerceBoolean` vs `bool`). | `dev/main_ui.mjs:218`, `dev/main_ui.mjs:2023`, `dev/viewer_shared.mjs:12` |
| UI-007 | “Unknown binding” and missing binding metadata can silently no-op (hard to audit). | `dev/main_ui.mjs:173`, `dev/main_ui.mjs:331` |
| UI-008 | `store.get()` exposes mutable internal state reference (bypasses audit if mutated outside `store.update`). | `dev/main_ui.mjs:1402` |

## Work Plan (execute top → bottom)

### P0 — Correctness / Crashers (must-fix)
- [x] **UI-001** Reset `bindingIndexPromise` on failure so retries work.
  - Change: clear `bindingIndexPromise` inside fetch `.catch(...)`.
  - Accept: simulate a failed fetch once, then fix path / reload server, and UI loads without hard refresh.
- [x] **UI-002** Remove `addToast()` usage (no global toast dependency from `prepareBindingUpdate`).
  - Change: remove the undefined call; keep the normalization failure as a clean `null` return.
  - Accept: invalid vector input does not throw in strict/non-strict; backend stays responsive.
- [x] **UI-003** Delete the empty `try {}` block.
  - Accept: no behavior change; code no longer suggests hidden error handling.
- [x] **UI-004** Fix `getCameraModeCount` placement (it was unreachable after `return`).
  - Accept: `C:\\emsdk\\node\\22.16.0_64bit\\bin\\node.exe --check dev\\main_ui.mjs` passes; camera cycling does not throw.
- [x] **UI-005** Translate the non-English runtime comment to English.

### P1 — Strict / Audit hardening (no silent no-op)
- [x] **UI-101** Strict mode: missing binding metadata becomes a hard error.
  - Change: when `ui_bindings_index.json` has no entry for a struct binding, emit a strict error with binding/control context.
  - Accept: strict mode surfaces the mismatch deterministically; non-strict remains warn+ignore.
- [x] **UI-102** Strict mode: `kind:'unknown'` binding spec becomes a hard error (with binding/control context).
  - Accept: unknown bindings cannot silently ship in strict.

### P2 — Redundancy reduction (keep semantics)
- [x] **UI-201** Consolidate boolean parsing (`coerceBoolean` → `toBoolean`) without changing observable behavior.
  - Change: remove `coerceBoolean` and update `toBoolean` to cover the same accepted tokens.
  - Accept: existing UI interactions (checkboxes/run toggle) behave the same; strict report unchanged except fewer internal codepaths.

### P3 — Follow-ups (explicit decision required)
- [ ] **UI-301** Decide on `store.get()` immutability strategy (keep / return clone / freeze in strict).
  - Accept: documented decision + implementation if needed (may be perf-sensitive).

## Quick validation commands

PowerShell (repo root):
- Syntax check: `& \"C:\\emsdk\\node\\22.16.0_64bit\\bin\\node.exe\" --check dev\\main_ui.mjs`
- Local server: `C:\\Users\\63427\\miniforge3\\envs\\myconda\\python.exe dev\\dev_server.py --root dev --port 8000`
- Open: `http://localhost:8000/index.html?debug=1&snapshot=1&log=1`
