// UI binding spec parsing + value normalisation helpers.
// Keep behaviour identical; do not swallow errors.

import { isStrictEnabled, logError, logWarn, strictCatch } from '../core/viewer_runtime.mjs';
import { splitBinding, toNumber } from '../core/viewer_shared.mjs';

const DEV_ROOT_URL = new URL('../', import.meta.url);

let bindingIndex = null;
let bindingIndexPromise = null;

async function ensureBindingIndex() {
  if (bindingIndex) return bindingIndex;
  if (!bindingIndexPromise) {
    // Struct/binding index lives under spec/; resolve relative to repo root so
    // both local dev and hosted layouts work.
    const url = new URL('spec/ui_bindings_index.json', DEV_ROOT_URL);
    bindingIndexPromise = fetch(url, { cache: 'no-store' })
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to load ui_bindings_index.json (${res.status})`);
        return res.json();
      })
      .then((json) => json)
      .catch((err) => {
        bindingIndex = null;
        bindingIndexPromise = null;
        logError('[bindings] load failed', err);
        strictCatch(err, 'main:bindings_index_load');
        throw err;
      });
  }
  bindingIndex = await bindingIndexPromise;
  return bindingIndex;
}

export function resolveBindingSpec(binding, control = null) {
  if (!binding || typeof binding !== 'string') return null;
  const raw = binding.trim();
  if (!raw) return null;
  switch (raw) {
    case 'Simulate::help':
      return { kind: 'overlay', key: 'help' };
    case 'Simulate::info':
      return { kind: 'overlay', key: 'info' };
    case 'Simulate::profiler':
      return { kind: 'overlay', key: 'profiler' };
    case 'Simulate::sensor':
      return { kind: 'overlay', key: 'sensor' };
    case 'Simulate::fullscreen':
      return { kind: 'overlay', key: 'fullscreen' };
    case 'Simulate::vsync':
      return { kind: 'overlay', key: 'vsync' };
    case 'Simulate::busywait':
      return { kind: 'overlay', key: 'busywait' };
    case 'Simulate::pause_update':
      return { kind: 'overlay', key: 'pauseUpdate' };
    case 'Simulate::run':
      return { kind: 'run' };
    case 'Simulate::camera':
      return { kind: 'camera' };
    case 'Simulate::tracking_geom':
      return { kind: 'tracking_geom' };
    case 'Simulate::scrub_index':
      return { kind: 'scrub_index' };
    case 'Simulate::key':
      return { kind: 'key_index' };
    case 'Simulate::field':
      return { kind: 'watch_field' };
    case 'Simulate::index':
      return { kind: 'watch_index' };
    case 'Simulate::spacing':
      return { kind: 'theme', key: 'spacing' };
    case 'Simulate::color':
      return { kind: 'theme', key: 'color' };
    case 'Simulate::font':
      return { kind: 'theme', key: 'font' };
    case 'UpdateWatch':
      return { kind: 'watch_summary' };
    default:
      break;
  }

  const groupMatch = raw.match(/^mjvOption::(geom|site|joint|tendon|actuator|flex|skin)group\[(\d+)\]$/);
  if (groupMatch) {
    return { kind: 'group', group: groupMatch[1], index: Math.max(0, Math.trunc(toNumber(groupMatch[2]))) };
  }

  if (raw.startsWith('Simulate::disable[')) {
    return {
      kind: 'mask',
      mask: 'disable',
      name: control?.label ?? control?.name ?? raw,
    };
  }
  if (raw.startsWith('Simulate::enable[')) {
    return {
      kind: 'mask',
      mask: 'enable',
      name: control?.label ?? control?.name ?? raw,
    };
  }
  if (raw.startsWith('Simulate::enableactuator[')) {
    return {
      kind: 'mask',
      mask: 'enableactuator',
      name: control?.label ?? control?.name ?? raw,
    };
  }
  if (raw.startsWith('Simulate::opt.')) {
    const field = raw.slice('Simulate::opt.'.length);
    if (field) return { kind: 'sim_opt', field };
  }

  const bindingParts = splitBinding(raw);
  if (bindingParts) {
    const { scope, path } = bindingParts;
    if (scope === 'mjOption' || scope === 'mjVisual' || scope === 'mjStatistic') {
      return { kind: 'struct', scope, path };
    }
  }

  const voptMatch = raw.match(/^mjvOption::flags\[(\d+)\]$/);
  if (voptMatch) {
    return { kind: 'vopt_flag', index: Number(voptMatch[1]) };
  }
  const sceneMatch = raw.match(/^mjvScene::flags\[(\d+)\]$/);
  if (sceneMatch) {
    return { kind: 'scene_flag', index: Number(sceneMatch[1]) };
  }
  if (raw === 'mjvOption::label') return { kind: 'label_mode' };
  if (raw === 'mjvOption::frame') return { kind: 'frame_mode' };

  if (isStrictEnabled()) {
    const id = control?.item_id ?? control?.name ?? control?.label ?? null;
    const err = new Error(`[bindings] unknown binding: ${raw}${id ? ` (control=${id})` : ''}`);
    err.detail = { binding: raw, controlId: id };
    strictCatch(err, 'main:bindings_unknown');
  } else {
    logWarn('[bindings] unknown binding', raw);
  }
  return { kind: 'unknown', binding: raw };
}

export function getControlBindingSpec(control) {
  if (!control || !control.binding) return null;
  if (control.bindingSpec) return control.bindingSpec;
  const spec = resolveBindingSpec(control.binding, control);
  if (spec) {
    control.bindingSpec = spec;
  }
  return spec;
}

function parseNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

export function parseVector(value, length) {
  if (Array.isArray(value)) {
    const arr = value.map((v) => Number(v));
    return arr.every((n) => Number.isFinite(n)) && (!length || arr.length === length) ? arr : null;
  }
  if (typeof value === 'string') {
    const tokens = value.trim().split(/\s+/).filter(Boolean);
    if (length && tokens.length !== length) return null;
    const arr = tokens.map((token) => Number(token));
    return arr.every((n) => Number.isFinite(n)) ? arr : null;
  }
  if (value && typeof value === 'object') {
    try {
      const arr = Array.from(value, (v) => Number(v));
      if (arr.every((n) => Number.isFinite(n)) && (!length || arr.length === length)) {
        return arr;
      }
    } catch (err) {
      strictCatch(err, 'main:parseVector');
    }
  }
  const numeric = parseNumber(value);
  if (numeric == null) return null;
  const arr = [numeric];
  return length && length !== 1 ? null : arr;
}

export function toBoolean(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const token = value.trim().toLowerCase();
    return token === '1' || token === 'true' || token === 'yes' || token === 'on' || token === 'run';
  }
  if (value && typeof value === 'object') {
    if ('checked' in value) return !!value.checked;
    if ('value' in value) return toBoolean(value.value);
  }
  return !!value;
}

function normaliseEnumValue(control, rawValue) {
  if (!control) return null;
  const options = Array.isArray(control.options)
    ? control.options.map((opt) => String(opt))
    : [];
  if (typeof rawValue === 'number' && Number.isFinite(rawValue)) {
    return rawValue | 0;
  }
  const token = String(rawValue ?? '').trim();
  const idx = options.findIndex((opt) => opt === token);
  if (idx >= 0) return idx;
  if (token) {
    const numeric = Number(token);
    if (Number.isFinite(numeric)) return numeric | 0;
  }
  return null;
}

function normaliseValueByKind(kind, size, rawValue, control) {
  switch (kind) {
    case 'float':
      return parseNumber(rawValue);
    case 'float_vec':
      return parseVector(rawValue, size);
    case 'int': {
      const intVal = parseNumber(rawValue);
      return intVal != null ? intVal | 0 : null;
    }
    case 'enum':
      return normaliseEnumValue(control, rawValue);
    case 'bool':
      return toBoolean(rawValue);
    case 'string':
      return rawValue == null ? '' : String(rawValue);
    default:
      return null;
  }
}

export function normaliseControlInput(control, rawValue) {
  if (!control) return rawValue;
  switch (control.type) {
    case 'checkbox':
      return toBoolean(rawValue);
    case 'slider_int':
    case 'edit_int':
      return Math.trunc(toNumber(rawValue));
    case 'slider_float':
    case 'edit_float':
    case 'slider_num':
    case 'slidernum':
      return toNumber(rawValue);
    case 'edit_vec3':
    case 'edit_vec3_string': {
      if (Array.isArray(rawValue)) {
        return rawValue.map((value) => toNumber(value));
      }
      if (typeof rawValue === 'string') {
        const parsed = parseVector(rawValue, 3);
        if (parsed) return parsed;
        return rawValue.trim();
      }
      return rawValue ?? '';
    }
    case 'edit_rgba':
      if (Array.isArray(rawValue)) {
        return rawValue.map((value) => String(value ?? '')).join(' ');
      }
      if (rawValue === null || rawValue === undefined) return '';
      return String(rawValue).trim();
    case 'radio':
      if (typeof rawValue === 'string') {
        if (control?.item_id === 'simulation.run') {
          return rawValue.toLowerCase() !== 'pause';
        }
        return rawValue;
      }
      if (Array.isArray(control.options) && typeof rawValue === 'number') {
        return control.options[rawValue] ?? control.options[0];
      }
      if (control?.item_id === 'simulation.run') {
        return toBoolean(rawValue);
      }
      return rawValue;
    case 'select':
      return rawValue;
    default:
      return rawValue;
  }
}

export async function prepareBindingUpdate(control, rawValue) {
  const bindingRaw = control?.binding;
  const binding = typeof bindingRaw === 'string' ? bindingRaw.trim() : bindingRaw;
  if (!binding || typeof binding !== 'string') return null;
  if (binding === 'Simulate::run') return null;
  const meta = await ensureBindingIndex();
  const entry = meta?.[binding];
  if (!entry || !entry.value) {
    if (isStrictEnabled()) {
      const id = control?.item_id ?? control?.name ?? control?.label ?? null;
      const err = new Error(`[bindings] missing metadata for ${binding}${id ? ` (control=${id})` : ''}`);
      err.detail = { binding, controlId: id };
      strictCatch(err, 'main:bindings_missing_metadata');
    }
    logWarn('[bindings] no binding metadata for', binding);
    return null;
  }
  const bindingParts = splitBinding(binding);
  if (!bindingParts) return null;
  // Simulate-level bindings are handled explicitly in the backend; do not
  // try to treat them as struct-backed fields here.
  if (bindingParts.scope === 'Simulate') {
    if (
      binding.startsWith('Simulate::disable[')
      || binding.startsWith('Simulate::enable[')
      || binding.startsWith('Simulate::enableactuator[')
    ) {
      return null;
    }
  }
  if (bindingParts.scope === 'mjvOption' || bindingParts.scope === 'mjvScene') {
    return null;
  }
  const { scope, path } = bindingParts;
  const kind = entry.value.kind || 'float';
  const size = entry.value.size || 1;
  if (kind === 'static') return null;
  const normalised = normaliseValueByKind(kind, size, rawValue, control);
  if (normalised == null) {
    logWarn('[bindings] unable to normalise value for', binding, rawValue);
    return null;
  }
  return {
    meta: {
      scope,
      path,
      kind,
      size,
    },
    value: normalised,
  };
}
