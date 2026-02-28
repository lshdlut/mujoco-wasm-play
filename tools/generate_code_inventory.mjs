import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

const CODE_EXTS = new Set(['.mjs', '.js', '.ts', '.py']);

const EXCLUDE_PREFIXES = [
  'dev/dist/',
  'dev/node_modules/',
  'tests/playwright-report/',
];

const JS_METHOD_NAME_BLACKLIST = new Set([
  'if',
  'for',
  'while',
  'switch',
  'catch',
  'try',
  'do',
  'else',
  'return',
  'throw',
  'break',
  'continue',
  'case',
  'default',
  'const',
  'let',
  'var',
  'function',
  'class',
  'new',
  'await',
  'yield',
  'import',
  'export',
  'static',
  'async',
  'get',
  'set',
]);

function listTrackedFiles() {
  const tracked = execFileSync('git', ['ls-files'], { cwd: repoRoot })
    .toString('utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.replace(/\\/g, '/'));
  const untracked = execFileSync('git', ['ls-files', '--others', '--exclude-standard'], { cwd: repoRoot })
    .toString('utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.replace(/\\/g, '/'));
  return Array.from(new Set([...tracked, ...untracked]));
}

function isExcluded(relPath) {
  return EXCLUDE_PREFIXES.some((p) => relPath.startsWith(p));
}

function inferGroup(relPath) {
  if (relPath.startsWith('dev/')) return 'dev';
  if (relPath.startsWith('tools/')) return 'tools';
  if (relPath.startsWith('tests/')) return 'tests';
  return null;
}

function parseExportBlock(lines, startLineIdx) {
  // Parses:
  // export {
  //   a,
  //   b as c,
  // };
  const names = [];
  let i = startLineIdx;
  let openSeen = false;
  for (; i < lines.length; i += 1) {
    const line = lines[i];
    if (!openSeen) {
      if (!/^export\s*\{/.test(line)) return { names: [], endLineIdx: startLineIdx };
      openSeen = true;
      const after = line.replace(/^export\s*\{/, '').trim();
      if (after && after !== '{') {
        // Handle `export { a, b };` on one line.
        const maybe = after.replace(/\}\s*;?\s*$/, '');
        names.push(...maybe.split(','));
      }
      if (/\}\s*;?\s*$/.test(line)) break;
      continue;
    }
    if (/\}\s*;?\s*$/.test(line)) {
      const before = line.replace(/\}\s*;?\s*$/, '').trim();
      if (before) names.push(...before.split(','));
      break;
    }
    names.push(...line.split(','));
  }

  const cleaned = names
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => s.replace(/;$/, '').trim())
    .map((s) => s.replace(/^\s*export\s+/, '').trim())
    .filter((s) => s !== '{' && s !== '}')
    .map((s) => s.replace(/\s+as\s+/g, ' as '))
    .filter(Boolean);

  return { names: cleaned, endLineIdx: i };
}

function parseJsLike(relPath, content) {
  const lines = content.split(/\r?\n/);
  const exports = [];
  const declsFile = [];
  const declsNested = [];
  const classMembers = [];

  function pushDecl({ kind, name, line, scope }) {
    if (scope === 'file') declsFile.push({ kind, name, line });
    else declsNested.push({ kind, name, line });
  }

  function isCommentLike(line) {
    const t = line.trimStart();
    return t.startsWith('//') || t.startsWith('/*') || t.startsWith('*') || t.startsWith('*/');
  }

  function recordClassMembers(startIdx, className, classIndent) {
    for (let j = startIdx; j < lines.length; j += 1) {
      const raw = lines[j];
      const lineNo = j + 1;
      if (isCommentLike(raw)) continue;
      const leading = raw.match(/^\s*/)?.[0] ?? '';
      const trimmed = raw.trim();
      if (leading === classIndent && trimmed.startsWith('}')) return j;

      let m = trimmed.match(/^(get|set)\s+([A-Za-z0-9_$]+)\s*\(/);
      if (m) {
        classMembers.push({ kind: `${m[1]}ter`, name: `${className}#${m[2]}`, line: lineNo });
        continue;
      }

      m = trimmed.match(/^(static\s+)?(async\s+)?\*?\s*([A-Za-z0-9_$]+)\s*\(/);
      if (m) {
        const methodName = m[3];
        if (JS_METHOD_NAME_BLACKLIST.has(methodName)) continue;
        const prefix = `${m[1] ? 'static ' : ''}${m[2] ? 'async ' : ''}`.trim();
        classMembers.push({
          kind: prefix ? `method (${prefix})` : 'method',
          name: `${className}#${methodName}`,
          line: lineNo,
        });
        continue;
      }

      // Class field arrow function: `foo = (...) => {}`
      m = trimmed.match(/^([A-Za-z0-9_$]+)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z0-9_$]+)\s*=>/);
      if (m) {
        const fieldName = m[1];
        if (JS_METHOD_NAME_BLACKLIST.has(fieldName)) continue;
        classMembers.push({ kind: 'field =>', name: `${className}#${fieldName}`, line: lineNo });
      }
    }
    return lines.length - 1;
  }

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const lineNo = i + 1;
    if (isCommentLike(line)) continue;

    // Multi-line export block: `export { ... }`
    if (/^export\s*\{/.test(line)) {
      const { names, endLineIdx } = parseExportBlock(lines, i);
      if (names.length) {
        for (const name of names) {
          exports.push({ kind: 'export', name, line: lineNo });
        }
      }
      i = endLineIdx;
      continue;
    }

    // Class member inventory (heuristic).
    let cm = line.match(/^(?<indent>\s*)(?:export\s+)?class\s+(?<name>[A-Za-z0-9_$]+)\b/);
    if (cm && cm.groups) {
      const classIndent = cm.groups.indent ?? '';
      const className = cm.groups.name;
      recordClassMembers(i + 1, className, classIndent);
    }

    let m = line.match(/^export\s+(async\s+)?function\s+([A-Za-z0-9_$]+)\s*\(/);
    if (m) {
      exports.push({ kind: 'export function', name: m[2], line: lineNo });
    }
    m = line.match(/^export\s+class\s+([A-Za-z0-9_$]+)\b/);
    if (m) {
      exports.push({ kind: 'export class', name: m[1], line: lineNo });
    }
    m = line.match(/^export\s+(const|let|var)\s+([A-Za-z0-9_$]+)\b/);
    if (m) {
      exports.push({ kind: `export ${m[1]}`, name: m[2], line: lineNo });
    }
    m = line.match(/^export\s+default\b/);
    if (m) {
      exports.push({ kind: 'export default', name: '(default)', line: lineNo });
    }

    const isFileScope = !/^\s/.test(line);
    const scope = isFileScope ? 'file' : 'nested';
    const declLine = line.replace(/^export\s+/, '');

    // Declarations (best-effort, includes nested).
    m = declLine.match(/^(?<indent>\s*)(?:async\s+)?function\*?\s+(?<name>[A-Za-z0-9_$]+)\s*\(/);
    if (m) {
      pushDecl({ kind: 'function', name: m.groups ? m.groups.name : m[2], line: lineNo, scope });
    }
    m = declLine.match(/^(?<indent>\s*)class\s+(?<name>[A-Za-z0-9_$]+)\b/);
    if (m) {
      pushDecl({ kind: 'class', name: m.groups ? m.groups.name : m[1], line: lineNo, scope });
    }
    m = declLine.match(
      /^(?<indent>\s*)(?<kw>const|let|var)\s+(?<name>[A-Za-z0-9_$]+)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z0-9_$]+)\s*=>/
    );
    if (m) {
      pushDecl({
        kind: `${m.groups ? m.groups.kw : m[2]} =>`,
        name: m.groups ? m.groups.name : m[3],
        line: lineNo,
        scope,
      });
    }
    m = declLine.match(/^(?<indent>\s*)(?<kw>const|let|var)\s+(?<name>[A-Za-z0-9_$]+)\s*=\s*(?:async\s+)?function\*?\b/);
    if (m) {
      pushDecl({
        kind: `${m.groups ? m.groups.kw : m[2]} = function`,
        name: m.groups ? m.groups.name : m[3],
        line: lineNo,
        scope,
      });
    }

    // Object literal function properties (best-effort):
    //   foo: (...) => { ... }
    //   foo: async (...) => { ... }
    //   foo: function (...) { ... }
    // Note: we intentionally don't try to recover the container object name.
    m = declLine.match(/^\s*(?<prop>[A-Za-z0-9_$]+)\s*:\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z0-9_$]+)\s*=>/);
    if (m) {
      pushDecl({
        kind: 'property =>',
        name: m.groups ? m.groups.prop : m[1],
        line: lineNo,
        scope: 'nested',
      });
    }
    m = declLine.match(/^\s*(?<prop>[A-Za-z0-9_$]+)\s*:\s*(?:async\s+)?function\*?\b/);
    if (m) {
      pushDecl({
        kind: 'property = function',
        name: m.groups ? m.groups.prop : m[1],
        line: lineNo,
        scope: 'nested',
      });
    }
  }

  return {
    relPath,
    lineCount: lines.length,
    exports,
    declsFile,
    declsNested,
    classMembers,
  };
}

function parsePython(relPath, content) {
  const lines = content.split(/\r?\n/);
  const exports = [];
  const declsFile = [];
  const declsNested = [];
  function pushDecl({ kind, name, line, scope }) {
    if (scope === 'file') declsFile.push({ kind, name, line });
    else declsNested.push({ kind, name, line });
  }
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const lineNo = i + 1;
    const isFileScope = !/^\s/.test(line);
    const scope = isFileScope ? 'file' : 'nested';
    let m = line.match(/^\s*def\s+([A-Za-z0-9_]+)\s*\(/);
    if (m) {
      pushDecl({ kind: 'def', name: m[1], line: lineNo, scope });
      continue;
    }
    m = line.match(/^\s*async\s+def\s+([A-Za-z0-9_]+)\s*\(/);
    if (m) {
      pushDecl({ kind: 'async def', name: m[1], line: lineNo, scope });
      continue;
    }
    m = line.match(/^\s*class\s+([A-Za-z0-9_]+)\b/);
    if (m) {
      pushDecl({ kind: 'class', name: m[1], line: lineNo, scope });
    }
  }
  return { relPath, lineCount: lines.length, exports, declsFile, declsNested, classMembers: [] };
}

function buildInventory() {
  const tracked = listTrackedFiles();
  const codeFiles = tracked
    .filter((p) => {
      if (isExcluded(p)) return false;
      const group = inferGroup(p);
      if (!group) return false;
      const ext = path.extname(p).toLowerCase();
      if (!CODE_EXTS.has(ext)) return false;
      return true;
    })
    .sort((a, b) => a.localeCompare(b));

  const files = [];
  for (const relPath of codeFiles) {
    const fullPath = path.join(repoRoot, relPath);
    const content = readFileSync(fullPath, 'utf8');
    const ext = path.extname(relPath).toLowerCase();
    if (ext === '.py') {
      files.push({ group: inferGroup(relPath), ...parsePython(relPath, content) });
      continue;
    }
    files.push({ group: inferGroup(relPath), ...parseJsLike(relPath, content) });
  }
  return { generatedAt: new Date().toISOString(), files };
}

function renderMarkdown({ language, generatedAt, files }) {
  const title = language === 'zh' ? '代码清单（自动生成）' : 'Code inventory (auto-generated)';
  const intro = language === 'zh'
    ? [
        '本页面由脚本自动生成，用于把代码库中的声明（文件级与嵌套）与 ESM exports 以可检索的形式列出来。',
        '',
        '- 生成脚本：`node tools/generate_code_inventory.mjs`',
        '- 说明：这是一个“索引/清单”，不试图解释语义；语义与流程见其它 API/Reference 页面。',
        '- 说明：类成员提取为启发式（heuristic）——用于快速导航，不保证覆盖所有写法。',
        `- 生成时间（UTC）：\`${generatedAt}\``,
      ]
    : [
        'This page is generated by a script to list declarations (file-scope + nested) and ESM exports in a searchable form.',
        '',
        '- Generator: `node tools/generate_code_inventory.mjs`',
        '- Note: this is an inventory/index; it does not try to explain semantics.',
        '- Note: class member extraction is heuristic for navigation and may not cover every pattern.',
        `- Generated at (UTC): ${generatedAt}`,
      ];

  const out = [];
  out.push(`# ${title}`);
  out.push('');
  out.push(...intro);
  out.push('');

  const groups = ['dev', 'tools', 'tests'];
  for (const group of groups) {
    const groupFiles = files.filter((f) => f.group === group);
    out.push(`## ${group}/`);
    out.push('');
    for (const f of groupFiles) {
      out.push(`### \`${f.relPath}\``);
      out.push('');
      out.push(language === 'zh' ? `- 行数：${f.lineCount}` : `- Lines: ${f.lineCount}`);
      if (f.exports.length) {
        out.push(language === 'zh' ? '- 导出（Exports）：' : '- Exports:');
        for (const ex of f.exports) {
          out.push(`  - L${ex.line}: ${ex.kind} \`${ex.name}\``);
        }
      } else {
        out.push(language === 'zh' ? '- 导出（Exports）：（无）' : '- Exports: (none)');
      }
      if (f.declsFile.length) {
        out.push(language === 'zh' ? '- 声明（文件级）：' : '- Declarations (file-scope):');
        for (const d of f.declsFile) {
          out.push(`  - L${d.line}: ${d.kind} \`${d.name}\``);
        }
      } else {
        out.push(language === 'zh' ? '- 声明（文件级）：（未发现）' : '- Declarations (file-scope): (none found)');
      }
      if (f.declsNested.length) {
        out.push(language === 'zh' ? '- 声明（嵌套）：' : '- Declarations (nested):');
        for (const d of f.declsNested) {
          out.push(`  - L${d.line}: ${d.kind} \`${d.name}\``);
        }
      } else {
        out.push(language === 'zh' ? '- 声明（嵌套）：（无）' : '- Declarations (nested): (none)');
      }
      if (f.classMembers.length) {
        out.push(language === 'zh' ? '- 类成员（启发式）：' : '- Class members (heuristic):');
        for (const cm of f.classMembers) {
          out.push(`  - L${cm.line}: ${cm.kind} \`${cm.name}\``);
        }
      } else {
        out.push(language === 'zh' ? '- 类成员（启发式）：（无）' : '- Class members (heuristic): (none)');
      }
      out.push('');
    }
  }

  return out.join('\n');
}

function writeDocs(markdown, relOutPath) {
  const fullOut = path.join(repoRoot, relOutPath);
  writeFileSync(fullOut, markdown.replace(/\n{3,}/g, '\n\n'), 'utf8');
}

const inventory = buildInventory();

writeDocs(renderMarkdown({ language: 'en', ...inventory }), 'doc/en/api_reference/code_inventory.md');
writeDocs(renderMarkdown({ language: 'zh', ...inventory }), 'doc/zh/api_reference/code_inventory.md');

console.log('[code_inventory] generated: doc/en/api_reference/code_inventory.md');
console.log('[code_inventory] generated: doc/zh/api_reference/code_inventory.md');
