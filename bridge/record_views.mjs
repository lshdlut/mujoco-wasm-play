import { heapViewF64, heapViewI32 } from './heap_views.mjs';
import { MJDATA_SOLVER_RECORDS_PER_ISLAND_BY_VER } from './forge_abi_snapshot.gen.mjs';

export function solverRecordCapacity(version) {
  return MJDATA_SOLVER_RECORDS_PER_ISLAND_BY_VER[version] || 0;
}

export function solverLastRecordIndex(capacity, island, iterations) {
  if (!(capacity > 0) || !(iterations > 0)) return -1;
  return island * capacity + Math.min(capacity, iterations) - 1;
}

// Forge field pointers address one field in the first C record, not a packed array.
export function readRecordScalar(mod, fieldPtr, recordIndex, strideBytes, Ctor = Float64Array) {
  if (!(fieldPtr > 0) || !Number.isInteger(recordIndex) || recordIndex < 0
      || !Number.isInteger(strideBytes) || strideBytes < Ctor.BYTES_PER_ELEMENT) {
    throw new Error('Invalid Forge record field address');
  }
  const address = fieldPtr + recordIndex * strideBytes;
  if (Ctor === Float64Array) return heapViewF64(mod, address, 1)[0];
  if (Ctor === Int32Array) return heapViewI32(mod, address, 1)[0];
  throw new Error('Unsupported Forge record scalar type');
}
