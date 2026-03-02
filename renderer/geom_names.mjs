// Geom name lookup helpers shared by the renderer and controllers.

function createGeomNameLookup(sourceList) {
  const lookup = new Map();
  if (!Array.isArray(sourceList)) return lookup;
  for (const entry of sourceList) {
    const idx = Number(entry?.index);
    if (!Number.isFinite(idx)) continue;
    const label = typeof entry?.name === 'string' ? entry.name.trim() : '';
    lookup.set(idx, label || `Geom ${idx}`);
  }
  return lookup;
}

export function getOrCreateGeomNameLookup(ctx, sourceList) {
  if (!ctx) return createGeomNameLookup(sourceList);
  const nextSource = sourceList || null;
  let lookup = ctx._geomNameLookup || null;
  if (ctx._geomNameLookupSource !== nextSource || !lookup) {
    lookup = createGeomNameLookup(nextSource);
    ctx._geomNameLookup = lookup;
    ctx._geomNameLookupSource = nextSource;
  }
  return lookup;
}

export function geomNameFromLookup(lookup, index) {
  return lookup?.get(index) ?? `Geom ${index}`;
}

