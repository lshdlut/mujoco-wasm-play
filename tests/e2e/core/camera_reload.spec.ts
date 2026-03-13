import { expect, test } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fsPromises from 'node:fs/promises';
import { ensureSectionExpanded, waitForViewerReady } from '../test-utils';

test.describe('align stability', () => {
  function expectedPosFromMjv(cam: any) {
    const dist = Number(cam?.distance);
    const az = Number(cam?.azimuth);
    const el = Number(cam?.elevation);
    const lookat = Array.isArray(cam?.lookat) ? cam.lookat : null;
    if (!Number.isFinite(dist) || dist <= 0) return null;
    if (!Number.isFinite(az) || !Number.isFinite(el)) return null;
    if (!lookat || lookat.length < 3) return null;
    const azRad = az * Math.PI / 180;
    const elRad = el * Math.PI / 180;
    const ca = Math.cos(azRad);
    const sa = Math.sin(azRad);
    const ce = Math.cos(elRad);
    const se = Math.sin(elRad);
    return {
      x: (Number(lookat[0]) || 0) - dist * (ce * ca),
      y: (Number(lookat[1]) || 0) - dist * (ce * sa),
      z: (Number(lookat[2]) || 0) - dist * (se),
    };
  }

  async function triggerAlignAndReadCamera(page: any) {
    const beforeSeq = await page.evaluate(() => Number((window as any).__PLAY_HOST__?.getSnapshot?.()?.align?.seq) || 0);
    await page.evaluate(() => (window as any).__PLAY_HOST__?.backend?.apply?.({ kind: 'ui', id: 'simulation.align' }));
    await page.waitForFunction((seq) => {
      const next = Number((window as any).__PLAY_HOST__?.getSnapshot?.()?.align?.seq) || 0;
      return next > (Number(seq) || 0);
    }, beforeSeq, { timeout: 60_000 });
    await page.waitForTimeout(150);
    return page.evaluate(() => {
      const ctx = (window as any).__renderCtx;
      const cam = ctx?.camera;
      const alignCam = (window as any).__PLAY_HOST__?.getSnapshot?.()?.align?.camera ?? null;
      if (!cam) return null;
      return {
        pos: { x: Number(cam.position?.x) || 0, y: Number(cam.position?.y) || 0, z: Number(cam.position?.z) || 0 },
        alignCamera: alignCam,
      };
    });
  }

  test('Align view is stable across joint translation', async ({ page }) => {
    test.setTimeout(180_000);

    const url = `/index.html?model=raj&ver=3.5.0&snapshot=1&log=1`;
    await waitForViewerReady(page, url, { timeoutMs: 120_000 });

    const posA = await triggerAlignAndReadCamera(page);
    expect(posA).toBeTruthy();
    expect(posA.alignCamera).toBeTruthy();
    const expectedA = expectedPosFromMjv(posA.alignCamera);
    expect(expectedA).toBeTruthy();
    const da =
      Math.abs(Number(expectedA!.x) - Number(posA.pos.x)) +
      Math.abs(Number(expectedA!.y) - Number(posA.pos.y)) +
      Math.abs(Number(expectedA!.z) - Number(posA.pos.z));
    expect(da).toBeLessThan(1e-3);

    const moved = await page.evaluate(async () => {
      const snap: any = (window as any).__PLAY_HOST__?.getSnapshot?.();
      const names: any = snap?.jnt_names;
      const adr: any = snap?.jnt_qposadr;
      if (!Array.isArray(names) || !adr) {
        return { ok: false, reason: 'missing joint meta' };
      }
      const j = names.findIndex((name: any) => String(name) === 'pelvis_tx');
      if (j < 0) {
        return { ok: false, reason: 'pelvis_tx not found' };
      }
      const qposIndex = (adr[j] | 0);
      if (!(qposIndex >= 0)) {
        return { ok: false, reason: 'invalid qpos index' };
      }

      const range: any = snap?.jnt_range;
      let lo = -1;
      let hi = 1;
      if (range && typeof range.length === 'number' && range.length >= (j * 2 + 2)) {
        const rLo = Number(range[j * 2]) || 0;
        const rHi = Number(range[j * 2 + 1]) || 0;
        if (Number.isFinite(rLo) && Number.isFinite(rHi) && rHi > rLo) {
          lo = rLo;
          hi = rHi;
        }
      }
      const target = lo + (hi - lo) * 0.75;

      const backend = (window as any).__PLAY_HOST__?.backend;
      if (!backend?.apply) return { ok: false, reason: 'backend unavailable' };
      await backend.apply({ kind: 'ui', id: 'joint.slider', value: { index: qposIndex, value: target, min: lo, max: hi } });
      return { ok: true, qposIndex, target };
    });
    expect(moved.ok, moved.reason).toBeTruthy();

    await page.waitForTimeout(400);

    const posB = await triggerAlignAndReadCamera(page);
    expect(posB).toBeTruthy();
    expect(posB.alignCamera).toBeTruthy();

    const dx = Math.abs(Number(posA.pos.x) - Number(posB.pos.x));
    const dy = Math.abs(Number(posA.pos.y) - Number(posB.pos.y));
    const dz = Math.abs(Number(posA.pos.z) - Number(posB.pos.z));
    expect(dx + dy + dz).toBeLessThan(1e-3);
  });
});

test.describe('model switch camera reset', () => {
  function expectedPosFromMjv(cam: any) {
    const dist = Number(cam?.distance);
    const az = Number(cam?.azimuth);
    const el = Number(cam?.elevation);
    const lookat = Array.isArray(cam?.lookat) ? cam.lookat : null;
    if (!Number.isFinite(dist) || dist <= 0) return null;
    if (!Number.isFinite(az) || !Number.isFinite(el)) return null;
    if (!lookat || lookat.length < 3) return null;
    const azRad = az * Math.PI / 180;
    const elRad = el * Math.PI / 180;
    const ca = Math.cos(azRad);
    const sa = Math.sin(azRad);
    const ce = Math.cos(elRad);
    const se = Math.sin(elRad);
    return {
      x: (Number(lookat[0]) || 0) - dist * (ce * ca),
      y: (Number(lookat[1]) || 0) - dist * (ce * sa),
      z: (Number(lookat[2]) || 0) - dist * (se),
    };
  }

  test('switching builtin model resets camera via load-align', async ({ page }) => {
    test.setTimeout(180_000);

    await waitForViewerReady(page, '/index.html?model=raj&ver=3.5.0&snapshot=1&log=0', { timeoutMs: 120_000 });
    await ensureSectionExpanded(page, 'file');

    // Ensure renderer has seen align seq > 1, so a worker restart would normally wrap.
    await page.evaluate(() => (window as any).__PLAY_HOST__?.backend?.apply?.({ kind: 'ui', id: 'simulation.align' }));
    await page.waitForFunction(() => {
      const seq = Number((window as any).__PLAY_HOST__?.getSnapshot?.()?.align?.seq) || 0;
      return seq >= 2;
    }, { timeout: 60_000 });

    const before = await page.evaluate(() => {
      const snapshot = (window as any).__PLAY_HOST__?.getSnapshot?.() || null;
      const alignTs = Number(snapshot?.align?.timestamp) || 0;
      const ctx = (window as any).__renderCtx;
      const cam = ctx?.camera;
      return {
        ts: alignTs,
        pos: cam ? { x: Number(cam.position?.x) || 0, y: Number(cam.position?.y) || 0, z: Number(cam.position?.z) || 0 } : null,
      };
    });
    expect(before.pos).toBeTruthy();

    await page.evaluate(() => {
      const select = document.querySelector('[data-testid="file.model_select"]');
      if (!(select instanceof HTMLSelectElement)) throw new Error('file.model_select not found');
      const opt = Array.from(select.options).find((o) => (o.textContent || '').includes('humanoid/humanoid'));
      if (!opt) throw new Error('humanoid/humanoid option not found');
      select.value = opt.value;
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });

    await page.waitForFunction(() => {
      const label = (window as any).__viewerStore?.get()?.shell?.modelLabel || '';
      return String(label) === 'humanoid/humanoid';
    }, { timeout: 120_000 });

    await page.waitForFunction((prevTs) => {
      const a = (window as any).__PLAY_HOST__?.getSnapshot?.()?.align;
      if (!a) return false;
      const ts = Number(a.timestamp) || 0;
      return a.source === 'load' && !!a.camera && ts > (Number(prevTs) || 0);
    }, before.ts, { timeout: 120_000 });

    await page.waitForTimeout(200);

    const after = await page.evaluate(() => {
      const snapshot = (window as any).__PLAY_HOST__?.getSnapshot?.() || null;
      const alignCam = snapshot?.align?.camera ?? null;
      const ctx = (window as any).__renderCtx;
      const cam = ctx?.camera;
      return {
        pos: cam ? { x: Number(cam.position?.x) || 0, y: Number(cam.position?.y) || 0, z: Number(cam.position?.z) || 0 } : null,
        alignCamera: alignCam,
      };
    });
    expect(after.pos).toBeTruthy();
    expect(after.alignCamera).toBeTruthy();

    const expected = expectedPosFromMjv(after.alignCamera);
    expect(expected).toBeTruthy();
    const d =
      Math.abs(Number(expected!.x) - Number(after.pos!.x)) +
      Math.abs(Number(expected!.y) - Number(after.pos!.y)) +
      Math.abs(Number(expected!.z) - Number(after.pos!.z));
    expect(d).toBeLessThan(1e-3);

    const moved =
      Math.abs(Number(before.pos!.x) - Number(after.pos!.x)) +
      Math.abs(Number(before.pos!.y) - Number(after.pos!.y)) +
      Math.abs(Number(before.pos!.z) - Number(after.pos!.z));
    expect(moved).toBeGreaterThan(1e-2);
  });
});

test.describe('model switch reset', () => {
  const fs = fsPromises;

  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);

  const MODEL = 'mujoco_Rajagopal2015_simple.xml';
  const FORGE_BASE = '/dist/3.4.0/';

  test('loading a new xml resets timer and registers dropdown entry', async ({ page }) => {
    const url =
      `/?model=${encodeURIComponent(MODEL)}` +
      `&mode=worker&snapshot=1&log=0` +
      `&forgeBase=${encodeURIComponent(FORGE_BASE)}`;
    await waitForViewerReady(page, url);

    await ensureSectionExpanded(page, 'file');

    await page.waitForTimeout(700);
    const beforeTime = await page.evaluate(() => Number((window as any).__PLAY_HOST__?.getSnapshot?.()?.t) || 0);
    expect(beforeTime).toBeGreaterThan(0);

    const pendulumPath = path.join(__dirname, '..', '..', 'fixtures', 'pendulum.xml');
    const xmlText = await fs.readFile(pendulumPath, 'utf8');
    await page.evaluate(async ({ xml, label }) => {
      const controls = (window as any).__viewerControls;
      if (!controls?.loadXmlTextAsModel) throw new Error('Missing __viewerControls.loadXmlTextAsModel');
      await controls.loadXmlTextAsModel(xml, label);
    }, { xml: xmlText, label: 'pendulum.xml' });

    const optionTexts = await page.evaluate(() => {
      const select = document.querySelector('[data-testid="file.model_select"]');
      if (!(select instanceof HTMLSelectElement)) return [];
      return Array.from(select.options).map((opt) => opt.textContent || '');
    });
    expect(optionTexts.join('\n')).toContain('pendulum.xml');

    // Timer should drop near zero shortly after reload.
    await page.waitForFunction(() => {
      const t = Number((window as any).__PLAY_HOST__?.getSnapshot?.()?.t);
      return Number.isFinite(t) && t < 0.1;
    }, { timeout: 10_000 });
  });
});
