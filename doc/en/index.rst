MuJoCo WASM Play
================

MuJoCo WASM Play is a static, browser-based MuJoCo viewer that brings the
*MuJoCo Simulate* workflow to the web: open a URL and start simulating.

Play is designed for end users: load a model, run/pause/step, inspect options
and stats, and share a reproducible link.

Live demo
---------

- `Recommended demo page <https://lshdlut.com/en/demos/play/>`_
- `Direct GitHub Pages app <https://lshdlut.github.io/mujoco-wasm-play/index.html?model=raj&ver=3.5.0&forgeBase=https://cdn.jsdelivr.net/gh/lshdlut/mujoco-wasm-forge@c7d49505b40cff7b113c4f1a5554676bdcfdbd84/dist/3.5.0/>`_

Quickstart
------------------

Serve the repo root and open a URL:

::

  python tools/dev_server.py --root . --port 8000
  http://127.0.0.1:8000/index.html?model=raj

Highlights
----------

* Simulate-style UI in the browser (panels + controls).
* Shareable, reproducible links via URL parameters (``model=``, ``forgeBase=``).
* Performance-first runtime: MuJoCo runs in a Worker; the built-in HUD (press ``F2``) exposes CPU timing and stats.
* Extensible: plugins can add foldable UI sections, panel actions, and 3D overlays (see :doc:`reference/plugin_contract`).

Start here
----------

.. toctree::
  :maxdepth: 2

  user_guide/index
  howto/index
  reference/index
  faq

For developers
--------------

.. toctree::
  :maxdepth: 2

  developer/index
  api_reference/index
  contributing
  changelog
