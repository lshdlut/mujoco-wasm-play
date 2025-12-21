import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  OPTION_LAYOUT,
  STAT_FIELD_DESCRIPTORS,
  VISUAL_FIELD_DESCRIPTORS,
} from '../viewer_structs.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..');

const specPath = path.join(repoRoot, 'dev', 'spec', 'ui_spec.json');
const bindingIndexPath = path.join(repoRoot, 'dev', 'spec', 'ui_bindings_index.json');

const spec = JSON.parse(await readFile(specPath, 'utf8'));

function sanitiseName(name) {
  return (
    String(name ?? '')
      .replace(/\s+/g, '_')
      .replace(/[^A-Za-z0-9._-]/g, '')
      .replace(/_+/g, '_')
      .replace(/^_+|_+$/g, '') || 'item'
  );
}

function expandSection(section) {
  const items = [];
  const sectionId = section.section_id ?? '';
  const sectionTitle = section.title ?? sectionId;

  for (const item of section.items ?? []) {
    items.push({
      ...item,
      section_id: sectionId,
      section_title: sectionTitle,
      group_id: null,
      group_type: null,
    });
  }

  function appendGroupedEntries(group) {
    if (!group) return;
    const groupType = typeof group.type === 'string' ? group.type : null;
    const groupTypeToken = groupType ? groupType.toLowerCase() : '';
    const fallbackType = groupTypeToken.includes('radio')
      ? 'radio'
      : groupTypeToken.includes('select')
      ? 'select'
      : groupTypeToken.includes('slider')
      ? 'slider'
      : 'checkbox';
    for (const entry of group.entries ?? []) {
      const name = entry.name ?? entry.label ?? entry.binding ?? 'entry';
      const itemIdBase = group.group_id ? String(group.group_id) : `${sectionId}`;
      const itemId = `${itemIdBase}.${sanitiseName(name)}`;
      items.push({
        item_id: itemId,
        type: entry.type ?? fallbackType,
        label: entry.name ?? entry.label ?? name,
        binding: entry.binding ?? null,
        name,
        options: entry.options,
        default: entry.default,
        shortcut: entry.shortcut ?? null,
        section_id: sectionId,
        section_title: sectionTitle,
        group_id: group.group_id ?? null,
        group_type: groupType,
      });
    }
  }

  for (const group of section.dynamic_groups ?? []) {
    appendGroupedEntries(group);
  }

  for (const item of section.post_groups ?? []) {
    items.push({
      ...item,
      section_id: sectionId,
      section_title: sectionTitle,
      group_id: null,
      group_type: null,
    });
  }

  for (const group of section.trail_groups ?? []) {
    appendGroupedEntries(group);
  }

  return items;
}

function collectControls(specJson) {
  const controls = [];
  for (const section of specJson.left_panel ?? []) {
    controls.push(...expandSection(section));
  }
  for (const section of specJson.right_panel ?? []) {
    controls.push(...expandSection(section));
  }
  return controls;
}

function buildDescriptorMap(descriptors) {
  const map = new Map();
  for (const descriptor of descriptors) {
    const key = Array.isArray(descriptor.path) ? descriptor.path.join('.') : '';
    if (key) map.set(key, descriptor);
  }
  return map;
}

const visualDescriptorMap = buildDescriptorMap(VISUAL_FIELD_DESCRIPTORS);
const statDescriptorMap = buildDescriptorMap(STAT_FIELD_DESCRIPTORS);

function splitBinding(binding) {
  const raw = typeof binding === 'string' ? binding.trim() : '';
  if (!raw) return null;
  const [scope, rest] = raw.split('::');
  if (!scope || !rest) return null;
  const path = rest.split('.');
  return { scope, path };
}

function inferMetaFromControl(control) {
  const type = control?.type || '';
  switch (type) {
    case 'checkbox':
      return { kind: 'bool', size: 1 };
    case 'radio':
    case 'select':
      return { kind: 'enum', size: 1 };
    case 'slider':
      return { kind: 'float', size: 1 };
    case 'slider_int':
      return { kind: 'int', size: 1 };
    case 'edit_int':
      return { kind: 'int', size: 1 };
    case 'edit_float':
      return { kind: 'float', size: 1 };
    case 'edit_vec2':
      return { kind: 'float_vec', size: 2 };
    case 'edit_vec3':
    case 'edit_vec3_string':
      return { kind: 'float_vec', size: 3 };
    case 'edit_vec4':
    case 'edit_rgba':
      return { kind: 'float_vec', size: 4 };
    case 'edit_vec5':
      return { kind: 'float_vec', size: 5 };
    case 'edit_text':
      return { kind: 'string', size: 1 };
    case 'static':
      return { kind: 'static', size: 0 };
    default:
      return null;
  }
}

function resolveBindingMeta(binding, control) {
  if (binding === 'UpdateWatch') {
    return { kind: 'static', size: 0 };
  }
  if (binding.startsWith('Simulate::disable[')
    || binding.startsWith('Simulate::enable[')
    || binding.startsWith('Simulate::enableactuator[')) {
    return { kind: 'bool', size: 1 };
  }
  const parts = splitBinding(binding);
  const inferred = inferMetaFromControl(control);
  if (!parts) {
    return inferred || { kind: 'static', size: 0 };
  }
  const { scope, path } = parts;
  let base = null;
  if (scope === 'mjVisual') {
    base = visualDescriptorMap.get(path.join('.')) || null;
  } else if (scope === 'mjStatistic') {
    base = statDescriptorMap.get(path.join('.')) || null;
  } else if (scope === 'mjOption') {
    const info = OPTION_LAYOUT[path[0]];
    if (info) {
      const kind = info.type === 'f64' ? 'float' : 'int';
      base = { kind, size: Math.max(1, Number(info.count) || 1) };
      if (base.kind === 'float' && base.size > 1) {
        base.kind = 'float_vec';
      }
    }
  } else if (scope === 'mjvOption' && /^flags\[\d+\]$/.test(path[0] || '')) {
    base = { kind: 'bool', size: 1 };
  } else if (scope === 'mjvScene' && /^flags\[\d+\]$/.test(path[0] || '')) {
    base = { kind: 'bool', size: 1 };
  }

  if (base) {
    if (inferred && (base.kind === 'float' || base.kind === 'int')) {
      if (inferred.kind === 'enum' || inferred.kind === 'bool') return inferred;
      if (inferred.kind === 'float_vec') return inferred;
    }
    return { kind: base.kind, size: base.size };
  }

  return inferred || { kind: 'static', size: 0 };
}

function buildBindingIndex(controls) {
  const index = {};
  for (const control of controls) {
    const binding = typeof control.binding === 'string' ? control.binding.trim() : '';
    if (!binding) continue;
    const meta = resolveBindingMeta(binding, control);
    const value = { kind: meta.kind, size: meta.size };
    if (!index[binding]) {
      index[binding] = { value, occurrences: [] };
    } else {
      const current = index[binding].value;
      if (current.kind !== value.kind || current.size !== value.size) {
        throw new Error(`Binding meta mismatch for ${binding}: ${current.kind}/${current.size} vs ${value.kind}/${value.size}`);
      }
    }
    index[binding].occurrences.push({
      section_id: control.section_id ?? null,
      section_title: control.section_title ?? null,
      group_id: control.group_id ?? null,
      group_type: control.group_type ?? null,
      item_id: control.item_id ?? null,
      control_type: control.type ?? null,
      label: control.label ?? control.name ?? control.item_id ?? null,
      shortcut: control.shortcut ?? null,
    });
  }
  const sorted = {};
  const keys = Object.keys(index).sort((a, b) => a.localeCompare(b));
  for (const key of keys) {
    const entry = index[key];
    entry.occurrences.sort((a, b) => {
      const aId = a.item_id ?? '';
      const bId = b.item_id ?? '';
      return aId.localeCompare(bId);
    });
    sorted[key] = entry;
  }
  return sorted;
}

const controls = collectControls(spec);
const bindingIndex = buildBindingIndex(controls);
await writeFile(bindingIndexPath, `${JSON.stringify(bindingIndex, null, 2)}\n`, 'utf8');
console.log(`Wrote ${bindingIndexPath}`);
