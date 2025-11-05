export function createControlManager({
  store,
  backend,
  applySpecAction,
  readControlValue,
  leftPanel,
  rightPanel,
  cameraPresets = [],
}) {
  const controlById = new Map();
  const controlBindings = new Map();

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

  function registerControl(control, binding) {
    controlById.set(control.item_id, control);
    controlBindings.set(control.item_id, binding);
  }

  function createBinding(control, { getValue, applyValue }) {
    const binding = {
      skip: false,
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
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'bool-button';
    button.textContent = control.label ?? control.name ?? control.item_id;
    button.setAttribute('data-testid', control.item_id);
    button.setAttribute('aria-pressed', 'false');
    row.append(button);
    container.append(row);

    const binding = createBinding(control, {
      getValue: () => button.classList.contains('is-active'),
      applyValue: (value) => {
        const active = !!value;
        button.classList.toggle('is-active', active);
        button.setAttribute('aria-pressed', active ? 'true' : 'false');
      },
    });

    button.addEventListener(
      'click',
      guardBinding(binding, async () => {
        const next = !binding.getValue();
        await applySpecAction(store, backend, control, next);
      }),
    );
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
      const active = !!running;
      button.textContent = active ? 'Run' : 'Pause';
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
    };

    const binding = createBinding(control, {
      getValue: () => {
        const current = readControlValue(store.get(), control);
        return current === 'Run' || current === true || current === 1;
      },
      applyValue: (value) => {
        const active = value === 'Run' || value === true || value === 1;
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
    options.forEach((opt, idx) => {
      const option = document.createElement('option');
      option.value = String(idx);
      option.textContent = opt;
      select.appendChild(option);
    });
    field.append(select);
    container.append(row);

    const binding = createBinding(control, {
      getValue: () => Number(select.value),
      applyValue: (value) => {
        if (typeof value === 'number' && !Number.isNaN(value)) {
          select.value = String(value);
        }
      },
    });

    select.addEventListener(
      'change',
      guardBinding(binding, async () => {
        const value = Number(select.value);
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
    const { row, label, field } = createLabeledRow(control);
    const inputId = `${sanitiseName(control.item_id)}__slider`;
    label.setAttribute('for', inputId);
    const input = document.createElement('input');
    input.type = 'range';
    input.min = '0';
    input.max = '1';
    input.step = control.type === 'slider_int' ? '1' : '0.01';
    input.setAttribute('data-testid', control.item_id);
    input.id = inputId;

    const valueLabel = document.createElement('span');
    valueLabel.className = 'slider-value';

    field.append(input, valueLabel);
    container.append(row);

    const binding = createBinding(control, {
      getValue: () => Number(input.value),
      applyValue: (value) => {
        const numeric = Number(value ?? 0);
        input.value = Number.isFinite(numeric) ? String(numeric) : '0';
        valueLabel.textContent = Number(input.value).toFixed(3);
      },
    });

    input.addEventListener(
      'input',
      guardBinding(binding, async () => {
        valueLabel.textContent = Number(input.value).toFixed(3);
        await applySpecAction(store, backend, control, Number(input.value));
      }),
    );
    valueLabel.textContent = Number(input.value).toFixed(3);
  }

  function renderEditInput(container, control, mode = 'text') {
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
        if (mode === 'text') {
          input.value = value == null ? '' : String(value);
        } else {
          const numeric = Number(value);
          input.value = Number.isFinite(numeric) ? String(numeric) : '';
        }
      },
    });

    if (control.default !== undefined) {
      binding.setValue(control.default);
    }

    const commit = guardBinding(binding, async () => {
      let raw;
      if (mode === 'text') {
        raw = input.value;
      } else {
        const numeric = Number(input.value);
        raw = Number.isFinite(numeric) ? numeric : 0;
      }
      await applySpecAction(store, backend, control, raw);
    });

    input.addEventListener('change', commit);
    input.addEventListener('blur', commit);
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        commit();
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
    let lastValid = '';

    const binding = createBinding(control, {
      getValue: () => input.value.trim(),
      applyValue: (value) => {
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
          lastValid = text;
          input.classList.remove('is-invalid');
        }
      },
    });

    const commit = guardBinding(binding, async () => {
      const tokens = input.value.trim().split(/\s+/).filter(Boolean);
      const numbers = tokens.map((token) => Number(token));
      const isValid =
        tokens.length === targetLength && numbers.every((num) => Number.isFinite(num));
      if (isValid) {
        const formatted = numbers.map(formatNumber);
        const payload = formatted.join(' ');
        binding.setValue(payload);
        lastValid = payload;
        input.classList.remove('is-invalid');
        await applySpecAction(store, backend, control, payload);
        return;
      }
      input.classList.add('is-invalid');
      if (lastValid) {
        if (input._invalidTimer) {
          clearTimeout(input._invalidTimer);
        }
        input._invalidTimer = setTimeout(() => {
          binding.setValue(lastValid);
          input.classList.remove('is-invalid');
        }, 900);
      }
    });

    input.addEventListener('change', commit);
    input.addEventListener('blur', commit);
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        commit();
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
    edit_vec3: (container, control) => renderVectorInput(container, control, 3),
    edit_rgba: (container, control) => renderVectorInput(container, control, 4),
    static: renderStatic,
    separator: renderSeparator,
  };

  function renderControl(container, control) {
    if (control?.item_id === 'simulation.run') {
      return renderRunToggle(container, control);
    }
    const type = typeof control.type === 'string' ? control.type.toLowerCase() : 'static';
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

    toggle.addEventListener('click', () => {
      sectionEl.classList.toggle('is-collapsed');
    });
    header.addEventListener('click', (event) => {
      if (event.target === reset) return;
      if (event.target !== toggle) {
        sectionEl.classList.toggle('is-collapsed');
      }
    });

    sectionEl.append(header, body);

    for (const item of section.items ?? []) {
      renderControl(body, item);
    }
    container.append(sectionEl);
  }

  function renderPanels(spec) {
    if (!leftPanel || !rightPanel) return;
    console.log('[ui] render panels', spec.left.length, spec.right.length);
    leftPanel.innerHTML = '';
    rightPanel.innerHTML = '';
    for (const section of spec.left) {
      renderSection(leftPanel, section);
    }
    for (const section of spec.right) {
      renderSection(rightPanel, section);
    }
  }

  function updateControls(state) {
    for (const [id, binding] of controlBindings.entries()) {
      if (!binding || !binding.setValue) continue;
      const control = controlById.get(id);
      if (!control) continue;
      const value = readControlValue(state, control);
      binding.setValue?.(value);
    }
  }

  function bool(value) {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value !== 0;
    if (typeof value === 'string') {
      const v = value.toLowerCase();
      return v === '1' || v === 'true' || v === 'on';
    }
    return !!value;
  }

  async function toggleControl(id, overrideValue) {
    const control = controlById.get(id);
    if (!control) return;
    const current = readControlValue(store.get(), control);
    let next = overrideValue;

    if (next === undefined) {
      if (control.type === 'radio' && Array.isArray(control.options)) {
        const currentLabel = typeof current === 'string' ? current : '';
        const currentIndex = control.options.findIndex((opt) => opt === currentLabel);
        const nextIndex = currentIndex === 0 ? 1 : 0;
        next = control.options[nextIndex] ?? control.options[0];
      } else if (control.type === 'select') {
        const options = normaliseOptions(control.options);
        const currentIndex =
          typeof current === 'number' && Number.isFinite(current) ? current : 0;
        const nextIndex = (currentIndex + 1) % (options.length || 1);
        next = nextIndex;
      } else {
        next = !bool(current);
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
  };
}
