import { DEFAULT_REALTIME_INDEX, DEFAULT_VOPT_FLAGS, REALTIME_LEVELS, SCENE_FLAG_DEFAULTS } from './viewer_defaults.mjs';
import {
  createDefaultHistoryState,
  createDefaultKeyframeState,
  createDefaultWatchState,
  createViewerGroupState,
  normaliseGroupState,
  resolveStructPath,
} from './viewer_shared.mjs';

const EMPTY_HISTORY = Object.freeze(createDefaultHistoryState());
const EMPTY_KEYFRAMES = Object.freeze(createDefaultKeyframeState());
const EMPTY_WATCH = Object.freeze(createDefaultWatchState());
const EMPTY_OPTION_SUPPORT = Object.freeze({ supported: false, pointers: Object.freeze([]) });

const DISABLE_FLAG_LABELS = Object.freeze([
  'Constraint',
  'Equality',
  'Frictionloss',
  'Limit',
  'Contact',
  'Spring',
  'Damper',
  'Gravity',
  'Clampctrl',
  'Warmstart',
  'Filterparent',
  'Actuation',
  'Refsafe',
  'Sensor',
  'Midphase',
  'Eulerdamp',
  'AutoReset',
  'NativeCCD',
  'Island',
]);

const ENABLE_FLAG_LABELS = Object.freeze([
  'Override',
  'Energy',
  'Fwdinv',
  'InvDiscrete',
  'MultiCCD',
]);

const ACTUATOR_GROUP_LABELS = Object.freeze([
  'Act Group 0',
  'Act Group 1',
  'Act Group 2',
  'Act Group 3',
  'Act Group 4',
  'Act Group 5',
]);

function flagsFromMask(mask, labels, invert = false) {
  const result = {};
  const numericMask = Number(mask) | 0;
  for (let i = 0; i < labels.length; i += 1) {
    const bitOn = !!(numericMask & (1 << i));
    result[labels[i]] = invert ? !bitOn : bitOn;
  }
  return result;
}

export function resolveRealTimeIndexFromRate(rate) {
  const raw = Number(rate);
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_REALTIME_INDEX;
  const percent = raw * 100;
  let bestIdx = DEFAULT_REALTIME_INDEX;
  let bestDiff = Infinity;
  for (let i = 0; i < REALTIME_LEVELS.length; i += 1) {
    const diff = Math.abs(REALTIME_LEVELS[i] - percent);
    if (diff < bestDiff) {
      bestDiff = diff;
      bestIdx = i;
    }
  }
  return bestIdx;
}

export function getSnapshotSimulation(snapshot) {
  const history = getSnapshotHistory(snapshot);
  return {
    run: !(snapshot?.paused === true),
    scrubIndex: Number.isFinite(history.scrubIndex) ? (history.scrubIndex | 0) : 0,
    keyIndex: Number.isFinite(snapshot?.keyIndex) ? (snapshot.keyIndex | 0) : -1,
    realTimeIndex: resolveRealTimeIndexFromRate(snapshot?.rate),
  };
}

export function getSnapshotHud(snapshot) {
  return {
    time: Number(snapshot?.t) || 0,
    rate: Number(snapshot?.rate) || 1,
    measuredSlowdown: Number(snapshot?.measuredSlowdown) || 1,
    ngeom: Number.isFinite(snapshot?.ngeom) ? (snapshot.ngeom | 0) : 0,
    contacts: Number(snapshot?.contacts?.n) || 0,
    pausedSource: typeof snapshot?.pausedSource === 'string' ? snapshot.pausedSource : 'backend',
    rateSource: typeof snapshot?.rateSource === 'string' ? snapshot.rateSource : 'backend',
    info: snapshot?.info && typeof snapshot.info === 'object' ? snapshot.info : null,
  };
}

export function getSnapshotInfo(snapshot) {
  return snapshot?.info && typeof snapshot.info === 'object' ? snapshot.info : null;
}

export function getSnapshotOptions(snapshot) {
  return snapshot?.options && typeof snapshot.options === 'object' ? snapshot.options : null;
}

export function getSnapshotVisual(snapshot) {
  return snapshot?.visual && typeof snapshot.visual === 'object' ? snapshot.visual : null;
}

export function getSnapshotStatistic(snapshot) {
  return snapshot?.statistic && typeof snapshot.statistic === 'object' ? snapshot.statistic : null;
}

export function getSnapshotHistory(snapshot) {
  return snapshot?.history && typeof snapshot.history === 'object' ? snapshot.history : EMPTY_HISTORY;
}

export function getSnapshotKeyframes(snapshot) {
  return snapshot?.keyframes && typeof snapshot.keyframes === 'object' ? snapshot.keyframes : EMPTY_KEYFRAMES;
}

export function getSnapshotWatch(snapshot) {
  return snapshot?.watch && typeof snapshot.watch === 'object' ? snapshot.watch : EMPTY_WATCH;
}

export function getSnapshotWatchSources(snapshot) {
  const watch = getSnapshotWatch(snapshot);
  return watch.sources && typeof watch.sources === 'object' ? watch.sources : {};
}

export function getSnapshotOptionSupport(snapshot) {
  return snapshot?.optionSupport && typeof snapshot.optionSupport === 'object'
    ? snapshot.optionSupport
    : EMPTY_OPTION_SUPPORT;
}

export function getSnapshotCameraMode(snapshot) {
  return Number.isFinite(snapshot?.cameraMode) ? (snapshot.cameraMode | 0) : 0;
}

export function getSnapshotLabelMode(snapshot) {
  return Number.isFinite(snapshot?.labelMode) ? (snapshot.labelMode | 0) : 0;
}

export function getSnapshotFrameMode(snapshot) {
  return Number.isFinite(snapshot?.frameMode) ? (snapshot.frameMode | 0) : 0;
}

export function getSnapshotFlexLayer(snapshot) {
  const value = Number(snapshot?.options?.flex_layer);
  return Number.isFinite(value) ? Math.max(0, value | 0) : 0;
}

export function getSnapshotBvhDepth(snapshot) {
  const value = Number(snapshot?.options?.bvh_depth);
  return Number.isFinite(value) ? Math.max(0, value | 0) : 1;
}

export function getSnapshotSceneFlags(snapshot) {
  if (!Array.isArray(snapshot?.sceneFlags)) return SCENE_FLAG_DEFAULTS;
  const flags = [];
  for (let i = 0; i < SCENE_FLAG_DEFAULTS.length; i += 1) {
    flags[i] = snapshot.sceneFlags[i] != null ? !!snapshot.sceneFlags[i] : SCENE_FLAG_DEFAULTS[i];
  }
  return flags;
}

export function getSnapshotVoptFlags(snapshot) {
  if (!Array.isArray(snapshot?.voptFlags)) return DEFAULT_VOPT_FLAGS;
  return snapshot.voptFlags.map((flag) => !!flag);
}

export function getSnapshotGroups(snapshot) {
  return snapshot?.groups && typeof snapshot.groups === 'object'
    ? normaliseGroupState(snapshot.groups)
    : createViewerGroupState(true);
}

export function getSnapshotRenderAssets(snapshot) {
  return snapshot?.renderAssets ?? null;
}

export function getSnapshotCameras(snapshot) {
  return Array.isArray(snapshot?.cameras) ? snapshot.cameras : [];
}

export function getSnapshotGeoms(snapshot) {
  return Array.isArray(snapshot?.geoms) ? snapshot.geoms : [];
}

export function getSnapshotSelection(snapshot) {
  return snapshot?.selection && typeof snapshot.selection === 'object' ? snapshot.selection : null;
}

export function getSnapshotAlign(snapshot) {
  return snapshot?.align && typeof snapshot.align === 'object' ? snapshot.align : null;
}

export function getSnapshotCopyState(snapshot) {
  return snapshot?.copyState && typeof snapshot.copyState === 'object' ? snapshot.copyState : null;
}

export function getSnapshotTrackingGeom(uiState) {
  const value = Number(uiState?.runtime?.trackingGeom);
  return Number.isFinite(value) ? (value | 0) : -1;
}

export function getSnapshotStructValue(snapshot, scope, path) {
  if (scope === 'mjOption') return resolveStructPath(snapshot?.options, path);
  if (scope === 'mjVisual') return resolveStructPath(snapshot?.visual, path);
  if (scope === 'mjStatistic') return resolveStructPath(snapshot?.statistic, path);
  return undefined;
}

export function getSnapshotMaskState(snapshot, mask) {
  const options = snapshot?.options && typeof snapshot.options === 'object' ? snapshot.options : null;
  if (!options) return {};
  if (mask === 'disable') return flagsFromMask(options.disableflags, DISABLE_FLAG_LABELS, false);
  if (mask === 'enable') return flagsFromMask(options.enableflags, ENABLE_FLAG_LABELS, false);
  if (mask === 'enableactuator') return flagsFromMask(options.disableactuator, ACTUATOR_GROUP_LABELS, true);
  return {};
}

export function getSnapshotSimOption(snapshot, field) {
  if (field === 'labelMode') return getSnapshotLabelMode(snapshot);
  if (field === 'frameMode') return getSnapshotFrameMode(snapshot);
  if (field === 'flexLayer') return getSnapshotFlexLayer(snapshot);
  if (field === 'bvhDepth') return getSnapshotBvhDepth(snapshot);
  const value = snapshot?.options?.[field];
  return value ?? 0;
}

export function getSnapshotGeomBodyIds(snapshot) {
  return snapshot?.geom_bodyid ?? null;
}

export function getSnapshotBodyParentIds(snapshot) {
  return snapshot?.body_parentid ?? null;
}

export function getSnapshotBodyJointAdr(snapshot) {
  return snapshot?.body_jntadr ?? null;
}

export function getSnapshotBodyJointNum(snapshot) {
  return snapshot?.body_jntnum ?? null;
}

export function getSnapshotJointTypes(snapshot) {
  return snapshot?.jtype ?? null;
}

export function getSnapshotJointQposAdr(snapshot) {
  return snapshot?.jnt_qposadr ?? null;
}

export function getSnapshotJointNames(snapshot) {
  return Array.isArray(snapshot?.jnt_names) ? snapshot.jnt_names : [];
}
