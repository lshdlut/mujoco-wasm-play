import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const vectorStub = `export class Vector4 {
  constructor(x=0,y=0,z=0,w=0) { this.set(x,y,z,w); }
  set(x,y,z,w) { Object.assign(this,{x,y,z,w}); return this; }
  copy(v) { return this.set(v.x,v.y,v.z,v.w); }
}`;
const source = await fs.readFile(new URL('../../renderer/mujoco_shadows.mjs', import.meta.url), 'utf8');
const stubUrl = `data:text/javascript;base64,${Buffer.from(vectorStub).toString('base64')}`;
const { installMuJoCoShadowViewportInset } = await import(`data:text/javascript;base64,${Buffer.from(source.replace("'three'", JSON.stringify(stubUrl))).toString('base64')}`);

for (const [name, viewport] of [['DPR drawing buffer', [0, 0, 3200, 1920]], ['render target', [7, 11, 800, 600]]]) {
  test(`shadow inset restores ${name} without querying GPU`, () => {
    const applied = [];
    const renderer = {
      getContext() { throw new Error('GPU query is forbidden'); },
      getCurrentViewport(target) { return target.set(...viewport); },
      state: { viewport(v) { applied.push([v.x, v.y, v.z, v.w]); } },
      shadowMap: { render() { renderer.state.viewport({ x: 0, y: 0, z: 1024, w: 1024 }); return 42; } },
    };
    assert.equal(installMuJoCoShadowViewportInset(renderer), true);
    assert.equal(installMuJoCoShadowViewportInset(renderer), false);
    assert.equal(renderer.shadowMap.render(), 42);
    assert.deepEqual(applied, [[1, 1, 1022, 1022], viewport]);
  });
}

test('failed shadow pass still restores viewport and stops insetting ordinary viewport calls', () => {
  const applied = [];
  const renderer = {
    getCurrentViewport(target) { return target.set(0, 0, 1600, 960); },
    state: { viewport(v) { applied.push([v.x, v.y, v.z, v.w]); } },
    shadowMap: { render() { throw new Error('shadow failed'); } },
  };
  installMuJoCoShadowViewportInset(renderer);
  assert.throws(() => renderer.shadowMap.render(), /shadow failed/);
  renderer.state.viewport({ x: 2, y: 3, z: 10, w: 20 });
  assert.deepEqual(applied, [[0, 0, 1600, 960], [2, 3, 10, 20]]);
});
