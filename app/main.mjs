import * as THREE from 'three';
import {
  isStrictEnabled,
  perfMarkOnce,
  logWarn,
  logStatus,
  logError,
  strictCatch,
} from '../core/viewer_runtime.mjs';
import { applyRuntimeUiToDocument, getRuntimeConfig } from '../core/runtime_config.mjs';
import { DEFAULT_REALTIME_INDEX, REALTIME_LEVELS } from '../core/viewer_defaults.mjs';
import { createBackend } from '../backend/backend_core.mjs';
import {
  DEFAULT_VIEWER_STATE,
  createViewerStore,
} from '../ui/state.mjs';
import { createPanelStateManager } from '../ui/panel_state.mjs';
import { applyGesture, applySpecAction, readControlValue } from '../ui/viewer_actions.mjs';
import { prepareBindingUpdate } from '../ui/bindings.mjs';
import { installPanelSectionDblclickDelegation } from '../ui/panel_sections.mjs';
import { createControlManager } from '../ui/control_manager.mjs';
import { createRendererManager } from '../renderer/pipeline.mjs';
import { createCameraController, createPickingController } from '../renderer/controllers.mjs';
import { createEnvironmentManager } from '../environment/environment.mjs';
import { createPlayHost } from './play_host.mjs';
import { createRightPanelRuntime } from './right_panel_runtime.mjs';
import { createUiRuntime } from './ui_runtime.mjs';
import {
  getSnapshotBodyParentIds,
  getSnapshotGeomBodyIds,
  getSnapshotGeoms,
  getSnapshotSelection,
  getSnapshotSimulation,
} from '../core/snapshot_selectors.mjs';

perfMarkOnce('play:main:start', {
  href: (typeof window !== 'undefined' && window.location?.href) ? window.location.href : null,
});

const PLAY_ROOT_URL = new URL('../', import.meta.url);

function resolvePluginImportSpecifier(raw) {
  const s = String(raw || '').trim();
  if (!s) return s;
  const looksLikePath = s.startsWith('.') || s.startsWith('/') || s.includes('/') || s.endsWith('.mjs') || s.endsWith('.js');
  if (!looksLikePath) return s; // allow importmap/bare specifiers
  return new URL(s, PLAY_ROOT_URL).href;
}

const CAMERA_PRESETS = ['Free', 'Tracking'];

const leftPanel = document.querySelector('[data-testid="panel-left"]');
const rightPanel = document.querySelector('[data-testid="panel-right"]');
const leftPanelMount = document.querySelector('[data-play-mount="leftPanel"]') || leftPanel;
const rightPanelMount = document.querySelector('[data-play-mount="rightPanel"]') || rightPanel;
const leftPanelPluginMount = document.querySelector('[data-play-mount="leftPanelPlugin"]') || null;
const rightPanelPluginMount = document.querySelector('[data-play-mount="rightPanelPlugin"]') || null;
const overlayRootMount = document.querySelector('[data-play-mount="overlayRoot"]') || document.querySelector('.overlay-stack');
const canvas = document.querySelector('[data-testid="viewer-canvas"]');
const overlayRealtime = document.querySelector('[data-testid="overlay-realtime"]');
const overlayHelp = document.querySelector('[data-testid="overlay-help"]');
const overlayInfo = document.querySelector('[data-testid="overlay-info"]');
const overlayProfiler = document.querySelector('[data-testid="overlay-profiler"]');
const overlaySensor = document.querySelector('[data-testid="overlay-sensor"]');
const toastEl = document.querySelector('[data-testid="toast"]');
const uiTickSubscribers = new Set();
const uiControlsTickSubscribers = new Set();
const uiSlowTickSubscribers = new Set();
const snapshotSubscribers = new Set();
const pluginDisposers = [];
let pluginDisposeInstalled = false;

function subscribeClock(set, fn) {
  if (typeof fn !== 'function') {
    return () => {};
  }
  set.add(fn);
  return () => set.delete(fn);
}
const renderCtx = {
  initialized: false,
  renderer: null,
  scene: null,
  camera: null,
  root: null,
  grid: null,
  light: null,
  assetSource: null,
  assetCache: null,
  meshes: [],
  defaultVopt: null,
  alignSeq: 0,
  copySeq: 0,
  cameraTarget: new THREE.Vector3(0, 0, 0),
  autoAligned: false,
  viewerCameraSynced: false,
  viewerCameraSyncSeqSent: 0,
  viewerCameraSyncSeqAck: 0,
  viewerCameraTrackId: null,
  bounds: null,
  snapshotLogState: null,
  frameId: null,
};
if (typeof window !== 'undefined') {
  window.__renderCtx = renderCtx;
}

const runtimeConfig = getRuntimeConfig();
const startupConfig = runtimeConfig.startup || {};
const debugMode = !!startupConfig.debugMode;
const hideAllGeometryDefault = !!runtimeConfig.rendering?.hideAllGeometryDefault;
const requestedModel = typeof startupConfig.model === 'string' ? startupConfig.model : '';
applyRuntimeUiToDocument(document, { clearPrepaintThemeAttr: true });
const skyOffParam = startupConfig.skyOverride === true;
const skyDebugModeParam = startupConfig.skyDebugMode || null;
const backend = await createBackend({ model: requestedModel, prepareBindingUpdate });
const getCurrentSnapshot = () => (typeof backend?.snapshot === 'function' ? backend.snapshot() : null);
const store = createViewerStore({});
const panelState = createPanelStateManager({ store, runtimeConfig });
if (typeof window !== 'undefined') {
  window.__viewerStore = store;
  window.__PLAY_STRICT_REPORT__ = () => backend.getStrictReport();
}
let uiRuntime = null;

const fallbackEnabledDefault = startupConfig.fallbackMode !== 'off';

const { applyFallbackAppearance, ensureEnvIfNeeded } = createEnvironmentManager({
  THREE_NS: THREE,
  skyOffParam,
  fallbackEnabledDefault,
  skyDebugModeParam,
});

if (store && typeof store.update === 'function') {
  store.update((draft) => {
    if (!draft.rendering) draft.rendering = { ...DEFAULT_VIEWER_STATE.rendering };
    draft.rendering.hideAllGeometry = !!hideAllGeometryDefault;
  });
}

const rendererManager = createRendererManager({
  canvas,
  overlayRoot: overlayRootMount,
  backend,
  renderCtx,
  applyFallbackAppearance,
  ensureEnvIfNeeded,
  debugMode,
  setRenderStats: (stats) => {
    uiRuntime?.updateRenderStats(stats);
  },
});
rendererManager.setup();

function applySnapshot(snapshot) {
  uiRuntime?.applySnapshot(snapshot);
}

function scheduleUiUpdate(state, snapshot = null) {
  uiRuntime?.scheduleUiUpdate(state, snapshot);
}

const applySpecActionWithSnapshot = (storeArg, backendArg, control, rawValue) =>
  applySpecAction(storeArg, backendArg, control, rawValue, applySnapshot, getCurrentSnapshot);

const controlManager = createControlManager({
  store,
  backend,
  applySpecAction,
  readControlValue,
  leftPanel: leftPanelMount,
  rightPanel: rightPanelMount,
  panelState,
  cameraPresets: CAMERA_PRESETS,
  getSnapshot: getCurrentSnapshot,
  onSnapshot: (snapshot) => applySnapshot(snapshot),
});
const { loadUiSpec, renderPanels, updateControls, toggleControl, cycleCamera, registerGlobalShortcut } = controlManager;
const initialInfo = typeof backend?.getInitialModelInfo === 'function'
  ? backend.getInitialModelInfo()
  : null;
if (initialInfo && (initialInfo.label || initialInfo.file)) {
  const label = initialInfo.label || initialInfo.file || '';
  store.update((draft) => {
    if (!draft.shell) draft.shell = {};
    draft.shell.modelLabel = label;
  });
}

const rightPanelRuntime = createRightPanelRuntime({ controlManager, store });
uiRuntime = createUiRuntime({
  store,
  rendererManager,
  renderCtx,
  getSnapshot: getCurrentSnapshot,
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
  windowTarget: typeof window !== 'undefined' ? window : null,
  documentTarget: typeof document !== 'undefined' ? document : null,
  uiUpdateIntervalMs: runtimeConfig.timing?.uiUpdateIntervalMs ?? 33,
  uiSlowUpdateIntervalMs: runtimeConfig.timing?.uiSlowUpdateIntervalMs ?? 1000,
});

if (typeof window !== 'undefined') {
  window.__PLAY_DUMP_GEOMORDER = () => ({ disabled: true });
}

const initialSnapshot = await backend.snapshot();
applySnapshot(initialSnapshot);
backend.subscribe((snapshot) => {
  applySnapshot(snapshot);
});
store.subscribe((state) => {
  uiRuntime.handleStoreChange(state);
});

const spec = await loadUiSpec();
panelState.initializeFromSpec(spec);
renderPanels(spec);
installPanelSectionDblclickDelegation(leftPanel, {
  onToggleAll: () => controlManager.toggleAllSections('left'),
});
installPanelSectionDblclickDelegation(rightPanel, {
  onToggleAll: () => controlManager.toggleAllSections('right'),
});
scheduleUiUpdate(store.get());

const cameraController = createCameraController({
  THREE_NS: THREE,
  canvas,
  store,
  backend,
  onGesture: (payload) => applyGesture(store, backend, payload, applySnapshot),
  getSnapshot: getCurrentSnapshot,
  renderCtx,
  debugMode,
  globalUp: new THREE.Vector3(0, 0, 1),
  invertY: false,
  useWasmCamera: true,
});
cameraController.setup();

const pickingController = createPickingController({
  THREE_NS: THREE,
  canvas,
  store,
  backend,
  renderCtx,
  applySpecAction: applySpecActionWithSnapshot,
  debugMode,
  getSnapshot: getCurrentSnapshot,
});
pickingController.setup();

if (typeof registerGlobalShortcut === 'function') {
  registerGlobalShortcut(['Space'], async (event) => {
    event?.preventDefault?.();
    await toggleControl('simulation.run');
  });

  registerGlobalShortcut(['ArrowRight'], async (event) => {
    event?.preventDefault?.();
    await backend.step?.(1);
  });

  registerGlobalShortcut(['ArrowLeft'], async (event) => {
    event?.preventDefault?.();
    await backend.step?.(-1);
  });

  registerGlobalShortcut(['Escape'], async (event) => {
    event?.preventDefault?.();
    await toggleControl('rendering.camera_mode', 0);
  });

  const togglePanelsWithTab = (event) => {
    event?.preventDefault?.();
    if (event?.shiftKey) {
      panelState.togglePanelVisible('right');
      return;
    }
    panelState.togglePanelVisible('left');
  };

  registerGlobalShortcut(['Tab'], togglePanelsWithTab);
  registerGlobalShortcut(['Shift', 'Tab'], togglePanelsWithTab);

  registerGlobalShortcut([']'], async (event) => {
    event?.preventDefault?.();
    await cycleCamera(1);
  });

  registerGlobalShortcut(['['], async (event) => {
    event?.preventDefault?.();
    await cycleCamera(-1);
  });

  registerGlobalShortcut(['PageUp'], (event) => {
    event?.preventDefault?.();
    const snapshot = getCurrentSnapshot();
    const selection = getSnapshotSelection(snapshot);
    const parents = getSnapshotBodyParentIds(snapshot);
    if (!selection || !parents) return;
    const bodyArr = ArrayBuffer.isView(parents) ? parents : null;
    if (!bodyArr || typeof bodyArr.length !== 'number') return;
    let bodyId = Number(selection.bodyId) | 0;
    const selectedGeom = Number(selection.geomId) | 0;
    if (!(bodyId >= 0) && Number.isInteger(selectedGeom) && selectedGeom >= 0) {
      const geomBody = getSnapshotGeomBodyIds(snapshot);
      if (ArrayBuffer.isView(geomBody) && selectedGeom < geomBody.length) {
        bodyId = geomBody[selectedGeom] | 0;
      }
    }
    if (!(bodyId > 0) || bodyId >= bodyArr.length) return;
    let parentId = -1;
    try {
      parentId = bodyArr[bodyId] ?? -1;
    } catch (err) {
      strictCatch(err, 'main:parentId_lookup');
      parentId = -1;
    }
    if (!(parentId >= 0) || parentId === bodyId) return;
    const geomBodyIds = getSnapshotGeomBodyIds(snapshot);
    const ngeom = ArrayBuffer.isView(geomBodyIds) ? geomBodyIds.length : 0;
    let nextGeom = -1;
    if (ArrayBuffer.isView(geomBodyIds)) {
      const currentGeom = selectedGeom;
      if (currentGeom >= 0 && currentGeom < ngeom && (geomBodyIds[currentGeom] | 0) === parentId) {
        nextGeom = currentGeom;
      } else {
        for (let i = 0; i < ngeom; i += 1) {
          if ((geomBodyIds[i] | 0) === parentId) {
            nextGeom = i;
            break;
          }
        }
      }
    }
    const bxpos = snapshot?.bxpos;
    const hasBxpos = ArrayBuffer.isView(bxpos) && typeof snapshot?.nbody === 'number';
    const nbody = hasBxpos ? (snapshot.nbody | 0) : 0;
    let point = null;
    if (hasBxpos && parentId >= 0 && parentId < nbody && bxpos.length >= (parentId + 1) * 3) {
      const base = parentId * 3;
      const px = Number(bxpos[base + 0]) || 0;
      const py = Number(bxpos[base + 1]) || 0;
      const pz = Number(bxpos[base + 2]) || 0;
      point = [px, py, pz];
    } else if (Array.isArray(selection.point) && selection.point.length >= 3) {
      point = [
        Number(selection.point[0]) || 0,
        Number(selection.point[1]) || 0,
        Number(selection.point[2]) || 0,
      ];
    } else {
      point = [0, 0, 0];
    }
    let label = '';
    if (nextGeom >= 0) {
      const geoms = getSnapshotGeoms(snapshot);
      const found = geoms.find((g) => (g?.index | 0) === (nextGeom | 0));
      label = typeof found?.name === 'string' && found.name.trim().length > 0
        ? found.name.trim()
        : `Geom ${nextGeom}`;
    } else {
      label = `Body ${parentId}`;
    }
    const ts = Date.now();
    const localPoint = Array.isArray(selection.localpos) && selection.localpos.length >= 3
      ? [
          Number(selection.localpos[0]) || 0,
          Number(selection.localpos[1]) || 0,
          Number(selection.localpos[2]) || 0,
        ]
      : [0, 0, 0];
    store.update((draft) => {
      if (!draft.runtime) draft.runtime = { ...(draft.runtime || {}) };
      draft.runtime.lastAction = 'select-parent';
      draft.toast = { message: `Selected parent: ${label}`, ts };
    });
    backend.setSelection?.({
      bodyId: parentId,
      geomId: nextGeom,
      point,
      localpos: localPoint,
      seq: (Number(selection.seq) || 0) + 1,
      timestamp: ts,
    });
  });

  const adjustRealtime = async (delta) => {
    const total = REALTIME_LEVELS.length;
    if (!total) return;
    const currentIdxRaw = Number.isFinite(getSnapshotSimulation(getCurrentSnapshot()).realTimeIndex)
      ? (getSnapshotSimulation(getCurrentSnapshot()).realTimeIndex | 0)
      : DEFAULT_REALTIME_INDEX;
    const currentIdx = Math.max(0, Math.min(total - 1, currentIdxRaw));
    let nextIdx = currentIdx + delta;
    if (nextIdx < 0) nextIdx = 0;
    if (nextIdx >= total) nextIdx = total - 1;
    if (nextIdx === currentIdx) return;
    const desired = REALTIME_LEVELS[nextIdx] || 100;
    const nextRate = desired / 100;
    try {
      if (typeof backend.setRate === 'function') {
        await backend.setRate(nextRate, 'ui');
      }
    } catch (err) {
      logWarn('[ui] setRate failed', err);
      strictCatch(err, 'main:ui_set_rate');
    }
  };

  registerGlobalShortcut(['-'], async (event) => {
    event?.preventDefault?.();
    await adjustRealtime(+1);
  });

  registerGlobalShortcut(['_'], async (event) => {
    event?.preventDefault?.();
    await adjustRealtime(+1);
  });

  registerGlobalShortcut(['='], async (event) => {
    event?.preventDefault?.();
    await adjustRealtime(-1);
  });

  registerGlobalShortcut(['+'], async (event) => {
    event?.preventDefault?.();
    await adjustRealtime(-1);
  });
}

const uiSectionRegistry = new Map();
const UI_PLUGIN_SECTION_PREFIX = 'plugin:';

function assertUiPanel(panel) {
  if (panel !== 'left' && panel !== 'right') {
    throw new Error(`ui: invalid panel "${panel}" (expected "left" | "right")`);
  }
  return panel;
}

function assertPluginSectionId(sectionId) {
  const id = String(sectionId || '').trim();
  if (!id) throw new Error('ui.sections.register: missing sectionId');
  if (!id.startsWith(UI_PLUGIN_SECTION_PREFIX)) {
    throw new Error(`ui.sections.register: plugin sectionId must start with "${UI_PLUGIN_SECTION_PREFIX}"`);
  }
  if (!/^[A-Za-z0-9:_.-]+$/.test(id)) {
    throw new Error(`ui.sections.register: invalid sectionId "${id}"`);
  }
  return id;
}

function uiPanelRoot(panel) {
  const p = assertUiPanel(panel);
  return p === 'left' ? leftPanel : rightPanel;
}

function uiPanelCoreMount(panel) {
  const p = assertUiPanel(panel);
  return p === 'left' ? leftPanelMount : rightPanelMount;
}

function uiPanelAfterFileMount() {
  return document.querySelector('[data-play-mount="leftPanelAfterFilePlugin"]') || null;
}

function createUiApi() {
  const panelApi = (panel) => {
    const p = assertUiPanel(panel);
    const root = uiPanelRoot(p);
    return {
      root,
      collapseAll: () => controlManager.collapseAllSections(p),
      expandAll: () => controlManager.expandAllSections(p),
      toggleAll: () => controlManager.toggleAllSections(p),
    };
  };

  const registerSection = (spec) => {
    const mount = (typeof spec?.mount === 'string' && spec.mount.trim().length) ? spec.mount.trim() : null;
    const mountPanel = mount?.startsWith?.('leftPanel')
      ? 'left'
      : (mount?.startsWith?.('rightPanel') ? 'right' : null);
    const rawPanel = String(spec?.panel ?? mountPanel ?? 'left').trim();
    const panel = assertUiPanel(rawPanel);
    if (mountPanel && panel !== mountPanel) {
      throw new Error(`ui.sections.register: mount "${mount}" requires panel "${mountPanel}" (got "${panel}")`);
    }
    const sectionId = assertPluginSectionId(spec?.sectionId ?? spec?.section_id ?? spec?.id);
    if (uiSectionRegistry.has(sectionId)) {
      throw new Error(`ui.sections.register: section already registered: "${sectionId}"`);
    }
    const panelRoot = uiPanelRoot(panel);
    if (!panelRoot) throw new Error(`ui.sections.register: panel root unavailable: "${panel}"`);

    // Reject collisions with built-in sections (or other plugins that bypassed the registry).
    const existing = panelRoot.querySelector(`[data-play-section-id="${sectionId}"]`);
    if (existing) {
      throw new Error(`ui.sections.register: sectionId collision in DOM: "${sectionId}"`);
    }

    const title = (typeof spec?.title === 'string' && spec.title.trim().length) ? spec.title.trim() : sectionId;
    const defaultOpen =
      (typeof spec?.defaultOpen === 'boolean')
        ? spec.defaultOpen
        : (typeof spec?.default_open === 'boolean' ? spec.default_open : true);

    const after = (typeof spec?.after === 'string' && spec.after.trim().length) ? spec.after.trim() : null;
    const before = (typeof spec?.before === 'string' && spec.before.trim().length) ? spec.before.trim() : null;

    let container = null;
    let insertBefore = null;

    if (mount) {
      if (mount === 'leftPanelAfterFilePlugin') {
        container = uiPanelAfterFileMount();
      } else if (mount === 'leftPanel') {
        container = leftPanelMount;
      } else if (mount === 'rightPanel') {
        container = rightPanelMount;
      } else if (mount === 'leftPanelPlugin') {
        container = leftPanelPluginMount;
      } else if (mount === 'rightPanelPlugin') {
        container = rightPanelPluginMount;
      } else {
        throw new Error(`ui.sections.register: unknown mount "${mount}"`);
      }
      if (!container) throw new Error(`ui.sections.register: mount unavailable: "${mount}"`);
    } else if (panel === 'left' && after === 'file') {
      container = uiPanelAfterFileMount();
      if (!container) {
        container = uiPanelCoreMount(panel);
      }
    } else {
      container = uiPanelCoreMount(panel);
    }

    if (!mount && container === uiPanelCoreMount(panel) && (after || before)) {
      const refId = before || after;
      const refEl = panelRoot.querySelector(`[data-play-section-id="${refId}"]`);
      if (!refEl) {
        throw new Error(`ui.sections.register: reference section not found: "${refId}"`);
      }
      const parent = refEl.parentElement;
      if (parent) {
        container = parent;
        insertBefore = before ? refEl : refEl.nextSibling;
      }
    }

    const { sectionEl, body, dispose: disposeSection } = controlManager.createSection({
      container,
      panel,
      sectionId,
      title,
      defaultOpen,
      insertBefore,
    });
    if (!sectionEl || !body) {
      throw new Error(`ui.sections.register: failed to create section: "${sectionId}"`);
    }

    let renderCleanup = null;
    if (typeof spec?.render === 'function') {
      try {
        const result = spec.render(body, { panel, sectionId, sectionEl, body, host: window.__PLAY_HOST__ });
        if (typeof result === 'function') {
          renderCleanup = result;
        } else if (result && typeof result.dispose === 'function') {
          renderCleanup = () => result.dispose();
        }
      } catch (err) {
        try {
          sectionEl.remove();
        } catch (removeErr) {
          logWarn('[ui] plugin section cleanup after render failure failed', { sectionId, err: removeErr });
          strictCatch(removeErr, 'main:ui_plugin_section_cleanup_after_render', { allow: true });
        }
        logWarn('[ui] plugin section render failed', { sectionId, err });
        strictCatch(err, 'main:ui_plugin_section_render', { allow: true });
        throw err;
      }
    }

    const handle = {
      panel,
      sectionId,
      sectionEl,
      body,
      setCollapsed: (collapsed) => controlManager.setSectionCollapsed(panel, sectionId, !!collapsed),
      collapse: () => controlManager.setSectionCollapsed(panel, sectionId, true),
      expand: () => controlManager.setSectionCollapsed(panel, sectionId, false),
      toggle: () => controlManager.toggleSectionCollapsed(panel, sectionId),
      dispose: () => {
        try {
          const cleanup = renderCleanup;
          renderCleanup = null;
          if (typeof cleanup === 'function') {
            try {
              cleanup();
            } catch (err) {
              logWarn('[ui] plugin section cleanup failed', { sectionId, err });
              strictCatch(err, 'main:ui_plugin_section_cleanup', { allow: true });
            }
          }
          uiSectionRegistry.delete(sectionId);
          disposeSection?.();
        } catch (err) {
          logWarn('[ui] plugin section dispose failed', { sectionId, err });
          strictCatch(err, 'main:ui_plugin_section_dispose', { allow: true });
        }
      },
    };
    uiSectionRegistry.set(sectionId, handle);
    return handle;
  };

  const kit = {
    namedRow: (labelText, options = null) => {
      const row = document.createElement('div');
      row.className = 'control-row';
      if (options?.full) row.classList.add('full');
      if (options?.half) row.classList.add('half');
      const label = document.createElement('label');
      label.className = 'control-label';
      label.textContent = labelText ?? '';
      const field = document.createElement('div');
      field.className = 'control-field';
      row.append(label, field);
      return { row, label, field };
    },
    fullRow: (options = null) => {
      const row = document.createElement('div');
      row.className = 'control-row full';
      if (options?.half) row.classList.add('half');
      const field = document.createElement('div');
      field.className = 'control-field';
      row.append(field);
      return { row, field };
    },
    button: ({ label, variant = 'secondary', testId = null, onClick } = {}) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = String(label ?? '').trim();
      if (testId) button.setAttribute('data-testid', String(testId));
      if (variant === 'primary') button.className = 'btn-primary';
      else if (variant === 'pill') button.className = 'btn-pill';
      else button.className = 'btn-secondary';
      if (typeof onClick === 'function') {
        button.addEventListener('click', (event) => onClick(event));
      }
      return button;
    },
    textbox: ({ value = '', placeholder = '', testId = null, onInput, onChange } = {}) => {
      const input = document.createElement('input');
      input.type = 'text';
      input.value = String(value ?? '');
      if (placeholder) input.placeholder = String(placeholder);
      if (testId) input.setAttribute('data-testid', String(testId));
      if (typeof onInput === 'function') {
        input.addEventListener('input', (event) => onInput(event, input.value));
      }
      if (typeof onChange === 'function') {
        input.addEventListener('change', (event) => onChange(event, input.value));
      }
      return input;
    },
    textarea: ({
      value = '',
      placeholder = '',
      rows = 4,
      variant = 'default',
      testId = null,
      onInput,
      onChange,
    } = {}) => {
      const ta = document.createElement('textarea');
      ta.value = String(value ?? '');
      if (placeholder) ta.placeholder = String(placeholder);
      if (Number.isFinite(rows) && (rows | 0) > 0) ta.rows = rows | 0;
      if (variant === 'code') ta.classList.add('code-textarea');
      if (testId) ta.setAttribute('data-testid', String(testId));
      if (typeof onInput === 'function') {
        ta.addEventListener('input', (event) => onInput(event, ta.value));
      }
      if (typeof onChange === 'function') {
        ta.addEventListener('change', (event) => onChange(event, ta.value));
      }
      return ta;
    },
    select: ({ value = '', options = [], testId = null, onChange } = {}) => {
      const sel = document.createElement('select');
      if (testId) sel.setAttribute('data-testid', String(testId));

      const opts = Array.isArray(options) ? options : [];
      for (const entry of opts) {
        const obj = (entry && typeof entry === 'object') ? entry : null;
        const optValue = obj ? obj.value : entry;
        const optLabel = obj ? (obj.label ?? obj.value) : entry;
        const option = document.createElement('option');
        option.value = String(optValue ?? '');
        option.textContent = String(optLabel ?? '');
        sel.appendChild(option);
      }

      sel.value = String(value ?? '');
      if (typeof onChange === 'function') {
        sel.addEventListener('change', (event) => onChange(event, sel.value));
      }
      return sel;
    },
    number: ({
      value = 0,
      min = null,
      max = null,
      step = null,
      variant = 'default',
      testId = null,
      onInput,
      onChange,
    } = {}) => {
      const input = document.createElement('input');
      input.type = 'number';
      input.value = String(Number.isFinite(value) ? value : 0);
      if (min != null) input.min = String(min);
      if (max != null) input.max = String(max);
      if (step != null) input.step = String(step);
      if (variant === 'compact_center') input.classList.add('number-compact-center');
      if (testId) input.setAttribute('data-testid', String(testId));
      if (typeof onInput === 'function') {
        input.addEventListener('input', (event) => onInput(event, input.value));
      }
      if (typeof onChange === 'function') {
        input.addEventListener('change', (event) => onChange(event, input.value));
      }
      return input;
    },
    range: ({ value = 0, min = 0, max = 100, step = 1, testId = null, onInput, onChange } = {}) => {
      const input = document.createElement('input');
      input.type = 'range';
      input.min = String(min);
      input.max = String(max);
      input.step = String(step);
      input.value = String(value);
      if (testId) input.setAttribute('data-testid', String(testId));
      if (typeof onInput === 'function') {
        input.addEventListener('input', (event) => onInput(event, input.value));
      }
      if (typeof onChange === 'function') {
        input.addEventListener('change', (event) => onChange(event, input.value));
      }
      return input;
    },
    segmented: ({ options = [], value = null, testId = null, onChange } = {}) => {
      const root = document.createElement('div');
      root.className = 'segmented';
      if (testId) root.setAttribute('data-testid', String(testId));

      const groupName = `seg_${Math.random().toString(36).slice(2)}`;
      const inputs = [];

      const opts = Array.isArray(options) ? options : [];
      for (const entry of opts) {
        const obj = (entry && typeof entry === 'object') ? entry : null;
        const optValue = obj ? obj.value : entry;
        const optLabel = obj ? (obj.label ?? obj.value) : entry;
        const label = document.createElement('label');
        label.className = 'segmented-option';

        const input = document.createElement('input');
        input.type = 'radio';
        input.name = groupName;
        input.value = String(optValue ?? '');

        const span = document.createElement('span');
        span.textContent = String(optLabel ?? '');

        label.append(input, span);
        root.appendChild(label);
        inputs.push(input);

        input.addEventListener('change', (event) => {
          if (!input.checked) return;
          if (typeof onChange === 'function') onChange(event, input.value);
        });
      }

      if (value != null) {
        const want = String(value);
        for (const input of inputs) {
          if (input.value === want) input.checked = true;
        }
      }

      const api = {
        root,
        inputs,
        value: () => {
          const hit = inputs.find((i) => i.checked);
          return hit ? hit.value : null;
        },
        setValue: (nextValue) => {
          const want = String(nextValue ?? '');
          for (const input of inputs) {
            input.checked = (input.value === want);
          }
        },
      };
      return api;
    },
    codebox: ({ value = '', testId = null } = {}) => {
      const pre = document.createElement('pre');
      pre.className = 'codebox';
      pre.textContent = String(value ?? '');
      if (testId) pre.setAttribute('data-testid', String(testId));
      return pre;
    },
    boolButton: ({ label, value = false, disabled = false, testId = null, onChange } = {}) => {
      const root = document.createElement('label');
      root.className = 'bool-button bool-label';
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.setAttribute('role', 'switch');
      if (testId) input.setAttribute('data-testid', String(testId));
      input.checked = !!value;
      input.disabled = !!disabled;
      input.setAttribute('aria-checked', input.checked ? 'true' : 'false');
      root.classList.toggle('is-active', input.checked);
      root.classList.toggle('is-disabled', input.disabled);
      const text = document.createElement('span');
      text.className = 'bool-text';
      text.textContent = String(label ?? '');
      root.append(input, text);
      input.addEventListener('change', (event) => {
        const next = !!input.checked;
        input.setAttribute('aria-checked', next ? 'true' : 'false');
        root.classList.toggle('is-active', next);
        if (typeof onChange === 'function') onChange(event, next);
      });
      input.addEventListener('focus', () => root.classList.add('has-focus'));
      input.addEventListener('blur', () => root.classList.remove('has-focus'));
      return { root, input, text };
    },
  };

  return {
    panel: panelApi,
    sections: {
      register: registerSection,
      unregister: (sectionId) => {
        const id = String(sectionId || '').trim();
        const entry = uiSectionRegistry.get(id);
        if (!entry) return false;
        entry.dispose();
        return true;
      },
      get: (sectionId) => uiSectionRegistry.get(String(sectionId || '').trim()) ?? null,
      list: () => Array.from(uiSectionRegistry.keys()).sort(),
    },
    kit,
  };
}

if (typeof window !== 'undefined') {
  window.__viewerStore = store;
  window.__viewerControls = {
    getBinding: (id) => controlManager.getBinding(id),
    listIds: (prefix) => controlManager.listIds(prefix),
    toggleControl: (id, value) => controlManager.toggleControl(id, value),
    getControl: (id) => controlManager.getControl(id),
    loadXmlTextAsModel: (xmlText, label) => controlManager.loadXmlTextAsModel?.(xmlText, label),
  };
  window.__viewerRenderer = {
    getStats: () => (uiRuntime ? uiRuntime.getRenderStats() : { drawn: 0, hidden: 0 }),
    getContext: () => (rendererManager.getContext ? rendererManager.getContext() : (renderCtx.initialized ? renderCtx : null)),
    ensureLoop: () => rendererManager.ensureRenderLoop(),
    renderScene: (snapshot, state) => rendererManager.renderScene(snapshot, state),
    getOverlay3D: () => (rendererManager.getOverlay3D ? rendererManager.getOverlay3D() : null),
    overlay3d: {
      get: () => (rendererManager.getOverlay3D ? rendererManager.getOverlay3D() : null),
      createScope: (scopeId, options) => {
        const mgr = rendererManager.getOverlay3D ? rendererManager.getOverlay3D() : null;
        return mgr ? mgr.createScope(scopeId, options) : null;
      },
      getScope: (scopeId) => {
        const mgr = rendererManager.getOverlay3D ? rendererManager.getOverlay3D() : null;
        return mgr ? mgr.getScope(scopeId) : null;
      },
    },
  };
  window.__PLAY_HOST__ = createPlayHost({
    mounts: {
      leftPanel: leftPanelMount,
      rightPanel: rightPanelMount,
      overlayRoot: overlayRootMount,
      leftPanelAfterFilePlugin: document.querySelector('[data-play-mount="leftPanelAfterFilePlugin"]') || null,
      leftPanelPlugin: leftPanelPluginMount,
      rightPanelPlugin: rightPanelPluginMount,
    },
    ui: createUiApi(),
    store,
    backend,
    controls: window.__viewerControls,
    renderer: window.__viewerRenderer,
    getSnapshot: getCurrentSnapshot,
    clock: {
      // Main UI lane (throttled; default ~30Hz via `ui_ms`).
      onUiTick: (fn) => subscribeClock(uiTickSubscribers, fn),
      onUiMainTick: (fn) => subscribeClock(uiTickSubscribers, fn),
      // UI sub-lanes (explicit, throttled) for expensive DOM work.
      onUiControlsTick: (fn) => subscribeClock(uiControlsTickSubscribers, fn),
      onUiSlowTick: (fn) => subscribeClock(uiSlowTickSubscribers, fn),
      onSnapshot: (fn) => subscribeClock(snapshotSubscribers, fn),
      onFrame: (fn) => (rendererManager?.onFrame ? rendererManager.onFrame(fn) : (() => {})),
    },
    logStatus,
    logWarn,
    logError,
    strictCatch,
  });
}

async function loadPlayPlugins(host) {
  if (!host) return;
  const urls = Array.isArray(runtimeConfig.plugins) ? runtimeConfig.plugins.slice() : [];
  if (typeof window !== 'undefined' && !pluginDisposeInstalled) {
    pluginDisposeInstalled = true;
    window.addEventListener('beforeunload', () => {
      while (pluginDisposers.length) {
        const entry = pluginDisposers.pop();
        if (!entry || typeof entry.dispose !== 'function') continue;
        try {
          entry.dispose();
        } catch (err) {
          logWarn('[plugins] dispose failed', { url: entry.url, err });
          strictCatch(err, 'main:plugins_dispose', { allow: true });
        }
      }
    }, { capture: true });
  }
  if (!urls.length) return;
  const unique = Array.from(new Set(urls));
  for (const url of unique) {
    try {
      const mod = await import(resolvePluginImportSpecifier(url));
      const register = (mod && typeof mod.registerPlayPlugin === 'function')
        ? mod.registerPlayPlugin
        : (mod && typeof mod.default === 'function' ? mod.default : null);
      if (!register) {
        logWarn('[plugins] missing registerPlayPlugin/default export', { url });
        continue;
      }
      const maybeDisposer = await register(host);
      if (typeof maybeDisposer === 'function') {
        pluginDisposers.push({ url, dispose: maybeDisposer });
      } else if (maybeDisposer && typeof maybeDisposer.dispose === 'function') {
        pluginDisposers.push({ url, dispose: () => maybeDisposer.dispose() });
      }
      logStatus('[plugins] loaded', { url });
    } catch (err) {
      logError('[plugins] load failed', { url, err });
      strictCatch(err, 'main:plugins_load', { allow: true });
    }
  }
}

if (typeof window !== 'undefined') {
  loadPlayPlugins(window.__PLAY_HOST__).catch((err) => {
    logError('[plugins] load failed (uncaught)', err);
    strictCatch(err, 'main:plugins_load_uncaught', { allow: true });
  });
}

// Keep canvas resized to container.
function resizeCanvas() {
  if (!canvas) return;
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width;
  canvas.height = rect.height;
  if (rendererManager?.updateViewport) {
    rendererManager.updateViewport();
  }
}

function queueResizeCanvas() {
  if (typeof window === 'undefined' || typeof window.requestAnimationFrame !== 'function') {
    resizeCanvas();
    return;
  }
  if (queueResizeCanvas._pending) return;
  queueResizeCanvas._pending = true;
  window.requestAnimationFrame(() => {
    queueResizeCanvas._pending = false;
    resizeCanvas();
  });
}

queueResizeCanvas();
window.addEventListener('resize', queueResizeCanvas);
if (typeof ResizeObserver !== 'undefined' && canvas) {
  const ro = new ResizeObserver(() => queueResizeCanvas());
  ro.observe(canvas);
}
