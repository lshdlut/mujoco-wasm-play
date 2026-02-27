Overview
========

MuJoCo WASM Play ("Play") is a static, browser-based MuJoCo viewer that aims to
match the *MuJoCo Simulate* workflow as closely as practical:

- open a URL
- load a model
- run/pause/step
- inspect options, stats, and rendering flags
- share a reproducible link

For most users, Play is "just a web page": no installation, and the URL fully
describes what is loaded.

Models and sharing
------------------

Play is configured primarily via URL parameters. The most common ones are:

- ``model=...``: which model to load
- ``forgeBase=...``: which forge dist bundle to use (when hosting)

See :doc:`/reference/url_parameters` for details.

Next steps
----------

- See :doc:`/howto/load_models` for model loading patterns.
- See :doc:`/user_guide/ui_and_controls` for the UI layout and controls.
