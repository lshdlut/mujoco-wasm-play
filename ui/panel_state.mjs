import { logWarn, strictCatch } from '../core/viewer_runtime.mjs';

const PANEL_STATE_STORAGE_VERSION = 2;
const PANEL_STATE_FLUSH =
  (typeof queueMicrotask === 'function')
    ? queueMicrotask
    : (fn) => Promise.resolve().then(fn);

function normalisePanelVisibility(source, fallback = null) {
  const base = fallback && typeof fallback === 'object'
    ? { left: !!fallback.left, right: !!fallback.right }
    : { left: true, right: true };
  if (!source || typeof source !== 'object') return base;
  return {
    left: typeof source.left === 'boolean' ? source.left : base.left,
    right: typeof source.right === 'boolean' ? source.right : base.right,
  };
}

function normaliseSectionCollapsedMap(source) {
  const target = { left: {}, right: {} };
  if (!source || typeof source !== 'object') return target;
  for (const panel of ['left', 'right']) {
    const input = source[panel];
    if (!input || typeof input !== 'object') continue;
    for (const [sectionId, collapsed] of Object.entries(input)) {
      if (!sectionId || typeof collapsed !== 'boolean') continue;
      target[panel][sectionId] = collapsed;
    }
  }
  return target;
}

function normaliseSectionDefaultOpenMap(source) {
  const target = { left: {}, right: {} };
  if (!source || typeof source !== 'object') return target;
  for (const panel of ['left', 'right']) {
    const input = source[panel];
    if (!input || typeof input !== 'object') continue;
    for (const [sectionId, open] of Object.entries(input)) {
      if (!sectionId || typeof open !== 'boolean') continue;
      target[panel][sectionId] = open;
    }
  }
  return target;
}

function clonePanelState(source) {
  return {
    panels: normalisePanelVisibility(source?.panels),
    sectionsCollapsed: normaliseSectionCollapsedMap(source?.sectionsCollapsed),
  };
}

function storageKey(namespace) {
  return `play:ui:v${PANEL_STATE_STORAGE_VERSION}:panel_state:${namespace}`;
}

function resolveUiConfig(runtimeConfig) {
  const ui = runtimeConfig?.ui && typeof runtimeConfig.ui === 'object'
    ? runtimeConfig.ui
    : null;
  const profileId = String(ui?.profileId || 'play').trim().toLowerCase() || 'play';
  const storageNamespace = String(ui?.storageNamespace || profileId || 'play').trim() || profileId;
  return {
    profileId,
    builtInDefaultOpen: typeof ui?.builtInDefaultOpen === 'boolean' ? ui.builtInDefaultOpen : true,
    storageNamespace,
    panelDefaults: normalisePanelVisibility(ui?.panelDefaults),
    sectionDefaultOpen: normaliseSectionDefaultOpenMap(ui?.sectionDefaultOpen),
  };
}

function resolveDefaultSectionCollapsed(uiConfig, section, explicitOpen) {
  if (typeof explicitOpen === 'boolean') return !explicitOpen;
  if (typeof uiConfig?.builtInDefaultOpen === 'boolean') {
    return !uiConfig.builtInDefaultOpen;
  }
  const defaultOpen = typeof section?.default_open === 'boolean' ? section.default_open : true;
  return !defaultOpen;
}

function createDefaultPanelState(spec, uiConfig) {
  const sectionsCollapsed = { left: {}, right: {} };
  for (const panel of ['left', 'right']) {
    const sections = Array.isArray(spec?.[panel]) ? spec[panel] : [];
    for (const section of sections) {
      const sectionId = String(section?.section_id || '').trim();
      if (!sectionId) continue;
      const explicitOpen = uiConfig.sectionDefaultOpen[panel][sectionId];
      sectionsCollapsed[panel][sectionId] = resolveDefaultSectionCollapsed(uiConfig, section, explicitOpen);
    }
  }
  return {
    panels: normalisePanelVisibility(uiConfig.panelDefaults),
    sectionsCollapsed,
  };
}

function readPersistedPanelState(namespace) {
  const storage = (typeof window !== 'undefined' && window?.localStorage) ? window.localStorage : null;
  if (!storage) return null;
  try {
    const raw = storage.getItem(storageKey(namespace));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    return clonePanelState(parsed);
  } catch (err) {
    logWarn('[ui] panel state load failed', err);
    strictCatch(err, 'main:ui_panel_state_load', { allow: true });
    return null;
  }
}

function mergePanelState(defaultState, persistedState) {
  if (!persistedState) return clonePanelState(defaultState);
  const merged = clonePanelState(defaultState);
  merged.panels = normalisePanelVisibility(persistedState.panels, merged.panels);
  for (const panel of ['left', 'right']) {
    for (const [sectionId, collapsed] of Object.entries(persistedState.sectionsCollapsed?.[panel] || {})) {
      if (typeof collapsed !== 'boolean') continue;
      merged.sectionsCollapsed[panel][sectionId] = collapsed;
    }
  }
  return merged;
}

function extractPersistablePanelState(state) {
  return {
    panels: normalisePanelVisibility(state?.panels),
    sectionsCollapsed: normaliseSectionCollapsedMap(state?.sectionsCollapsed),
  };
}

function applyPanelStateToDraft(draft, panelState) {
  draft.panels = normalisePanelVisibility(panelState?.panels);
  draft.sectionsCollapsed = normaliseSectionCollapsedMap(panelState?.sectionsCollapsed);
}

function getStoredSectionCollapsed(state, panel, sectionId) {
  const map = state?.sectionsCollapsed?.[panel];
  if (!map || typeof map !== 'object') return null;
  const value = map[sectionId];
  return typeof value === 'boolean' ? value : null;
}

function setSectionCollapsedInDraft(draft, panel, sectionId, collapsed) {
  if (!draft.sectionsCollapsed || typeof draft.sectionsCollapsed !== 'object') {
    draft.sectionsCollapsed = { left: {}, right: {} };
  }
  if (!draft.sectionsCollapsed.left || typeof draft.sectionsCollapsed.left !== 'object') {
    draft.sectionsCollapsed.left = {};
  }
  if (!draft.sectionsCollapsed.right || typeof draft.sectionsCollapsed.right !== 'object') {
    draft.sectionsCollapsed.right = {};
  }
  draft.sectionsCollapsed[panel][sectionId] = !!collapsed;
}

function setPanelVisibleInDraft(draft, panel, visible) {
  if (!draft.panels || typeof draft.panels !== 'object') {
    draft.panels = { left: true, right: true };
  }
  draft.panels[panel] = !!visible;
}

export function createPanelStateManager({ store, runtimeConfig }) {
  if (!store || typeof store.update !== 'function' || typeof store.get !== 'function') {
    throw new Error('createPanelStateManager: missing store');
  }
  const uiConfig = resolveUiConfig(runtimeConfig);
  let lastPersisted = '';
  let flushQueued = false;

  function serialiseCurrentState() {
    return JSON.stringify(extractPersistablePanelState(store.get()));
  }

  function flushPersistedState() {
    flushQueued = false;
    const storage = (typeof window !== 'undefined' && window?.localStorage) ? window.localStorage : null;
    if (!storage) return;
    const next = serialiseCurrentState();
    if (next === lastPersisted) return;
    lastPersisted = next;
    try {
      storage.setItem(storageKey(uiConfig.storageNamespace), next);
    } catch (err) {
      logWarn('[ui] panel state save failed', err);
      strictCatch(err, 'main:ui_panel_state_save', { allow: true });
    }
  }

  function queuePersist() {
    if (flushQueued) return;
    flushQueued = true;
    PANEL_STATE_FLUSH(flushPersistedState);
  }

  function initializeFromSpec(spec) {
    const defaults = createDefaultPanelState(spec, uiConfig);
    const persisted = readPersistedPanelState(uiConfig.storageNamespace);
    const initial = mergePanelState(defaults, persisted);
    store.update((draft) => {
      applyPanelStateToDraft(draft, initial);
    });
    lastPersisted = JSON.stringify(extractPersistablePanelState(store.get()));
  }

  function resolveSectionCollapsed(panel, sectionId, defaultOpen = true, options = null) {
    const stored = getStoredSectionCollapsed(store.get(), panel, sectionId);
    if (typeof stored === 'boolean') return stored;
    const explicitOpen = uiConfig.sectionDefaultOpen?.[panel]?.[sectionId];
    if (typeof explicitOpen === 'boolean') return !explicitOpen;
    if (options?.builtIn && typeof uiConfig.builtInDefaultOpen === 'boolean') {
      return !uiConfig.builtInDefaultOpen;
    }
    return !defaultOpen;
  }

  function ensureSection(panel, sectionId, defaultOpen = true, options = null) {
    const current = resolveSectionCollapsed(panel, sectionId, defaultOpen, options);
    if (getStoredSectionCollapsed(store.get(), panel, sectionId) == null) {
      store.update((draft) => {
        setSectionCollapsedInDraft(draft, panel, sectionId, current);
      });
      queuePersist();
    }
    return current;
  }

  function setSectionCollapsed(panel, sectionId, collapsed) {
    store.update((draft) => {
      setSectionCollapsedInDraft(draft, panel, sectionId, collapsed);
    });
    queuePersist();
    return !!collapsed;
  }

  function toggleSectionCollapsed(panel, sectionId, defaultOpen = true, options = null) {
    const next = !resolveSectionCollapsed(panel, sectionId, defaultOpen, options);
    setSectionCollapsed(panel, sectionId, next);
    return next;
  }

  function setAllSectionsCollapsed(panel, sectionIds, nextCollapsed = null) {
    const ids = Array.isArray(sectionIds) ? sectionIds.map((value) => String(value || '').trim()).filter(Boolean) : [];
    if (ids.length === 0) return { changed: 0, collapsed: typeof nextCollapsed === 'boolean' ? nextCollapsed : null };
    let collapseAll = typeof nextCollapsed === 'boolean' ? nextCollapsed : null;
    if (collapseAll == null) {
      let allCollapsed = true;
      for (const sectionId of ids) {
        if (!resolveSectionCollapsed(panel, sectionId, true, { builtIn: false })) {
          allCollapsed = false;
          break;
        }
      }
      collapseAll = !allCollapsed;
    }
    let changed = 0;
    store.update((draft) => {
      for (const sectionId of ids) {
        const current = getStoredSectionCollapsed(draft, panel, sectionId);
        if (current === collapseAll) continue;
        setSectionCollapsedInDraft(draft, panel, sectionId, collapseAll);
        changed += 1;
      }
    });
    if (changed > 0) queuePersist();
    return { changed, collapsed: collapseAll };
  }

  function setPanelVisible(panel, visible) {
    store.update((draft) => {
      setPanelVisibleInDraft(draft, panel, visible);
    });
    queuePersist();
    return !!visible;
  }

  function togglePanelVisible(panel) {
    const current = !!store.get()?.panels?.[panel];
    return setPanelVisible(panel, !current);
  }

  return {
    profileId: uiConfig.profileId,
    storageNamespace: uiConfig.storageNamespace,
    initializeFromSpec,
    resolveSectionCollapsed,
    ensureSection,
    setSectionCollapsed,
    toggleSectionCollapsed,
    setAllSectionsCollapsed,
    setPanelVisible,
    togglePanelVisible,
  };
}
