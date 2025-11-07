Strict Direct Load Sequence (Forge 3.3.7)

Scope: local viewer demo only. No changes to forge artifacts.

Entry points
- Backend modules (`physics.worker.mjs`, `direct_backend.mjs`, etc.) live at the repo root alongside `index.html`.
- Use `index.html` (root) for Simulate-like UI in all modes.

Module loading
- Forge module resolved from `local_tools/forge/dist/3.3.7/mujoco-3.3.7.{js,wasm}`.
- `locateFile` maps `.wasm` to the sibling URL under the same dist path.

ABI compatibility (Forge 3.3.7 helper refactor)
- Forge 3.3.7 now only exports `mjwf_helper_*` lifecycle entrypoints plus 1:1 field views such as `mjwf_model_geom_size_ptr` / `mjwf_data_qpos_ptr`.
- All backends (loader, worker, direct bridge) now consume that surface directly: handles via `mjwf_helper_make_from_xml`, pointers via `mjwf_model_*`/`mjwf_data_*`, and simulation control via `_mjwf_mj_step`, `_mjwf_mj_resetData`, etc.
- `forge_abi_compat.js` still runs automatically, but only to keep **pre**-3.3.7 artifacts functional. New code paths never rely on the legacy `_mjwf_*` helpers.
- Option editing uses per-field exports (`mjwf_model_opt_*_ptr`); the old `_mjwf_model_opt_ptr` fallback is gone.
- Contact views (`_mjwf_contact_*`) were removed upstream; until we add a direct `mjContact` parser the viewer simply omits contact overlays.

Rollback
- Current baseline commit: `935def18c8b7708e65d204071065b9f7d569f491` (safe point before ABI shim landed).
- `git checkout 935def18` restores the previous `_mjwf_*` loader behavior if the new helper-based surface causes regressions.

Strict init pipeline
1) `FS.mkdirTree('/mem')`
2) `FS.writeFile('/mem/model.xml', xml)`
3) `ccall('mjwf_helper_make_from_xml','number',['string'],['/mem/model.xml'])`
4) Cache pointers: `_mjwf_helper_model_ptr(handle)`, `_mjwf_helper_data_ptr(handle)`
5) Count check: require `nq>0`, `nv>0`, `ngeom>2`

Reload
- Reload uses the same strict pipeline as first load.

nofallback=1
- No auto fallback to local shim.
- No shim injection even if `shim=1` is present.

Notes
- This repository does not modify or ship forge artifacts; only the loader/bridge code is adjusted.
- For dev work, prefer shim mode; direct mode is reserved for regression checks.
