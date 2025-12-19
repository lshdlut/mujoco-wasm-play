import { fileURLToPath, pathToFileURL } from 'url';
import path from 'path';

export interface MujocoModule {
  HEAP8?: Int8Array;
  HEAP16?: Int16Array;
  HEAP32?: Int32Array;
  HEAPF32?: Float32Array;
  HEAPF64?: Float64Array;
  wasmExports?: { memory?: WebAssembly.Memory };
  wasmMemory?: WebAssembly.Memory;
  asm?: { memory?: WebAssembly.Memory; wasmMemory?: WebAssembly.Memory };
  FS: { writeFile(path: string, data: Uint8Array | string): void };
  ccall?: (ident: string, returnType?: string | null, argTypes?: string[], args?: any[]) => any;
  cwrap?: (ident: string, returnType?: string | null, argTypes?: string[]) => (...args: any[]) => any;
  [k: string]: any; // direct symbol exports like _mjw_*, _mjwf_*
}

export function heapViewF64(mod: MujocoModule, ptr: number, length: number): Float64Array {
  return createTypedArray(mod, ptr, length, Float64Array);
}

export function heapViewI32(mod: MujocoModule, ptr: number, length: number): Int32Array {
  return createTypedArray(mod, ptr, length, Int32Array);
}

function resolveHeapBuffer(mod: MujocoModule): ArrayBuffer | null {
  try {
    const mem =
      mod.wasmExports?.memory ??
      mod.asm?.memory ??
      mod.asm?.wasmMemory ??
      mod.wasmMemory;
    if (mem?.buffer instanceof ArrayBuffer) {
      return mem.buffer;
    }
  } catch {}
  const heapBuf = (mod as any).__heapBuffer;
  if (heapBuf instanceof ArrayBuffer) {
    return heapBuf;
  }
  return null;
}

function createTypedArray<T extends Float64Array | Int32Array>(
  mod: MujocoModule,
  ptr: number,
  length: number,
  Ctor: { new(buffer: ArrayBuffer, byteOffset: number, length: number): T; new(length: number): T; BYTES_PER_ELEMENT: number },
): T {
  if (!(ptr > 0) || !(length > 0)) {
    return new Ctor(0);
  }
  const buffer = resolveHeapBuffer(mod);
  if (!buffer) {
    return new Ctor(length);
  }
  (mod as any).__heapBuffer = buffer;
  try {
    return new Ctor(buffer, ptr >>> 0, length);
  } catch {
    const bytes = Ctor.BYTES_PER_ELEMENT * length;
    const src = new Uint8Array(buffer, ptr >>> 0, bytes);
    const copy = new Ctor(length);
    new Uint8Array(copy.buffer).set(src);
    return copy;
  }
}

function isNode(): boolean {
  return typeof process === 'object' && !!(process as any).versions?.node;
}

export async function loadForgeVersion(ver = '3.3.7'): Promise<MujocoModule> {
  let jsUrl: URL;
  let wasmUrl: URL;
  if (isNode()) {
    const baseFs = path.resolve(process.cwd(), 'dist', ver);
    jsUrl = pathToFileURL(path.join(baseFs, 'mujoco.js'));
    wasmUrl = pathToFileURL(path.join(baseFs, 'mujoco.wasm'));
  } else {
    const base = new URL(`/dist/${ver}/`, globalThis.location?.origin ?? '');
    jsUrl = new URL('mujoco.js', base);
    wasmUrl = new URL('mujoco.wasm', base);
  }

  const modFactory: any = (await import(jsUrl.href)).default ?? (await import(jsUrl.href));
  const mod: MujocoModule = await modFactory({
    locateFile: (p: string) => (p.endsWith('.wasm') ? (isNode() ? fileURLToPath(wasmUrl) : wasmUrl.href) : p),
  });
  return mod;
}

export async function loadForge337(): Promise<MujocoModule> {
  return loadForgeVersion('3.3.7');
}
