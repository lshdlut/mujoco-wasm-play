import { expect, test } from '@playwright/test';
import { waitForViewerReady } from './test-utils';

const TEST_MODEL = 'demo_box.xml';
// For local testing we always talk to the freshly built forge artifacts
// served from this repo under dev/dist/<ver>/.
const FORGE_BASE = '/dist/3.3.7/';

test.setTimeout(180_000);

function readPhysicsOptions() {
  const store = (window as any).__viewerStore;
  const state = store?.get ? store.get() : null;
  const opt = state?.model?.opt || {};
  const optSupport = state?.model?.optSupport || null;
  const snap = (window as any).__lastSnapshot;
  const options = (snap && (snap as any).options) || {};
  return {
    support: optSupport,
    store: {
      integrator: opt.integrator,
      cone: opt.cone,
      jacobian: opt.jacobian,
      solver: opt.solver,
    },
    snapshot: {
      integrator: (options as any).integrator,
      cone: (options as any).cone,
      jacobian: (options as any).jacobian,
      solver: (options as any).solver,
      timestep: (options as any).timestep,
      iterations: (options as any).iterations,
    },
  };
}

function readPhysicsFlags() {
  const store = (window as any).__viewerStore;
  const state = store?.get ? store.get() : null;
  const opt = state?.model?.opt || {};
  const physics = state?.physics || {};
  const snap = (window as any).__lastSnapshot;
  const options = (snap && (snap as any).options) || {};
  return {
    storeMask: {
      disable: (opt as any).disableflags,
      enable: (opt as any).enableflags,
      disableactuator: (opt as any).disableactuator,
    },
    snapshotMask: {
      disable: (options as any).disableflags,
      enable: (options as any).enableflags,
      disableactuator: (options as any).disableactuator,
    },
    physics: {
      disableFlags: (physics as any).disableFlags || {},
      enableFlags: (physics as any).enableFlags || {},
      actuatorGroups: (physics as any).actuatorGroups || {},
    },
  };
}

test('physics mjOption dropdowns edit underlying options', async ({ page }) => {
  const url =
    `/index.html?model=${encodeURIComponent(TEST_MODEL)}` +
    `&mode=worker&snapshot=1` +
    `&forgeBase=${encodeURIComponent(FORGE_BASE)}`;

  await waitForViewerReady(page, url);

  await page.waitForFunction(() => {
    const ids = ['physics.integrator', 'physics.cone', 'physics.jacobian', 'physics.solver', 'physics.iterations'];
    return ids.every((id) => !!document.querySelector(`[data-testid="${id}"]`));
  });

  // 控件必须不是 disabled（可编辑）
  const enabledState = await page.evaluate(() => {
    const byId = (id: string) => {
      const el = document.querySelector(`select[data-testid="${id}"]`) as HTMLSelectElement | null;
      return !!el && !el.disabled;
    };
    return {
      integrator: byId('physics.integrator'),
      cone: byId('physics.cone'),
      jacobian: byId('physics.jacobian'),
      solver: byId('physics.solver'),
    };
  });
  expect(enabledState.integrator).toBeTruthy();
  expect(enabledState.cone).toBeTruthy();
  expect(enabledState.jacobian).toBeTruthy();
  expect(enabledState.solver).toBeTruthy();

  const before = await page.evaluate(readPhysicsOptions);
  // eslint-disable-next-line no-console
  console.log('[physics-options-before]', JSON.stringify(before));

  // 初始时，数值型 algorithmic 参数也应当在 DOM 中反映出当前 mjOption 值（包括 0）
  const iterationsDom = await page.evaluate(() => {
    const el = document.querySelector('[data-testid="physics.iterations"]') as HTMLInputElement | null;
    return el ? el.value : '';
  });
  expect(iterationsDom).toBe(String(before.snapshot.iterations ?? before.store.iterations ?? ''));

  // 选择一组非默认的组合（直接触发 DOM 事件，避免可见性 Heuristic 干扰）
  await page.evaluate(() => {
    const apply = (id: string, text: string) => {
      const select = document.querySelector(`select[data-testid="${id}"]`) as HTMLSelectElement | null;
      if (!select) throw new Error(`missing select: ${id}`);
      const target = Array.from(select.options).find((opt) => opt.text === text);
      if (!target) throw new Error(`missing option: ${id} -> ${text}`);
      select.value = target.value;
      select.dispatchEvent(new Event('change', { bubbles: true }));
    };
    apply('physics.integrator', 'implicitfast');
    apply('physics.cone', 'Elliptic');
    apply('physics.jacobian', 'Sparse');
    apply('physics.solver', 'CG');
  });

  try {
    await expect.poll(async () => {
      return page.evaluate(readPhysicsOptions);
    }, { timeout: 30_000, intervals: [250] }).toMatchObject({
      store: { integrator: 3, cone: 1, jacobian: 1, solver: 1 },
      snapshot: { integrator: 3, cone: 1, jacobian: 1, solver: 1 },
    });
  } catch (err) {
    const diag = await page.evaluate(readPhysicsOptions);
    // eslint-disable-next-line no-console
    console.log('[physics-options-diag]', JSON.stringify(diag));
    throw err;
  }

  const after = await page.evaluate(readPhysicsOptions);
  // eslint-disable-next-line no-console
  console.log('[physics-options-after]', JSON.stringify(after));

  // 确认 forge 构建报告 mjOption 指针存在
  expect(after.support).not.toBeNull();
  expect(after.support!.supported).toBeTruthy();

  // 确认四个枚举字段在前端 state 和 worker 快照中都落到了期望枚举索引
  expect(after.store.integrator).toBe(3);
  expect(after.snapshot.integrator).toBe(3);
  expect(after.store.cone).toBe(1);
  expect(after.snapshot.cone).toBe(1);
  expect(after.store.jacobian).toBe(1);
  expect(after.snapshot.jacobian).toBe(1);
  expect(after.store.solver).toBe(1);
  expect(after.snapshot.solver).toBe(1);

  // 至少有一个字段发生了变化（避免完全偶然与初值相同）
  expect(
    after.store.integrator !== before.store.integrator ||
      after.store.cone !== before.store.cone ||
      after.store.jacobian !== before.store.jacobian ||
      after.store.solver !== before.store.solver,
  ).toBeTruthy();
});

test('physics disable/enable flags and actuator groups update mjOption bitmasks', async ({ page }) => {
  const url =
    `/index.html?model=${encodeURIComponent(TEST_MODEL)}` +
    `&mode=worker&snapshot=1` +
    `&forgeBase=${encodeURIComponent(FORGE_BASE)}`;

  await waitForViewerReady(page, url);

  await page.waitForFunction(() => {
    const ids = [
      'physics.disable_flags.Gravity',
      'physics.enable_flags.Energy',
      'physics.actuator_group_0',
    ];
    return ids.every((id) => !!document.querySelector(`[data-testid="${id}"]`));
  });

  const initial = await page.evaluate(readPhysicsFlags);
  // eslint-disable-next-line no-console
  console.log('[physics-flags-initial]', JSON.stringify(initial));

  const bitGravity = 1 << 7;
  const bitEnergy = 1 << 1;
  const bitAct0 = 1 << 0;

  expect(typeof initial.snapshotMask.disable).toBe('number');
  expect(typeof initial.snapshotMask.enable).toBe('number');
  expect(typeof initial.snapshotMask.disableactuator).toBe('number');

  expect(initial.physics.disableFlags.Gravity).toBe(
    !!(initial.snapshotMask.disable! & bitGravity),
  );
  expect(initial.physics.enableFlags.Energy).toBe(
    !!(initial.snapshotMask.enable! & bitEnergy),
  );
  expect(initial.physics.actuatorGroups['Act Group 0']).toBe(
    !(initial.snapshotMask.disableactuator! & bitAct0),
  );

  const targetDisable = !initial.physics.disableFlags.Gravity;
  const targetEnable = !initial.physics.enableFlags.Energy;
  const targetAct = !initial.physics.actuatorGroups['Act Group 0'];

  await page.evaluate(
    ({ targetDisable, targetEnable, targetAct }) => {
      const setChecked = (id: string, target: boolean) => {
        const input = document.querySelector(`[data-testid="${id}"]`) as HTMLInputElement | null;
        if (!input) throw new Error(`missing checkbox: ${id}`);
        if (input.checked !== target) {
          input.click();
        }
      };
      setChecked('physics.disable_flags.Gravity', targetDisable);
      setChecked('physics.enable_flags.Energy', targetEnable);
      setChecked('physics.actuator_group_0', targetAct);
    },
    { targetDisable, targetEnable, targetAct },
  );

  await expect.poll(async () => {
    return page.evaluate(readPhysicsFlags);
  }, { timeout: 30_000, intervals: [250] }).toMatchObject({
    physics: {
      disableFlags: { Gravity: targetDisable },
      enableFlags: { Energy: targetEnable },
      actuatorGroups: { 'Act Group 0': targetAct },
    },
    snapshotMask: {
      disable: expect.any(Number),
      enable: expect.any(Number),
      disableactuator: expect.any(Number),
    },
    storeMask: {
      disable: expect.any(Number),
      enable: expect.any(Number),
      disableactuator: expect.any(Number),
    },
  });

  const after = await page.evaluate(readPhysicsFlags);

  expect(after.physics.disableFlags.Gravity).toBe(targetDisable);
  expect(after.physics.enableFlags.Energy).toBe(targetEnable);
  expect(after.physics.actuatorGroups['Act Group 0']).toBe(targetAct);

  expect(typeof after.storeMask.disable).toBe('number');
  expect(typeof after.snapshotMask.disable).toBe('number');
  expect(typeof after.storeMask.enable).toBe('number');
  expect(typeof after.snapshotMask.enable).toBe('number');
  expect(typeof after.storeMask.disableactuator).toBe('number');
  expect(typeof after.snapshotMask.disableactuator).toBe('number');

  expect(!!(after.storeMask.disable! & bitGravity)).toBe(after.physics.disableFlags.Gravity);
  expect(!!(after.snapshotMask.disable! & bitGravity)).toBe(after.physics.disableFlags.Gravity);

  expect(!!(after.storeMask.enable! & bitEnergy)).toBe(after.physics.enableFlags.Energy);
  expect(!!(after.snapshotMask.enable! & bitEnergy)).toBe(after.physics.enableFlags.Energy);

  expect(!!(after.storeMask.disableactuator! & bitAct0)).toBe(!after.physics.actuatorGroups['Act Group 0']);
  expect(!!(after.snapshotMask.disableactuator! & bitAct0)).toBe(
    !after.physics.actuatorGroups['Act Group 0'],
  );
});
