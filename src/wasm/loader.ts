import path from 'node:path';
import { pathToFileURL } from 'node:url';
import fs from 'node:fs';

export type MujocoModule = {
  // Heaps
  HEAPU8: Uint8Array;
  HEAPF64: Float64Array;

  // Runtime helpers (exported via EXPORTED_RUNTIME_METHODS)
  FS: {
    writeFile: (path: string, data: Uint8Array | string) => void;
    readFile: (path: string, opts?: { encoding?: 'utf8'; flags?: string }) => Uint8Array | string;
    unlink?: (path: string) => void;
  };
  cwrap: (ident: string, returnType: string | null, argTypes?: string[]) => (...args: any[]) => any;
  ccall?: (ident: string, returnType: string | null, argTypes?: string[], args?: any[]) => any;

  // Direct C exports (optional)
  _malloc?: (n: number) => number;
  _free?: (ptr: number) => void;
  _mjw_init?: (xmlPathPtr?: number) => number | void;
  _mjw_step_demo?: (steps?: number) => void;
  _mjw_term?: () => void;
  _mjw_nq?: () => number;
  _mjw_qpos0?: () => number; // returns pointer to double[nq]
  _mjw_qvel0?: () => number; // returns pointer to double[nv]
};

export interface LoadForgeOptions {
  // Absolute or CWD-relative path to directory containing mujoco-3.3.7.{js,wasm}
  forgeDir?: string;
}

export async function loadForge337(options: LoadForgeOptions = {}): Promise<MujocoModule> {
  const forgeDir = options.forgeDir
    ? path.resolve(options.forgeDir)
    : path.resolve(process.cwd(), 'local_tools', 'forge', 'dist', '3.3.7');

  const jsPath = path.join(forgeDir, 'mujoco-3.3.7.js');
  const wasmPath = path.join(forgeDir, 'mujoco-3.3.7.wasm');

  if (!fs.existsSync(jsPath) || !fs.existsSync(wasmPath)) {
    throw new Error(`Forge 3.3.7 artifacts not found under ${forgeDir}`);
  }

  let loaderMod: any;
  const fileUrl = pathToFileURL(jsPath).href;
  try {
    // hint bundlers/test runners not to transform this dynamic import
    // @ts-ignore
    loaderMod = await import(/* @vite-ignore */ fileUrl);
  } catch (e) {
    // Fallback to native dynamic import
    loaderMod = await import(fileUrl);
  }
  const loader: (opts: Record<string, unknown>) => Promise<MujocoModule> = loaderMod.default;

  const mod = await loader({
    locateFile: (p: string) => (p.endsWith('.wasm') ? wasmPath : p),
  });

  return mod as MujocoModule;
}

export function heapViewF64(mod: MujocoModule, ptr: number, length: number): Float64Array {
  const offset = ptr >> 3; // bytes to f64 index
  return mod.HEAPF64.subarray(offset, offset + length);
}
