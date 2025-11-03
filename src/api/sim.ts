import type { MujocoModule } from '../wasm/loader.js';
import { heapViewF64 } from '../wasm/loader.js';

export class MjSim {
  private h: number = 0;

  constructor(private mod: MujocoModule) {}

  initFromXml(xmlText: string, path = '/model.xml'): void {
    if (!this.mod.FS) throw new Error('Runtime FS not available');
    const bytes = new TextEncoder().encode(xmlText);
    this.mod.FS.writeFile(path, bytes);

    const mk = (this.mod as any).ccall?.bind(this.mod) ?? null;
    let h = 0;
    if (typeof (this.mod as any)._mjwf_make_from_xml === 'function') {
      try { h = (this.mod as any)._mjwf_make_from_xml(path) | 0; } catch { h = 0; }
    }
    if (!(h > 0) && mk) {
      try { h = mk('mjwf_make_from_xml','number',['string'],[path]) | 0; } catch { h = 0; }
    }
    if (!(h > 0)) throw new Error('mjwf_make_from_xml failed');
    this.h = h;
  }

  step(n: number): void {
    const m: any = this.mod; const h = this.h|0;
    if (typeof m._mjwf_step === 'function') {
      const r = m._mjwf_step(h, n|0) | 0; if (r !== 1) throw new Error('mjwf_step failed'); return;
    }
    const r = this.mod.ccall?.('mjwf_step','number',['number','number'],[h, n|0]) as number;
    if ((r|0) !== 1) throw new Error('mjwf_step failed');
  }

  term(): void {
    const m: any = this.mod; const h = this.h|0;
    if (h) {
      try { if (typeof m._mjwf_free === 'function') m._mjwf_free(h); else this.mod.ccall?.('mjwf_free', null, ['number'], [h]); } catch {}
    }
    this.h = 0;
  }

  nq(): number {
    const m: any = this.mod; const h = this.h|0;
    if (typeof m._mjwf_nq === 'function') return (m._mjwf_nq(h) | 0) || 0;
    try { return (this.mod.ccall?.('mjwf_nq','number',['number'],[h]) as number|undefined) ?? 0; } catch { return 0; }
  }

  // Optional pointer-based views (require *_ptr exports)
  qposView(): Float64Array | undefined {
    const m: any = this.mod; const h = this.h|0; const nq = this.nq(); if (!nq) return undefined;
    let ptr = 0; if (typeof m._mjwf_qpos_ptr === 'function') { try { ptr = m._mjwf_qpos_ptr(h)|0; } catch { ptr = 0; } }
    if (!ptr) return undefined; return heapViewF64(this.mod, ptr, nq);
  }

  qvelView(): Float64Array | undefined {
    const m: any = this.mod; const h = this.h|0; let nv = 0; if (typeof m._mjwf_nv === 'function') nv = (m._mjwf_nv(h)|0); if (!nv) return undefined;
    let ptr = 0; if (typeof m._mjwf_qvel_ptr === 'function') { try { ptr = m._mjwf_qvel_ptr(h)|0; } catch { ptr = 0; } }
    if (!ptr) return undefined; return heapViewF64(this.mod, ptr, nv);
  }
}
