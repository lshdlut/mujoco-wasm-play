import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

const specPath = path.join(repoRoot, 'dev', 'spec', 'ui_spec.json');
const bindingIndexPath = path.join(repoRoot, 'dev', 'spec', 'ui_bindings_index.json');
const schemaPath = path.join(repoRoot, 'dev', 'spec', 'ui_spec.schema.json');
const structsPath = path.join(repoRoot, 'dev', 'viewer_structs.mjs');
const sharedPath = path.join(repoRoot, 'dev', 'viewer_shared.mjs');
const defaultsPath = path.join(repoRoot, 'dev', 'viewer_defaults.mjs');
const typesPath = path.join(repoRoot, 'dev', 'viewer_state_types.ts');

const spec = JSON.parse(await readFile(specPath, 'utf8'));
const runtime = spec.runtime || {};

function requireArray(name, value) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`Missing ${name} array in ui_spec.json`);
  }
  return value;
}

function requireNumber(name, value) {
  const num = Number(value);
  if (!Number.isFinite(num)) {
    throw new Error(`Missing ${name} number in ui_spec.json`);
  }
  return num;
}

const groupTypes = requireArray('runtime.group_types', runtime.group_types).map((v) => String(v));
const groupCount = requireNumber('runtime.group_count', runtime.group_count) | 0;
const sceneFlagDefaults = requireArray('runtime.scene_flag_defaults', runtime.scene_flag_defaults).map((v) => !!v);
const voptFlagDefaultIndices = requireArray('runtime.vopt_flag_default_indices', runtime.vopt_flag_default_indices)
  .map((v) => Number(v) | 0);
const realtimeLevels = requireArray('runtime.realtime_levels', runtime.realtime_levels)
  .map((v) => Number(v))
  .filter((v) => Number.isFinite(v));
const statisticExtraFields = Array.isArray(runtime.statistic_extra_fields)
  ? runtime.statistic_extra_fields
  : [];

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
  if ((scope === 'mjvOption' || scope === 'mjvScene') && /^flags\[\d+\]$/.test(path[0] || '')) {
    return { kind: 'bool', size: 1 };
  }
  if (scope === 'mjOption' || scope === 'mjVisual' || scope === 'mjStatistic') {
    return inferred || { kind: 'float', size: 1 };
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

function addDescriptor(map, path, meta) {
  const key = Array.isArray(path) ? path.join('.') : '';
  if (!key) return;
  if (map.has(key)) {
    const existing = map.get(key);
    if (existing.kind !== meta.kind || existing.size !== meta.size) {
      throw new Error(`Descriptor mismatch for ${key}: ${existing.kind}/${existing.size} vs ${meta.kind}/${meta.size}`);
    }
    return;
  }
  map.set(key, {
    path: Array.isArray(path) ? path.slice() : [],
    kind: meta.kind,
    size: meta.size,
  });
}

function collectDescriptors(controls, scope, extras) {
  const map = new Map();
  for (const control of controls) {
    const binding = typeof control.binding === 'string' ? control.binding.trim() : '';
    if (!binding) continue;
    const parts = splitBinding(binding);
    if (!parts || parts.scope !== scope) continue;
    const meta = resolveBindingMeta(binding, control);
    if (!meta || meta.kind === 'static') continue;
    addDescriptor(map, parts.path, meta);
  }
  for (const extra of extras ?? []) {
    if (!extra || !Array.isArray(extra.path)) continue;
    const meta = {
      kind: typeof extra.kind === 'string' ? extra.kind : 'float',
      size: Number(extra.size) || 1,
    };
    addDescriptor(map, extra.path, meta);
  }
  return Array.from(map.values()).sort((a, b) => {
    const aKey = Array.isArray(a.path) ? a.path.join('.') : '';
    const bKey = Array.isArray(b.path) ? b.path.join('.') : '';
    return aKey.localeCompare(bKey);
  });
}

function collectOptionFields(controls) {
  const fields = new Map();
  const defaultRegex = /mjOption::([A-Za-z0-9_]+)/g;
  for (const control of controls) {
    const binding = typeof control.binding === 'string' ? control.binding.trim() : '';
    if (binding) {
      const parts = splitBinding(binding);
      if (parts && parts.scope === 'mjOption' && parts.path.length) {
        const meta = resolveBindingMeta(binding, control);
        fields.set(parts.path[0], { kind: meta.kind, size: meta.size });
      }
    }
    const def = typeof control.default === 'string' ? control.default : '';
    if (def.includes('mjOption::')) {
      let match = null;
      while ((match = defaultRegex.exec(def)) !== null) {
        const field = match[1];
        if (!fields.has(field)) {
          fields.set(field, { kind: 'int', size: 1 });
        }
      }
    }
  }
  return fields;
}

function buildOptionLayout(optionFields) {
  const layout = {};
  const entries = Array.from(optionFields.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  for (const [field, meta] of entries) {
    const size = Math.max(1, Number(meta.size) || 1);
    const kind = meta.kind || 'float';
    const type = (kind === 'float' || kind === 'float_vec') ? 'f64' : 'i32';
    layout[field] = { type, count: size };
  }
  return layout;
}

function buildFieldPointers(optionLayout) {
  const pointers = {};
  const fields = Object.keys(optionLayout).sort((a, b) => a.localeCompare(b));
  for (const field of fields) {
    pointers[field] = `_mjwf_model_opt_${field}_ptr`;
  }
  return pointers;
}

const controls = collectControls(spec);
const bindingIndex = buildBindingIndex(controls);
const visualDescriptors = collectDescriptors(controls, 'mjVisual', []);
const statisticDescriptors = collectDescriptors(controls, 'mjStatistic', statisticExtraFields);
const optionFields = collectOptionFields(controls);
const optionLayout = buildOptionLayout(optionFields);
const fieldPointers = buildFieldPointers(optionLayout);

const schema = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  title: 'Simulate UI Specification',
  type: 'object',
  required: ['left_panel', 'right_panel'],
  properties: {
    source: { type: 'string' },
    runtime: { type: 'object' },
    left_panel: {
      type: 'array',
      items: { $ref: '#/definitions/section' },
    },
    right_panel: {
      type: 'array',
      items: { $ref: '#/definitions/section' },
    },
  },
  definitions: {
    section: {
      type: 'object',
      required: ['section_id', 'items'],
      properties: {
        section_id: { type: 'string', minLength: 1 },
        title: { type: 'string' },
        shortcut: {
          type: 'array',
          items: { type: 'string' },
        },
        default_open: { type: 'boolean' },
        items: {
          type: 'array',
          items: { $ref: '#/definitions/control' },
        },
        dynamic_groups: {
          type: 'array',
          items: { $ref: '#/definitions/dynamicGroup' },
        },
        post_groups: {
          type: 'array',
          items: { $ref: '#/definitions/control' },
        },
        trail_groups: {
          type: 'array',
          items: { $ref: '#/definitions/dynamicGroup' },
        },
      },
    },
    control: {
      type: 'object',
      required: ['item_id', 'type'],
      properties: {
        item_id: { type: 'string', minLength: 1 },
        type: { type: 'string', minLength: 1 },
        label: { type: 'string' },
        name: { type: 'string' },
        binding: {
          oneOf: [
            { type: 'string', minLength: 1 },
            { type: 'null' },
          ],
        },
        options: {
          oneOf: [
            { type: 'string' },
            {
              type: 'array',
              items: { type: 'string' },
            },
          ],
        },
      },
    },
    dynamicGroup: {
      type: 'object',
      required: ['group_id', 'entries'],
      properties: {
        group_id: { type: 'string', minLength: 1 },
        label: { type: 'string' },
        entries: {
          type: 'array',
          minItems: 1,
          items: {
            type: 'object',
            required: ['name', 'binding'],
            properties: {
              name: { type: 'string', minLength: 1 },
              binding: { type: 'string', minLength: 1 },
              type: { type: 'string' },
              options: {
                oneOf: [
                  { type: 'string' },
                  { type: 'array', items: { type: 'string' } },
                ],
              },
            },
          },
        },
      },
    },
  },
};

function renderViewerDefaults() {
  const lines = [
    '// Auto-generated by tools/generate_ui_artifacts.mjs. Do not edit by hand.',
    '',
    `const VOPT_FLAG_DEFAULT_INDICES = Object.freeze(${JSON.stringify(voptFlagDefaultIndices)});`,
    '',
    'function makeFlagArray(length, enabledIndices) {',
    '  const flags = Array.from({ length }, () => false);',
    '  for (const idx of enabledIndices) {',
    '    if (idx >= 0 && idx < flags.length) {',
    '      flags[idx] = true;',
    '    }',
    '  }',
    '  return flags;',
    '}',
    '',
    `export const MJ_GROUP_TYPES = Object.freeze(${JSON.stringify(groupTypes)});`,
    `export const MJ_GROUP_COUNT = ${groupCount};`,
    '',
    `export const SCENE_FLAG_DEFAULTS = Object.freeze(${JSON.stringify(sceneFlagDefaults)});`,
    '',
    'export const DEFAULT_VOPT_FLAGS = Object.freeze(makeFlagArray(32, VOPT_FLAG_DEFAULT_INDICES));',
    '',
    'export const SCENE_FLAG_DEFAULTS_NUMERIC = Object.freeze(',
    '  SCENE_FLAG_DEFAULTS.map((flag) => (flag ? 1 : 0)),',
    ');',
    'export const DEFAULT_VOPT_FLAGS_NUMERIC = Object.freeze(',
    '  DEFAULT_VOPT_FLAGS.map((flag) => (flag ? 1 : 0)),',
    ');',
    '',
    `export const REALTIME_LEVELS = Object.freeze(${JSON.stringify(realtimeLevels)});`,
    '',
    'export const DEFAULT_REALTIME_INDEX = Math.max(0, REALTIME_LEVELS.indexOf(100));',
    '',
  ];
  return `${lines.join('\n')}\n`;
}

function renderViewerShared() {
  return `// Auto-generated by tools/generate_ui_artifacts.mjs. Do not edit by hand.\n\nimport { MJ_GROUP_COUNT, MJ_GROUP_TYPES } from './viewer_defaults.mjs';\nimport { strictCatch } from './viewer_runtime.mjs';\n\nexport function toNumber(value) {\n  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;\n  const numeric = Number(value);\n  return Number.isFinite(numeric) ? numeric : 0;\n}\n\nexport function bool(value) {\n  if (typeof value === 'boolean') return value;\n  if (typeof value === 'number') return value !== 0;\n  if (typeof value === 'string') {\n    const v = value.trim().toLowerCase();\n    return v === '1' || v === 'true' || v === 'on';\n  }\n  return !!value;\n}\n\nexport function cloneStruct(value) {\n  if (!value) return null;\n  if (typeof structuredClone === 'function') {\n    try {\n      return structuredClone(value);\n    } catch (err) {\n      strictCatch(err, 'shared:clone_struct:structured_clone');\n    }\n  }\n  try {\n    return JSON.parse(JSON.stringify(value));\n  } catch (err) {\n    strictCatch(err, 'shared:clone_struct:json');\n    return null;\n  }\n}\n\nexport function resolveStructPath(target, pathSegments) {\n  if (!target || !Array.isArray(pathSegments)) return undefined;\n  let current = target;\n  for (const segment of pathSegments) {\n    if (current == null) return undefined;\n    const match = typeof segment === 'string' ? segment.match(/^(.*)\\[(\\d+)\\]$/) : null;\n    if (match) {\n      const base = match[1];\n      const index = Number(match[2]);\n      const container = current?.[base];\n      if (!Array.isArray(container)) return undefined;\n      current = container[index];\n      continue;\n    }\n    current = current?.[segment];\n  }\n  return current;\n}\n\nexport function assignStructPath(target, pathSegments, value) {\n  if (!target || !Array.isArray(pathSegments) || !pathSegments.length) return;\n  let cursor = target;\n  for (let i = 0; i < pathSegments.length; i += 1) {\n    const segment = pathSegments[i];\n    const match = typeof segment === 'string' ? segment.match(/^(.*)\\[(\\d+)\\]$/) : null;\n    const key = match ? match[1] : segment;\n    const hasIndex = !!match;\n    const index = hasIndex ? Number(match[2]) : -1;\n    if (i === pathSegments.length - 1) {\n      if (hasIndex) {\n        cursor[key] = Array.isArray(cursor[key]) ? cursor[key] : [];\n        cursor[key][index] = value;\n      } else {\n        cursor[key] = value;\n      }\n      return;\n    }\n    if (hasIndex) {\n      cursor[key] = Array.isArray(cursor[key]) ? cursor[key] : [];\n      cursor[key][index] = cursor[key][index] || {};\n      cursor = cursor[key][index];\n    } else {\n      cursor[key] = cursor[key] || {};\n      cursor = cursor[key];\n    }\n  }\n}\n\nexport function createDefaultHistoryState() {\n  return {\n    captureHz: 0,\n    capacity: 0,\n    count: 0,\n    horizon: 0,\n    scrubIndex: 0,\n    live: true,\n  };\n}\n\nexport function createDefaultWatchState() {\n  return {\n    field: 'qpos',\n    index: 0,\n    value: null,\n    min: null,\n    max: null,\n    samples: 0,\n    status: 'idle',\n    summary: '',\n    valid: false,\n    sources: {},\n  };\n}\n\nexport function createDefaultKeyframeState() {\n  return {\n    capacity: 0,\n    count: 0,\n    labels: [],\n    slots: [],\n    lastSaved: -1,\n    lastLoaded: -1,\n  };\n}\n\nexport function createViewerGroupState(initial = true) {\n  const state = {};\n  for (const type of MJ_GROUP_TYPES) {\n    state[type] = Array.from({ length: MJ_GROUP_COUNT }, () => !!initial);\n  }\n  return state;\n}\n\nexport function normaliseGroupState(input) {\n  const output = {};\n  for (const type of MJ_GROUP_TYPES) {\n    const source = Array.isArray(input?.[type]) ? input[type] : null;\n    output[type] = Array.from(\n      { length: MJ_GROUP_COUNT },\n      (_, idx) => (source && idx < source.length ? !!source[idx] : true),\n    );\n  }\n  return output;\n}\n\nexport function splitBinding(binding) {\n  if (!binding || typeof binding !== 'string') return null;\n  const [scope, rest] = binding.split('::');\n  if (!scope || !rest) return null;\n  const path = rest.split('.');\n  return { scope, path };\n}\n`;
}

function renderViewerStructs(layout, pointers, visualDescriptors, statDescriptors) {
  const optionLayout = JSON.stringify(layout, null, 2);
  const fieldPointers = JSON.stringify(pointers, null, 2);
  const visualText = JSON.stringify(visualDescriptors, null, 2);
  const statText = JSON.stringify(statDescriptors, null, 2);
  const lines = [
    '// Auto-generated by tools/generate_ui_artifacts.mjs. Do not edit by hand.',
    '',
    "import { resolveHeapBuffer as resolveSharedHeapBuffer } from './bridge.mjs';",
    "import { strictCatch } from './viewer_runtime.mjs';",
    '',
    'function pointerName(prefix, pathSegments) {',
    '  const suffix = pathSegments',
    '    .map((segment) => segment.replace(/[^A-Za-z0-9]/g, "_"))',
    "    .join('_');",
    '  return `_mjwf_model_${prefix}_${suffix}_ptr`;',
    '}',
    '',
    'function getFieldPtr(mod, handle, prefix, pathSegments) {',
    '  if (!mod || !(handle > 0)) return 0;',
    '  const fnName = pointerName(prefix, pathSegments);',
    "  const fn = typeof mod[fnName] === 'function' ? mod[fnName] : null;",
    '  if (!fn) return 0;',
    '  try {',
    '    return fn.call(mod, handle) | 0;',
    '  } catch (err) {',
    "    strictCatch(err, 'structs:get_field_ptr');",
    '    return 0;',
    '  }',
    '}',
    '',
    'function resolveHeapBuffer(mod) {',
    '  if (!mod) return null;',
    '  if (mod.__heapBuffer instanceof ArrayBuffer) {',
    '    return mod.__heapBuffer;',
    '  }',
    '  try {',
    '    const mem =',
    '      mod.wasmExports?.memory ||',
    '      mod.asm?.memory ||',
    '      mod.asm?.wasmMemory ||',
    '      mod.wasmMemory;',
    '    if (mem?.buffer instanceof ArrayBuffer) {',
    '      mod.__heapBuffer = mem.buffer;',
    '      return mem.buffer;',
    '    }',
    '  } catch (err) {',
    "    strictCatch(err, 'structs:resolve_heap_buffer:memory');",
    '  }',
    '  const heaps = [mod.HEAPF64, mod.HEAPF32, mod.HEAP32, mod.HEAPU8];',
    '  for (const view of heaps) {',
    '    if (view?.buffer instanceof ArrayBuffer) {',
    '      mod.__heapBuffer = view.buffer;',
    '      return view.buffer;',
    '    }',
    '  }',
    '  return null;',
    '}',
    '',
    'function writeTyped(mod, ptr, ArrayType, count, rawValues, { coerceInt = false } = {}) {',
    '  const buffer = resolveHeapBuffer(mod);',
    '  if (!buffer) return false;',
    '  try {',
    '    const view = new ArrayType(buffer, ptr, count);',
    '    const values = Array.isArray(rawValues) ? rawValues : [rawValues];',
    '    if (values.length < count) return false;',
    '    for (let i = 0; i < count; i += 1) {',
    '      let v = values[i];',
    '      if (coerceInt) {',
    '        const num = Number(v);',
    '        if (!Number.isFinite(num)) return false;',
    '        view[i] = num | 0;',
    '      } else {',
    '        const num = Number(v);',
    '        if (!Number.isFinite(num)) return false;',
    '        view[i] = num;',
    '      }',
    '    }',
    '    return true;',
    '  } catch (err) {',
    "    strictCatch(err, 'structs:write_typed');",
    '    return false;',
    '  }',
    '}',
    '',
    'function readTyped(mod, ptr, ArrayType, count, { coerceInt = false } = {}) {',
    '  const buffer = resolveHeapBuffer(mod);',
    '  if (!buffer) return null;',
    '  try {',
    '    const view = new ArrayType(buffer, ptr, count);',
    '    if (count === 1) {',
    '      const value = view[0];',
    '      return coerceInt ? (value | 0) : Number(value);',
    '    }',
    '    return Array.from(view, (value) => (coerceInt ? (value | 0) : Number(value)));',
    '  } catch (err) {',
    "    strictCatch(err, 'structs:read_typed');",
    '    return null;',
    '  }',
    '}',
    '',
    'function toArrayValue(raw, size, { coerceInt = false } = {}) {',
    '  if (Array.isArray(raw)) {',
    '    const arr = raw.map((entry) => Number(entry));',
    '    if (!arr.every((entry) => Number.isFinite(entry))) return null;',
    '    if (size && arr.length < size) return null;',
    '    return arr.slice(0, size);',
    '  }',
    '  const num = Number(raw);',
    '  if (!Number.isFinite(num)) return null;',
    '  if (!size || size === 1) return [coerceInt ? (num | 0) : num];',
    '  return Array(size).fill(coerceInt ? (num | 0) : num);',
    '}',
    '',
    'export function setStructPath(target, pathSegments, value) {',
    '  if (!target || !Array.isArray(pathSegments) || !pathSegments.length) return;',
    '  let cursor = target;',
    '  for (let i = 0; i < pathSegments.length; i += 1) {',
    '    const segment = pathSegments[i];',
    '    const match = segment.match(/^(.*)\\[(\\d+)\\]$/);',
    '    const key = match ? match[1] : segment;',
    '    const hasIndex = !!match;',
    '    const index = hasIndex ? Number(match[2]) : -1;',
    '    if (i === pathSegments.length - 1) {',
    '      if (hasIndex) {',
    '        cursor[key] = Array.isArray(cursor[key]) ? cursor[key] : [];',
    '        cursor[key][index] = value;',
    '      } else {',
    '        cursor[key] = value;',
    '      }',
    '      return;',
    '    }',
    '    if (hasIndex) {',
    '      cursor[key] = Array.isArray(cursor[key]) ? cursor[key] : [];',
    '      cursor[key][index] = cursor[key][index] || {};',
    '      cursor = cursor[key][index];',
    '    } else {',
    '      cursor[key] = cursor[key] || {};',
    '      cursor = cursor[key];',
    '    }',
    '  }',
    '}',
    '',
    'function selectArrayConfig(prefix, kind) {',
    "  if (kind === 'int' || kind === 'enum' || kind === 'bool') {",
    '    return { arrayType: Int32Array, coerceInt: true };',
    '  }',
    "  if (prefix === 'vis') {",
    '    return { arrayType: Float32Array, coerceInt: false };',
    '  }',
    '  return { arrayType: Float64Array, coerceInt: false };',
    '}',
    '',
    'export function writeStructField(mod, handle, prefix, pathSegments, kind, size, rawValue) {',
    '  const ptr = getFieldPtr(mod, handle, prefix, pathSegments);',
    '  if (!ptr) return false;',
    '  const count = Math.max(1, Number(size) || 1);',
    '  const { arrayType, coerceInt } = selectArrayConfig(prefix, kind);',
    '  switch (kind) {',
    "    case 'float':",
    "    case 'float_vec': {",
    '      const values = toArrayValue(rawValue, count, { coerceInt });',
    '      if (!values) return false;',
    '      return writeTyped(mod, ptr, arrayType, count, values, { coerceInt });',
    '    }',
    "    case 'int':",
    "    case 'enum': {",
    '      const values = toArrayValue(rawValue, count, { coerceInt: true });',
    '      if (!values) return false;',
    '      return writeTyped(mod, ptr, Int32Array, count, values, { coerceInt: true });',
    '    }',
    "    case 'bool': {",
    '      const values = toArrayValue(rawValue, count, { coerceInt: true });',
    '      if (!values) return false;',
    '      return writeTyped(mod, ptr, Int32Array, count, values, { coerceInt: true });',
    '    }',
    '    default:',
    '      return false;',
    '  }',
    '}',
    '',
    'function normaliseReadValue(kind, count, raw) {',
    '  if (raw == null) return null;',
    '  if (count === 1) {',
    "    if (kind === 'bool') return raw ? 1 : 0;",
    '    return raw;',
    '  }',
    '  return Array.isArray(raw) ? raw.slice(0, count) : [raw];',
    '}',
    '',
    'export function readStructSnapshot(mod, handle, prefix, descriptors) {',
    '  if (!mod || !(handle > 0)) return null;',
    '  const out = {};',
    '  for (const descriptor of descriptors) {',
    '    const { path, kind, size } = descriptor;',
    '    const ptr = getFieldPtr(mod, handle, prefix, path);',
    '    if (!ptr) continue;',
    '    const count = Math.max(1, Number(size) || 1);',
    '    let raw = null;',
    '    const { arrayType, coerceInt } = selectArrayConfig(prefix, kind);',
    '    switch (kind) {',
    "      case 'float':",
    "      case 'float_vec':",
    '        raw = readTyped(mod, ptr, arrayType, count, { coerceInt });',
    '        break;',
    "      case 'int':",
    "      case 'enum':",
    "      case 'bool':",
    '        raw = readTyped(mod, ptr, Int32Array, count, { coerceInt: true });',
    '        break;',
    '      default:',
    '        break;',
    '    }',
    '    const value = normaliseReadValue(kind, count, raw);',
    '    if (value != null) {',
    '      setStructPath(out, path, value);',
    '    }',
    '  }',
    '  return out;',
    '}',
    `export const OPTION_LAYOUT = ${optionLayout};`,
    '',
    `const FIELD_POINTERS = ${fieldPointers};`,
    '',
    'function resolveOptionHeapBuffer(mod) {',
    '  return resolveSharedHeapBuffer(mod);',
    '}',
    '',
    'function getOptionFieldPtr(mod, handle, field) {',
    '  if (!mod || !(handle > 0)) return 0;',
    '  const name = FIELD_POINTERS[field];',
    '  if (!name) return 0;',
    '  const fn = mod[name];',
    "  if (typeof fn !== 'function') return 0;",
    '  try {',
    '    return fn.call(mod, handle) | 0;',
    '  } catch (err) {',
    "    strictCatch(err, 'structs:get_option_field_ptr');",
    '    return 0;',
    '  }',
    '}',
    '',
    'function writeArray(mod, ptr, ArrayType, count, rawValues, coerceInt) {',
    '  const buffer = resolveOptionHeapBuffer(mod);',
    '  if (!buffer) return false;',
    '  try {',
    '    const view = new ArrayType(buffer, ptr, count);',
    '    const values = Array.isArray(rawValues) ? rawValues : [rawValues];',
    '    if (values.length < count) return false;',
    '    for (let i = 0; i < count; i += 1) {',
    '      let num = Number(values[i]);',
    '      if (!Number.isFinite(num)) return false;',
    '      if (coerceInt) num = num | 0;',
    '      view[i] = num;',
    '    }',
    '    return true;',
    '  } catch (err) {',
    "    strictCatch(err, 'structs:write_array');",
    '    return false;',
    '  }',
    '}',
    '',
    'function readArray(mod, ptr, ArrayType, count, coerceInt) {',
    '  const buffer = resolveOptionHeapBuffer(mod);',
    '  if (!buffer) return null;',
    '  try {',
    '    const view = new ArrayType(buffer, ptr, count);',
    '    if (count === 1) {',
    '      return coerceInt ? (view[0] | 0) : Number(view[0]);',
    '    }',
    '    return Array.from(view, (v) => (coerceInt ? (v | 0) : Number(v)));',
    '  } catch (err) {',
    "    strictCatch(err, 'structs:read_array');",
    '    return null;',
    '  }',
    '}',
    '',
    'export function writeOptionField(mod, handle, path, _kind, value) {',
    '  if (!mod || !(handle > 0)) return false;',
    '  if (!Array.isArray(path) || path.length === 0) return false;',
    '  const field = path[0];',
    '  const info = OPTION_LAYOUT[field];',
    '  if (!info) return false;',
    '  const ptr = getOptionFieldPtr(mod, handle, field);',
    '  if (!ptr) return false;',
    '  const count = info.count || 1;',
    '  const values = Array.isArray(value) ? value : [value];',
    '  if (values.length < count) return false;',
    "  if (info.type === 'f64') {",
    '    return writeArray(mod, ptr, Float64Array, count, values, false);',
    '  }',
    "  if (info.type === 'i32') {",
    '    return writeArray(mod, ptr, Int32Array, count, values, true);',
    '  }',
    '  return false;',
    '}',
    '',
    'export function readOptionStruct(mod, handle) {',
    '  if (!mod || !(handle > 0)) return null;',
    '  const buffer = resolveOptionHeapBuffer(mod);',
    '  if (!buffer) return null;',
    '  const result = {};',
    '  for (const [key, info] of Object.entries(OPTION_LAYOUT)) {',
    '    const ptr = getOptionFieldPtr(mod, handle, key);',
    '    if (!ptr) continue;',
    '    try {',
    "      if (info.type === 'f64') {",
    '        const view = new Float64Array(buffer, ptr, info.count);',
    '        if (info.count === 1) {',
    '          result[key] = Number(view[0]);',
    '        } else {',
    '          result[key] = Array.from(view, (v) => Number(v));',
    '        }',
    "      } else if (info.type === 'i32') {",
    '        const view = new Int32Array(buffer, ptr, info.count);',
    '        if (info.count === 1) {',
    '          result[key] = view[0] | 0;',
    '        } else {',
    '          result[key] = Array.from(view, (v) => v | 0);',
    '        }',
    '      }',
    '    } catch (err) {',
    "      strictCatch(err, 'structs:read_option_struct:read');",
    '    }',
    '  }',
    '  return Object.keys(result).length ? result : null;',
    '}',
    '',
    'export function detectOptionSupport(mod) {',
    '  if (!mod) return { supported: false, pointers: [] };',
    "  const structPtr = typeof mod._mjwf_model_opt_ptr === 'function' ? '_mjwf_model_opt_ptr' : null;",
    "  const fieldPtrs = Object.values(FIELD_POINTERS).filter((name) => typeof mod[name] === 'function');",
    '  const pointers = structPtr ? [structPtr, ...fieldPtrs] : fieldPtrs;',
    '  return {',
    '    supported: pointers.length > 0,',
    '    pointers,',
    '  };',
    '}',
    '',
    `export const VISUAL_FIELD_DESCRIPTORS = ${visualText};`,
    '',
    'export function writeVisualField(mod, handle, pathSegments, kind, value, size) {',
    "  return writeStructField(mod, handle, 'vis', pathSegments, kind, size, value);",
    '}',
    '',
    'export function readVisualStruct(mod, handle) {',
    "  return readStructSnapshot(mod, handle, 'vis', VISUAL_FIELD_DESCRIPTORS);",
    '}',
    '',
    `export const STAT_FIELD_DESCRIPTORS = ${statText};`,
    '',
    'export function writeStatisticField(mod, handle, pathSegments, kind, value, size) {',
    "  return writeStructField(mod, handle, 'stat', pathSegments, kind, size, value);",
    '}',
    '',
    'export function readStatisticStruct(mod, handle) {',
    "  return readStructSnapshot(mod, handle, 'stat', STAT_FIELD_DESCRIPTORS);",
    '}',
    '',
  ];
  return `${lines.join('\n')}\n`;
}

function renderViewerTypes() {
  return `// Auto-generated by tools/generate_ui_artifacts.mjs. Do not edit by hand.\n\n// Type definitions for the runtime state helpers located in viewer_state.mjs.\n// This file lets TypeScript-aware tooling reason about the viewer store while\n// keeping the browser-consumable implementation in plain JS.\n\nexport interface OverlayState {\n  help: boolean;\n  info: boolean;\n  profiler: boolean;\n  sensor: boolean;\n  fullscreen: boolean;\n  vsync: boolean;\n  busywait: boolean;\n  pauseUpdate: boolean;\n}\n\nexport interface SimulationState {\n  run: boolean;\n  scrubIndex: number;\n  keyIndex: number;\n  realTimeIndex: number;\n}\n\nexport interface SelectionState {\n  geom: number;\n  body: number;\n  joint: number;\n  name: string;\n  kind: string;\n  point: [number, number, number];\n  localPoint: [number, number, number];\n  normal: [number, number, number];\n  seq: number;\n  timestamp: number;\n}\n\nexport interface PerturbState {\n  mode: string;\n  active: boolean;\n}\n\nexport interface RuntimeState {\n  cameraIndex: number;\n  cameraLabel: string;\n  trackingGeom: number;\n  lastAction: string;\n  gesture: GestureState;\n  drag: DragState;\n  selection: SelectionState;\n  perturb: PerturbState;\n  lastAlign: AlignRuntimeState;\n  lastCopy: CopyRuntimeState;\n}\n\nexport interface PanelState {\n  left: boolean;\n  right: boolean;\n}\n\nexport interface PhysicsState {\n  disableFlags: Record<string, boolean>;\n  enableFlags: Record<string, boolean>;\n  actuatorGroups: Record<string, boolean>;\n}\n\nexport interface ThemeState {\n  color: number;\n  spacing: number;\n  font: number;\n}\n\nexport interface ViewerGroupState {\n  geom: boolean[];\n  site: boolean[];\n  joint: boolean[];\n  tendon: boolean[];\n  actuator: boolean[];\n  flex: boolean[];\n  skin: boolean[];\n}\n\nexport interface RenderingState {\n  voptFlags: boolean[];\n  sceneFlags: boolean[];\n  labelMode: number;\n  frameMode: number;\n  flexLayer: number;\n  bvhDepth: number;\n  assets: unknown | null;\n  groups: ViewerGroupState;\n}\n\nexport interface HudState {\n  time: number;\n  frames: number;\n  fps: number;\n  rate: number;\n  measuredSlowdown: number;\n  ngeom: number;\n  contacts: number;\n  pausedSource: string;\n  rateSource: string;\n  modelLabel: string;\n  info: Record<string, unknown> | null;\n}\n\nexport interface HistoryState {\n  captureHz: number;\n  capacity: number;\n  count: number;\n  horizon: number;\n  scrubIndex: number;\n  live: boolean;\n}\n\nexport interface WatchState {\n  field: string;\n  index: number;\n  value: number | null;\n  min: number | null;\n  max: number | null;\n  samples: number;\n  status: string;\n  valid: boolean;\n  summary: string;\n  sources: Record<string, { length?: number; label?: string }>;\n}\n\nexport interface KeyframeState {\n  capacity: number;\n  count: number;\n  labels: string[];\n  slots: Array<{ index: number; label: string; kind: string; available: boolean }>;\n  lastSaved: number;\n  lastLoaded: number;\n}\n\nexport interface ModelState {\n  opt: Record<string, unknown>;\n  vis: Record<string, unknown>;\n  stat: Record<string, unknown>;\n  visDefaults: Record<string, unknown>;\n  cameras: Array<Record<string, unknown>>;\n  geoms: Array<Record<string, unknown>>;\n  ctrl: number[];\n  optSupport: { supported: boolean; pointers: string[] };\n  [key: string]: unknown;\n}\n\nexport interface ToastState {\n  message: string;\n  ts: number;\n}\n\nexport interface DragState {\n  dx: number;\n  dy: number;\n}\n\nexport interface GesturePointer {\n  x: number;\n  y: number;\n  dx: number;\n  dy: number;\n  buttons: number;\n  pressure: number;\n}\n\nexport interface GestureState {\n  mode: string;\n  phase: string;\n  pointer?: GesturePointer | null;\n}\n\nexport interface AlignRuntimeState {\n  seq: number;\n  center: [number, number, number];\n  radius: number;\n  timestamp: number;\n  source: string;\n}\n\nexport interface CopyRuntimeState {\n  seq: number;\n  precision: string;\n  nq: number;\n  nv: number;\n  timestamp: number;\n  qposPreview: number[];\n  qvelPreview: number[];\n  complete: boolean;\n}\n\nexport interface VisualBackupsState {\n  model: Record<string, unknown> | null;\n  presetSun: Record<string, unknown> | null;\n  presetMoon: Record<string, unknown> | null;\n  sceneFlagsModel: boolean[] | null;\n  sceneFlagsPresetSun: boolean[] | null;\n  sceneFlagsPresetMoon: boolean[] | null;\n}\n\nexport interface VisualBaselinesState {\n  model: Record<string, unknown> | null;\n  sceneFlagsModel: boolean[] | null;\n  presetSun: Record<string, unknown> | null;\n  presetMoon: Record<string, unknown> | null;\n  sceneFlagsPresetSun: boolean[] | null;\n  sceneFlagsPresetMoon: boolean[] | null;\n}\n\nexport interface ViewerState {\n  overlays: OverlayState;\n  simulation: SimulationState;\n  runtime: RuntimeState;\n  model: ModelState;\n  theme: ThemeState;\n  panels: PanelState;\n  physics: PhysicsState;\n  rendering: RenderingState;\n  hud: HudState;\n  toast: ToastState | null;\n  history: HistoryState;\n  watch: WatchState;\n  keyframes: KeyframeState;\n  visualSourceMode: 'model' | 'preset-sun' | 'preset-moon';\n  visualBackups: VisualBackupsState;\n  visualBaselines: VisualBaselinesState;\n}\n\nexport interface UiControl {\n  item_id: string;\n  type: string;\n  label?: string;\n  name?: string;\n  binding?: string;\n  options?: string[] | string;\n  default?: unknown;\n  shortcut?: string[] | null;\n}\n\nexport interface ViewerStore {\n  get(): ViewerState;\n  replace(state: Partial<ViewerState> | ViewerState): void;\n  update(mutator: (draft: ViewerState) => void): void;\n  subscribe(listener: (state: ViewerState) => void): () => void;\n}\n\nexport interface BackendUiApplyPayload {\n  kind: 'ui';\n  id: string;\n  value: unknown;\n  control: UiControl;\n}\n\nexport interface GestureApplyPayload {\n  kind: 'gesture';\n  mode: string;\n  phase?: string;\n  pointer?: Partial<GesturePointer>;\n  drag?: Partial<DragState>;\n}\n\nexport type BackendApplyPayload = BackendUiApplyPayload | GestureApplyPayload;\n\nexport interface BackendSnapshot {\n  t: number;\n  rate: number;\n  measuredSlowdown?: number;\n  paused: boolean;\n  ngeom: number;\n  nq?: number;\n  nv?: number;\n  pausedSource?: string;\n  rateSource?: string;\n  gesture?: GestureState;\n  drag?: DragState;\n  voptFlags?: number[];\n  sceneFlags?: number[];\n  labelMode?: number;\n  frameMode?: number;\n  cameraMode?: number;\n  frameId?: number | null;\n  visual?: Record<string, unknown> | null;\n  visualDefaults?: Record<string, unknown> | null;\n  statistic?: Record<string, unknown> | null;\n  visualVersion?: number;\n  visualDefaultsVersion?: number;\n  statisticVersion?: number;\n  optionSupport?: { supported: boolean; pointers: string[] } | null;\n  renderAssets?: unknown | null;\n  groups?: ViewerGroupState | null;\n  cameras?: Array<Record<string, unknown>> | null;\n  geoms?: Array<Record<string, unknown>> | null;\n  geom_bodyid?: Int32Array | number[] | null;\n  body_parentid?: Int32Array | number[] | null;\n  body_jntadr?: Int32Array | number[] | null;\n  body_jntnum?: Int32Array | number[] | null;\n  jtype?: Int32Array | number[] | null;\n  nbody?: number;\n  njnt?: number;\n  scn_ngeom?: number;\n  nisland?: number;\n  info?: Record<string, unknown> | null;\n  contacts?: { n?: number; [key: string]: unknown } | null;\n  align?: AlignRuntimeState | null;\n  copyState?: CopyRuntimeState | null;\n  history?: {\n    captureHz?: number;\n    capacity?: number;\n    count?: number;\n    horizon?: number;\n    scrubIndex?: number;\n    live?: boolean;\n  } | null;\n  keyframes?: {\n    capacity?: number;\n    count?: number;\n    labels?: string[];\n    slots?: Array<{ index?: number; label?: string; kind?: string; available?: boolean }>;\n    lastSaved?: number;\n    lastLoaded?: number;\n  } | null;\n  watch?: {\n    field?: string;\n    index?: number;\n    value?: number | null;\n    min?: number | null;\n    max?: number | null;\n    samples?: number;\n    status?: string;\n    valid?: boolean;\n    summary?: string;\n  } | null;\n  watchSources?: Record<string, { length?: number; label?: string }>;\n  keyIndex?: number;\n}\n\nexport interface ViewerBackend {\n  kind: string;\n  apply(payload: BackendApplyPayload): Promise<BackendSnapshot | undefined> | BackendSnapshot | undefined;\n  snapshot(): Promise<BackendSnapshot> | BackendSnapshot;\n  subscribe(listener: (snapshot: BackendSnapshot) => void): () => void;\n  step?(direction?: number): Promise<BackendSnapshot | undefined> | BackendSnapshot | undefined;\n  setCameraIndex?(index: number): Promise<BackendSnapshot | undefined> | BackendSnapshot | undefined;\n  setRunState?(run: boolean, source?: string): Promise<BackendSnapshot | undefined> | BackendSnapshot | undefined;\n  setRate?(rate: number, source?: string): Promise<BackendSnapshot | undefined> | BackendSnapshot | undefined;\n  setVisualState?(payload: { visual?: Record<string, unknown> | null; sceneFlags?: boolean[] | null }): Promise<BackendSnapshot | undefined> | BackendSnapshot | undefined;\n  dispose?(): void;\n}\n\nexport {\n  DEFAULT_VIEWER_STATE,\n  createViewerStore,\n  applySpecAction,\n  applyGesture,\n  createBackend,\n  readControlValue,\n  cameraLabelFromIndex,\n  mergeBackendSnapshot,\n  switchVisualSourceMode,\n} from './state.mjs';\n`;
}

await writeFile(bindingIndexPath, `${JSON.stringify(bindingIndex, null, 2)}\n`, 'utf8');
await writeFile(schemaPath, `${JSON.stringify(schema, null, 2)}\n`, 'utf8');
await writeFile(defaultsPath, renderViewerDefaults(), 'utf8');
await writeFile(sharedPath, renderViewerShared(), 'utf8');
await writeFile(structsPath, renderViewerStructs(optionLayout, fieldPointers, visualDescriptors, statisticDescriptors), 'utf8');
await writeFile(typesPath, renderViewerTypes(), 'utf8');

console.log(`Wrote ${bindingIndexPath}`);
console.log(`Wrote ${schemaPath}`);
console.log(`Wrote ${defaultsPath}`);
console.log(`Wrote ${sharedPath}`);
console.log(`Wrote ${structsPath}`);
console.log(`Wrote ${typesPath}`);
