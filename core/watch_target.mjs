// A Watch edit is a component patch, not a replay of an asynchronous snapshot.
// The Worker alone supplies omitted components. Preserve the legacy explicit
// value normalization; omission is not an explicit null or invalid value.
export function resolveWatchTargetPatch(current, payload) {
  const hasField = Object.hasOwn(payload, 'field');
  const hasIndex = Object.hasOwn(payload, 'index');
  if (!hasField && !hasIndex) return null; // No edit: retain target and sample statistics.
  const numeric = hasIndex ? Number(payload.index) : current.index;
  return {
    field: hasField && typeof payload.field === 'string' ? payload.field.trim() : current.field,
    index: hasIndex ? Math.max(0, Number.isFinite(numeric) ? (numeric | 0) : 0) : current.index,
  };
}
