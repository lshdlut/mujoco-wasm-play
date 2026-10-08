import { createHash } from 'node:crypto';
import { access, mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const generatorPath = path.join(repoRoot, 'tools', 'generate_forge_abi_snapshot.mjs');
const checkedInSnapshotPath = path.join(repoRoot, 'bridge', 'forge_abi_snapshot.gen.mjs');
const defaultForgeDistRoot = path.resolve(repoRoot, '..', 'mujoco-wasm-forge', 'deliverables');

const requiredAbiFiles = [
  'structs_introspect_like.json',
  'mujoco_ast.json',
  'functions_introspect_like.json',
  'enums_introspect_like.json',
];

const generatorExports = [
  'FORGE_ABI_VERSIONS',
  'TYPEDEF_BYTES_BY_VER',
  'MJMODEL_TEX_ADR_INNER_TYPE_BY_VER',
  'MJMODEL_TEX_ADR_ELEMENT_KIND_BY_VER',
  'MJDATA_SOLVER_RECORDS_PER_ISLAND_BY_VER',
  'MJV_MOVE_CAMERA_HAS_SCENE_ARG_BY_VER',
  'PLAY_COMPATIBILITY_BY_VER',
];

const directVersionExports = new Set([
  'MJMODEL_TEX_ADR_INNER_TYPE_BY_VER',
  'MJMODEL_TEX_ADR_ELEMENT_KIND_BY_VER',
  'MJDATA_SOLVER_RECORDS_PER_ISLAND_BY_VER',
  'MJV_MOVE_CAMERA_HAS_SCENE_ARG_BY_VER',
  'PLAY_COMPATIBILITY_BY_VER',
]);

const ciMissingVersionAllowlist = new Set(['3.3.7']);

// CLI failures remain observable even when captured into a structured FAIL receipt.
function strictCatch(error, context) {
  console.error(`[forge-abi] ${context}: ${String(error?.stack || error)}`);
}

function parseArgs(argv) {
  const args = {
    forgeDistRoot: defaultForgeDistRoot,
    reportPath: null,
    tempRoot: os.tmpdir(),
    allowMissingVersions: [],
  };
  for (let index = 2; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--forgeDistRoot' || token === '--report' || token === '--temp-root') {
      const value = argv[index + 1];
      if (!value) throw new Error(`Missing value for ${token}`);
      const key = token === '--forgeDistRoot' ? 'forgeDistRoot' : token === '--report' ? 'reportPath' : 'tempRoot';
      args[key] = value;
      index += 1;
      continue;
    }
    if (token === '--allow-missing-version') {
      const value = argv[index + 1];
      if (!value) throw new Error('Missing value for --allow-missing-version');
      args.allowMissingVersions.push(value);
      index += 1;
      continue;
    }
    if (token.startsWith('--allow-missing-version=')) {
      args.allowMissingVersions.push(token.slice('--allow-missing-version='.length));
      continue;
    }
    if (token === '--help') {
      console.log('Usage: node tools/check_forge_abi_snapshot.mjs [--forgeDistRoot DIR] [--report FILE] [--temp-root DIR] [--allow-missing-version VERSION]');
      process.exit(0);
    }
    throw new Error(`Unknown argument: ${token}`);
  }
  args.forgeDistRoot = path.resolve(repoRoot, args.forgeDistRoot);
  args.reportPath = args.reportPath ? path.resolve(repoRoot, args.reportPath) : null;
  args.tempRoot = path.resolve(repoRoot, args.tempRoot);
  return args;
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function semverKey(version) {
  const parts = String(version).split('.').map((part) => Number.parseInt(part, 10));
  return parts.length === 3 && parts.every(Number.isFinite) ? parts : null;
}

function compareSemver(a, b) {
  const ka = semverKey(a);
  const kb = semverKey(b);
  if (!ka || !kb) return String(a).localeCompare(String(b));
  for (let index = 0; index < 3; index += 1) {
    if (ka[index] !== kb[index]) return ka[index] - kb[index];
  }
  return 0;
}

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

async function readBytes(filePath) {
  const bytes = await readFile(filePath);
  return { bytes, sha256: sha256(bytes) };
}

async function importSnapshot(filePath, cacheKey) {
  return import(`${pathToFileURL(filePath).href}?forge_abi_check=${encodeURIComponent(cacheKey)}`);
}

function normalizedExport(name, value, excludedVersions) {
  if (name === 'FORGE_ABI_VERSIONS') {
    return value.filter((version) => !excludedVersions.has(version));
  }
  if (name === 'TYPEDEF_BYTES_BY_VER') {
    return Object.fromEntries(Object.entries(value).map(([kind, byVersion]) => [
      kind,
      Object.fromEntries(Object.entries(byVersion).filter(([version]) => !excludedVersions.has(version))),
    ]));
  }
  if (directVersionExports.has(name)) {
    return Object.fromEntries(Object.entries(value).filter(([version]) => !excludedVersions.has(version)));
  }
  return value;
}

function compareExports(expectedModule, freshModule, excludedVersions) {
  const mismatches = [];
  for (const name of generatorExports) {
    if (!(name in expectedModule)) {
      mismatches.push({ export: name, reason: 'missing from checked-in snapshot' });
      continue;
    }
    if (!(name in freshModule)) {
      mismatches.push({ export: name, reason: 'missing from fresh generator output' });
      continue;
    }
    const expected = normalizedExport(name, expectedModule[name], excludedVersions);
    const fresh = normalizedExport(name, freshModule[name], excludedVersions);
    if (JSON.stringify(expected) !== JSON.stringify(fresh)) {
      mismatches.push({ export: name, reason: 'export value differs after applying explicit missing-version exemption' });
    }
  }
  return mismatches;
}

function firstByteDifference(expected, actual) {
  const limit = Math.min(expected.length, actual.length);
  for (let index = 0; index < limit; index += 1) {
    if (expected[index] !== actual[index]) return index;
  }
  return expected.length === actual.length ? null : limit;
}

async function inspectForgeRoot(forgeDistRoot, expectedVersions, allowedMissingVersions) {
  const entries = await readdir(forgeDistRoot, { withFileTypes: true });
  const versionDirs = entries
    .filter((entry) => entry.isDirectory() && semverKey(entry.name))
    .map((entry) => entry.name)
    .sort(compareSemver);
  const missingVersions = [];
  const incompleteMetadata = [];
  const inputPaths = {};
  for (const version of expectedVersions) {
    const versionRoot = path.join(forgeDistRoot, version);
    if (!versionDirs.includes(version)) {
      missingVersions.push(version);
      continue;
    }
    const abiRoot = path.join(versionRoot, 'abi');
    const paths = Object.fromEntries(requiredAbiFiles.map((name) => [name, path.join(abiRoot, name)]));
    const missingFiles = [];
    for (const [name, filePath] of Object.entries(paths)) {
      if (!(await exists(filePath))) missingFiles.push(name);
    }
    if (missingFiles.length) incompleteMetadata.push({ version, missingFiles });
    else inputPaths[version] = paths;
  }
  const unexpectedVersions = versionDirs.filter((version) => !expectedVersions.includes(version));
  const disallowedMissingVersions = missingVersions.filter((version) => !allowedMissingVersions.has(version));
  const allowedMissingButPresent = [...allowedMissingVersions].filter((version) => versionDirs.includes(version));
  return {
    versionDirs,
    missingVersions,
    disallowedMissingVersions,
    allowedMissingButPresent,
    incompleteMetadata,
    unexpectedVersions,
    inputPaths,
  };
}

async function collectSourceFiles(forgeDistRoot, inputPaths) {
  const files = [
    { role: 'generator', path: generatorPath },
    { role: 'checked_in_snapshot', path: checkedInSnapshotPath },
  ];
  for (const [version, paths] of Object.entries(inputPaths)) {
    for (const [name, filePath] of Object.entries(paths)) files.push({ role: 'forge_abi_input', version, name, path: filePath });
  }
  return Promise.all(files.map(async (file) => {
    try {
      return { ...file, sha256: (await readBytes(file.path)).sha256, readable: true };
    } catch (error) {
      strictCatch(error, `read source ${file.path}`);
      return { ...file, sha256: null, readable: false, error: String(error?.message || error) };
    }
  }));
}

function sourceHashMap(files) {
  return Object.fromEntries(files.map((file) => [file.path, file.sha256]));
}

function changedSourceFiles(before, after) {
  const paths = new Set([...Object.keys(sourceHashMap(before)), ...Object.keys(sourceHashMap(after))]);
  const beforeMap = sourceHashMap(before);
  const afterMap = sourceHashMap(after);
  return [...paths].filter((filePath) => beforeMap[filePath] !== afterMap[filePath]);
}

function generatorError(result) {
  if (result.error) return String(result.error.message || result.error);
  return `generator exited with code ${result.status}`;
}

async function main() {
  const args = parseArgs(process.argv);
  const report = {
    schema: 'mujoco-wasm-play/forge-abi-snapshot-check/1',
    status: 'FAIL',
    nativeExecution: false,
    arguments: {
      forgeDistRoot: args.forgeDistRoot,
      allowMissingVersions: args.allowMissingVersions,
      reportPath: args.reportPath,
    },
    sourceOfTruth: {
      generator: generatorPath,
      checkedInSnapshot: checkedInSnapshotPath,
      exportsCompared: generatorExports,
    },
    errors: [],
    failureReasons: [],
  };
  let tempDir = null;
  try {
    const invalidAllowances = args.allowMissingVersions.filter((version) => !ciMissingVersionAllowlist.has(version));
    if (invalidAllowances.length) {
      report.failureReasons.push(`Unsupported --allow-missing-version value(s): ${invalidAllowances.join(', ')}`);
      return report;
    }
    const checkedInBytes = await readBytes(checkedInSnapshotPath);
    const checkedInModule = await importSnapshot(checkedInSnapshotPath, `checked-in-${checkedInBytes.sha256}`);
    const expectedVersions = [...checkedInModule.FORGE_ABI_VERSIONS].sort(compareSemver);
    report.expectedVersions = expectedVersions;
    report.allowedMissingVersions = args.allowMissingVersions;
    const inspection = await inspectForgeRoot(args.forgeDistRoot, expectedVersions, new Set(args.allowMissingVersions));
    report.inputInventory = {
      versionDirs: inspection.versionDirs,
      missingVersions: inspection.missingVersions,
      disallowedMissingVersions: inspection.disallowedMissingVersions,
      allowedMissingButPresent: inspection.allowedMissingButPresent,
      incompleteMetadata: inspection.incompleteMetadata,
      unexpectedVersions: inspection.unexpectedVersions,
    };
    if (inspection.disallowedMissingVersions.length) report.failureReasons.push(`Missing non-exempt Forge versions: ${inspection.disallowedMissingVersions.join(', ')}`);
    if (inspection.allowedMissingButPresent.length) report.failureReasons.push(`Explicitly exempt version is present and must be compared: ${inspection.allowedMissingButPresent.join(', ')}`);
    if (inspection.incompleteMetadata.length) report.failureReasons.push('Forge ABI metadata is incomplete for one or more versions');
    if (inspection.unexpectedVersions.length) report.failureReasons.push(`Unexpected Forge version directories: ${inspection.unexpectedVersions.join(', ')}`);

    const sourceBefore = await collectSourceFiles(args.forgeDistRoot, inspection.inputPaths);
    report.sourceFiles = { before: sourceBefore };
    if (sourceBefore.some((file) => !file.readable)) report.failureReasons.push('One or more source/generator files could not be read');
    if (report.failureReasons.length) return report;

    tempDir = await mkdtemp(path.join(args.tempRoot, 'mujoco-wasm-play-forge-abi-'));
    const freshOutputPath = path.join(tempDir, 'forge_abi_snapshot.gen.mjs');
    const generated = spawnSync(process.execPath, [
      generatorPath,
      '--forgeDistRoot',
      args.forgeDistRoot,
      '--out',
      freshOutputPath,
    ], { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    report.generator = {
      exitCode: generated.status,
      stdout: String(generated.stdout || '').trim().slice(-2000),
      stderr: String(generated.stderr || '').trim().slice(-2000),
    };
    if (generated.error || generated.status !== 0) {
      report.failureReasons.push(generatorError(generated));
      return report;
    }

    const freshBytes = await readBytes(freshOutputPath);
    const freshModule = await importSnapshot(freshOutputPath, `fresh-${freshBytes.sha256}`);
    const allowedMissing = new Set(args.allowMissingVersions);
    const exportMismatches = compareExports(checkedInModule, freshModule, allowedMissing);
    const exactByteMatch = checkedInBytes.bytes.equals(freshBytes.bytes);
    const freshVersions = [...freshModule.FORGE_ABI_VERSIONS].sort(compareSemver);
    const expectedComparableVersions = expectedVersions.filter((version) => !allowedMissing.has(version));
    const freshComparableVersions = freshVersions.filter((version) => !allowedMissing.has(version));
    report.comparison = {
      mode: allowedMissing.size ? 'semantic-export-comparison-with-explicit-missing-version-exemption' : 'exact-byte-and-export-comparison',
      freshOutputSha256: freshBytes.sha256,
      checkedInOutputSha256: checkedInBytes.sha256,
      exactByteMatch,
      freshVersions,
      expectedComparableVersions,
      freshComparableVersions,
      versionSetMatch: JSON.stringify(expectedComparableVersions) === JSON.stringify(freshComparableVersions),
      exportMismatches,
      allGeneratorExportsCompared: exportMismatches.length === 0,
    };
    if (exportMismatches.length) report.failureReasons.push(`Generator export drift: ${exportMismatches.map((item) => item.export).join(', ')}`);
    if (!report.comparison.versionSetMatch) report.failureReasons.push('Fresh generator version set differs from expected comparable versions');
    if (!allowedMissing.size && !exactByteMatch) {
      report.failureReasons.push(`Checked-in snapshot bytes differ from fresh output at byte ${firstByteDifference(checkedInBytes.bytes, freshBytes.bytes)}`);
    }
    const sourceAfter = await collectSourceFiles(args.forgeDistRoot, inspection.inputPaths);
    report.sourceFiles.after = sourceAfter;
    report.sourceChangedDuringCheck = changedSourceFiles(sourceBefore, sourceAfter);
    if (report.sourceChangedDuringCheck.length) report.failureReasons.push('Generator, checked-in snapshot, or Forge ABI inputs changed during the check');
    report.status = report.failureReasons.length ? 'FAIL' : 'PASS';
    return report;
  } catch (error) {
    strictCatch(error, 'snapshot check');
    report.errors.push(String(error?.stack || error));
    report.status = 'FAIL';
    return report;
  } finally {
    if (tempDir) await rm(tempDir, { recursive: true, force: true });
  }
}

let report;
try {
  report = await main();
} catch (error) {
  strictCatch(error, 'snapshot check entrypoint');
  report = {
    schema: 'mujoco-wasm-play/forge-abi-snapshot-check/1',
    status: 'FAIL',
    nativeExecution: false,
    errors: [String(error?.stack || error)],
  };
}

if (report.arguments?.reportPath) {
  await mkdir(path.dirname(report.arguments.reportPath), { recursive: true });
  await writeFile(report.arguments.reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}
console.log(JSON.stringify({
  status: report.status,
  failureReasons: report.failureReasons || [],
  errors: report.errors || [],
  forgeDistRoot: report.arguments?.forgeDistRoot,
  missingVersions: report.inputInventory?.missingVersions || [],
  exportMismatches: report.comparison?.exportMismatches?.map((item) => item.export) || [],
  sourceChangedDuringCheck: report.sourceChangedDuringCheck || [],
  report: report.arguments?.reportPath || null,
}, null, 2));
if (report.status !== 'PASS') process.exitCode = 1;
