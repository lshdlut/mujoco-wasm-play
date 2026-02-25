[English](README.md) | 简体中文

# MuJoCo WASM Play：把 Simulate 搬到浏览器

![mujoco-wasm-play](mujoco-wasm-play-cards.png)

[**在线演示（Rajagopal2015, MuJoCo 3.4.0）**](https://lshdlut.github.io/mujoco-wasm-play/dev/index.html?model=raj&forgeBase=https://cdn.jsdelivr.net/gh/lshdlut/mujoco-wasm-forge@3a963f1cd3379e10e63f6c5f5c7d6d9006aa3680/dist/3.4.0/)

## 总览

一个性能优先的 MuJoCo 查看器，把 **MuJoCo Simulate** 的大部分工作流带到 Web：打开一个 URL 就能开始模拟。由 `mujoco-wasm-forge` 驱动。

## 亮点

- **浏览器里的 Simulate 风格 UI**：面板与控件尽量对齐 MuJoCo Simulate，但只要能运行浏览器就能用。
- **可分享、免安装的 demo**：通过 URL 参数生成可复现的链接（`model=`、`forgeBase=`）。
- **性能优先的运行时**：MuJoCo 在 Worker 中运行；内置 HUD（按 `F2`）展示 CPU 耗时（ms/step）、solver 统计、FPS、内存。
- **可扩展框架**：插件可以添加原生风格的可折叠区块、面板级动作和 3D overlay，无需 fork 这个查看器。

## 性能（CPU 毫秒/步）

下表为参考数值（共测 5 次；每次取中位数；取最好的一次；越小越好）：在 MuJoCo 3.4.0 下交互式测得（有渲染、非 headless），且左右面板收起。每次预热 35 秒并采样 8 秒。CPU 指 Simulate 风格 HUD 的数值（按 `F2`，Running 状态）。结果会随硬件、浏览器以及电源/温控策略而波动，仅供参考。

> 重要提示：浏览器扩展以及站点级功能（例如“增强安全性”/ 效率或省电模式）可能会显著影响 Worker/WASM 的计时表现；同一台机器上，GitHub Pages 的在线演示也可能比 `localhost` 更容易受到影响。做公平对比时建议用隐私窗口（private window）或临时禁用扩展，并保持标签页在前台。

| 模型 | 原生 `simulate` (ms/step) | Web Play (ms/step) |
|---|---:|---:|
| `cards` | 0.542 | 0.718 |
| `humanoid` | 0.062 | 0.076 |

## 快速开始

- 本地开发（在 8000 端口服务 `dev/`）：
  - `python dev/dev_server.py --root dev --port 8000`
  - `http://127.0.0.1:8000/index.html?model=raj`
- 线上演示：
  - `https://lshdlut.github.io/mujoco-wasm-play/dev/index.html?model=raj&forgeBase=https://cdn.jsdelivr.net/gh/lshdlut/mujoco-wasm-forge@3a963f1cd3379e10e63f6c5f5c7d6d9006aa3680/dist/3.4.0/`
- 插件（实验性）：见 `plugin_dev.md`（`smocap` 即将发布）。

## 模型

- `model=` 可以是 `dev/` 下的 `.xml` 路径，也可以是别名：`raj`、`humanoid`、`humanoid100`、`cards`、`sensor`。

## 插件（实验性）

本仓库支持在不 fork 的情况下加载外部 UI/插件。对接契约从 `plugin_dev.md` 开始（mounts、Host API、section registry、UI kit 基础组件、worker 约束、以及 3D overlay）。

## Forge dist（必需）

Forge repo：`https://github.com/lshdlut/mujoco-wasm-forge`

- 本仓库不自带 MuJoCo WASM 二进制；运行时需要 forge 提供的 `dist/<ver>/` bundle。
- 通过 `forgeBase=`（推荐）或 `window.__FORGE_DIST_BASE__` 指定 dist base。
- 本地开发默认（`localhost/127.0.0.1`）会去找 `/mujoco-wasm-forge/dist/<ver>/`（如果你本地有同级的 `../mujoco-wasm-forge` checkout，`dev/dev_server.py` 会自动把它挂载出来）。
- 这个查看器需要带 viewer extensions 的 forge 构建（scene + vopt pointers）。
- 常见的远端 base 模板（jsDelivr + 固定 forge commit）：`https://cdn.jsdelivr.net/gh/lshdlut/mujoco-wasm-forge@<sha>/dist/{ver}/`

## 视觉来源（lighting / skybox）

- `model`（默认）：使用当前模型中由 MuJoCo 驱动的 skybox/lights。
- `preset-sun` / `preset-moon`：内置 HDRI 预设，以本仓库静态资源形式提供（forge 的 `dist/<ver>/` 不包含 HDRI）。

## 开发

- UI 生成物：`node tools/generate_ui_artifacts.mjs`
- Worker 协议生成物：`node tools/generate_worker_protocol.mjs`（生成 `dev/protocol.gen.mjs`、`dev/dispatch.gen.mjs`）
