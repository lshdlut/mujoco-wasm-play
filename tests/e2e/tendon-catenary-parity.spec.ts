import { expect, test } from '@playwright/test';
import { waitForViewerReady } from './test-utils';

const MODEL = 'model/tendon_catenary/catenary.xml';
const FORGE_BASE = '/dist/3.3.7/';

function sceneTendonCounts() {
  const MJ_OBJ_TENDON = 18;
  const snap = (window as any).__lastSnapshot || null;
  const n = Number(snap?.scn_ngeom) | 0;
  const objType = snap?.scn_objtype || null;
  const objId = snap?.scn_objid || null;
  if (!snap || !(n > 0) || !objType || !objId) return { ok: false };
  const counts = new Map<number, number>();
  for (let i = 0; i < n; i += 1) {
    if ((objType[i] | 0) !== MJ_OBJ_TENDON) continue;
    const id = objId[i] | 0;
    counts.set(id, (counts.get(id) || 0) + 1);
  }
  if (counts.size === 0) return { ok: false };
  let bestId = -1;
  let bestCount = 0;
  for (const [id, count] of counts.entries()) {
    if (count > bestCount) {
      bestId = id;
      bestCount = count;
    }
  }
  return { ok: true, tendonId: bestId, count: bestCount };
}

test('tendon catenary collapses to straight segments when gravity disabled', async ({ page }) => {
  const url =
    `/?model=${encodeURIComponent(MODEL)}` +
    `&mode=worker&snapshot=1&log=0` +
    `&forgeBase=${encodeURIComponent(FORGE_BASE)}`;
  await waitForViewerReady(page, url);

  // Ensure gravity is enabled before we check the catenary path.
  const disableGravity = page.locator('[data-testid="physics.disable_flags.Gravity"]');
  await disableGravity.evaluate((el) => {
    const input = el as HTMLInputElement;
    if (input.checked) input.click();
  });

  await expect.poll(async () => {
    return page.evaluate(sceneTendonCounts);
  }, { timeout: 30_000, intervals: [250] }).toMatchObject({ ok: true });

  const initial = await page.evaluate(sceneTendonCounts);
  const tendonId = (initial as any).tendonId as number;

  await expect.poll(async () => {
    return page.evaluate(sceneTendonCounts);
  }, { timeout: 30_000, intervals: [250] }).toMatchObject({ ok: true, tendonId, count: expect.any(Number) });

  await page.waitForFunction((id: number) => {
    const MJ_OBJ_TENDON = 18;
    const v = (window as any).__lastSnapshot || null;
    const n = Number(v?.scn_ngeom) | 0;
    const objType = v?.scn_objtype || null;
    const objId = v?.scn_objid || null;
    if (!v || !(n > 0) || !objType || !objId) return false;
    let total = 0;
    for (let i = 0; i < n; i += 1) {
      if ((objType[i] | 0) !== MJ_OBJ_TENDON) continue;
      if ((objId[i] | 0) !== (id | 0)) continue;
      total += 1;
    }
    return total > 1;
  }, tendonId, { timeout: 30_000, polling: 250 });

  // Disable gravity; catenary should collapse to a single segment.
  await disableGravity.evaluate((el) => {
    const input = el as HTMLInputElement;
    if (!input.checked) input.click();
  });

  await page.waitForFunction((id: number) => {
    const MJ_OBJ_TENDON = 18;
    const v = (window as any).__lastSnapshot || null;
    const n = Number(v?.scn_ngeom) | 0;
    const objType = v?.scn_objtype || null;
    const objId = v?.scn_objid || null;
    if (!v || !(n > 0) || !objType || !objId) return false;
    let total = 0;
    for (let i = 0; i < n; i += 1) {
      if ((objType[i] | 0) !== MJ_OBJ_TENDON) continue;
      if ((objId[i] | 0) !== (id | 0)) continue;
      total += 1;
    }
    return total === 1;
  }, tendonId, { timeout: 30_000, polling: 250 });
});
