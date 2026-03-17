[English](README.md) | 简体中文

# MuJoCo WASM Play：把 Simulate 搬到浏览器

![mujoco-wasm-play](assets/mujoco-wasm-play-cards.png)

[推荐演示页](https://lshdlut.com/en/demos/play/) | [GitHub Pages 直达应用](https://lshdlut.github.io/mujoco-wasm-play/index.html?model=raj&ver=3.5.0&forgeBase=https://cdn.jsdelivr.net/gh/lshdlut/mujoco-wasm-forge@c7d49505b40cff7b113c4f1a5554676bdcfdbd84/dist/3.5.0/)

> **文档（Sphinx / Read the Docs）**：源码位于 [`doc/zh/`](doc/zh/) 和 [`doc/en/`](doc/en/)；在线阅读：[中文](https://mujoco-wasm-play.readthedocs.io/zh-cn/latest/)｜[英文](https://mujoco-wasm-play.readthedocs.io/en/latest/)。

## 总览

一个性能优先的 MuJoCo 查看器，把 **MuJoCo Simulate** 的大部分工作流带到 Web：打开一个 URL 就能开始模拟。由 `mujoco-wasm-forge` 驱动。

## 亮点

- **浏览器里的 Simulate 风格 UI**：面板与控件尽量对齐 MuJoCo Simulate，但只要能运行浏览器就能用。
- **可分享、免安装的 demo**：通过 URL 参数生成可复现的链接（`model=`、`forgeBase=`）。
- **性能优先的运行时**：MuJoCo 在 Worker 中运行；内置 HUD（按 `F2`）展示 CPU 耗时（ms/step）、solver 统计、FPS、内存。
- **可扩展框架**：插件可以添加原生风格的可折叠区块、面板级动作和 3D overlay，无需 fork 这个查看器。

## 性能

下表为参考数值（共测 5 次；每次取中位数；取最好的一次；越小越好）：交互式测得（有渲染、非 headless），且左右面板收起。每次预热 35 秒并采样 8 秒。Web Play 使用 MuJoCo 3.5.0，forge dist ver=3.5.0。CPU 耗时以 ms/step 的形式显示在 Simulate 风格 HUD 中（按 `F2`，Running 状态）。结果会随硬件、浏览器以及电源/温控策略而波动，仅供参考。

> 重要提示：浏览器扩展以及站点级功能（例如“增强安全性”/ 效率或省电模式）可能会显著影响 Worker/WASM 的计时表现；同一台机器上，GitHub Pages 的在线演示也可能比 `localhost` 更容易受到影响。做公平对比时建议用隐私窗口（private window）或临时禁用扩展，并保持标签页在前台。

| 模型 | 原生 `simulate` (ms/step) | Web Play (ms/step) |
|---|---:|---:|
| `cards` | 0.542 | 0.580 |
| `humanoid` | 0.062 | 0.078 |

## 快速开始

- 本地开发（在 8000 端口服务仓库根目录）：
  - `python tools/dev_server.py --root . --port 8000`
  - `http://127.0.0.1:8000/index.html?model=raj`
- 推荐演示页：
  - `https://lshdlut.com/en/demos/play/`
- 直达静态应用（GitHub Pages，仍保留）：
  - `https://lshdlut.github.io/mujoco-wasm-play/index.html?model=raj&ver=3.5.0&forgeBase=https://cdn.jsdelivr.net/gh/lshdlut/mujoco-wasm-forge@c7d49505b40cff7b113c4f1a5554676bdcfdbd84/dist/3.5.0/`
- 插件：实验性。见 `doc/zh/reference/plugin_contract.md`。`smocap` 即将发布。

## 模型

- `model=` 可以是 `model/` 下的 `.xml` 路径（本地私有文件可放到 `local_model/`），也可以是别名：`raj`、`humanoid`、`humanoid100`、`cards`、`sensor`。

## 插件

状态：实验性。

本仓库支持在不 fork 的情况下加载外部 UI/插件。对接契约从 `doc/zh/reference/plugin_contract.md` 开始（mounts、Host API、section registry、UI kit 基础组件、worker 约束、以及 3D overlay）。

## Forge dist

这是必需项。

Forge repo：`https://github.com/lshdlut/mujoco-wasm-forge`

- 本仓库不自带 MuJoCo WASM 二进制；运行时需要 forge 提供的 `dist/<ver>/` bundle。
- 通过 `forgeBase=`（推荐）或 `window.__FORGE_DIST_BASE__` 指定 dist base（必须在主模块运行前设置）。
- 默认 dist base（本地与线上一致）为 `/forge/dist/{ver}/`，其中 `{ver}` 来自 `site_config.js`（`globalThis.PLAY_VER`）或 URL 参数 `ver=...`。
- 开发服务器 `tools/dev_server.py` 会把 `/forge/` 挂载到同级的 `../mujoco-wasm-forge`（如果存在），否则回退到本仓库根目录。
- 这个查看器需要带 viewer extensions 的 forge 构建（scene + vopt pointers）。
- 常见的远端 base 模板（jsDelivr + 固定 forge commit）：`https://cdn.jsdelivr.net/gh/lshdlut/mujoco-wasm-forge@<sha>/dist/{ver}/`
- 缓存排查：追加 `cacheBust=always` 会强制对 Worker URL 与 forge 资源 URL 做 cache-bust。默认模式不会自动添加 `cb=...`。

### Pthreads 版本

- 入口：`/pthreads/index.html`
- 默认 dist base：`/forge/dist/{ver}/pthreads/`
- 依赖 cross-origin isolation（`crossOriginIsolated === true`），需要 COOP/COEP 头。

## 视觉来源

lighting / skybox 相关设置。

- `model`（默认）：使用当前模型中由 MuJoCo 驱动的 skybox/lights。
- `preset-sun` / `preset-moon`：内置 HDRI 预设，以本仓库静态资源形式提供（forge 的 `dist/<ver>/` 不包含 HDRI）。
- 可通过 `envAssetBase=` 或 `globalThis.PLAY_ENV_ASSET_BASE` 改写这些 HDRI/EXR 的托管位置，例如共享 CDN 或 R2 bucket。若远端环境资源加载失败，Play 会保留 preset 的灯光设置，并退化到现有 cached/gradient environment 路径。

## 开发

- UI 生成物：`node tools/generate_ui_artifacts.mjs`
- Worker 协议生成物：`node tools/generate_worker_protocol.mjs`（生成 `worker/protocol.gen.mjs`、`worker/dispatch.gen.mjs`）

## 测试

- `tests/unit/`：Node 单元测试（快、无额外依赖）
- `tests/e2e/`：Playwright 端到端测试
- Smoke：`npm run smoke`
- 全量 E2E：`npm run test:e2e`
