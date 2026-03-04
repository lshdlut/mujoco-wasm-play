Run locally
===========

Serve the repo root with the included Python dev server:

.. code-block:: bash

  python tools/dev_server.py --root . --port 8000

Open:

.. code-block:: text

  http://127.0.0.1:8000/index.html?model=raj

Forge bundle resolution
-----------------------

Play needs a forge ``dist/<ver>/`` bundle (``mujoco.js`` + ``mujoco.wasm``).

The dev server mounts:

- ``/mujoco-wasm-play/`` → this repo root
- ``/forge/`` → a sibling ``../mujoco-wasm-forge`` checkout if present (otherwise
  falls back to this repo root)
- ``/mujoco-wasm-forge/`` → legacy alias for a sibling forge checkout (if it exists)

So on ``localhost``, Play can fetch forge artifacts from:

.. code-block:: text

  /forge/dist/<ver>/

If you want to point at a different bundle, pass ``forgeBase=``:

.. code-block:: text

  http://127.0.0.1:8000/index.html?model=raj&forgeBase=/forge/dist/3.5.0/

For full details, see :doc:`/reference/url_parameters`.
