Release and versioning
======================

This repo is a static web viewer. It typically evolves in lockstep with a forge
bundle (``mujoco-wasm-forge``) and a MuJoCo version.

Recommended practices
---------------------

- Treat forge bundles as immutable artifacts:
  - publish via ``dist/<ver>/``
  - reference them using pinned commit SHAs in ``forgeBase=``
- Keep Play and forge changes coordinated:
  - Play validates a required viewer ABI surface (see :doc:`/reference/compatibility`)
- When publishing a public demo:
  - update the pinned ``forgeBase`` URL
  - ensure MIME/CORS headers are correct on the hosting origin

Release artifact: ``site.zip``
------------------------------

This repo publishes a ready-to-deploy static bundle as a GitHub Release asset.

- Trigger: tag ``mjwasm-play-<major>.<minor>.<patch>-r<revision>``.
- Example: ``mjwasm-play-3.5.0-r2``.
- Workflow: ``.github/workflows/release-site.yml``.
- Output: ``site.zip`` (does **not** include forge ``dist/``).

Tagging rule:

- ``<major>.<minor>.<patch>`` tracks the Play/forge baseline you are releasing.
- ``-r<revision>`` increments when you cut another Play release on the same
  baseline.
- The workflow rejects tags that do not match this format.

The zip contains:

- ``index.html`` (single) and ``pthreads/index.html`` (pthreads)
- ``site_config.js`` (sets the default ``globalThis.PLAY_VER``)
- runtime directories: ``app/``, ``assets/``, ``backend/``, ``bridge/``,
  ``core/``, ``environment/``, ``model/``, ``plugins/``, ``renderer/``,
  ``spec/``, ``ui/``, ``worker/``

Deployment expectations:

- The host should provide forge artifacts under a shared site-level path
  (recommended): ``/forge/dist/<ver>/`` (and ``/forge/dist/<ver>/pthreads/`` for
  the pthreads entry), or pass ``forgeBase=...`` explicitly.
- Extract the zip under your app subpath (for example ``/mujoco-wasm-play/``).

Docs versioning
---------------------

If using Read the Docs:

- This repo keeps two independent Sphinx trees:

  - English: ``doc/en/`` (config: ``doc/en/.readthedocs.yaml``)
  - Chinese: ``doc/zh/`` (config: ``doc/zh/.readthedocs.yaml``)

- Read the Docs expects one config file per project. Use two RTD projects (or
  configure each project's config file path accordingly).
- build ``latest`` from the default branch
- optionally build versioned docs from git tags when you start tagging releases
