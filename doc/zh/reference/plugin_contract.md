# 插件契约

本页面为权威参考。

本页面是 Play 的 **权威** 插件开发契约。

- 范围：UI 注入、稳定 DOM 挂载点、Host API（`window.__PLAY_HOST__`）、Worker 边界约束，以及 3D overlay 系统。
- 状态：实验性（预计会迭代），但在可行范围内应尽量保持兼容。

```{include} ../_includes/plugin_dev.md
```

## 附录：Host API 备注

运行时 Host 对象包含一些在编写插件时很有用的工具字段：

- `host.apiVersion`：数值型契约版本。
- `host.contract`：当前契约的元数据（目前为 `{ apiVersion: 1 }`）。
- `host.getSnapshot()`：返回主线程观察到的最新 snapshot。
- `host.capabilities` / `host.getCapability(name)`：可选 surface 的能力开关。
- `host.extensions`：插件自用的状态存放对象（Host 对象会被 `Object.freeze` 冻结）。
- `host.clock`：订阅辅助函数：
  - `onUiTick` / `onUiMainTick`
  - `onUiControlsTick`
  - `onUiSlowTick`
  - `onSnapshot`
  - `onFrame`（渲染帧回调）
- 日志辅助：`host.logStatus`、`host.logWarn`、`host.logError`。
- `host.strictCatch(err, context, options?)`：strict-mode 错误记账。
