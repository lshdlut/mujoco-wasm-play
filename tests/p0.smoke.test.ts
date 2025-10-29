import { describe, it, expect } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

const forgeDir = path.resolve(process.cwd(), 'local_tools', 'forge', 'dist', '3.3.7');

const hasForge = fs.existsSync(path.join(forgeDir, 'mujoco-3.3.7.js')) &&
                 fs.existsSync(path.join(forgeDir, 'mujoco-3.3.7.wasm'));

describe('P0 smoke (forge 3.3.7)', () => {
  (hasForge ? it : it.skip)('loads module and steps demo (via Node smoke)', async () => {
    const script = '../mujoco-wasm-forge/scripts/smoke_local.mjs';
    const out = spawnSync(process.execPath, [script], {
      cwd: path.resolve(process.cwd(), '../mujoco-wasm-forge'),
      encoding: 'utf8',
    });
    expect(out.status).toBe(0);
    expect(out.stdout).toContain('SMOKE OK');
  });
});
