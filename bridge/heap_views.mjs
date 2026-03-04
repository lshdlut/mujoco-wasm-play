// Heap view helpers for forge/Emscripten modules.

import { strictCatch, strictFallback } from '../core/viewer_runtime.mjs';

function isArrayBufferLike(value) {
  if (!value) return false;
  if (value instanceof ArrayBuffer) return true;
  const hasSAB = typeof SharedArrayBuffer !== 'undefined';
  return hasSAB && value instanceof SharedArrayBuffer;
}

export function resolveHeapBuffer(mod) {
  if (!mod) return null;
  try {
    const mem = mod.wasmExports?.memory;
    if (isArrayBufferLike(mem?.buffer) && mem.buffer.byteLength > 0) {
      mod.__heapBuffer = mem.buffer;
      return mem.buffer;
    }
  } catch (err) {
    strictCatch(err, 'bridge:resolveHeapBuffer');
  }
  try {
    const heapU8 = mod.HEAPU8;
    if (isArrayBufferLike(heapU8?.buffer) && heapU8.buffer.byteLength > 0) {
      mod.__heapBuffer = heapU8.buffer;
      return heapU8.buffer;
    }
  } catch (err) {
    strictCatch(err, 'bridge:resolveHeapBuffer');
  }
  try {
    const heapF64 = mod.HEAPF64;
    if (isArrayBufferLike(heapF64?.buffer) && heapF64.buffer.byteLength > 0) {
      mod.__heapBuffer = heapF64.buffer;
      return heapF64.buffer;
    }
  } catch (err) {
    strictCatch(err, 'bridge:resolveHeapBuffer');
  }
  if (isArrayBufferLike(mod.__heapBuffer) && mod.__heapBuffer.byteLength > 0) {
    return mod.__heapBuffer;
  }
  return null;
}

function ensureHeapViewCache(mod, buffer) {
  if (!mod || !isArrayBufferLike(buffer)) return null;
  const existing = mod.__heapViewCache;
  if (existing && existing.buffer === buffer && existing.map instanceof Map) {
    return existing;
  }
  const next = { buffer, map: new Map() };
  try {
    mod.__heapViewCache = next;
  } catch (err) {
    strictCatch(err, 'bridge:heapViewCache_assign');
    return null;
  }
  return next;
}

function createHeapTypedArray(mod, ptr, length, Ctor) {
  const n = length | 0;
  if (!(n > 0) || !(ptr > 0)) {
    return new Ctor(0);
  }
  const buffer = resolveHeapBuffer(mod);
  if (isArrayBufferLike(buffer)) {
    mod.__heapBuffer = buffer;
    try {
      const cacheState = ensureHeapViewCache(mod, buffer);
      const key = cacheState ? `${Ctor.name}:${ptr >>> 0}` : null;
      if (cacheState && key) {
        const cached = cacheState.map.get(key);
        if (cached && cached.len === n && cached.view && cached.view.buffer === buffer) {
          return cached.view;
        }
      }
      const view = new Ctor(buffer, ptr >>> 0, n);
      if (cacheState && key && view && view.buffer === buffer) {
        cacheState.map.set(key, { len: n, view });
      }
      return view;
    } catch (err) {
      try {
        const bytes = Ctor.BYTES_PER_ELEMENT * n;
        const src = new Uint8Array(buffer, ptr >>> 0, bytes);
        const copy = new Ctor(n);
        new Uint8Array(copy.buffer).set(src);
        return copy;
      } catch (err) {
        strictCatch(err, 'bridge:createHeapTypedArray_copy');
        // fall through to HEAP view fallback
      }
    }
  }
  const heapField =
    Ctor === Float64Array ? 'HEAPF64'
      : Ctor === Float32Array ? 'HEAPF32'
        : Ctor === Int32Array ? 'HEAP32'
          : Ctor === BigInt64Array ? 'HEAP64'
          : null;
  if (heapField && mod && mod[heapField] && isArrayBufferLike(mod[heapField].buffer)) {
    const heap = mod[heapField];
    const shift = Math.log2(Ctor.BYTES_PER_ELEMENT) | 0;
    const start = ptr >> shift;
    try {
      strictFallback('bridge:heap_view_fallback', { ctor: Ctor.name, ptr, length: n });
      return heap.subarray(start, start + n);
    } catch (err) {
      strictCatch(err, 'bridge:heap_view_subarray');
    }
  }
  strictFallback('bridge:heap_view_missing', { ctor: Ctor.name, ptr, length: n });
  return new Ctor(n);
}

export function computeMeshElementCounts(
  vertAdr,
  vertNum,
  faceAdr,
  faceNum,
  texcoordAdr,
  texcoordNum,
  normalAdr,
  normalNum,
) {
  const safeMax = (adrView, numView, scale) => {
    if (!adrView || !numView || !Number.isFinite(scale) || scale <= 0) return 0;
    const n = Math.min(adrView.length, numView.length) | 0;
    let max = 0;
    for (let i = 0; i < n; i += 1) {
      const base = adrView[i] | 0;
      const count = numView[i] | 0;
      if (base < 0 || count <= 0) continue;
      const end = base + count;
      if (end > max) max = end;
    }
    return max * scale;
  };
  return {
    vert: safeMax(vertAdr, vertNum, 3),
    face: safeMax(faceAdr, faceNum, 3),
    texcoord: safeMax(texcoordAdr, texcoordNum, 2),
    normal: safeMax(normalAdr, normalNum, 3),
  };
}

export function heapViewF64(mod, ptr, length) {
  return createHeapTypedArray(mod, ptr, length, Float64Array);
}
export function heapViewF32(mod, ptr, length) {
  return createHeapTypedArray(mod, ptr, length, Float32Array);
}
export function heapViewI32(mod, ptr, length) {
  return createHeapTypedArray(mod, ptr, length, Int32Array);
}
export function heapViewI64(mod, ptr, length) {
  return createHeapTypedArray(mod, ptr, length, BigInt64Array);
}
export function heapViewU8(mod, ptr, length) {
  return createHeapTypedArray(mod, ptr, length, Uint8Array);
}
export function readCString(mod, ptr) {
  if (!ptr) return '';
  const buffer = resolveHeapBuffer(mod);
  if (!buffer) return '';
  const u8 = new Uint8Array(buffer);
  let out = '';
  for (let i = ptr | 0; i < u8.length; i += 1) {
    const ch = u8[i];
    if (!ch) break;
    out += String.fromCharCode(ch);
  }
  return out;
}
