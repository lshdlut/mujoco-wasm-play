Testing
=======

End-to-end (Playwright)
-----------------------

Playwright is installed at the repo root (see ``package.json``).

Install dependencies:

.. code-block:: bash

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

The default config starts ``tools/dev_server.py`` automatically.

Spec/tooling checks
-------------------

- ``npm run spec:lint``: validates the UI spec contract
- ``npm run ci:guard``: runs pattern-based guards (see ``tools/forbid_patterns.mjs``)
- ``node tools/run_checks.mjs``: runs a fast local check suite (guards + module boundaries + Node unit tests + syntax checks)

Node unit tests
---------------

The repo includes a small set of dependency-free Node tests under ``tests/unit/``.

.. code-block:: bash

  node --test tests/unit/*.test.mjs
