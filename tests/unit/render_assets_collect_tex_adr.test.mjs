import test from 'node:test';
import assert from 'node:assert/strict';

import { collectRenderAssetsFromModule } from '../../bridge/render_assets_collect.mjs';

function makeFakeForgeModule({ texAdrKind, ver }) {
  const dataLen = 4_748_592;
  const ntex = 2;

  const typePtr = 0x1000;
  const widthPtr = 0x1100;
  const heightPtr = 0x1200;
  const nchannelPtr = 0x1300;
  const adrPtr = 0x1500;
  const colorspacePtr = 0x1400;
  const dataPtr = 0x2000;

  const minBytes = dataPtr + dataLen + 1024;
  const pages = Math.ceil(minBytes / 65536);
  const memory = new WebAssembly.Memory({ initial: Math.max(1, pages) });
  const buffer = memory.buffer;
  const dv = new DataView(buffer);

  // Two textures: (0) cube skybox 512x3072x3 at adr 0; (1) 2D plane 100x100x3.
  dv.setInt32(typePtr + 0, 2, true);
  dv.setInt32(typePtr + 4, 0, true);

  dv.setInt32(widthPtr + 0, 512, true);
  dv.setInt32(widthPtr + 4, 100, true);

  dv.setInt32(heightPtr + 0, 3072, true);
  dv.setInt32(heightPtr + 4, 100, true);

  dv.setInt32(nchannelPtr + 0, 3, true);
  dv.setInt32(nchannelPtr + 4, 3, true);

  dv.setInt32(colorspacePtr + 0, 0, true);
  dv.setInt32(colorspacePtr + 4, 0, true);

  const planeAdr = 4_718_592;
  if (texAdrKind === 'i32') {
    dv.setInt32(adrPtr + 0, 0, true);
    dv.setInt32(adrPtr + 4, planeAdr, true);
  } else if (texAdrKind === 'i64') {
    dv.setBigInt64(adrPtr + 0, 0n, true);
    dv.setBigInt64(adrPtr + 8, BigInt(planeAdr), true);
  } else {
    throw new Error(`Unknown texAdrKind: ${texAdrKind}`);
  }

  const overrides = {
    _mjwf_model_ntex: () => ntex,
    _mjwf_model_ntexdata: () => dataLen,
    _mjwf_model_tex_data_ptr: () => dataPtr,
    _mjwf_model_tex_type_ptr: () => typePtr,
    _mjwf_model_tex_width_ptr: () => widthPtr,
    _mjwf_model_tex_height_ptr: () => heightPtr,
    _mjwf_model_tex_nchannel_ptr: () => nchannelPtr,
    _mjwf_model_tex_adr_ptr: () => adrPtr,
    _mjwf_model_tex_colorspace_ptr: () => colorspacePtr,
  };

  const base = {
    __mujocoVer: String(ver || ''),
    wasmExports: { memory },
    HEAPU8: new Uint8Array(buffer),
  };

  return new Proxy(base, {
    get(target, prop) {
      if (typeof prop === 'string' && prop in overrides) return overrides[prop];
      if (typeof prop === 'string' && prop.startsWith('_mjwf_')) return () => 0;
      return target[prop];
    },
  });
}

test('bridge: collectRenderAssetsFromModule accepts int32 tex_adr', () => {
  const mod = makeFakeForgeModule({ texAdrKind: 'i32', ver: '3.4.0' });
  const assets = collectRenderAssetsFromModule(mod, 1);
  assert.ok(assets?.textures);
  assert.equal(assets.textures.count, 2);
  assert.ok(assets.textures.adr instanceof Int32Array);
  assert.deepEqual(Array.from(assets.textures.adr), [0, 4_718_592]);
});

test('bridge: collectRenderAssetsFromModule reads int64 tex_adr (mjtSize)', () => {
  const mod = makeFakeForgeModule({ texAdrKind: 'i64', ver: '3.5.0' });
  const assets = collectRenderAssetsFromModule(mod, 1);
  assert.ok(assets?.textures);
  assert.equal(assets.textures.count, 2);
  assert.ok(assets.textures.adr instanceof Int32Array);
  assert.deepEqual(Array.from(assets.textures.adr), [0, 4_718_592]);
});
