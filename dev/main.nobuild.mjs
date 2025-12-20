import * as THREE from 'three';
import {
  createViewerStore,
  createBackend,
  applySpecAction,
  applyGesture,
  readControlValue,
  mergeBackendSnapshot,
} from './viewer_state.mjs';
import {
  consumeViewerParams,
  isPerfEnabled,
  perfMarkOnce,
  perfNow,
  perfSample,
  logDebug,
  logWarn,
} from './viewer_runtime.mjs';
import {
  FALLBACK_PRESET_ALIASES,
  FALLBACK_PRESETS,
  createEnvironmentManager,
} from './viewer_renderer.mjs';
import { DEFAULT_REALTIME_INDEX, REALTIME_LEVELS } from './viewer_defaults.mjs';
import { createRendererManager } from './viewer_renderer.mjs';

function createControlManager({
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
    const label = entry.label || entry.file || entry.id || '';
    if (label) {
      store.update((draft) => {
        if (!draft.hud) draft.hud = {};
        draft.hud.modelLabel = label;
      });
    }
  };

  async function loadXmlTextAsModel(xmlText, label) {
    const text = typeof xmlText === 'string' ? xmlText : '';
    const name = typeof label === 'string' && label.trim().length ? label.trim() : `Model ${modelLibrary.length + 1}`;
    if (!text.trim()) {
      throw new Error('loadXmlTextAsModel: empty xml text');
    }
    const entry = {
      id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      label: name,
      kind: 'xmlText',
      xmlText: text,
    };
    addModelEntry(entry);
    resetModelFrontendState(store);
    if (typeof backend?.loadXmlText === 'function') {
      await backend.loadXmlText(text);
      pushToast?.(`Loaded model: ${name}`);
    }
  }

  function applyThemeFromColorControl(value) {
    if (typeof document === 'undefined' || !document.body) return;
    const token = String(value ?? '').toLowerCase();
    const isLight =
      token === 'light' ||
      token === '1' ||
      token === 'white' ||
      token === 'default';
    document.body.classList.toggle('theme-light', isLight);
  }

  function applySpacingFromControl(value) {
    if (typeof document === 'undefined' || !document.body) return;
    let isWide = false;
    const raw = value;
    if (typeof raw === 'number' || (typeof raw === 'string' && /^\d+$/.test(raw))) {
      const idx = Number(raw) | 0;
      isWide = idx === 1;
    } else if (typeof raw === 'string') {
      const token = raw.trim().toLowerCase();
      isWide = token.startsWith('wide');
    }
    document.body.classList.toggle('spacing-wide', isWide);
  }

  function applyFontFromControl(value) {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    if (!root || typeof root.style?.setProperty !== 'function') return;
    let scale = 1;
    let panelScale = 1;
    const raw = value;
    if (typeof raw === 'number' || (typeof raw === 'string' && /^\d+$/.test(raw))) {
      const idx = Number(raw) | 0;
      const lookup = [50, 75, 100, 150, 200];
      const pct = lookup[idx] ?? 100;
      if (pct > 0) scale = pct / 100;
      const panelLookup = {
        50: 0.7,
        75: 0.85,
        100: 1.0,
        150: 1.3,
        200: 1.6,
      };
      panelScale = panelLookup[pct] ?? 1.0;
    } else if (typeof raw === 'string') {
      const token = raw.trim().toLowerCase();
      const match = token.match(/(\d+)\s*%/);
      if (match) {
        const pct = Number(match[1]);
        if (Number.isFinite(pct) && pct > 0) {
          scale = pct / 100;
          const panelLookup = {
            50: 0.7,
            75: 0.85,
            100: 1.0,
            150: 1.3,
            200: 1.6,
          };
          panelScale = panelLookup[pct] ?? 1.0;
        }
      }
    }
    if (!Number.isFinite(scale) || scale <= 0) scale = 1;
    if (!Number.isFinite(panelScale) || panelScale <= 0) panelScale = 1;
    root.style.setProperty('--viewer-font-scale', String(scale));
    root.style.setProperty('--viewer_panel_scale', String(panelScale));
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

  const getOptionSupport = () => store.get()?.model?.optSupport ?? { supported: false, pointers: [] };
  const OPTION_BINDING_PREFIX = 'mjOption::';

  function isOptionBinding(control) {
    return typeof control?.binding === 'string' && control.binding.startsWith(OPTION_BINDING_PREFIX);
  }

  function applyOptionAvailability(control, element) {
    if (!element || !isOptionBinding(control)) return;
    const support = getOptionSupport();
    const supported = !!support?.supported;
    if ('disabled' in element) {
      element.disabled = !supported;
    }
    if (element instanceof HTMLElement) {
      const row = element.closest('.control-row');
      if (row) {
        row.classList.toggle('is-disabled', !supported);
      }
    }
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

function formatNumberTrimmed(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return '';
  const fixed = Number(num).toPrecision(6);
  return fixed.replace(/\.?0+$/, '');
}

function parseVectorInput(value, length) {
  if (Array.isArray(value)) {
    const arr = value.map((entry) => Number(entry));
    return arr.length === length && arr.every((n) => Number.isFinite(n)) ? arr : null;
  }
  if (value && typeof value === 'object') {
    const iterator = value[Symbol.iterator];
    const hasIterator = typeof iterator === 'function';
    const hasLength = Number.isFinite(value.length) && value.length >= 0;
    if (hasIterator || hasLength) {
      const arr = Array.from(value, (entry) => Number(entry));
      return arr.length === length && arr.every((n) => Number.isFinite(n)) ? arr : null;
    }
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const tokens = trimmed.split(/\s+/).filter(Boolean);
    if (tokens.length !== length) return null;
    const arr = tokens.map((token) => Number(token));
    return arr.every((n) => Number.isFinite(n)) ? arr : null;
  }
  if (typeof value === 'number' && length === 1) {
    return Number.isFinite(value) ? [Number(value)] : null;
  }
  return null;
}

function attachCommitHandlers(input, binding, commit) {
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

function attachOptionAvailability(control, element, binding) {
  if (!element || !binding) return;
  applyOptionAvailability(control, element);
  appendUpdateOptions(binding, () => {
    applyOptionAvailability(control, element);
  });
}

function appendUpdateOptions(binding, updater) {
  if (!binding || typeof updater !== 'function') return;
  const prev = binding.updateOptions;
  if (typeof prev === 'function') {
    binding.updateOptions = (state) => {
      prev(state);
      updater(state);
    };
  } else {
    binding.updateOptions = updater;
  }
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
  
  function registerGlobalShortcut(shortcutSpec, handler) {
    if (!shortcutSpec || typeof handler !== 'function') return;
    registerShortcutHandlers(shortcutSpec, handler);
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

  function renderFileSectionExtras(body) {
    const row = createControlRow(null);

    const loadLabel = document.createElement('label');
    loadLabel.className = 'btn-primary btn-file';
    loadLabel.textContent = 'Load xml';
    loadLabel.setAttribute('data-testid', 'file.load_xml_custom');

    const loadInput = document.createElement('input');
    loadInput.type = 'file';
    loadInput.accept = '.xml';
    loadInput.setAttribute('data-testid', 'file.load_xml_input');
    loadLabel.appendChild(loadInput);

    const field = document.createElement('div');
    field.className = 'control-field';

    const select = document.createElement('select');
    select.setAttribute('data-testid', 'file.model_select');

    field.append(select);
    row.append(loadLabel, field);
    body.append(row);

    modelSelectEl = select;
    refreshModelSelectOptions();

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

    loadInput.addEventListener('change', async () => {
      const file = loadInput.files && loadInput.files[0];
      if (!file) return;
      try {
        const text = await file.text();
        await loadXmlTextAsModel(text, file.name || null);
      } catch (err) {
        logError('[ui] load xml from file failed', err);
        pushToast?.('Failed to load xml from file');
        throw err;
      } finally {
        loadInput.value = '';
      }
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
        logError('[ui] model select reload failed', err);
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
    return {
      left: (json.left_panel ?? []).map(expandSection),
      right: (json.right_panel ?? []).map(expandSection),
    };
  }

    function createBoolToggleElements(control, { disabled = false } = {}) {
      const row = createControlRow(control);
      row.classList.add('bool-row');
      const label = document.createElement('label');
      label.className = 'bool-button bool-label';
      if (disabled) {
        label.classList.add('is-disabled');
      }
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.id = `${sanitiseName(control.item_id)}__checkbox`;
      input.setAttribute('role', 'switch');
      input.setAttribute('data-testid', control.item_id);
      input.setAttribute('aria-checked', 'false');
      if (disabled) {
        input.setAttribute('aria-disabled', 'true');
        input.disabled = true;
      }
      const span = document.createElement('span');
      span.className = 'bool-text';
      span.textContent = control.label ?? control.name ?? control.item_id;
      label.append(input, span);
      row.append(label);
      return { row, label, input, span };
    }

    function renderDisabledCheckbox(container, control) {
      const { row } = createBoolToggleElements(control, { disabled: true });
      container.append(row);
      return row;
    }

  function renderCheckbox(container, control) {
    const { row, label, input } = createBoolToggleElements(control);
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
      try {
        // eslint-disable-next-line no-console
      } catch {}
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

  function resolveColorLabel(value, options) {
    const palette = options.length > 0 ? options : ['Dark', 'Light'];
    let label;
    if (typeof value === 'number' || (typeof value === 'string' && /^\d+$/.test(value))) {
      const idx = Number(value) | 0;
      label = idx === 1 && palette.length > 1 ? palette[1] : palette[0];
    } else {
      const token = String(value ?? '').toLowerCase();
      if (token.startsWith('light')) {
        label =
          palette.find((opt) => String(opt).toLowerCase().startsWith('light')) ??
          palette[1] ??
          palette[0];
      } else if (token.startsWith('dark')) {
        label =
          palette.find((opt) => String(opt).toLowerCase().startsWith('dark')) ??
          palette[0];
      } else {
        label = palette[0];
      }
    }
    if (!palette.includes(label)) {
      label = palette[0];
    }
    return label;
  }

  function resolveSpacingLabel(value, options) {
    const labels = options.length > 0 ? options : ['Tight', 'Wide'];
    let label;
    if (typeof value === 'number' || (typeof value === 'string' && /^\d+$/.test(value))) {
      const idx = Number(value) | 0;
      label = labels[idx] ?? labels[0];
    } else if (typeof value === 'string') {
      const token = value.trim().toLowerCase();
      if (token.startsWith('wide')) {
        label =
          labels.find((opt) => String(opt).toLowerCase().startsWith('wide')) ??
          labels[1] ??
          labels[0];
      } else {
        label = labels[0];
      }
    } else {
      label = labels[0];
    }
    if (!labels.includes(label)) {
      label = labels[0];
    }
    return label;
  }

  function resolveFontLabel(value, options) {
    const labels = options.length > 0 ? options : ['50 %', '100 %', '150 %', '200 %', '250 %', '300 %'];
    let label;
    if (typeof value === 'number' || (typeof value === 'string' && /^\d+$/.test(value))) {
      const idx = Number(value) | 0;
      label = labels[idx] ?? labels[1] ?? labels[0];
    } else if (typeof value === 'string') {
      const token = value.trim().toLowerCase();
      const direct = labels.find((opt) => String(opt).trim().toLowerCase() === token);
      if (direct) {
        label = direct;
      } else {
        const match = token.match(/(\d+)\s*%/);
        if (match) {
          const pct = `${match[1]} %`;
          const exact = labels.find((opt) => String(opt).trim().toLowerCase() === pct.toLowerCase());
          label = exact || labels[0];
        } else {
          label = labels[0];
        }
      }
    } else {
      label = labels[0];
    }
    if (!labels.includes(label)) {
      label = labels[0];
    }
    return label;
  }

  const SELECT_SPECIALS = {
    'option.color': {
      defaultOptions: ['Dark', 'Light'],
      resolveLabel: resolveColorLabel,
      apply: applyThemeFromColorControl,
    },
    'option.spacing': {
      defaultOptions: ['Tight', 'Wide'],
      resolveLabel: resolveSpacingLabel,
      apply: applySpacingFromControl,
    },
    'option.font': {
      defaultOptions: ['50 %', '100 %', '150 %', '200 %', '250 %', '300 %'],
      resolveLabel: resolveFontLabel,
      apply: applyFontFromControl,
    },
  };

  function resolveSelectMeta(control, options) {
    const isCameraModeSelect = control.item_id === 'rendering.camera_mode';
    const isTrackingGeomSelect = control.item_id === 'rendering.tracking_geom';
    const isLabelModeSelect = control.binding === 'mjvOption::label';
    const isFrameModeSelect = control.binding === 'mjvOption::frame';
    const isNumericSelect = isLabelModeSelect || isFrameModeSelect;
    const isMjOptionEnumBinding = isOptionBinding(control);
    const isMjOptionEnumSelect =
      isMjOptionEnumBinding && !isNumericSelect && !isCameraModeSelect && !isTrackingGeomSelect;
    const special = SELECT_SPECIALS[control.item_id] ?? null;
    return {
      options,
      special,
      isCameraModeSelect,
      isTrackingGeomSelect,
      isNumericSelect,
      isMjOptionEnumSelect,
    };
  }

  function syncSelectOptions(select, meta, control) {
    if (meta.isCameraModeSelect) {
      syncCameraSelectOptions(select, control);
      return;
    }
    if (meta.isTrackingGeomSelect) {
      syncTrackingGeomSelectOptions(select, control);
      return;
    }
    meta.options.forEach((opt, idx) => {
      const option = document.createElement('option');
      option.value = meta.isNumericSelect ? String(idx) : opt;
      option.textContent = opt;
      select.appendChild(option);
    });
  }

  function readSelectValue(select, meta, control) {
    if (meta.isCameraModeSelect) {
      syncCameraSelectOptions(select, control);
      return toNumber(select.value);
    }
    if (meta.isTrackingGeomSelect) {
      syncTrackingGeomSelectOptions(select, control);
      return toNumber(select.value);
    }
    if (meta.isNumericSelect) {
      return Math.max(0, Math.trunc(toNumber(select.value)));
    }
    return select.value;
  }

  function applySelectValue(select, meta, control, value) {
    if (meta.special) {
      const label = meta.special.resolveLabel(value, meta.options);
      select.value = label;
      meta.special.apply(select.value);
      return;
    }
    if (meta.isCameraModeSelect) {
      const entries = syncCameraSelectOptions(select, control);
      const numericValue = Math.max(0, Math.trunc(toNumber(value)));
      const match = entries.find((entry) => entry.value === String(numericValue));
      const fallbackValue = entries[0]?.value ?? '0';
      select.value = match ? match.value : fallbackValue;
      return;
    }
    if (meta.isTrackingGeomSelect) {
      const entries = syncTrackingGeomSelectOptions(select, control);
      const numericValue = Math.trunc(toNumber(value));
      const match = entries.find((entry) => entry.value === String(numericValue));
      const fallbackValue = entries[0]?.value ?? '-1';
      select.value = match ? match.value : fallbackValue;
      return;
    }
    if (meta.isNumericSelect) {
      const numericValue = Math.max(0, Math.trunc(toNumber(value)));
      const clamped = Math.min(numericValue, Math.max(0, meta.options.length - 1));
      select.value = String(clamped);
      return;
    }
    if (meta.isMjOptionEnumSelect && (typeof value === 'number' || (typeof value === 'string' && /^\d+$/.test(value)))) {
      const idx = Number(value) | 0;
      const clamped = Math.max(0, Math.min(idx, Math.max(0, meta.options.length - 1)));
      const label = meta.options[clamped] ?? meta.options[0] ?? '';
      if (label) {
        select.value = label;
      }
      return;
    }
    if (value == null) {
      select.value = meta.options[0] ?? '';
      return;
    }
    const next = String(value);
    if (!meta.options.includes(next) && meta.options.length > 0) {
      select.value = meta.options[0];
    } else {
      select.value = next;
    }
  }

  function renderSelect(container, control) {
      const { row, label, field } = createLabeledRow(control);
      const inputId = `${sanitiseName(control.item_id)}__select`;
      label.setAttribute('for', inputId);
      const select = document.createElement('select');
      select.setAttribute('data-testid', control.item_id);
      select.id = inputId;
      const baseOptions = normaliseOptions(control.options);
      const fallbackOptions = SELECT_SPECIALS[control.item_id]?.defaultOptions ?? baseOptions;
      const options = baseOptions.length > 0 ? baseOptions : fallbackOptions;
      const meta = resolveSelectMeta(control, options);
      syncSelectOptions(select, meta, control);
      field.append(select);
      container.append(row);

      const binding = createBinding(control, {
        getValue: () => readSelectValue(select, meta, control),
        applyValue: (value) => applySelectValue(select, meta, control, value),
      });

      attachOptionAvailability(control, select, binding);
      if (control.item_id === 'rendering.tracking_geom') {
        appendUpdateOptions(binding, (state) => {
          const isTracking = (state?.runtime?.cameraIndex | 0) === 1;
          const disabled = !isTracking || select.options.length <= 1;
          select.disabled = disabled;
          row.classList.toggle('is-disabled', disabled);
        });
      }

      select.addEventListener(
        'change',
        guardBinding(binding, async () => {
          const value = readSelectValue(select, meta, control);
          if (meta.special) {
            meta.special.apply(value);
          }
          await applySpecAction(store, backend, control, value);
        }),
      );

      if (meta.special) {
        meta.special.apply(select.value);
      }
    }

  function buildSegmentedOptions(control, group, options) {
    return options.map((option, index) => {
        const key = option?.key ?? String(index);
        const value = option?.value ?? option?.label ?? '';
        const labelText = option?.label ?? value;
        const radioId = `${sanitiseName(control.item_id)}__${key}`;
        const wrapper = document.createElement('label');
        wrapper.className = 'segmented-option';
        const input = document.createElement('input');
        input.type = 'radio';
        input.name = control.item_id;
        input.value = String(value);
        input.id = radioId;
        input.dataset.key = String(key);
        input.dataset.index = String(index);
        const span = document.createElement('span');
        span.textContent = String(labelText);
        wrapper.append(input, span);
        group.append(wrapper);
      return input;
    });
  }

  function createSegmentedGroup(container, control, { options, layout = 'labeled', labelText = null }) {
    let field = null;
    if (layout === 'stacked') {
      const labelRow = createControlRow(control, { full: true });
      const label = document.createElement('label');
      label.className = 'control-label';
      label.textContent = labelText ?? control.label ?? control.name ?? control.item_id;
      labelRow.append(label);
      container.append(labelRow);

      const { row: groupRow, field: groupField } = createFullRow({ full: true });
      groupRow.dataset.controlId = control.item_id;
      field = groupField;
      container.append(groupRow);
    } else {
      const { row, field: groupField } = createLabeledRow(control);
      field = groupField;
      container.append(row);
    }

    const group = document.createElement('div');
    group.className = 'segmented';
    group.setAttribute('data-testid', control.item_id);
    field.append(group);
    const inputs = buildSegmentedOptions(control, group, options);
    return { group, inputs };
  }

  function attachSegmentedHandlers(control, inputs, { getValue, applyValue, onCommit }) {
    const binding = createBinding(control, { getValue, applyValue });
    inputs.forEach((input) => {
      input.addEventListener(
        'change',
        guardBinding(binding, async () => {
          if (!input.checked) return;
          await onCommit(binding, input);
        }),
      );
    });
    return binding;
  }

  function renderVisualSourceControl(container, control) {
      const { inputs } = createSegmentedGroup(container, control, {
        layout: 'stacked',
        options: [
        { key: 'preset-sun', label: 'Preset☀️', value: 'PresetSun' },
        { key: 'preset-moon', label: 'Preset🌙️', value: 'PresetMoon' },
        { key: 'model', label: 'Model', value: 'Model' },
        ],
      });

      let logicalValue = 'PresetSun';

      attachSegmentedHandlers(control, inputs, {
        getValue: () => logicalValue,
        applyValue: (value) => {
          const token = typeof value === 'string' ? value.toLowerCase() : '';
          let targetKey;
          if (token.startsWith('model')) {
            logicalValue = 'Model';
            targetKey = 'model';
          } else if (token.includes('moon')) {
            logicalValue = 'PresetMoon';
            targetKey = 'preset-moon';
          } else {
            logicalValue = 'PresetSun';
            targetKey = 'preset-sun';
          }
          inputs.forEach((input) => {
            const key = input.dataset.key || '';
            const active = key === targetKey;
            input.checked = active;
          });
        },
        onCommit: async (binding, input) => {
          const key = input.dataset.key || '';
          const modeValue = input.value || (key === 'model' ? 'Model' : input.value);
          binding.setValue(modeValue);
          try {
            await applySpecAction(store, backend, control, modeValue);
          } catch (err) {
            logWarn('[ui] visual source toggle failed', err);
          }
        },
      });
    }

    function renderRadio(container, control) {
      const options = normaliseOptions(control.options);
      const { inputs } = createSegmentedGroup(container, control, {
        options: options.map((opt, idx) => ({
          key: String(idx),
          value: String(opt),
          label: String(opt),
        })),
      });

    attachSegmentedHandlers(control, inputs, {
      getValue: () => inputs.find((r) => r.checked)?.value ?? options[0],
      applyValue: (value) => {
        inputs.forEach((radio, idx) => {
          if (value === options[idx] || value === idx || value === radio.value) {
            radio.checked = true;
          }
        });
      },
      onCommit: async (_binding, input) => {
        await applySpecAction(store, backend, control, input.value);
      },
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

    const updateAvailability = () => {
      applyOptionAvailability(control, input);
      if (input.disabled) {
        valueLabel.textContent = 'unsupported';
      }
    };
    updateAvailability();
    binding.updateOptions = updateAvailability;

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

    attachOptionAvailability(control, input, binding);

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

    attachCommitHandlers(input, binding, commit);
  }

  function renderVectorInputBase(container, control, {
    expectedLength,
    idSuffix,
    formatValue,
    allowDefaultPlaceholder = true,
  }) {
    const { row, input, field } = createTextInputField(container, control, {
      mode: 'text',
      idSuffix,
    });
    field.append(input);
    container.append(row);

    const targetLength = Math.max(1, expectedLength | 0);
    let lastValidText = '';
    const formatVector = (vector) => vector.map(formatValue).join(' ');

    const setInputText = (text) => {
      input.value = text;
      input.classList.remove('is-invalid');
    };

    const binding = createBinding(control, {
      getValue: () => lastValidText || input.value,
      applyValue: (value) => {
        if (value === undefined || value === null) return;
        const parsed = parseVectorInput(value, targetLength);
        if (parsed) {
          lastValidText = formatVector(parsed);
          setInputText(lastValidText);
          return;
        }
        const text = typeof value === 'string' ? value.trim() : String(value ?? '');
        setInputText(text);
      },
    });

    attachOptionAvailability(control, input, binding);

    const currentVector = readControlValue(store.get(), control);
    if (currentVector !== undefined && currentVector !== null) {
      binding.setValue(currentVector);
    } else if (control.default !== undefined) {
      if (typeof control.default === 'string' && allowDefaultPlaceholder) {
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
      const parsed = parseVectorInput(input.value, targetLength);
      if (parsed) {
        lastValidText = formatVector(parsed);
        setInputText(lastValidText);
        await applySpecAction(store, backend, control, parsed);
        return;
      }
      showInvalid();
    });

    attachCommitHandlers(input, binding, commit);
  }

  function renderVectorInput(container, control, expectedLength) {
    renderVectorInputBase(container, control, {
      expectedLength,
      idSuffix: '__vector',
      formatValue: formatNumber,
      allowDefaultPlaceholder: true,
    });
  }

  function renderVec3StringInput(container, control) {
    renderVectorInputBase(container, control, {
      expectedLength: 3,
      idSuffix: '__vec3str',
      formatValue: formatNumberTrimmed,
      allowDefaultPlaceholder: false,
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
    const { row, input, field } = createTextInputField(container, control, {
      mode: 'text',
      idSuffix: '__watch',
    });
    input.placeholder = 'qpos';
    const datalist = document.createElement('datalist');
    datalist.id = `${input.id}__options`;
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

    binding.updateOptions = syncOptions;
    syncOptions(store.get());

    const commit = guardBinding(binding, async () => {
      const token = input.value.trim();
      await applySpecAction(store, backend, control, token);
    });

    attachCommitHandlers(input, binding, commit);
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

  function renderSimulationNoiseNotice(container) {
    const row = createControlRow(null, { full: true });
    const field = document.createElement('div');
    field.className = 'control-field';
    const notice = document.createElement('div');
    notice.className = 'control-static';
    notice.textContent = 'Noise controls are disabled in this build.';
    field.append(notice);
    row.append(field);
    container.append(row);
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

  const CONTROL_OVERRIDES = {
    'simulation.run': renderRunToggle,
    'watch.field': renderWatchField,
    'option.visual_source': renderVisualSourceControl,
    'simulation.key_slider': renderKeyframeSelect,
    'option.profiler': renderDisabledCheckbox,
    'option.sensor': renderDisabledCheckbox,
  };
  const DISABLED_SHORTCUT_IDS = new Set(['option.profiler', 'option.sensor']);

  function renderControl(container, control) {
    const type = typeof control.type === 'string' ? control.type.toLowerCase() : 'static';
    const itemId = control?.item_id ?? '';
    if (control?.shortcut && !DISABLED_SHORTCUT_IDS.has(itemId)) {
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
    const override = CONTROL_OVERRIDES[itemId];
    if (override) {
      return override(container, control);
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

    const setCollapsed = (collapsed) => {
      sectionEl.classList.toggle('is-collapsed', collapsed);
      toggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    };

    const initialCollapsed = false;
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

    header.addEventListener('dblclick', (event) => {
      if (event.target === reset) return;
      event.preventDefault();
      event.stopPropagation();
      const sections = Array.from(container.querySelectorAll('.ui-section'));
      if (sections.length === 0) return;
      const allCollapsed = sections.every((sec) => sec.classList.contains('is-collapsed'));
      const collapseAll = !allCollapsed;
      sections.forEach((sec) => {
        sec.classList.toggle('is-collapsed', collapseAll);
        const btn = sec.querySelector('.section-toggle');
        if (btn) {
          btn.setAttribute('aria-expanded', collapseAll ? 'false' : 'true');
        }
      });
    });

    sectionEl.append(header, body);

    const resetTargets = [];
    if (section.section_id === 'file') {
      renderFileSectionExtras(body);
    } else {
      for (const item of section.items ?? []) {
        renderControl(body, item);
        if (section.section_id === 'simulation' && item?.item_id === 'simulation.save_key') {
          renderSimulationNoiseNotice(body);
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
              value = coerceBoolean(value);
            }
            await applySpecAction(store, backend, control, value);
          } catch (error) {
            logWarn('[ui] reset failed', target.id, error);
          }
        }
      });
    } else {
      reset.disabled = true;
    }

    container.append(sectionEl);
  }

  function ensureDynamicList({
    sectionId,
    dynamicKey,
    items,
    className = '',
    marginTop = null,
    updateExisting,
    buildItem,
  }) {
    if (!rightPanel || !Array.isArray(items)) return;
    const section = rightPanel.querySelector(`[data-section-id="${sectionId}"]`);
    if (!section) return;
    const body = section.querySelector('.section-body');
    if (!body) return;
    let container = body.querySelector(`[data-dynamic="${dynamicKey}"]`);
    if (!container) {
      container = document.createElement('div');
      container.setAttribute('data-dynamic', dynamicKey);
      if (className) container.className = className;
      if (marginTop !== null) container.style.marginTop = marginTop;
      body.appendChild(container);
    }
    if (items.length === 0) {
      container.innerHTML = '';
      container.setAttribute('data-count', '0');
      return;
    }
    const prevCount = Number(container.getAttribute('data-count') || '0');
    if (prevCount === items.length && container.childElementCount > 0) {
      if (typeof updateExisting === 'function') {
        updateExisting(container, items);
      }
      return;
    }
    container.innerHTML = '';
    items.forEach((item, index) => {
      buildItem(container, item, index);
    });
    container.setAttribute('data-count', String(items.length));
  }

  function resolveListIndex(item, fallback) {
    const idx = Number(item?.index);
    return Number.isFinite(idx) ? idx : fallback;
  }

  function ensureDynamicSliders({
    sectionId,
    dynamicKey,
    items,
    itemIdPrefix,
    dataAttr,
    getIndex,
    getLabel,
    getRange,
    getValue,
    updateRange = false,
    onInput,
  }) {
    ensureDynamicList({
      sectionId,
      dynamicKey,
      items,
      marginTop: '8px',
      updateExisting: (containerEl, entries) => {
        for (let fallback = 0; fallback < entries.length; fallback += 1) {
          const item = entries[fallback];
          const index = getIndex(item, fallback);
          const slider = containerEl.querySelector(`input[type="range"][${dataAttr}="${index}"]`);
          if (!slider) continue;
          if (!slider.dataset.editing) slider.dataset.editing = '0';
          if (slider.dataset.editing === '1') continue;
          if (updateRange) {
            const range = getRange(item, fallback);
            if (Number(slider.min) !== range.min) slider.min = String(range.min);
            if (Number(slider.max) !== range.max) slider.max = String(range.max);
          }
          const nextValue = getValue(item, fallback);
          if (nextValue == null) continue;
          const numeric = Number(nextValue);
          if (!Number.isFinite(numeric)) continue;
          if (Number(slider.value) !== numeric) slider.value = String(numeric);
        }
      },
      buildItem: (containerEl, item, fallback) => {
        const index = getIndex(item, fallback);
        const row = createControlRow({ item_id: `${itemIdPrefix}${index}` });
        row.classList.add('half');
        const label = document.createElement('label');
        label.className = 'control-label';
        label.textContent = getLabel(item, fallback);
        const field = document.createElement('div');
        field.className = 'control-field';
        const input = document.createElement('input');
        input.type = 'range';
        const range = getRange(item, fallback);
        input.min = String(range.min);
        input.max = String(range.max);
        input.step = String(range.step);
        const initial = getValue(item, fallback);
        const initialValue = Number.isFinite(Number(initial)) ? Number(initial) : 0;
        input.value = String(initialValue);
        input.setAttribute(dataAttr, String(index));
        input.setAttribute('data-testid', `${itemIdPrefix}${index}`);
        input.dataset.editing = '0';
        input.addEventListener('focus', () => {
          input.dataset.editing = '1';
        });
        const clearEditing = () => {
          input.dataset.editing = '0';
        };
        input.addEventListener('blur', clearEditing);
        input.addEventListener('pointerup', clearEditing);
        input.addEventListener('pointerleave', clearEditing);
        field.appendChild(input);
        row.append(label, field);
        containerEl.appendChild(row);
        input.addEventListener('input', async () => {
          const idx = Number(index) | 0;
          const v = Number(input.value) || 0;
          await onInput({ index: idx, value: v, item, range });
        });
      },
    });
  }

  function renderPanels(spec) {
    if (!leftPanel || !rightPanel) return;
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
      binding.setValue?.(value);
    }
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
            result.catch?.((error) => logWarn('[ui] shortcut handler error', error));
          }
        } catch (error) {
          logWarn('[ui] shortcut handler error', error);
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
      loadXmlTextAsModel,
      getBinding: (id) => controlBindings.get(id) ?? null,
      registerGlobalShortcut,
      listIds: (prefix) => {
      const ids = Array.from(controlById.keys()).sort();
      if (!prefix) return ids;
      return ids.filter((id) => id.startsWith(prefix));
    },
    getControl: (id) => controlById.get(id) ?? null,
      // Dynamic: ensure Actuator sliders exist under right panel 'control' section
    ensureActuatorSliders: (actuators, ctrlValues = []) => {
        try {
          ensureDynamicSliders({
            sectionId: 'control',
            dynamicKey: 'actuators',
            items: actuators,
            itemIdPrefix: 'control.act.',
            dataAttr: 'data-act-index',
            getIndex: (item, fallback) => resolveListIndex(item, fallback),
            getLabel: (item, fallback) => item.name ?? `Act ${resolveListIndex(item, fallback)}`,
            getRange: (item) => ({
              min: Number.isFinite(item.min) ? item.min : -1,
              max: Number.isFinite(item.max) ? item.max : 1,
              step: Number.isFinite(item.step) && item.step > 0 ? item.step : 0.001,
            }),
            getValue: (item, fallback) => {
              const index = resolveListIndex(item, fallback);
              const raw = Array.isArray(ctrlValues) && Number.isFinite(Number(ctrlValues[index]))
                ? Number(ctrlValues[index])
                : (ctrlValues?.[index] ?? null);
              if (raw == null) return null;
              const numeric = Number(raw);
              return Number.isFinite(numeric) ? numeric : null;
            },
            onInput: async ({ index, value }) => {
              try {
                await applySpecAction(store, backend, { item_id: 'control.actuator' }, { index, value });
              } catch (err) {
                logWarn('[ui] set actuator failed', err);
              }
            },
          });
      } catch (err) {
        logWarn('[ui] ensureActuatorSliders error', err);
        }
      },
    // Dynamic: ensure Joint sliders exist under right panel 'joint' section
    ensureJointSliders: (dofs = []) => {
      try {
        ensureDynamicSliders({
          sectionId: 'joint',
          dynamicKey: 'joints',
          items: dofs,
          itemIdPrefix: 'joint.',
          dataAttr: 'data-joint-index',
          getIndex: (item, fallback) => resolveListIndex(item, fallback),
          getLabel: (item, fallback) => item.label || `Joint ${resolveListIndex(item, fallback)}`,
          getRange: (item) => ({
            min: item.min,
            max: item.max,
            step: Number.isFinite(item.step) && item.step > 0
              ? item.step
              : Math.max((item.max - item.min) / 500, 0.0001),
          }),
          getValue: (item) => (Number.isFinite(item.value) ? item.value : 0),
          updateRange: true,
          onInput: async ({ index, value, range }) => {
            try {
              await applySpecAction(store, backend, { item_id: 'joint.slider' }, {
                index,
                value,
                min: range.min,
                max: range.max,
              });
            } catch (err) {
              logWarn('[ui] set joint qpos failed', err);
            }
          },
        });
      } catch (err) {
        logWarn('[ui] ensureJointSliders error', err);
      }
    },
    // Dynamic: ensure Equality toggles exist under right panel 'equality' section
    ensureEqualityToggles: (eqs = []) => {
      try {
        ensureDynamicList({
          sectionId: 'equality',
          dynamicKey: 'equality',
          items: eqs,
          className: 'equality-toggle-container',
          updateExisting: (container, entries) => {
            // Stable update: only sync active state and label,不重建 DOM，避免交互时节点被移除
            for (const eq of entries) {
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
          },
          buildItem: (container, eq) => {
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
                await applySpecAction(store, backend, { item_id: 'equality.toggle' }, { index: eq.index, active: next });
              } catch (err) {
                logWarn('[ui] equality toggle failed', err);
              }
            });
          },
        });
      } catch (err) {
        logWarn('[ui] ensureEqualityToggles error', err);
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

function createCameraController({
  THREE_NS,
  canvas,
  store,
  backend,
  onGesture,
  renderCtx,
  debugMode = false,
  globalUp = new THREE_NS.Vector3(0, 0, 1),
  // new options (high‑leverage changes)
  minDistance,
  getMinDistance,
  zoomK = 0.35,
  maxWheelStep,
  invertY = false,
  keyRoot = null,
  assertUp = false,
  wheelLineFactor = 16,
  wheelPageFactor = 800,
  minOrthoZoom = 0.05,
  maxOrthoZoom = 200,
}) {
  const pointerState = {
    id: null,
    mode: 'idle',
    lastX: null,
    lastY: null,
    active: false,
  };

  const modifierState = {
    ctrl: false,
    shift: false,
    alt: false,
    meta: false,
  };

  const tempVecA = new THREE_NS.Vector3();
  const tempVecB = new THREE_NS.Vector3();
  const tempVecC = new THREE_NS.Vector3();
  const tempVecD = new THREE_NS.Vector3();
  const tempSpherical = new THREE_NS.Spherical();

  const cleanup = [];
  let initialised = false;
  let upNormalised = new THREE_NS.Vector3().copy(globalUp).normalize();
  let up0 = upNormalised.clone();

  const cameraModeIndex = () => {
    try {
      return store.get()?.runtime?.cameraIndex ?? 0;
    } catch {
      return 0;
    }
  };

  const isInteractiveCamera = () => cameraModeIndex() <= 1;

  function currentCtrl(event) {
    return !!event?.ctrlKey || modifierState.ctrl;
  }

  function currentShift(event) {
    return !!event?.shiftKey || modifierState.shift;
  }

  function resolveGestureMode(event) {
    const btn = typeof event.button === 'number' ? event.button : 0;
    if (currentCtrl(event)) return 'rotate';
    if (currentShift(event)) return 'translate';
    if (btn === 2) return 'translate';
    if (btn === 1) return 'zoom';
    return 'orbit';
  }

  function pointerButtons(event) {
    if (event && typeof event.buttons === 'number') return event.buttons;
    if (event && typeof event.button === 'number') {
      switch (event.button) {
        case 0:
          return 1;
        case 1:
          return 4;
        case 2:
          return 2;
        default:
          return 1 << event.button;
      }
    }
    return 0;
  }

  function computeMinDistance(camera, target) {
    if (Number.isFinite(minDistance)) return Math.max(0.01, Number(minDistance));
    if (typeof getMinDistance === 'function') {
      const v = Number(getMinDistance(camera, target, renderCtx));
      if (Number.isFinite(v) && v > 0) return Math.max(0.01, v);
    }
    return 0.15;
  }

  function applyCameraGesture(mode, dx, dy) {
    const ctx = renderCtx;
    const camera = ctx.camera;
    if (!camera) return;
    if (!ctx.cameraTarget) {
      ctx.cameraTarget = new THREE_NS.Vector3(0, 0, 0);
    }
    const target = ctx.cameraTarget;
    const offset = tempVecA.copy(camera.position).sub(target);
    const distance = offset.length();
    const minDist = computeMinDistance(camera, target);
    if (assertUp && renderCtx?.camera) {
      try {
        const dot = renderCtx.camera.up.clone().normalize().dot(up0);
        if (dot < 0.999) {
          renderCtx.camera.up.copy(upNormalised);
        }
      } catch {}
    }

    const elementWidth = canvas?.clientWidth || (typeof window !== 'undefined' ? window.innerWidth : 1) || 1;
    const elementHeight = canvas?.clientHeight || (typeof window !== 'undefined' ? window.innerHeight : 1) || 1;
    const shortEdge = Math.max(1, Math.min(elementWidth, elementHeight));
    const fovRad = THREE_NS.MathUtils.degToRad(typeof camera.fov === 'number' ? camera.fov : 45);
    const isOrtho = !!camera.isOrthographicCamera;

    switch (mode) {
      case 'translate': {
        const dyEff = invertY ? -dy : dy;
        let moveX = 0;
        let moveY = 0;
        if (isOrtho && typeof camera.zoom === 'number') {
          const zoom = Math.max(1e-6, camera.zoom || 1);
          const widthWorld = Math.abs((camera.right ?? 1) - (camera.left ?? -1)) / zoom;
          const heightWorld = Math.abs((camera.top ?? 1) - (camera.bottom ?? -1)) / zoom;
          moveX = -dx * (widthWorld / elementWidth);
          moveY = dyEff * (heightWorld / elementHeight);
        } else {
          const panScale = distance * Math.tan(fovRad / 2);
          moveX = (-2 * dx * panScale) / shortEdge;
          moveY = (2 * dyEff * panScale) / shortEdge;
        }
        const forward = tempVecB;
        camera.getWorldDirection(forward).normalize();
        const up = tempVecD.copy(upNormalised);
        const right = tempVecC.copy(forward).cross(up).normalize();
        const pan = right.multiplyScalar(moveX).add(up.multiplyScalar(moveY));
        camera.position.add(pan);
        target.add(pan);
        camera.lookAt(target);
        break;
      }
      case 'zoom': {
        if (isOrtho && typeof camera.zoom === 'number') {
          const base = Math.max(1e-6, camera.zoom || 1);
          const factor = Math.exp((dy / shortEdge) * (Number.isFinite(zoomK) ? zoomK * 0.2 : 0.07));
          const nextZoom = THREE_NS.MathUtils.clamp(base * factor, minOrthoZoom, maxOrthoZoom);
          camera.zoom = nextZoom;
          if (typeof camera.updateProjectionMatrix === 'function') camera.updateProjectionMatrix();
        } else {
          const zoomSpeed = distance * 0.002;
          const delta = dy * zoomSpeed;
          const newLen = Math.max(minDist, distance + delta);
          offset.setLength(newLen);
          camera.position.copy(tempVecC.copy(target).add(offset));
          camera.lookAt(target);
        }
        break;
      }
      case 'rotate': {
        let yaw = (1.6 * Math.PI * dx) / elementWidth;
        let pitch = (1.6 * Math.PI * (invertY ? -dy : dy)) / elementHeight;
        if (distance <= minDist * 1.05) {
          yaw *= 0.35;
          pitch *= 0.35;
        }
        const up = tempVecD.copy(upNormalised);
        const forward = tempVecB.copy(target).sub(camera.position).normalize();
        const right = tempVecC.copy(forward).cross(up).normalize();
        forward.applyAxisAngle(up, -yaw);
        forward.applyAxisAngle(right, -pitch);
        forward.normalize();
        const nextTarget = tempVecA.copy(camera.position).add(forward.multiplyScalar(distance));
        target.copy(nextTarget);
        camera.lookAt(target);
        break;
      }
      case 'orbit':
      default: {
        const dyEff = invertY ? -dy : dy;
        const radiansPerPixel = Math.PI / shortEdge;
        const thetaDelta = -dx * radiansPerPixel;
        const phiDelta = -dyEff * radiansPerPixel;
        tempSpherical.setFromVector3(offset);
        tempSpherical.theta += thetaDelta;
        tempSpherical.phi += phiDelta;
        tempSpherical.makeSafe();
        tempSpherical.radius = Math.max(minDist, tempSpherical.radius);
        offset.setFromSpherical(tempSpherical);
        camera.position.copy(tempVecC.copy(target).add(offset));
        camera.lookAt(target);
        break;
      }
    }
  }

  function handlePointerDown(event) {
    if (!event || !isInteractiveCamera()) return;
    const mode = resolveGestureMode(event);
    pointerState.id = event.pointerId ?? event.pointerId === 0 ? event.pointerId : 'mouse';
    pointerState.active = true;
    pointerState.mode = mode;
    pointerState.lastX = event.clientX;
    pointerState.lastY = event.clientY;
    if (canvas && typeof canvas.setPointerCapture === 'function' && event.pointerId != null) {
      try { canvas.setPointerCapture(event.pointerId); } catch {}
    }
    if (typeof onGesture === 'function') {
      onGesture({ mode, phase: 'start', pointer: event });
    }
  }

  function handlePointerMove(event) {
    if (!event || !pointerState.active) return;
    if (pointerState.id !== (event.pointerId ?? pointerState.id)) return;
    const dx = (event.clientX ?? 0) - (pointerState.lastX ?? event.clientX ?? 0);
    const dy = (event.clientY ?? 0) - (pointerState.lastY ?? event.clientY ?? 0);
    pointerState.lastX = event.clientX;
    pointerState.lastY = event.clientY;
    if (!dx && !dy) return;
    applyCameraGesture(pointerState.mode, dx, dy);
    if (typeof onGesture === 'function') {
      onGesture({ mode: pointerState.mode, phase: 'update', pointer: event, drag: { dx, dy } });
    }
  }

  function handlePointerUp(event) {
    if (!event || !pointerState.active) return;
    if (pointerState.id !== (event.pointerId ?? pointerState.id)) return;
    if (typeof onGesture === 'function') {
      onGesture({ mode: pointerState.mode, phase: 'end', pointer: event });
    }
    pointerState.active = false;
    pointerState.id = null;
    pointerState.mode = 'idle';
    pointerState.lastX = null;
    pointerState.lastY = null;
    if (canvas && typeof canvas.releasePointerCapture === 'function' && event.pointerId != null) {
      try { canvas.releasePointerCapture(event.pointerId); } catch {}
    }
  }

  function handleWheel(event) {
    if (!event || !isInteractiveCamera()) return;
    if (typeof event.preventDefault === 'function') event.preventDefault();
    let dy = event.deltaY;
    if (event.deltaMode === 1) dy *= wheelLineFactor;
    if (event.deltaMode === 2) dy *= wheelPageFactor;
    if (Number.isFinite(maxWheelStep)) {
      dy = Math.max(-maxWheelStep, Math.min(maxWheelStep, dy));
    }
    applyCameraGesture('zoom', 0, dy);
    if (typeof onGesture === 'function') {
      onGesture({ mode: 'zoom', phase: 'update', pointer: event, drag: { dx: 0, dy } });
    }
  }

  function handleKey(event, nextState) {
    if (!event) return;
    if (typeof event.key !== 'string') return;
    const key = event.key.toLowerCase();
    if (key === 'control') modifierState.ctrl = nextState;
    if (key === 'shift') modifierState.shift = nextState;
    if (key === 'alt') modifierState.alt = nextState;
    if (key === 'meta') modifierState.meta = nextState;
  }

  function install() {
    if (initialised) return;
    initialised = true;
    if (!canvas) return;
    const root = keyRoot || canvas;
    const onPointerDown = (event) => handlePointerDown(event);
    const onPointerMove = (event) => handlePointerMove(event);
    const onPointerUp = (event) => handlePointerUp(event);
    const onWheel = (event) => handleWheel(event);
    const onKeyDown = (event) => handleKey(event, true);
    const onKeyUp = (event) => handleKey(event, false);
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerUp);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    if (root) {
      root.addEventListener('keydown', onKeyDown);
      root.addEventListener('keyup', onKeyUp);
    }
    cleanup.push(() => {
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerUp);
      canvas.removeEventListener('wheel', onWheel);
      if (root) {
        root.removeEventListener('keydown', onKeyDown);
        root.removeEventListener('keyup', onKeyUp);
      }
    });
  }

  function dispose() {
    while (cleanup.length) {
      const fn = cleanup.pop();
      try { fn(); } catch {}
    }
  }

  return {
    install,
    setup: install,
    dispose,
    applyGesture: applyCameraGesture,
    getModifierState: () => ({ ...modifierState }),
    isInteractiveCamera,
  };
}

function defaultSelection() {
  return {
    geom: -1,
    body: -1,
    joint: -1,
    name: '',
    kind: 'geom',
    point: [0, 0, 0],
    localPoint: [0, 0, 0],
    normal: [0, 0, 1],
    seq: 0,
    timestamp: 0,
  };
}

const PERTURB_LABEL = {
  translate: 'perturb-translate',
  rotate: 'perturb-rotate',
};

const STATIC_PICK_BLOCK = { blocked: 'static' };

function createPickingController({
  THREE_NS = THREE,
  canvas,
  store,
  backend,
  renderCtx,
  debugMode = false,
  globalUp = new THREE_NS.Vector3(0, 0, 1),
  getSnapshot = null,
} = {}) {
  if (!canvas || !store || !backend || !renderCtx) {
    throw new Error('Picking controller requires canvas, store, backend, and renderCtx.');
  }
  const raycaster = new THREE_NS.Raycaster();
  const pointerNdc = new THREE_NS.Vector2();
  const normalMatrix = new THREE_NS.Matrix3();
  const tempQuat = new THREE_NS.Quaternion();
  const tempMat4 = new THREE_NS.Matrix4();
  const tempMat4B = new THREE_NS.Matrix4();
  const tempVecA = new THREE_NS.Vector3();
  const dragState = {
    active: false,
    pointerId: null,
    mode: 'idle',
    lastX: 0,
    lastY: 0,
    shiftKey: false,
    anchorLocal: new THREE_NS.Vector3(),
    bodyId: -1,
  };
  const cleanup = [];
  const tempBodyPos = new THREE_NS.Vector3();
  const tempBodyCom = new THREE_NS.Vector3();
  const tempBodyRot = new Float64Array(9);
  const tempVecLocal = new THREE_NS.Vector3();
  const tempVecWorld = new THREE_NS.Vector3();
  const tempCameraOffset = new THREE_NS.Vector3();
  let lastRightDownTime = 0;
  let lastRightDownCtrl = false;

  function hasSelection() {
    const sel = store.get()?.runtime?.selection;
    return !!sel && Number.isInteger(sel.geom) && sel.geom >= 0;
  }

  function currentSelection() {
    return store.get()?.runtime?.selection || null;
  }

  function selectionSeq(nextSeq) {
    return Number.isFinite(nextSeq) ? nextSeq : (currentSelection()?.seq || 0) + 1;
  }

  function clearSelection({ toast = false } = {}) {
    store.update((draft) => {
      if (!draft.runtime) draft.runtime = {};
      const prevSeq = (draft.runtime.selection?.seq || 0) + 1;
      draft.runtime.selection = { ...defaultSelection(), seq: prevSeq, timestamp: Date.now() };
      draft.runtime.lastAction = 'select-none';
      if (toast) {
        draft.toast = { message: 'Selection cleared', ts: Date.now() };
      }
    });
    dragState.bodyId = -1;
  }

  function showToast(message) {
    if (!message) return;
    const ts = Date.now();
    store.update((draft) => {
      draft.toast = { message, ts };
    });
  }

  function updateSelection(pick) {
    if (!pick) return;
    const ts = Date.now();
    store.update((draft) => {
      if (!draft.runtime) draft.runtime = {};
      const seq = (draft.runtime.selection?.seq || 0) + 1;
      draft.runtime.selection = {
        geom: pick.geomIndex,
        body: pick.bodyId,
        joint: pick.jointId,
        name: pick.geomName,
        kind: 'geom',
        point: [pick.worldPoint.x, pick.worldPoint.y, pick.worldPoint.z],
        localPoint: [pick.localPoint.x, pick.localPoint.y, pick.localPoint.z],
        normal: [pick.worldNormal.x, pick.worldNormal.y, pick.worldNormal.z],
        seq,
        timestamp: ts,
      };
      draft.runtime.lastAction = 'select';
      draft.toast = { message: `Selected ${pick.geomName}`, ts };
    });
    if (pick.bodyId >= 0) {
      dragState.bodyId = pick.bodyId;
      setAnchorLocalFromWorld(pick.bodyId, pick.worldPoint);
    }
  }

  function getMeshList() {
    const list = [];
    const batches = renderCtx?._instancing?.batches || null;
    if (batches instanceof Map) {
      for (const batch of batches.values()) {
        const mesh = batch?.mesh || null;
        const count = typeof mesh?.count === 'number' ? (mesh.count | 0) : 0;
        if (mesh && mesh.visible !== false && count > 0) {
          list.push(mesh);
        }
      }
    }
    if (Array.isArray(renderCtx.meshes)) {
      for (const mesh of renderCtx.meshes) {
        if (mesh && mesh.visible !== false) list.push(mesh);
      }
    }
    return list;
  }

  function projectPointer(event) {
    const rect = canvas.getBoundingClientRect();
    const width = Math.max(1, rect.width);
    const height = Math.max(1, rect.height);
    pointerNdc.x = ((event.clientX - rect.left) / width) * 2 - 1;
    pointerNdc.y = -(((event.clientY - rect.top) / height) * 2 - 1);
    return { width, height };
  }

  function resolveGeomMesh(object) {
    let current = object;
    while (current) {
      if (typeof current.userData?.geomIndex === 'number') {
        return current;
      }
      current = current.parent;
    }
    return null;
  }

  function geomNameFor(index) {
    const mesh = Array.isArray(renderCtx.meshes) ? renderCtx.meshes[index] : null;
    if (mesh?.userData?.geomName) {
      return mesh.userData.geomName;
    }
    const state = store.get();
    const geoms = Array.isArray(state?.model?.geoms) ? state.model.geoms : [];
    for (const geom of geoms) {
      if ((geom?.index | 0) === index) {
        return (geom?.name || `Geom ${index}`).trim();
      }
    }
    return `Geom ${index}`;
  }

  function bodyIdFor(index) {
    const mesh = Array.isArray(renderCtx.meshes) ? renderCtx.meshes[index] : null;
    if (Number.isFinite(mesh?.userData?.geomBodyId)) {
      return mesh.userData.geomBodyId | 0;
    }
    const state = store.get();
    const arr = state?.model?.geomBodyId;
    if (!arr) return -1;
    try {
      return arr[index] ?? -1;
    } catch {
      return -1;
    }
  }

  function jointIdFor(bodyId) {
    if (!(bodyId >= 0)) return -1;
    const state = store.get();
    const bodyAdr = state?.model?.bodyJntAdr;
    const bodyNum = state?.model?.bodyJntNum;
    const jtype = state?.model?.jntType;
    if (!bodyAdr || !bodyNum || !jtype) return -1;
    const base = bodyAdr[bodyId] ?? -1;
    const num = bodyNum[bodyId] ?? 0;
    if (!(num > 0)) return -1;
    const j = base >= 0 ? (base | 0) : -1;
    if (j < 0 || j >= jtype.length) return -1;
    return j;
  }

  function applySelectionFromPick(pick, event = null) {
    updateSelection(pick);
    if (!event) return;
    if (event.shiftKey) {
      store.update((draft) => {
        if (!draft.runtime) draft.runtime = {};
        draft.runtime.trackingGeom = pick.geomIndex;
      });
      const trackingCtrl = { item_id: 'simulation.tracking_geom', type: 'select' };
      const cameraCtrl = { item_id: 'simulation.camera', type: 'select' };
      Promise.resolve(
        applySpecAction(store, backend, trackingCtrl, pick.geomIndex),
      )
        .then(() => applySpecAction(store, backend, cameraCtrl, 1))
        .catch(() => {});
    }
  }

  function resolveDragMode(event) {
    if (event.ctrlKey) return 'rotate';
    if (event.shiftKey) return 'translate';
    if (event.button === 2) return 'translate';
    return 'rotate';
  }

  function selectionAsBody() {
    const sel = currentSelection();
    if (!sel || sel.body < 0) return null;
    return sel.body;
  }

  function updateAnchorFromSelection() {
    const sel = currentSelection();
    if (!sel || sel.body < 0 || !sel.point) return;
    tempVecA.set(sel.point[0], sel.point[1], sel.point[2]);
    setAnchorLocalFromWorld(sel.body, tempVecA);
  }

  function setAnchorLocalFromWorld(bodyId, worldPoint) {
    const snapshot = typeof getSnapshot === 'function' ? getSnapshot() : null;
    if (!snapshot || !snapshot.body_xpos || !snapshot.body_xmat) return;
    const base = bodyId * 3;
    const baseMat = bodyId * 9;
    if (!snapshot.body_xpos || !snapshot.body_xmat) return;
    tempBodyPos.set(
      snapshot.body_xpos[base + 0] ?? 0,
      snapshot.body_xpos[base + 1] ?? 0,
      snapshot.body_xpos[base + 2] ?? 0,
    );
    tempBodyRot.set([
      snapshot.body_xmat[baseMat + 0] ?? 1,
      snapshot.body_xmat[baseMat + 1] ?? 0,
      snapshot.body_xmat[baseMat + 2] ?? 0,
      snapshot.body_xmat[baseMat + 3] ?? 0,
      snapshot.body_xmat[baseMat + 4] ?? 1,
      snapshot.body_xmat[baseMat + 5] ?? 0,
      snapshot.body_xmat[baseMat + 6] ?? 0,
      snapshot.body_xmat[baseMat + 7] ?? 0,
      snapshot.body_xmat[baseMat + 8] ?? 1,
    ]);
    tempQuat.setFromRotationMatrix(tempMat4.set(
      tempBodyRot[0], tempBodyRot[1], tempBodyRot[2], 0,
      tempBodyRot[3], tempBodyRot[4], tempBodyRot[5], 0,
      tempBodyRot[6], tempBodyRot[7], tempBodyRot[8], 0,
      0, 0, 0, 1,
    ));
    tempVecLocal.copy(worldPoint).sub(tempBodyPos);
    tempVecLocal.applyQuaternion(tempQuat.invert());
    dragState.anchorLocal.copy(tempVecLocal);
  }

  function readBodyPose(bodyId, outPos, outRot) {
    const snapshot = typeof getSnapshot === 'function' ? getSnapshot() : null;
    if (!snapshot || !snapshot.body_xpos || !snapshot.body_xmat) return false;
    const base = bodyId * 3;
    const baseMat = bodyId * 9;
    outPos.set(
      snapshot.body_xpos[base + 0] ?? 0,
      snapshot.body_xpos[base + 1] ?? 0,
      snapshot.body_xpos[base + 2] ?? 0,
    );
    outRot.set([
      snapshot.body_xmat[baseMat + 0] ?? 1,
      snapshot.body_xmat[baseMat + 1] ?? 0,
      snapshot.body_xmat[baseMat + 2] ?? 0,
      snapshot.body_xmat[baseMat + 3] ?? 0,
      snapshot.body_xmat[baseMat + 4] ?? 1,
      snapshot.body_xmat[baseMat + 5] ?? 0,
      snapshot.body_xmat[baseMat + 6] ?? 0,
      snapshot.body_xmat[baseMat + 7] ?? 0,
      snapshot.body_xmat[baseMat + 8] ?? 1,
    ]);
    return true;
  }

  function resolvePick(event) {
    const { width, height } = projectPointer(event);
    const camera = renderCtx.camera;
    if (!camera) return null;
    raycaster.setFromCamera(pointerNdc, camera);
    const list = getMeshList();
    if (!list.length) return null;
    const hits = raycaster.intersectObjects(list, true);
    if (!hits.length) return null;
    const hit = hits.find((entry) => entry?.object && entry?.point);
    if (!hit) return null;
    const mesh = resolveGeomMesh(hit.object);
    if (!mesh) return null;
    const geomIndex = mesh.userData?.geomIndex ?? -1;
    if (!(geomIndex >= 0)) return null;
    const geomName = mesh.userData?.geomName || geomNameFor(geomIndex);
    const bodyId = bodyIdFor(geomIndex);
    if (mesh.userData?.geomStatic) {
      return { blocked: 'static', geomIndex, geomName };
    }
    const normal = hit.face?.normal || null;
    if (!normal) return null;
    const worldNormal = normal.clone().applyMatrix3(normalMatrix.getNormalMatrix(hit.object.matrixWorld)).normalize();
    const localPoint = hit.point.clone();
    hit.object.worldToLocal(localPoint);
    return {
      geomIndex,
      geomName,
      bodyId,
      jointId: jointIdFor(bodyId),
      worldPoint: hit.point.clone(),
      localPoint,
      worldNormal,
      screen: { width, height },
    };
  }

  function selectionFromPick(pick, event) {
    if (!pick) return null;
    if (pick.blocked === 'static') return STATIC_PICK_BLOCK;
    if (!Number.isFinite(pick.geomIndex) || pick.geomIndex < 0) return null;
    applySelectionFromPick(pick, event);
    return pick;
  }

  function updatePerturb(pointWorld, mode) {
    const bodyId = dragState.bodyId;
    if (!(bodyId >= 0)) return;
    const outPos = tempBodyPos;
    if (!readBodyPose(bodyId, outPos, tempBodyRot)) return;
    tempQuat.setFromRotationMatrix(tempMat4.set(
      tempBodyRot[0], tempBodyRot[1], tempBodyRot[2], 0,
      tempBodyRot[3], tempBodyRot[4], tempBodyRot[5], 0,
      tempBodyRot[6], tempBodyRot[7], tempBodyRot[8], 0,
      0, 0, 0, 1,
    ));
    const anchorWorld = dragState.anchorLocal.clone().applyQuaternion(tempQuat).add(outPos);
    const action = mode === 'translate' ? 'translate' : 'rotate';
    const payload = {
      kind: 'gesture',
      mode: action,
      phase: 'update',
      pointer: {
        x: 0,
        y: 0,
        dx: 0,
        dy: 0,
      },
      drag: {
        dx: pointWorld.x - anchorWorld.x,
        dy: pointWorld.y - anchorWorld.y,
        dz: pointWorld.z - anchorWorld.z,
      },
      target: {
        body: bodyId,
        anchor: [anchorWorld.x, anchorWorld.y, anchorWorld.z],
      },
    };
    backend.apply?.(payload);
    store.update((draft) => {
      if (!draft.runtime) draft.runtime = {};
      if (!draft.runtime.perturb) {
        draft.runtime.perturb = { mode: 'idle', active: false };
      }
      draft.runtime.perturb.mode = mode;
      draft.runtime.perturb.active = true;
      draft.runtime.lastAction = action;
    });
  }

  function onPointerDown(event) {
    if (!event) return;
    if (event.button === 2) {
      lastRightDownTime = Date.now();
      lastRightDownCtrl = !!event.ctrlKey;
    }
  }

  function onPointerUp(event) {
    if (!event) return;
    if (event.button === 2) {
      const dt = Date.now() - lastRightDownTime;
      if (dt < 260 && lastRightDownCtrl && hasSelection()) {
        clearSelection({ toast: true });
        return;
      }
    }
  }

  function onClick(event) {
    if (!event) return;
    if (event.button !== 0) return;
    const pick = resolvePick(event);
    if (pick === STATIC_PICK_BLOCK) {
      showToast('Selection blocked (static geom)');
      return;
    }
    selectionFromPick(pick, event);
  }

  function onDoubleClick(event) {
    if (!event) return;
    const pick = resolvePick(event);
    if (pick === STATIC_PICK_BLOCK) {
      showToast('Selection blocked (static geom)');
      return;
    }
    const result = selectionFromPick(pick, event);
    if (!result || !result.geomIndex) return;
    updateAnchorFromSelection();
  }

  function onPointerMove(event) {
    if (!dragState.active || dragState.pointerId !== event.pointerId) return;
    const pick = resolvePick(event);
    if (!pick || pick.blocked) return;
    const point = pick.worldPoint;
    dragState.lastX = event.clientX;
    dragState.lastY = event.clientY;
    const mode = dragState.mode;
    updatePerturb(point, mode);
  }

  function onPointerDragStart(event) {
    if (!event) return;
    if (!hasSelection()) return;
    dragState.active = true;
    dragState.pointerId = event.pointerId ?? null;
    dragState.mode = resolveDragMode(event);
    dragState.lastX = event.clientX;
    dragState.lastY = event.clientY;
    dragState.shiftKey = !!event.shiftKey;
    updateAnchorFromSelection();
    if (dragState.pointerId != null && canvas?.setPointerCapture) {
      try { canvas.setPointerCapture(dragState.pointerId); } catch {}
    }
  }

  function onPointerDragEnd(event) {
    if (!dragState.active) return;
    dragState.active = false;
    if (dragState.pointerId != null && canvas?.releasePointerCapture) {
      try { canvas.releasePointerCapture(dragState.pointerId); } catch {}
    }
    dragState.pointerId = null;
    store.update((draft) => {
      if (draft.runtime?.perturb) {
        draft.runtime.perturb.active = false;
        draft.runtime.perturb.mode = 'idle';
      }
    });
  }

  function install() {
    const onPointerDownEvt = (event) => {
      if (event.button === 0) {
        onPointerDragStart(event);
      }
      onPointerDown(event);
    };
    const onPointerUpEvt = (event) => {
      if (dragState.active) {
        onPointerDragEnd(event);
      }
      onPointerUp(event);
    };
    canvas.addEventListener('pointerdown', onPointerDownEvt);
    canvas.addEventListener('pointerup', onPointerUpEvt);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('click', onClick);
    canvas.addEventListener('dblclick', onDoubleClick);
    cleanup.push(() => {
      canvas.removeEventListener('pointerdown', onPointerDownEvt);
      canvas.removeEventListener('pointerup', onPointerUpEvt);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('click', onClick);
      canvas.removeEventListener('dblclick', onDoubleClick);
    });
  }

  function dispose() {
    while (cleanup.length) {
      const fn = cleanup.pop();
      try { fn(); } catch {}
    }
  }

  return {
    install,
    setup: install,
    dispose,
    updateSelection,
    clearSelection,
    hasSelection,
    applySelectionFromPick,
    selectionFromPick,
    selectionSeq,
    PERTURB_LABEL,
  };
}

perfMarkOnce('play:main:start', {
  href: (typeof window !== 'undefined' && window.location?.href) ? window.location.href : null,
});

const CAMERA_PRESETS = ['Free', 'Tracking'];
const MJ_GEOM = {
  PLANE: 0,
  HFIELD: 1,
  SPHERE: 2,
  CAPSULE: 3,
  ELLIPSOID: 4,
  CYLINDER: 5,
  BOX: 6,
  MESH: 7,
};

const leftPanel = document.querySelector('[data-testid="panel-left"]');
const rightPanel = document.querySelector('[data-testid="panel-right"]');
const canvas = document.querySelector('[data-testid="viewer-canvas"]');
const overlayRealtime = document.querySelector('[data-testid="overlay-realtime"]');
const overlayHelp = document.querySelector('[data-testid="overlay-help"]');
const overlayInfo = document.querySelector('[data-testid="overlay-info"]');
const overlayProfiler = document.querySelector('[data-testid="overlay-profiler"]');
const overlaySensor = document.querySelector('[data-testid="overlay-sensor"]');
const toastEl = document.querySelector('[data-testid="toast"]');
const simTimeEl = document.querySelector('[data-testid="sim-time"]');
let viewerStoreRef = null;

let latestSnapshot = null;
let renderStats = { drawn: 0, hidden: 0 };
let fpsEstimate = 0;
let lastFpsFrameSample = 0;
let lastFpsSampleTimeMs = (typeof performance !== 'undefined' && performance.now)
  ? performance.now()
  : Date.now();


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
const panelStateCache = {
  left: null,
  right: null,
  fullscreen: null,
};
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
  bounds: null,
  snapshotLogState: null,
  frameId: null,
};
    if (typeof window !== 'undefined') {
  window.__renderCtx = renderCtx;
}



const {
  fallbackModeParam,
  presetParam: fallbackPresetParam,
  debugMode,
  hideAllGeometryDefault,
  dumpToken,
  findToken,
  bigN,
  skyOverride,
  requestedMode,
  requestedModel,
  skyDebugModeParam,
} = consumeViewerParams();

const dumpBigParam = dumpToken === 'big' || findToken === 'big';
const skyOffParam = skyOverride === true;
// Play UI runs on worker backend only; ignore direct/auto requests for now.
const backendMode = 'worker';
const backend = await createBackend({ mode: backendMode, debug: debugMode, model: requestedModel });
const store = createViewerStore({});
viewerStoreRef = store;
if (typeof window !== 'undefined') {
  window.__viewerStore = store;
}

const fallbackEnabledDefault = fallbackModeParam !== 'off';

const fallbackPresetKey = FALLBACK_PRESET_ALIASES[fallbackPresetParam] || 'bright-outdoor';
const { applyFallbackAppearance, ensureEnvIfNeeded } = createEnvironmentManager({
  THREE_NS: THREE,
  store,
  skyOffParam,
  fallbackEnabledDefault,
  skyDebugModeParam,
});

const rendererManager = createRendererManager({
  canvas,
  renderCtx,
  applyFallbackAppearance,
  ensureEnvIfNeeded,
  hideAllGeometryDefault,
  fallbackEnabledDefault,
  fallbackPresetKey,
  fallbackModeParam,
  debugMode,
  setRenderStats: (stats) => {
    renderStats = { ...renderStats, ...stats };
    const frame = Number(stats?.frame);
    const now = (typeof performance !== 'undefined' && performance.now)
      ? performance.now()
      : Date.now();
    if (Number.isFinite(frame) && frame > lastFpsFrameSample) {
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
  },
});
rendererManager.setup();

const controlManager = createControlManager({
  store,
  backend,
  applySpecAction,
  readControlValue,
  leftPanel,
  rightPanel,
  cameraPresets: CAMERA_PRESETS,
});
const { loadUiSpec, renderPanels, updateControls, toggleControl, cycleCamera, registerGlobalShortcut } = controlManager;
const initialInfo = typeof backend?.getInitialModelInfo === 'function'
  ? backend.getInitialModelInfo()
  : null;
if (initialInfo && (initialInfo.label || initialInfo.file)) {
  const label = initialInfo.label || initialInfo.file || '';
  store.update((draft) => {
    if (!draft.hud) draft.hud = {};
    draft.hud.modelLabel = label;
  });
}

function updateOverlay(card, visible) {
  if (!card) return;
  card.classList.toggle('visible', !!visible);
}

function updateSimTime(state) {
  if (!simTimeEl) return;
  const displayTime = typeof state?.hud?.time === 'number' ? state.hud.time : 0;
  simTimeEl.textContent = `t = ${displayTime.toFixed(3)}`;
}

function updateRealtimeOverlay(state) {
  if (!overlayRealtime) return;
  const sim = state?.simulation || {};
  const hud = state?.hud || {};
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
  const misaligned = run && offset > 0.1 * desired;
  const shouldShow = (desired !== 100) || misaligned;
  const formatPercentSpeed = (val) => {
    const v = Number(val) || 0;
    const abs = Math.abs(v);
    if (!Number.isFinite(abs) || abs <= 0) return '0%';
    return `${Math.round(abs)}%`;
  };
  const formatPercentPhysics = (val) => {
    const v = Number(val) || 0;
    const abs = Math.abs(v);
    if (!Number.isFinite(abs) || abs <= 0) return '0.0%';
    return `${abs.toFixed(1)}%`;
  };
  const desiredEl = overlayRealtime.querySelector('[data-testid="overlay-realtime-desired"]') || overlayRealtime;
  const actualEl = overlayRealtime.querySelector('[data-testid="overlay-realtime-actual"]');
  if (shouldShow) {
    if (desiredEl) desiredEl.textContent = `Speed : ${formatPercentSpeed(desired)}`;
    if (actualEl) actualEl.textContent = `Physics: ${formatPercentPhysics(actual)}`;
    overlayRealtime.classList.add('visible');
  } else {
    overlayRealtime.classList.remove('visible');
  }
}

const TOAST_HIDE_MS = 2200;

function updateToast(state) {
  if (!toastEl) return;
  const toast = state.toast;
  const message = toast?.message;
  if (message) {
    const id = toast.ts ?? toast.message;
    if (updateToast._currentId !== id) {
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
        if (viewerStoreRef && typeof viewerStoreRef.update === 'function') {
          viewerStoreRef.update((draft) => {
            const currentId = draft.toast ? (draft.toast.ts ?? draft.toast.message) : null;
            if (currentId === id) {
              draft.toast = null;
            }
          });
        }
      }, TOAST_HIDE_MS + 50);
    }
  } else {
    toastEl.classList.remove('visible');
    toastEl.textContent = '';
    updateToast._currentId = null;
  }
}


function updateInfoOverlayCard(state) {
  if (!overlayInfo) return;
  let grid = overlayInfo.querySelector('.info-grid');
  if (!grid) {
    overlayInfo.innerHTML = '';
    grid = document.createElement('div');
    grid.className = 'info-grid';
    const addRow = (key, label) => {
      const labelEl = document.createElement('div');
      labelEl.className = 'info-label';
      labelEl.textContent = label;
      const valueEl = document.createElement('div');
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
  const info = state?.hud?.info || null;
  const getFieldEl = (key) => grid.querySelector(`.info-value[data-info-field="${key}"]`);
  const modelLabel = state?.hud?.modelLabel || '';
  const simRun = !!state?.simulation?.run;
  const time = Number(state?.hud?.time) || 0;
  const fpsState = Number(state?.hud?.fps);
  const fps = Number.isFinite(fpsEstimate) && fpsEstimate > 0
    ? fpsEstimate
    : (Number.isFinite(fpsState) ? fpsState : 0);
  const nefc = Number(info?.nefc) || 0;
  const ncon = Number(info?.ncon) || Number(state?.hud?.contacts) || 0;
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
  const sizeEl = getFieldEl('size');
  if (sizeEl) sizeEl.textContent = nefc ? `${nefc}  (${ncon} con)` : `${ncon} con`;
  const cpuEl = getFieldEl('cpu');
  if (cpuEl) cpuEl.textContent = cpuMs != null ? `${cpuMs.toFixed(3)} ms` : 'n/a';
  const solverEl = getFieldEl('solver');
  if (solverEl) {
    if (Number.isFinite(solverErr)) {
      solverEl.textContent = `${solverErr.toFixed(2)}  (${solverIter | 0} it)`;
    } else if (solverIter > 0) {
      solverEl.textContent = `${solverIter | 0} it`;
    } else {
      solverEl.textContent = 'n/a';
    }
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
      const label = formatArenaBytes(narena);
      memEl.textContent = `${pct.toFixed(1)}% of ${label}`;
    } else if (maxCon > 0 || maxEfc > 0) {
      memEl.textContent = `con/efc ${maxCon}/${maxEfc}`;
    } else {
      memEl.textContent = 'n/a';
    }
  }
  const fwdinvEl = getFieldEl('fwdinv');
  if (fwdinvEl) {
    const enableFlags = state?.model?.opt?.enableflags;
    const enabled = typeof enableFlags === 'number' && !!(enableFlags & (1 << 2));
    if (enabled && solverFwdinv && solverFwdinv.length >= 2) {
      const f0 = Number(solverFwdinv[0]);
      const f1 = Number(solverFwdinv[1]);
      if (Number.isFinite(f0) && Number.isFinite(f1)) {
        fwdinvEl.textContent = `${f0.toFixed(1)}  ${f1.toFixed(1)}`;
      } else {
        fwdinvEl.textContent = 'n/a';
      }
    } else {
      fwdinvEl.textContent = 'n/a';
    }
  }
  const energyEl = getFieldEl('energy');
  if (energyEl) {
    energyEl.textContent = Number.isFinite(energy) ? energy.toFixed(3) : 'n/a';
  }
  const islandsEl = getFieldEl('islands');
  if (islandsEl) {
    islandsEl.textContent = nisland > 0 ? String(nisland | 0) : '0';
  }
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

  // Compute layout class (areas-based, mutually exclusive)
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
  for (const cls of layouts) document.body.classList.remove(cls);
  document.body.classList.add(layoutClass);

  // Keep fullscreen flag for other visual toggles
  document.body.classList.toggle('fullscreen', fullscreen);

  panelStateCache.left = leftVisible;
  panelStateCache.right = rightVisible;
  panelStateCache.fullscreen = fullscreen;
  if (changed && typeof resizeCanvas === 'function') {
    resizeCanvas();
  }
}

function applySnapshot(snapshot) {
  latestSnapshot = snapshot;
  const perfEnabled = isPerfEnabled();
  const t0 = perfEnabled ? perfNow() : 0;
  let mergeMs = null;
  store.update((draft) => {
    if (perfEnabled) {
      const tMergeStart = perfNow();
      mergeBackendSnapshot(draft, snapshot);
      mergeMs = perfNow() - tMergeStart;
    } else {
      mergeBackendSnapshot(draft, snapshot);
    }
  });
  if (perfEnabled) {
    perfSample('main:store_update_ms', perfNow() - t0, {
      frameId: Number.isFinite(snapshot?.frameId) ? (snapshot.frameId | 0) : null,
      ngeom: typeof snapshot?.ngeom === 'number' ? (snapshot.ngeom | 0) : null,
      hasSceneSoA: (snapshot?.scn_ngeom | 0) > 0,
    });
    if (typeof mergeMs === 'number' && Number.isFinite(mergeMs)) {
      perfSample('main:mergeBackendSnapshot_ms', mergeMs, {
        frameId: Number.isFinite(snapshot?.frameId) ? (snapshot.frameId | 0) : null,
        ngeom: typeof snapshot?.ngeom === 'number' ? (snapshot.ngeom | 0) : null,
        hasSceneSoA: (snapshot?.scn_ngeom | 0) > 0,
      });
    }
    perfMarkOnce('play:main:first_store_update_end');
  }
  if (typeof window !== 'undefined') {
    window.__lastSnapshot = snapshot;
  }
  scheduleRenderScene();
}

function nameForObjType(objType) {
  const t = objType | 0;
  if (t === 5) return 'GEOM';
  if (t === 6) return 'SITE';
  if (t === 18) return 'TENDON';
  if (t === 9) return 'FLEX';
  if (t === 11) return 'SKIN';
  if (t === 1) return 'BODY';
  return String(t);
}

function summarizeGeomOrder(snapshot, order) {
  const n = snapshot?.scn_ngeom | 0;
  const objType = snapshot?.scn_objtype || null;
  const transparent = snapshot?.scn_transparent || null;
  if (!objType || objType.length < n) throw new Error('Missing scn_objtype');
  if (!transparent || transparent.length < n) throw new Error('Missing scn_transparent');
  const counts = Object.create(null);
  let transparentCount = 0;
  for (let i = 0; i < n; i += 1) {
    const t = objType[i] | 0;
    const key = nameForObjType(t);
    counts[key] = (counts[key] || 0) + 1;
    if ((transparent[i] | 0) !== 0) transparentCount += 1;
  }
  const runs = [];
  let lastType = null;
  let lastName = null;
  let runLen = 0;
  const nn = Math.min(n, order?.length | 0);
  for (let k = 0; k < nn; k += 1) {
    const si = order[k] | 0;
    const t = objType[si] | 0;
    const name = nameForObjType(t);
    if (lastType === null) {
      lastType = t;
      lastName = name;
      runLen = 1;
      continue;
    }
    if (t === lastType) {
      runLen += 1;
      continue;
    }
    runs.push({ type: lastType, name: lastName, len: runLen });
    lastType = t;
    lastName = name;
    runLen = 1;
  }
  if (lastType !== null) runs.push({ type: lastType, name: lastName, len: runLen });
  return {
    scn_ngeom: n,
    transparentCount,
    opaqueCount: n - transparentCount,
    objTypeCounts: counts,
    runs,
    transitions: Math.max(0, runs.length - 1),
  };
}

function summarizeTransparentFlags(view, n) {
  const out = { present: false, n: 0, nonZero: 0, uniqueFirst32: null, min: null, max: null };
  if (!view || !(n > 0) || view.length < n) return out;
  out.present = true;
  out.n = n | 0;
  let nonZero = 0;
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  const uniq = new Set();
  const take = Math.min(32, n);
  for (let i = 0; i < n; i += 1) {
    const v = view[i] | 0;
    if (v !== 0) nonZero += 1;
    if (v < min) min = v;
    if (v > max) max = v;
    if (i < take) uniq.add(v);
  }
  out.nonZero = nonZero;
  out.min = Number.isFinite(min) ? min : null;
  out.max = Number.isFinite(max) ? max : null;
  out.uniqueFirst32 = uniq.size;
  return out;
}

function summarizeGeomOrderList(snapshot, order, { prefixLen } = {}) {
  const n = snapshot?.scn_ngeom | 0;
  if (!(n > 0)) throw new Error('No scene geoms (scn_ngeom <= 0)');
  if (!order || order.length < n) throw new Error('Missing scn_geomorder');
  const objType = snapshot?.scn_objtype || null;
  const transparent = snapshot?.scn_transparent || null;
  if (!objType || objType.length < n) throw new Error('Missing scn_objtype');

  const take = Math.max(0, Math.min(n, Number(prefixLen) | 0 || 0));
  const seen = new Uint8Array(n);
  let outOfRange = 0;
  let duplicate = 0;
  let transparentMismatch = 0;
  const counts = Object.create(null);

  for (let k = 0; k < take; k += 1) {
    const i = order[k] | 0;
    if (i < 0 || i >= n) {
      outOfRange += 1;
      continue;
    }
    if (seen[i]) {
      duplicate += 1;
      continue;
    }
    seen[i] = 1;
    const key = nameForObjType(objType[i] | 0);
    counts[key] = (counts[key] || 0) + 1;
    if (transparent && transparent.length >= n && (transparent[i] | 0) === 0) {
      transparentMismatch += 1;
    }
  }

  return {
    prefixLen: take,
    outOfRange,
    duplicate,
    transparentMismatch: (transparent && transparent.length >= n) ? transparentMismatch : null,
    objTypeCounts: counts,
  };
}

if (typeof window !== 'undefined') {
  window.__PLAY_DUMP_GEOMORDER = (options = {}) => {
    const snapshot = options.snapshot || window.__lastSnapshot || null;
    if (!snapshot) throw new Error('No snapshot available');
    const n = snapshot?.scn_ngeom | 0;
    if (!(n > 0)) throw new Error('No scene geoms (scn_ngeom <= 0)');
    const wasmOrder = snapshot?.scn_geomorder || null;
    const transparentView = snapshot?.scn_transparent || null;
    const transparentSummary = summarizeTransparentFlags(transparentView, n);
    const nt = transparentSummary.present ? (transparentSummary.nonZero | 0) : null;
    const prefixLen = (typeof nt === 'number' && nt >= 0) ? nt : 0;
    const orderPrefixSummary = wasmOrder ? summarizeGeomOrderList(snapshot, wasmOrder, { prefixLen }) : null;
    const prefixRuns = (wasmOrder && prefixLen > 0) ? summarizeGeomOrder(snapshot, wasmOrder.subarray(0, prefixLen)) : null;
    const payload = {
      scn_ngeom: n,
      geomorder: {
        present: !!wasmOrder,
        len: wasmOrder?.length ?? 0,
      },
      transparent: transparentSummary,
      expected: {
        transparentCount: nt,
        geomorderPrefixLen: prefixLen,
      },
      orderPrefixSummary,
      orderPrefixRuns: prefixRuns,
    };
    if (options.log !== false) {
      // eslint-disable-next-line no-console
      logDebug('[PLAY] geomorder dump', payload);
    }
    return payload;
  };
}

let pendingRenderFrame = false;
let renderSceneDirty = false;
function scheduleRenderScene() {
  renderSceneDirty = true;
  if (pendingRenderFrame) return;
  if (typeof window === 'undefined' || typeof window.requestAnimationFrame !== 'function') return;
  pendingRenderFrame = true;
  window.requestAnimationFrame(() => {
    pendingRenderFrame = false;
    if (!renderSceneDirty) return;
    renderSceneDirty = false;
    if (!latestSnapshot) return;
    const perfEnabled = isPerfEnabled();
    const tRenderStart = perfEnabled ? perfNow() : 0;
    rendererManager.renderScene(latestSnapshot, store.get());
    if (perfEnabled) {
      perfSample('main:raf_renderScene_ms', perfNow() - tRenderStart, {
        frameId: Number.isFinite(latestSnapshot?.frameId) ? (latestSnapshot.frameId | 0) : null,
        ngeom: typeof latestSnapshot?.ngeom === 'number' ? (latestSnapshot.ngeom | 0) : null,
        scn_ngeom: (latestSnapshot?.scn_ngeom | 0) > 0 ? (latestSnapshot.scn_ngeom | 0) : null,
      });
      perfMarkOnce('play:main:first_raf_renderScene_end');
    }
  });
}

const initialSnapshot = await backend.snapshot();
applySnapshot(initialSnapshot);
backend.subscribe((snapshot) => {
  applySnapshot(snapshot);
});

let lastLayoutKey = null;
let lastFontIndex = null;
let pendingUiFrame = false;
let pendingUiState = null;
let lastUiUpdateMs = 0;
const UI_UPDATE_INTERVAL_MS = 120;

function scheduleUiUpdate(state) {
  pendingUiState = state;
  if (pendingUiFrame) return;
  pendingUiFrame = true;
  const tick = () => {
    pendingUiFrame = false;
    const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    if ((now - lastUiUpdateMs) < UI_UPDATE_INTERVAL_MS) {
      pendingUiFrame = true;
      setTimeout(() => {
        if (typeof window !== 'undefined' && window.requestAnimationFrame) {
          window.requestAnimationFrame(tick);
        } else {
          tick();
        }
      }, UI_UPDATE_INTERVAL_MS);
      return;
    }
    lastUiUpdateMs = now;
    const snapshot = pendingUiState || state;
    updateControls(snapshot);
    updateInfoOverlayCard(snapshot);
    updateToast(snapshot);
    updateSimTime(snapshot);
  };
  if (typeof window !== 'undefined' && window.requestAnimationFrame) {
    window.requestAnimationFrame(tick);
  } else {
    tick();
  }
}

store.subscribe((state) => {
  const perfEnabled = isPerfEnabled();
  const tSubStart = perfEnabled ? perfNow() : 0;
  scheduleRenderScene();
  updateOverlay(overlayHelp, state.overlays.help);
  updateOverlay(overlayInfo, state.overlays.info);
  updateOverlay(overlayProfiler, state.overlays.profiler);
  updateOverlay(overlaySensor, state.overlays.sensor);
  updateRealtimeOverlay(state);
  updatePanels(state);

  const leftVisible = !!state.panels?.left;
  const rightVisible = !!state.panels?.right;
  const fullscreen = !!state.overlays?.fullscreen;
  const layoutKey = `${leftVisible ? '1' : '0'}${rightVisible ? '1' : '0'}${fullscreen ? '1' : '0'}`;
  const fontIndex = Number.isFinite(state.theme?.font) ? (state.theme.font | 0) : null;
  if (layoutKey !== lastLayoutKey || fontIndex !== lastFontIndex) {
    lastLayoutKey = layoutKey;
    lastFontIndex = fontIndex;
    queueResizeCanvas();
  }
  scheduleUiUpdate(state);
  // Dynamic: build actuator sliders when metadata arrives
  const acts = latestSnapshot && Array.isArray(latestSnapshot.actuators)
    ? latestSnapshot.actuators
    : null;
  if (acts && acts.length > 0 && typeof controlManager.ensureActuatorSliders === 'function') {
    // Prefer freshest ctrl values from the latest backend snapshot; fallback to state
    const ctrlValues = (latestSnapshot && latestSnapshot.ctrl != null)
      ? latestSnapshot.ctrl
      : (state.model && state.model.ctrl != null ? state.model.ctrl : []);
    controlManager.ensureActuatorSliders(acts, ctrlValues);
  }
  const tDofsStart = perfEnabled ? perfNow() : 0;
  const dofs = deriveJointDofs(latestSnapshot, state);
  if (perfEnabled) {
    perfSample('main:subscriber_deriveJointDofs_ms', perfNow() - tDofsStart, {
      ngeom: typeof latestSnapshot?.ngeom === 'number' ? (latestSnapshot.ngeom | 0) : null,
      hasDofs: Array.isArray(dofs) ? dofs.length : null,
    });
  }
  if (typeof controlManager.ensureJointSliders === 'function') {
    controlManager.ensureJointSliders(dofs);
  }
  const eqs = deriveEqualityList(latestSnapshot);
  if (typeof controlManager.ensureEqualityToggles === 'function') {
    controlManager.ensureEqualityToggles(eqs);
  }
  if (perfEnabled) {
    perfSample('main:store_subscriber_ms', perfNow() - tSubStart, {
      ngeom: typeof latestSnapshot?.ngeom === 'number' ? (latestSnapshot.ngeom | 0) : null,
      scn_ngeom: (latestSnapshot?.scn_ngeom | 0) > 0 ? (latestSnapshot.scn_ngeom | 0) : null,
    });
  }
});

scheduleRenderScene();


const cameraController = createCameraController({
  THREE_NS: THREE,
  canvas,
  store,
  backend,
  onGesture: (payload) => applyGesture(store, backend, payload),
  renderCtx,
  debugMode,
  globalUp: new THREE.Vector3(0, 0, 1),
});
cameraController.setup();

const pickingController = createPickingController({
  THREE_NS: THREE,
  canvas,
  store,
  backend,
  renderCtx,
  debugMode,
  getSnapshot: () => latestSnapshot,
});
pickingController.setup();

function deriveJointDofs(snapshot, state) {
  if (!snapshot) return [];
  const jtype = snapshot.jtype instanceof Int32Array
    ? snapshot.jtype
    : (Array.isArray(snapshot.jtype) ? Int32Array.from(snapshot.jtype) : null);
  const jqpos = snapshot.jnt_qposadr instanceof Int32Array
    ? snapshot.jnt_qposadr
    : (Array.isArray(snapshot.jnt_qposadr) ? Int32Array.from(snapshot.jnt_qposadr) : null);
  const jrange = snapshot.jnt_range instanceof Float64Array
    ? snapshot.jnt_range
    : (Array.isArray(snapshot.jnt_range) ? Float64Array.from(snapshot.jnt_range) : null);
  const names = Array.isArray(snapshot.jnt_names) ? snapshot.jnt_names : [];
  const qpos = snapshot.qpos instanceof Float64Array
    ? snapshot.qpos
    : (Array.isArray(snapshot.qpos) ? Float64Array.from(snapshot.qpos) : null);
  const nq = snapshot.nq | 0;
  const out = [];
  const nj = jtype?.length || 0;
  const groupState = state?.rendering?.groups?.joint;
  const jointGroupEnabled = Array.isArray(groupState) ? groupState.some(Boolean) : true;
  if (!jointGroupEnabled) return out;
  for (let i = 0; i < nj; i += 1) {
    const type = jtype[i] | 0;
    if (type !== 2 && type !== 3) continue; // slide / hinge
    const qposIndex = jqpos && i < jqpos.length ? jqpos[i] : -1;
    if (qposIndex < 0 || qposIndex >= nq) continue;
    const r0 = jrange && jrange.length >= 2 * (i + 1) ? jrange[2 * i] : null;
    const r1 = jrange && jrange.length >= 2 * (i + 1) ? jrange[2 * i + 1] : null;
    const min = Number.isFinite(r0) ? r0 : (type === 3 ? -Math.PI : -1);
    const max = Number.isFinite(r1) ? r1 : (type === 3 ? Math.PI : 1);
    const value = qpos && qpos.length > qposIndex ? qpos[qposIndex] : 0;
    const label = names[i] ? String(names[i]) : `Joint ${i}`;
    out.push({ index: qposIndex, jointIndex: i, min, max, value, label });
  }
  return out;
}

function deriveEqualityList(snapshot) {
  if (!snapshot) return [];
  const eqActive = snapshot.eq_active instanceof Uint8Array
    ? snapshot.eq_active
    : (Array.isArray(snapshot.eq_active) ? Uint8Array.from(snapshot.eq_active) : null);
  if (!eqActive || !eqActive.length) return [];
  const eqType = snapshot.eq_type instanceof Int32Array
    ? snapshot.eq_type
    : (Array.isArray(snapshot.eq_type) ? Int32Array.from(snapshot.eq_type) : null);
  const eqObj1 = snapshot.eq_obj1id instanceof Int32Array
    ? snapshot.eq_obj1id
    : (Array.isArray(snapshot.eq_obj1id) ? Int32Array.from(snapshot.eq_obj1id) : null);
  const eqObj2 = snapshot.eq_obj2id instanceof Int32Array
    ? snapshot.eq_obj2id
    : (Array.isArray(snapshot.eq_obj2id) ? Int32Array.from(snapshot.eq_obj2id) : null);
  const eqObjType = snapshot.eq_objtype instanceof Int32Array
    ? snapshot.eq_objtype
    : (Array.isArray(snapshot.eq_objtype) ? Int32Array.from(snapshot.eq_objtype) : null);
  const eqNames = Array.isArray(snapshot.eq_names) ? snapshot.eq_names : null;
  const jointNames = Array.isArray(snapshot.jnt_names) ? snapshot.jnt_names : [];
  const n = eqActive.length | 0;
  const out = [];
  const typeLabels = ['connect', 'weld', 'joint', 'tendon', 'flex', 'contact'];
  for (let i = 0; i < n; i += 1) {
    const active = !!eqActive[i];
    const t = eqType && i < eqType.length ? (eqType[i] | 0) : -1;
    const typeName = t >= 0 && t < typeLabels.length ? typeLabels[t] : null;
    const objStride = eqObj1 && eqObj1.length >= 2 * n ? 2 : 1;
    const objTypeStride = eqObjType && eqObjType.length >= 2 * n ? 2 : 1;
    const obj1Id = eqObj1 ? eqObj1[(objStride * i) | 0] : -1;
    const obj2Id = eqObj2 ? eqObj2[(objStride * i) | 0] : -1;
    const objType1 = eqObjType ? eqObjType[(objTypeStride * i) | 0] : -1;
    const objType2 = eqObjType ? eqObjType[(objTypeStride * i) + 1] ?? objType1 : objType1;
    const nameFromEq = eqNames && eqNames[i] ? String(eqNames[i]) : null;
    const name1 = objType1 === 3 && obj1Id >= 0 && obj1Id < jointNames.length
      ? String(jointNames[obj1Id] ?? '')
      : null;
    const name2 = objType2 === 3 && obj2Id >= 0 && obj2Id < jointNames.length
      ? String(jointNames[obj2Id] ?? '')
      : null;
    let label = nameFromEq || `Eq ${i}`;
    let fullLabel = label;
    if (!nameFromEq) {
      if (name1 && name2 && name1 !== name2) {
        label = typeName ? `[${typeName}] ${name1} \u2194 ${name2}` : `${name1} \u2194 ${name2}`;
      } else if (name1) {
        label = typeName ? `[${typeName}] ${name1}` : name1;
      } else if (typeName) {
        label = `[${typeName}] Eq ${i}`;
      } else {
        label = `Eq ${i}`;
      }
      fullLabel = label;
    } else {
      fullLabel = nameFromEq;
      label = nameFromEq;
    }
    out.push({ index: i, active, label, fullLabel, typeName, objType1, objType2, obj1Id, obj2Id });
  }
  return out;
}

const spec = await loadUiSpec();
renderPanels(spec);
updateControls(store.get());

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
    store.update((draft) => {
      if (event?.shiftKey) {
        draft.panels.right = !draft.panels.right;
      } else {
        draft.panels.left = !draft.panels.left;
      }
    });
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
    const state = store.get();
    const selection = state?.runtime?.selection;
    const parents = state?.model?.bodyParentId;
    if (!selection || !parents) return;
    const bodyArr = ArrayBuffer.isView(parents) ? parents : null;
    if (!bodyArr || typeof bodyArr.length !== 'number') return;
    let bodyId = Number(selection.body) | 0;
    if (!(bodyId >= 0) && Number.isInteger(selection.geom) && selection.geom >= 0) {
      const geomBody = state?.model?.geomBodyId;
      if (ArrayBuffer.isView(geomBody) && selection.geom < geomBody.length) {
        bodyId = geomBody[selection.geom] | 0;
      }
    }
    if (!(bodyId > 0) || bodyId >= bodyArr.length) return;
    let parentId = -1;
    try {
      parentId = bodyArr[bodyId] ?? -1;
    } catch {
      parentId = -1;
    }
    if (!(parentId >= 0) || parentId === bodyId) return;
    const geomBodyIds = state?.model?.geomBodyId;
    const ngeom = ArrayBuffer.isView(geomBodyIds) ? geomBodyIds.length : 0;
    let nextGeom = -1;
    if (ArrayBuffer.isView(geomBodyIds)) {
      const currentGeom = Number(selection.geom) | 0;
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
    const bxpos = latestSnapshot?.bxpos;
    const hasBxpos = ArrayBuffer.isView(bxpos) && typeof latestSnapshot?.nbody === 'number';
    const nbody = hasBxpos ? (latestSnapshot.nbody | 0) : 0;
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
    if (nextGeom >= 0 && Array.isArray(state?.model?.geoms)) {
      const geoms = state.model.geoms;
      const found = geoms.find((g) => (g?.index | 0) === (nextGeom | 0));
      label = typeof found?.name === 'string' && found.name.trim().length > 0
        ? found.name.trim()
        : `Geom ${nextGeom}`;
    } else {
      label = `Body ${parentId}`;
    }
    const ts = Date.now();
    store.update((draft) => {
      if (!draft.runtime) draft.runtime = { ...(draft.runtime || {}) };
      const prevSel = draft.runtime.selection || {};
      const prevSeq = Number(prevSel.seq) || 0;
      const localPoint = Array.isArray(prevSel.localPoint) && prevSel.localPoint.length >= 3
        ? [
            Number(prevSel.localPoint[0]) || 0,
            Number(prevSel.localPoint[1]) || 0,
            Number(prevSel.localPoint[2]) || 0,
          ]
        : [0, 0, 0];
      const normal = Array.isArray(prevSel.normal) && prevSel.normal.length >= 3
        ? [
            Number(prevSel.normal[0]) || 0,
            Number(prevSel.normal[1]) || 0,
            Number(prevSel.normal[2]) || 1,
          ]
        : [0, 0, 1];
      draft.runtime.selection = {
        geom: nextGeom,
        body: parentId,
        joint: -1,
        name: label,
        kind: 'geom',
        point,
        localPoint,
        normal,
        seq: prevSeq + 1,
        timestamp: ts,
      };
      draft.runtime.lastAction = 'select-parent';
      draft.toast = { message: `Selected parent: ${label}`, ts };
    });
  });

  const adjustRealtime = async (delta) => {
    const state = store.get();
    const total = REALTIME_LEVELS.length;
    if (!total) return;
    const currentIdxRaw = Number.isFinite(state?.simulation?.realTimeIndex)
      ? (state.simulation.realTimeIndex | 0)
      : DEFAULT_REALTIME_INDEX;
    const currentIdx = Math.max(0, Math.min(total - 1, currentIdxRaw));
    let nextIdx = currentIdx + delta;
    if (nextIdx < 0) nextIdx = 0;
    if (nextIdx >= total) nextIdx = total - 1;
    if (nextIdx === currentIdx) return;
    const desired = REALTIME_LEVELS[nextIdx] || 100;
    const nextRate = desired / 100;
    store.update((draft) => {
      if (!draft.simulation) draft.simulation = { ...DEFAULT_VIEWER_STATE.simulation };
      draft.simulation.realTimeIndex = nextIdx;
    });
    try {
      if (typeof backend.setRate === 'function') {
        await backend.setRate(nextRate, 'ui');
      }
    } catch (err) {
      logWarn('[ui] setRate failed', err);
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
      getStats: () => ({ ...renderStats }),
      getContext: () => (rendererManager.getContext ? rendererManager.getContext() : (renderCtx.initialized ? renderCtx : null)),
      ensureLoop: () => rendererManager.ensureRenderLoop(),
      renderScene: (snapshot, state) => rendererManager.renderScene(snapshot, state),
    };
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


/**
 * Camera controller for orbit/pan/zoom with pointer gestures.
 *
 * Options:
 * - minDistance: fixed minimum distance (takes precedence over getMinDistance).
 * - getMinDistance(camera, target, ctx): dynamic minimum distance when minDistance is not provided.
 * - zoomK: wheel delta scale (default 0.35), maxWheelStep clamps magnitude pre-scaling.
 * - invertY: inverts vertical component for orbit/rotate and translate.
 * - keyRoot: element to receive key events (falls back to canvas).
 * - assertUp: when true, verify camera.up matches initial up and realign if it drifts.
 * - wheelLineFactor / wheelPageFactor: DOM_DELTA normalization constants.
 * - minOrthoZoom / maxOrthoZoom: zoom clamps for orthographic cameras.
 *
 */