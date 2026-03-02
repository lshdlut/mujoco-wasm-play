import { expect, test } from '@playwright/test';
import { waitForViewerReady } from './test-utils';

const RAJ_MODEL = 'mujoco_Rajagopal2015_simple.xml';
const FORGE_BASE = '/dist/3.4.0/';

function readEqualitySnapshot() {
  const snap = (window as any).__lastSnapshot;
  if (!snap) return null;
  const eqType: any = snap.eq_type;
  const eqActive: any = snap.eq_active;
  const eqNames: any = snap.eq_names;
  return {
    hasSnapshot: true,
    eqTypeLen: eqType && typeof eqType.length === 'number' ? eqType.length : 0,
    eqActiveLen: eqActive && typeof eqActive.length === 'number' ? eqActive.length : 0,
    eqType: eqType ? Array.from(eqType as any) : [],
    eqActive: eqActive ? Array.from(eqActive as any) : [],
    eqNames: Array.isArray(eqNames) ? eqNames.slice() : null,
  };
}

function readEqualityDom() {
  const section = document.querySelector('[data-section-id="equality"]');
  if (!section) {
    return { hasSection: false, itemCount: 0 };
  }
  const body = section.querySelector('.section-body');
  const items = body ? body.querySelectorAll('[data-testid^="equality."]') : [];
  return {
    hasSection: true,
    itemCount: items.length,
  };
}

test('equality snapshot and UI plumbing for Rajagopal2015', async ({ page }) => {
  const url =
    `/index.html?model=${encodeURIComponent(RAJ_MODEL)}` +
    `&mode=worker&snapshot=1&log=0` +
    `&forgeBase=${encodeURIComponent(FORGE_BASE)}`;

  await waitForViewerReady(page, url);

  let eqSnap = await page.evaluate(readEqualitySnapshot);

  const eqDom = await page.evaluate(readEqualityDom);

  // 基本断言：Raj 模型应当有 equality 元数据
  expect(eqSnap).not.toBeNull();
  expect(eqSnap!.eqTypeLen).toBeGreaterThan(0);

  // 检查名称链路
  expect(eqSnap!.eqNames?.length || 0).toBeGreaterThan(0);

  // 点击第一个 eq 按钮，验证状态切换
  const before = eqSnap!.eqActive[0];
  await page.evaluate(() => {
    const el = document.querySelector('[data-testid="equality.0"]');
    if (!(el instanceof HTMLInputElement)) {
      throw new Error('equality.0 input not found');
    }
    el.click();
  });
  await expect.poll(async () => {
    const next = await page.evaluate(readEqualitySnapshot);
    return next?.eqActive?.[0] ?? null;
  }, { timeout: 10_000 }).not.toBe(before);
});
