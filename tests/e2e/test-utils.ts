import { Page, test } from '@playwright/test';
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
  const consoleTimeline: { wallMs: number; type: string; text: string }[] = [];
  const pendingRequests = new Map<any, any>();
  const failedRequests: any[] = [];
  const onRequest = (request: any) => pendingRequests.set(request, {
    url: request.url(), resourceType: request.resourceType(), startedWallMs: Date.now(),
  });
  const onResponse = (response: any) => {
    const pending = pendingRequests.get(response.request());
    if (pending) pending.httpStatus = response.status();
  };
  const onRequestDone = (request: any) => {
    if (request.failure()) failedRequests.push({ url: request.url(), failure: request.failure(), wallMs: Date.now() });
    if (failedRequests.length > 30) failedRequests.shift();
    pendingRequests.delete(request);
  };
  const onConsole = (msg: any) => {
    const text = msg?.text?.() || '';
    consoleTimeline.push({ wallMs: Date.now(), type: msg.type(), text });
    if (consoleTimeline.length > 30) consoleTimeline.shift();
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
  const requestContext = page.context();
  requestContext.on('request', onRequest);
  requestContext.on('response', onResponse);
  requestContext.on('requestfinished', onRequestDone);
  requestContext.on('requestfailed', onRequestDone);
  // Persist a bounded checkpoint before the unchanged 60s test deadline can close the page.
  // This is diagnostic evidence, not an extra wait/retry or a relaxed readiness condition.
  const persistCheckpoint = async () => {
    const capture = async () => {
      const state = await page.evaluate(() => {
        const host = (window as any).__PLAY_HOST__;
        const snapshot = host?.getSnapshot?.();
        return { hasHost: !!host, hasStore: !!(window as any).__viewerStore,
          hasCtx: !!(window as any).__renderCtx, ctxInitialized: !!(window as any).__renderCtx?.initialized,
          hasRuntimeConfig: !!(window as any).__PLAY_RUNTIME_CONFIG__, coi: crossOriginIsolated,
          engineVersion: snapshot?.engineVersion, loadState: snapshot?.loadState,
          scnNgeom: snapshot?.scn_ngeom, documentReadyState: document.readyState,
          resources: performance.getEntriesByType('resource').map((entry: any) => ({ name: entry.name, duration: entry.duration })) };
      });
      const browser = page.context().browser();
      let targets: any = { status: 'UNAVAILABLE_NON_CHROMIUM' };
      if (browser && typeof browser.newBrowserCDPSession === 'function') {
        const cdp = await browser.newBrowserCDPSession();
        try {
          targets = (await cdp.send('Target.getTargets')).targetInfos.filter((target: any) => target.type.includes('worker'));
        } finally {
          await cdp.detach();
        }
      }
      return { state, workerTargets: targets, pageWorkers: page.workers().map(worker => worker.url()) };
    };
    const captured = await Promise.race([
      capture().catch(error => ({ diagnosticError: String(error) })),
      new Promise(resolve => setTimeout(() => resolve({ diagnosticError: 'Checkpoint capture exceeded 2s budget' }), 2000)),
    ]);
    const record = { url, wallMs: Date.now(), pendingRequests: [...pendingRequests.values()], failedRequests, consoleTimeline, consoleErrors, pageErrors, captured };
    const file = test.info().outputPath('viewer-ready-checkpoint.json');
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, JSON.stringify(record, null, 2));
    await test.info().attach('viewer-ready-checkpoint', { path: file, contentType: 'application/json' });
    console.log('VIEWER_READY_CHECKPOINT', JSON.stringify(record));
  };
  const checkpointTimer = setTimeout(() => {
    void persistCheckpoint().catch(error => console.error('VIEWER_READY_CHECKPOINT_ERROR', String(error)));
  }, 40000);
  const cleanup = () => {
    clearTimeout(checkpointTimer);
    page.off('console', onConsole); page.off('pageerror', onPageError);
    requestContext.off('request', onRequest); requestContext.off('response', onResponse);
    requestContext.off('requestfinished', onRequestDone); requestContext.off('requestfailed', onRequestDone);
  };
  const timeout = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 60_000;
  const normalizedUrl =
    typeof url === 'string' && url.startsWith('/index.html')
      ? `/${url.slice('/index.html'.length)}`
      : url;
  try {
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
        cleanup();
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
    cleanup();
    throw new Error(`Viewer did not become ready within ${timeout} ms: ${JSON.stringify({ diag, consoleErrors, pageErrors })}`);
  } finally {
    cleanup();
  }
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
