import { Page } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';

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
  url = '/index.html?model=demo_box.xml',
  { timeoutMs = 60_000 }: { timeoutMs?: number } = {},
) {
  const timeout = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 60_000;
  const normalizedUrl =
    typeof url === 'string' && url.startsWith('/index.html')
      ? `/${url.slice('/index.html'.length)}`
      : url;
  await page.goto(normalizedUrl as string, { waitUntil: 'load', timeout });
  await page.waitForFunction(() => {
    const store = (window as any).__viewerStore;
    const ctx = (window as any).__renderCtx;
    const controls = (window as any).__viewerControls;
    const snap = (window as any).__lastSnapshot;
    const scnNgeom = Number(snap?.scn_ngeom) | 0;
    return !!ctx?.initialized && !!store?.get && !!controls && scnNgeom > 0;
  }, { timeout });
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
