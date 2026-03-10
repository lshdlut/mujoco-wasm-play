import { expect, test } from '@playwright/test';
import { ensureSectionExpanded, waitForViewerReady } from './test-utils';

const TEST_MODEL = 'raj';
const TEST_VER = '3.5.0';
const DYNAMIC_TEST_MODEL = 'mujoco_Rajagopal2015_simple.xml';
const STATIC_MINIMAL_XML = `
<mujoco model="static_minimal">
  <worldbody>
    <geom type="plane" size="2 2 0.1"/>
    <body pos="0 0 0.1">
      <geom type="box" size="0.05 0.05 0.05"/>
    </body>
  </worldbody>
</mujoco>
`;

test.setTimeout(180_000);

function readPhysicsOptions() {
  const snap = (window as any).__PLAY_HOST__?.getSnapshot?.() ?? null;
  const options = (snap && (snap as any).options) || {};
  const support = (snap && (snap as any).optionSupport) || null;
  return {
    support,
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
  const snap = (window as any).__PLAY_HOST__?.getSnapshot?.() ?? null;
  const options = (snap && (snap as any).options) || {};
  const readChecked = (id: string) => {
    const el = document.querySelector(`[data-testid="${id}"]`) as HTMLInputElement | null;
    return !!el?.checked;
  };
  return {
    snapshotMask: {
      disable: (options as any).disableflags,
      enable: (options as any).enableflags,
      disableactuator: (options as any).disableactuator,
    },
    controls: {
      disableGravity: readChecked('physics.disable_flags.Gravity'),
      enableEnergy: readChecked('physics.enable_flags.Energy'),
      actuatorGroup0: readChecked('physics.actuator_group_0'),
    },
  };
}

test('physics mjOption dropdowns edit underlying options', async ({ page }) => {
  const url =
    `/index.html?model=${encodeURIComponent(DYNAMIC_TEST_MODEL)}` +
    `&mode=worker&snapshot=1&log=0&ver=${encodeURIComponent(TEST_VER)}`;

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

  // 初始时，数值型 algorithmic 参数也应当在 DOM 中反映出当前 mjOption 值（包括 0）
  const iterationsDom = await page.evaluate(() => {
    const el = document.querySelector('[data-testid="physics.iterations"]') as HTMLInputElement | null;
    return el ? el.value : '';
  });
  expect(iterationsDom).toBe(String(before.snapshot.iterations ?? ''));

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
      snapshot: { integrator: 3, cone: 1, jacobian: 1, solver: 1 },
    });
  } catch (err) {
    const diag = await page.evaluate(readPhysicsOptions);
    throw new Error(`physics options did not converge: ${JSON.stringify(diag)}`, { cause: err });
  }

  const after = await page.evaluate(readPhysicsOptions);

  // 确认 forge 构建报告 mjOption 指针存在
  expect(after.support).not.toBeNull();
  expect(after.support!.supported).toBeTruthy();

  // 确认四个枚举字段在 worker 快照中都落到了期望枚举索引
  expect(after.snapshot.integrator).toBe(3);
  expect(after.snapshot.cone).toBe(1);
  expect(after.snapshot.jacobian).toBe(1);
  expect(after.snapshot.solver).toBe(1);

  // 至少有一个字段发生了变化（避免完全偶然与初值相同）
  expect(
    after.snapshot.integrator !== before.snapshot.integrator ||
      after.snapshot.cone !== before.snapshot.cone ||
      after.snapshot.jacobian !== before.snapshot.jacobian ||
      after.snapshot.solver !== before.snapshot.solver,
  ).toBeTruthy();
});

test('physics disable/enable flags and actuator groups update mjOption bitmasks', async ({ page }) => {
  const url =
    `/index.html?model=${encodeURIComponent(TEST_MODEL)}` +
    `&snapshot=1&ver=${encodeURIComponent(TEST_VER)}`;

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

  const bitGravity = 1 << 7;
  const bitEnergy = 1 << 1;
  const bitAct0 = 1 << 0;

  expect(typeof initial.snapshotMask.disable).toBe('number');
  expect(typeof initial.snapshotMask.enable).toBe('number');
  expect(typeof initial.snapshotMask.disableactuator).toBe('number');

  expect(initial.controls.disableGravity).toBe(!!(initial.snapshotMask.disable! & bitGravity));
  expect(initial.controls.enableEnergy).toBe(!!(initial.snapshotMask.enable! & bitEnergy));
  expect(initial.controls.actuatorGroup0).toBe(!(initial.snapshotMask.disableactuator! & bitAct0));

  const targetDisable = !initial.controls.disableGravity;
  const targetEnable = !initial.controls.enableEnergy;
  const targetAct = !initial.controls.actuatorGroup0;

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
    controls: {
      disableGravity: targetDisable,
      enableEnergy: targetEnable,
      actuatorGroup0: targetAct,
    },
    snapshotMask: {
      disable: expect.any(Number),
      enable: expect.any(Number),
      disableactuator: expect.any(Number),
    },
  });

  const after = await page.evaluate(readPhysicsFlags);

  expect(after.controls.disableGravity).toBe(targetDisable);
  expect(after.controls.enableEnergy).toBe(targetEnable);
  expect(after.controls.actuatorGroup0).toBe(targetAct);

  expect(typeof after.snapshotMask.disable).toBe('number');
  expect(typeof after.snapshotMask.enable).toBe('number');
  expect(typeof after.snapshotMask.disableactuator).toBe('number');

  expect(!!(after.snapshotMask.disable! & bitGravity)).toBe(after.controls.disableGravity);

  expect(!!(after.snapshotMask.enable! & bitEnergy)).toBe(after.controls.enableEnergy);

  expect(!!(after.snapshotMask.disableactuator! & bitAct0)).toBe(
    !after.controls.actuatorGroup0,
  );
});

test('viewer host and dynamic right-panel controls initialize without pageerror', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (err) => {
    pageErrors.push(err?.stack || String(err));
    if (pageErrors.length > 10) pageErrors.shift();
  });

  const url =
    `/index.html?model=${encodeURIComponent(TEST_MODEL)}` +
    `&snapshot=1&ver=${encodeURIComponent(TEST_VER)}`;

  await waitForViewerReady(page, url);

  await ensureSectionExpanded(page, 'control');
  await ensureSectionExpanded(page, 'joint');
  await ensureSectionExpanded(page, 'equality');

  await expect.poll(async () => {
    return page.evaluate(() => {
      const snapshot = (window as any).__PLAY_HOST__?.getSnapshot?.() ?? null;
      return {
        hasHost: !!(window as any).__PLAY_HOST__,
        hasControls: !!(window as any).__viewerControls,
        scnNgeom: Number(snapshot?.scn_ngeom) | 0,
        actuatorCount: document.querySelectorAll('[data-testid^="control.act."]').length,
        jointCount: document.querySelectorAll('[data-testid^="joint."]').length,
        equalityCount: document.querySelectorAll('[data-testid^="equality."]').length,
      };
    });
  }, { timeout: 20_000, intervals: [200] }).toMatchObject({
      hasHost: true,
      hasControls: true,
  });

  const state = await page.evaluate(() => {
    const snapshot = (window as any).__PLAY_HOST__?.getSnapshot?.() ?? null;
    return {
      scnNgeom: Number(snapshot?.scn_ngeom) | 0,
      actuatorCount: document.querySelectorAll('[data-testid^="control.act."]').length,
      jointCount: document.querySelectorAll('[data-testid^="joint."]').length,
      equalityCount: document.querySelectorAll('[data-testid^="equality."]').length,
      hasEqualitySection: !!document.querySelector('[data-testid="section-equality"]'),
    };
  });

  expect(state.scnNgeom).toBeGreaterThan(0);
  expect(state.actuatorCount).toBeGreaterThan(0);
  expect(state.jointCount).toBeGreaterThan(0);
  expect(state.hasEqualitySection).toBeTruthy();
  expect(pageErrors).toEqual([]);
});

test('dynamic right-panel controls clear when switching to a model without them', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (err) => {
    pageErrors.push(err?.stack || String(err));
    if (pageErrors.length > 10) pageErrors.shift();
  });

  const url =
    `/index.html?model=${encodeURIComponent(TEST_MODEL)}` +
    `&snapshot=1&ver=${encodeURIComponent(TEST_VER)}`;

  await waitForViewerReady(page, url);

  await ensureSectionExpanded(page, 'control');
  await ensureSectionExpanded(page, 'joint');
  await ensureSectionExpanded(page, 'equality');

  await expect.poll(async () => {
    return page.evaluate(() => ({
      actuatorCount: document.querySelectorAll('[data-testid^="control.act."]').length,
      jointCount: document.querySelectorAll('[data-testid^="joint."]').length,
      equalityCount: document.querySelectorAll('[data-testid^="equality."]').length,
    }));
  }, { timeout: 20_000, intervals: [200] }).toMatchObject({
    actuatorCount: expect.any(Number),
    jointCount: expect.any(Number),
    equalityCount: expect.any(Number),
  });

  const countsBefore = await page.evaluate(() => ({
    actuatorCount: document.querySelectorAll('[data-testid^="control.act."]').length,
    jointCount: document.querySelectorAll('[data-testid^="joint."]').length,
    equalityCount: document.querySelectorAll('[data-testid^="equality."]').length,
  }));
  expect(countsBefore.actuatorCount).toBeGreaterThan(0);
  expect(countsBefore.jointCount).toBeGreaterThan(0);
  expect(countsBefore.equalityCount).toBeGreaterThan(0);

  await page.evaluate(async (xmlText) => {
    const controls = (window as any).__viewerControls;
    if (!controls?.loadXmlTextAsModel) throw new Error('Missing __viewerControls.loadXmlTextAsModel');
    await controls.loadXmlTextAsModel(xmlText, 'static_minimal.xml');
  }, STATIC_MINIMAL_XML);

  await expect.poll(async () => {
    return page.evaluate(() => {
      const snapshot = (window as any).__PLAY_HOST__?.getSnapshot?.() ?? null;
      return {
        scnNgeom: Number(snapshot?.scn_ngeom) | 0,
        actuatorCount: document.querySelectorAll('[data-testid^="control.act."]').length,
        jointCount: document.querySelectorAll('[data-testid^="joint."]').length,
        equalityCount: document.querySelectorAll('[data-testid^="equality."]').length,
      };
    });
  }, { timeout: 20_000, intervals: [200] }).toMatchObject({
    scnNgeom: expect.any(Number),
    actuatorCount: 0,
    jointCount: 0,
    equalityCount: 0,
  });

  expect(pageErrors).toEqual([]);
});

test('collapsed dynamic sections rebuild from current model when opened later', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (err) => {
    pageErrors.push(err?.stack || String(err));
    if (pageErrors.length > 10) pageErrors.shift();
  });

  const url =
    `/index.html?model=${encodeURIComponent(TEST_MODEL)}` +
    `&snapshot=1&ver=${encodeURIComponent(TEST_VER)}`;

  await waitForViewerReady(page, url);

  await page.evaluate(async (xmlText) => {
    const controls = (window as any).__viewerControls;
    if (!controls?.loadXmlTextAsModel) throw new Error('Missing __viewerControls.loadXmlTextAsModel');
    await controls.loadXmlTextAsModel(xmlText, 'static_minimal.xml');
  }, STATIC_MINIMAL_XML);

  await ensureSectionExpanded(page, 'control');
  await ensureSectionExpanded(page, 'joint');
  await ensureSectionExpanded(page, 'equality');

  await expect.poll(async () => {
    return page.evaluate(() => ({
      actuatorCount: document.querySelectorAll('[data-testid^="control.act."]').length,
      jointCount: document.querySelectorAll('[data-testid^="joint."]').length,
      equalityCount: document.querySelectorAll('[data-testid^="equality."]').length,
    }));
  }, { timeout: 20_000, intervals: [200] }).toMatchObject({
    actuatorCount: 0,
    jointCount: 0,
    equalityCount: 0,
  });

  expect(pageErrors).toEqual([]);
});

