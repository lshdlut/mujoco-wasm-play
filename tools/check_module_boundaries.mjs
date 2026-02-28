import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

function runGit(args) {
  const result = spawnSync('git', args, { encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`[boundaries] git ${args.join(' ')} failed: ${result.stderr || result.stdout || ''}`);
  }
  return String(result.stdout || '');
}

function toPosix(relPath) {
  return relPath.replaceAll('\\', '/');
}

function layerOf(relPath) {
  const p = toPosix(relPath);
  if (!p.startsWith('dev/')) return null;

  if (p === 'dev/main.nobuild.mjs') return 'entry';

  if (p === 'dev/main_ui.mjs' || p.startsWith('dev/ui/')) return 'ui';
  if (p === 'dev/main_renderer.mjs' || p.startsWith('dev/renderer/')) return 'renderer';
  if (p === 'dev/viewer_backend.mjs' || p.startsWith('dev/backend/')) return 'backend';
  if (p === 'dev/physics.worker.mjs' || p.startsWith('dev/worker/')) return 'worker';
  if (p === 'dev/bridge.mjs' || p.startsWith('dev/bridge/')) return 'bridge';
  if (p === 'dev/main_environment.mjs' || p.startsWith('dev/environment/')) return 'environment';

  if (p === 'dev/protocol.gen.mjs' || p === 'dev/dispatch.gen.mjs' || p.startsWith('dev/protocol/')) return 'protocol';

  if (p.startsWith('dev/viewer_') || p === 'dev/fallbacks.mjs' || p === 'dev/xml_refs.mjs') return 'base';

  if (p.startsWith('dev/plugins/')) return 'plugin';
  if (p.startsWith('dev/spec/')) return 'spec';

  return 'misc';
}

const ALLOWED_IMPORTS = {
  // "base" is the shared runtime foundation. Bridge is treated as a low-level
  // utility that base modules (e.g. generated structs) may depend on.
  base: new Set(['base', 'bridge']),
  protocol: new Set(['protocol', 'base']),
  environment: new Set(['environment', 'base']),
  bridge: new Set(['bridge', 'base', 'protocol']),
  worker: new Set(['worker', 'bridge', 'base', 'protocol']),
  backend: new Set(['backend', 'base', 'protocol']),
  ui: new Set(['ui', 'environment', 'base']),
  renderer: new Set(['renderer', 'environment', 'base']),
  entry: new Set(['entry', 'ui', 'renderer', 'backend', 'worker', 'bridge', 'environment', 'protocol', 'base']),
};

const EDGE_EXCEPTIONS = new Set([
]);

const STATIC_IMPORT_RE = /\bimport\s+(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]/g;
const SIDE_EFFECT_IMPORT_RE = /\bimport\s*['"]([^'"]+)['"]/g;
const EXPORT_FROM_RE = /\bexport\s+[^'"]*?\s+from\s+['"]([^'"]+)['"]/g;
const DYNAMIC_IMPORT_RE = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

function extractImportSpecifiers(source) {
  const stripped = source
    .replaceAll(/\r\n/g, '\n')
    .replaceAll(/\/\*[\s\S]*?\*\//g, '')
    .replaceAll(/^\s*\/\/.*$/gm, '');

  const specs = [];
  for (const re of [STATIC_IMPORT_RE, SIDE_EFFECT_IMPORT_RE, EXPORT_FROM_RE, DYNAMIC_IMPORT_RE]) {
    re.lastIndex = 0;
    let match;
    while ((match = re.exec(stripped))) {
      const spec = match[1];
      if (spec) specs.push(spec);
    }
  }
  return specs;
}

function resolveRelativeImport(fromRel, spec) {
  if (!spec.startsWith('.')) return null;
  const fromDir = path.dirname(fromRel);
  const joined = path.resolve(fromDir, spec);
  const candidates = [];

  const ext = path.extname(joined);
  if (ext) {
    candidates.push(joined);
  } else {
    candidates.push(`${joined}.mjs`, `${joined}.js`, `${joined}.ts`);
  }

  for (const absPath of candidates) {
    const rel = toPosix(path.relative(process.cwd(), absPath));
    if (fs.existsSync(absPath)) return rel;
  }
  return null;
}

function shouldSkipFile(relPath) {
  const p = toPosix(relPath);
  if (!p.startsWith('dev/')) return true;
  if (p.startsWith('dev/node_modules/')) return true;
  if (p.startsWith('dev/dist/')) return true;
  if (p.startsWith('dev/model/')) return true;
  if (p.startsWith('dev/local_model/')) return true;
  if (p.startsWith('dev/spec/')) return true;
  if (p.startsWith('dev/plugins/')) return true;
  return false;
}

const tracked = runGit(['ls-files']).split(/\r?\n/).filter(Boolean).map(toPosix);
const untracked = runGit(['ls-files', '--others', '--exclude-standard']).split(/\r?\n/).filter(Boolean).map(toPosix);
const allFiles = Array.from(new Set([...tracked, ...untracked]));
const devFiles = allFiles.filter((p) => (p.endsWith('.mjs') || p.endsWith('.ts')) && p.startsWith('dev/') && !shouldSkipFile(p));
const devSet = new Set(devFiles);

const violations = [];
let edgeCount = 0;

for (const fromRel of devFiles) {
  const fromLayer = layerOf(fromRel);
  const allow = ALLOWED_IMPORTS[fromLayer] || null;
  if (!allow) continue;

  const abs = path.resolve(process.cwd(), fromRel);
  const source = fs.readFileSync(abs, 'utf8');
  const specs = extractImportSpecifiers(source);
  for (const spec of specs) {
    // Ignore bare imports and URL/importmap targets.
    if (!spec.startsWith('.')) continue;

    const toRel = resolveRelativeImport(fromRel, spec);
    if (!toRel) continue;
    if (!devSet.has(toRel)) continue;

    edgeCount += 1;
    const toLayer = layerOf(toRel);
    const edgeKey = `${fromRel} -> ${toRel}`;
    if (EDGE_EXCEPTIONS.has(edgeKey)) continue;
    if (!allow.has(toLayer)) {
      violations.push({ from: fromRel, fromLayer, to: toRel, toLayer, spec });
    }
  }
}

if (violations.length) {
  console.error(`[boundaries] Violations: ${violations.length}`);
  for (const v of violations) {
    console.error(`- ${v.from} (${v.fromLayer}) imports ${v.to} (${v.toLayer}) via ${JSON.stringify(v.spec)}`);
  }
  process.exit(1);
}

console.log(`[boundaries] OK (${devFiles.length} files, ${edgeCount} edges)`);
