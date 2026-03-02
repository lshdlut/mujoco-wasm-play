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

Docs versioning (RTD)
---------------------

If using Read the Docs:

- This repo keeps two independent Sphinx trees:

  - English: ``doc/en/`` (config: ``doc/en/.readthedocs.yaml``)
  - Chinese: ``doc/zh/`` (config: ``doc/zh/.readthedocs.yaml``)

- Read the Docs expects one config file per project. Use two RTD projects (or
  configure each project's config file path accordingly).
- build ``latest`` from the default branch
- optionally build versioned docs from git tags when you start tagging releases
