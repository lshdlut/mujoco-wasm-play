import { expect, test } from '@playwright/test';
import { waitForViewerReady } from './test-utils';

const MODEL = 'mujoco_Rajagopal2015_simple.xml';
const FORGE_BASE = '/dist/3.4.0/';

type Stats = {
  n: number;
  r: { min: number | null; max: number | null; mean: number | null };
  g: { min: number | null; max: number | null; mean: number | null };
  b: { min: number | null; max: number | null; mean: number | null };
  a: { min: number | null; max: number | null; mean: number | null };
};

function summarize(values: number[]) {
  if (!values.length) return { min: null, max: null, mean: null };
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  let sum = 0;
  for (const v of values) {
    if (v < min) min = v;
    if (v > max) max = v;
    sum += v;
  }
  return { min, max, mean: sum / values.length };
}

test('raj site/tendon scn_rgba ranges', async ({ page }) => {
  const url =
    `/?model=${encodeURIComponent(MODEL)}` +
    `&mode=worker&snapshot=1&log=0` +
    `&forgeBase=${encodeURIComponent(FORGE_BASE)}`;
  await waitForViewerReady(page, url);

  const diag = await page.evaluate(() => {
    const MJ_OBJ_SITE = 6;
    const MJ_OBJ_TENDON = 18;
    const snap: any = (window as any).__lastSnapshot || null;
    if (!snap) return { ok: false, reason: 'no snapshot' };
    const n = Number(snap.scn_ngeom) | 0;
    const objType: any = snap.scn_objtype || null;
    const rgba: any = snap.scn_rgba || null;
    if (!objType || !rgba || rgba.length < n * 4) return { ok: false, reason: 'missing scn_objtype/scn_rgba' };

    const out = {
      ok: true,
      n,
      site: { r: [], g: [], b: [], a: [] } as any,
      tendon: { r: [], g: [], b: [], a: [] } as any,
      siteGtypes: Object.create(null) as Record<string, number>,
      tendonGtypes: Object.create(null) as Record<string, number>,
    };
    const gtype: any = snap.scn_type || null;

    for (let si = 0; si < n; si += 1) {
      const ot = objType[si] | 0;
      if (ot !== MJ_OBJ_SITE && ot !== MJ_OBJ_TENDON) continue;
      const base = si * 4;
      const r = Number(rgba[base + 0]) || 0;
      const g = Number(rgba[base + 1]) || 0;
      const b = Number(rgba[base + 2]) || 0;
      const a = Number(rgba[base + 3]) || 0;
      const dst = ot === MJ_OBJ_SITE ? out.site : out.tendon;
      dst.r.push(r);
      dst.g.push(g);
      dst.b.push(b);
      dst.a.push(a);
      if (gtype) {
        const gt = gtype[si] | 0;
        const map = ot === MJ_OBJ_SITE ? out.siteGtypes : out.tendonGtypes;
        const key = String(gt);
        map[key] = (map[key] || 0) + 1;
      }
    }
    return out;
  });

  expect(diag.ok).toBeTruthy();

  const siteR = summarize(diag.site.r);
  const siteG = summarize(diag.site.g);
  const siteB = summarize(diag.site.b);
  const siteA = summarize(diag.site.a);
  const tendonR = summarize(diag.tendon.r);
  const tendonG = summarize(diag.tendon.g);
  const tendonB = summarize(diag.tendon.b);
  const tendonA = summarize(diag.tendon.a);

  const siteStats: Stats = { n: diag.site.r.length, r: siteR, g: siteG, b: siteB, a: siteA };
  const tendonStats: Stats = { n: diag.tendon.r.length, r: tendonR, g: tendonG, b: tendonB, a: tendonA };

  // eslint-disable-next-line no-console
  console.log('[raj] site scn_rgba stats', siteStats, 'gtypes', diag.siteGtypes);
  // eslint-disable-next-line no-console
  console.log('[raj] tendon scn_rgba stats', tendonStats, 'gtypes', diag.tendonGtypes);

  expect(siteStats.n).toBeGreaterThan(0);
  expect(tendonStats.n).toBeGreaterThan(0);
});

