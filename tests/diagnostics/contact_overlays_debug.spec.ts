import { test, expect } from '@playwright/test';
import fsPromises from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { waitForViewerReady } from '../e2e/test-utils';

test.describe('contact overlays debug', () => {
  const fs = fsPromises;

  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);

  async function enableContactFlagsViaControls(page: import('@playwright/test').Page) {
    await page.evaluate(async () => {
      const win: any = window;
      const controls = win.__viewerControls;
      if (!controls?.listIds || !controls.toggleControl || !controls.getControl) {
        throw new Error('__viewerControls helpers are not available');
      }
      const ids: string[] = controls.listIds('rendering.model_flags.');
      const targetIds: string[] = [];
      for (const id of ids) {
        const control = controls.getControl(id);
        if (control?.binding === 'mjvOption::flags[14]' || control?.binding === 'mjvOption::flags[16]') {
          targetIds.push(id);
        }
      }
      if (!targetIds.length) {
        throw new Error('contact vopt controls not found');
      }
      for (const id of targetIds) {
        await controls.toggleControl(id, true);
      }
    });
  }

  async function waitForContacts(page: import('@playwright/test').Page, label: string) {
    await page.waitForFunction(
      (modelLabel) => {
        const win: any = window;
        const snap = win.__PLAY_HOST__?.getSnapshot?.() ?? null;
        const contacts = snap?.contacts || null;
        const n = Number(contacts?.n ?? 0);
        const labelNow = String(win.__viewerStore?.get?.()?.shell?.modelLabel || '');
        return n > 0 && (!modelLabel || labelNow.includes(modelLabel));
      },
      label,
      { timeout: 20000 },
    );
  }

  test.describe('contact overlay snapshot debug (Raj -> humanoid)', () => {
    test('Raj and humanoid both provide contact pos/frame/force when enabled', async ({ page }) => {
      const FORGE_BASE = '/dist/3.4.0/';
      const url =
        `/index.html?model=${encodeURIComponent('mujoco_Rajagopal2015_simple.xml')}` +
        `&mode=worker&snapshot=1&log=0` +
        `&forgeBase=${encodeURIComponent(FORGE_BASE)}`;
      await waitForViewerReady(page, url);
      await enableContactFlagsViaControls(page);
      await waitForContacts(page, 'Rajagopal');

      const rajSnapshot = await page.evaluate(() => {
        const win: any = window;
        const snap = win.__PLAY_HOST__?.getSnapshot?.() ?? null;
        const dbg = win.__contactDebug || null;
        const contacts = snap?.contacts || null;
        return {
          posSample: Array.isArray(contacts?.pos)
            ? (contacts.pos as number[]).slice(0, 12)
            : (contacts?.pos && (Array.from(contacts.pos as any).slice(0, 12))) || null,
          n: contacts?.n ?? null,
          hasPos: !!contacts?.pos,
          hasFrame: !!contacts?.frame,
          hasForce: !!contacts?.force,
          contactDebug: dbg,
        };
      });

      expect(rajSnapshot.n).not.toBeNull();
      expect(rajSnapshot.n as number).toBeGreaterThan(0);
      expect(rajSnapshot.hasPos).toBe(true);
      expect(rajSnapshot.hasFrame).toBe(true);
      expect(rajSnapshot.hasForce).toBe(true);

      const humanoidPath = path.join(__dirname, '..', '..', 'humanoid_nofreejnt.xml');
      const humanoidXml = await fs.readFile(humanoidPath, 'utf8');
      await page.evaluate(async ({ xml, label }) => {
        const win: any = window;
        const controls = win.__viewerControls;
        if (!controls?.loadXmlTextAsModel) throw new Error('Missing __viewerControls.loadXmlTextAsModel');
        await controls.loadXmlTextAsModel(xml, label);
      }, { xml: humanoidXml, label: 'humanoid_nofreejnt.xml' });
      await page.waitForFunction((label) => {
        const win: any = window;
        const store = win.__viewerStore;
        const modelLabel = store?.get?.()?.shell?.modelLabel || '';
        return typeof modelLabel === 'string' && modelLabel.includes(label);
      }, 'humanoid_nofreejnt', { timeout: 60_000 });

      await enableContactFlagsViaControls(page);
      await waitForContacts(page, 'humanoid_nofreejnt');

      const humanoidSnapshot = await page.evaluate(() => {
        const win: any = window;
        const snap = win.__PLAY_HOST__?.getSnapshot?.() ?? null;
        const dbg = win.__contactDebug || null;
        const contacts = snap?.contacts || null;
        return {
          posSample: Array.isArray(contacts?.pos)
            ? (contacts.pos as number[]).slice(0, 12)
            : (contacts?.pos && (Array.from(contacts.pos as any).slice(0, 12))) || null,
          n: contacts?.n ?? null,
          hasPos: !!contacts?.pos,
          hasFrame: !!contacts?.frame,
          hasForce: !!contacts?.force,
          contactDebug: dbg,
        };
      });

      expect(humanoidSnapshot.n).not.toBeNull();
      expect(humanoidSnapshot.n as number).toBeGreaterThan(0);
      expect(humanoidSnapshot.hasForce).toBe(true);
      expect(humanoidSnapshot.hasPos).toBe(true);
      expect(humanoidSnapshot.hasFrame).toBe(true);
    });
  }
  );
});
