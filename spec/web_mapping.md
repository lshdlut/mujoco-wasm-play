# Web Mapping Plan

## Layout Targets
- **Viewport split**: mirror native simulate window with two fixed-width sidebars.
  - Left panel (`ui0`): 320 px width, anchored flush-left; scrolling independent from canvas.
  - Right panel (`ui1`): 320 px width, anchored flush-right; toggled via Tab/Shift+Tab.
  - Central canvas: fills remaining width, maintains aspect using letterbox margins. Reserve 48 px top padding for overlay badges.
- **Top badges**: real-time HUD and help/info overlays render inside an `OverlayPortal` stacked above canvas but below dropdown menus.
- **Bottom bar**: reuse existing transport bar (if any) to host playback duplicates; hide if left panel open to avoid double controls.

## UI Component Mapping
| mjUI Section | Web Component | Data Binding | Notes |
|--------------|---------------|--------------|-------|
| File | `<ViewerToolbarSection id="file">` | dispatch actions to `backend.file.*` RPCs | Buttons emit promises; screenshots reuse canvas capture helper |
| Option | `<ToggleList group="option">` | `uiState.option.*` (Recoil/Zustand store) | Toggle updates state then posts message to worker (`setOverlay`, `setFullscreen`, `setVSync`) |
| Simulation | `<SimulationControls>` | `uiState.simulation` + backend RPC `setRun`, `reset`, `reload`, `align`, `copyState` | Key slider and history slider share timeline reducer |
| Watch | `<DataInspector>` | `uiState.watch` + worker query `getDataField` | Debounce field text, show validation chips |
| Physics | `<AccordionSection id="physics">` | `worker.setOption(field, value)` (MJCF option mirror) | Auto-close separators default; contact override + actuator toggle share subpanels |
| Rendering | `<RenderingPanel>` | `worker.setVisualOption`, `worker.setSceneFlag` | Camera dropdown merges base options + dynamic camera list fetched from snapshot |
| Visualization | `<VisualizationPanel>` | `worker.setVisualParam` | Use grouped tabs (Headlight/Free Cam/Global/Map/Scale/RGBA) to avoid vertical overflow |
| Group enable | `<VisibilityMatrix>` | `worker.setGroupVisibility` | Provide keyboard mnemonics badges identical to simulate |
| Joint | `<JointSliderList>` | streaming snapshot of `qpos` respecting joint filters | Virtualized list to handle large models |
| Control | `<ControlSliderList>` | binder to `ctrl` channel; read-only state when group disabled | Provide “clear all” CTA pinned at top |
| Equality | `<ConstraintToggleList>` | `worker.setEqualityActive(i, bool)` | Label uses equality name fallbacks |

## Backend API Contract
- Expose `setOption(path, value)`, `setVisual(path, value)`, `setSceneFlag(index, value)`, `setGroupVisibility(kind, index, bool)`.
- Provide `setRunState(bool)`, `step(direction)`, `scrubHistory(index)`, `loadKey(index)`, `saveKey(index)`, `requestCopyState(precision)`.
- Snapshot channel extends existing `forge` worker to emit:
  - `option` (`mjOption`), `visual` (`mjVisual`), `stat` (`mjStatistic`), `sceneFlags`, `groups`, `jointMeta`, `actuatorMeta`, `profiler`, `sensor`, `info`.
- Keyboard manager reads `spec/keymap.csv` at build time to register shortcuts dynamically (Space, Arrows, `[`, `]`, `F` keys, etc.).

## Data Flow Summary
```
UI event → store update → postMessage({kind, payload}) → worker mutates mjOption/mjVisual etc → worker posts snapshot diff → store patch → components rerender
```
- All numeric editors share `<NumericField>` with immediate commit + optional “lock while dragging” behaviour.
- Color editors use `<RgbaPicker>` hooking to 4-element arrays.

## Overlay Implementation
- **Help**: render markdown converted from `help_title/help_content` (line-per-entry). Provide right-click UI tip inside overlay.
- **Info**: display key/value grid; update via snapshot `info` payload from worker (rebuilt using existing `UpdateInfoText` logic ported to Wasm worker).
- **Profiler**: reuse `<StackedCharts>` component; sampling frequency matches worker update rate (per physics step). Accept downsampled arrays from worker.
- **Sensor**: render grouped bar charts; request sensor data as normalized arrays identical to `figsensor` lines.
- **Real-time HUD**: compute in UI from snapshot fields (`real_time_index`, `measured_slowdown`, `run`).

## Input Handling Parity
- Pointer lock for canvas replicates orbit/pan/zoom semantics. Use `Keyboard+MouseController` that maps combos from `spec/keymap.csv`.
- Right-button hold in sidebar surfaces inline tooltip overlay showing shortcuts (mirrors `mousehelp`).
- History scrub slider reuses `<TimelineSlider>` with hotkeys `Left/Right`, plus `[ ]` integration for camera.

## Testing Hooks
- Export helper `specLoader.load('spec/ui_spec.json')` so Playwright tests can iterate controls.
- Provide deterministic snapshot diff endpoints for Profiler/Info/Sensor overlays to compare against reference JSON dumps.

## Pixel Fidelity Notes
- Font scale options map to CSS variable `--viewer-font-scale` values (0.5, 1.0, 1.5, ...).
- Sidebar background/spacing values follow `mjui_themeSpacing` & `mjui_themeColor`; replicate by sampling theme palette JSON derived from MuJoCo defaults.
- Buttons align vertically with 4 px gutters; separators collapsed by default except sections flagged open in spec (Physics physical params, etc.).
