# Temporary Dev Plan

## Objective
Track the immediate follow-up items from the helper-ABI investigation: ensure mesh payload changes stay verified, document the remaining `t = 0` anomaly, and outline the quick validation path requested by the user.

## Plan
1. Confirm the critical information collected so far (mesh fix in `physics.worker.mjs`, helper-pointer behaviour, required cwrap usage).
2. Record the recommended diagnostic steps for reproducing/isolating the `t = 0` issue directly against the forge module.
3. Keep a lightweight task log so we know what has already been validated versus what still needs escalation to forge.

## Key Information Confirmed
- `physics.worker.mjs:382` now passes `renderAssets?.meshes` into `createSceneSnap`, ensuring mesh data reaches the viewer.
- The stagnating simulation time stems from invoking `mjwf_mj_step` with incorrect parameters or mismatched module bindings; helper pointers themselves should reflect stepped state because they target the same `g_pool[h]` memory as the rest of the ABI.
- Proper usage requires binding `mjwf_helper_*`, `mjwf_model_*`, `mjwf_data_*`, and `mjwf_mj_*` via `cwrap` (without leading underscores) on the same `Module` instance, then reading double values through `HEAPF64` using `ptr >> 3`.

## Diagnostic Checklist
- Use a single `mod` instance to cwrap:
  - `mjwf_helper_make_from_xml`, `mjwf_helper_model_ptr`, `mjwf_helper_data_ptr`, `mjwf_data_time_ptr`, `mjwf_mj_step`.
- After creating `h`, derive `modelPtr`/`dataPtr` and call `mjwf_mj_step(modelPtr, dataPtr)` in a loop; verify `HEAPF64[timePtr >> 3]` increases by `opt.timestep`.
- If the time value remains zero, log the cwrap signatures, pointer values, and the outputs of `mjwf_helper_errno_last(_global)` for escalation.

## Task Log
- Confirmed mesh-transfer fix already lands in worker snapshot output.
- Documented the suspected root causes for the zero-time issue and the precise cwrap/HEAP usage expected by forge.
- Prepared this temporary plan to keep the investigation path explicit until forge feedback arrives.
- Ran `local_tools/tmp_helper_diag.mjs` with `local_tools/bin/node.exe`; helper pointers plus `_mjwf_mj_step` advanced `time` from `0` to `2.0` after 1000 steps (dt=0.002), confirming the ABI path works end-to-end in Node.
- Instrumented `bridge.mjs`/`physics.worker.mjs` so `MjSimLite.pointerDiagnostics()` and the worker log stream dump module IDs, helper pointers, and live `time/timestep` readings right after load and on the first snapshot.
- Switched `MjSimLite` to build handles via the helper ABI, drive stepping through `_mjwf_mj_step`, and expose pointer-derived `time/timestep`; validated via `local_tools/tmp_simlite_diag.mjs` that helper handles now yield non-zero pointers and `time` advances to `2.0` after 1000 steps.
