安全模型
==============

Play 是一个查看器。它不会在浏览器已提供的隔离能力之外，再额外尝试做代码沙箱。

主要的两类“代码加载”入口是：

- forge bundles (``mujoco.js`` from ``forgeBase=...``)
- plugins (``plugins=...`` / ``PLAY_PLUGINS``)

请把二者都视为 **可信代码**。

Plugins = 执行 JavaScript
------------------------------

插件机制会动态导入任意 ESM 模块。插件与页面上运行的其它脚本拥有相同权限（DOM 访问、网络请求等）。

最佳实践：

- 只加载你信任的插件
- 尽可能将插件托管在同源（same origin）
- 面向公开 demo，避免接受用户提供的插件 URL

forgeBase 与执行 JavaScript
--------------------------------------------

``forgeBase`` points to a directory that serves ``mujoco.js`` and
``mujoco.wasm``.

最佳实践：

- 固定到不可变 URL（commit SHA）
- 优先使用 HTTPS
- 确保 MIME 类型与 CORS 响应头正确

模型加载与资产
------------------------

默认模型 loader 只支持可从静态托管拉取的本地相对文件引用。远程或绝对路径引用默认会被拒绝。

如果你需要从自定义端点拉取资产，请在你自己的代码中显式拉取，然后调用 ``host.backend.loadXmlBundle(...)``。
