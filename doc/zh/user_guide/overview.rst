概览
========

MuJoCo WASM Play（“Play”）是一个静态的、基于浏览器的 MuJoCo 查看器，目标是尽可能贴近 *MuJoCo Simulate* 的工作流：

- 打开一个 URL
- 加载一个模型
- 运行/暂停/单步
- 查看选项、统计信息与渲染开关
- 分享可复现的链接

对大多数用户来说，Play “就是一个网页”：无需安装，并且 URL 能完整描述当前加载了什么。

模型与分享
------------------

Play 主要通过 URL 参数进行配置。最常用的是：

- ``model=...``：要加载的模型
- ``forgeBase=...``：要使用的 forge dist bundle（托管时需要）

详情见 :doc:`/reference/url_parameters`。

下一步
----------

- 模型加载模式见 :doc:`/howto/load_models`。
- UI 布局与操作见 :doc:`/user_guide/ui_and_controls`。
