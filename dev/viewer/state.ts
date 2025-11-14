// Type definitions and re-exports for the runtime state helpers located in
// state.mjs. This file allows TypeScript-aware tooling to reason about the
// viewer store while keeping the browser-consumable implementation in plain JS.

export interface OverlayState {
  help: boolean;
  info: boolean;
  profiler: boolean;
  sensor: boolean;
  fullscreen: boolean;
  vsync: boolean;
  busywait: boolean;
  pauseUpdate: boolean;
}

export interface SimulationState {
  run: boolean;
  scrubIndex: number;
  keyIndex: number;
  realTimeIndex: number;
}

export interface RuntimeState {
  cameraIndex: number;
  cameraLabel: string;
  lastAction: string;
  gesture: GestureState;
  drag: DragState;
  lastAlign: AlignRuntimeState;
  lastCopy: CopyRuntimeState;
}

export interface PanelState {
  left: boolean;
  right: boolean;
}

export interface PhysicsState {
  disableFlags: Record<string, boolean>;
  enableFlags: Record<string, boolean>;
  actuatorGroups: Record<string, boolean>;
}

export interface RenderingState {
  voptFlags: boolean[];
  sceneFlags: boolean[];
  labelMode: number;
  frameMode: number;
}

export interface HudState {
  time: number;
  frames: number;
  fps: number;
  rate: number;
  ngeom: number;
  pausedSource: string;
  rateSource: string;
}

export interface HistoryState {
  captureHz: number;
  capacity: number;
  count: number;
  horizon: number;
  scrubIndex: number;
  live: boolean;
}

export interface WatchState {
  field: string;
  index: number;
  value: number | null;
  min: number | null;
  max: number | null;
  samples: number;
  status: string;
  valid: boolean;
  summary: string;
  sources: Record<string, { length?: number; label?: string }>;
}

export interface KeyframeState {
  capacity: number;
  count: number;
  labels: string[];
  slots: Array<{ index: number; label: string; kind: string; available: boolean }>;
  lastSaved: number;
  lastLoaded: number;
}

export interface ToastState {
  message: string;
  ts: number;
}

export interface DragState {
  dx: number;
  dy: number;
}

export interface GesturePointer {
  x: number;
  y: number;
  dx: number;
  dy: number;
  buttons: number;
  pressure: number;
}

export interface GestureState {
  mode: string;
  phase: string;
  pointer?: GesturePointer | null;
}

export interface AlignRuntimeState {
  seq: number;
  center: [number, number, number];
  radius: number;
  timestamp: number;
  source: string;
}

export interface CopyRuntimeState {
  seq: number;
  precision: string;
  nq: number;
  nv: number;
  timestamp: number;
  qposPreview: number[];
  qvelPreview: number[];
  complete: boolean;
}

export interface ViewerState {
  overlays: OverlayState;
  simulation: SimulationState;
  runtime: RuntimeState;
  panels: PanelState;
  physics: PhysicsState;
  rendering: RenderingState;
  hud: HudState;
  toast: ToastState | null;
  history: HistoryState;
  watch: WatchState;
  keyframes: KeyframeState;
}

export interface UiControl {
  item_id: string;
  type: string;
  label?: string;
  name?: string;
  binding?: string;
  options?: string[] | string;
}

export interface ViewerStore {
  get(): ViewerState;
  replace(state: Partial<ViewerState> | ViewerState): void;
  update(mutator: (draft: ViewerState) => void): void;
  subscribe(listener: (state: ViewerState) => void): () => void;
}

export interface BackendUiApplyPayload {
  kind: 'ui';
  id: string;
  value: unknown;
  control: UiControl;
}

export interface GestureApplyPayload {
  kind: 'gesture';
  mode: string;
  phase?: string;
  pointer?: Partial<GesturePointer>;
  drag?: Partial<DragState>;
}

export type BackendApplyPayload = BackendUiApplyPayload | GestureApplyPayload;

export interface BackendSnapshot {
  t: number;
  rate: number;
  paused: boolean;
  ngeom: number;
  nq?: number;
  nv?: number;
  pausedSource?: string;
  rateSource?: string;
  gesture?: GestureState;
  drag?: DragState;
  voptFlags?: number[];
  sceneFlags?: number[];
  labelMode?: number;
  frameMode?: number;
  cameraMode?: number;
  align?: AlignRuntimeState | null;
  copyState?: CopyRuntimeState | null;
  history?: {
    captureHz?: number;
    capacity?: number;
    count?: number;
    horizon?: number;
    scrubIndex?: number;
    live?: boolean;
  } | null;
  keyframes?: {
    capacity?: number;
    count?: number;
    labels?: string[];
    slots?: Array<{ index?: number; label?: string; kind?: string; available?: boolean }>;
    lastSaved?: number;
    lastLoaded?: number;
  } | null;
  watch?: {
    field?: string;
    index?: number;
    value?: number | null;
    min?: number | null;
    max?: number | null;
    samples?: number;
    status?: string;
    valid?: boolean;
    summary?: string;
  } | null;
  watchSources?: Record<string, { length?: number; label?: string }>;
  keyIndex?: number;
}

export interface ViewerBackend {
  kind: string;
  apply(payload: BackendApplyPayload): Promise<BackendSnapshot | undefined> | BackendSnapshot | undefined;
  snapshot(): Promise<BackendSnapshot> | BackendSnapshot;
  subscribe(listener: (snapshot: BackendSnapshot) => void): () => void;
  step?(direction?: number): Promise<BackendSnapshot | undefined> | BackendSnapshot | undefined;
  setCameraIndex?(index: number): Promise<BackendSnapshot | undefined> | BackendSnapshot | undefined;
  setRunState?(run: boolean, source?: string): Promise<BackendSnapshot | undefined> | BackendSnapshot | undefined;
  dispose?(): void;
}

export {
  DEFAULT_VIEWER_STATE,
  createViewerStore,
  applySpecAction,
  applyGesture,
  createBackend,
  readControlValue,
  cameraLabelFromIndex,
  mergeBackendSnapshot,
} from './state.mjs';
