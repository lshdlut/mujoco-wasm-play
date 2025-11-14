import type { MujocoModule } from '../wasm/loader.js';
import { heapViewF64 } from '../wasm/loader.js';

const MJ_STATE_INTEGRATION = 0x1fff;

export class MjSim {
  private h: number = 0;
  private modelPtr = 0;
  private dataPtr = 0;

  constructor(private mod: MujocoModule) {}

  initFromXml(xmlText: string, path = '/model.xml'): void {
    const modAny = this.mod as any;
    if (this.h > 0) {
      this.term();
    }
    if (!modAny.FS) throw new Error('Runtime FS not available');
    const bytes = new TextEncoder().encode(xmlText);
    const paths = Array.from(new Set<string>(['/mem/model.xml', '/model.xml', 'model.xml', path]));
    for (const target of paths) {
      try {
        const dir = target.slice(0, target.lastIndexOf('/'));
        if (dir) {
          const segments = dir.split('/').filter(Boolean);
          let cur = '';
          for (const seg of segments) {
            cur += '/' + seg;
            try { modAny.FS.mkdir(cur); } catch {}
          }
        }
      } catch {}
      try { modAny.FS.writeFile(target, bytes); } catch {}
    }

    let h = 0;
    for (const target of paths) {
      const make = modAny.ccall?.('mjwf_helper_make_from_xml', 'number', ['string'], [target]);
      h = (make | 0) || 0;
      if (h > 0) break;
    }
    if (!(h > 0)) throw new Error('mjwf_helper_make_from_xml failed');
    this.h = h;
    this.ensurePointers();
    this.assertCounts();
  }

  private ensurePointers(): void {
    const modAny = this.mod as any;
    if (this.h <= 0) throw new Error('handle missing');
    if (!this.modelPtr && typeof modAny._mjwf_helper_model_ptr === 'function') {
      this.modelPtr = modAny._mjwf_helper_model_ptr(this.h | 0) | 0;
    }
    if (!this.dataPtr && typeof modAny._mjwf_helper_data_ptr === 'function') {
      this.dataPtr = modAny._mjwf_helper_data_ptr(this.h | 0) | 0;
    }
    if (!(this.modelPtr && this.dataPtr)) {
      throw new Error('helper pointers unavailable');
    }
  }

  private assertCounts(): void {
    const nq = this.nq();
    const nv = this.nv();
    const ng = this.ngeom();
    if (!((nq > 0 && nv > 0 && ng > 2) || (nq === 0 && nv === 0 && ng > 0))) {
      throw new Error(`invalid model counts nq=${nq}, nv=${nv}, ngeom=${ng}`);
    }
  }

  private withStack(bytes: number, work: (ptr: number) => void): boolean {
    const modAny = this.mod as any;
    if (typeof modAny.stackSave === 'function' && typeof modAny.stackAlloc === 'function' && typeof modAny.stackRestore === 'function') {
      let sp = 0;
      try { sp = modAny.stackSave(); } catch { sp = 0; }
      let ptr = 0;
      try { ptr = modAny.stackAlloc(bytes) | 0; } catch { ptr = 0; }
      if (!(ptr > 0)) {
        if (sp) {
          try { modAny.stackRestore(sp); } catch {}
        }
        return false;
      }
      try {
        work(ptr);
        return true;
      } finally {
        try { modAny.stackRestore(sp); } catch {}
      }
    }
    if (typeof modAny._malloc === 'function' && typeof modAny._free === 'function') {
      let ptr = 0;
      try { ptr = modAny._malloc(bytes) | 0; } catch { ptr = 0; }
      if (!(ptr > 0)) return false;
      try {
        work(ptr);
        return true;
      } finally {
        try { modAny._free(ptr); } catch {}
      }
    }
    return false;
  }

  private mjCall(name: string, count = 1): void {
    const modAny = this.mod as any;
    const fn = modAny[`_mjwf_mj_${name}`];
    if (typeof fn !== 'function') throw new Error(`_mjwf_mj_${name} missing`);
    this.ensurePointers();
    const n = Math.max(1, count | 0);
    for (let i = 0; i < n; i += 1) {
      fn.call(modAny, this.modelPtr | 0, this.dataPtr | 0);
    }
  }

  private readModelCount(name: string): number {
    const modAny = this.mod as any;
    const fn = modAny[`_mjwf_model_${name}`];
    if (typeof fn !== 'function') return 0;
    try { return fn.call(modAny, this.h | 0) | 0; } catch { return 0; }
  }

  private readPtr(owner: 'model' | 'data', name: string): number {
    const modAny = this.mod as any;
    const fn = modAny[`_mjwf_${owner}_${name}_ptr`];
    if (typeof fn !== 'function') return 0;
    try { return fn.call(modAny, this.h | 0) | 0; } catch { return 0; }
  }

  step(n: number): void {
    this.mjCall('step', Math.max(1, n | 0));
  }

  term(): void {
    const m: any = this.mod; const h = this.h|0;
    if (h) {
      if (typeof m._mjwf_helper_free === 'function') {
        try { m._mjwf_helper_free(h); } catch {}
      }
    }
    this.h = 0;
    this.modelPtr = 0;
    this.dataPtr = 0;
  }

  nq(): number {
    return this.readModelCount('nq');
  }

  nv(): number {
    return this.readModelCount('nv');
  }

  ngeom(): number {
    return this.readModelCount('ngeom');
  }

  // Optional pointer-based views (require *_ptr exports)
  qposView(): Float64Array | undefined {
    const nq = this.nq(); if (!nq) return undefined;
    const ptr = this.readPtr('data', 'qpos'); if (!ptr) return undefined;
    return heapViewF64(this.mod, ptr, nq);
  }

  qvelView(): Float64Array | undefined {
    const nv = this.nv(); if (!nv) return undefined;
    const ptr = this.readPtr('data', 'qvel'); if (!ptr) return undefined;
    return heapViewF64(this.mod, ptr, nv);
  }

  geomXposView(): Float64Array | undefined {
    const ng = this.ngeom(); if (!ng) return undefined;
    const ptr = this.readPtr('data', 'geom_xpos'); if (!ptr) return undefined;
    return heapViewF64(this.mod, ptr, ng * 3);
  }

  stateSize(sig = MJ_STATE_INTEGRATION): number {
    const modAny = this.mod as any;
    const fn = modAny._mjwf_mj_stateSize;
    if (typeof fn !== 'function') return 0;
    this.ensurePointers();
    try { return fn.call(modAny, this.modelPtr | 0, sig >>> 0) | 0; } catch { return 0; }
  }

  captureState(target: Float64Array | null = null, sig = MJ_STATE_INTEGRATION): Float64Array {
    const size = this.stateSize(sig);
    if (!(size > 0)) {
      return target instanceof Float64Array ? target : new Float64Array(0);
    }
    const out = target instanceof Float64Array && target.length >= size ? target : new Float64Array(size);
    const modAny = this.mod as any;
    const fn = modAny._mjwf_mj_getState;
    if (typeof fn !== 'function') return out;
    this.ensurePointers();
    const bytes = size * Float64Array.BYTES_PER_ELEMENT;
    this.withStack(bytes, (ptr) => {
      const view = heapViewF64(this.mod, ptr, size);
      try { fn.call(modAny, this.modelPtr | 0, this.dataPtr | 0, ptr | 0, sig >>> 0); } catch {}
      out.set(view);
    });
    return out;
  }

  applyState(source: ArrayLike<number>, sig = MJ_STATE_INTEGRATION): boolean {
    if (!source) return false;
    const modAny = this.mod as any;
    const fn = modAny._mjwf_mj_setState;
    if (typeof fn !== 'function') return false;
    const size = this.stateSize(sig);
    if (!(size > 0)) return false;
    const buf = source instanceof Float64Array ? source : Float64Array.from(source as any);
    if (buf.length < size) return false;
    const bytes = size * Float64Array.BYTES_PER_ELEMENT;
    this.ensurePointers();
    let ok = false;
    this.withStack(bytes, (ptr) => {
      const view = heapViewF64(this.mod, ptr, size);
      view.set(buf.subarray(0, size));
      try {
        fn.call(modAny, this.modelPtr | 0, this.dataPtr | 0, ptr | 0, sig >>> 0);
        ok = true;
      } catch {}
    });
    if (ok) {
      this.mjCall('forward');
    }
    return ok;
  }

  nkey(): number {
    return this.readModelCount('nkey');
  }

  setKeyframe(index: number): boolean {
    const modAny = this.mod as any;
    const fn = modAny._mjwf_mj_setKeyframe;
    if (typeof fn !== 'function') return false;
    this.ensurePointers();
    try {
      fn.call(modAny, this.modelPtr | 0, this.dataPtr | 0, index | 0);
      return true;
    } catch {
      return false;
    }
  }

  resetKeyframe(index: number): boolean {
    const modAny = this.mod as any;
    const fn = modAny._mjwf_mj_resetDataKeyframe;
    if (typeof fn !== 'function') return false;
    this.ensurePointers();
    try {
      fn.call(modAny, this.modelPtr | 0, this.dataPtr | 0, index | 0);
      this.mjCall('forward');
      return true;
    } catch {
      return false;
    }
  }
}
