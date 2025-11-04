#!/usr/bin/env node

/**
 * Generates a flattened index of all bindings declared in ui_spec.json.
 * The resulting file (`spec/ui_bindings_index.json`) provides metadata
 * that downstream tooling (viewer runtime, backend routers, tests, etc.)
 * can consume to reason about control payloads.
 */

import fs from 'fs';
import path from 'path';
import url from 'url';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const specPath = path.join(rootDir, 'spec', 'ui_spec.json');
const outPath = path.join(rootDir, 'spec', 'ui_bindings_index.json');

const specRaw = fs.readFileSync(specPath, 'utf8');
const spec = JSON.parse(specRaw);

const bindingMap = new Map();

const CONTROL_VALUE_SPEC = {
  checkbox: { kind: 'bool', size: 1 },
  button: { kind: 'command', size: 0 },
  select: { kind: 'enum', size: 1 },
  radio: { kind: 'enum', size: 1 },
  slider_float: { kind: 'float', size: 1 },
  slider_int: { kind: 'int', size: 1 },
  edit_float: { kind: 'float', size: 1 },
  edit_int: { kind: 'int', size: 1 },
  edit_vec2: { kind: 'float_vec', size: 2 },
  edit_vec3: { kind: 'float_vec', size: 3 },
  edit_vec4: { kind: 'float_vec', size: 4 },
  edit_vec5: { kind: 'float_vec', size: 5 },
  edit_rgba: { kind: 'float_vec', size: 4 },
  edit_text: { kind: 'string', size: 0 },
  static: { kind: 'static', size: 0 },
};

const GROUP_TYPE_DEFAULT_CONTROL = {
  checkbox_list: 'checkbox',
  radio_list: 'radio',
};

function mergeValueSpec(existing, incoming) {
  if (!incoming) return existing || null;
  if (!existing) return incoming;
  if (existing.kind === incoming.kind && existing.size === incoming.size) {
    return existing;
  }
  return {
    kind: 'mixed',
    size: null,
  };
}

function recordBinding(binding, info) {
  if (!binding) return;
  const entry = bindingMap.get(binding) || {
    binding,
    value: null,
    occurrences: [],
  };
  entry.value = mergeValueSpec(entry.value, info.value);
  entry.occurrences.push({
    section_id: info.section_id ?? null,
    section_title: info.section_title ?? null,
    group_id: info.group_id ?? null,
    group_type: info.group_type ?? null,
    item_id: info.item_id ?? null,
    control_type: info.control_type ?? null,
    label: info.label ?? null,
    shortcut: info.shortcut ?? null,
  });
  bindingMap.set(binding, entry);
}

function deriveValueSpec(binding, controlType) {
  if (controlType && CONTROL_VALUE_SPEC[controlType]) {
    return CONTROL_VALUE_SPEC[controlType];
  }
  if (/::flags\[\d+\]$/.test(binding) || /::enable(actuator)?\[\d+\]$/.test(binding) || /Simulate::disable\[\d+\]/.test(binding)) {
    return CONTROL_VALUE_SPEC.checkbox;
  }
  if (/::actuatorgroup\[\d+\]$/.test(binding) || /::geomgroup\[\d+\]$/.test(binding) || /::jointgroup\[\d+\]$/.test(binding) || /::sitegroup\[\d+\]$/.test(binding) || /::skingroup\[\d+\]$/.test(binding) || /::tendongroup\[\d+\]$/.test(binding) || /::flexgroup\[\d+\]$/.test(binding)) {
    return CONTROL_VALUE_SPEC.checkbox;
  }
  return null;
}

function traverse(node, context = {}) {
  if (!node) return;
  if (Array.isArray(node)) {
    for (const item of node) {
      traverse(item, context);
    }
    return;
  }
  if (typeof node !== 'object') return;

  let nextContext = { ...context };

  if (typeof node.section_id === 'string') {
    nextContext.section_id = node.section_id;
  }
  if (typeof node.title === 'string' && node.section_id) {
    nextContext.section_title = node.title;
  }
  if (typeof node.type === 'string' && !node.binding) {
    nextContext.parent_control_type = node.type;
    if (GROUP_TYPE_DEFAULT_CONTROL[node.type]) {
      nextContext.entry_control_type = GROUP_TYPE_DEFAULT_CONTROL[node.type];
    }
  }

  if (typeof node.group_id === 'string') {
    nextContext.group_id = node.group_id;
    nextContext.group_type = node.type || null;
  }

  if (typeof node.binding === 'string') {
    const controlType = node.type
      || nextContext.entry_control_type
      || node.control_type
      || nextContext.parent_control_type
      || null;
    const valueSpec = deriveValueSpec(node.binding, controlType);
    recordBinding(node.binding, {
      value: valueSpec,
      section_id: nextContext.section_id,
      section_title: nextContext.section_title,
      group_id: nextContext.group_id,
      group_type: nextContext.group_type,
      item_id: node.item_id ?? null,
      control_type: controlType,
      label: node.label ?? node.name ?? null,
      shortcut: node.shortcut ?? null,
    });
  }

  for (const [key, value] of Object.entries(node)) {
    if (key === 'binding') continue;
    if (value && typeof value === 'object') {
      traverse(value, nextContext);
    }
  }
}

traverse(spec.left_panel);
traverse(spec.right_panel);

const sorted = Array.from(bindingMap.entries())
  .sort((a, b) => a[0].localeCompare(b[0]))
  .reduce((acc, [binding, meta]) => {
    acc[binding] = {
      value: meta.value,
      occurrences: meta.occurrences,
    };
    return acc;
  }, {});

fs.writeFileSync(outPath, `${JSON.stringify(sorted, null, 2)}\n`, 'utf8');

console.log(`Generated ${Object.keys(sorted).length} bindings -> ${path.relative(rootDir, outPath)}`);
