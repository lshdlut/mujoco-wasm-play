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

function clamp01(x) {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  return x;
}

function parseRange(control) {
  const { range, min, max, step } = control || {};
  const out = {
    min: 0,
    max: 1,
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

    const binding = createBinding(control, {
      getValue: () => input.checked,
      applyValue: (value) => {
        const active = coerceBoolean(value);
        input.checked = active;
        input.setAttribute('aria-checked', active ? 'true' : 'false');
        label.classList.toggle('is-active', active);
      },
    });

    input.addEventListener(
      'change',
      guardBinding(binding, async () => {
        const next = !binding.getValue();
        await applySpecAction(store, backend, control, next);
      }),
    );

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
    const options = normaliseOptions(control.options);
    options.forEach((opt) => {
      const option = document.createElement('option');
      option.value = opt;
      option.textContent = opt;
      select.appendChild(option);
    });
    field.append(select);
    container.append(row);

    const binding = createBinding(control, {
      getValue: () => select.value,
      applyValue: (value) => {
        if (typeof value === 'string') {
          select.value = value;
        } else if (typeof value === 'number' && Number.isFinite(value)) {
          const idx = Math.max(0, Math.min(options.length - 1, Math.round(value)));
          select.value = options[idx];
        }
      },
    });

    select.addEventListener(
      'change',
      guardBinding(binding, async () => {
        const value = select.value;
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
    const range = parseRange(control);
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

    const binding = createBinding(control, {
      getValue: () => denormaliseFromRange(Number(input.value), range),
      applyValue: (value) => {
        const numeric = Number(value ?? range.min);
        const limited = Number.isFinite(numeric) ? Math.min(range.max, Math.max(range.min, numeric)) : range.min;
        const t = normaliseToRange(limited, range);
        input.value = String(t);
        valueLabel.textContent = formatNumber(limited);
      },
    });

    input.addEventListener(
      'input',
      guardBinding(binding, async () => {
        const t = Number(input.value);
        const realValue = denormaliseFromRange(t, range);
        valueLabel.textContent = formatNumber(realValue);
        await applySpecAction(store, backend, control, realValue);
      }),
    );
    valueLabel.textContent = formatNumber(denormaliseFromRange(Number(input.value), range));
  }

  function renderEditInput(container, control, mode = 'text') {
    const range = mode === 'text' ? null : parseRange(control);
    const { row, label, field } = createLabeledRow(control);
    const inputId = `${sanitiseName(control.item_id)}__edit`;
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
        } else {
          const numeric = Number(value);
          if (Number.isFinite(numeric)) {
            const clamped = Math.min(range.max, Math.max(range.min, numeric));
            input.value = String(clamped);
          } else {
            input.value = '';
          }
        }
      },
    });

    if (control.default !== undefined) {
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
        input.value = String(raw);
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
    const { row, label, field } = createLabeledRow(control);
    const inputId = `${sanitiseName(control.item_id)}__vector`;
    label.setAttribute('for', inputId);
    const input = document.createElement('input');
    input.type = 'text';
    input.id = inputId;
    input.setAttribute('data-testid', control.item_id);
    input.autocomplete = 'off';
    input.spellcheck = false;
    field.append(input);
    container.append(row);

    const targetLength = Math.max(1, expectedLength | 0);

    const binding = createBinding(control, {
      getValue: () => input.value,
      applyValue: (value) => {
        if (value === undefined || value === null) return;
        let text = '';
        if (Array.isArray(value)) {
          text = value.map(formatNumber).join(' ');
        } else if (typeof value === 'string') {
          text = value.trim();
        } else if (value != null && typeof value === 'object') {
          try {
            text = Array.from(value).map(formatNumber).join(' ');
          } catch {
            text = '';
          }
        }
        input.value = text;
        if (text) {
          input.classList.remove('is-invalid');
        }
      },
    });

    if (control.default !== undefined) {
      if (typeof control.default === 'string') {
        input.placeholder = control.default;
      } else if (Array.isArray(control.default)) {
        binding.setValue(control.default);
      }
    }

    const commit = guardBinding(binding, async () => {
      const tokens = input.value.trim().split(/\s+/).filter(Boolean);
      const numbers = tokens.map((token) => Number(token));
      const isValid =
        tokens.length === targetLength && numbers.every((num) => Number.isFinite(num));
      if (isValid) {
        const formatted = numbers.map(formatNumber).join(' ');
        binding.setValue(formatted);
        input.classList.remove('is-invalid');
        await applySpecAction(store, backend, control, formatted);
        return;
      }
      input.classList.add('is-invalid');
      if (input._invalidTimer) {
        clearTimeout(input._invalidTimer);
      }
      input._invalidTimer = setTimeout(() => {
        input.classList.remove('is-invalid');
      }, 900);
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
    const row = createControlRow(control, { full: true });
    row.classList.add('control-static');
    row.textContent = control.label ?? control.name ?? '';
    row.setAttribute('data-testid', control.item_id);
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
    edit_vec3: (container, control) => renderVectorInput(container, control, 3),
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
    for (const item of section.items ?? []) {
      renderControl(body, item);
      if (!item?.item_id) continue;
      const resetValue = resolveResetValue(item);
      if (resetValue !== undefined) {
        resetTargets.push({ id: item.item_id, value: resetValue });
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
      if (binding.isEditing) continue;
      const control = controlById.get(id);
      if (!control) continue;
      const value = readControlValue(state, control);
      try {
        if (binding.getValue && binding.getValue() === value) continue;
      } catch {}
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
    const total = cameraPresets.length || 1;
    const next = (current + delta + total) % total;
    await applySpecAction(store, backend, control, next);
  }

  function installShortcuts() {
    if (shortcutsInstalled) return;
    const root = shortcutRoot || leftPanel?.ownerDocument?.body || rightPanel?.ownerDocument?.body;
    if (!root || typeof root.addEventListener !== 'function') return;
    const handler = (event) => {
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
              if (slider.dataset.editing === '1') continue;
              const fromCtrl = Array.isArray(ctrlValues) && Number.isFinite(Number(ctrlValues[i]))
                ? Number(ctrlValues[i])
                : null;
              const v = fromCtrl != null ? fromCtrl : Number(actuators[i].value) || 0;
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
            : null;
          input.value = String(fromCtrl != null ? fromCtrl : Number(a.value) || 0);
          input.setAttribute('data-act-index', String(a.index));
          input.setAttribute('data-testid', `control.act.${a.index}`);
          field.appendChild(input);
          row.append(label, field);
          container.appendChild(row);
          input.addEventListener('focus', () => {
            input.dataset.editing = '1';
          });
          input.addEventListener('blur', () => {
            input.dataset.editing = '0';
          });
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
    dispose,
  };
}
