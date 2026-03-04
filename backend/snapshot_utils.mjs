// Backend snapshot helpers (shape normalization + typed views).
//
// This module is kept separate from `backend_core.mjs` to make the snapshot
// shaping logic easier to review and to keep the backend entrypoint focused on
// worker transport.

import { strictCatch } from '../core/viewer_runtime.mjs';
import { DEFAULT_VOPT_FLAGS_NUMERIC, SCENE_FLAG_DEFAULTS_NUMERIC } from '../core/viewer_defaults.mjs';
import {
  cloneStruct,
  createDefaultHistoryState,
  createDefaultKeyframeState,
  createDefaultWatchState,
  createViewerGroupState,
  normaliseGroupState,
} from '../core/viewer_shared.mjs';
import { SNAPSHOT_VIEW_FIELDS } from '../worker/protocol.gen.mjs';

export function applyViewFields(target, source, fields, viewFn, options = {}) {
  const skipMissing = !!options.skipMissing;
  for (const [Ctor, keys] of fields) {
    for (const key of keys) {
      const value = source[key];
      if (skipMissing && value == null) continue;
      target[key] = viewFn(value, Ctor);
    }
  }
}

export function applyHistoryPayload(target, payload) {
  const history = target.history || createDefaultHistoryState();
  history.captureHz = Number(payload.captureHz) || 0;
  history.capacity = Math.max(0, Number(payload.capacity) || 0);
  history.count = Math.max(0, Number(payload.count) || 0);
  history.horizon = Number(payload.horizon) || 0;
  history.scrubIndex = Number(payload.scrubIndex) || 0;
  history.live = payload.live !== false;
  target.history = history;
}

export function applyKeyframesPayload(target, payload, keyIndexOverride = null) {
  const keyframes = target.keyframes || createDefaultKeyframeState();
  if (typeof payload.capacity === 'number') {
    keyframes.capacity = payload.capacity | 0;
  }
  if (typeof payload.count === 'number') {
    keyframes.count = Math.max(0, payload.count | 0);
  }
  if (Array.isArray(payload.labels)) {
    keyframes.labels = payload.labels.slice();
  }
  if (Array.isArray(payload.slots)) {
    keyframes.slots = payload.slots.map((slot) => ({
      index: Number(slot.index) || 0,
      label: typeof slot.label === 'string' ? slot.label : `Key ${slot.index | 0}`,
      kind: slot.kind || 'user',
      available: !!slot.available,
    }));
  }
  if (typeof payload.lastSaved === 'number') {
    keyframes.lastSaved = payload.lastSaved | 0;
  }
  if (typeof payload.lastLoaded === 'number') {
    keyframes.lastLoaded = payload.lastLoaded | 0;
  }
  target.keyframes = keyframes;
  const keyIndex = Number.isFinite(keyIndexOverride)
    ? keyIndexOverride
    : (Number.isFinite(payload.keyIndex) ? payload.keyIndex : null);
  if (keyIndex != null) {
    target.keyIndex = keyIndex | 0;
  }
}

export function applyWatchPayload(target, payload, options = {}) {
  const watch = target.watch || createDefaultWatchState();
  if (typeof payload.field === 'string') {
    watch.field = payload.field;
  }
  const indexIsFinite = Number.isFinite(payload.index);
  if (typeof payload.index === 'number' && (!options.requireFiniteIndex || indexIsFinite)) {
    watch.index = payload.index | 0;
  }
  if ('value' in payload) {
    const raw = Number(payload.value);
    watch.value = Number.isFinite(raw) ? raw : null;
  }
  const minVal = Number(payload.min);
  const maxVal = Number(payload.max);
  watch.min = Number.isFinite(minVal) ? minVal : null;
  watch.max = Number.isFinite(maxVal) ? maxVal : null;
  const samples = Number(payload.samples) || 0;
  watch.samples = options.clampSamples ? Math.max(0, samples) : samples;
  watch.status = payload.status || watch.status || 'idle';
  watch.valid = !!payload.valid;
  if (options.computeSummary) {
    if (watch.valid && typeof watch.value === 'number') {
      watch.summary = watch.value.toPrecision(6);
    } else {
      watch.summary = '—';
    }
  } else {
    const summary = typeof payload.summary === 'string' ? payload.summary : '';
    watch.summary = summary || watch.summary || '';
  }
  target.watch = watch;
}

export function createInitialSnapshot() {
  return {
    t: 0,
    rate: 1,
    measuredSlowdown: 1,
    paused: false,
    ngeom: 0,
    nq: 0,
    nv: 0,
    pausedSource: 'backend',
    rateSource: 'backend',
    gesture: { mode: 'idle', phase: 'idle', pointer: null },
    drag: { dx: 0, dy: 0 },
    voptFlags: DEFAULT_VOPT_FLAGS_NUMERIC.slice(),
    sceneFlags: SCENE_FLAG_DEFAULTS_NUMERIC.slice(),
    labelMode: 0,
    frameMode: 0,
    cameraMode: 0,
    viewerCamera: null,
    viewerCameraSyncSeq: 0,
    groups: createViewerGroupState(true),
    align: null,
    copyState: null,
    selection: null,
    xpos: new Float64Array(0),
    xmat: new Float64Array(0),
    gsize: null,
    gtype: null,
    contacts: null,
    renderAssets: null,
    options: null,
    ctrl: null,
    optionSupport: { supported: false, pointers: [] },
    visual: null,
    statistic: null,
    visualDefaults: null,
    visualVersion: 0,
    visualDefaultsVersion: 0,
    statisticVersion: 0,
    cameras: [],
    history: createDefaultHistoryState(),
    keyframes: createDefaultKeyframeState(),
    watch: createDefaultWatchState(),
    keyIndex: -1,
  };
}

export function resolveSnapshot(state) {
  const viewOrNull = (value, Ctor) => {
    if (ArrayBuffer.isView(value)) return value;
    if (Array.isArray(value) && Ctor) {
      try {
        return new Ctor(value);
      } catch (err) {
        strictCatch(err, 'backend:view_or_null');
        return null;
      }
    }
    return null;
  };

  const snapshot = {
    t: state.t ?? 0,
    rate: state.rate ?? 1,
    measuredSlowdown: state.measuredSlowdown ?? 1,
    paused: !!state.paused,
    ngeom: state.ngeom ?? 0,
    nq: state.nq ?? 0,
    nv: state.nv ?? 0,
    pausedSource: state.pausedSource ?? 'backend',
    rateSource: state.rateSource ?? 'backend',
    gesture: state.gesture
      ? {
          mode: state.gesture.mode ?? 'idle',
          phase: state.gesture.phase ?? 'idle',
          pointer: state.gesture.pointer
            ? {
                x: Number(state.gesture.pointer.x) || 0,
                y: Number(state.gesture.pointer.y) || 0,
                dx: Number(state.gesture.pointer.dx) || 0,
                dy: Number(state.gesture.pointer.dy) || 0,
                buttons: Number(state.gesture.pointer.buttons ?? 0),
                pressure: Number(state.gesture.pointer.pressure ?? 0),
              }
            : null,
        }
      : { mode: 'idle', phase: 'idle', pointer: null },
    drag: state.drag
      ? {
          dx: Number(state.drag.dx) || 0,
          dy: Number(state.drag.dy) || 0,
        }
      : { dx: 0, dy: 0 },
    selection: state.selection && typeof state.selection === 'object'
      ? {
          seq: Number(state.selection.seq) || 0,
          bodyId: Number(state.selection.bodyId) | 0,
          geomId: Number(state.selection.geomId) | 0,
          flexId: Number(state.selection.flexId) | 0,
          skinId: Number(state.selection.skinId) | 0,
          point: Array.isArray(state.selection.point)
            ? [Number(state.selection.point[0]) || 0, Number(state.selection.point[1]) || 0, Number(state.selection.point[2]) || 0]
            : [0, 0, 0],
          localpos: Array.isArray(state.selection.localpos)
            ? [Number(state.selection.localpos[0]) || 0, Number(state.selection.localpos[1]) || 0, Number(state.selection.localpos[2]) || 0]
            : [0, 0, 0],
          timestamp: Number(state.selection.timestamp) || 0,
        }
      : null,
    voptFlags: Array.isArray(state.voptFlags)
      ? state.voptFlags.map((flag) => (flag ? 1 : 0))
      : DEFAULT_VOPT_FLAGS_NUMERIC.slice(),
    sceneFlags: (() => {
      const flags = [];
      const source = Array.isArray(state.sceneFlags) ? state.sceneFlags : [];
      for (let i = 0; i < SCENE_FLAG_DEFAULTS_NUMERIC.length; i += 1) {
        if (i < source.length && source[i] != null) {
          flags[i] = source[i] ? 1 : 0;
        } else {
          flags[i] = SCENE_FLAG_DEFAULTS_NUMERIC[i];
        }
      }
      return flags;
    })(),
    labelMode: Number.isFinite(state.labelMode) ? (state.labelMode | 0) : 0,
    frameMode: Number.isFinite(state.frameMode) ? (state.frameMode | 0) : 0,
    cameraMode: Number.isFinite(state.cameraMode) ? (state.cameraMode | 0) : 0,
    viewerCameraSyncSeq: Number.isFinite(state.viewerCameraSyncSeq) ? Math.max(0, Math.trunc(state.viewerCameraSyncSeq)) : 0,
    viewerCamera:
      state.viewerCamera && typeof state.viewerCamera === 'object'
        ? {
            type: Number.isFinite(state.viewerCamera.type) ? (state.viewerCamera.type | 0) : 0,
            lookat: Array.isArray(state.viewerCamera.lookat)
              ? state.viewerCamera.lookat.slice(0, 3).map((n) => Number(n) || 0)
              : [0, 0, 0],
            distance: Number(state.viewerCamera.distance) || 0,
            azimuth: Number(state.viewerCamera.azimuth) || 0,
            elevation: Number(state.viewerCamera.elevation) || 0,
            orthographic: !!state.viewerCamera.orthographic,
          }
        : null,
    actuators: Array.isArray(state.actuators) ? state.actuators.slice() : null,
    options: state.options ?? null,
    ctrl: state.ctrl ? Array.from(state.ctrl) : null,
    cameras: Array.isArray(state.cameras) ? state.cameras.slice() : null,
    geoms: Array.isArray(state.geoms) ? state.geoms.slice() : null,
    frameId: Number.isFinite(state.frameId) ? (state.frameId | 0) : null,
    optionSupport: state.optionSupport ? { ...state.optionSupport } : null,
    info: state.info ? { ...state.info } : null,
    visual: cloneStruct(state.visual),
    statistic: cloneStruct(state.statistic),
    visualDefaults: cloneStruct(state.visualDefaults),
    visualVersion: Number.isFinite(state.visualVersion) ? (state.visualVersion | 0) : 0,
    visualDefaultsVersion: Number.isFinite(state.visualDefaultsVersion) ? (state.visualDefaultsVersion | 0) : 0,
    statisticVersion: Number.isFinite(state.statisticVersion) ? (state.statisticVersion | 0) : 0,
    scn_ngeom: Number.isFinite(state.scn_ngeom) ? (state.scn_ngeom | 0) : 0,
    nisland: typeof state.nisland === 'number' ? (state.nisland | 0) : 0,
    jnt_names: Array.isArray(state.jnt_names) ? state.jnt_names.slice() : null,
    eq_names: Array.isArray(state.eq_names) ? state.eq_names.slice() : null,
    contacts:
      state.contacts && typeof state.contacts === 'object'
        ? {
            ...state.contacts,
            pos: viewOrNull(state.contacts.pos, Float64Array),
            frame: viewOrNull(state.contacts.frame, Float64Array),
            geom1: viewOrNull(state.contacts.geom1, Int32Array),
            geom2: viewOrNull(state.contacts.geom2, Int32Array),
            dist: viewOrNull(state.contacts.dist, Float64Array),
            fric: viewOrNull(state.contacts.fric, Float64Array),
            force: viewOrNull(state.contacts.force, Float64Array),
          }
        : null,
    align: state.align
      ? {
          seq: Number(state.align.seq) || 0,
          center: Array.isArray(state.align.center)
            ? state.align.center.slice(0, 3).map((n) => Number(n) || 0)
            : [0, 0, 0],
          radius: Number(state.align.radius) || 0,
          camera:
            state.align.camera && typeof state.align.camera === 'object'
              ? {
                  type: Number.isFinite(state.align.camera.type) ? (state.align.camera.type | 0) : 0,
                  lookat: Array.isArray(state.align.camera.lookat)
                    ? state.align.camera.lookat.slice(0, 3).map((n) => Number(n) || 0)
                    : [0, 0, 0],
                  distance: Number(state.align.camera.distance) || 0,
                  azimuth: Number(state.align.camera.azimuth) || 0,
                  elevation: Number(state.align.camera.elevation) || 0,
                  orthographic: !!state.align.camera.orthographic,
                }
              : null,
          source: state.align.source || 'backend',
          timestamp: Number(state.align.timestamp) || 0,
        }
      : null,
    copyState: state.copyState
      ? {
          seq: Number(state.copyState.seq) || 0,
          precision: state.copyState.precision || 'standard',
          nq: Number(state.copyState.nq) || 0,
          nv: Number(state.copyState.nv) || 0,
          timestamp: Number(state.copyState.timestamp) || 0,
          complete: !!state.copyState.complete,
          qposPreview: Array.isArray(state.copyState.qposPreview)
            ? state.copyState.qposPreview.map((n) => Number(n) || 0)
            : [],
          qvelPreview: Array.isArray(state.copyState.qvelPreview)
            ? state.copyState.qvelPreview.map((n) => Number(n) || 0)
            : [],
        }
      : null,
    renderAssets: state.renderAssets ?? null,
    groups: state.groups ? normaliseGroupState(state.groups) : null,
    nbody: Number.isFinite(state.nbody) ? (state.nbody | 0) : null,
    njnt: Number.isFinite(state.njnt) ? (state.njnt | 0) : null,
    history: state.history
      ? {
          captureHz: Number(state.history.captureHz) || 0,
          capacity: Number(state.history.capacity) || 0,
          count: Number(state.history.count) || 0,
          horizon: Number(state.history.horizon) || 0,
          scrubIndex: Number(state.history.scrubIndex) || 0,
          live: state.history.live !== false,
        }
      : null,
    keyframes: state.keyframes
      ? {
          capacity: Number(state.keyframes.capacity) || 0,
          count: Number(state.keyframes.count) || 0,
          labels: Array.isArray(state.keyframes.labels) ? state.keyframes.labels.slice() : [],
          slots: Array.isArray(state.keyframes.slots) ? state.keyframes.slots.map((slot) => ({ ...slot })) : [],
          lastSaved: Number.isFinite(state.keyframes.lastSaved) ? (state.keyframes.lastSaved | 0) : -1,
          lastLoaded: Number.isFinite(state.keyframes.lastLoaded) ? (state.keyframes.lastLoaded | 0) : -1,
        }
      : null,
    watch: state.watch
      ? {
          field: state.watch.field || 'qpos',
          index: Number.isFinite(state.watch.index) ? (state.watch.index | 0) : 0,
          value: typeof state.watch.value === 'number' && Number.isFinite(state.watch.value) ? state.watch.value : null,
          min: typeof state.watch.min === 'number' && Number.isFinite(state.watch.min) ? state.watch.min : null,
          max: typeof state.watch.max === 'number' && Number.isFinite(state.watch.max) ? state.watch.max : null,
          samples: Number(state.watch.samples) || 0,
          summary: state.watch.summary || '',
          status: state.watch.status || 'idle',
          valid: !!state.watch.valid,
          sources: state.watch.sources ? { ...state.watch.sources } : {},
        }
      : null,
  };
  applyViewFields(snapshot, state, SNAPSHOT_VIEW_FIELDS, viewOrNull);
  return snapshot;
}
