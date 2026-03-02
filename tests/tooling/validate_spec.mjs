import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..');

function fail(message) {
  throw new Error(message);
}

async function readJson(filePath) {
  const raw = await readFile(filePath, 'utf8');
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(`Failed to parse JSON: ${filePath}\n${String(err?.message || err)}`);
  }
}

function requireNonEmptyArray(name, value) {
  if (!Array.isArray(value) || value.length === 0) {
    fail(`Missing or empty array: ${name}`);
  }
  return value;
}

function requireFiniteNumber(name, value) {
  const num = Number(value);
  if (!Number.isFinite(num)) {
    fail(`Missing or invalid number: ${name}`);
  }
  return num;
}

function validateUiSpec(spec) {
  requireNonEmptyArray('ui_spec.left_panel', spec?.left_panel);
  requireNonEmptyArray('ui_spec.right_panel', spec?.right_panel);

  const runtime = spec?.runtime ?? null;
  if (!runtime || typeof runtime !== 'object') {
    fail('Missing ui_spec.runtime object');
  }

  requireNonEmptyArray('ui_spec.runtime.group_types', runtime.group_types);
  requireFiniteNumber('ui_spec.runtime.group_count', runtime.group_count);
  requireNonEmptyArray('ui_spec.runtime.scene_flag_defaults', runtime.scene_flag_defaults);
  requireNonEmptyArray('ui_spec.runtime.vopt_flag_default_indices', runtime.vopt_flag_default_indices);
  requireNonEmptyArray('ui_spec.runtime.realtime_levels', runtime.realtime_levels);

  const seen = new Set();

  function registerItemId(itemId, context) {
    const raw = typeof itemId === 'string' ? itemId.trim() : '';
    if (!raw) return;
    if (seen.has(raw)) {
      fail(`Duplicate item_id "${raw}" in ui_spec (${context})`);
    }
    seen.add(raw);
  }

  function validateSection(section, panelName) {
    const sectionId = typeof section?.section_id === 'string' ? section.section_id.trim() : '';
    if (!sectionId) {
      fail(`Missing section_id in ui_spec ${panelName} section`);
    }
    for (const item of section?.items ?? []) {
      registerItemId(item?.item_id, `${panelName}:${sectionId}:items`);
    }
    for (const item of section?.post_groups ?? []) {
      registerItemId(item?.item_id, `${panelName}:${sectionId}:post_groups`);
    }
  }

  for (const section of spec.left_panel ?? []) validateSection(section, 'left_panel');
  for (const section of spec.right_panel ?? []) validateSection(section, 'right_panel');
}

function validateProtocol(protocol) {
  requireFiniteNumber('worker_protocol.version', protocol?.version);
  const commands = requireNonEmptyArray('worker_protocol.commands', protocol?.commands);
  const events = requireNonEmptyArray('worker_protocol.events', protocol?.events);

  function validateEntries(label, entries) {
    const names = new Set();
    for (const entry of entries) {
      const name = typeof entry?.name === 'string' ? entry.name.trim() : '';
      if (!name) fail(`Missing ${label} entry name`);
      if (names.has(name)) fail(`Duplicate ${label} name: ${name}`);
      names.add(name);
      if (entry.required != null) {
        if (!Array.isArray(entry.required) || entry.required.some((v) => typeof v !== 'string' || !v.trim())) {
          fail(`Invalid ${label} required list for ${name}`);
        }
      }
    }
  }

  validateEntries('command', commands);
  validateEntries('event', events);
}

const uiSpecPath = path.join(repoRoot, 'spec', 'ui_spec.json');
const protocolPath = path.join(repoRoot, 'tools', 'worker_protocol.json');

const uiSpec = await readJson(uiSpecPath);
validateUiSpec(uiSpec);

const protocol = await readJson(protocolPath);
validateProtocol(protocol);

console.log('SPEC OK');
