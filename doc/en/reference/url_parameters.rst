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
    - MJCF path under ``dev/`` or a builtin alias (e.g. ``raj``, ``cards``).

  * - ``forgeBase``
    - string (URL)
    - (auto)
    - main → worker
    - Base URL for forge ``dist/<ver>/`` (must contain ``mujoco.js`` and
      ``mujoco.wasm``). If omitted, the Worker uses a local dev layout.

  * - ``plugins``
    - string list
    - empty
    - main
    - Comma-separated ESM import specifiers/URLs. Each entry is imported via
      dynamic ``import()``. Relative specifiers (``./``/``../``) resolve
      relative to ``dev/main.nobuild.mjs`` (under ``dev/``).

Developer/debug parameters
--------------------------

Play also supports additional developer/debug URL parameters (strict mode,
verbose logs, renderer debugging, tick-rate clamps, etc). To keep this page
user-focused, those knobs are documented under :doc:`configuration`.

Deprecated / reserved parameters
--------------------------------

These are recognized by the runtime but are currently deprecated, internal, or
have no user-facing effect:

- ``mode=...``: deprecated and ignored (Play is Worker-only).
- ``cb=...``: internal cache-bust parameter added to the Worker URL.
- ``ver=...``: Worker-only; selects the local fallback ``dev/dist/<ver>/`` path
  when ``forgeBase`` is omitted. Not currently propagated from the main page.
- ``hide`` / ``dump`` / ``find`` / ``hide_big`` / ``big_n`` / ``big_factor`` /
  ``hide_index``: parsed by the legacy param parser but not currently applied.
