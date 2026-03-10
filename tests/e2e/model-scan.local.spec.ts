import fs from 'node:fs';
import path from 'node:path';
import { test } from '@playwright/test';

test.skip(!process.env.PLAY_MODEL_SCAN, 'Set PLAY_MODEL_SCAN=1 to run this local scan.');

function listXmlFiles(rootDir: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(abs);
        continue;
      }
      if (entry.isFile() && entry.name.toLowerCase().endsWith('.xml')) {
        out.push(abs);
      }
    }
  };
  walk(rootDir);
  return out.sort((a, b) => a.localeCompare(b));
}

test('scan model/ xml loadability (local)', async ({ page }, testInfo) => {
  testInfo.setTimeout(15 * 60_000);

  const repoRoot = path.resolve(__dirname, '..', '..');
  const devRoot = repoRoot;
  const modelRoot = path.join(repoRoot, 'model');
  if (!fs.existsSync(modelRoot)) {
    test.skip(true, `Missing local model folder: ${modelRoot}`);
  }

  const xmlFiles = listXmlFiles(modelRoot);
  const filter = process.env.PLAY_MODEL_SCAN_FILTER ? String(process.env.PLAY_MODEL_SCAN_FILTER) : '';
  const filtered = filter
    ? xmlFiles.filter((absPath) => absPath.toLowerCase().includes(filter.toLowerCase()))
    : xmlFiles;
  const failures: Array<{ rel: string; error: string }> = [];
  const current = { rel: '' };
  const consoleErrors: Array<{ rel: string; text: string }> = [];
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    consoleErrors.push({ rel: current.rel, text: msg.text() });
  });
  page.on('pageerror', (err) => {
    consoleErrors.push({ rel: current.rel, text: `[pageerror] ${String(err)}` });
  });

  for (const absPath of filtered) {
    const rel = path.relative(devRoot, absPath).split(path.sep).join('/');
    current.rel = rel;
    const url = `/index.html?mode=worker&model=${encodeURIComponent(rel)}&log=1`;
    try {
      await page.goto(url);
      await page.waitForFunction(
        () => {
          const snap = (window as any).__PLAY_HOST__?.getSnapshot?.();
          return snap && ((snap.scn_ngeom | 0) > 0);
        },
        null,
        { timeout: 20_000 },
      );
    } catch (err) {
      const matching = consoleErrors
        .filter((item) => item.rel === rel)
        .map((item) => item.text)
        .slice(-6);
      failures.push({
        rel,
        error: `${String(err)}${matching.length ? `\n${matching.join('\n')}` : ''}`,
      });
    }
  }

  // eslint-disable-next-line no-console
  console.log(`[model-scan] scanned=${filtered.length} failed=${failures.length}`);
  const reportDir = path.join(repoRoot, 'local_temp');
  fs.mkdirSync(reportDir, { recursive: true });
  const tag = filter
    ? filter.trim().replace(/[^a-z0-9_-]+/gi, '_').slice(0, 48)
    : 'all';
  const reportPath = path.join(reportDir, `model-scan-report-${tag}.json`);
  fs.writeFileSync(
    reportPath,
    JSON.stringify({ scanned: filtered.length, failed: failures.length, failures }, null, 2),
    'utf-8',
  );
  // eslint-disable-next-line no-console
  console.log(`[model-scan] wrote report: ${reportPath}`);
});

