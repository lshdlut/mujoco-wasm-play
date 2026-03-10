import { DEFAULT_REALTIME_INDEX, REALTIME_LEVELS } from '../core/viewer_defaults.mjs';
import {
  isPerfEnabled,
  perfNow,
  perfSample,
  logWarn,
  strictCatch,
} from '../core/viewer_runtime.mjs';
import {
  getSnapshotHud,
  getSnapshotInfo,
  getSnapshotOptions,
  getSnapshotSimulation,
} from '../core/snapshot_selectors.mjs';

function formatArenaBytes(bytes) {
  const n = Number(bytes) || 0;
  if (n <= 0) return '0B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let idx = 0;
  let value = n;
  while (value >= 1024 && idx < units.length - 1) {
    value /= 1024;
    idx += 1;
  }
  if (value >= 100) return `${Math.round(value)}${units[idx]}`;
  return `${value.toFixed(1)}${units[idx]}`;
}

export function createUiRuntime({
  store,
  rendererManager,
  renderCtx,
  getSnapshot,
  updateControls,
  rightPanelRuntime,
  leftPanel,
  rightPanel,
  overlayRealtime,
  overlayHelp,
  overlayInfo,
  overlayProfiler,
  overlaySensor,
  toastEl,
  resizeCanvas,
  queueResizeCanvas,
  snapshotSubscribers,
  uiTickSubscribers,
  uiControlsTickSubscribers,
  uiSlowTickSubscribers,
  windowTarget = null,
  documentTarget = null,
  uiUpdateIntervalMs = 33,
  uiSlowUpdateIntervalMs = 1000,
}) {
  let renderStats = { drawn: 0, hidden: 0 };
  let fpsEstimate = 0;
  let lastFpsFrameSample = 0;
  let lastFpsSampleTimeMs = perfNow();

  const panelStateCache = {
    left: null,
    right: null,
    fullscreen: null,
  };
  const overlayStateCache = {
    help: null,
    info: null,
    profiler: null,
    sensor: null,
  };

  let infoTimeEl = null;
  let infoFpsEl = null;
  let infoSizeEl = null;
  let infoCpuEl = null;
  let infoSolverEl = null;
  let infoEnergyEl = null;
  let infoFwdinvEl = null;
  let lastLayoutKey = null;
  let lastFontIndex = null;
  let pendingUiFrame = false;
  let pendingUiState = null;
  let pendingUiSnapshot = null;
  let lastUiUpdateMs = 0;
  let lastControlsUpdateMs = 0;
  let lastUiSlowUpdateMs = 0;
  let lastInfoOverlayVisible = false;

  function updateRenderStats(stats) {
    renderStats = { ...renderStats, ...stats };
    const frame = Number(stats?.frame);
    const now = perfNow();
    if (!Number.isFinite(frame) || frame <= lastFpsFrameSample) return;
    const deltaFrame = frame - lastFpsFrameSample;
    const deltaMs = Math.max(1, now - lastFpsSampleTimeMs);
    const instFps = (deltaFrame * 1000) / deltaMs;
    if (Number.isFinite(instFps) && instFps > 0) {
      if (!Number.isFinite(fpsEstimate) || fpsEstimate <= 0) {
        fpsEstimate = instFps;
      } else {
        const alpha = 0.2;
        fpsEstimate = fpsEstimate * (1 - alpha) + instFps * alpha;
      }
      lastFpsFrameSample = frame;
      lastFpsSampleTimeMs = now;
    }
  }

  function getRenderStats() {
    return { ...renderStats };
  }

  function updateOverlay(card, visible) {
    if (!card) return;
    card.classList.toggle('visible', !!visible);
  }

  function updateRealtimeOverlay(state, snapshot) {
    if (!overlayRealtime) return;
    const sim = getSnapshotSimulation(snapshot);
    const hud = getSnapshotHud(snapshot);
    const run = !!sim.run;
    const total = REALTIME_LEVELS.length;
    if (!total) {
      overlayRealtime.classList.remove('visible');
      return;
    }
    const idxRaw = Number.isFinite(sim.realTimeIndex) ? (sim.realTimeIndex | 0) : DEFAULT_REALTIME_INDEX;
    const clampedIdx = Math.max(0, Math.min(total - 1, idxRaw));
    const desired = REALTIME_LEVELS[clampedIdx] || 100;
    const slowdown = Number(hud.measuredSlowdown);
    const actual = (Number.isFinite(slowdown) && slowdown > 0) ? (100 / slowdown) : desired;
    const offset = Math.abs(actual - desired);
    const shouldShow = (desired !== 100) || (run && offset > 0.1 * desired);
    const desiredEl = overlayRealtime.querySelector('[data-testid="overlay-realtime-desired"]') || overlayRealtime;
    const actualEl = overlayRealtime.querySelector('[data-testid="overlay-realtime-actual"]');
    if (!shouldShow) {
      overlayRealtime.classList.remove('visible');
      return;
    }
    const desiredText = `Speed : ${Math.round(Math.abs(desired) || 0)}%`;
    const actualText = `Physics: ${Math.abs(Number(actual) || 0).toFixed(1)}%`;
    if (desiredEl) desiredEl.textContent = desiredText;
    if (actualEl) actualEl.textContent = actualText;
    overlayRealtime.classList.add('visible');
  }

  const TOAST_HIDE_MS = 2200;

  function updateToast(state) {
    if (!toastEl) return;
    const toast = state.toast;
    const message = toast?.message;
    if (message) {
      const id = toast.ts ?? toast.message;
      if (updateToast._currentId === id) return;
      toastEl.textContent = message;
      toastEl.classList.add('visible');
      updateToast._currentId = id;
      clearTimeout(updateToast._hideTimer);
      clearTimeout(updateToast._clearTimer);
      updateToast._hideTimer = setTimeout(() => {
        toastEl.classList.remove('visible');
        toastEl.textContent = '';
      }, TOAST_HIDE_MS);
      updateToast._clearTimer = setTimeout(() => {
        if (store && typeof store.update === 'function') {
          store.update((draft) => {
            const currentId = draft.toast ? (draft.toast.ts ?? draft.toast.message) : null;
            if (currentId === id) {
              draft.toast = null;
            }
          });
        }
      }, TOAST_HIDE_MS + 50);
      return;
    }
    toastEl.classList.remove('visible');
    toastEl.textContent = '';
    updateToast._currentId = null;
  }

  function updateInfoOverlayTime(state, snapshot) {
    if (!overlayInfo || !state?.overlays?.info) return;
    const time = Number(getSnapshotHud(snapshot).time);
    if (!Number.isFinite(time)) return;
    if (!infoTimeEl || !infoTimeEl.isConnected) {
      const grid = overlayInfo.querySelector('.info-grid');
      infoTimeEl = grid ? grid.querySelector('.info-value[data-info-field="time"]') : null;
      if (!infoTimeEl) return;
    }
    infoTimeEl.textContent = `${time.toFixed(3)} s`;
  }

  function updateInfoOverlayFast(state, snapshot) {
    if (!overlayInfo || !state?.overlays?.info) return;
    const grid = overlayInfo.querySelector('.info-grid');
    if (!grid) return;
    if (!infoFpsEl || !infoFpsEl.isConnected) infoFpsEl = grid.querySelector('.info-value[data-info-field="fps"]');
    if (!infoSizeEl || !infoSizeEl.isConnected) infoSizeEl = grid.querySelector('.info-value[data-info-field="size"]');
    if (!infoCpuEl || !infoCpuEl.isConnected) infoCpuEl = grid.querySelector('.info-value[data-info-field="cpu"]');
    if (!infoSolverEl || !infoSolverEl.isConnected) infoSolverEl = grid.querySelector('.info-value[data-info-field="solver"]');
    if (!infoEnergyEl || !infoEnergyEl.isConnected) infoEnergyEl = grid.querySelector('.info-value[data-info-field="energy"]');
    if (!infoFwdinvEl || !infoFwdinvEl.isConnected) infoFwdinvEl = grid.querySelector('.info-value[data-info-field="fwdinv"]');

    const hud = getSnapshotHud(snapshot);
    const info = getSnapshotInfo(snapshot);
    const simRun = !!getSnapshotSimulation(snapshot).run;
    const fpsState = Number(hud?.fps);
    const fps = Number.isFinite(fpsEstimate) && fpsEstimate > 0 ? fpsEstimate : (Number.isFinite(fpsState) ? fpsState : 0);
    const value = simRun ? (Number(fps) || 0) : 0;
    if (infoFpsEl) infoFpsEl.textContent = value < 1 ? `${value.toFixed(1)} fps` : `${Math.round(value)} fps`;
    if (infoSizeEl) {
      const nefc = Number(info?.nefc) || 0;
      const ncon = Number(info?.ncon) || Number(hud?.contacts) || 0;
      infoSizeEl.textContent = nefc ? `${nefc}  (${ncon} con)` : `${ncon} con`;
    }
    if (infoCpuEl) {
      const step = Number(info?.cpuStepMs);
      const fwd = Number(info?.cpuForwardMs);
      const cpuMs = simRun ? step : fwd;
      infoCpuEl.textContent = Number.isFinite(cpuMs) && cpuMs > 0 ? `${cpuMs.toFixed(3)} ms` : 'n/a';
    }
    if (infoSolverEl) {
      const solverErr = Number(info?.solverSolerr);
      const solverIter = Number(info?.solverNiter) || 0;
      infoSolverEl.textContent = Number.isFinite(solverErr)
        ? `${solverErr.toFixed(2)}  (${solverIter | 0} it)`
        : (solverIter > 0 ? `${solverIter | 0} it` : 'n/a');
    }
    if (infoEnergyEl) {
      const energy = Number(info?.energy);
      infoEnergyEl.textContent = Number.isFinite(energy) ? energy.toFixed(3) : 'n/a';
    }
    if (infoFwdinvEl) {
      const enableFlags = getSnapshotOptions(snapshot)?.enableflags;
      const enabled = typeof enableFlags === 'number' && !!(enableFlags & (1 << 2));
      const solverFwdinv = Array.isArray(info?.solverFwdinv) ? info.solverFwdinv : null;
      if (!enabled || !solverFwdinv || solverFwdinv.length < 2) {
        infoFwdinvEl.textContent = 'n/a';
      } else {
        const f0 = Number(solverFwdinv[0]);
        const f1 = Number(solverFwdinv[1]);
        infoFwdinvEl.textContent = Number.isFinite(f0) && Number.isFinite(f1)
          ? `${f0.toFixed(1)}  ${f1.toFixed(1)}`
          : 'n/a';
      }
    }
  }

  function updateInfoOverlayCard(state, snapshot) {
    if (!overlayInfo) return;
    let grid = overlayInfo.querySelector('.info-grid');
    if (!grid) {
      overlayInfo.innerHTML = '';
      grid = documentTarget.createElement('div');
      grid.className = 'info-grid';
      const addRow = (key, label) => {
        const labelEl = documentTarget.createElement('div');
        labelEl.className = 'info-label';
        labelEl.textContent = label;
        const valueEl = documentTarget.createElement('div');
        valueEl.className = 'info-value';
        valueEl.setAttribute('data-info-field', key);
        grid.append(labelEl, valueEl);
      };
      addRow('model', 'Model');
      addRow('state', 'State');
      addRow('time', 'Time');
      addRow('size', 'Size');
      addRow('cpu', 'CPU');
      addRow('solver', 'Solver');
      addRow('fps', 'FPS');
      addRow('memory', 'Memory');
      addRow('energy', 'Energy');
      addRow('fwdinv', 'FwdInv');
      addRow('islands', 'Islands');
      overlayInfo.appendChild(grid);
    }
    const hud = getSnapshotHud(snapshot);
    const info = getSnapshotInfo(snapshot);
    const getFieldEl = (key) => grid.querySelector(`.info-value[data-info-field="${key}"]`);
    const modelLabel = state?.shell?.modelLabel || '';
    const simRun = !!getSnapshotSimulation(snapshot).run;
    const time = Number(hud?.time) || 0;
    const fpsState = Number(hud?.fps);
    const fps = Number.isFinite(fpsEstimate) && fpsEstimate > 0 ? fpsEstimate : (Number.isFinite(fpsState) ? fpsState : 0);
    const nefc = Number(info?.nefc) || 0;
    const ncon = Number(info?.ncon) || Number(hud?.contacts) || 0;
    const cpuMs = (() => {
      const step = Number(info?.cpuStepMs);
      const fwd = Number(info?.cpuForwardMs);
      const val = simRun ? step : fwd;
      return Number.isFinite(val) && val > 0 ? val : null;
    })();
    const solverErr = Number(info?.solverSolerr);
    const solverIter = Number(info?.solverNiter) || 0;
    const maxCon = Number(info?.maxuseCon) || 0;
    const maxEfc = Number(info?.maxuseEfc) || 0;
    const narena = Number(info?.narena) || 0;
    const maxArena = Number(info?.maxuseArena) || 0;
    const energy = Number(info?.energy);
    const solverFwdinv = Array.isArray(info?.solverFwdinv) ? info.solverFwdinv : null;
    const nisland = Number(info?.nisland) || 0;

    const modelEl = getFieldEl('model');
    if (modelEl) {
      const label = modelLabel || '(default model)';
      modelEl.textContent = label;
      modelEl.title = label;
    }
    const stateEl = getFieldEl('state');
    if (stateEl) stateEl.textContent = simRun ? 'Running' : 'Paused';
    const timeEl = getFieldEl('time');
    if (timeEl) timeEl.textContent = `${time.toFixed(3)} s`;
    infoTimeEl = timeEl || infoTimeEl;
    const sizeEl = getFieldEl('size');
    if (sizeEl) sizeEl.textContent = nefc ? `${nefc}  (${ncon} con)` : `${ncon} con`;
    const cpuEl = getFieldEl('cpu');
    if (cpuEl) cpuEl.textContent = cpuMs != null ? `${cpuMs.toFixed(3)} ms` : 'n/a';
    const solverEl = getFieldEl('solver');
    if (solverEl) {
      solverEl.textContent = Number.isFinite(solverErr)
        ? `${solverErr.toFixed(2)}  (${solverIter | 0} it)`
        : (solverIter > 0 ? `${solverIter | 0} it` : 'n/a');
    }
    const fpsEl = getFieldEl('fps');
    if (fpsEl) {
      const value = simRun ? (Number(fps) || 0) : 0;
      fpsEl.textContent = value < 1 ? `${value.toFixed(1)} fps` : `${Math.round(value)} fps`;
    }
    const memEl = getFieldEl('memory');
    if (memEl) {
      if (narena > 0 && maxArena >= 0) {
        const pct = (maxArena / narena) * 100;
        memEl.textContent = `${pct.toFixed(1)}% of ${formatArenaBytes(narena)}`;
      } else if (maxCon > 0 || maxEfc > 0) {
        memEl.textContent = `con/efc ${maxCon}/${maxEfc}`;
      } else {
        memEl.textContent = 'n/a';
      }
    }
    const fwdinvEl = getFieldEl('fwdinv');
    if (fwdinvEl) {
      const enableFlags = getSnapshotOptions(snapshot)?.enableflags;
      const enabled = typeof enableFlags === 'number' && !!(enableFlags & (1 << 2));
      if (enabled && solverFwdinv && solverFwdinv.length >= 2) {
        const f0 = Number(solverFwdinv[0]);
        const f1 = Number(solverFwdinv[1]);
        fwdinvEl.textContent = Number.isFinite(f0) && Number.isFinite(f1)
          ? `${f0.toFixed(1)}  ${f1.toFixed(1)}`
          : 'n/a';
      } else {
        fwdinvEl.textContent = 'n/a';
      }
    }
    const energyEl = getFieldEl('energy');
    if (energyEl) energyEl.textContent = Number.isFinite(energy) ? energy.toFixed(3) : 'n/a';
    const islandsEl = getFieldEl('islands');
    if (islandsEl) islandsEl.textContent = nisland > 0 ? String(nisland | 0) : '0';
  }

  function updatePanels(state) {
    const leftVisible = !!state.panels.left;
    const rightVisible = !!state.panels.right;
    const fullscreen = !!state.overlays.fullscreen;
    const changed =
      leftVisible !== panelStateCache.left ||
      rightVisible !== panelStateCache.right ||
      fullscreen !== panelStateCache.fullscreen;
    if (!changed) return;

    if (leftPanel) leftPanel.classList.toggle('is-hidden', !leftVisible);
    if (rightPanel) rightPanel.classList.toggle('is-hidden', !rightVisible);

    const layoutClass = fullscreen
      ? 'layout-main'
      : (leftVisible && rightVisible)
        ? 'layout-3col'
        : (leftVisible && !rightVisible)
          ? 'layout-left'
          : (!leftVisible && rightVisible)
            ? 'layout-right'
            : 'layout-main';

    const layouts = ['layout-3col', 'layout-left', 'layout-right', 'layout-main'];
    for (const cls of layouts) documentTarget.body.classList.remove(cls);
    documentTarget.body.classList.add(layoutClass);
    documentTarget.body.classList.toggle('fullscreen', fullscreen);

    panelStateCache.left = leftVisible;
    panelStateCache.right = rightVisible;
    panelStateCache.fullscreen = fullscreen;
    if (typeof resizeCanvas === 'function') {
      resizeCanvas();
    }
  }

  function applySnapshot(snapshot) {
    if (!snapshot) return;
    if (renderCtx) {
      const seqAckSource = Number(snapshot?.viewerCameraSyncSeq);
      if (Number.isFinite(seqAckSource)) {
        const seqAck = Math.max(0, Math.trunc(seqAckSource));
        const prevAckSource = Number(renderCtx.viewerCameraSyncSeqAck);
        const prevAck = Number.isFinite(prevAckSource) ? Math.max(0, Math.trunc(prevAckSource)) : 0;
        renderCtx.viewerCameraSyncSeqAck = Math.max(prevAck, seqAck);
      }
      const seqSentSource = Number(renderCtx.viewerCameraSyncSeqSent);
      const seqSent = Number.isFinite(seqSentSource) ? Math.max(0, Math.trunc(seqSentSource)) : 0;
      const seqAckSource2 = Number(renderCtx.viewerCameraSyncSeqAck);
      const seqAck2 = Number.isFinite(seqAckSource2) ? Math.max(0, Math.trunc(seqAckSource2)) : 0;
      renderCtx.viewerCameraSynced = seqSent > 0 && seqAck2 >= seqSent;
    }
    const state = store.get();
    if (typeof rendererManager?.requestRenderScene === 'function') {
      rendererManager.requestRenderScene(snapshot, state);
    }
    scheduleUiUpdate(state, snapshot);
    if (snapshotSubscribers.size) {
      const nowMs = perfNow();
      for (const fn of snapshotSubscribers) {
        try {
          fn({ snapshot, state, nowMs });
        } catch (err) {
          logWarn('[clock] snapshot subscriber error', err);
          strictCatch(err, 'main:clock_snapshot_subscriber');
        }
      }
    }
    if (windowTarget) {
      windowTarget.__lastSnapshot = snapshot;
    }
  }

  function scheduleUiUpdate(state, snapshot = null) {
    pendingUiState = state;
    pendingUiSnapshot = snapshot;
    if (pendingUiFrame) return;
    pendingUiFrame = true;
    const tick = () => {
      pendingUiFrame = false;
      const now = perfNow();
      const elapsedMs = now - lastUiUpdateMs;
      if (elapsedMs < uiUpdateIntervalMs) {
        const waitMs = Math.max(0, uiUpdateIntervalMs - elapsedMs);
        pendingUiFrame = true;
        setTimeout(() => {
          if (windowTarget?.requestAnimationFrame) {
            windowTarget.requestAnimationFrame(tick);
          } else {
            tick();
          }
        }, waitMs);
        return;
      }
      lastUiUpdateMs = now;
      const uiState = pendingUiState || state;
      const currentSnapshot = pendingUiSnapshot || getSnapshot();

      let didControlsTick = false;
      if ((now - lastControlsUpdateMs) >= Math.max(uiUpdateIntervalMs, 120)) {
        lastControlsUpdateMs = now;
        updateControls(uiState);
        didControlsTick = true;
      }
      updateToast(uiState);
      updateRealtimeOverlay(uiState, currentSnapshot);
      updateInfoOverlayTime(uiState, currentSnapshot);

      let didSlowTick = false;
      const infoVisible = !!uiState?.overlays?.info;
      if (infoVisible && !lastInfoOverlayVisible) {
        updateInfoOverlayCard(uiState, currentSnapshot);
        lastUiSlowUpdateMs = now;
        lastInfoOverlayVisible = true;
      } else if (!infoVisible) {
        lastInfoOverlayVisible = false;
      }

      const wantsSlowTick = uiSlowTickSubscribers.size > 0;
      const slowDue = (now - lastUiSlowUpdateMs) >= uiSlowUpdateIntervalMs;
      if (slowDue && (infoVisible || wantsSlowTick)) {
        lastUiSlowUpdateMs = now;
        if (infoVisible && lastInfoOverlayVisible) {
          updateInfoOverlayCard(uiState, currentSnapshot);
        }
        didSlowTick = wantsSlowTick;
      }

      updateInfoOverlayFast(uiState, currentSnapshot);

      if (uiTickSubscribers.size) {
        for (const fn of uiTickSubscribers) {
          try {
            fn({ snapshot: currentSnapshot, state: uiState, nowMs: now });
          } catch (err) {
            logWarn('[clock] ui tick subscriber error', err);
            strictCatch(err, 'main:clock_ui_subscriber');
          }
        }
      }

      if (didControlsTick && uiControlsTickSubscribers.size) {
        for (const fn of uiControlsTickSubscribers) {
          try {
            fn({ snapshot: currentSnapshot, state: uiState, nowMs: now });
          } catch (err) {
            logWarn('[clock] ui controls tick subscriber error', err);
            strictCatch(err, 'main:clock_ui_controls_subscriber');
          }
        }
      }

      if (didSlowTick && uiSlowTickSubscribers.size) {
        for (const fn of uiSlowTickSubscribers) {
          try {
            fn({ snapshot: currentSnapshot, state: uiState, nowMs: now });
          } catch (err) {
            logWarn('[clock] ui slow tick subscriber error', err);
            strictCatch(err, 'main:clock_ui_slow_subscriber');
          }
        }
      }

      const panelVisible = !!uiState?.panels?.right && !uiState?.overlays?.fullscreen;
      rightPanelRuntime.update(currentSnapshot, { panelVisible });
    };

    if (windowTarget?.requestAnimationFrame) {
      windowTarget.requestAnimationFrame(tick);
    } else {
      tick();
    }
  }

  function handleStoreChange(state) {
    const perfEnabled = isPerfEnabled();
    const tSubStart = perfEnabled ? perfNow() : 0;
    const snapshot = getSnapshot();
    if (typeof rendererManager?.requestRenderScene === 'function') {
      rendererManager.requestRenderScene(snapshot, state);
    }

    const tOverlaysStart = perfEnabled ? perfNow() : 0;
    const overlays = state.overlays || {};
    if (overlays.help !== overlayStateCache.help) {
      updateOverlay(overlayHelp, overlays.help);
      overlayStateCache.help = overlays.help;
    }
    if (overlays.info !== overlayStateCache.info) {
      updateOverlay(overlayInfo, overlays.info);
      overlayStateCache.info = overlays.info;
    }
    if (overlays.profiler !== overlayStateCache.profiler) {
      updateOverlay(overlayProfiler, overlays.profiler);
      overlayStateCache.profiler = overlays.profiler;
    }
    if (overlays.sensor !== overlayStateCache.sensor) {
      updateOverlay(overlaySensor, overlays.sensor);
      overlayStateCache.sensor = overlays.sensor;
    }
    if (overlays.info) {
      updateInfoOverlayTime(state, snapshot);
    }
    if (perfEnabled) {
      perfSample('main:subscriber_updateOverlays_ms', perfNow() - tOverlaysStart);
    }

    if (perfEnabled) {
      const tPanelsStart = perfNow();
      updatePanels(state);
      perfSample('main:subscriber_updatePanels_ms', perfNow() - tPanelsStart);
    } else {
      updatePanels(state);
    }

    const leftVisible = !!state.panels?.left;
    const rightVisible = !!state.panels?.right;
    const fullscreen = !!state.overlays?.fullscreen;
    const layoutKey = `${leftVisible ? '1' : '0'}${rightVisible ? '1' : '0'}${fullscreen ? '1' : '0'}`;
    const fontIndex = Number.isFinite(state.theme?.font) ? (state.theme.font | 0) : null;
    if (layoutKey !== lastLayoutKey || fontIndex !== lastFontIndex) {
      lastLayoutKey = layoutKey;
      lastFontIndex = fontIndex;
      if (perfEnabled) {
        const tResizeStart = perfNow();
        queueResizeCanvas();
        perfSample('main:subscriber_queueResizeCanvas_ms', perfNow() - tResizeStart);
      } else {
        queueResizeCanvas();
      }
    }
    if (perfEnabled) {
      const tUiStart = perfNow();
      scheduleUiUpdate(state, snapshot);
      perfSample('main:subscriber_scheduleUiUpdate_ms', perfNow() - tUiStart);
      perfSample('main:store_subscriber_ms', perfNow() - tSubStart, {
        ngeom: typeof snapshot?.ngeom === 'number' ? (snapshot.ngeom | 0) : null,
        scn_ngeom: (snapshot?.scn_ngeom | 0) > 0 ? (snapshot.scn_ngeom | 0) : null,
      });
    } else {
      scheduleUiUpdate(state, snapshot);
    }
  }

  return {
    applySnapshot,
    scheduleUiUpdate,
    handleStoreChange,
    updateRenderStats,
    getRenderStats,
  };
}
