Runtime configuration
=====================

Most configuration is done via URL parameters. See :doc:`url_parameters`.
This page collects developer-focused knobs and debug hooks in one place.

Developer URL parameters
------------------------

These URL parameters are primarily useful for debugging and development, and
may change over time:

- ``strict=1``: re-throw most caught errors unless explicitly allowlisted.
- ``compat=1``: enables a small allowlisted set of compatibility fallbacks.
- ``log=1`` / ``verbose=1`` / ``log=debug``: enables verbose debug logs and
  performance instrumentation.
- ``debug=1``: enables extra debug behavior in the renderer/UI pipeline.
- ``ui_ms=<16..2000>``: main UI tick interval clamp.
- ``ui_slow_ms=<200..10000>``: slow UI tick interval clamp used by heavy cards.
- ``snapshot_hz_max=<30..120>``: upper bound for adaptive snapshot delivery
  rate.
- ``snapshot=1`` / ``snapshot=debug``: enables snapshot debug mode and preserves
  the WebGL drawing buffer for inspection.
- ``nogeom=1``: sets the initial "hide all geometry" rendering flag. Aliases:
  ``no_geom``, ``no-geom``, ``hideall``, ``hide_all``.
- ``forceBasic=1``: forces basic materials. Useful for debugging
  lighting/material issues.
- ``inst=0`` / ``instancing=0`` / ``noinst=1``: disables instanced rendering.
- ``tbins=<0|1|4|8|16>``: transparent sorting bins.
- ``tmode=...``: transparency sort mode. Values include ``nosort``/``fast``,
  ``bins``. Any other value implies strict.

Global variables read at startup
----------------------------------

These should be set **before** the main module runs. For example, use a script
tag before importing the app:

- ``globalThis.PLAY_PLUGINS``: array of plugin import specifiers/URLs.
  Alternative to the ``plugins=`` query parameter.
- ``globalThis.PLAY_STRICT``: force strict mode on/off. Overrides ``strict=``.
- ``globalThis.PLAY_COMPAT``: force compat mode on/off. Overrides ``compat=``.
- ``globalThis.PLAY_VERBOSE_DEBUG``: force verbose debug on/off. Overrides
  ``log=`` / ``verbose=``.
- ``globalThis.PLAY_ENV_ASSET_BASE``: override the base URL used for built-in
  HDRI/EXR environment presets. Equivalent to ``envAssetBase=``.

Rendering debug toggles at startup
----------------------------------------

- ``globalThis.PLAY_DISABLE_INSTANCING``: boolean. Overrides instancing enablement.
- ``globalThis.PLAY_TRANSPARENT_BINS``: number. Overrides ``tbins``.
- ``globalThis.PLAY_TRANSPARENT_SORT_MODE``: string. One of ``strict``, ``bins``,
  ``nosort``. Overrides ``tmode``.

Runtime hooks / debug globals
-----------------------------

These are developer-focused and may change:

- ``window.__PLAY_HOST__``: plugin Host API. See :doc:`plugin_contract` and
  :doc:`/api_reference/plugin_api`.
- ``window.__viewerStore``: the viewer store instance. Same object as
  ``__PLAY_HOST__.store``.
- ``window.__viewerControls``: a small control-manager façade.
- ``window.__viewerRenderer``: renderer helpers such as stats/context/overlay3d.
- ``window.__lastSnapshot``: the most recent backend snapshot observed by the main thread.
- ``window.__renderCtx``: renderer manager context/debug object.
- ``window.PLAY_SNAPSHOT_DEBUG``: whether snapshot debug mode is enabled.
- ``window.__snapshot``: if set to ``true`` or ``1``, forces WebGL
  ``preserveDrawingBuffer``. Useful for screenshot/debug.
- ``window.__envDebug`` / ``window.__skyDebug`` / ``window.__frameCounter``:
  renderer/environment debug objects used during development.
- ``window.__PLAY_DUMP_GEOMORDER()``: debug hook. May be a stub depending on build.

Strict/perf helpers
-------------------------------

These are installed on ``globalThis`` when available:

- ``__PLAY_STRICT_REPORT__()`` / ``__PLAY_STRICT_CLEAR__()``: strict-mode event
  bookkeeping. Note: the main app also sets ``__PLAY_STRICT_REPORT__`` to
  include the worker report ``{ main, worker }`` when the backend is ready.
- ``__PLAY_PERF_SUMMARY__()`` / ``__PLAY_PERF_CLEAR_SAMPLES__()``: performance
  sample summary and reset. Only present when perf is enabled.
