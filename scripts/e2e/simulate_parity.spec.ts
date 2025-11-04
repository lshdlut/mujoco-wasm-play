import { test, expect } from "@playwright/test";

async function gotoViewer(page: import("@playwright/test").Page) {
  page.on("console", (msg) => {
    console.log(`[browser:${msg.type()}] ${msg.text()}`);
  });
  page.on("requestfailed", (req) => {
    console.log(`[browser:requestfailed] ${req.url()} status=${req.failure()?.errorText}`);
  });
  page.on("pageerror", (err) => {
    console.log(`[browser:pageerror] ${err?.message || err}`);
    if (err?.stack) {
      console.log(`[browser:pageerror:stack] ${err.stack}`);
    }
  });
  await page.goto("/index.html", { waitUntil: "load" });
  await expect(page.locator("[data-testid=viewer-canvas]")).toBeVisible({ timeout: 15000 });
  await page.waitForFunction(
    () => {
      const store = (window as any).__viewerStore;
      if (!store || typeof store.get !== "function") return false;
      const state = store.get();
      if (!state) return false;
      const ngeom = state.hud?.ngeom ?? 0;
      const vopt = Array.isArray(state.rendering?.voptFlags) ? state.rendering.voptFlags.length : 0;
      const scene = Array.isArray(state.rendering?.sceneFlags) ? state.rendering.sceneFlags.length : 0;
      return ngeom > 0 && vopt > 0 && scene > 0;
    },
    undefined,
    { timeout: 15000 }
  );
}

test.describe("simulate parity", () => {
  test.beforeEach(async ({ page }) => {
    await gotoViewer(page);
  });

  test("function keys toggle overlays", async ({ page }) => {
    await page.keyboard.press("F1");
    await expect(page.locator("[data-testid=overlay-help]")).toBeVisible();
    await page.keyboard.press("F2");
    await expect(page.locator("[data-testid=overlay-info]")).toBeVisible();
    await page.keyboard.press("F3");
    await expect(page.locator("[data-testid=overlay-profiler]")).toBeVisible();
    await page.keyboard.press("F4");
    await expect(page.locator("[data-testid=overlay-sensor]")).toBeVisible();
    await page.keyboard.press("F5");
    await expect(page.locator("body.fullscreen")).toBeVisible();
    await page.keyboard.press("F5");
  });

  test("transport hotkeys", async ({ page }) => {
    const hud = page.locator("[data-testid=sim-time]");
    const initial = await hud.textContent();
    await page.waitForTimeout(300);
    await expect(await hud.textContent()).not.toEqual(initial);

    await page.keyboard.press("Space"); // pause
    await page.waitForTimeout(50);
    const paused = await hud.textContent();
    await page.waitForTimeout(250);
    expect(await hud.textContent()).toEqual(paused);

    await page.keyboard.press("ArrowRight");
    await expect.poll(async () => await hud.textContent(), { message: "step forward updates time" }).not.toEqual(paused);
    await page.keyboard.press("ArrowLeft");
  });

  test("camera & ui toggles", async ({ page }) => {
    const leftPanel = page.locator("[data-testid=panel-left]");
    const rightPanel = page.locator("[data-testid=panel-right]");
    await page.keyboard.press("Tab");
    await expect(leftPanel).toBeHidden();
    await page.keyboard.press("Tab");
    await expect(leftPanel).toBeVisible();
    await page.keyboard.press("Shift+Tab");
    await expect(rightPanel).toBeHidden();
    await page.keyboard.press("Shift+Tab");
    await expect(rightPanel).toBeVisible();
    await page.keyboard.press("]");
    await expect(page.locator("[data-testid=camera-summary]")).toContainText(/Fixed|Tracking/);
  });

  test("left panel actions", async ({ page }) => {
    const helpToggle = page.locator('[data-testid="option.help"]');
    await helpToggle.click();
    await expect(page.locator("[data-testid=overlay-help]")).toBeVisible();

    await page.locator('[data-testid="simulation.reset"]').click();
    await expect(page.locator("[data-testid=toast]")).toContainText(/reset/i);

    const constraintToggle = page.locator('[data-testid="physics.disable_flags.Constraint"]');
    await constraintToggle.click();
    await expect(constraintToggle).toBeChecked();

    const alignButton = page.locator('[data-testid="simulation.align"]');
    const alignSeq = await page.evaluate(
      () => window.__viewerStore?.get().runtime.lastAlign?.seq ?? 0
    );
    await alignButton.click();
    await expect
      .poll(async () => page.evaluate(() => window.__viewerStore?.get().runtime.lastAlign?.seq))
      .toBeGreaterThan(alignSeq);
    await expect(page.locator("[data-testid=toast]")).toContainText(/align/i);

    const copyButton = page.locator('[data-testid="simulation.copy_state"]');
    const initialCopySeq = await page.evaluate(
      () => window.__viewerStore?.get().runtime.lastCopy?.seq ?? 0
    );
    await copyButton.click();
    await expect
      .poll(async () => page.evaluate(() => window.__viewerStore?.get().runtime.lastCopy?.seq))
      .toBeGreaterThan(initialCopySeq);
    await expect
      .poll(async () => page.evaluate(() => window.__viewerStore?.get().runtime.lastCopy?.precision))
      .toBe("standard");
    await expect
      .poll(
        async () =>
          page.evaluate(() => window.__viewerStore?.get().runtime.lastCopy?.qposPreview?.length ?? 0)
      )
      .toBeGreaterThan(0);

    const shiftSeq = await page.evaluate(
      () => window.__viewerStore?.get().runtime.lastCopy?.seq ?? 0
    );
    await copyButton.click({ modifiers: ["Shift"] });
    await expect
      .poll(async () => page.evaluate(() => window.__viewerStore?.get().runtime.lastCopy?.seq))
      .toBeGreaterThan(shiftSeq);
    await expect
      .poll(async () => page.evaluate(() => window.__viewerStore?.get().runtime.lastCopy?.precision))
      .toBe("full");
  });

  test("rendering toggles push backend state", async ({ page }) => {
    const targets = await page.evaluate(() => {
      const helper = window.__viewerControls;
      const store = window.__viewerStore?.get();
      if (!helper || !store) return [];
      const voptLength = Array.isArray(store.rendering?.voptFlags)
        ? store.rendering.voptFlags.length
        : 0;
      const sceneLength = Array.isArray(store.rendering?.sceneFlags)
        ? store.rendering.sceneFlags.length
        : 0;

      const collect = (prefix, kind) => {
        const ids = helper.listIds?.(prefix) ?? [];
        return ids
          .map((id) => {
            const binding = helper.getBinding?.(id) ?? null;
            if (typeof binding !== "string") return null;
            const match = /\[(\d+)\]/.exec(binding);
            const index = match ? Number(match[1]) : -1;
            if (index < 0) return null;
            if (kind === "vopt" && !binding.startsWith("mjvOption::flags")) return null;
            if (kind === "scene" && !binding.startsWith("mjvScene::flags")) return null;
            if (kind === "vopt" && index >= voptLength) return null;
            if (kind === "scene" && index >= sceneLength) return null;
            const initial =
              kind === "vopt"
                ? !!store.rendering?.voptFlags?.[index]
                : !!store.rendering?.sceneFlags?.[index];
            return { id, kind, index, initial };
          })
          .filter((entry) => entry !== null);
      };
      const model = collect("rendering.model_flags.", "vopt")
        .filter((entry) => entry.initial === false)
        .slice(0, 12);
      const scene = collect("rendering.opengl_flags.", "scene")
        .filter((entry) => entry.initial === false)
        .slice(0, 12);
      return [...model, ...scene];
    });

    expect(targets.length).toBeGreaterThanOrEqual(10);

    const resolveChecked = async (id: string) => {
      const wrapper = page.locator(`[data-testid="${id}"]`);
      await expect(wrapper).toBeVisible();
      const probe = wrapper.locator('input[type="checkbox"], input[type="radio"]');
      if (await probe.count()) {
        return {
          wrapper,
          input: probe.first(),
        };
      }
      return { wrapper, input: wrapper };
    };

    for (const target of targets) {
      const { wrapper, input } = await resolveChecked(target.id);
      const pollFlag = (expected: boolean) => {
        if (target.kind === "vopt") {
          return expect
            .poll(
              async () =>
                page.evaluate(
                  ({ idx }) => window.__viewerStore?.get().rendering.voptFlags[idx],
                  { idx: target.index }
                ),
              { message: `vopt flag ${target.index} mismatch` }
            )
            .toBe(expected);
        }
        return expect
          .poll(
            async () =>
              page.evaluate(
                ({ idx }) => window.__viewerStore?.get().rendering.sceneFlags[idx],
                { idx: target.index }
              ),
            { message: `scene flag ${target.index} mismatch` }
          )
          .toBe(expected);
      };

      const setChecked = async (value: boolean) => {
        const current = await input.isChecked();
        if (current !== value) {
          await wrapper.click();
        }
        await pollFlag(value);
      };

      await setChecked(true);
      await setChecked(false);
    }

    const cameraSelect = page.locator('[data-testid="rendering.camera_mode"]');
    await cameraSelect.selectOption("1");
    await expect
      .poll(async () => page.evaluate(() => window.__viewerStore?.get().runtime.cameraIndex))
      .toBe(1);
  });

  test("mouse gestures", async ({ page }) => {
    await page.evaluate(() => {
      window.__dispatchPointer = (type, opts = {}) => {
        const canvas = document.querySelector('[data-testid="viewer-canvas"]');
        if (!canvas) return;
        const rect = canvas.getBoundingClientRect();
        const baseX = rect.left + rect.width / 2;
        const baseY = rect.top + rect.height / 2;
        const pointerId = 73;
        const event = new PointerEvent(type, {
          pointerId,
          pointerType: 'mouse',
          clientX: baseX + (opts.dx ?? 0),
          clientY: baseY + (opts.dy ?? 0),
          buttons: opts.buttons ?? 1,
          shiftKey: !!opts.shiftKey,
          ctrlKey: !!opts.ctrlKey,
          bubbles: true,
        });
        canvas.dispatchEvent(event);
      };
    });

    await page.evaluate(() => {
      window.__dispatchPointer?.('pointerdown', { shiftKey: true });
      window.__dispatchPointer?.('pointermove', { shiftKey: true, dx: 120, dy: 60 });
    });
    await expect
      .poll(
        async () => page.evaluate(() => window.__viewerStore?.get().runtime.lastAction),
        { timeout: 2000 }
      )
      .toBe("translate");
    await page.evaluate(() => {
      window.__dispatchPointer?.('pointerup', { shiftKey: true, dx: 120, dy: 60, buttons: 0 });
    });
    await expect
      .poll(
        async () => page.evaluate(() => window.__viewerStore?.get().runtime.gesture.mode),
        { timeout: 2000 }
      )
      .toBe("idle");

    await page.evaluate(() => {
      window.__dispatchPointer?.('pointerdown', { ctrlKey: true });
      window.__dispatchPointer?.('pointermove', { ctrlKey: true, dx: 0, dy: -80 });
    });
    await expect
      .poll(
        async () => page.evaluate(() => window.__viewerStore?.get().runtime.lastAction),
        { timeout: 2000 }
      )
      .toBe("rotate");
    await page.evaluate(() => {
      window.__dispatchPointer?.('pointerup', { ctrlKey: true, dx: 0, dy: -80, buttons: 0 });
    });
    await expect
      .poll(
        async () => page.evaluate(() => window.__viewerStore?.get().runtime.gesture.mode),
        { timeout: 2000 }
      )
      .toBe("idle");
    await expect(page.locator("[data-testid=perturb-state]")).toContainText(/translate|rotate/);
  });
});
