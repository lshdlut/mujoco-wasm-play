import { readFile, writeFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

function parseArgs(argv) {
  const args = { forgeDistRoot: null, outPath: null };
  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--forgeDistRoot') {
      const value = argv[i + 1];
      if (!value) throw new Error('Missing value for --forgeDistRoot');
      args.forgeDistRoot = value;
      i += 1;
      continue;
    }
    if (token === '--out') {
      const value = argv[i + 1];
      if (!value) throw new Error('Missing value for --out');
      args.outPath = value;
      i += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${token}`);
  }
  return args;
}

function semverKey(ver) {
  const parts = String(ver).split('.').map((s) => Number.parseInt(s, 10));
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return null;
  return parts;
}

function compareSemver(a, b) {
  const ka = semverKey(a);
  const kb = semverKey(b);
  if (!ka || !kb) return String(a).localeCompare(String(b));
  for (let i = 0; i < 3; i += 1) {
    if (ka[i] !== kb[i]) return ka[i] - kb[i];
  }
  return 0;
}

function guessBytesFromTypedef(typeInfo) {
  if (!typeInfo) return null;
  const qualType = String(typeInfo.qualType || '');
  const desugared = String(typeInfo.desugaredQualType || '');
  const joined = `${qualType} ${desugared}`.toLowerCase();
  if (joined.includes('uint8') || joined.includes('unsigned char') || joined.includes('char')) return 1;
  if (joined.includes('double')) return 8;
  if (joined.includes('float')) return 4;
  if (joined.includes('int64') || joined.includes('uint64') || joined.includes('long long')) return 8;
  if (joined.includes('int32') || joined.includes('uint32')) return 4;
  if (joined.includes('size_t')) return 4;
  if (/\bint\b/.test(joined)) return 4;
  return null;
}

function extractTypedefTypeInfoFromAstText(astText, typedefName) {
  const marker = `"name": "${typedefName}"`;
  const idx = astText.indexOf(marker);
  if (idx < 0) return null;
  const window = astText.slice(idx, idx + 3000);
  const qual = window.match(/"qualType"\s*:\s*"([^"]+)"/);
  const desugared = window.match(/"desugaredQualType"\s*:\s*"([^"]+)"/);
  if (!qual) return null;
  return {
    qualType: qual[1],
    desugaredQualType: desugared ? desugared[1] : '',
  };
}

function resolveTexAdrElementKind({ innerType, mjtSizeBytes }) {
  if (innerType === 'int') return 'i32';
  if (innerType === 'mjtSize') {
    if (mjtSizeBytes === 8) return 'i64';
    if (mjtSizeBytes === 4) return 'i32';
    return 'unknown';
  }
  return 'unknown';
}

async function findForgeDistRoot(cliValue) {
  if (cliValue) return path.resolve(repoRoot, cliValue);
  const sibling = path.resolve(repoRoot, '..', 'mujoco-wasm-forge', 'dist');
  try {
    await readdir(sibling);
    return sibling;
  } catch {
    return path.join(repoRoot, 'dist');
  }
}

async function main() {
  const args = parseArgs(process.argv);
  const forgeDistRoot = await findForgeDistRoot(args.forgeDistRoot);
  const outPath = args.outPath
    ? path.resolve(repoRoot, args.outPath)
    : path.join(repoRoot, 'bridge', 'forge_abi_snapshot.gen.mjs');

  const versions = [];
  const typedefBytesByVer = { mjtByte: {}, mjtNum: {}, mjtSize: {} };
  const mjModelTexAdrInnerTypeByVer = {};
  const mjModelTexAdrElementKindByVer = {};

  const distEntries = await readdir(forgeDistRoot, { withFileTypes: true });
  for (const entry of distEntries) {
    if (!entry.isDirectory()) continue;
    const ver = entry.name;
    const structsPath = path.join(forgeDistRoot, ver, 'abi', 'structs_introspect_like.json');
    const astPath = path.join(forgeDistRoot, ver, 'abi', 'mujoco_ast.json');
    try {
      const structs = JSON.parse(await readFile(structsPath, 'utf8'));
      const mjModel = structs?.structs?.mjModel;
      if (!mjModel?.fields) continue;
      const texAdrField = mjModel.fields.find((f) => f?.name === 'tex_adr');
      const innerType = texAdrField?.type?.inner?.name ? String(texAdrField.type.inner.name) : '';
      if (!innerType) {
        throw new Error(`mjModel.tex_adr missing in ${structsPath}`);
      }
      const astText = await readFile(astPath, 'utf8');
      const mjtSizeInfo = extractTypedefTypeInfoFromAstText(astText, 'mjtSize');
      const mjtNumInfo = extractTypedefTypeInfoFromAstText(astText, 'mjtNum');
      const mjtByteInfo = extractTypedefTypeInfoFromAstText(astText, 'mjtByte');
      const mjtSizeBytes = guessBytesFromTypedef(mjtSizeInfo);
      const mjtNumBytes = guessBytesFromTypedef(mjtNumInfo);
      const mjtByteBytes = guessBytesFromTypedef(mjtByteInfo);
      if (!mjtSizeBytes) throw new Error(`Unable to resolve mjtSize bytes from ${astPath}`);
      if (!mjtNumBytes) throw new Error(`Unable to resolve mjtNum bytes from ${astPath}`);
      if (!mjtByteBytes) throw new Error(`Unable to resolve mjtByte bytes from ${astPath}`);

      versions.push(ver);
      typedefBytesByVer.mjtSize[ver] = mjtSizeBytes;
      typedefBytesByVer.mjtNum[ver] = mjtNumBytes;
      typedefBytesByVer.mjtByte[ver] = mjtByteBytes;
      mjModelTexAdrInnerTypeByVer[ver] = innerType;
      mjModelTexAdrElementKindByVer[ver] = resolveTexAdrElementKind({ innerType, mjtSizeBytes });
    } catch (err) {
      // Skip versions without ABI metadata.
      if (err && (err.code === 'ENOENT' || err.code === 'ENOTDIR')) continue;
      throw err;
    }
  }

  versions.sort(compareSemver);
  if (!versions.length) {
    throw new Error(`No forge dist versions found under: ${forgeDistRoot}`);
  }

  const stableSortObject = (obj) => {
    const out = {};
    for (const ver of versions) {
      if (Object.prototype.hasOwnProperty.call(obj, ver)) {
        out[ver] = obj[ver];
      }
    }
    return out;
  };

  const output = [
    '// Auto-generated by tools/generate_forge_abi_snapshot.mjs. Do not edit by hand.',
    '// Source of truth: <forgeDistRoot>/<ver>/abi/{structs_introspect_like.json,mujoco_ast.json}',
    '',
    `export const FORGE_ABI_VERSIONS = ${JSON.stringify(versions, null, 2)};`,
    '',
    'export const TYPEDEF_BYTES_BY_VER = {',
    `  mjtByte: ${JSON.stringify(stableSortObject(typedefBytesByVer.mjtByte), null, 2).replaceAll('\n', '\n  ')},`,
    `  mjtNum: ${JSON.stringify(stableSortObject(typedefBytesByVer.mjtNum), null, 2).replaceAll('\n', '\n  ')},`,
    `  mjtSize: ${JSON.stringify(stableSortObject(typedefBytesByVer.mjtSize), null, 2).replaceAll('\n', '\n  ')},`,
    '};',
    '',
    `export const MJMODEL_TEX_ADR_INNER_TYPE_BY_VER = ${JSON.stringify(stableSortObject(mjModelTexAdrInnerTypeByVer), null, 2)};`,
    '',
    `export const MJMODEL_TEX_ADR_ELEMENT_KIND_BY_VER = ${JSON.stringify(stableSortObject(mjModelTexAdrElementKindByVer), null, 2)};`,
    '',
  ].join('\n');

  await writeFile(outPath, output, 'utf8');
  // eslint-disable-next-line no-console
  console.log(`Wrote ${path.relative(repoRoot, outPath)} for versions: ${versions.join(', ')}`);
}

await main();
