Strict Direct Load Sequence (Forge 3.3.7)

Scope: local viewer demo only. No changes to forge artifacts.

Entry points
- Backend modules (`physics.worker.mjs`, `direct_backend.mjs`, etc.) live at the repo root alongside `index.html`.
- Use `index.html` (root) for Simulate-like UI in all modes.

Module loading
- Forge module resolved from `local_tools/forge/dist/3.3.7/mujoco-3.3.7.{js,wasm}`.
- `locateFile` maps `.wasm` to the sibling URL under the same dist path.

Strict init pipeline
1) `FS.mkdirTree('/mem')`
2) `FS.writeFile('/mem/model.xml', xml)`
3) `ccall('mjwf_make_from_xml','number',['string'],['/mem/model.xml'])`
4) Optional stage calls if present: `_mjwf_make_data`, `_mjwf_bind`, `_mjwf_attach`, `_mjwf_finalize`, `_mjwf_forward`, `_mjwf_reset`, `_mjwf_resetData`
5) Count check: require `nq>0`, `nv>0`, `ngeom>2`

Reload
- Reload uses the same strict pipeline as first load.

nofallback=1
- No auto fallback to local shim.
- No shim injection even if `shim=1` is present.

Notes
- This repository does not modify or ship forge artifacts; only the loader/bridge code is adjusted.
- For dev work, prefer shim mode; direct mode is reserved for regression checks.
