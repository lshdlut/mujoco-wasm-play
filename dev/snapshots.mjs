const TYPE_MAP = {
  0: 'plane',
  1: 'hfield',
  2: 'sphere',
  3: 'capsule',
  4: 'ellipsoid',
  5: 'cylinder',
  6: 'box',
  7: 'mesh',
};

function normalizeType(value) {
  return TYPE_MAP[value | 0] || 'unknown';
}

function toArray(view, index, count, fallback = 0) {
  const out = [];
  for (let i = 0; i < count; i += 1) {
    out.push(Number(view?.[index + i]) || fallback);
  }
  return out;
}

function computeAabb(type, size) {
  const [sx, sy, sz] = size;
  switch (type) {
    case 'sphere':
    case 'ellipsoid':
      return {
        min: [-sx, -sx, -sx],
        max: [sx, sx, sx],
      };
    case 'capsule':
      return {
        min: [-sx, -sx, -(sx + sy)],
        max: [sx, sx, sx + sy],
      };
    case 'cylinder':
      return {
        min: [-sx, -sx, -sy],
        max: [sx, sx, sy],
      };
    case 'box':
      return {
        min: [-sx, -sy, -sz],
        max: [sx, sy, sz],
      };
    default:
      return {
        min: [-Math.abs(sx || 0), -Math.abs(sy || 0), -Math.abs(sz || 0)],
        max: [Math.abs(sx || 0), Math.abs(sy || 0), Math.abs(sz || 0)],
      };
  }
}

export function hashBuffer(view) {
  if (!view) return '0';
  const data = ArrayBuffer.isView(view)
    ? view
    : Array.isArray(view)
      ? Float64Array.from(view)
      : null;
  if (!data) return '0';
  let lo = 0 >>> 0;
  let hi = 0 >>> 0;
  const buffer = new ArrayBuffer(8);
  const f64 = new Float64Array(buffer);
  const u32 = new Uint32Array(buffer);
  const length = data.length;
  for (let i = 0; i < length; i += 1) {
    f64[0] = Number(data[i]) || 0;
    lo = (lo + u32[0] + i) >>> 0;
    hi = (hi ^ u32[1] ^ (i * 2654435761)) >>> 0;
  }
  return `${hi.toString(16).padStart(8, '0')}${lo.toString(16).padStart(8, '0')}`;
}

export function createSceneSnap({
  frame,
  ngeom,
  gtype,
  gsize,
  gmatid,
  matrgba,
  gdataid,
  xpos,
  xmat,
  mesh,
}) {
  const geoms = [];
  for (let i = 0; i < (ngeom | 0); i += 1) {
    const typeName = normalizeType(gtype?.[i] ?? 6);
    const size = toArray(gsize, i * 3, 3, 0);
    const rgbaIndex = ((gmatid?.[i] ?? -1) * 4);
    const rgba = toArray(matrgba, rgbaIndex, 4, 1);
    const position = toArray(xpos, i * 3, 3, 0);
    const matrix = toArray(xmat, i * 9, 9, 0);
    const meshId = gdataid?.[i] ?? -1;
    const vertCount = mesh && meshId >= 0 ? Number(mesh.vertnum?.[meshId]) || 0 : 0;
    const faceCount = mesh && meshId >= 0 ? 3 * (Number(mesh.facenum?.[meshId]) || 0) : 0;
    const aabb = computeAabb(typeName, size);
    geoms.push({
      id: i,
      type: typeName,
      size,
      rgba,
      xpos: position,
      xmat: matrix,
      vertex_count: vertCount,
      index_count: faceCount,
      aabb_min: aabb.min,
      aabb_max: aabb.max,
      hash_vertices: mesh && meshId >= 0 ? hashBuffer(mesh.vert) : '0',
      hash_indices: mesh && meshId >= 0 ? hashBuffer(mesh.face) : '0',
      mesh_name: meshId >= 0 ? `mesh/${meshId}` : null,
    });
  }
  return { frame, geoms };
}

export function diffSceneSnaps(a, b) {
  const result = { ok: true, differences: [] };
  if (!a || !b) {
    result.ok = false;
    result.differences.push('missing snapshot(s)');
    return result;
  }
  if (a.geoms.length !== b.geoms.length) {
    result.ok = false;
    result.differences.push(`ngeom mismatch: ${a.geoms.length} vs ${b.geoms.length}`);
    return result;
  }
  for (let i = 0; i < a.geoms.length; i += 1) {
    const ga = a.geoms[i];
    const gb = b.geoms[i];
    if (ga.type !== gb.type) {
      result.ok = false;
      result.differences.push(`geom ${i} type mismatch: ${ga.type} vs ${gb.type}`);
    }
    if (ga.vertex_count !== gb.vertex_count || ga.index_count !== gb.index_count) {
      result.ok = false;
      result.differences.push(`geom ${i} topology mismatch: vert ${ga.vertex_count}/${gb.vertex_count}, index ${ga.index_count}/${gb.index_count}`);
    }
    if (ga.hash_vertices !== gb.hash_vertices || ga.hash_indices !== gb.hash_indices) {
      result.ok = false;
      result.differences.push(`geom ${i} hash mismatch: vert ${ga.hash_vertices}/${gb.hash_vertices}, index ${ga.hash_indices}/${gb.hash_indices}`);
    }
  }
  return result;
}
