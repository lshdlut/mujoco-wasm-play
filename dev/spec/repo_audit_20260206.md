# Repository Audit Report (2026-02-06)

## Update (2026-02-09)
- Removed `tools/templates/*` and stopped overwriting `dev/physics.worker.mjs` / `dev/viewer_backend.mjs` from the worker-protocol generator.
- Allowlisted `plugin_dev.md` in `.gitignore` so the plugin contract can be tracked (requires `git add` + commit).
- Aligned `tsconfig.json` to include `dev/` and removed the orphan trailing comment block in `dev/main.nobuild.mjs`.

## Scope and method
- Scope: all tracked files from `git ls-files` (107 files).
- Method: file-by-file review of structure, ownership, generation path, references, and maintenance risk.
- Goal: identify redundancy/conflict/duplication/inefficiency and estimate realistic code-size reduction.

## Repository metrics (current)
- Tracked files: 107
- Text/source-like files reviewed: 42
- Total tracked LOC (`tools/loc_report.mjs`): `repo_loc=44150`
- Runtime ship LOC: `ship_loc=30184` (`ship_hand_loc=22635`, `ship_generated_loc=7549`)

## High-priority findings
1. **Doc contract is easy to drift**
   - `README.md:51` and `PLUGIN_GUIDE.md:3` point to `plugin_dev.md`.
   - `.gitignore:63` ignores root markdown (`/*.md`) except a few allowlist entries.
   - `plugin_dev.md` is therefore local-only/ignored by default, but currently used as the formal plugin contract.
   - Update (2026-02-09): `.gitignore` now allowlists `plugin_dev.md`, but it still needs to be committed.
2. **Large duplicated implementation copies (resolved 2026-02-09)**
   - The repo previously carried a template + runtime copy for worker/backend (`tools/templates/*` + `dev/*`).
   - Update (2026-02-09): removed `tools/templates/*` and stopped generator overwrites; `dev/*` is now the single runtime source.
3. **Monolithic modules with multi-responsibility concentration**
   - `dev/main_renderer.mjs:6284` (`applyMjvSceneSoAGeoms`) spans ~1287 lines.
   - `dev/main_renderer.mjs:3371` (`ensureOverlay3D`) spans ~960 lines.
   - `dev/main_renderer.mjs:7571` (`createRendererManager`) spans ~844 lines.
   - `dev/viewer_backend.mjs:392` (`createBackend`) spans ~1761 lines.
   - `dev/physics.worker.mjs:2254` (`collectAssetBuffersForTransfer`) spans ~1235 lines.
4. **Legacy/stale docs still in tracked tree**
   - `dev/spec/flow.md:1` and `dev/spec/overlay_spec.md:1` describe native `Simulate::*` flow, not current worker-first JS runtime.
5. **Entrypoint naming/cleanup inconsistency**
   - `dev/index.html:870` still loads `main.nobuild.mjs` (name implies legacy boot path).
   - Update (2026-02-09): removed orphan trailing comment block.
6. **TypeScript config not aligned with tracked TS file (resolved 2026-02-09)**
   - Update (2026-02-09): `tsconfig.json` now includes `dev/` so tooling sees `dev/viewer_state_types.ts`.

## Architecture observations (positive)
- `overlay3d` path in `dev/main_renderer.mjs` already has:
  - layer semantics (`worldOpaque/worldTransparent/worldOverlay/hud`)
  - transparency strategy surface
  - refcounted asset lifecycle (`RefCountedAssetRegistry`)
- The direction is correct; current issue is maintainability/volume, not conceptual architecture.

## Code reduction potential
### Low-risk (immediate)
- Remove one canonical copy for worker/backend pair (keep either template or runtime copy): **~5650 LOC** (done 2026-02-09)
- Archive/replace stale flow docs: **~120 LOC**
- Remove or clearly archive unused humanoid aggregate variants (`22_humanoids.xml`, `100_humanoids.xml`) if not needed in product path: **~95 LOC**
- Minor entry cleanup (`main.nobuild` trailing legacy comment/name normalization): **small**

**Immediate realistic reduction:** **~5.8k to 6.2k LOC** (~13% to 14% of repo LOC)

### Medium effort (refactor without behavior change)
- Split `main_renderer` into:
  - mjv-scene ingestion
  - overlay3d manager
  - camera/picking controllers
  - material/environment helpers
- Split `viewer_backend` into:
  - worker transport
  - snapshot decode/transfer logic
  - state merge and control adapters
- Flatten duplicated utility patterns across runtime/backend/ui.

**Additional likely reduction:** **~2k to 4k LOC**

### Aggressive (requires compatibility planning)
- Unify generated/runtime ownership model for UI artifacts/protocol and enforce one-way generation.
- Rework massive UI-spec runtime glue where repeated imperative wiring can be normalized.

**Total potential envelope:** **~8k to 10k LOC** (conservative), up to **~12k LOC** with aggressive generator ownership cleanup.

## Recommended plan
1. **S1 (1-2 days): repo hygiene and ownership**
   - Make plugin contract doc trackable (`plugin_dev.md`) or move tracked contract under `dev/spec/`.
   - Decide canonical ownership for worker/backend (template-first vs runtime-first), remove duplicate copy set.
   - Rename bootstrap (`main.nobuild.mjs` -> `main.mjs`) and remove residual orphan comment block.
2. **S2 (3-5 days): structural split**
   - Split `main_renderer` and `viewer_backend` by responsibility boundaries.
   - Keep exported API stable; avoid behavior changes.
3. **S3 (ongoing): documentation and guardrails**
   - Rewrite `dev/spec/flow.md` and `dev/spec/overlay_spec.md` to current JS worker architecture.
   - Add CI check to fail when referenced docs are ignored/untracked.

## File-by-file audit ledger (all tracked files)
Legend: `Keep` = retain; `Refactor` = keep but restructure; `Candidate` = archive/delete after confirmation.

- `.editorconfig` — Keep — repo formatting baseline.
- `.gitattributes` — Keep — LF normalization.
- `.gitignore` — Refactor — root markdown ignore rule conflicts with plugin doc discoverability.
- `PLUGIN_GUIDE.md` — Refactor — points to currently ignored file.
- `README.md` — Refactor — references ignored `plugin_dev.md`.
- `dev/bridge.mjs` — Refactor — large `MjSimLite` facade; high wrapper density.
- `dev/dev_server.py` — Keep — useful local static server.
- `dev/dispatch.gen.mjs` — Keep — generated protocol helper.
- `dev/fallbacks.mjs` — Keep — centralized compat fallback allowlist.
- `dev/favicon.ico` — Candidate — zero-byte placeholder; replace or remove.
- `dev/index.html` — Refactor — heavy inline CSS + legacy bootstrap filename.
- `dev/main.nobuild.mjs` — Refactor — bootstrap/orchestration + trailing legacy comment residue.
- `dev/main_environment.mjs` — Refactor — contains TODO(delete) remnants for disabled sun overlay.
- `dev/main_renderer.mjs` — Refactor — very large multi-responsibility module.
- `dev/main_ui.mjs` — Refactor — large state/ui wiring surface.
- `dev/model/cards/assets/10_of_clubs.png` — Keep — cards texture asset.
- `dev/model/cards/assets/10_of_diamonds.png` — Keep — cards texture asset.
- `dev/model/cards/assets/10_of_hearts.png` — Keep — cards texture asset.
- `dev/model/cards/assets/10_of_spades.png` — Keep — cards texture asset.
- `dev/model/cards/assets/2_of_clubs.png` — Keep — cards texture asset.
- `dev/model/cards/assets/2_of_diamonds.png` — Keep — cards texture asset.
- `dev/model/cards/assets/2_of_hearts.png` — Keep — cards texture asset.
- `dev/model/cards/assets/2_of_spades.png` — Keep — cards texture asset.
- `dev/model/cards/assets/3_of_clubs.png` — Keep — cards texture asset.
- `dev/model/cards/assets/3_of_diamonds.png` — Keep — cards texture asset.
- `dev/model/cards/assets/3_of_hearts.png` — Keep — cards texture asset.
- `dev/model/cards/assets/3_of_spades.png` — Keep — cards texture asset.
- `dev/model/cards/assets/4_of_clubs.png` — Keep — cards texture asset.
- `dev/model/cards/assets/4_of_diamonds.png` — Keep — cards texture asset.
- `dev/model/cards/assets/4_of_hearts.png` — Keep — cards texture asset.
- `dev/model/cards/assets/4_of_spades.png` — Keep — cards texture asset.
- `dev/model/cards/assets/5_of_clubs.png` — Keep — cards texture asset.
- `dev/model/cards/assets/5_of_diamonds.png` — Keep — cards texture asset.
- `dev/model/cards/assets/5_of_hearts.png` — Keep — cards texture asset.
- `dev/model/cards/assets/5_of_spades.png` — Keep — cards texture asset.
- `dev/model/cards/assets/6_of_clubs.png` — Keep — cards texture asset.
- `dev/model/cards/assets/6_of_diamonds.png` — Keep — cards texture asset.
- `dev/model/cards/assets/6_of_hearts.png` — Keep — cards texture asset.
- `dev/model/cards/assets/6_of_spades.png` — Keep — cards texture asset.
- `dev/model/cards/assets/7_of_clubs.png` — Keep — cards texture asset.
- `dev/model/cards/assets/7_of_diamonds.png` — Keep — cards texture asset.
- `dev/model/cards/assets/7_of_hearts.png` — Keep — cards texture asset.
- `dev/model/cards/assets/7_of_spades.png` — Keep — cards texture asset.
- `dev/model/cards/assets/8_of_clubs.png` — Keep — cards texture asset.
- `dev/model/cards/assets/8_of_diamonds.png` — Keep — cards texture asset.
- `dev/model/cards/assets/8_of_hearts.png` — Keep — cards texture asset.
- `dev/model/cards/assets/8_of_spades.png` — Keep — cards texture asset.
- `dev/model/cards/assets/9_of_clubs.png` — Keep — cards texture asset.
- `dev/model/cards/assets/9_of_diamonds.png` — Keep — cards texture asset.
- `dev/model/cards/assets/9_of_hearts.png` — Keep — cards texture asset.
- `dev/model/cards/assets/9_of_spades.png` — Keep — cards texture asset.
- `dev/model/cards/assets/ace_of_clubs.png` — Keep — cards texture asset.
- `dev/model/cards/assets/ace_of_diamonds.png` — Keep — cards texture asset.
- `dev/model/cards/assets/ace_of_hearts.png` — Keep — cards texture asset.
- `dev/model/cards/assets/ace_of_spades.png` — Keep — cards texture asset.
- `dev/model/cards/assets/black_joker.png` — Keep — cards texture asset.
- `dev/model/cards/assets/card.obj` — Keep — cards mesh asset.
- `dev/model/cards/assets/jack_of_clubs.png` — Keep — cards texture asset.
- `dev/model/cards/assets/jack_of_diamonds.png` — Keep — cards texture asset.
- `dev/model/cards/assets/jack_of_hearts.png` — Keep — cards texture asset.
- `dev/model/cards/assets/jack_of_spades.png` — Keep — cards texture asset.
- `dev/model/cards/assets/king_of_clubs.png` — Keep — cards texture asset.
- `dev/model/cards/assets/king_of_diamonds.png` — Keep — cards texture asset.
- `dev/model/cards/assets/king_of_hearts.png` — Keep — cards texture asset.
- `dev/model/cards/assets/king_of_spades.png` — Keep — cards texture asset.
- `dev/model/cards/assets/queen_of_clubs.png` — Keep — cards texture asset.
- `dev/model/cards/assets/queen_of_diamonds.png` — Keep — cards texture asset.
- `dev/model/cards/assets/queen_of_hearts.png` — Keep — cards texture asset.
- `dev/model/cards/assets/queen_of_spades.png` — Keep — cards texture asset.
- `dev/model/cards/assets/red_joker.png` — Keep — cards texture asset.
- `dev/model/cards/cards.xml` — Keep — cards demo model entry.
- `dev/model/humanoid/100_humanoids.xml` — Candidate — not on current builtin preset path.
- `dev/model/humanoid/22_humanoids.xml` — Candidate — not on current builtin preset path.
- `dev/model/humanoid/README.md` — Keep — humanoid model notes.
- `dev/model/humanoid/humanoid.png` — Keep — humanoid texture.
- `dev/model/humanoid/humanoid.xml` — Keep — humanoid preset model.
- `dev/model/humanoid/humanoid100.xml` — Keep — humanoid100 preset model.
- `dev/model/mujoco_Rajagopal2015_simple.xml` — Keep — main Rajagopal preset model.
- `dev/model/plugin/sensor/a.png` — Keep — sensor demo texture.
- `dev/model/plugin/sensor/touch_grid.xml` — Keep — sensor preset model.
- `dev/package-lock.json` — Keep — `dev/` package lock.
- `dev/package.json` — Refactor — scripts depend on local-only `../tests`.
- `dev/physics.worker.mjs` — Refactor — duplicate canonical with template copy.
- `dev/protocol.gen.mjs` — Keep — generated protocol constants.
- `dev/rustig_koppie_puresky_4k.hdr` — Keep — HDRI preset asset.
- `dev/spec/flow.md` — Candidate — stale native Simulate flow doc.
- `dev/spec/overlay_spec.md` — Candidate — stale native overlay doc.
- `dev/spec/ui_bindings_index.json` — Keep — generated UI binding index consumed by runtime.
- `dev/spec/ui_spec.json` — Keep — UI spec source.
- `dev/spec/ui_spec.schema.json` — Keep — schema for UI spec validation.
- `dev/starmap_random_2020_4k_rot.exr` — Keep — HDRI preset asset.
- `dev/viewer_backend.mjs` — Refactor — duplicate canonical with template copy; very large.
- `dev/viewer_defaults.mjs` — Keep — generated runtime defaults.
- `dev/viewer_runtime.mjs` — Refactor — broad runtime util + strict/perf/logging accumulation.
- `dev/viewer_shared.mjs` — Keep — generated/shared struct helpers.
- `dev/viewer_state_types.ts` — Refactor — tracked TS not covered by current `tsconfig` include.
- `dev/viewer_structs.mjs` — Keep — generated struct descriptors and read/write helpers.
- `dev/xml_refs.mjs` — Keep — XML direct-file resolution and bundle builder.
- `mujoco-wasm-play-cards.png` — Keep — README preview image.
- `tools/forbid_patterns.mjs` — Keep — hygiene gate script.
- `tools/generate_ui_artifacts.mjs` — Keep — UI generation pipeline.
- `tools/generate_worker_protocol.mjs` — Refactor — currently emits full runtime copies from templates.
- `tools/loc_report.mjs` — Keep — LOC reporting utility.
- `tools/templates/physics.worker.gen.mjs` — Refactor — duplicate canonical with runtime copy.
- `tools/templates/viewer_backend.gen.mjs` — Refactor — duplicate canonical with runtime copy.
- `tools/worker_protocol.json` — Keep — protocol IDL source.
- `tsconfig.json` — Refactor — include path does not cover tracked TS location.

## Non-tracked but operationally referenced
- `plugin_dev.md` (ignored by `.gitignore`) — critical plugin API contract currently not tracked.
