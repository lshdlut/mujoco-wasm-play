import { resetModelFrontendState } from './viewer_state.mjs';

export function createControlManager({
  store,
  backend,
  applySpecAction,
  readControlValue,
  leftPanel,
  rightPanel,
  cameraPresets = [],
  shortcutRoot = null,
}) {
  const controlById = new Map();
  const controlBindings = new Map();
  const eventCleanup = [];
  let shortcutsInstalled = false;
  const shortcutHandlers = new Map();
  const CAMERA_FALLBACK_PRESETS = ['Free', 'Tracking'];
  const modelLibrary = [];
  let modelSelectEl = null;

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

  const getOptionSupport = () => store.get()?.model?.optSupport ?? { supported: false, pointers: [] };
  const OPTION_BINDING_PREFIX = 'mjOption::';

  function isOptionBinding(control) {
    return typeof control?.binding === 'string' && control.binding.startsWith(OPTION_BINDING_PREFIX);
  }

  function applyOptionAvailability(control, element) {
    // Keep option inputs always editable and avoid injecting placeholders;
    // mirrors visualization/headlight behavior (pure state-driven value).
    return;
  }

function formatNumber(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return '';
  const abs = Math.abs(num);
  if (abs !== 0 && (abs >= 1e6 || abs < 1e-4)) {
    return Number(num.toExponential(4)).toString();
  }
  return Number(num.toPrecision(6)).toString();
}

function coerceBoolean(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const lowered = value.toLowerCase();
    return lowered === '1' || lowered === 'true' || lowered === 'run' || lowered === 'on' || lowered === 'yes';
  }
  return !!value;
}

function toNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function clamp01(x) {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  return x;
}

function pushToast(message) {
  if (!message) return;
  try {
    store.update((draft) => {
      draft.toast = { message, ts: Date.now() };
    });
  } catch {}
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

  const dynamicRangeResolvers = {
    'simulation.history_scrubber': () => {
      const hist = store.get()?.history;
      const count = Math.max(1, hist?.count ?? hist?.capacity ?? 1);
      return { min: 1 - count, max: 0, step: 1, absolute: true };
    },
    'simulation.key_slider': () => {
      const keyframes = store.get()?.keyframes;
      const capacity = Math.max(1, keyframes?.capacity ?? 16);
      return { min: 0, max: Math.max(0, capacity - 1), step: 1, absolute: true };
    },
  };

  function parseRange(control) {
    const { range, min, max, step } = control || {};
    const isSlider = typeof control?.type === 'string' && control.type.startsWith('slider');
    const defaultMin = isSlider ? 0 : Number.NEGATIVE_INFINITY;
    const defaultMax = isSlider ? 1 : Number.POSITIVE_INFINITY;
    const out = {
      min: defaultMin,
      max: defaultMax,
      step: control?.type === 'slider_int' ? 1 : 0.01,
      scale: 'lin',
    };
  if (Array.isArray(range) && range.length >= 2) {
    const [rmin, rmax, rstep] = range;
    if (Number.isFinite(Number(rmin))) out.min = Number(rmin);
    if (Number.isFinite(Number(rmax))) out.max = Number(rmax);
    if (Number.isFinite(Number(rstep))) out.step = Number(rstep);
  } else if (typeof range === 'string') {
    const match = range.trim().match(/\[([^\]]+)\]/);
    if (match) {
      const parts = match[1]
        .split(/[,\s]+/)
        .map((token) => Number(token))
        .filter((num) => Number.isFinite(num));
      if (parts.length >= 2) {
        out.min = parts[0];
        out.max = parts[1];
      }
      if (parts.length >= 3) {
        out.step = parts[2];
      }
    }
  } else if (range && typeof range === 'object') {
    if (Number.isFinite(Number(range.min))) out.min = Number(range.min);
    if (Number.isFinite(Number(range.max))) out.max = Number(range.max);
    if (Number.isFinite(Number(range.step))) out.step = Number(range.step);
    if (typeof range.scale === 'string') {
      out.scale = range.scale.toLowerCase() === 'log' ? 'log' : 'lin';
    }
  } else {
    if (Number.isFinite(Number(min))) out.min = Number(min);
    if (Number.isFinite(Number(max))) out.max = Number(max);
    if (Number.isFinite(Number(step))) out.step = Number(step);
  }
  if (!(out.max > out.min)) {
    out.max = out.min + 1;
  }
  if (out.scale === 'log') {
    out.min = Math.max(Number.EPSILON, out.min);
    out.max = Math.max(out.min + Number.EPSILON, out.max);
  }
  if (!(out.step > 0)) {
    out.step = control?.type === 'slider_int' ? 1 : 0.01;
  }
  return out;
}

function normaliseToRange(value, range) {
  const { min, max, scale } = range;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  if (scale === 'log') {
    const logMin = Math.log(min);
    const logMax = Math.log(max);
    const clamped = Math.log(Math.max(min, Math.min(max, numeric)));
    return clamp01((clamped - logMin) / (logMax - logMin));
  }
  return clamp01((numeric - min) / (max - min));
}

function denormaliseFromRange(t, range) {
  const clampedT = clamp01(Number(t));
  const { min, max, scale, step } = range;
  let value;
  if (scale === 'log') {
    const logMin = Math.log(min);
    const logMax = Math.log(max);
    value = Math.exp(logMin + clampedT * (logMax - logMin));
  } else {
    value = min + clampedT * (max - min);
  }
  if (Number.isFinite(step) && step > 0) {
    const steps = Math.round((value - min) / step);
    value = min + steps * step;
  }
  return Math.min(max, Math.max(min, value));
}

function resolveCameraModeEntries() {
  const baseList =
    Array.isArray(cameraPresets) && cameraPresets.length >= CAMERA_FALLBACK_PRESETS.length
      ? cameraPresets
      : CAMERA_FALLBACK_PRESETS;
  const entries = baseList.map((label, idx) => ({
    value: String(idx),
    label: label || `Camera ${idx}`,
  }));
  const modelCameras = store.get()?.model?.cameras || [];
  if (Array.isArray(modelCameras) && modelCameras.length > 0) {
    modelCameras.forEach((cam, idx) => {
      const name =
        typeof cam?.name === 'string' && cam.name.trim().length > 0
          ? cam.name.trim()
          : `Camera ${idx + 1}`;
      entries.push({
        value: String(idx + baseList.length),
        label: name,
      });
    });
  }
  return entries;
}

function syncCameraSelectOptions(select, control) {
  if (!select) return [];
  const entries = resolveCameraModeEntries();
  const prevValue = select.value;
  let dirty = select.options.length !== entries.length;
  if (!dirty) {
    for (let i = 0; i < entries.length; i += 1) {
      const option = select.options[i];
      const entry = entries[i];
      if (!option || option.value !== entry.value || option.textContent !== entry.label) {
        dirty = true;
        break;
      }
    }
  }
  if (dirty) {
    select.innerHTML = '';
    entries.forEach((entry) => {
      const option = document.createElement('option');
      option.value = entry.value;
      option.textContent = entry.label;
      select.appendChild(option);
    });
    if (!entries.some((entry) => entry.value === prevValue)) {
      select.value = entries[0]?.value ?? '0';
    } else if (prevValue) {
      select.value = prevValue;
    }
  }
  control.options = entries.map((entry) => entry.label);
  return entries;
}

function resolveTrackingGeomEntries() {
  const entries = [
    { value: '-1', label: 'Scene center' },
  ];
  try {
    const geoms = store.get()?.model?.geoms || [];
    if (Array.isArray(geoms)) {
      geoms.forEach((geom, idx) => {
        const label =
          typeof geom?.name === 'string' && geom.name.trim().length > 0
            ? geom.name.trim()
            : `Geom ${idx}`;
        const value = Number.isFinite(geom?.index) ? String(geom.index | 0) : String(idx);
        entries.push({ value, label });
      });
    }
  } catch {}
  return entries;
}

function syncTrackingGeomSelectOptions(select, control) {
  if (!select) return [];
  const entries = resolveTrackingGeomEntries();
  const prevValue = select.value;
  let dirty = select.options.length !== entries.length;
  if (!dirty) {
    for (let i = 0; i < entries.length; i += 1) {
      const option = select.options[i];
      const entry = entries[i];
      if (!option || option.value !== entry.value || option.textContent !== entry.label) {
        dirty = true;
        break;
      }
    }
  }
  if (dirty) {
    select.innerHTML = '';
    entries.forEach((entry) => {
      const option = document.createElement('option');
      option.value = entry.value;
      option.textContent = entry.label;
      select.appendChild(option);
    });
    if (!entries.some((entry) => entry.value === prevValue)) {
      select.value = entries[0]?.value ?? '-1';
    } else if (prevValue) {
      select.value = prevValue;
    }
  }
  control.options = entries.map((entry) => entry.label);
  return entries;
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
  if (event.shiftKey) mods.push('shift');
  if (event.altKey) mods.push('alt');
  if (event.metaKey) mods.push('meta');
  let key = event.key;
  if (!key) return null;
  key = key.toLowerCase();
  if (key === ' ') key = 'space';
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

  function registerControl(control, binding) {
    controlById.set(control.item_id, control);
    controlBindings.set(control.item_id, binding);
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

  function createControlRow(control, options = {}) {
    const row = document.createElement('div');
    row.className = 'control-row';
    if (options.full) row.classList.add('full');
    if (options.half) row.classList.add('half');
    if (control?.item_id) {
      row.dataset.controlId = control.item_id;
    }
    return row;
  }

  function createNamedRow(labelText, options = {}) {
    const row = createControlRow(null, options);
    const label = document.createElement('label');
    label.className = 'control-label';
    label.textContent = labelText ?? '';
    const field = document.createElement('div');
    field.className = 'control-field';
    row.append(label, field);
    return { row, label, field };
  }

  function createFullRow(options = {}) {
    const row = createControlRow(null, { ...options, full: true });
    const field = document.createElement('div');
    field.className = 'control-field';
    row.append(field);
    return { row, field };
  }

  function createPillToggle(control) {
    const wrapper = document.createElement('label');
    wrapper.className = 'compact-pill';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.id = `${sanitiseName(control.item_id)}__pill`;
    input.setAttribute('data-testid', control.item_id);
    const text = document.createElement('span');
    text.textContent = control.label ?? control.name ?? control.item_id;
    wrapper.append(input, text);
    const binding = {
      skip: false,
      getValue: () => input.checked,
      setValue: (value) => {
        binding.skip = true;
        input.checked = !!value;
        wrapper.classList.toggle('is-active', !!value);
        binding.skip = false;
      },
    };
    registerControl(control, binding);
    input.addEventListener('change', async () => {
      if (binding.skip) return;
      await applySpecAction(store, backend, control, input.checked);
    });
    return wrapper;
  }

  function renderFileSectionExtras(body) {
    const row = createControlRow(null);

    const loadButton = document.createElement('button');
    loadButton.type = 'button';
    loadButton.className = 'btn-primary';
    loadButton.textContent = 'Load xml';
    loadButton.setAttribute('data-testid', 'file.load_xml_custom');

    const field = document.createElement('div');
    field.className = 'control-field';

    const select = document.createElement('select');
    select.setAttribute('data-testid', 'file.model_select');

    field.append(select);
    row.append(loadButton, field);
    body.append(row);

    modelSelectEl = select;

    const refreshModelSelectOptions = () => {
      if (!modelSelectEl) return;
      modelSelectEl.innerHTML = '';
      if (modelLibrary.length === 0) {
        const placeholder = document.createElement('option');
        placeholder.value = '';
        placeholder.textContent = 'No models loaded';
        placeholder.disabled = true;
        placeholder.selected = true;
        modelSelectEl.appendChild(placeholder);
        modelSelectEl.disabled = true;
        return;
      }
      modelSelectEl.disabled = false;
      for (let i = 0; i < modelLibrary.length; i += 1) {
        const entry = modelLibrary[i];
        const opt = document.createElement('option');
        opt.value = entry.id;
        opt.textContent = entry.label || `Model ${i + 1}`;
        modelSelectEl.appendChild(opt);
      }
    };

    const addModelEntry = (entry) => {
      const existingIndex = modelLibrary.findIndex((item) => item.id === entry.id);
      if (existingIndex >= 0) {
        modelLibrary[existingIndex] = entry;
      } else {
        modelLibrary.push(entry);
      }
      refreshModelSelectOptions();
      if (modelSelectEl && entry.id) {
        modelSelectEl.value = entry.id;
      }
    };

    const initialInfo = typeof backend?.getInitialModelInfo === 'function'
      ? backend.getInitialModelInfo()
      : null;
    if (initialInfo && initialInfo.file) {
      const file = initialInfo.file;
      const label = initialInfo.label || file;
      const entry = {
        id: `builtin_${file}`,
        label,
        kind: 'builtinUrl',
        file,
      };
      addModelEntry(entry);
    }

    loadButton.addEventListener('click', () => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.xml';
      input.style.display = 'none';
      const root = body.ownerDocument?.body || document.body;
      root.appendChild(input);
      const cleanup = () => {
        if (input.parentNode) {
          input.parentNode.removeChild(input);
        }
      };
      input.addEventListener(
        'change',
        async () => {
          const file = input.files && input.files[0];
          if (!file) {
            cleanup();
            return;
          }
          try {
            const text = await file.text();
            const label = file.name || `Model ${modelLibrary.length + 1}`;
            const entry = {
              id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
              label,
              kind: 'xmlText',
              xmlText: text,
            };
            addModelEntry(entry);
            resetModelFrontendState(store);
            if (typeof backend?.loadXmlText === 'function') {
              await backend.loadXmlText(text);
              pushToast?.(`Loaded model: ${label}`);
            }
          } catch (err) {
            console.error('[ui] load xml from file failed', err);
            pushToast?.('Failed to load xml from file');
            throw err;
          } finally {
            cleanup();
          }
        },
        { once: true },
      );
      input.click();
    });

    select.addEventListener('change', async () => {
      const id = select.value;
      if (!id) return;
      const entry = modelLibrary.find((item) => item.id === id);
      if (!entry) return;
      try {
        if (entry.kind === 'xmlText' && entry.xmlText) {
          resetModelFrontendState(store);
          if (typeof backend?.loadXmlText === 'function') {
            await backend.loadXmlText(entry.xmlText);
            pushToast?.(`Loaded model: ${entry.label || id}`);
          }
          return;
        }
        if (entry.kind === 'builtinUrl' && entry.file) {
          const url = new URL(entry.file, import.meta.url);
          const res = await fetch(url, { cache: 'no-store' });
          if (!res.ok) {
            pushToast?.(`Failed to fetch model: ${entry.label || entry.file}`);
            return;
          }
          const text = await res.text();
          entry.kind = 'xmlText';
          entry.xmlText = text;
          resetModelFrontendState(store);
          if (typeof backend?.loadXmlText === 'function') {
            await backend.loadXmlText(text);
            pushToast?.(`Loaded model: ${entry.label || id}`);
          }
        }
      } catch (err) {
        console.error('[ui] model select reload failed', err);
        pushToast?.('Failed to load selected model');
        throw err;
      }
    });

    refreshModelSelectOptions();

    const noteRow = createFullRow();
    noteRow.field.classList.add('control-static');
    noteRow.field.textContent = 'Simulate File actions are disabled here.';
    body.append(noteRow.row);
  }

  function createLabeledRow(control) {
    const row = createControlRow(control);
    const label = document.createElement('label');
    label.className = 'control-label';
    label.textContent = control.label ?? control.name ?? control.item_id;
    const field = document.createElement('div');
    field.className = 'control-field';
    row.append(label, field);
    return { row, label, field };
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
    const specUrl = new URL('./spec/ui_spec.json', import.meta.url);
    const res = await fetch(specUrl, { cache: 'no-store' });
    if (!res.ok) {
      throw new Error(`Failed to load ui_spec.json (${res.status})`);
    }
    const json = await res.json();
    console.log('[ui] spec loaded', json.left_panel?.length ?? 0, json.right_panel?.length ?? 0);
    return {
      left: (json.left_panel ?? []).map(expandSection),
      right: (json.right_panel ?? []).map(expandSection),
    };
  }

  function renderCheckbox(container, control) {
    const row = createControlRow(control);
    row.classList.add('bool-row');
    const label = document.createElement('label');
    label.className = 'bool-button bool-label';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.id = `${sanitiseName(control.item_id)}__checkbox`;
    input.setAttribute('role', 'switch');
    input.setAttribute('data-testid', control.item_id);
    input.setAttribute('aria-checked', 'false');
    const span = document.createElement('span');
    span.className = 'bool-text';
    span.textContent = control.label ?? control.name ?? control.item_id;
    label.append(input, span);
    row.append(label);
    container.append(row);

    let current = false;
    const binding = createBinding(control, {
      getValue: () => current,
      applyValue: (value) => {
        const active = coerceBoolean(value);
        current = active;
        input.checked = !!active;
        input.setAttribute('aria-checked', active ? 'true' : 'false');
        label.classList.toggle('is-active', !!active);
      },
    });

    const commitToggle = guardBinding(binding, async (nextValue) => {
      const active = !!nextValue;
      binding.setValue(active);
      await applySpecAction(store, backend, control, active);
      // UX hint: if enabling Contact Point but there are no contacts yet, show a brief tip
      try {
        if (active && control?.binding === 'mjvOption::flags[14]') {
          const hud = store.get()?.hud || {};
          const n = Number(hud.contacts ?? 0);
          if (!(n > 0)) {
            store.update((draft) => {
              draft.toast = { message: 'No contacts right now', ts: Date.now() };
            });
          }
        }
      } catch {}
    });

    input.addEventListener(
      'change',
      (event) => {
        event.stopPropagation();
        const next = !binding.getValue();
        commitToggle(next);
      },
    );

    label.addEventListener('click', (event) => {
      event.preventDefault();
      const next = !binding.getValue();
      commitToggle(next);
    });

    input.addEventListener('focus', () => {
      label.classList.add('has-focus');
    });
    input.addEventListener('blur', () => {
      label.classList.remove('has-focus');
    });
  }

  function renderRunToggle(container, control) {
    const row = createControlRow(control);
    row.classList.add('run-toggle-row');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'run-toggle';
    button.setAttribute('data-testid', control.item_id);
    button.setAttribute('aria-pressed', 'false');

    const sync = (running) => {
      const active = coerceBoolean(running);
      button.textContent = active ? 'Run' : 'Pause';
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
    };

    const binding = createBinding(control, {
      getValue: () => {
        const current = readControlValue(store.get(), control);
        return coerceBoolean(current);
      },
      applyValue: (value) => {
        const active = coerceBoolean(value);
        sync(active);
      },
    });

    sync(binding.getValue());

    button.addEventListener(
      'click',
      guardBinding(binding, async () => {
        const next = !binding.getValue();
        await applySpecAction(store, backend, control, next);
      }),
    );

    row.append(button);
    container.append(row);
    return row;
  }

  function renderButton(container, control, variant = 'secondary') {
    const row = createControlRow(control);
    row.classList.add('action-row');
    const button = document.createElement('button');
    button.type = 'button';
    const labelText = control.label ?? control.name ?? control.item_id;
    button.textContent = labelText;
    button.setAttribute('data-testid', control.item_id);

    let resolvedVariant = variant;
    if (control.item_id === 'simulation.run') {
      resolvedVariant = 'primary';
    } else if (control.item_id.startsWith('simulation.') || control.item_id.startsWith('file.')) {
      resolvedVariant = 'pill';
    }
    if (variant === 'pill') {
      resolvedVariant = 'pill';
    }

    if (resolvedVariant === 'pill') {
      button.classList.add('btn-pill');
      row.classList.add('pill-row');
    } else if (resolvedVariant === 'primary') {
      button.classList.add('btn-primary');
    } else {
      button.classList.add('btn-secondary');
    }

    row.append(button);
    container.append(row);

    registerControl(control, {
      skip: false,
      getValue: () => true,
      setValue: () => {},
    });

    button.addEventListener('click', async (event) => {
      await applySpecAction(store, backend, control, {
        trigger: 'click',
        shiftKey: !!event.shiftKey,
        ctrlKey: !!event.ctrlKey,
        altKey: !!event.altKey,
        metaKey: !!event.metaKey,
      });
    });
  }

  function renderSelect(container, control) {
    const { row, label, field } = createLabeledRow(control);
    const inputId = `${sanitiseName(control.item_id)}__select`;
    label.setAttribute('for', inputId);
    const select = document.createElement('select');
    select.setAttribute('data-testid', control.item_id);
    select.id = inputId;
    const isCameraModeSelect = control.item_id === 'rendering.camera_mode';
    const isTrackingGeomSelect = control.item_id === 'rendering.tracking_geom';
    const isLabelModeSelect = control.binding === 'mjvOption::label';
    const isFrameModeSelect = control.binding === 'mjvOption::frame';
    const isNumericSelect = isLabelModeSelect || isFrameModeSelect;
    const options = isCameraModeSelect || isTrackingGeomSelect ? [] : normaliseOptions(control.options);
    if (isCameraModeSelect) {
      syncCameraSelectOptions(select, control);
    } else if (isTrackingGeomSelect) {
      syncTrackingGeomSelectOptions(select, control);
    } else {
      options.forEach((opt, idx) => {
        const option = document.createElement('option');
        option.value = isNumericSelect ? String(idx) : opt;
        option.textContent = opt;
        select.appendChild(option);
      });
    }
    field.append(select);
    container.append(row);

    applyOptionAvailability(control, select);

    const binding = createBinding(control, {
      getValue: () => {
        if (isCameraModeSelect) {
          syncCameraSelectOptions(select, control);
          return toNumber(select.value);
        }
        if (isTrackingGeomSelect) {
          syncTrackingGeomSelectOptions(select, control);
          return toNumber(select.value);
        }
        if (isNumericSelect) {
          return Math.max(0, Math.trunc(toNumber(select.value)));
        }
        return select.value;
      },
      applyValue: (value) => {
        if (isCameraModeSelect) {
          const entries = syncCameraSelectOptions(select, control);
          const numericValue = Math.max(0, Math.trunc(toNumber(value)));
          const match = entries.find((entry) => entry.value === String(numericValue));
          const fallbackValue = entries[0]?.value ?? '0';
          select.value = match ? match.value : fallbackValue;
        } else if (isTrackingGeomSelect) {
          const entries = syncTrackingGeomSelectOptions(select, control);
          const numericValue = Math.trunc(toNumber(value));
          const match = entries.find((entry) => entry.value === String(numericValue));
          const fallbackValue = entries[0]?.value ?? '-1';
          select.value = match ? match.value : fallbackValue;
        } else if (isNumericSelect) {
          const numericValue = Math.max(0, Math.trunc(toNumber(value)));
          const clamped = Math.min(numericValue, Math.max(0, options.length - 1));
          select.value = String(clamped);
        } else if (value == null) {
          select.value = options[0] ?? '';
        } else {
          const next = String(value);
          if (!options.includes(next) && options.length > 0) {
            select.value = options[0];
          } else {
            select.value = next;
          }
        }
      },
    });

    select.addEventListener(
      'change',
      guardBinding(binding, async () => {
        const value = isCameraModeSelect
          ? Math.max(0, Math.trunc(toNumber(select.value)))
          : isTrackingGeomSelect
            ? Math.trunc(toNumber(select.value))
            : isNumericSelect
              ? Math.max(0, Math.trunc(toNumber(select.value)))
            : select.value;
        await applySpecAction(store, backend, control, value);
      }),
    );
  }

  function renderRadio(container, control) {
    const options = normaliseOptions(control.options);
    const { row, label, field } = createLabeledRow(control);
    const group = document.createElement('div');
    group.className = 'segmented';
    group.setAttribute('data-testid', control.item_id);

    const radios = [];
    options.forEach((opt, idx) => {
      const radioId = `${sanitiseName(control.item_id)}__${idx}`;
      const radioWrapper = document.createElement('label');
      radioWrapper.className = 'segmented-option';
      const input = document.createElement('input');
      input.type = 'radio';
      input.name = control.item_id;
      input.value = String(opt);
      input.id = radioId;
      const span = document.createElement('span');
      span.textContent = opt;
      radioWrapper.append(input, span);
      group.append(radioWrapper);
      radios.push(input);
    });

    field.append(group);
    container.append(row);

    const binding = createBinding(control, {
      getValue: () => radios.find((r) => r.checked)?.value ?? options[0],
      applyValue: (value) => {
        radios.forEach((radio, idx) => {
          if (value === options[idx] || value === idx || value === radio.value) {
            radio.checked = true;
          }
        });
      },
    });

    radios.forEach((radio) => {
      radio.addEventListener(
        'change',
        guardBinding(binding, async () => {
          if (!radio.checked) return;
          await applySpecAction(store, backend, control, radio.value);
        }),
      );
    });
  }

  function renderSlider(container, control) {
    const baseRange = parseRange(control);
    const { row, label, field } = createLabeledRow(control);
    const inputId = `${sanitiseName(control.item_id)}__slider`;
    label.setAttribute('for', inputId);
    const input = document.createElement('input');
    input.type = 'range';
    input.min = '0';
    input.max = '1';
    input.step = '0.001';
    input.setAttribute('data-testid', control.item_id);
    input.id = inputId;
    input.value = '0';

    const valueLabel = document.createElement('span');
    valueLabel.className = 'slider-value';

    field.append(input, valueLabel);
    container.append(row);

    let resolvedRange = { ...baseRange };
    let usesAbsolute = false;
    const resolveRange = () => {
      const range = { ...baseRange };
      const resolver = dynamicRangeResolvers[control.item_id];
      if (typeof resolver === 'function') {
        try {
          const dyn = resolver();
          if (dyn && Number.isFinite(dyn.min) && Number.isFinite(dyn.max)) {
            if (dyn.min === dyn.max) {
              dyn.max = dyn.min + 1;
            }
            Object.assign(range, dyn);
          }
        } catch {}
      }
      if (!(range.max > range.min)) {
        range.max = range.min + 1;
      }
      if (!(range.step > 0)) {
        range.step = input.type === 'range' ? 0.001 : 1;
      }
      resolvedRange = range;
      usesAbsolute = !!range.absolute;
      if (usesAbsolute) {
        input.min = String(range.min);
        input.max = String(range.max);
        input.step = String(range.step);
      } else {
        input.min = '0';
        input.max = '1';
        input.step = '0.001';
      }
      return resolvedRange;
    };

    resolveRange();

    const binding = createBinding(control, {
      getValue: () => {
        resolveRange();
        if (usesAbsolute) {
          return Number(input.value);
        }
        return denormaliseFromRange(Number(input.value), resolvedRange);
      },
      applyValue: (value) => {
        const range = resolveRange();
        const numeric = Number(value ?? range.min);
        const limited = Number.isFinite(numeric) ? Math.min(range.max, Math.max(range.min, numeric)) : range.min;
        if (usesAbsolute) {
          input.value = String(limited);
        } else {
          const t = normaliseToRange(limited, range);
          input.value = String(t);
        }
        valueLabel.textContent = formatNumber(limited);
      },
    });

    applyOptionAvailability(control, input);
    if (input.disabled) {
      valueLabel.textContent = 'unsupported';
    }

    input.addEventListener(
      'input',
      guardBinding(binding, async () => {
        const range = resolveRange();
        let realValue;
        if (usesAbsolute) {
          const raw = Number(input.value);
          realValue = Number.isFinite(raw) ? raw : range.min;
        } else {
          const t = Number(input.value);
          realValue = denormaliseFromRange(t, range);
        }
        valueLabel.textContent = formatNumber(realValue);
        await applySpecAction(store, backend, control, realValue);
      }),
    );
    if (usesAbsolute) {
      valueLabel.textContent = formatNumber(Number(input.value) || resolvedRange.min);
    } else {
      valueLabel.textContent = formatNumber(denormaliseFromRange(Number(input.value), resolvedRange));
    }

    const setEditing = (flag) => {
      binding.isEditing = !!flag;
    };
    input.addEventListener('pointerdown', () => setEditing(true));
    input.addEventListener('pointerup', () => setEditing(false));
    input.addEventListener('pointerleave', () => {
      if (binding.isEditing) setEditing(false);
    });
    input.addEventListener('blur', () => setEditing(false));
  }

  function createTextInputField(container, control, { mode = 'text', idSuffix = '__edit' } = {}) {
    const range = mode === 'text' ? null : parseRange(control);
    const { row, label, field } = createLabeledRow(control);
    const inputId = `${sanitiseName(control.item_id)}${idSuffix}`;
    label.setAttribute('for', inputId);
    const input = document.createElement('input');
    input.id = inputId;
    input.setAttribute('data-testid', control.item_id);
    input.autocomplete = 'off';
    input.spellcheck = false;
    if (mode === 'int') {
      input.type = 'number';
      input.step = '1';
      input.inputMode = 'numeric';
    } else if (mode === 'float') {
      input.type = 'number';
      input.step = '0.001';
      input.inputMode = 'decimal';
    } else {
      input.type = 'text';
    }
    return { row, input, field, range };
  }

  function renderEditInput(container, control, mode = 'text') {
    const { row, input, field, range } = createTextInputField(container, control, { mode });
    field.append(input);
    container.append(row);

    applyOptionAvailability(control, input);

    const binding = createBinding(control, {
      getValue: () => {
        if (mode === 'text') return input.value;
        const value = Number(input.value);
        return Number.isFinite(value) ? value : 0;
      },
      applyValue: (value) => {
        if (value === undefined || value === null) return;
        if (mode === 'text') {
          input.value = value == null ? '' : String(value);
          return;
        }
        const numeric = Number(value);
        if (!Number.isFinite(numeric)) {
          input.value = '';
          return;
        }
        const clamped = Math.min(range.max, Math.max(range.min, numeric));
        if (mode === 'int') {
          input.value = String(clamped | 0);
        } else if (mode === 'float') {
          input.value = formatNumber(clamped);
        } else {
          input.value = String(clamped);
        }
      },
    });

    // Seed with current state value if present; fallback to default only when the state is empty.
    const current = readControlValue(store.get(), control);
    if (current !== undefined && current !== null) {
      binding.setValue(current);
    } else if (control.default !== undefined) {
      if (mode === 'text' && typeof control.default === 'string') {
        input.placeholder = String(control.default);
      } else if (typeof control.default === 'number') {
        binding.setValue(control.default);
      }
    }

    const commit = guardBinding(binding, async () => {
      let raw;
      if (mode === 'text') {
        raw = input.value;
      } else {
        const numeric = Number(input.value);
        raw = Number.isFinite(numeric) ? Math.min(range.max, Math.max(range.min, numeric)) : range.min;
        if (mode === 'float') {
          input.value = formatNumber(raw);
        } else if (mode === 'int') {
          input.value = String(raw | 0);
        } else {
          input.value = String(raw);
        }
      }
      await applySpecAction(store, backend, control, raw);
    });

    input.addEventListener('focus', () => {
      binding.isEditing = true;
    });
    input.addEventListener('blur', () => {
      binding.isEditing = false;
      commit();
    });
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        input.blur();
      }
    });
  }

  function renderVectorInput(container, control, expectedLength) {
    const { row, input, field } = createTextInputField(container, control, {
      mode: 'text',
      idSuffix: '__vector',
    });
    field.append(input);
    container.append(row);

    applyOptionAvailability(control, input);

    const targetLength = Math.max(1, expectedLength | 0);
    let lastValidText = '';

    const formatVector = (vector) => vector.map(formatNumber).join(' ');
    const toVectorArray = (value) => {
      if (Array.isArray(value)) {
        const arr = value.map((v) => Number(v));
        return arr.length === targetLength && arr.every((n) => Number.isFinite(n)) ? arr : null;
      }
      if (value && typeof value === 'object') {
        try {
          const arr = Array.from(value, (v) => Number(v));
          return arr.length === targetLength && arr.every((n) => Number.isFinite(n)) ? arr : null;
        } catch {
          return null;
        }
      }
      if (typeof value === 'string') {
        const trimmed = value.trim();
        if (!trimmed) return null;
        const tokens = trimmed.split(/\s+/).filter(Boolean);
        if (tokens.length !== targetLength) return null;
        const arr = tokens.map((token) => Number(token));
        return arr.every((n) => Number.isFinite(n)) ? arr : null;
      }
      if (typeof value === 'number' && targetLength === 1) {
        return Number.isFinite(value) ? [Number(value)] : null;
      }
      return null;
    };

    const setInputText = (text) => {
      input.value = text;
      input.classList.remove('is-invalid');
    };

    const binding = createBinding(control, {
      getValue: () => lastValidText || input.value,
      applyValue: (value) => {
        if (value === undefined || value === null) return;
        const parsed = toVectorArray(value);
        if (parsed) {
          lastValidText = formatVector(parsed);
          setInputText(lastValidText);
          return;
        }
        const text = typeof value === 'string' ? value.trim() : String(value ?? '');
        setInputText(text);
      },
    });

    const currentVector = readControlValue(store.get(), control);
    if (currentVector !== undefined && currentVector !== null) {
      binding.setValue(currentVector);
    } else if (control.default !== undefined) {
      if (typeof control.default === 'string') {
        input.placeholder = control.default;
      } else if (Array.isArray(control.default)) {
        binding.setValue(control.default);
      }
    }

    const showInvalid = () => {
      input.classList.add('is-invalid');
      const labelText = control?.label || control?.name || control?.item_id || 'vector';
      pushToast(`[${labelText}] invalid vector input (expected ${targetLength})`);
      if (input._invalidTimer) {
        clearTimeout(input._invalidTimer);
      }
      input._invalidTimer = setTimeout(() => {
        input.classList.remove('is-invalid');
      }, 1200);
      if (lastValidText) {
        input.value = lastValidText;
      } else {
        input.value = '';
      }
    };

    const commit = guardBinding(binding, async () => {
      const parsed = toVectorArray(input.value);
      if (parsed) {
        lastValidText = formatVector(parsed);
        setInputText(lastValidText);
        await applySpecAction(store, backend, control, parsed);
        return;
      }
      showInvalid();
    });

    input.addEventListener('focus', () => {
      binding.isEditing = true;
    });
    input.addEventListener('blur', () => {
      binding.isEditing = false;
      commit();
    });
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        input.blur();
      }
    });
  }

  function renderVec3StringInput(container, control) {
    const { row, input, field } = createTextInputField(container, control, {
      mode: 'text',
      idSuffix: '__vec3str',
    });
    field.append(input);
    container.append(row);

    applyOptionAvailability(control, input);
    const targetLength = 3;
    let lastValidText = '';

    const formatNumber = (num) => {
      if (!Number.isFinite(num)) return '';
      // Keep a stable, short representation similar to other vector inputs
      const fixed = Number(num).toPrecision(6);
      const trimmed = fixed.replace(/\.?0+$/, '');
      return trimmed;
    };
    const formatVector = (vec) => vec.map(formatNumber).join(' ');
    const parseVec3 = (value) => {
      if (Array.isArray(value)) {
        const arr = value.map((v) => Number(v));
        return arr.length === targetLength && arr.every((n) => Number.isFinite(n)) ? arr : null;
      }
      if (value && typeof value === 'object') {
        try {
          const arr = Array.from(value, (v) => Number(v));
          return arr.length === targetLength && arr.every((n) => Number.isFinite(n)) ? arr : null;
        } catch {
          return null;
        }
      }
      if (typeof value === 'string') {
        const trimmed = value.trim();
        if (!trimmed) return null;
        const tokens = trimmed.split(/\s+/).filter(Boolean);
        if (tokens.length !== targetLength) return null;
        const arr = tokens.map((token) => Number(token));
        return arr.every((n) => Number.isFinite(n)) ? arr : null;
      }
      return null;
    };

    const setInputText = (text) => {
      input.value = text;
      input.classList.remove('is-invalid');
    };

    const binding = createBinding(control, {
      getValue: () => lastValidText || input.value,
      applyValue: (value) => {
        if (value === undefined || value === null) return;
        const parsed = parseVec3(value);
        if (parsed) {
          lastValidText = formatVector(parsed);
          setInputText(lastValidText);
          return;
        }
        const text = typeof value === 'string' ? value.trim() : String(value ?? '');
        setInputText(text);
      },
    });

    const current = readControlValue(store.get(), control);
    if (current !== undefined && current !== null) {
      binding.setValue(current);
    } else if (control.default !== undefined && Array.isArray(control.default)) {
      binding.setValue(control.default);
    }

    const showInvalid = () => {
      input.classList.add('is-invalid');
      const labelText = control?.label || control?.name || control?.item_id || 'vector';
      pushToast(`[${labelText}] invalid vector input (expected ${targetLength})`);
      if (input._invalidTimer) {
        clearTimeout(input._invalidTimer);
      }
      input._invalidTimer = setTimeout(() => {
        input.classList.remove('is-invalid');
      }, 1200);
      if (lastValidText) {
        input.value = lastValidText;
      } else {
        input.value = '';
      }
    };

    const commit = guardBinding(binding, async () => {
      const parsed = parseVec3(input.value);
      if (parsed) {
        lastValidText = formatVector(parsed);
        setInputText(lastValidText);
        await applySpecAction(store, backend, control, parsed);
        return;
      }
      showInvalid();
    });

    input.addEventListener('focus', () => {
      binding.isEditing = true;
    });
    input.addEventListener('blur', () => {
      binding.isEditing = false;
      commit();
    });
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        input.blur();
      }
    });
  }

  function renderStatic(container, control) {
    if (control?.binding) {
      const { row, label, field } = createLabeledRow(control);
      const valueEl = document.createElement('span');
      valueEl.className = 'static-value';
      valueEl.textContent = '—';
      field.append(valueEl);
      container.append(row);
      const binding = createBinding(control, {
        getValue: () => valueEl.textContent,
        applyValue: (value) => {
          if (value === undefined || value === null || value === '') {
            valueEl.textContent = '—';
            valueEl.classList.add('is-muted');
            return;
          }
          valueEl.classList.remove('is-muted');
          valueEl.textContent = String(value);
        },
      });
      if (control.default !== undefined) {
        binding.setValue(control.default);
      }
      return;
    }
    const row = createControlRow(control, { full: true });
    row.classList.add('control-static');
    row.textContent = control.label ?? control.name ?? '';
    row.setAttribute('data-testid', control.item_id);
    container.append(row);
  }

  function renderWatchField(container, control) {
    const { row, label, field } = createLabeledRow(control);
    const inputId = `${sanitiseName(control.item_id)}__watch`;
    const input = document.createElement('input');
    input.type = 'text';
    input.id = inputId;
    input.setAttribute('data-testid', control.item_id);
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.placeholder = 'qpos';
    const datalist = document.createElement('datalist');
    datalist.id = `${inputId}__options`;
    input.setAttribute('list', datalist.id);
    field.append(input, datalist);
    container.append(row);

    const syncOptions = (state) => {
      const sources = state?.watch?.sources || {};
      datalist.innerHTML = '';
      Object.entries(sources).forEach(([key, meta]) => {
        const option = document.createElement('option');
        option.value = key;
        const len = Number(meta?.length) || 0;
        const labelText = meta?.label || (len ? `${key} (${len})` : key);
        option.label = labelText;
        datalist.append(option);
      });
    };

    const binding = createBinding(control, {
      getValue: () => input.value,
      applyValue: (value) => {
        input.value = value == null ? '' : String(value);
      },
    });

    binding.updateOptions = (state) => syncOptions(state);
    syncOptions(store.get());

    const commit = guardBinding(binding, async () => {
      const token = input.value.trim();
      await applySpecAction(store, backend, control, token);
    });

    input.addEventListener('focus', () => {
      binding.isEditing = true;
    });
    input.addEventListener('input', () => {
      binding.isEditing = true;
    });
    input.addEventListener('blur', () => {
      binding.isEditing = false;
      commit();
    });
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        input.blur();
      }
    });
  }

  function renderKeyframeSelect(container, control) {
    const { row, label, field } = createLabeledRow(control);
    const selectId = `${sanitiseName(control.item_id)}__select`;
    label.setAttribute('for', selectId);
    const select = document.createElement('select');
    select.id = selectId;
    select.setAttribute('data-testid', control.item_id);
    field.append(select);
    container.append(row);

    let binding = null;
    const syncOptions = (state) => {
      const keyframes = state?.keyframes;
      const slots = Array.isArray(keyframes?.slots) && keyframes.slots.length
        ? keyframes.slots
        : (Array.isArray(keyframes?.labels)
            ? keyframes.labels.map((label, idx) => ({ index: idx, label, available: true, kind: 'user' }))
            : []);
      select.innerHTML = '';
      if (!slots.length) {
        const option = document.createElement('option');
        option.value = '-1';
        option.textContent = 'No keyframes';
        option.disabled = true;
        select.append(option);
        select.disabled = true;
        return;
      }
      select.disabled = false;
      slots.forEach((slot, idx) => {
        const option = document.createElement('option');
        const index = Number.isFinite(slot.index) ? slot.index : idx;
        option.value = String(index);
        const baseLabel = typeof slot.label === 'string' ? slot.label : `Key ${index}`;
        option.textContent = slot.available ? baseLabel : `${baseLabel} (empty)`;
        option.dataset.kind = slot.kind || 'user';
        option.dataset.available = slot.available ? '1' : '0';
        select.append(option);
      });
      const current = String(binding?.getValue?.() ?? -1);
      const hasValue = Array.from(select.options).some((opt) => opt.value === current);
      select.value = hasValue ? current : select.options[0].value;
    };

    binding = createBinding(control, {
      getValue: () => store.get()?.simulation?.keyIndex ?? -1,
      applyValue: (value) => {
        const token = String(Number.isFinite(value) ? value : -1);
        const hasValue = Array.from(select.options).some((opt) => opt.value === token);
        select.value = hasValue ? token : (select.options[0]?.value ?? '-1');
      },
    });

    binding.updateOptions = syncOptions;
    syncOptions(store.get());

    select.addEventListener(
      'change',
      guardBinding(binding, async () => {
        const nextIndex = Number(select.value);
        await applySpecAction(store, backend, control, Number.isFinite(nextIndex) ? nextIndex : 0);
      }),
    );

    return row;
  }

  function renderSeparator(container, control) {
    const row = createControlRow(control, { full: true });
    const sep = document.createElement('div');
    sep.className = 'control-separator';
    sep.textContent = control.label ?? '';
    sep.setAttribute('data-testid', control.item_id);
    row.append(sep);
    container.append(row);
  }

  const CONTROL_RENDERERS = {
    checkbox: renderCheckbox,
    toggle: renderCheckbox,
    button: renderButton,
    'button-secondary': (container, control) => renderButton(container, control, 'secondary'),
    'button-primary': (container, control) => renderButton(container, control, 'primary'),
    'button-pill': (container, control) => renderButton(container, control, 'pill'),
    radio: renderRadio,
    select: renderSelect,
    slider: renderSlider,
    slider_int: renderSlider,
    slider_float: renderSlider,
    slider_num: renderSlider,
    slidernum: renderSlider,
    edit_int: (container, control) => renderEditInput(container, control, 'int'),
    edit_float: (container, control) => renderEditInput(container, control, 'float'),
    edit_text: (container, control) => renderEditInput(container, control, 'text'),
    edit_vec2: (container, control) => renderVectorInput(container, control, 2),
    edit_vec3: (container, control) => renderVec3StringInput(container, control),
    edit_vec3_string: (container, control) => renderVec3StringInput(container, control),
    edit_vec5: (container, control) => renderVectorInput(container, control, 5),
    edit_rgba: (container, control) => renderVectorInput(container, control, 4),
    static: renderStatic,
    separator: renderSeparator,
  };

  function renderControl(container, control) {
    const type = typeof control.type === 'string' ? control.type.toLowerCase() : 'static';
    if (control?.shortcut) {
      registerShortcutHandlers(control.shortcut, async (event) => {
        event?.preventDefault?.();
        if (type.startsWith('button')) {
          await applySpecAction(store, backend, control, {
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
      if (control?.item_id === 'simulation.run') {
        return renderRunToggle(container, control);
      }
      if (control?.item_id === 'watch.field') {
        return renderWatchField(container, control);
      }
      if (control?.item_id === 'simulation.key_slider') {
        return renderKeyframeSelect(container, control);
      }
      const renderer = CONTROL_RENDERERS[type] || renderStatic;
      return renderer(container, control);
    }

  function renderSection(container, section) {
    const sectionEl = document.createElement('section');
    sectionEl.className = 'ui-section';
    sectionEl.dataset.sectionId = section.section_id;
    sectionEl.setAttribute('data-testid', `section-${section.section_id}`);

    const header = document.createElement('div');
    header.className = 'section-header';

    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'section-toggle';
    toggle.textContent = section.title ?? section.section_id;

    const actions = document.createElement('div');
    actions.className = 'section-actions';
    const reset = document.createElement('button');
    reset.type = 'button';
    reset.className = 'section-reset';
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

    if (section.section_id === 'physics') {
      const support = getOptionSupport();
      if (!support.supported) {
        const noteRow = createControlRow({ item_id: 'physics.option_notice' }, { full: true });
        noteRow.classList.add('control-static', 'control-warning');
        noteRow.textContent = 'Physics options are read-only: forge build missing mjOption pointer exports.';
        body.append(noteRow);
      }
    }

    const setCollapsed = (collapsed) => {
      sectionEl.classList.toggle('is-collapsed', collapsed);
      toggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    };

    const isLeftPanel = container === leftPanel;
    const initialCollapsed = isLeftPanel && section.section_id !== 'simulation';
    setCollapsed(initialCollapsed);

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
              value = coerceBoolean(value);
            }
            await applySpecAction(store, backend, control, value);
          } catch (error) {
            console.warn('[ui] reset failed', target.id, error);
          }
        }
      });
    } else {
      reset.disabled = true;
    }

    container.append(sectionEl);
  }

  function renderPanels(spec) {
    if (!leftPanel || !rightPanel) return;
    console.log('[ui] render panels', spec.left.length, spec.right.length);
    controlById.clear();
    controlBindings.clear();
    shortcutHandlers.clear();
    leftPanel.innerHTML = '';
    rightPanel.innerHTML = '';
    for (const section of spec.left) {
      renderSection(leftPanel, section);
    }
    for (const section of spec.right) {
      renderSection(rightPanel, section);
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
        } catch {}
      }
      if (binding.isEditing) continue;
      const control = controlById.get(id);
      if (!control) continue;
      const value = readControlValue(state, control);
      try {
        if (binding.getValue && binding.getValue() === value) continue;
      } catch {}
      binding.setValue?.(value);
    }
    try {
      const trackingSelect = document.querySelector('[data-testid="rendering.tracking_geom"]');
      if (trackingSelect) {
        const isTracking = (state.runtime?.cameraIndex | 0) === 1;
        const row = trackingSelect.closest('.control-row');
        trackingSelect.disabled = !isTracking || trackingSelect.options.length <= 1;
        if (row) {
          row.classList.toggle('is-disabled', !isTracking);
        }
      }
    } catch {}
  }

  async function toggleControl(id, overrideValue) {
    const control = controlById.get(id);
    if (!control) return;
    const current = readControlValue(store.get(), control);
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
        next = !coerceBoolean(current);
      }
    }

    await applySpecAction(store, backend, control, next);
  }

  async function cycleCamera(delta) {
    const control = controlById.get('rendering.camera_mode');
    if (!control) return;
    const current = store.get().runtime.cameraIndex | 0;
    const total = getCameraModeCount();
    const next = (current + delta + total) % total;
    await applySpecAction(store, backend, control, next);
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
            result.catch?.((error) => console.warn('[ui] shortcut handler error', error));
          }
        } catch (error) {
          console.warn('[ui] shortcut handler error', error);
        }
      }
    };
    root.addEventListener('keydown', handler, { capture: true });
    eventCleanup.push(() => {
      try {
        root.removeEventListener('keydown', handler, { capture: true });
      } catch {}
      shortcutsInstalled = false;
    });
    shortcutsInstalled = true;
  }

  function dispose() {
    while (eventCleanup.length) {
      const fn = eventCleanup.pop();
      try {
        fn();
      } catch {}
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
    getBinding: (id) => controlBindings.get(id) ?? null,
    listIds: (prefix) => {
      const ids = Array.from(controlById.keys()).sort();
      if (!prefix) return ids;
      return ids.filter((id) => id.startsWith(prefix));
    },
    getControl: (id) => controlById.get(id) ?? null,
      // Dynamic: ensure Actuator sliders exist under right panel 'control' section
    ensureActuatorSliders: (actuators, ctrlValues = []) => {
        try {
          if (!rightPanel || !Array.isArray(actuators)) return;
          const section = rightPanel.querySelector('[data-section-id="control"]');
        if (!section) return;
        const body = section.querySelector('.section-body');
        if (!body) return;
        // Create a container for actuators if not present
        let container = body.querySelector('[data-dynamic="actuators"]');
        if (!container) {
          container = document.createElement('div');
          container.setAttribute('data-dynamic', 'actuators');
          container.style.marginTop = '8px';
          body.appendChild(container);
        }
        const prevCount = Number(container.getAttribute('data-count') || '0');
        if (prevCount === actuators.length && container.childElementCount > 0) {
          // Update values only
          for (let i = 0; i < actuators.length; i += 1) {
            const slider = container.querySelector(`input[type="range"][data-act-index="${i}"]`);
            if (slider) {
              if (!slider.dataset.editing) slider.dataset.editing = '0';
              if (slider.dataset.editing === '1') continue;
              const fromCtrl = Array.isArray(ctrlValues) && Number.isFinite(Number(ctrlValues[i]))
                ? Number(ctrlValues[i])
                : (ctrlValues?.[i] ?? null);
              if (fromCtrl == null || !Number.isFinite(Number(fromCtrl))) continue;
              const v = Number(fromCtrl);
              if (Number(slider.value) !== v) slider.value = String(v);
            }
          }
          return;
        }
        // Rebuild all
        container.innerHTML = '';
        for (const a of actuators) {
          const row = createControlRow({ item_id: `control.act.${a.index}` });
          row.classList.add('half');
          const label = document.createElement('label');
          label.className = 'control-label';
          label.textContent = a.name ?? `Act ${a.index}`;
          const field = document.createElement('div');
          field.className = 'control-field';
          const input = document.createElement('input');
          input.type = 'range';
          input.min = String(Number.isFinite(a.min) ? a.min : -1);
          input.max = String(Number.isFinite(a.max) ? a.max : 1);
          input.step = String(Number.isFinite(a.step) && a.step > 0 ? a.step : 0.001);
          const fromCtrl = Array.isArray(ctrlValues) && Number.isFinite(Number(ctrlValues[a.index]))
            ? Number(ctrlValues[a.index])
            : (ctrlValues?.[a.index] ?? null);
          // Initialise from backend ctrl; fallback to 0
          input.value = String(fromCtrl != null ? fromCtrl : 0);
          input.setAttribute('data-act-index', String(a.index));
          input.setAttribute('data-testid', `control.act.${a.index}`);
          input.dataset.editing = '0';
          field.appendChild(input);
          row.append(label, field);
          container.appendChild(row);
          input.addEventListener('focus', () => {
            input.dataset.editing = '1';
          });
          const clearEditing = () => {
            input.dataset.editing = '0';
          };
          input.addEventListener('blur', clearEditing);
          input.addEventListener('pointerup', clearEditing);
          input.addEventListener('pointerleave', clearEditing);
          input.addEventListener('input', async () => {
            const idx = Number(a.index) | 0;
            const v = Number(input.value) || 0;
            try {
              await backend.apply?.({ kind: 'ui', id: 'control.actuator', value: { index: idx, value: v }, control: { item_id: `control.act.${idx}` } });
            } catch (err) {
              console.warn('[ui] set actuator failed', err);
            }
          });
        }
        container.setAttribute('data-count', String(actuators.length));
      } catch (err) {
        console.warn('[ui] ensureActuatorSliders error', err);
        }
      },
    // Dynamic: ensure Joint sliders exist under right panel 'joint' section
    ensureJointSliders: (dofs = []) => {
      try {
        if (!rightPanel) return;
        const section = rightPanel.querySelector('[data-section-id="joint"]');
        if (!section) return;
        const body = section.querySelector('.section-body');
        if (!body) return;
        let container = body.querySelector('[data-dynamic="joints"]');
        if (!container) {
          container = document.createElement('div');
          container.setAttribute('data-dynamic', 'joints');
          container.style.marginTop = '8px';
          body.appendChild(container);
        }
        if (!Array.isArray(dofs) || dofs.length === 0) {
          container.innerHTML = '';
          container.setAttribute('data-count', '0');
          return;
        }
        const prevCount = Number(container.getAttribute('data-count') || '0');
        if (prevCount === dofs.length && container.childElementCount > 0) {
          for (const dof of dofs) {
            const slider = container.querySelector(`input[type="range"][data-joint-index="${dof.index}"]`);
            if (!slider) continue;
            if (!slider.dataset.editing) slider.dataset.editing = '0';
            if (slider.dataset.editing === '1') continue;
            if (Number(slider.min) !== dof.min) slider.min = String(dof.min);
            if (Number(slider.max) !== dof.max) slider.max = String(dof.max);
            const val = Number.isFinite(dof.value) ? dof.value : 0;
            if (Number(slider.value) !== val) slider.value = String(val);
          }
          return;
        }
        container.innerHTML = '';
        for (const dof of dofs) {
          const row = createControlRow({ item_id: `joint.${dof.index}` });
          row.classList.add('half');
          const label = document.createElement('label');
          label.className = 'control-label';
          label.textContent = dof.label || `Joint ${dof.index}`;
          const field = document.createElement('div');
          field.className = 'control-field';
          const input = document.createElement('input');
          input.type = 'range';
          input.min = String(dof.min);
          input.max = String(dof.max);
          const step = Number.isFinite(dof.step) && dof.step > 0
            ? dof.step
            : Math.max((dof.max - dof.min) / 500, 0.0001);
          input.step = String(step);
          input.value = String(Number.isFinite(dof.value) ? dof.value : 0);
          input.setAttribute('data-joint-index', String(dof.index));
          input.setAttribute('data-testid', `joint.${dof.index}`);
          input.dataset.editing = '0';
          field.appendChild(input);
          row.append(label, field);
          container.appendChild(row);
          input.addEventListener('focus', () => { input.dataset.editing = '1'; });
          const clearEditing = () => { input.dataset.editing = '0'; };
          input.addEventListener('blur', clearEditing);
          input.addEventListener('pointerup', clearEditing);
          input.addEventListener('pointerleave', clearEditing);
          input.addEventListener('input', async () => {
            const idx = Number(dof.index) | 0;
            const v = Number(input.value) || 0;
            try {
              await backend.apply?.({
                kind: 'ui',
                id: 'joint.slider',
                value: { index: idx, value: v, min: dof.min, max: dof.max },
                control: { item_id: `joint.${idx}` },
              });
            } catch (err) {
              console.warn('[ui] set joint qpos failed', err);
            }
          });
        }
        container.setAttribute('data-count', String(dofs.length));
      } catch (err) {
        console.warn('[ui] ensureJointSliders error', err);
      }
    },
    // Dynamic: ensure Equality toggles exist under right panel 'equality' section
    ensureEqualityToggles: (eqs = []) => {
      try {
        if (!rightPanel) return;
        const section = rightPanel.querySelector('[data-section-id="equality"]');
        if (!section) return;
        const body = section.querySelector('.section-body');
        if (!body) return;
        let container = body.querySelector('[data-dynamic="equality"]');
        if (!container) {
          container = document.createElement('div');
          container.setAttribute('data-dynamic', 'equality');
          container.style.marginTop = '8px';
          container.style.display = 'grid';
          container.style.gridTemplateColumns = 'repeat(2, minmax(0, 1fr))';
          container.style.gap = '12px';
          body.appendChild(container);
        }
        if (!Array.isArray(eqs) || eqs.length === 0) {
          container.innerHTML = '';
          container.setAttribute('data-count', '0');
          return;
        }
        const prevCount = Number(container.getAttribute('data-count') || '0');
        if (prevCount === eqs.length && container.childElementCount > 0) {
          // Stable update: only sync active state and label,不重建 DOM，避免交互时节点被移除
          for (const eq of eqs) {
            const checkbox = container.querySelector(
              `input[type="checkbox"][data-eq-index="${eq.index}"]`,
            );
            if (!checkbox) continue;
            const active = !!eq.active;
            checkbox.checked = active;
            checkbox.setAttribute('aria-checked', active ? 'true' : 'false');
            const labelEl = checkbox.closest('label.bool-button');
            if (labelEl) {
              labelEl.classList.toggle('is-active', active);
            }
            const text = checkbox.nextElementSibling;
            if (text && text.classList.contains('bool-text')) {
              text.textContent = eq.label || `Equality ${eq.index}`;
            }
          }
          return;
        }
        // 重建：数量发生变化时
        container.innerHTML = '';
        for (const eq of eqs) {
          const control = { item_id: `equality.${eq.index}`, label: eq.label || `Equality ${eq.index}` };
          const row = createControlRow(control);
          row.classList.add('bool-row');
          const label = document.createElement('label');
          label.className = 'bool-button bool-label';
          const input = document.createElement('input');
          input.type = 'checkbox';
          input.setAttribute('role', 'switch');
          input.setAttribute('data-testid', control.item_id);
          input.setAttribute('data-eq-index', String(eq.index));
          const active = !!eq.active;
          input.checked = active;
          input.setAttribute('aria-checked', active ? 'true' : 'false');
          if (active) label.classList.add('is-active');
          const span = document.createElement('span');
          span.className = 'bool-text';
          span.textContent = control.label;
          label.append(input, span);
          row.append(label);
          container.appendChild(row);
          input.addEventListener('change', async (event) => {
            event.stopPropagation();
            const next = !!input.checked;
            label.classList.toggle('is-active', next);
            const eqName = eq.fullLabel || eq.label || `Eq ${eq.index}`;
            pushToast(`${next ? 'Enabled' : 'Disabled'} equality: ${eqName}`);
            try {
              await backend.apply?.({
                kind: 'ui',
                id: 'equality.toggle',
                value: { index: eq.index, active: next },
                control: { item_id: control.item_id },
              });
            } catch (err) {
              console.warn('[ui] equality toggle failed', err);
            }
          });
        }
        container.setAttribute('data-count', String(eqs.length));
      } catch (err) {
        console.warn('[ui] ensureEqualityToggles error', err);
      }
    },
    dispose,
  };
  const getCameraModeCount = () => {
    try {
      return Math.max(1, 2 + (store.get()?.model?.cameras?.length || 0));
    } catch {
      return Math.max(1, cameraPresets.length || 1);
    }
  };

}
