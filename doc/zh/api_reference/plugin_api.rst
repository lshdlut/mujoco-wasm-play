插件 API（Host API）
=====================

插件通过运行时暴露的 Host 对象与 Play 交互：

.. code-block:: text

  window.__PLAY_HOST__

本页面枚举可调用 surface。关于语义、约束与示例，见 :doc:`/reference/plugin_contract`。

注册
------------

插件模块通过动态 ``import()`` 加载，必须导出以下之一：

- ``registerPlayPlugin(host)`` (命名导出)，或
- 一个默认导出函数 ``(host) => disposer``

注册函数可以返回：

- 一个 disposer 函数 ``() => void``，或
- 一个带 ``dispose(): void`` 的对象

Host 对象（v1）
----------------

Host API 是一个普通的 JavaScript 对象。下面的 TypeScript-like 形状用于开发者参考：

.. code-block:: ts

  type PanelId = "left" | "right";
  type UiMount =
    | "leftPanel" | "rightPanel" | "overlayRoot"
    | "leftPanelAfterFilePlugin" | "leftPanelPlugin" | "rightPanelPlugin";

  interface ViewerControlsApi {
    // Debug/inspection helpers (not part of the stable plugin contract).
    getBinding(id: string): unknown | null;

    // Convenience helpers around the built-in UI spec.
    listIds(prefix?: string): string[];
    toggleControl(id: string, value?: unknown): Promise<void> | void;
    getControl(id: string): UiControl | null;
    loadXmlTextAsModel(xmlText: string, label?: string): Promise<void> | void;
  }

  interface ViewerRendererApi {
    getStats(): Record<string, unknown>;
    getContext(): unknown | null;
    ensureLoop(): void;
    renderScene(snapshot: unknown, state: unknown): void;
    getOverlay3D(): unknown | null;
    overlay3d: {
      get(): unknown | null;
      createScope(scopeId: string, options?: unknown): unknown | null;
      getScope(scopeId: string): unknown | null;
    };
  }

  interface ViewerStore<State = unknown> {
    get(): State;
    replace(next: State): void;
    update(mutator: (state: State) => void): void; // mutates in-place
    subscribe(fn: (state: State) => void): () => void;
  }

  interface UiPanelApi {
    root: HTMLElement | null;
    collapseAll(): { changed: number; collapsed: boolean };
    expandAll(): { changed: number; collapsed: boolean };
    toggleAll(): { changed: number; collapsed: boolean | null };
  }

  interface UiSectionHandle {
    panel: PanelId;
    sectionId: string;
    sectionEl: HTMLElement;
    body: HTMLElement;
    setCollapsed(collapsed: boolean): void;
    collapse(): void;
    expand(): void;
    toggle(): void;
    dispose(): void;
  }

  interface UiSectionSpec {
    panel?: PanelId;
    sectionId: string;   // must start with "plugin:"
    title?: string;
    defaultOpen?: boolean;
    after?: string;
    before?: string;
    mount?: UiMount;
    render(body: HTMLElement, ctx: { panel: PanelId; sectionId: string; sectionEl: HTMLElement; body: HTMLElement; host: PlayHostV1 }): (void | (() => void) | { dispose(): void });
  }

  interface UiSectionsApi {
    register(spec: UiSectionSpec): UiSectionHandle;
    unregister(sectionId: string): boolean;
    get(sectionId: string): UiSectionHandle | null;
    list(): string[];
  }

  interface UiKit {
    namedRow(labelText: string, options?: { full?: boolean; half?: boolean }): { row: HTMLElement; label: HTMLLabelElement; field: HTMLElement };
    fullRow(options?: { half?: boolean }): { row: HTMLElement; field: HTMLElement };
    button(options: { label: string; variant?: "primary" | "secondary" | "pill"; testId?: string | null; onClick?: (ev: MouseEvent) => void }): HTMLButtonElement;
    textbox(options?: { value?: string; placeholder?: string; testId?: string | null; onInput?: (ev: Event, value: string) => void; onChange?: (ev: Event, value: string) => void }): HTMLInputElement;
    textarea(options?: { value?: string; placeholder?: string; rows?: number; variant?: "default" | "code"; testId?: string | null; onInput?: (ev: Event, value: string) => void; onChange?: (ev: Event, value: string) => void }): HTMLTextAreaElement;
    select(options?: { value?: string; options?: string[]; testId?: string | null; onChange?: (ev: Event, value: string) => void }): HTMLSelectElement;
    number(options?: { value?: number; min?: number; max?: number; step?: number; testId?: string | null; onInput?: (ev: Event, value: number) => void; onChange?: (ev: Event, value: number) => void }): HTMLInputElement;
    range(options?: { value?: number; min?: number; max?: number; step?: number; testId?: string | null; onInput?: (ev: Event, value: number) => void; onChange?: (ev: Event, value: number) => void }): HTMLInputElement;
    segmented(options: { options: Array<{ value: string; label: string }>; value: string; testId?: string | null; onChange?: (ev: Event, value: string) => void }): { root: HTMLElement; inputs: HTMLInputElement[]; value(): string; setValue(v: string): void };
    codebox(options?: { value?: string; testId?: string | null }): HTMLElement;
    boolButton(options: { label: string; value: boolean; disabled?: boolean; testId?: string | null; onChange?: (ev: Event, value: boolean) => void }): { root: HTMLElement; input: HTMLInputElement; text: HTMLElement };
  }

  interface UiApi {
    panel(panel: PanelId): UiPanelApi;
    sections: UiSectionsApi;
    kit: UiKit;
  }

  interface PlayClockApi<Snapshot = unknown, State = unknown> {
    onUiTick(fn: (ctx: { snapshot: Snapshot | null; state: State; nowMs: number }) => void): () => void;
    onUiMainTick(fn: (ctx: { snapshot: Snapshot | null; state: State; nowMs: number }) => void): () => void; // alias of onUiTick
    onUiControlsTick(fn: (ctx: { snapshot: Snapshot | null; state: State; nowMs: number }) => void): () => void;
    onUiSlowTick(fn: (ctx: { snapshot: Snapshot | null; state: State; nowMs: number }) => void): () => void;
    onSnapshot(fn: (ctx: { snapshot: Snapshot; state: State; nowMs: number }) => void): () => void;
    onFrame(fn: (ctx: unknown) => void): () => void;
  }

  interface PlayHostV1 {
    apiVersion: 1;
    capabilities: {
      mounts: true;
      ui: true;
      store: true;
      backend: true;
      controls: true;
      renderer: true;
      clock: true;
      overlay3d: true;
    };
    mounts: {
      leftPanel: HTMLElement | null;
      rightPanel: HTMLElement | null;
      overlayRoot: HTMLElement | null;
      leftPanelAfterFilePlugin: HTMLElement | null;
      leftPanelPlugin: HTMLElement | null;
      rightPanelPlugin: HTMLElement | null;
    };
    ui: UiApi;
    store: ViewerStore;
    backend: unknown;  // see :doc:`/api_reference/js_api`
    controls: ViewerControlsApi;
    renderer: ViewerRendererApi;
    getSnapshot(): unknown | null;
    clock: PlayClockApi;
    logStatus(message: string, extra?: unknown): void;
    logWarn(message: string, extra?: unknown): void;
    logError(message: string, extra?: unknown): void;
    strictCatch(err: unknown, context: string, options?: { allow?: boolean }): unknown;
  }

Viewer state 类型
------------------

viewer store state 是一个很大的对象。仓库中提交了一个 TypeScript 定义用于 tooling，并作为最完整的“字段列表”参考：

.. literalinclude:: ../../../dev/viewer_state_types.ts
  :language: ts
