Compatibility
=============

This page defines the compatibility contract between:

- Play (this repo)
- forge dist bundles (``mujoco-wasm-forge`` outputs)
- browsers (module Workers + WASM)

Browsers
--------

Play requires:

- ES modules in the main thread
- **module Workers** (``new Worker(url, { type: 'module' })``)
- WebAssembly

Most modern Chromium/Firefox/Safari versions satisfy these requirements.

Forge dist bundle requirements
------------------------------

Play expects a forge ``dist/<ver>/`` directory that contains at least:

- ``mujoco.js`` (ESM-capable loader)
- ``mujoco.wasm``

Recommended (optional):

- ``version.json`` (optional; used for diagnostics in verbose/perf mode)

Tested forge baselines
----------------------

The current default Play baseline is MuJoCo 3.15.0.

Core CI includes an external OBJ mesh smoke for forge 3.6.0 through 3.15.0,
including the retained 3.8.1 baseline. MuJoCo 3.15.0 additionally has single-thread
and isolated pthreads regressions for textured bundles, Reload, simulation controls,
load failure/recovery, asset failure propagation, and interrupted requests.
Intermediate-version mesh smoke is not full feature or performance qualification.

``loadXmlText`` and ``loadXmlBundle`` resolve after model compilation, a valid initial
snapshot, and required render assets are delivered. Replacement/disposal rejects
outstanding requests. Reload replays the complete XML path and referenced files.

``ver`` selects a bundle location; an explicit ``forgeBase`` can override it.
Typed ABI reads use the loaded engine's ``mj_versionString`` rather than the
requested/default version. The snapshot exposes this identity as ``engineVersion``.

ABI metadata is still generated for older local baselines when present under
``dist/<ver>/`` so existing pinned demos can keep working.

Viewer ABI extensions
--------------------------------

Play validates that the loaded forge module exports a required viewer ABI set.
If any export is missing, the Worker throws an error and reports the missing
symbols.

The canonical list lives in ``worker/physics.worker.mjs``:

.. literalinclude:: ../../../worker/physics.worker.mjs
  :language: js
  :start-after: const required = [
  :end-before: const missing =

Notes:

- This is a *viewer* contract (scene packing, vopt/camera/perturb pointers, and
  mjv helpers).
- If you build your own forge bundle, ensure viewer extensions are enabled.

Local dev vs hosted layouts
---------------------------

When ``forgeBase=`` is omitted, Play resolves a default forge base template and
propagates it to the Worker:

- single entry: ``/forge/dist/{ver}/``
- pthreads entry: ``/forge/dist/{ver}/pthreads/``

The local dev server (``tools/dev_server.py``) mounts ``/forge/`` to a sibling
``../mujoco-wasm-forge`` checkout if present (otherwise it falls back to the
Play repo root for local-only mirrors).

For explicit control (recommended for published demos), always pass
``forgeBase=...`` and pin it to an immutable forge commit.

Pthreads (SharedArrayBuffer)
----------------------------

If you use the pthreads entry (``/pthreads/index.html``):

- the forge bundle must exist under ``dist/<ver>/pthreads/`` (at least
  ``mujoco.js`` + ``mujoco.wasm``), and
- the page must be cross-origin isolated (``crossOriginIsolated === true``),
  which requires COOP/COEP headers.

Play hard-fails early if cross-origin isolation is missing.

Control and saved-state compatibility
------------------------------------

Actuator metadata uses ``nactuator`` when the native model defines it; scalar
control buffers and ranges still use ``nu``. The control panel maps each scalar
slot through native ``actuator_ctrladr``/``actuator_ctrlnum`` and labels its input
with ``mj_actuatorInputName``. Legacy single-input models retain one slot per
actuator. Clear all calls native ``mj_resetCtrl`` where supported, including the
identity quaternion neutral input; older single-input versions reset to zero.

History and custom keyframes use the official ``mjSTATE_INTEGRATION`` enum,
generated from the loaded engine's Forge metadata. This includes plugin state,
but nonzero third-party plugin state has not been validated: the supplied Forge
bundles do not provide an executable stateful-plugin fixture. Synthetic ABI
sentinel tests are not evidence of real plugin save/restore/continuation.
MuJoCo IPC multipliers are not covered by any native state specification, so
history playback/custom saved states are not a guarantee of exact IPC replay.

Integrator choices follow the native enum metadata, so loaded ``discrete`` is
displayed without changing the model's integrator. This is not an assertion of
whole-engine API coverage or renderer parity. Classical model lighting uses
effective ambient/diffuse RGB without multiplying photometric intensity.
Play retains its existing point-light extension (native classical rendering
ignores point/image lights); photometric rendering and full visual parity are
not implemented or validated by this local compatibility repair.
Models with nonzero, nonunit photometric intensity may look different after
this correction; zero/unit-intensity classical models retain their RGB scaling.
