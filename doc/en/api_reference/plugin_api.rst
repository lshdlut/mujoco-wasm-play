Plugin API (Host API)
=====================

Plugins interact with Play via the Host object exposed at runtime:

.. code-block:: text

  window.__PLAY_HOST__

This page enumerates the callable surface. For semantics, constraints, and
examples, see :doc:`/reference/plugin_contract`.

Registration
------------

A plugin module is loaded via dynamic ``import()`` and must export either:

- ``registerPlayPlugin(host)`` (named export), or
- a default export function ``(host) => disposer``

The register function may return:

- a disposer function ``() => void``, or
- an object with ``dispose(): void``

Host object (v1)
----------------

The Host API is a plain JavaScript object. This TypeScript-like shape is meant
as a developer reference:

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

Viewer state types
------------------

The viewer store state is a large object. A TypeScript definition is committed
for tooling and serves as the most complete "field list" reference:

.. literalinclude:: ../../../dev/viewer_state_types.ts
  :language: ts
