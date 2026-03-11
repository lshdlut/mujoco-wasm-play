import { logWarn, strictCatch, strictEnsure } from '../core/viewer_runtime.mjs';
import { toNumber } from '../core/viewer_shared.mjs';
import { resolveFontPresetValue } from '../core/runtime_config.mjs';
 import {
  getSnapshotCameraMode,
  getSnapshotCameras,
  getSnapshotGeoms,
  getSnapshotHistory,
  getSnapshotHud,
  getSnapshotKeyframes,
  getSnapshotOptionSupport,
  getSnapshotSimulation,
  getSnapshotWatchSources,
} from '../core/snapshot_selectors.mjs';
import { clamp01 } from './state.mjs';
import { parseVector, toBoolean } from './bindings.mjs';

const CAMERA_FALLBACK_PRESETS = ['Free', 'Tracking'];
const OPTION_BINDING_PREFIX = 'mjOption::';

export function createControlWidgetsRuntime({
  store,
  applyControlSpecAction,
  readControlValue,
  getSnapshot = null,
  createBinding,
  registerControl,
  guardBinding,
  rightPanel = null,
  cameraPresets = [],
}) {
  const currentSnapshot = () => (typeof getSnapshot === 'function' ? getSnapshot() : null);

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
    const preset = resolveFontPresetValue(value, 2);
    root.style.setProperty('--viewer-font-scale', String(preset.scale));
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

  function isOptionBinding(control) {
    return typeof control?.binding === 'string' && control.binding.startsWith(OPTION_BINDING_PREFIX);
  }

  function applyOptionAvailability(control, element) {
    if (!element || !isOptionBinding(control)) return;
    const support = getSnapshotOptionSupport(currentSnapshot());
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

  function attachOptionAvailability(control, element, binding) {
    if (!element || !binding) return;
    applyOptionAvailability(control, element);
    appendUpdateOptions(binding, () => {
      applyOptionAvailability(control, element);
    });
  }

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

  const dynamicRangeResolvers = {
    'simulation.history_scrubber': () => {
      const hist = getSnapshotHistory(currentSnapshot());
      const count = Math.max(1, hist?.count ?? hist?.capacity ?? 1);
      return { min: 1 - count, max: 0, step: 1, absolute: true };
    },
    'simulation.key_slider': () => {
      const keyframes = getSnapshotKeyframes(currentSnapshot());
      const capacity = Math.max(1, keyframes?.capacity ?? 16);
      return { min: 0, max: Math.max(0, capacity - 1), step: 1, absolute: true };
    },
  };

  function resetDynamicContainerState(container) {
    if (!container || typeof container !== 'object') return;
    delete container.__playSliderCache;
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

  function createFullRow(options = {}) {
    const row = createControlRow(null, { ...options, full: true });
    const field = document.createElement('div');
    field.className = 'control-field';
    row.append(field);
    return { row, field };
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

  function resolveCameraModeEntries() {
    const baseList =
      Array.isArray(cameraPresets) && cameraPresets.length >= CAMERA_FALLBACK_PRESETS.length
        ? cameraPresets
        : CAMERA_FALLBACK_PRESETS;
    const entries = baseList.map((label, idx) => ({
      value: String(idx),
      label: label || `Camera ${idx}`,
    }));
    const modelCameras = getSnapshotCameras(currentSnapshot());
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
      const geoms = getSnapshotGeoms(currentSnapshot());
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
    } catch (err) {
      strictCatch(err, 'main:tracking_geom_entries');
    }
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
    if (rightPanel.classList.contains('is-hidden')) return;
    const section = rightPanel.querySelector(`[data-section-id="${sectionId}"]`);
    if (!section) return;
    if (section.classList.contains('is-collapsed')) return;
    const body = section.querySelector('.section-body');
    if (!body) return;
    let container = body.querySelector(`[data-dynamic="${dynamicKey}"]`);
    if (!container) {
      container = document.createElement('div');
      container.setAttribute('data-dynamic', dynamicKey);
      if (className) container.className = className;
      if (marginTop !== null) container.style.marginTop = marginTop;
      body.appendChild(container);
      strictEnsure('ensureDynamicList', {
        reason: 'create_container',
        sectionId,
        dynamicKey,
      });
    }
    if (items.length === 0) {
      resetDynamicContainerState(container);
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
    resetDynamicContainerState(container);
    container.innerHTML = '';
    items.forEach((item, index) => {
      buildItem(container, item, index);
    });
    container.setAttribute('data-count', String(items.length));
    strictEnsure('ensureDynamicList', {
      reason: 'rebuild',
      sectionId,
      dynamicKey,
      prevCount,
      count: items.length,
    });
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
        let cached = containerEl.__playSliderCache;
        const wantAttr = String(dataAttr || '');
        if (!cached || cached.dataAttr !== wantAttr || !(cached.map instanceof Map)) {
          cached = { dataAttr: wantAttr, map: new Map() };
          containerEl.__playSliderCache = cached;
        }
        const sliderByIndex = cached.map;
        const needsRescan = sliderByIndex.size !== containerEl.childElementCount
          || Array.from(sliderByIndex.values()).some((node) => !(node instanceof HTMLElement) || !containerEl.contains(node));
        if (needsRescan) {
          sliderByIndex.clear();
          const nodes = containerEl.querySelectorAll(`input[type="range"][${wantAttr}]`);
          for (const node of nodes) {
            const key = node.getAttribute(wantAttr);
            if (!key) continue;
            sliderByIndex.set(key, node);
          }
        }
        for (let fallback = 0; fallback < entries.length; fallback += 1) {
          const item = entries[fallback];
          const index = getIndex(item, fallback);
          const slider = sliderByIndex.get(String(index));
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
          const active = toBoolean(value);
          current = active;
          input.checked = !!active;
          input.setAttribute('aria-checked', active ? 'true' : 'false');
          label.classList.toggle('is-active', !!active);
        },
    });

    const commitToggle = guardBinding(binding, async (nextValue) => {
      const active = !!nextValue;
      binding.setValue(active);
      await applyControlSpecAction(control, active);
      // UX hint: if enabling Contact Point but there are no contacts yet, show a brief tip
      try {
        if (active && control?.binding === 'mjvOption::flags[14]') {
          const hud = getSnapshotHud(currentSnapshot());
          const n = Number(hud.contacts ?? 0);
          if (!(n > 0)) {
            store.update((draft) => {
              draft.toast = { message: 'No contacts right now', ts: Date.now() };
            });
          }
        }
      } catch (err) {
        strictCatch(err, 'main:checkbox_contact_toast');
      }
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
      const active = toBoolean(running);
      button.textContent = active ? 'Run' : 'Pause';
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
    };

    const binding = createBinding(control, {
      getValue: () => {
        const current = readControlValue(store.get(), currentSnapshot(), control);
        return toBoolean(current);
      },
      applyValue: (value) => {
        const active = toBoolean(value);
        sync(active);
      },
    });

    sync(binding.getValue());

    button.addEventListener(
      'click',
      guardBinding(binding, async () => {
        const next = !binding.getValue();
        await applyControlSpecAction(control, next);
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
      await applyControlSpecAction(control, {
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
    const labels = options.length > 0 ? options : ['50 %', '75 %', '100 %', '150 %', '200 %'];
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
      defaultOptions: ['50 %', '75 %', '100 %', '150 %', '200 %'],
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
          const snapshot = currentSnapshot();
          const isTracking = (getSnapshotCameraMode(snapshot) | 0) === 1;
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
          await applyControlSpecAction(control, value);
        }),
      );

      // Initialise from store state rather than DOM defaults.
      // This avoids special selects (notably font scaling) briefly applying the first option.
      const initialValue = readControlValue(store.get(), currentSnapshot(), control);
      binding.setValue?.(initialValue);
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
    const rawOptions = normaliseOptions(control.options);
    const entries = rawOptions.map((opt) => {
      const token = String(opt ?? '').trim();
      const lower = token.toLowerCase();
      let key = 'model';
      let label = token || 'Model';
      if (lower.startsWith('preset')) {
        if (lower.includes('moon')) {
          key = 'preset-moon';
          label = 'Preset🌙️';
        } else {
          key = 'preset-sun';
          label = 'Preset☀️';
        }
      } else if (lower.startsWith('model')) {
        key = 'model';
        label = 'Model';
      }
      return { key, label, value: token || label };
    });
    const fallbackEntry = entries[0] || { key: 'model', label: 'Model', value: 'Model' };
    const entriesByKey = new Map(entries.map((entry) => [entry.key, entry]));

    const { inputs } = createSegmentedGroup(container, control, {
      layout: 'stacked',
      options: entries.length ? entries : [fallbackEntry],
    });

    let logicalValue = fallbackEntry.value;
    const resolveKey = (value) => {
      const token = String(value ?? '').toLowerCase();
      if (token.startsWith('model')) return 'model';
      if (token.includes('moon')) return 'preset-moon';
      if (token.startsWith('preset')) return 'preset-sun';
      return fallbackEntry.key;
    };

    attachSegmentedHandlers(control, inputs, {
      getValue: () => logicalValue,
      applyValue: (value) => {
        const key = resolveKey(value);
        const entry = entriesByKey.get(key) || fallbackEntry;
        logicalValue = entry.value;
        inputs.forEach((input) => {
          input.checked = (input.dataset.key || '') === key;
        });
      },
      onCommit: async (binding, input) => {
        const modeValue = input.value || fallbackEntry.value;
        binding.setValue(modeValue);
        try {
          await applyControlSpecAction(control, modeValue);
        } catch (err) {
          logWarn('[ui] visual source toggle failed', err);
          strictCatch(err, 'main:ui_visual_source_toggle');
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
        await applyControlSpecAction(control, input.value);
      },
    });
  }

  function renderSlider(container, control) {
    const baseRange = parseRange(control);
    const { row, label, field } = createLabeledRow(control);
    field.classList.add('slider-field');
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
        } catch (err) {
          strictCatch(err, 'main:dynamic_range_resolver');
        }
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
        await applyControlSpecAction(control, realValue);
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
    const current = readControlValue(store.get(), currentSnapshot(), control);
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
      await applyControlSpecAction(control, raw);
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
        const parsed = parseVector(value, targetLength);
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

    const currentVector = readControlValue(store.get(), currentSnapshot(), control);
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
      const parsed = parseVector(input.value, targetLength);
      if (parsed) {
        lastValidText = formatVector(parsed);
        setInputText(lastValidText);
        await applyControlSpecAction(control, parsed);
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

    const syncOptions = () => {
      const sources = getSnapshotWatchSources(currentSnapshot());
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

    binding.updateOptions = () => syncOptions();
    syncOptions(store.get());

    const commit = guardBinding(binding, async () => {
      const token = input.value.trim();
      await applyControlSpecAction(control, token);
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
    const syncOptions = () => {
      const keyframes = getSnapshotKeyframes(currentSnapshot());
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
      getValue: () => getSnapshotSimulation(currentSnapshot()).keyIndex,
      applyValue: (value) => {
        const token = String(Number.isFinite(value) ? value : -1);
        const hasValue = Array.from(select.options).some((opt) => opt.value === token);
        select.value = hasValue ? token : (select.options[0]?.value ?? '-1');
      },
    });

    binding.updateOptions = () => syncOptions();
    syncOptions(store.get());

    select.addEventListener(
      'change',
      guardBinding(binding, async () => {
        const nextIndex = Number(select.value);
        await applyControlSpecAction(control, Number.isFinite(nextIndex) ? nextIndex : 0);
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
  
  function renderWidget(container, control) {
    const type = typeof control.type === 'string' ? control.type.toLowerCase() : 'static';
    const override = CONTROL_OVERRIDES[control?.item_id ?? ''];
    if (override) return override(container, control);
    const renderer = CONTROL_RENDERERS[type] || renderStatic;
    return renderer(container, control);
  }

  function resolveListIndex(item, fallback) {
    const idx = Number(item?.index);
    return Number.isFinite(idx) ? idx : fallback;
  }

  function ensureActuatorSliders(actuators, ctrlValues = []) {
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
          const raw = Array.isArray(ctrlValues) && Number.isFinite(Number(ctrlValues[index])) ? Number(ctrlValues[index]) : (ctrlValues?.[index] ?? null);
          if (raw == null) return null;
          const numeric = Number(raw);
          return Number.isFinite(numeric) ? numeric : null;
        },
        onInput: async ({ index, value }) => {
          try {
            await applyControlSpecAction({ item_id: 'control.actuator' }, { index, value });
          } catch (err) {
            logWarn('[ui] set actuator failed', err);
            strictCatch(err, 'main:ui_set_actuator');
          }
        },
      });
    } catch (err) {
      logWarn('[ui] ensureActuatorSliders error', err);
      strictCatch(err, 'main:ui_ensure_actuator_sliders');
    }
  }

  function ensureJointSliders(dofs = []) {
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
          step: Number.isFinite(item.step) && item.step > 0 ? item.step : Math.max((item.max - item.min) / 500, 0.0001),
        }),
        getValue: (item) => (Number.isFinite(item.value) ? item.value : 0),
        updateRange: true,
        onInput: async ({ index, value, range }) => {
          try {
            await applyControlSpecAction({ item_id: 'joint.slider' }, { index, value, min: range.min, max: range.max });
          } catch (err) {
            logWarn('[ui] set joint qpos failed', err);
            strictCatch(err, 'main:ui_set_joint_qpos');
          }
        },
      });
    } catch (err) {
      logWarn('[ui] ensureJointSliders error', err);
      strictCatch(err, 'main:ui_ensure_joint_sliders');
    }
  }

  function ensureEqualityToggles(eqs = []) {
    try {
      ensureDynamicList({
        sectionId: 'equality',
        dynamicKey: 'equality',
        items: eqs,
        className: 'equality-toggle-container',
        updateExisting: (container, entries) => {
          for (const eq of entries) {
            const checkbox = container.querySelector(`input[type="checkbox"][data-eq-index="${eq.index}"]`);
            if (!checkbox) continue;
            const active = !!eq.active;
            checkbox.checked = active;
            checkbox.setAttribute('aria-checked', active ? 'true' : 'false');
            const labelEl = checkbox.closest('label.bool-button');
            if (labelEl) labelEl.classList.toggle('is-active', active);
            const text = checkbox.nextElementSibling;
            if (text && text.classList.contains('bool-text')) text.textContent = eq.label || `Equality ${eq.index}`;
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
              await applyControlSpecAction({ item_id: 'equality.toggle' }, { index: eq.index, active: next });
            } catch (err) {
              logWarn('[ui] equality toggle failed', err);
              strictCatch(err, 'main:ui_equality_toggle');
            }
          });
        },
      });
    } catch (err) {
      logWarn('[ui] ensureEqualityToggles error', err);
      strictCatch(err, 'main:ui_ensure_equality_toggles');
    }
  }

  return {
    renderWidget,
    renderSimulationNoiseNotice,
    ensureActuatorSliders,
    ensureJointSliders,
    ensureEqualityToggles,
  };
}
