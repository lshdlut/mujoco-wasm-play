Load models
===========

The simplest way is the ``model=`` URL parameter.

Aliases
-------

Play supports a small alias set for demo convenience:

- ``raj`` (Rajagopal2015)
- ``humanoid``
- ``humanoid100``
- ``cards``
- ``sensor``

Examples:

.. code-block:: text

  /index.html?model=raj
  /index.html?model=cards

Paths under ``model/``
----------------------

You can also pass a relative MJCF path under ``model/`` (or ``local_model/`` for
local-only files):

.. code-block:: text

  /index.html?model=model/cards/cards.xml

If you omit the ``.xml`` suffix, Play adds it.

Assets and file references
--------------------------

The default loader supports **relative, local** file references that can be
bundled from the static host (meshes, textures, etc).

Remote or absolute file references are intentionally rejected by the default
loader. If you need custom asset handling (remote fetch, authenticated
endpoints, custom mapping), use the developer API:

- ``host.backend.loadXmlBundle(...)``

See :doc:`/api_reference/js_api` for backend methods.
