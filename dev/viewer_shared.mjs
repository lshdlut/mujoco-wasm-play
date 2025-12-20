import { MJ_GROUP_COUNT, MJ_GROUP_TYPES } from './viewer_defaults.mjs';

export function toNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

export function bool(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const v = value.trim().toLowerCase();
    return v === '1' || v === 'true' || v === 'on';
  }
  return !!value;
}

export function cloneStruct(value) {
  if (!value) return null;
  if (typeof structuredClone === 'function') {
    try {
      return structuredClone(value);
    } catch {}
  }
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return null;
  }
}

export function resolveStructPath(target, pathSegments) {
  if (!target || !Array.isArray(pathSegments)) return undefined;
  let current = target;
  for (const segment of pathSegments) {
    if (current == null) return undefined;
    const match = typeof segment === 'string' ? segment.match(/^(.*)\[(\d+)\]$/) : null;
    if (match) {
      const base = match[1];
      const index = Number(match[2]);
      const container = current?.[base];
      if (!Array.isArray(container)) return undefined;
      current = container[index];
      continue;
    }
    current = current?.[segment];
  }
  return current;
}

export function assignStructPath(target, pathSegments, value) {
  if (!target || !Array.isArray(pathSegments) || !pathSegments.length) return;
  let cursor = target;
  for (let i = 0; i < pathSegments.length; i += 1) {
    const segment = pathSegments[i];
    const match = typeof segment === 'string' ? segment.match(/^(.*)\[(\d+)\]$/) : null;
    const key = match ? match[1] : segment;
    const hasIndex = !!match;
    const index = hasIndex ? Number(match[2]) : -1;
    if (i === pathSegments.length - 1) {
      if (hasIndex) {
        cursor[key] = Array.isArray(cursor[key]) ? cursor[key] : [];
        cursor[key][index] = value;
      } else {
        cursor[key] = value;
      }
      return;
    }
    if (hasIndex) {
      cursor[key] = Array.isArray(cursor[key]) ? cursor[key] : [];
      cursor[key][index] = cursor[key][index] || {};
      cursor = cursor[key][index];
    } else {
      cursor[key] = cursor[key] || {};
      cursor = cursor[key];
    }
  }
}

export function createDefaultHistoryState() {
  return {
    captureHz: 0,
    capacity: 0,
    count: 0,
    horizon: 0,
    scrubIndex: 0,
    live: true,
  };
}

export function createDefaultWatchState() {
  return {
    field: 'qpos',
    index: 0,
    value: null,
    min: null,
    max: null,
    samples: 0,
    status: 'idle',
    summary: '',
    valid: false,
    sources: {},
  };
}

export function createDefaultKeyframeState() {
  return {
    capacity: 0,
    count: 0,
    labels: [],
    slots: [],
    lastSaved: -1,
    lastLoaded: -1,
  };
}

export function createViewerGroupState(initial = true) {
  const state = {};
  for (const type of MJ_GROUP_TYPES) {
    state[type] = Array.from({ length: MJ_GROUP_COUNT }, () => !!initial);
  }
  return state;
}

export function normaliseGroupState(input) {
  const output = {};
  for (const type of MJ_GROUP_TYPES) {
    const source = Array.isArray(input?.[type]) ? input[type] : null;
    output[type] = Array.from(
      { length: MJ_GROUP_COUNT },
      (_, idx) => (source && idx < source.length ? !!source[idx] : true),
    );
  }
  return output;
}

export function splitBinding(binding) {
  if (!binding || typeof binding !== 'string') return null;
  const [scope, rest] = binding.split('::');
  if (!scope || !rest) return null;
  const path = rest.split('.');
  return { scope, path };
}
