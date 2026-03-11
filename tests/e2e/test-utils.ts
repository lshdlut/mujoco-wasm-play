import { Page } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';

export async function readCurrentSnapshot(page: Page) {
  return page.evaluate(() => {
    const hostSnapshot = (window as any).__PLAY_HOST__?.getSnapshot?.();
    return hostSnapshot ?? null;
  });
}

export async function ensureSectionExpanded(page: Page, sectionId: string) {
  const rootSelector = `[data-testid="section-${sectionId}"]`;
  await page.waitForFunction((sid) => {
    const root = document.querySelector(`[data-testid="section-${sid}"]`);
    const btn = root?.querySelector('.section-toggle');
    return !!btn;
  }, sectionId);
  await page.evaluate((sid) => {
    const root = document.querySelector(`[data-testid="section-${sid}"]`);
    if (!root) throw new Error(`section not found: ${sid}`);
    const btn = root.querySelector('.section-toggle');
    if (!(btn instanceof HTMLButtonElement)) throw new Error(`section toggle not found: ${sid}`);
    if (root.classList.contains('is-collapsed')) {
      btn.click();
    }
  }, sectionId);
}

export async function waitForViewerReady(
  page: Page,
  url = '/index.html?model=model/mujoco_Rajagopal2015_simple.xml',
  { timeoutMs = 60_000 }: { timeoutMs?: number } = {},
) {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  const onConsole = (msg: any) => {
    const text = msg?.text?.() || '';
    if (msg?.type?.() === 'error') {
      consoleErrors.push(text);
      if (consoleErrors.length > 10) consoleErrors.shift();
    }
  };
  const onPageError = (err: Error) => {
    pageErrors.push(err?.stack || String(err));
    if (pageErrors.length > 10) pageErrors.shift();
  };
  page.on('console', onConsole);
  page.on('pageerror', onPageError);
  const timeout = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 60_000;
  const normalizedUrl =
    typeof url === 'string' && url.startsWith('/index.html')
      ? `/${url.slice('/index.html'.length)}`
      : url;
  await page.goto(normalizedUrl as string, { waitUntil: 'load', timeout });
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const diag = await page.evaluate(() => {
      const store = (window as any).__viewerStore;
      const ctx = (window as any).__renderCtx;
      const controls = (window as any).__viewerControls;
      const snapshot = (window as any).__PLAY_HOST__?.getSnapshot?.() ?? null;
      const scnNgeom = Number(snapshot?.scn_ngeom) | 0;
      return {
        ready: !!ctx?.initialized && !!store?.get && !!controls && scnNgeom > 0,
        hasStore: !!store?.get,
        hasCtx: !!ctx,
        ctxInitialized: !!ctx?.initialized,
        hasControls: !!controls,
        hasHost: !!(window as any).__PLAY_HOST__,
        hasRuntimeConfig: !!(window as any).__PLAY_RUNTIME_CONFIG__,
        scnNgeom,
        ngeom: Number(snapshot?.ngeom) | 0,
        hasModelSelect: !!document.querySelector('[data-testid="file.model_select"]'),
      };
    });
    if (diag.ready) {
      page.off('console', onConsole);
      page.off('pageerror', onPageError);
      return;
    }
    await page.waitForTimeout(100);
  }
  const diag = await page.evaluate(() => {
    const snapshot = (window as any).__PLAY_HOST__?.getSnapshot?.() ?? null;
    return {
      hasStore: !!(window as any).__viewerStore?.get,
      hasCtx: !!(window as any).__renderCtx,
      ctxInitialized: !!(window as any).__renderCtx?.initialized,
      hasControls: !!(window as any).__viewerControls,
      hasHost: !!(window as any).__PLAY_HOST__,
      hasRuntimeConfig: !!(window as any).__PLAY_RUNTIME_CONFIG__,
      scnNgeom: Number(snapshot?.scn_ngeom) | 0,
      ngeom: Number(snapshot?.ngeom) | 0,
      bodyClass: document.body?.className || '',
      hasModelSelect: !!document.querySelector('[data-testid="file.model_select"]'),
    };
  }).catch(() => null);
  page.off('console', onConsole);
  page.off('pageerror', onPageError);
  throw new Error(`Viewer did not become ready within ${timeout} ms: ${JSON.stringify({ diag, consoleErrors, pageErrors })}`);
}

export async function loadXmlFromFileInput(page: Page, filePath: string) {
  const handle = await page.$('[data-testid="file.load_xml_input"]');
  if (!handle) throw new Error('file.load_xml_input not found');
  const buffer = await fs.readFile(filePath);
  await handle.setInputFiles({
    name: path.basename(filePath),
    mimeType: 'text/xml',
    buffer,
  }, { noWaitAfter: true });
}

export function firstVisibleGeomSummary() {
  const ctx = (window as any).__renderCtx;
  if (!ctx?.meshes) return null;
  const mesh = ctx.meshes.find(
    (m) => m?.visible && m.userData && m.userData.geomIndex >= 0 && !m.userData.infinitePlane,
  );
  if (!mesh) return null;
  return {
    materialType: mesh.material?.type,
    hasSegmentMaterial: !!mesh.userData.segmentMaterial,
    geomIndex: mesh.userData.geomIndex,
  };
}
