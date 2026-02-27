Run locally
===========

Serve ``dev/`` with the included Python dev server:

.. code-block:: bash

  python dev/dev_server.py --root dev --port 8000

Open:

.. code-block:: text

  http://127.0.0.1:8000/index.html?model=raj

Forge bundle resolution
-----------------------

Play needs a forge ``dist/<ver>/`` bundle (``mujoco.js`` + ``mujoco.wasm``).

The dev server mounts:

- ``/mujoco-wasm-play/`` → this repo root
- ``/mujoco-wasm-forge/`` → a sibling ``../mujoco-wasm-forge`` checkout (if it exists)

So on ``localhost``, Play can fetch forge artifacts from:

.. code-block:: text

  /mujoco-wasm-forge/dist/<ver>/

If you want to point at a different bundle, pass ``forgeBase=``:

.. code-block:: text

  http://127.0.0.1:8000/index.html?model=raj&forgeBase=../dist/3.4.0/

For full details, see :doc:`/reference/url_parameters`.

