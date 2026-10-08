import { createHash } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const GENERATED_GROUPS = [
  {
    name: 'UI artifacts',
    generator: 'tools/generate_ui_artifacts.mjs',
    inputs: ['spec/ui_spec.json'],
    outputs: [
      'spec/ui_bindings_index.json',
      'spec/ui_spec.schema.json',
      'core/viewer_defaults.mjs',
      'core/viewer_shared.mjs',
      'core/viewer_structs.mjs',
      'core/viewer_state_types.ts',
    ],
  },
  {
    name: 'worker protocol',
    generator: 'tools/generate_worker_protocol.mjs',
    inputs: ['tools/worker_protocol.json'],
    outputs: ['worker/protocol.gen.mjs', 'worker/dispatch.gen.mjs'],
  },
];

function parseArgs(argv) {
  const args = {
    root: process.cwd(),
    workRoot: process.env.MJWASM_PLAY_QUALITY_ROOT
      || path.join(os.tmpdir(), 'mujoco-wasm-play-quality'),
    keep: false,
  };
  for (let index = 2; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--root' || token === '--work-root') {
      const value = argv[index + 1];
      if (!value) throw new Error(`Missing value for ${token}`);
      args[token === '--root' ? 'root' : 'workRoot'] = value;
      index += 1;
      continue;
    }
    if (token === '--keep') {
      args.keep = true;
      continue;
    }
    throw new Error(`Unknown argument: ${token}`);
  }
  args.root = path.resolve(args.root);
  args.workRoot = path.resolve(args.workRoot);
  return args;
}

function relativeFiles() {
  const files = new Set();
  for (const group of GENERATED_GROUPS) {
    files.add(group.generator);
    for (const relPath of [...group.inputs, ...group.outputs]) files.add(relPath);
  }
  return [...files].sort();
}

async function copyRequiredFiles(sourceRoot, stageRoot) {
  for (const relPath of relativeFiles()) {
    const sourcePath = path.join(sourceRoot, relPath);
    const stagePath = path.join(stageRoot, relPath);
    await mkdir(path.dirname(stagePath), { recursive: true });
    await copyFile(sourcePath, stagePath);
  }
}

function runGenerator(stageRoot, relPath) {
  const result = spawnSync(process.execPath, [relPath], {
    cwd: stageRoot,
    env: process.env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `${relPath} failed with exit code ${result.status}\n${result.stdout || ''}${result.stderr || ''}`,
    );
  }
}

function digest(buffer) {
  return createHash('sha256').update(buffer).digest('hex').slice(0, 16);
}

async function compareOutputs(sourceRoot, stageRoot, group) {
  for (const relPath of group.outputs) {
    const expectedPath = path.join(sourceRoot, relPath);
    const generatedPath = path.join(stageRoot, relPath);
    const expected = await readFile(expectedPath);
    const generated = await readFile(generatedPath);
    if (!expected.equals(generated)) {
      throw new Error(
        `${group.name} drift: ${relPath} differs (checked-in=${digest(expected)}, fresh=${digest(generated)})`,
      );
    }
  }
}

async function main() {
  const args = parseArgs(process.argv);
  await mkdir(args.workRoot, { recursive: true });
  const stageRoot = await mkdtemp(path.join(args.workRoot, 'generated-check-'));
  try {
    await copyRequiredFiles(args.root, stageRoot);
    for (const group of GENERATED_GROUPS) {
      runGenerator(stageRoot, group.generator);
      await compareOutputs(args.root, stageRoot, group);
    }
    const outputCount = GENERATED_GROUPS.reduce((sum, group) => sum + group.outputs.length, 0);
    console.log(`GENERATED ARTIFACTS OK (${outputCount} outputs)`);
  } finally {
    if (!args.keep) await rm(stageRoot, { recursive: true, force: true });
    else console.log(`Kept generated-check mirror: ${stageRoot}`);
  }
}

await main();
