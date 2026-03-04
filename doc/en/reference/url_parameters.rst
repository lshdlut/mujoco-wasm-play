URL parameters
==============

Play is configured primarily via URL query parameters. Parameters are parsed on
the main thread and (for backend-relevant knobs) propagated to the Worker.

This page is end-user focused and documents the most commonly-used knobs.

Boolean tokens
--------------

For boolean parameters, Play accepts these (case-insensitive):

- true: ``1``, ``true``, ``yes``, ``on``
- false: ``0``, ``false``, ``no``, ``off``

For verbose logging, ``log=debug`` is also accepted.

Parameters
----------

.. list-table::
  :header-rows: 1
  :widths: 18 10 12 10 50

  * - Key
    - Type
    - Default
    - Scope
    - Notes

  * - ``model``
    - string
    - builtin default
    - main → worker (load)
    - MJCF path under ``model/`` (or ``local_model/`` for local-only files) or a
      builtin alias (e.g. ``raj``, ``cards``).

  * - ``forgeBase``
    - string (URL)
    - (auto)
    - main → worker
    - Base URL for forge ``dist/<ver>/`` (must contain ``mujoco.js`` and
      ``mujoco.wasm``). If omitted, the Worker uses a local dev layout.

  * - ``ver``
    - string
    - ``site_config.js`` (``PLAY_VER``)
    - main → worker
    - MuJoCo/forge dist version token. Used to expand ``{ver}`` in the default
      forge base template (``/forge/dist/{ver}/``), and forwarded to the Worker
      for diagnostics.

  * - ``plugins``
    - string list
    - empty
    - main
    - Comma-separated ESM import specifiers/URLs. Each entry is imported via
      dynamic ``import()``. Relative specifiers (``./``/``../``) resolve
      relative to the repo root (same folder as ``index.html``).

Developer/debug parameters
--------------------------

Play also supports additional developer/debug URL parameters (strict mode,
verbose logs, renderer debugging, tick-rate clamps, etc). To keep this page
user-focused, those knobs are documented under :doc:`configuration`.

One commonly-used debug knob:

- ``cacheBust=always``: forces cache-busting (adds ``cb=...``) for the Worker URL
  and forge resource URLs. Default is cache-friendly (no ``cb``).

Deprecated / reserved parameters
--------------------------------

These are recognized by the runtime but are currently deprecated, internal, or
have no user-facing effect:

- ``mode=...``: deprecated and ignored (Play is Worker-only).
- ``cb=...``: internal cache-bust parameter (only used when
  ``cacheBust=always`` is enabled).
- ``hide`` / ``dump`` / ``find`` / ``hide_big`` / ``big_n`` / ``big_factor`` /
  ``hide_index``: parsed by the legacy param parser but not currently applied.
