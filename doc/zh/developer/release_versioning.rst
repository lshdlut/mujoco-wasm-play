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

文档版本（RTD）
---------------------

如果使用 Read the Docs：

- 从默认分支构建 ``latest``
- 当你开始打 release tag 时，可选地从 git tag 构建版本化文档
