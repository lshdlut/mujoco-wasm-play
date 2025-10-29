import { describe, it, expect } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

const forgeDir = path.resolve(process.cwd(), 'local_tools', 'forge', 'dist', '3.3.7');
const hasForge = fs.existsSync(path.join(forgeDir, 'mujoco-3.3.7.js')) && fs.existsSync(path.join(forgeDir, 'mujoco-3.3.7.wasm'));
const xmlPath = path.resolve(process.cwd(), 'tests', 'fixtures', 'pendulum.xml');
const xmlText = fs.existsSync(xmlPath) ? fs.readFileSync(xmlPath, 'utf8') : '';

describe('P1 optional views (if wrapper exports ptrs)', () => {
  (hasForge ? it : it.skip)('qpos/qvel dims present (via Node smoke)', async () => {
    const script = '../mujoco-wasm-forge/scripts/smoke_local.mjs';
    const out = spawnSync(process.execPath, [script], {
      cwd: path.resolve(process.cwd(), '../mujoco-wasm-forge'),
      encoding: 'utf8',
    });
    expect(out.status).toBe(0);
    const lines = out.stdout.trim().split(/\r?\n/);
    const meta = JSON.parse(lines.find(l => l.startsWith('{')) || '{}');
    expect(typeof meta.nq).toBe('number');
    expect(typeof meta.nv).toBe('number');
  });
});
