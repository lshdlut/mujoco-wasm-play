// Facade module: keep the original import path stable.
export {
  resolveHeapBuffer,
  heapViewF64,
  heapViewF32,
  heapViewI32,
  heapViewU8,
  readCString,
  collectRenderAssetsFromModule,
  MjSimLite,
} from './bridge/bridge_core.mjs';
