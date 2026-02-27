from __future__ import annotations

from datetime import datetime


project = "MuJoCo WASM Play"
author = "mujoco-wasm-play contributors"
copyright = f"{datetime.now().year}, {author}"

language = "zh_CN"

extensions = [
    "myst_parser",
    "sphinx.ext.autosectionlabel",
]

templates_path = ["_templates"]
exclude_patterns = ["_build", "Thumbs.db", ".DS_Store"]

source_suffix = {
    ".rst": "restructuredtext",
    ".md": "markdown",
}

myst_enable_extensions = [
    "colon_fence",
]
myst_heading_anchors = 3

autosectionlabel_prefix_document = True

html_theme = "sphinx_rtd_theme"
html_static_path = ["_static"]
