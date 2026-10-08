import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const source = fs.readFileSync(new URL('../../app/viewer_shell.js', import.meta.url), 'utf8');
const entry = fs.readFileSync(new URL('../../pthreads/index.html', import.meta.url), 'utf8');
const fallback = entry.match(/data-play-shell-fallback-href="([^"]+)"/)[1];

for (const baseURI of ['https://lshdlut.github.io/mujoco-wasm-play/', 'http://localhost:4397/', 'https://lshdlut.com/play/']) {
  test(`COI refusal retains the single-thread mount at ${baseURI}`, () => {
    assert.match(entry, /<base href="\.\.\/"/);
    const appended = [];
    const document = {
      baseURI,
      currentScript: { dataset: { playShellRequireCoi: '1', playShellFallbackHref: fallback } },
      documentElement: { getAttribute: () => null },
      body: { appendChild: element => appended.push(element) },
      createElement: tag => ({ tag, style: {} }),
    };
    vm.runInNewContext(source, { document, URL, crossOriginIsolated: false });
    assert.equal(appended.length, 1);
    assert.equal(appended[0].tag, 'main');
    assert.ok(appended[0].innerHTML.includes(`<code>${baseURI}index.html</code>`));
    assert.match(appended[0].innerHTML, /requires cross-origin isolation/);
  });
}
