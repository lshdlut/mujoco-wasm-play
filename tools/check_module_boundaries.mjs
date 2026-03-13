import fs from 'node:fs';
import path from 'node:path';

function toPosix(relPath) {
  return relPath.replaceAll('\\', '/');
}

function walkRepo(dirAbs, out = []) {
  const entries = fs.readdirSync(dirAbs, { withFileTypes: true });
  for (const entry of entries) {
    const abs = path.join(dirAbs, entry.name);
    const rel = toPosix(path.relative(process.cwd(), abs));
    if (entry.isDirectory()) {
      if (shouldSkipFile(rel)) continue;
      walkRepo(abs, out);
      continue;
    }
    out.push(rel);
  }
  return out;
}

function layerOf(relPath) {
  const p = toPosix(relPath);

  if (p === 'app/main.mjs') return 'entry';

  if (p.startsWith('app/')) return 'entry';
  if (p.startsWith('ui/')) return 'ui';
  if (p.startsWith('renderer/')) return 'renderer';
  if (p.startsWith('backend/')) return 'backend';
  if (p === 'worker/protocol.gen.mjs' || p === 'worker/dispatch.gen.mjs') return 'protocol';
  if (p === 'worker/physics.worker.mjs' || p.startsWith('worker/')) return 'worker';
  if (p.startsWith('bridge/')) return 'bridge';
  if (p.startsWith('environment/')) return 'environment';
  if (p.startsWith('core/')) return 'base';

  if (p.startsWith('plugins/')) return 'plugin';
  if (p.startsWith('spec/')) return 'spec';

  return null;
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
  // Tooling-only type facade; ownership is defined by the JS runtime modules,
  // not by this editor-facing surface.
  if (p === 'core/viewer_state_types.ts') return true;
  if (p.startsWith('node_modules/')) return true;
  if (p.startsWith('dist/')) return true;
  if (p.startsWith('local_tools/')) return true;
  if (p.startsWith('local_model/')) return true;
  if (p.startsWith('model/')) return true;
  if (p.startsWith('spec/')) return true;
  if (p.startsWith('plugins/')) return true;
  if (p.startsWith('assets/')) return true;
  if (p.startsWith('doc/')) return true;
  if (p.startsWith('tests/')) return true;
  if (p.startsWith('tools/')) return true;
  return false;
}

const allFiles = walkRepo(process.cwd());
const codeFiles = allFiles.filter((p) => {
  if (!(p.endsWith('.mjs') || p.endsWith('.ts'))) return false;
  if (!layerOf(p)) return false;
  if (shouldSkipFile(p)) return false;
  return fs.existsSync(path.resolve(process.cwd(), p));
});
const codeSet = new Set(codeFiles);

const violations = [];
let edgeCount = 0;

for (const fromRel of codeFiles) {
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
    if (!codeSet.has(toRel)) continue;

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

console.log(`[boundaries] OK (${codeFiles.length} files, ${edgeCount} edges)`);
