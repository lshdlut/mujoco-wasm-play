import { expect, test } from '@playwright/test';
import { ensureSectionExpanded, waitForViewerReady } from '../test-utils';

test.describe('physics options and dynamic sections', () => {
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
});

test.describe('dynamic slider relink', () => {
  async function setRunState(page: any, run: boolean) {
    await page.evaluate(async (nextRun) => {
      const backend = (window as any).__PLAY_HOST__?.backend;
      if (!backend?.setRunState) throw new Error('backend.setRunState not available');
      await backend.setRunState(nextRun, 'test');
    }, run);
    await page.waitForFunction((nextRun) => {
      const snapshot = (window as any).__PLAY_HOST__?.getSnapshot?.() ?? null;
      return !!snapshot && snapshot.paused === !nextRun;
    }, run, { timeout: 20_000, polling: 100 });
  }

  async function clickGroupToggle(page: any, groupIndex: number) {
    await page.click(`input[type="checkbox"][data-testid="group.joint${groupIndex}"]`, { force: true });
  }

  async function switchBuiltinModel(page: any, labelFragment: string) {
    await ensureSectionExpanded(page, 'file');
    await page.evaluate((fragment) => {
      const select = document.querySelector('[data-testid="file.model_select"]');
      if (!(select instanceof HTMLSelectElement)) {
        throw new Error('file.model_select not found');
      }
      const option = Array.from(select.options).find((entry) => (entry.textContent || '').includes(fragment));
      if (!option) {
        throw new Error(`model option not found: ${fragment}`);
      }
      select.value = option.value;
      select.dispatchEvent(new Event('change', { bubbles: true }));
    }, labelFragment);
    await page.waitForFunction((fragment) => {
      const label = (window as any).__viewerStore?.get?.()?.shell?.modelLabel || '';
      return String(label).includes(fragment);
    }, labelFragment, { timeout: 120_000 });
  }

  async function setRangeValueByInput(page: any, testId: string, value: number) {
    await page.evaluate(({ nextTestId, nextValue }) => {
      const slider = document.querySelector(`input[type="range"][data-testid="${nextTestId}"]`);
      if (!(slider instanceof HTMLInputElement)) {
        throw new Error(`range input not found: ${nextTestId}`);
      }
      slider.value = String(nextValue);
      slider.dispatchEvent(new Event('input', { bubbles: true }));
    }, { nextTestId: testId, nextValue: value });
  }

  test('dynamic joint sliders relink after source disappears and comes back', async ({ page }) => {
    await waitForViewerReady(page, '/index.html?model=raj&font=100');
    await setRunState(page, false);
    await ensureSectionExpanded(page, 'group');
    await ensureSectionExpanded(page, 'joint');

    await page.waitForFunction(() => {
      return document.querySelectorAll('input[type="range"][data-testid^="joint."]').length > 0;
    }, { timeout: 20_000, polling: 100 });

    const initialEnabledGroups = await page.evaluate(() => {
      const snapshot = (window as any).__PLAY_HOST__?.getSnapshot?.() ?? null;
      return Array.isArray(snapshot?.groups?.joint)
        ? snapshot.groups.joint.map((enabled: any) => !!enabled)
        : [];
    });

    const initiallyEnabledIndices = initialEnabledGroups
      .map((enabled: boolean, index: number) => (enabled ? index : -1))
      .filter((index: number) => index >= 0);

    expect(initiallyEnabledIndices.length).toBeGreaterThan(0);

    for (const groupIndex of initiallyEnabledIndices) {
      await clickGroupToggle(page, groupIndex);
    }

    await page.waitForFunction(() => {
      const snapshot = (window as any).__PLAY_HOST__?.getSnapshot?.() ?? null;
      const groups = Array.isArray(snapshot?.groups?.joint) ? snapshot.groups.joint : [];
      const allDisabled = groups.every((enabled: any) => !enabled);
      const sliderCount = document.querySelectorAll('input[type="range"][data-testid^="joint."]').length;
      return allDisabled && sliderCount === 0;
    }, { timeout: 20_000, polling: 100 });

    for (const groupIndex of initiallyEnabledIndices) {
      await clickGroupToggle(page, groupIndex);
    }

    await page.waitForFunction((expectedGroups) => {
      const snapshot = (window as any).__PLAY_HOST__?.getSnapshot?.() ?? null;
      const groups = Array.isArray(snapshot?.groups?.joint) ? snapshot.groups.joint : [];
      const sliderCount = document.querySelectorAll('input[type="range"][data-testid^="joint."]').length;
      if (!(sliderCount > 0)) return false;
      return groups.slice(0, 6).every((enabled: any, index: number) => !!enabled === !!(expectedGroups[index]));
    }, initialEnabledGroups, { timeout: 20_000, polling: 100 });

    const sliderInfo = await page.evaluate(() => {
      const slider = document.querySelector('input[type="range"][data-testid^="joint."]');
      if (!(slider instanceof HTMLInputElement)) {
        throw new Error('joint slider not found after re-enable');
      }
      const testId = String(slider.getAttribute('data-testid') || '');
      const prefix = 'joint.';
      const index = Number(testId.startsWith(prefix) ? testId.slice(prefix.length) : '-1');
      return {
        index,
        min: Number(slider.min),
        max: Number(slider.max),
        value: Number(slider.value),
      };
    });

    const target = sliderInfo.value <= ((sliderInfo.min + sliderInfo.max) / 2)
      ? sliderInfo.max
      : sliderInfo.min;

    await setRangeValueByInput(page, `joint.${sliderInfo.index}`, target);

    await page.waitForFunction(({ index, expected }) => {
      const snapshot = (window as any).__PLAY_HOST__?.getSnapshot?.() ?? null;
      if (!snapshot?.qpos) return false;
      const qposValue = Number(snapshot.qpos[index]);
      return Math.abs(qposValue - expected) < 1e-6;
    }, { index: sliderInfo.index, expected: target }, { timeout: 20_000, polling: 100 });

    await page.waitForFunction(({ index, expected }) => {
      const slider = document.querySelector(`input[type="range"][data-testid="joint.${index}"]`);
      if (!(slider instanceof HTMLInputElement)) return false;
      return Math.abs(Number(slider.value) - expected) < 1e-6;
    }, { index: sliderInfo.index, expected: target }, { timeout: 20_000, polling: 100 });

    const visibleValue = await page.evaluate((index) => {
      const slider = document.querySelector(`input[type="range"][data-testid="joint.${index}"]`);
      if (!(slider instanceof HTMLInputElement)) {
        throw new Error(`joint slider joint.${index} missing at validation`);
      }
      return Number(slider.value);
    }, sliderInfo.index);

    expect(Math.abs(visibleValue - target)).toBeLessThan(1e-6);
  });

  test('dynamic actuator sliders relink after builtin model source disappears and comes back', async ({ page }) => {
    await waitForViewerReady(page, '/index.html?model=raj&font=100&snapshot=1');
    await setRunState(page, false);
    await ensureSectionExpanded(page, 'control');

    await page.waitForFunction(() => {
      return document.querySelectorAll('input[type="range"][data-testid^="control.act."]').length > 0;
    }, { timeout: 20_000, polling: 100 });

    const actuatorBefore = await page.evaluate(() => {
      const snapshot = (window as any).__PLAY_HOST__?.getSnapshot?.() ?? null;
      const actuators = Array.isArray(snapshot?.actuators) ? snapshot.actuators : [];
      return {
        count: document.querySelectorAll('input[type="range"][data-testid^="control.act."]').length,
        metaCount: actuators.length,
      };
    });
    expect(actuatorBefore.count).toBeGreaterThan(0);
    expect(actuatorBefore.metaCount).toBeGreaterThan(0);

    await switchBuiltinModel(page, 'cards/cards');

    await page.waitForFunction(() => {
      const snapshot = (window as any).__PLAY_HOST__?.getSnapshot?.() ?? null;
      const actuators = Array.isArray(snapshot?.actuators) ? snapshot.actuators : [];
      const sliderCount = document.querySelectorAll('input[type="range"][data-testid^="control.act."]').length;
      return actuators.length === 0 && sliderCount === 0;
    }, { timeout: 120_000, polling: 100 });

    await switchBuiltinModel(page, 'raj');

    await page.waitForFunction(() => {
      const snapshot = (window as any).__PLAY_HOST__?.getSnapshot?.() ?? null;
      const actuators = Array.isArray(snapshot?.actuators) ? snapshot.actuators : [];
      const sliderCount = document.querySelectorAll('input[type="range"][data-testid^="control.act."]').length;
      return actuators.length > 0 && sliderCount > 0;
    }, { timeout: 120_000, polling: 100 });

    const sliderInfo = await page.evaluate(() => {
      const slider = document.querySelector('input[type="range"][data-testid^="control.act."]');
      if (!(slider instanceof HTMLInputElement)) {
        throw new Error('actuator slider not found after model restore');
      }
      const testId = String(slider.getAttribute('data-testid') || '');
      const prefix = 'control.act.';
      const index = Number(testId.startsWith(prefix) ? testId.slice(prefix.length) : '-1');
      return {
        index,
        testId,
        min: Number(slider.min),
        max: Number(slider.max),
        value: Number(slider.value),
      };
    });

    const target = sliderInfo.value <= ((sliderInfo.min + sliderInfo.max) / 2)
      ? sliderInfo.max
      : sliderInfo.min;

    await setRangeValueByInput(page, sliderInfo.testId, target);

    await page.waitForFunction(({ index, expected }) => {
      const snapshot = (window as any).__PLAY_HOST__?.getSnapshot?.() ?? null;
      const ctrl = Array.isArray(snapshot?.ctrl) ? snapshot.ctrl : null;
      if (!ctrl || index < 0 || index >= ctrl.length) return false;
      return Math.abs(Number(ctrl[index]) - expected) < 1e-6;
    }, { index: sliderInfo.index, expected: target }, { timeout: 20_000, polling: 100 });

    await page.waitForFunction(({ testId, expected }) => {
      const slider = document.querySelector(`input[type="range"][data-testid="${testId}"]`);
      if (!(slider instanceof HTMLInputElement)) return false;
      return Math.abs(Number(slider.value) - expected) < 1e-6;
    }, { testId: sliderInfo.testId, expected: target }, { timeout: 20_000, polling: 100 });
  });
});

test.describe('equality panel', () => {
  const RAJ_MODEL = 'mujoco_Rajagopal2015_simple.xml';
  const FORGE_BASE = '/dist/3.4.0/';

  function readEqualitySnapshot() {
    const snap = (window as any).__PLAY_HOST__?.getSnapshot?.();
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
    await ensureSectionExpanded(page, 'equality');

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
});

test.describe('group enable filtering', () => {
  async function setRunState(page: any, run: boolean) {
    await page.evaluate(async (nextRun) => {
      const backend = (window as any).__PLAY_HOST__?.backend;
      if (!backend?.setRunState) throw new Error('backend.setRunState not available');
      await backend.setRunState(nextRun, 'test');
    }, run);
    await page.waitForFunction((nextRun) => {
      const snapshot = (window as any).__PLAY_HOST__?.getSnapshot?.() ?? null;
      return !!snapshot && snapshot.paused === !nextRun;
    }, run, { timeout: 20_000, polling: 100 });
  }

  async function toggleControlById(page: any, controlId: string, value: any) {
    await page.evaluate(async ({ nextId, nextValue }) => {
      const controls = (window as any).__viewerControls;
      if (!controls?.toggleControl) throw new Error('__viewerControls.toggleControl unavailable');
      await controls.toggleControl(nextId, nextValue);
    }, { nextId: controlId, nextValue: value });
  }

  async function readJointSliderIds(page: any) {
    return page.evaluate(() =>
      Array.from(document.querySelectorAll('input[type="range"][data-testid^="joint."]'))
        .map((node) => String(node.getAttribute('data-testid') || ''))
        .sort(),
    );
  }

  async function readActuatorSliderIds(page: any) {
    return page.evaluate(() =>
      Array.from(document.querySelectorAll('input[type="range"][data-testid^="control.act."]'))
        .map((node) => String(node.getAttribute('data-testid') || ''))
        .sort(),
    );
  }

  async function setRangeValueByTestId(page: any, testId: string, value: number) {
    await page.evaluate(({ nextTestId, nextValue }) => {
      const slider = document.querySelector(`input[type="range"][data-testid="${nextTestId}"]`);
      if (!(slider instanceof HTMLInputElement)) {
        throw new Error(`range input not found: ${nextTestId}`);
      }
      slider.value = String(nextValue);
      slider.dispatchEvent(new Event('input', { bubbles: true }));
    }, { nextTestId: testId, nextValue: value });
  }

  test('joint group toggles filter the right-panel Joint section by exact MuJoCo group', async ({ page }) => {
    await waitForViewerReady(page, '/index.html?model=model/test/left_panel_groups.xml&font=100&snapshot=1');
    await setRunState(page, false);
    await ensureSectionExpanded(page, 'group');
    await ensureSectionExpanded(page, 'joint');

    await expect.poll(async () => readJointSliderIds(page), { timeout: 20_000 }).toEqual(['joint.0', 'joint.1']);

    await toggleControlById(page, 'group.joint1', false);
    await expect.poll(async () => readJointSliderIds(page), { timeout: 20_000 }).toEqual(['joint.0']);

    await toggleControlById(page, 'group.joint0', false);
    await expect.poll(async () => readJointSliderIds(page), { timeout: 20_000 }).toEqual([]);

    await toggleControlById(page, 'group.joint1', true);
    await expect.poll(async () => readJointSliderIds(page), { timeout: 20_000 }).toEqual(['joint.1']);

    await setRangeValueByTestId(page, 'joint.1', 1);
    await page.waitForFunction(() => {
      const snapshot = (window as any).__PLAY_HOST__?.getSnapshot?.() ?? null;
      return !!snapshot?.qpos && Math.abs(Number(snapshot.qpos[1]) - 1) < 1e-6;
    }, { timeout: 20_000, polling: 100 });
  });

  test('actuator group toggles filter and remake the right-panel Control section by exact MuJoCo group', async ({ page }) => {
    await waitForViewerReady(page, '/index.html?model=model/test/left_panel_groups.xml&font=100&snapshot=1');
    await setRunState(page, false);
    await ensureSectionExpanded(page, 'group');
    await ensureSectionExpanded(page, 'control');

    await expect.poll(async () => readActuatorSliderIds(page), { timeout: 20_000 }).toEqual(['control.act.0', 'control.act.1']);

    await toggleControlById(page, 'group.actuator1', false);
    await expect.poll(async () => readActuatorSliderIds(page), { timeout: 20_000 }).toEqual(['control.act.0']);

    await toggleControlById(page, 'group.actuator0', false);
    await expect.poll(async () => readActuatorSliderIds(page), { timeout: 20_000 }).toEqual([]);

    await toggleControlById(page, 'group.actuator1', true);
    await expect.poll(async () => readActuatorSliderIds(page), { timeout: 20_000 }).toEqual(['control.act.1']);

    await setRangeValueByTestId(page, 'control.act.1', 1);
    await page.waitForFunction(() => {
      const snapshot = (window as any).__PLAY_HOST__?.getSnapshot?.() ?? null;
      const ctrl = Array.isArray(snapshot?.ctrl) ? snapshot.ctrl : null;
      return !!ctrl && Math.abs(Number(ctrl[1]) - 1) < 1e-6;
    }, { timeout: 20_000, polling: 100 });
  });
});
