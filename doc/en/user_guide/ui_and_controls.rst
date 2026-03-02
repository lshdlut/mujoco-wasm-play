UI and Controls
===============

Play mirrors the *MuJoCo Simulate* layout and aims for a 1:1 copy where
practical:

- **Left panel**: file/model loading, high-level simulation controls, viewer
  options.
- **Right panel**: model-dependent controls such as actuators/joints/equalities,
  plus dense per-model data.
- **Overlays**: help/info/profiler cards, in-view HUD stats such as FPS,
  ms/step, memory, solver stats, and transient toasts.

The exact hotkeys and panels can evolve; the goal is "Simulate parity".

Section behavior
----------------

UI panels are composed of **foldable sections**, including built-in and
plugin-provided sections.

- Collapsed state is persisted in ``localStorage`` under
  ``play:ui:v1:section_collapsed``. Keys are based on ``panel`` and
  ``sectionId``.
- Plugins should register sections via ``host.ui.sections.register(...)`` to
  get native behavior: collapse state, panel actions, styling.

Gestures and selection
----------------------

Mouse/touch gestures such as rotate/translate/zoom and selection are forwarded to the
Worker backend. Plugins can observe and react to:

- ``host.backend.subscribe((snapshot) => ...)``
- ``host.clock.onSnapshot(({ snapshot, state }) => ...)``

For plugin UI primitives and stable mounts, see :doc:`/reference/plugin_contract`.
