发布与版本管理
======================

本仓库是一个静态 Web 查看器。它通常与 forge bundle（``mujoco-wasm-forge``）以及 MuJoCo 版本同步演进。

推荐实践
---------------------

- 将 forge bundle 视为不可变产物：
  - 通过 ``dist/<ver>/`` 发布
  - 在 ``forgeBase=`` 中使用固定的 commit SHA 引用
- 保持 Play 与 forge 的变更协同：
  - Play 会校验必需的 viewer ABI surface（见 :doc:`/reference/compatibility`）
- 发布公开 demo 时：
  - 更新固定的 ``forgeBase`` URL
  - 确保托管 origin 上的 MIME/CORS 响应头正确

发布产物：``site.zip``
------------------------------

本仓库会在 GitHub Release 中发布一个可直接部署的静态产物包。

- 触发：打 tag ``mjwasm-play-<major>.<minor>.<patch>-r<revision>``。
- 例如：``mjwasm-play-3.5.0-r2``。
- Workflow：``.github/workflows/release-site.yml``。
- 输出：``site.zip``（**不包含** forge 的 ``dist/``）。

tag 规则：

- ``<major>.<minor>.<patch>`` 表示当前对齐的 Play/forge 基线版本。
- ``-r<revision>`` 表示同一基线上的第几次 Play 发布。
- 不符合该格式的 tag 会被 workflow 直接拒绝。

``site.zip`` 的内容包括：

- ``index.html``（single）与 ``pthreads/index.html``（pthreads）
- ``site_config.js``（设置默认 ``globalThis.PLAY_VER``）
- 运行时目录：``app/``、``assets/``、``backend/``、``bridge/``、``core/``、
  ``environment/``、``model/``、``plugins/``、``renderer/``、``spec/``、
  ``ui/``、``worker/``

部署预期：

- 托管端应在站点级共享路径提供 forge 工件（推荐）：
  ``/forge/dist/<ver>/``（pthreads 入口还需要 ``/forge/dist/<ver>/pthreads/``），
  或者显式传入 ``forgeBase=...``。
- 将 zip 解压到你的 app 子路径下（例如 ``/mujoco-wasm-play/``）。

文档版本
---------------------

如果使用 Read the Docs：

- 本仓库维护两套独立的 Sphinx 文档树：

  - 英文：``doc/en/``（配置：``doc/en/.readthedocs.yaml``）
  - 中文：``doc/zh/``（配置：``doc/zh/.readthedocs.yaml``）

- Read the Docs 通常每个 project 只使用一个配置文件。建议建两个 RTD project（或分别在 project 设置中指向对应的配置文件路径）。
- 从默认分支构建 ``latest``
- 当你开始打 release tag 时，可选地从 git tag 构建版本化文档
