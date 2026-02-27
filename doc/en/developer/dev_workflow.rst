Dev workflow
============

Prerequisites
-------------

- Python 3 (for the dev server)
- Node.js (for generators and Playwright)

Run the viewer
--------------

.. code-block:: bash

  python dev/dev_server.py --root dev --port 8000

Then open:

.. code-block:: text

  http://127.0.0.1:8000/index.html?model=raj

Install JS dependencies (Playwright + tooling)
----------------------------------------------

Dependencies are scoped under ``dev/``:

.. code-block:: bash

  cd dev
  npm ci

Regenerate committed artifacts
------------------------------

.. code-block:: bash

  cd dev
  npm run generate

This runs:

- ``node tools/generate_ui_artifacts.mjs``
- ``node tools/generate_worker_protocol.mjs``

Debugging tips
--------------

- Verbose logs/perf:
  - ``?log=1`` (or ``?verbose=1``)
- Strict mode (catch sites re-throw unless allowlisted):
  - ``?strict=1``
- Inspect Worker:
  - In Chromium DevTools: ``Sources`` → ``Page`` → ``Workers``

Forge bundle selection
----------------------

For published demos, always pin forge by commit SHA and pass ``forgeBase=...``.
See :doc:`/reference/compatibility`.

