Testing
=======

End-to-end (Playwright)
-----------------------

Playwright is installed under ``dev/`` (see ``dev/package.json``).

Install dependencies:

.. code-block:: bash

  cd dev
  npm ci

Run a small smoke test:

.. code-block:: bash

  npm run smoke

Run the full E2E suite:

.. code-block:: bash

  npm run test:e2e

Environment variables
---------------------

The Playwright config supports:

- ``PLAYWRIGHT_PORT`` / ``PLAYWRIGHT_HOST`` / ``PLAYWRIGHT_BASE_URL``
- ``PYTHON_EXE`` (or ``PYTHON``) to choose the Python interpreter for the dev server

The default config starts ``dev/dev_server.py`` automatically.

Spec/tooling checks
-------------------

- ``npm run spec:lint``: validates the UI spec contract
- ``npm run ci:guard``: runs pattern-based guards (see ``tools/forbid_patterns.mjs``)

