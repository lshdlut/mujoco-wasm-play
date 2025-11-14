# Overlay Specification

## Real-time HUD
- **Trigger**: active whenever desired real-time percentage (`Simulate::percentRealTime[real_time_index]`) differs from 100 or measured slowdown mismatches by >10%.
- **Update cadence**: recomputed each frame before UI rendering in `Simulate::Render()` using `frames_`/`interval` statistics.
- **Data sources**: `Simulate::percentRealTime`, `Simulate::measured_slowdown`, `Simulate::run`.
- **Presentation**: `mjr_overlay(mjFONT_BIG, mjGRID_TOPLEFT, smallrect, rtlabel, nullptr)`; text placed above UI panels in the top-left small rectangle.

## Help Overlay (F1)
- **Toggle**: `option.help` checkbox (`F1` shortcut) stored in `Simulate::help`.
- **Update cadence**: static strings `help_title`/`help_content`; rendered each frame while `help` is non-zero.
- **Displays**: complete keyboard and mouse cheat sheet, including UI right-button hold hint.
- **Rendering**: `mjr_overlay(mjFONT_NORMAL, mjGRID_TOPLEFT, rect, help_title, help_content, ...)`.

## Info Overlay (F2)
- **Toggle**: `option.info` checkbox (`F2`), reflected in `Simulate::info`.
- **Update cadence**: `UpdateInfoText` executed every frame when `info` enabled; collects values after `Sync()`.
- **Content**: solver stats (time, constraint count, CPU cost, solver error, FPS, memory usage) derived from `mjModel`, `mjData`, timers, `Simulate::fps_`.
- **Rendering**: bottom-left overlay via `mjr_overlay(mjFONT_NORMAL, mjGRID_BOTTOMLEFT, rect, info_title, info_content, ...)`.

## Profiler Overlay (F3)
- **Toggle**: `option.profiler` (`F3`); additional forced refresh on reset, history load, keyframe load.
- **Update cadence**: `UpdateProfiler` called when `update_profiler` flag true; flag set during `Sync()` on dynamics events and when profiler enabled.
- **Figures**: four stacked `mjvFigure`s (`figtimer`, `figsize`, `figcost`, `figconstraint`) rendered in rightmost quarter of viewport.
- **Data sources**: `mjData::timer`, solver statistics, `Simulate::figsize` history, contact counts.

## Sensor Plot (F4)
- **Toggle**: `option.sensor` (`F4`).
- **Update cadence**: `UpdateSensor` executed if `update_sensor` true; triggered on reset, history loads, keyframe loads, and when sensor checkbox is active.
- **Content**: up to 10 line plots aggregated per sensor type; normalized by sensor cutoff.
- **Rendering**: right column bottom third via `ShowSensor`, width adjusts depending on profiler visibility.

## User Overlays
- **Figures**: `Simulate::user_figures_` drawn sequentially when `newfigurerequest` flag flips; consumed via `ShowFigure`.
- **Text**: `Simulate::user_texts_` loops with `ShowOverlayText` for custom HUD strings.
- **Images**: `Simulate::user_images_` via `ShowImage` drawing raw RGBA buffers.
- **Update cadence**: producer threads set `newfigurerequest/newtextrequest/newimagerequest`; render thread swaps buffers each frame when flag set.

## Screenshot Pipeline
- **Trigger**: file menu button or `Ctrl+P` sets `screenshotrequest` atomic.
- **Execution**: within render loop, `mjr_readPixels` copies full framebuffer, flips vertically, and saves PNG via `lodepng`.
- **Output path**: selected through `GetSavePath("screenshot.png")` dialog; default filename is static.

## Selection Marker HUD
- **Camera tracking**: when `pending_.select` processed, `Simulate::cam.lookat` updated and optional tracking camera engaged; corresponding UI sections flagged for refresh.
- **Warnings**: Passive mode increments `d_->warning[mjWARN_VGEOMFULL]`; overlay not drawn but info overlay surface includes warnings through stats.

## Shortcut Visibility
- Right mouse button hold within any mjUI region sets `mjuiState.mousehelp` and forces shortcut badges to render next to buttons/sections. This is a formal UX requirement for the web reproduction.
