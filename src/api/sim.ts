import type { MujocoModule } from '../wasm/loader.js';
import { heapViewF64 } from '../wasm/loader.js';

export class MjSim {
  private initFnLegacy?: (path: string) => number;
  private stepFnLegacy?: (steps: number) => void;

  private haveHandleApi = false;
  private handlePrefix: 'mjwf' | 'mjw' = 'mjwf';
  private h: number = 0;

  constructor(private mod: MujocoModule) {
    // Legacy demo API (minimal.c)
    this.initFnLegacy = mod.cwrap?.('mjw_init', 'number', ['string']);
    this.stepFnLegacy = mod.cwrap?.('mjw_step_demo', null, ['number']);

    // Detect handle-based API and prefix (mjwf_ preferred, fallback to mjw_)
    const mkWf = (mod as any)._mjwf_make_from_xml as ((p: string) => number) | undefined;
    const mkW  = (mod as any)._mjw_make_from_xml as ((p: string) => number) | undefined;
    if (typeof mkWf === 'function') {
      this.handlePrefix = 'mjwf';
      this.haveHandleApi = true;
    } else if (typeof mkW === 'function' || !!mod.cwrap?.('mjw_make_from_xml','number',['string'])) {
      this.handlePrefix = 'mjw';
      this.haveHandleApi = true;
    }
  }

  initFromXml(xmlText: string, path = '/model.xml'): void {
    if (!this.mod.FS) throw new Error('Runtime FS not available');
    const bytes = new TextEncoder().encode(xmlText);
    this.mod.FS.writeFile(path, bytes);

    if (this.haveHandleApi) {
      const mkName = `${this.handlePrefix}_make_from_xml`;
      const mk = this.mod.ccall!.bind(this.mod, mkName, 'number', ['string']) as unknown as (p: string) => number;
      const h = mk(path);
      if (h <= 0) throw new Error(`${mkName} failed`);
      this.h = h;
      return;
    }

    if (!this.initFnLegacy) throw new Error('mjw_init not available');
    const ok = this.initFnLegacy(path);
    if (ok !== 1) throw new Error('mjw_init failed');
  }

  step(n: number): void {
    if (this.haveHandleApi) {
      const stepName = `${this.handlePrefix}_step`;
      const r = this.mod.ccall?.(stepName, 'number', ['number', 'number'], [this.h, n]);
      if (r !== 1) throw new Error(`${stepName} failed`);
      return;
    }
    if (!this.stepFnLegacy) throw new Error('step function not available');
    this.stepFnLegacy(n);
  }

  term(): void {
    if (this.haveHandleApi) {
      this.mod.ccall?.(`${this.handlePrefix}_free`, null, ['number'], [this.h]);
      this.h = 0;
      return;
    }
    this.mod._mjw_term?.();
  }

  nq(): number {
    if (this.haveHandleApi) return this.mod.ccall?.(`${this.handlePrefix}_nq`, 'number', ['number'], [this.h]) as number ?? 0;
    return this.mod._mjw_nq?.() ?? 0;
  }

  // Optional pointer-based views (available if wrapper exports *_ptr)
  qposView(): Float64Array | undefined {
    const nq = this.nq();
    if (!nq) return undefined;
    const ptr = this.haveHandleApi
      ? (this.mod.ccall?.(`${this.handlePrefix}_qpos_ptr`, 'number', ['number'], [this.h]) as number)
      : ((this.mod as any)._mjw_qpos_ptr as (() => number) | undefined)?.call(this.mod);
    if (!ptr) return undefined;
    return heapViewF64(this.mod, ptr, nq);
  }

  qvelView(): Float64Array | undefined {
    const nv = this.haveHandleApi
      ? (this.mod.ccall?.(`${this.handlePrefix}_nv`, 'number', ['number'], [this.h]) as number)
      : ((this.mod as any)._mjw_nv as (() => number) | undefined)?.call(this.mod) ?? 0;
    if (!nv) return undefined;
    const ptr = this.haveHandleApi
      ? (this.mod.ccall?.(`${this.handlePrefix}_qvel_ptr`, 'number', ['number'], [this.h]) as number)
      : ((this.mod as any)._mjw_qvel_ptr as (() => number) | undefined)?.call(this.mod);
    if (!ptr) return undefined;
    return heapViewF64(this.mod, ptr, nv);
  }

  qpos0Scalar(): number | undefined {
    const fn = this.mod._mjw_qpos0;
    if (!fn) return undefined;
    return fn.call(this.mod) as unknown as number;
  }

  qvel0Scalar(): number | undefined {
    const fn = this.mod._mjw_qvel0;
    if (!fn) return undefined;
    return fn.call(this.mod) as unknown as number;
  }
}
