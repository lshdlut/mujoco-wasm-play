Runtime configuration
=====================

Most configuration is done via URL parameters (:doc:`url_parameters`). This page
collects developer-focused knobs (URL parameters and non-URL globals) and debug
hooks in one place.

Developer URL parameters
------------------------

These URL parameters are primarily useful for debugging and development, and
may change over time:

- ``strict=1``: re-throw most caught errors (unless explicitly allowlisted).
- ``compat=1``: enables a small allowlisted set of compatibility fallbacks.
- ``log=1`` / ``verbose=1`` / ``log=debug``: enables verbose debug logs and
  performance instrumentation.
- ``debug=1``: enables extra debug behavior in the renderer/UI pipeline.
- ``ui_ms=<16..2000>``: main UI tick interval clamp.
- ``ui_slow_ms=<200..10000>``: slow UI tick interval clamp used by heavy cards.
- ``snapshot_hz_max=<30..120>``: upper bound for adaptive snapshot delivery
  rate.
- ``snapshot=1`` / ``snapshot=debug``: enables snapshot debug mode (and
  preserves the WebGL drawing buffer for inspection).
- ``nogeom=1`` (aliases: ``no_geom``, ``no-geom``, ``hideall``, ``hide_all``):
  sets the initial "hide all geometry" rendering flag.
- ``forceBasic=1``: forces basic materials (helpful for debugging
  lighting/material issues).
- ``inst=0`` / ``instancing=0`` / ``noinst=1``: disables instanced rendering.
- ``tbins=<0|1|4|8|16>``: transparent sorting bins.
- ``tmode=...``: transparency sort mode (``nosort``/``fast``, ``bins``,
  otherwise strict).

Global variables (read at startup)
----------------------------------

These should be set **before** the main module runs (e.g. in a script tag before
importing the app):

- ``globalThis.PLAY_PLUGINS``: array of plugin import specifiers/URLs (alternative
  to the ``plugins=`` query parameter).
- ``globalThis.PLAY_STRICT``: force strict mode on/off (overrides ``strict=``).
- ``globalThis.PLAY_COMPAT``: force compat mode on/off (overrides ``compat=``).
- ``globalThis.PLAY_VERBOSE_DEBUG``: force verbose debug on/off (overrides
  ``log=`` / ``verbose=``).

Rendering debug toggles (startup)
---------------------------------

- ``globalThis.PLAY_DISABLE_INSTANCING`` (boolean): overrides instancing enablement.
- ``globalThis.PLAY_TRANSPARENT_BINS`` (number): overrides ``tbins``.
- ``globalThis.PLAY_TRANSPARENT_SORT_MODE`` (string): one of
  ``strict``, ``bins``, ``nosort`` (overrides ``tmode``).

Runtime hooks / debug globals
-----------------------------

These are developer-focused and may change:

- ``window.__PLAY_HOST__``: plugin Host API (see :doc:`plugin_contract` and
  :doc:`/api_reference/plugin_api`).
- ``window.__viewerStore``: the viewer store instance (same object as
  ``__PLAY_HOST__.store``).
- ``window.__viewerControls``: a small control-manager façade.
- ``window.__viewerRenderer``: renderer helpers (stats/context/overlay3d).
- ``window.__lastSnapshot``: the most recent backend snapshot observed by the main thread.
- ``window.__renderCtx``: renderer manager context/debug object.
- ``window.PLAY_SNAPSHOT_DEBUG``: whether snapshot debug mode is enabled.
- ``window.__snapshot``: if set to ``true``/``1``, forces WebGL
  ``preserveDrawingBuffer`` (useful for screenshot/debug).
- ``window.__envDebug`` / ``window.__skyDebug`` / ``window.__frameCounter``:
  renderer/environment debug objects used during development.
- ``window.__PLAY_DUMP_GEOMORDER()``: debug hook (may be a stub depending on build).

Strict/perf helpers (developer)
-------------------------------

These are installed on ``globalThis`` when available:

- ``__PLAY_STRICT_REPORT__()`` / ``__PLAY_STRICT_CLEAR__()``: strict-mode event
  bookkeeping. Note: the main app also sets ``__PLAY_STRICT_REPORT__`` to
  include the worker report (``{ main, worker }``) when the backend is ready.
- ``__PLAY_PERF_SUMMARY__()`` / ``__PLAY_PERF_CLEAR_SAMPLES__()``: performance
  sample summary and reset (only when perf is enabled).
