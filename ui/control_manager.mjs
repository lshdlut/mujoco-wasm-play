// UI control manager (DOM + panel wiring).

import { logWarn, strictCatch, withCacheBust } from '../core/viewer_runtime.mjs';
import { getControlBindingSpec, toBoolean } from './bindings.mjs';
import { readPersistedSectionCollapsed, resolvePlayPanelId, setPlaySectionCollapsed } from './panel_sections.mjs';
import { createFileSectionManager } from './file_section.mjs';
import { createControlWidgetsRuntime } from './control_widgets.mjs';

const DEV_ROOT_URL = new URL('../', import.meta.url);

function createControlManager({
  store,
  backend,
  applySpecAction,
  readControlValue,
  leftPanel,
  rightPanel,
  cameraPresets = [],
  shortcutRoot = null,
  getSnapshot = null,
  onSnapshot = null,
}) {
  const controlById = new Map();
  const controlBindings = new Map();
  const eventCleanup = [];
  const currentSnapshot = () => (typeof getSnapshot === 'function' ? getSnapshot() : null);
  const applyControlSpecAction = (control, value) => applySpecAction(store, backend, control, value, onSnapshot, currentSnapshot);
  let shortcutsInstalled = false;
  const shortcutHandlers = new Map();
  const CAMERA_FALLBACK_PRESETS = ['Free', 'Tracking'];
  const fileSection = createFileSectionManager({
    store,
    backend,
    pushToast,
    devRootUrl: DEV_ROOT_URL,
  });

  function renderFileSectionExtras(body) {
    fileSection.renderFileSectionExtras(body);
  }
  function sanitiseName(name) {
    return (
      String(name ?? '')
        .replace(/\s+/g, '_')
        .replace(/[^A-Za-z0-9._-]/g, '')
        .replace(/_+/g, '_')
        .replace(/^_+|_+$/g, '') || 'item'
    );
  }

  function normaliseOptions(options) {
    if (!options) return [];
    if (Array.isArray(options)) return options;
    return String(options)
      .split(/[\n,]+/)
      .map((token) => token.trim())
      .filter(Boolean);
  }
function pushToast(message) {
  if (!message) return;
  try {
    store.update((draft) => {
      draft.toast = { message, ts: Date.now() };
    });
  } catch (err) {
    strictCatch(err, 'main:pushToast');
  }
}

  function elementIsEditable(node) {
    if (!node || typeof node !== 'object') return false;
    if (node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement || node instanceof HTMLSelectElement) {
      return !node.disabled && !node.readOnly;
    }
    if (node instanceof HTMLElement) {
      if (node.isContentEditable) return true;
      const role = typeof node.getAttribute === 'function' ? node.getAttribute('role') : null;
      if (role === 'textbox' || role === 'combobox') return true;
    }
    return false;
  }

  function hasEditableFocus(contextRoot) {
    const doc = contextRoot?.ownerDocument || contextRoot?.document || globalThis.document;
    if (!doc) return false;
    let active = doc.activeElement;
    while (active && active.shadowRoot && active.shadowRoot.activeElement) {
      active = active.shadowRoot.activeElement;
    }
    return elementIsEditable(active);
  }

const MOD_KEYS = new Set(['ctrl', 'control', 'meta', 'cmd', 'win', 'shift', 'alt', 'option']);

function resolveResetValue(control) {
  const def = control?.default;
  if (def === undefined || def === null) return undefined;
  if (typeof def === 'number' || typeof def === 'boolean') return def;
  if (typeof def === 'string') {
    const trimmed = def.trim();
    if (!trimmed) return undefined;
    const lower = trimmed.toLowerCase();
    if (lower === 'true') return true;
    if (lower === 'false') return false;
    const num = Number(trimmed);
    return Number.isFinite(num) ? num : undefined;
  }
  return undefined;
}

function normaliseShortcutSpec(shortcut) {
  const combos = [];
  const addCombo = (tokens) => {
    const canonical = canonicalShortcut(tokens);
    if (canonical) combos.push(canonical);
  };
  if (!shortcut) return combos;
  if (Array.isArray(shortcut)) {
    if (shortcut.every((token) => typeof token === 'string')) {
      addCombo(shortcut);
    } else {
      shortcut.forEach((entry) => {
        if (typeof entry === 'string') addCombo(entry.split('+'));
        else if (Array.isArray(entry)) addCombo(entry);
      });
    }
    return combos;
  }
  if (typeof shortcut === 'string') {
    addCombo(shortcut.split('+'));
  }
  return combos;
}

function canonicalShortcut(tokens) {
  if (!tokens) return null;
  const mods = [];
  let key = null;
  tokens.forEach((token) => {
    if (typeof token !== 'string') return;
    const lower = token.trim().toLowerCase();
    if (!lower) return;
    if (lower === 'ctrl' || lower === 'control') {
      if (!mods.includes('ctrl')) mods.push('ctrl');
      return;
    }
    if (lower === 'shift') {
      if (!mods.includes('shift')) mods.push('shift');
      return;
    }
    if (lower === 'alt' || lower === 'option') {
      if (!mods.includes('alt')) mods.push('alt');
      return;
    }
    if (lower === 'meta' || lower === 'cmd' || lower === 'win') {
      if (!mods.includes('meta')) mods.push('meta');
      return;
    }
    if (MOD_KEYS.has(lower)) return;
    key = normaliseKeyToken(lower);
  });
  if (!key) return null;
  mods.sort();
  return [...mods, key].join('+');
}

function normaliseKeyToken(token) {
  if (!token) return null;
  if (token === ' ') return 'space';
  if (token === 'spacebar') return 'space';
  if (token === 'esc') return 'escape';
  if (token === 'left') return 'arrowleft';
  if (token === 'right') return 'arrowright';
  if (token === 'up') return 'arrowup';
  if (token === 'down') return 'arrowdown';
  if (token.startsWith('key') && token.length === 4) return token.slice(3);
  if (token.startsWith('digit') && token.length === 6) return token.slice(5);
  return token;
}

function shortcutFromEvent(event) {
  if (event.defaultPrevented) return null;
  const tag = event.target?.tagName;
  if (tag && ['INPUT', 'TEXTAREA', 'SELECT'].includes(tag)) return null;
  if (event.target?.isContentEditable) return null;
  const mods = [];
  if (event.ctrlKey) mods.push('ctrl');
  if (event.altKey) mods.push('alt');
  if (event.metaKey) mods.push('meta');
  let key = event.key;
  const code = event.code;
  if (typeof code === 'string') {
    if (code.startsWith('Key') && code.length === 4) {
      key = code.slice(3);
    } else if (code.startsWith('Digit') && code.length === 6) {
      key = code.slice(5);
    }
  }
  if (!key) return null;
  key = normaliseKeyToken(String(key).toLowerCase());
  if (!key) return null;
  const isSingleChar = key.length === 1;
  const isAlphaNum = isSingleChar && /[a-z0-9]/.test(key);
  const includeShift = !!event.shiftKey && (!isSingleChar || isAlphaNum);
  if (includeShift) mods.push('shift');
  mods.sort();
  return [...mods, key].join('+');
}

  function registerShortcutHandlers(shortcutSpec, handler) {
    const combos = normaliseShortcutSpec(shortcutSpec);
    combos.forEach((combo) => {
      const list = shortcutHandlers.get(combo) || [];
      list.push(handler);
      shortcutHandlers.set(combo, list);
    });
  }
  
  function registerGlobalShortcut(shortcutSpec, handler) {
    if (!shortcutSpec || typeof handler !== 'function') return;
    registerShortcutHandlers(shortcutSpec, handler);
  }
  
  function registerControl(control, binding) {
    controlById.set(control.item_id, control);
    controlBindings.set(control.item_id, binding);
    if (control?.binding) {
      getControlBindingSpec(control);
    }
  }

  function createBinding(control, { getValue, applyValue }) {
    const binding = {
      skip: false,
      isEditing: false,
      getValue,
      setValue: (value) => {
        binding.skip = true;
        applyValue(value);
        binding.skip = false;
      },
    };
    registerControl(control, binding);
    return binding;
  }

  function guardBinding(binding, handler) {
    return (...args) => {
      if (binding?.skip) return undefined;
      return handler(...args);
    };
  }

  function expandSection(section) {
    const out = { ...section, items: [] };
    for (const item of section.items ?? []) {
      out.items.push(item);
    }

    function appendGroupedEntries(group) {
      if (!group) return;
      const groupKey = group.group_id ?? group.label ?? section.section_id;
      if (group.label) {
        out.items.push({
          item_id: `${section.section_id}.${sanitiseName(groupKey)}._separator`,
          type: 'separator',
          label: group.label,
        });
      }
      const groupType = typeof group.type === 'string' ? group.type.toLowerCase() : '';
      const fallbackType = groupType.includes('radio')
        ? 'radio'
        : groupType.includes('select')
        ? 'select'
        : groupType.includes('slider')
        ? 'slider'
        : 'checkbox';
      for (const entry of group.entries ?? []) {
        const name = entry.name ?? entry.label ?? entry.binding ?? 'entry';
        const itemIdBase = group.group_id ? String(group.group_id) : `${section.section_id}`;
        const itemId = `${itemIdBase}.${sanitiseName(name)}`;
        out.items.push({
          item_id: itemId,
          type: entry.type ?? fallbackType,
          label: entry.name ?? entry.label ?? name,
          binding: entry.binding,
          name,
          options: entry.options,
          default: entry.default,
          shortcut: entry.shortcut,
        });
      }
    }

    for (const group of section.dynamic_groups ?? []) {
      appendGroupedEntries(group);
    }

    for (const post of section.post_groups ?? []) {
      out.items.push(post);
    }
    for (const trail of section.trail_groups ?? []) {
      appendGroupedEntries(trail);
    }
    return out;
  }

  async function loadUiSpec() {
    const specUrl = new URL('spec/ui_spec.json', DEV_ROOT_URL);
    const res = await fetch(withCacheBust(specUrl.href));
    if (!res.ok) {
      throw new Error(`Failed to load ui_spec.json (${res.status})`);
    }
    const json = await res.json();
    return {
      left: (json.left_panel ?? []).map(expandSection),
      right: (json.right_panel ?? []).map(expandSection),
    };
  }


  const widgetRuntime = createControlWidgetsRuntime({
    store,
    applyControlSpecAction,
    readControlValue,
    getSnapshot,
    createBinding,
    registerControl,
    guardBinding,
    rightPanel,
    cameraPresets,
  });

  const DISABLED_SHORTCUT_IDS = new Set(['option.profiler', 'option.sensor']);

  function renderControl(container, control) {
    const type = typeof control.type === 'string' ? control.type.toLowerCase() : 'static';
    const itemId = control?.item_id ?? '';
    if (control?.shortcut && !DISABLED_SHORTCUT_IDS.has(itemId)) {
      registerShortcutHandlers(control.shortcut, async (event) => {
        event?.preventDefault?.();
        if (type.startsWith('button')) {
          await applyControlSpecAction(control, {
            trigger: 'shortcut',
            shiftKey: !!event?.shiftKey,
            ctrlKey: !!event?.ctrlKey,
            altKey: !!event?.altKey,
            metaKey: !!event?.metaKey,
          });
          return;
        }
        await toggleControl(control.item_id);
      });
    }
    return widgetRuntime.renderWidget(container, control);
  }

  function renderSection(container, section, options = null) {
    const panel = options?.panel ?? null;
    const persist = options?.persist !== false;
    const sectionEl = document.createElement('section');
    sectionEl.className = 'ui-section';
    sectionEl.dataset.sectionId = section.section_id;
    sectionEl.setAttribute('data-play-role', 'section');
    sectionEl.setAttribute('data-play-section-id', section.section_id);
    sectionEl.setAttribute('data-testid', `section-${section.section_id}`);

    const header = document.createElement('div');
    header.className = 'section-header';
    header.setAttribute('data-play-role', 'section-header');

    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'section-toggle';
    toggle.setAttribute('data-play-role', 'section-toggle');
    toggle.textContent = section.title ?? section.section_id;

    const actions = document.createElement('div');
    actions.className = 'section-actions';
    const reset = document.createElement('button');
    reset.type = 'button';
    reset.className = 'section-reset';
    reset.setAttribute('data-play-role', 'section-reset');
    reset.title = 'Reset to defaults';
    reset.textContent = '?';
    reset.disabled = true;
    const chevron = document.createElement('span');
    chevron.className = 'section-chevron';
    chevron.setAttribute('aria-hidden', 'true');

    actions.append(reset, chevron);
    header.append(toggle, actions);

    const body = document.createElement('div');
    body.className = 'section-body';
    body.setAttribute('data-play-role', 'section-body');

    const resolvedPanel =
      (panel === 'left' || panel === 'right')
        ? panel
        : resolvePlayPanelId(container);

    const setCollapsed = (collapsed, { persistState = true, flush = false } = {}) => {
      setPlaySectionCollapsed(sectionEl, collapsed, {
        panel: resolvedPanel,
        persist: persistState && persist,
        flush,
      });
    };

    const persistedCollapsed = resolvedPanel ? readPersistedSectionCollapsed(resolvedPanel, section.section_id) : null;
    const defaultOpen = typeof section?.default_open === 'boolean' ? section.default_open : null;
    const initialCollapsed =
      typeof persistedCollapsed === 'boolean'
        ? persistedCollapsed
        : (typeof defaultOpen === 'boolean' ? !defaultOpen : false);
    setCollapsed(initialCollapsed, { persistState: false, flush: false });

    const toggleCollapsed = () => {
      const next = !sectionEl.classList.contains('is-collapsed');
      setCollapsed(next);
    };

    if (section?.shortcut) {
      registerShortcutHandlers(section.shortcut, (event) => {
        event?.preventDefault?.();
        toggleCollapsed();
      });
    }

    toggle.addEventListener('click', () => {
      toggleCollapsed();
    });
    header.addEventListener('click', (event) => {
      if (event.target === reset) return;
      if (event.target !== toggle) {
        toggleCollapsed();
      }
    });

    sectionEl.append(header, body);

    const resetTargets = [];
    if (section.section_id === 'file') {
      renderFileSectionExtras(body);
    } else {
      for (const item of section.items ?? []) {
        renderControl(body, item);
        if (section.section_id === 'simulation' && item?.item_id === 'simulation.save_key') {
          widgetRuntime.renderSimulationNoiseNotice(body);
        }
        if (!item?.item_id) continue;
        const resetValue = resolveResetValue(item);
        if (resetValue !== undefined) {
          resetTargets.push({ id: item.item_id, value: resetValue });
        }
      }
    }

    if (resetTargets.length > 0) {
      reset.disabled = false;
      reset.addEventListener('click', async (event) => {
        event.preventDefault();
        for (const target of resetTargets) {
          const control = controlById.get(target.id);
          if (!control) continue;
          try {
            const type = typeof control.type === 'string' ? control.type.toLowerCase() : '';
            let value = target.value;
            if (type === 'checkbox' || type === 'toggle') {
              value = toBoolean(value);
            }
            await applyControlSpecAction(control, value);
          } catch (error) {
            logWarn('[ui] reset failed', target.id, error);
            strictCatch(error, 'main:ui_reset');
          }
        }
      });
    } else {
      reset.disabled = true;
    }

    if (options?.insertBefore && typeof container?.insertBefore === 'function') {
      container.insertBefore(sectionEl, options.insertBefore);
    } else if (typeof container?.append === 'function') {
      container.append(sectionEl);
    }
    return sectionEl;
  }

  function renderPanels(spec) {
    if (!leftPanel || !rightPanel) return;
    controlById.clear();
    controlBindings.clear();
    shortcutHandlers.clear();
    leftPanel.innerHTML = '';
    rightPanel.innerHTML = '';
    for (const section of spec.left) {
      renderSection(leftPanel, section, { panel: 'left' });
      if (section?.section_id === 'file') {
        const slot = document.createElement('div');
        slot.className = 'panel-mount';
        slot.setAttribute('data-play-mount', 'leftPanelAfterFilePlugin');
        leftPanel.append(slot);
      }
    }
    for (const section of spec.right) {
      renderSection(rightPanel, section, { panel: 'right' });
    }
    installShortcuts();
  }

  function updateControls(state, { dirtyIds = null } = {}) {
    const hasDirty = Array.isArray(dirtyIds) && dirtyIds.length > 0;
    for (const [id, binding] of controlBindings.entries()) {
      if (hasDirty && !dirtyIds.includes(id)) continue;
      if (!binding || !binding.setValue) continue;
      if (typeof binding.updateOptions === 'function') {
        try {
          binding.updateOptions(state);
        } catch (err) {
          strictCatch(err, 'main:update_options');
        }
      }
      if (binding.isEditing) continue;
      const control = controlById.get(id);
      if (!control) continue;
      const value = readControlValue(state, currentSnapshot(), control);
      binding.setValue?.(value);
    }
  }

  async function toggleControl(id, overrideValue) {
    const control = controlById.get(id);
    if (!control) return;
    const current = readControlValue(store.get(), currentSnapshot(), control);
    let next = overrideValue;

    if (next === undefined) {
      if (control.type === 'radio' && Array.isArray(control.options)) {
        const options = normaliseOptions(control.options);
        const currentLabel = typeof current === 'string' ? current : options[0];
        const currentIndex = options.findIndex((opt) => opt === currentLabel);
        const nextIndex = currentIndex === 0 ? 1 : 0;
        next = options[nextIndex] ?? options[0];
      } else if (control.type === 'select') {
        const options = normaliseOptions(control.options);
        const currentLabel = typeof current === 'string' ? current : options[0];
        const currentIndex = options.findIndex((opt) => opt === currentLabel);
        const nextIndex = (currentIndex + 1) % (options.length || 1);
        next = options[nextIndex] ?? options[0];
      } else {
        next = !toBoolean(current);
      }
    }

    await applyControlSpecAction(control, next);
  }

  async function cycleCamera(delta) {
    const control = controlById.get('rendering.camera_mode');
    if (!control) return;
    const current = store.get().runtime.cameraIndex | 0;
    const total = getCameraModeCount();
    const next = (current + delta + total) % total;
    await applyControlSpecAction(control, next);
  }

  function installShortcuts() {
    if (shortcutsInstalled) return;
    const root = shortcutRoot || leftPanel?.ownerDocument?.body || rightPanel?.ownerDocument?.body;
    if (!root || typeof root.addEventListener !== 'function') return;
    const handler = (event) => {
      const target = event?.target;
      if (elementIsEditable(target)) return;
      if (hasEditableFocus(root)) return;
      const combo = shortcutFromEvent(event);
      if (!combo) return;
      const list = shortcutHandlers.get(combo);
      if (!list || list.length === 0) return;
      for (const fn of list) {
        try {
          const result = fn(event);
          if (result && typeof result.then === 'function') {
            result.catch?.((error) => logWarn('[ui] shortcut handler error', error));
          }
        } catch (error) {
          logWarn('[ui] shortcut handler error', error);
          strictCatch(error, 'main:ui_shortcut_handler');
        }
      }
    };
    root.addEventListener('keydown', handler, { capture: true });
    eventCleanup.push(() => {
      try {
        root.removeEventListener('keydown', handler, { capture: true });
      } catch (err) {
        strictCatch(err, 'main:shortcut_cleanup');
      }
      shortcutsInstalled = false;
    });
    shortcutsInstalled = true;
  }

  function dispose() {
    while (eventCleanup.length) {
      const fn = eventCleanup.pop();
      try {
        fn();
      } catch (err) {
        strictCatch(err, 'main:event_cleanup');
      }
    }
    controlById.clear();
    controlBindings.clear();
    shortcutHandlers.clear();
    shortcutsInstalled = false;
  }

  return {
    loadUiSpec,
    renderPanels,
    updateControls,
    toggleControl,
    cycleCamera,
    loadXmlTextAsModel: fileSection.loadXmlTextAsModel,
    getBinding: (id) => controlBindings.get(id) ?? null,
    registerGlobalShortcut,
    listIds: (prefix) => {
      const ids = Array.from(controlById.keys()).sort();
      if (!prefix) return ids;
      return ids.filter((id) => id.startsWith(prefix));
    },
    getControl: (id) => controlById.get(id) ?? null,
    createSection: ({ container, panel, sectionId, title, defaultOpen = true, insertBefore = null } = {}) => {
      const root = container && typeof container.append === 'function' ? container : null;
      if (!root) throw new Error('createSection: missing container');
      const sid = String(sectionId || '').trim();
      if (!sid) throw new Error('createSection: missing sectionId');
      const section = {
        section_id: sid,
        title: typeof title === 'string' && title.trim().length ? title.trim() : sid,
        default_open: typeof defaultOpen === 'boolean' ? defaultOpen : true,
        items: [],
      };
      const sectionEl = renderSection(root, section, { panel, insertBefore });
      const body =
        sectionEl?.querySelector?.('[data-play-role="section-body"]')
        || sectionEl?.querySelector?.('.section-body')
        || null;
      return { sectionEl, body };
    },
    ensureActuatorSliders: (actuators, ctrlValues = []) => {
      widgetRuntime.ensureActuatorSliders(actuators, ctrlValues);
    },
    ensureJointSliders: (dofs = []) => {
      widgetRuntime.ensureJointSliders(dofs);
    },
    ensureEqualityToggles: (eqs = []) => {
      widgetRuntime.ensureEqualityToggles(eqs);
    },
    isSectionExpanded: (sectionId) => {
      if (!rightPanel) return false;
      const sectionEl = rightPanel.querySelector(`[data-section-id="${sectionId}"]`);
      if (!sectionEl) return false;
      return !sectionEl.classList.contains('is-collapsed');
    },
    dispose,
  };
}

export { createControlManager };
