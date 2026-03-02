# 插件开发契约（实验性）

本仓库支持可选的外部插件，它们可以在无需 fork `mujoco-wasm-play` 的情况下，注入 UI/行为。

本文档定义：
- 稳定的 DOM 挂载点（插件在此渲染 UI）。
- Host API（`window.__PLAY_HOST__`）以及 clock 语义。
- Worker 边界（MuJoCo/forge 在此运行），以及如何为新的 WASM ABI 调用扩展 worker 协议。
- 数据流期望（snapshots vs. events）与刷新率指南。

## 关键约束（Worker 后端）

默认入口点（`index.html` -> `app/main.mjs`）会在 Web Worker 内运行 MuJoCo/forge。

影响：
- UI 插件运行在主线程，**无法** 直接访问 WASM 导出（Worker 模式下没有 `window.__forgeModule`）。
- 任何新的 ABI（例如 `mjwf_smocap_*`、`mjwf_sik_*`）都必须在 worker 内调用，并通过 worker RPC（commands/events）或通过写入现有 snapshot 字段的数据，暴露给插件。

## 加载插件

插件通过动态 `import()` 加载（仅支持 ESM）。

支持的配置：
- 查询参数：`?plugins=<url1>,<url2>`
- 全局变量（必须在主模块运行之前设置）：`globalThis.PLAY_PLUGINS = ['<url1>', '<url2>']`

示例（本地开发）：加载内置演示插件：
- `http://127.0.0.1:8000/index.html?model=raj&plugins=./plugins/test_ui_sections_plugin.mjs`

说明：
- 每个条目必须是 `import()` 可用的有效 ESM 模块 URL/specifier。
- 对于跨域 URL，服务器必须允许 CORS，并以正确的 MIME 类型提供 JavaScript。
- 以 `./` 或 `../` 开头的 import specifier 会相对于仓库根目录（与 `index.html` 同级的目录）解析。

插件加载失败会通过 `logError` + `strictCatch(..., { allow: true })` 上报，并不会阻止主应用继续运行。

## 稳定的 DOM 挂载点

插件应只在 plugin mounts 中渲染，或使用 `host.ui.sections.register(...)` 注册一等的可折叠分区。避免直接修改核心面板挂载点。

插件挂载点：
- `host.mounts.leftPanelPlugin`: 左侧面板插件区域
- `host.mounts.rightPanelPlugin`: 右侧面板插件区域（面向更复杂的 demo UI）
- `host.mounts.leftPanelAfterFilePlugin`: 左侧面板中紧接内置 `File` 分区之后的插槽（推荐用于“File → Plugin → Option”的 UX）
- `host.mounts.overlayRoot`: viewer overlay 根（进度条、状态卡、HUD 覆盖等）

核心挂载点（由 viewer 拥有）：
- `host.mounts.leftPanel`
- `host.mounts.rightPanel`

这些挂载点的 HTML 来源：
- `index.html` 使用 `data-play-mount="leftPanel|rightPanel|overlayRoot|leftPanelPlugin|rightPanelPlugin"`。
- `ui/control_manager.mjs` 会在渲染内置 `File` 分区后，插入 `data-play-mount="leftPanelAfterFilePlugin"`。

## Host API（`window.__PLAY_HOST__`）

运行时 viewer 会暴露 `window.__PLAY_HOST__`，并将同一个对象传给每个插件的 register 函数。

### `host.store`

状态容器，提供：
- `host.store.get(): State`
- `host.store.update((state) => void): void`
- `host.store.replace(nextState): void`
- `host.store.subscribe((state) => void): () => void`

建议：
- 读取当前 viewer 状态（面板/覆盖层、HUD、渲染选项）。
- 将 demo 特有状态写入专用命名空间下（推荐：`state.demo.<yourDemoName>`）。

### `host.backend`

后端实例（`app/main.mjs` 中为 worker-only）。

插件常用的方法：
- `host.backend.apply(...)`（发送 UI/apply 命令）
- `host.backend.subscribe((snapshot) => void)`（原始 snapshot 流）
- `host.backend.snapshot()`（获取最新 snapshot）
- `host.backend.loadXmlText(xmlText)` / `host.backend.loadXmlBundle(...)`（重新加载模型）
- `host.backend.step(n)` / `host.backend.setRate(rate)` / `host.backend.setRunState(running, source?)`

重要：
- 在 worker 模式下，插件 **不得** 依赖直接读取 WASM 导出；应始终通过 `backend` 和/或 snapshots。
- backend surface 可能会演进；对可选调用建议做特性探测（`typeof host.backend.foo === 'function'`）。

### `host.controls`

围绕内置 UI spec 的便捷辅助：
- `host.controls.toggleControl(id, value?)`
- `host.controls.listIds(prefix?)`
- `host.controls.getControl(id)`
- `host.controls.loadXmlTextAsModel(xmlText, label?)`

控件 ID 与快捷键来自 `spec/ui_spec.json`。

### `host.ui`（UI sections + kit）

插件应 **优先使用 `host.ui`**，而不是手写可折叠块或修改核心面板 DOM。

#### 面板动作

- `host.ui.panel('left').collapseAll()`
- `host.ui.panel('left').expandAll()`
- `host.ui.panel('left').toggleAll()`
- `host.ui.panel('right')...`（同上）

这些动作会作用于选定面板内的所有 Play 分区（内置 + 插件），并持久化折叠状态。

折叠状态持久化：
- 存储位置：`localStorage` key `play:ui:v1:section_collapsed`
- key 规则：按 `(panel, sectionId)` 区分（因此 left/right 可以复用名字而互不冲突）
- 优先级：已保存状态 > `defaultOpen` / `default_open` > open

#### 注册分区（可折叠块）

无需复制 header 逻辑即可创建一个具有原生行为的可折叠分区：

- `host.ui.sections.register({ panel, sectionId, title, defaultOpen, after, before, mount, render })`

说明：
- `sectionId` **必须** 命名空间化并以 `plugin:` 开头（例如 `plugin:sik_c3d`）。
- `after`/`before` 以同面板内现有 `sectionId` 为参照插入。
- 常见“插在 File 后面”的场景，使用 `panel: 'left', after: 'file'` 或 `mount: 'leftPanelAfterFilePlugin'`。
- 若提供 `mount`（`leftPanelPlugin`、`rightPanelPlugin` 等），它必须与 `panel` 一致（若省略 `panel`，Play 也会从 `mount` 推断 `panel`）。

`render(body, ctx)` 回调会收到：
- `body`: 需要填充的 `.section-body` 元素
- `ctx`: `{ panel, sectionId, sectionEl, body, host }`
若 `render(...)` 返回函数（或 `{ dispose() }`），Play 会在 `unregister(...)` 时调用它。

注销：
- `host.ui.sections.unregister(sectionId)`

#### data 属性契约（高级 / 手写 DOM）

如果你手工构建可折叠分区（不推荐），Play 只有在元素暴露稳定的 `data-play-*` 属性时才会把它们视作分区：

- 分区根：`data-play-role="section"` + `data-play-section-id="..."`
- Header：`data-play-role="section-header"`（双击会通过事件代理触发面板展开/折叠全部）
- Toggle 按钮：`data-play-role="section-toggle"`（`aria-expanded` 由 Play 管理）
- Body：`data-play-role="section-body"`

#### UI kit（可选原语）

与 Play 样式模式一致的小型 DOM 辅助工具：

- `host.ui.kit.namedRow(labelText)` → `{ row, label, field }`
- `host.ui.kit.fullRow()` → `{ row, field }`
- `host.ui.kit.button({ label, variant, testId, onClick })`
- `host.ui.kit.textbox({ value, placeholder, testId, onInput, onChange })`
- `host.ui.kit.textarea({ value, placeholder, rows, variant, testId, onInput, onChange })` (`variant: 'default'|'code'`)
- `host.ui.kit.select({ value, options, testId, onChange })`
- `host.ui.kit.number({ value, min, max, step, testId, onInput, onChange })`
- `host.ui.kit.range({ value, min, max, step, testId, onInput, onChange })`
- `host.ui.kit.segmented({ options, value, testId, onChange })` → `{ root, inputs, value(), setValue(v) }`
- `host.ui.kit.codebox({ value, testId })` (`<pre class="codebox">`)
- `host.ui.kit.boolButton({ label, value, disabled, testId, onChange })` → `{ root, input, text }`

### `host.renderer`

渲染器辅助：
- `host.renderer.getContext()`
- `host.renderer.ensureLoop()`
- `host.renderer.renderScene(snapshot, state)`
- `host.renderer.getStats()`

### `host.renderer.overlay3d`（3D Overlay / 插件 3D 图层）

viewer 提供了一个正式的、对插件友好的 3D overlay 系统，它直接在 Three.js 世界场景中渲染。

目标：
- 让插件无需经过 worker → `mjvScene` 路径，即可绘制*被世界遮挡*（world-occluded）的 primitive/mesh。
- 提供稳定的 **layer 语义**（world vs HUD），以及正式的 **透明度策略**，避免插件之间在 `renderOrder`/`depthWrite` 上互相打架。
- 提供带 scope 的 **AssetRegistry**（引用计数，scope dispose 时自动释放），以防止 GPU/内存泄漏以及误释放共享资源。

入口点：
- `host.renderer.getOverlay3D()` → 返回 overlay manager（如果渲染器尚未就绪则返回 `null`）
- `host.renderer.overlay3d.get()` → 同上
- `host.renderer.overlay3d.createScope(scopeId, options?)` → 便捷封装（`get()` + `createScope`）
- `host.renderer.overlay3d.getScope(scopeId)` → 便捷封装（`get()` + `getScope`）

#### 图层（Layers）

每个 scope 有各 layer 的 root（以下 API 中使用的字符串）：
- `worldOpaque`: 普通 world 对象（depth-tested；面向不透明材质）
- `worldTransparent`: 面向 alpha blending 的 world 对象（depth-tested；当 opacity < 1 时默认关闭 depth-write）
- `worldOverlay`: 被世界遮挡的 overlay，且应在基础 world 之后绘制（选中高亮、gizmo）
- `hud`: 永远置顶的 overlay（默认关闭 depth-test）

#### Instanced Primitive（SoA writer + commit）

当你需要绘制大量轻量 primitive（marker/arrow 等）时，请使用 instancing。这是面向大数量的推荐路径。

`scope.createInstancedMeshBatch({ ... })` 会返回：
- `batch.writer.pos` (`Float32Array`, length = `capacity * 3`)
- `batch.writer.quat` (`Float32Array`, length = `capacity * 4`, quaternion xyzw)
- `batch.writer.scale` (`Float32Array`, length = `capacity * 3`)
- `batch.writer.rgb` (`Float32Array`, length = `capacity * 3`, linear rgb multipliers)
- `batch.commit({ count })`（锁存作者缓冲；在帧屏障处原子刷新）
- `batch.setTransparency(spec)`（更新透明度策略与排序）

Commit 是 **延迟** 的：它不会立即上传到 GPU。Play 会在每个渲染帧（`host.clock.onFrame`）刷新所有待提交的 overlay commit，在核心 MuJoCo 场景更新之后，因此 overlays 永远不会超前/落后模型姿态。

关键 options：
- `primitive`: `'sphere' | 'box' | 'cylinder' | 'capsule' | 'cone'`（通过 AssetRegistry 共享几何体）
- `capacity`: 该 batch 的最大 instance 数量
- `layer`: 上述 layer id 之一
- `transparency`: 策略对象（见下文）

#### 透明度策略（instancing）

透明 instancing 是系统级问题：Three.js 不会自动为 instances 做 depth sort。overlay 系统提供了显式的策略 surface，避免每个插件都各自搞 hack。

`transparency` 字段（`createInstancedMeshBatch` 与 `batch.setTransparency` 均支持）：
- `mode`: `'opaque' | 'blend'`（在 `worldTransparent` 下默认为 `'blend'`，其它图层默认为 `'opaque'`）
- `opacity`: `0..1`（当 `< 1` 时启用 blend 模式）
- `sortMode`: `'nosort' | 'bins' | 'strict' | 'inherit'`
  - `nosort`: 不做 per-instance 排序；最快
  - `bins`: 粗粒度深度分箱；适合大数量的默认方案
  - `strict`: per-instance 深度排序；质量最好，但 CPU 成本更高
- `bins`: `1..16`（当 `sortMode='bins'` 时使用）
- `update`: `'commit' | 'frame' | 'inherit'`
  - `commit`: 仅在 `commit()` 被 flush（帧屏障）时排序/上传
  - `frame`: 相机移动时也会重排（render-loop hook）
- `every`: integer `>= 1`（当 `update='frame'` 时，每 N 帧才重排一次）
- `depthTest`, `depthWrite`, `toneMapped`: 高级材质开关（可选）

新 batch 的全局默认值：
- `overlay = host.renderer.overlay3d.get()`
- `overlay.setTransparencyDefaults({ sortMode, bins, update, every })`

#### 资源（引用计数，作用域）

每个 scope 都暴露了 `scope.assets` 辅助函数。通过 `scope.assets.*` 获取的 handle 会在 scope 被 dispose 时自动 release。

常用 helper：
- `scope.assets.geometryPrimitive(kind)` → `{ asset: BufferGeometry, release() }`
- `scope.assets.texture2DFromUrl(url, options?)` → `{ asset: Texture, release() }`
- `scope.assets.acquire(key, createFn, { dispose? })` → 通用的引用计数资源 handle

#### 示例（instanced 的透明 marker）

```js
export function registerPlayPlugin(host) {
  const overlay = host.renderer.overlay3d.get();
  const scope = overlay.createScope('demo:markers');

  const batch = scope.createInstancedMeshBatch({
    primitive: 'sphere',
    capacity: 2000,
    layer: 'worldTransparent',
    transparency: { mode: 'blend', opacity: 0.35, sortMode: 'bins', bins: 8, update: 'frame' },
  });

  const { pos, quat, scale, rgb } = batch.writer;
  const tmp = { x: 0, y: 0, z: 0 };

  const off = host.clock.onFrame(() => {
    const n = 2000;
    for (let i = 0; i < n; i += 1) {
      const p = i * 3;
      pos[p + 0] = (i % 50) * 0.05;
      pos[p + 1] = Math.floor(i / 50) * 0.05;
      pos[p + 2] = 0.2;
      scale[p + 0] = 0.01;
      scale[p + 1] = 0.01;
      scale[p + 2] = 0.01;
      rgb[p + 0] = 1;
      rgb[p + 1] = 0.2;
      rgb[p + 2] = 0.2;
      const q = i * 4;
      quat[q + 0] = 0;
      quat[q + 1] = 0;
      quat[q + 2] = 0;
      quat[q + 3] = 1;
    }
    batch.commit({ count: n });
  });

  return () => {
    off();
    scope.dispose();
  };
}
```

### `host.getSnapshot()`

返回 UI 线程当前持有的最新 snapshot（初始加载期间可能为 `null`）。

### `host.clock`

面向不同工作负载的时间 hook：
- `host.clock.onSnapshot(fn)`: 每次后端 snapshot 合并进 store 后调用（`fn({ snapshot, state, nowMs })`）。
- `host.clock.onFrame(fn)`: 渲染帧屏障（`fn({ snapshot, state, nowMs, frame })`，可能是 60Hz+）。
- UI lanes（节流；面向 DOM/UI 工作）：
  - `host.clock.onUiMainTick(fn)`（别名：`onUiTick`）：主 UI tick（默认 `ui_ms=33`，不与 snapshot 对齐）。
  - `host.clock.onUiControlsTick(fn)`: 用于昂贵 control 同步的慢速 UI lane（interval = `max(ui_ms, 120ms)`，并由 UI 主 tick 量化）。
  - `host.clock.onUiSlowTick(fn)`: 面向重卡片/大表格的慢速 UI lane（默认 `ui_slow_ms=1000`，并由 UI 主 tick 量化）。

推荐用法：
- 使用 `onSnapshot` 做与 snapshot 对齐的逻辑/状态派生。
- 使用 `onFrame` 做渲染可见的工作（overlay commits、逐帧动画）。
- 使用 `onUiMainTick`/`onUiTick` 做普通 DOM 更新（label、卡片、进度条）。
- 使用 `onUiControlsTick` 做不需要 30–60Hz 的昂贵 DOM 工作。
- 使用 `onUiSlowTick` 做非常重的 UI 工作（1–5Hz）。

### 日志与错误上报

插件应使用 host 提供的日志工具：
- `host.logStatus(...)`, `host.logWarn(...)`, `host.logError(...)`
- `host.strictCatch(err, context, { allow?: boolean })`

## 插件模块契约

插件模块应导出以下之一：
- `export function registerPlayPlugin(host) { ... }`, 或
- `export default function (host) { ... }`

注册函数可以选择性返回：
- 一个 disposer 函数 `() => { ... }`，或
- 一个带 `dispose()` 的对象

Disposer 会在页面卸载（`beforeunload`）时被调用。插件应清理：
- `store.subscribe()` 的取消订阅函数
- `clock.on*()` 的取消订阅函数
- DOM 事件监听器
- timers / `requestAnimationFrame` 循环

## Worker 协议扩展（用于新的 WASM ABI 调用）

如果你的 demo 需要在 forge WASM 内实现新功能（例如 smocap/SIK），你需要提供一个 worker RPC surface。

### 为什么必须这样做

在 worker 后端模式下，MuJoCo/forge 会在 worker（`worker/physics.worker.mjs`）中被实例化并由其拥有。主线程无法访问 WASM 导出、指针或 heap。因此任何新的 ABI 调用都必须：
1) 在 worker 内调用，并且
2) 由主线程发送的命令驱动，并且
3) 通过现有 snapshots（推荐）或在需要时通过新的 events 来观测。

### 协议由生成器生成并进行校验

worker command/event allow-list 位于生成文件中：
- `worker/protocol.gen.mjs`（command/event 列表 + 字段 schema + transfer 字段）
- `worker/dispatch.gen.mjs`（运行时校验/dispatch）

不要手工编辑这些文件。请修改生成器并重新生成：
- Generator: `tools/generate_worker_protocol.mjs`
- Regenerate: `npm run generate:protocol`

### 在哪里实现新的 command/event

典型触点：
- Worker handlers: `worker/physics.worker.mjs`（在命令 dispatch map 下添加新的 handler）。
- Main-thread wrapper: `backend/backend_core.mjs`（在 `backend` 上暴露方法，和/或通过 `backend.apply` 路由）。
- 可选的 store merge: `ui/state.mjs`（仅当你希望把 worker snapshots/events 以结构化方式反映到 `store` 中）。

### 设计规则（推荐）

- 优先把结果写入 `mjData`，这样它们会自然出现在现有 snapshots 中。
  - 例：如果 smocap 产生目标姿态，写入 mocap bodies、qpos、ctrl 等。
- 对于不属于 sim state 的“debug/status”数据，使用专用事件（低频）：
  - 错误码 + 消息、solver residuals、active marker 列表等。
- 让 payload 适配 structured-clone：使用 primitives、plain objects/arrays，以及 TypedArrays。
- 对于大的二进制 payload，使用 `ArrayBuffer`/TypedArrays，并在 `postMessage(..., [buffer])` 中 transfer buffer 以避免拷贝。

## 数据流：Snapshots vs. Events

高频数据主通道是 worker 的 `snapshot` 事件。很多 snapshot 字段是 TypedArrays，会通过 `postMessage` 的 transfer list 进行 zero-copy 传输。

面向 demos 的建议：
- 如果你的功能可以通过更新 sim state（mjData/mjModel 相关状态）来表达，请在 worker 中实现，并在 UI 侧从 snapshots 中消费。
- 仅当你需要额外数据时才添加自定义 events，这些数据：
  - 不属于 `mjData`/render state，和/或
  - 太昂贵/太大，不适合每个 snapshot 都发送。

如果你确实要添加新的 snapshot 字段，还必须考虑：
- 是否应将其加入 snapshot transfer list（以避免拷贝），以及
- 是否会影响 snapshot 的大小/延迟（尤其在 60–120Hz 时）。

## 刷新率指南

本查看器有意解耦：
- 物理步进（worker 内部 tick）与
- snapshot 投递（自适应 snapshotHz）与
- DOM 更新（UI tick，默认约 30Hz）。

推荐分层：
- 仿真/姿态渲染：跟随 snapshotHz（自适应；由 worker 控制）。
- 主 UI 面板更新：约 30Hz（`onUiMainTick`/`onUiTick` + 变更检测）。
- 控件密集的 UI 同步：约 8Hz（`onUiControlsTick`，默认 `max(ui_ms, 120ms)`）。
- 重型状态卡 / 调试表格：1–5Hz（`onUiSlowTick`，默认 `ui_slow_ms=1000`）。

常用 URL 参数：
- `ui_ms=<16..2000>`: UI tick 的毫秒间隔。
- `ui_slow_ms=<200..10000>`: 一些内置卡片使用的更慢 UI 间隔。

## Forge Dist / 自定义 WASM 产物

要使用自定义 forge 构建（例如 MuJoCo + smocap 扩展），可以通过：
- `forgeBase=<dist-base-url>`（查询参数），或
- `window.__FORGE_DIST_BASE__`（必须在主模块运行之前设置）。

在 worker 模式下，worker URL 会在 spawn 时从页面 URL 继承 `forgeBase`。运行时切换 forge 产物当前不属于稳定插件契约；预期在更改 `forgeBase` 时需要刷新页面。

## 最小示例

```js
export function registerPlayPlugin(host) {
  const root = host.mounts.rightPanelPlugin;
  const card = document.createElement('section');
  card.className = 'plugin-card';
  card.textContent = 'Hello from plugin';
  root.appendChild(card);

  const onUiMain = host.clock.onUiMainTick || host.clock.onUiTick;
  const off = onUiMain(({ state }) => {
    card.dataset.run = state?.simulation?.run ? '1' : '0';
  });

  return () => {
    off();
    card.remove();
  };
}
```

## 参考

- Mounts and layout: `index.html`
- Host API + plugin loader: `app/main.mjs`
- Backend implementation (worker spawn, subscription API): `backend/backend_core.mjs`
- Store snapshot merge helpers: `ui/state.mjs`（`mergeBackendSnapshot`）
- Worker runtime (MuJoCo/forge owner): `worker/physics.worker.mjs`
- Protocol generator: `tools/generate_worker_protocol.mjs`
- Built-in UI controls + shortcuts: `spec/ui_spec.json`
- Overlay implementation (scopes/layers/transparency/assets): `renderer/overlay3d.mjs` (`ensureOverlay3D`)
