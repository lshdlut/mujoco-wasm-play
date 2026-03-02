// Snapshot pool policy for the physics worker.
//
// This module centralizes:
// - Pool ids (what payload groups exist)
// - Dirty reasons (what changes invalidate which pools)
// - Per-pool update cadence (Hz -> interval)
//
// It is intentionally self-contained and worker-agnostic.

export const SNAPSHOT_POOL = {
  VOPT_SYNC: 0,
  OPTIONS_STRUCT: 1,
  HISTORY_META: 2,
  KEYFRAMES_META: 3,
  WATCH_SOURCES: 4,
  INFO_STATS: 5,
  EQ_NAMES: 6,
  BODY_POSE: 7,
  SCENE_PACK: 8,
  CTRL_QPOS: 9,
  EQ_FIELDS: 10,
  LIGHT_FIELDS: 11,
  GEOM_CONST: 12,
  FLEX_VERT: 13,
};

const SNAPSHOT_POOL_COUNT = 14;
const snapshotPoolDirty = new Uint8Array(SNAPSHOT_POOL_COUNT);
const snapshotPoolLastMs = new Float64Array(SNAPSHOT_POOL_COUNT);
const snapshotPoolIntervalMs = new Float64Array(SNAPSHOT_POOL_COUNT);

function snapshotPoolMarkDirtyMany(...poolIds) {
  for (let i = 0; i < poolIds.length; i += 1) {
    snapshotPoolDirty[poolIds[i]] = 1;
  }
}

export const DIRTY_REASON = {
  VOPT_CHANGED: 0,
  SCENE_ONLY_CHANGED: 1,
  OPTIONS_STRUCT_CHANGED: 2,
  EQ_ACTIVE_CHANGED: 3,
  FLEX_CHANGED: 4,
};

const DIRTY_REASON_POOLS = [];
DIRTY_REASON_POOLS[DIRTY_REASON.VOPT_CHANGED] = [SNAPSHOT_POOL.VOPT_SYNC, SNAPSHOT_POOL.SCENE_PACK];
DIRTY_REASON_POOLS[DIRTY_REASON.SCENE_ONLY_CHANGED] = [SNAPSHOT_POOL.SCENE_PACK];
DIRTY_REASON_POOLS[DIRTY_REASON.OPTIONS_STRUCT_CHANGED] = [SNAPSHOT_POOL.OPTIONS_STRUCT, SNAPSHOT_POOL.SCENE_PACK];
DIRTY_REASON_POOLS[DIRTY_REASON.EQ_ACTIVE_CHANGED] = [SNAPSHOT_POOL.EQ_FIELDS];
DIRTY_REASON_POOLS[DIRTY_REASON.FLEX_CHANGED] = [SNAPSHOT_POOL.FLEX_VERT];

export function markDirty(reason, { affectsFlex = false } = {}) {
  const pools = DIRTY_REASON_POOLS[reason];
  if (!pools || !pools.length) {
    throw new Error(`Unknown dirty reason: ${String(reason)}`);
  }
  snapshotPoolMarkDirtyMany(...pools);
  if (affectsFlex) snapshotPoolMarkDirty(SNAPSHOT_POOL.FLEX_VERT);
}

export function snapshotPoolSetHz(poolId, hz) {
  const rate = Number(hz);
  if (rate === 0) {
    snapshotPoolIntervalMs[poolId] = 0;
    return;
  }
  snapshotPoolIntervalMs[poolId] = Number.isFinite(rate) && rate > 0 ? (1000 / rate) : Number.POSITIVE_INFINITY;
}

export function snapshotPoolMarkDirty(poolId) {
  snapshotPoolDirty[poolId] = 1;
}

export function snapshotPoolMarkAllDirty() {
  snapshotPoolDirty.fill(1);
}

export function snapshotPoolResetTimers() {
  snapshotPoolLastMs.fill(0);
}

export function snapshotPoolShouldUpdate(poolId, nowMs) {
  if (snapshotPoolDirty[poolId]) return true;
  const intervalMs = snapshotPoolIntervalMs[poolId];
  if (intervalMs === 0) return true;
  if (!(intervalMs > 0) || intervalMs === Number.POSITIVE_INFINITY) return false;
  return (nowMs - snapshotPoolLastMs[poolId]) >= intervalMs;
}

export function snapshotPoolDidUpdate(poolId, nowMs) {
  snapshotPoolDirty[poolId] = 0;
  snapshotPoolLastMs[poolId] = nowMs;
}

for (const [poolId, hz] of [
  [SNAPSHOT_POOL.VOPT_SYNC, 1],
  [SNAPSHOT_POOL.OPTIONS_STRUCT, 1],
  [SNAPSHOT_POOL.HISTORY_META, 30],
  [SNAPSHOT_POOL.KEYFRAMES_META, Number.POSITIVE_INFINITY],
  [SNAPSHOT_POOL.WATCH_SOURCES, Number.POSITIVE_INFINITY],
  [SNAPSHOT_POOL.INFO_STATS, 10],
  [SNAPSHOT_POOL.EQ_NAMES, Number.POSITIVE_INFINITY],
  [SNAPSHOT_POOL.BODY_POSE, 0],
  [SNAPSHOT_POOL.SCENE_PACK, 0],
  [SNAPSHOT_POOL.CTRL_QPOS, 0],
  [SNAPSHOT_POOL.EQ_FIELDS, 1],
  [SNAPSHOT_POOL.LIGHT_FIELDS, 0],
  [SNAPSHOT_POOL.GEOM_CONST, Number.POSITIVE_INFINITY],
  [SNAPSHOT_POOL.FLEX_VERT, 30],
]) {
  snapshotPoolSetHz(poolId, hz);
}
snapshotPoolMarkAllDirty();
snapshotPoolResetTimers();

