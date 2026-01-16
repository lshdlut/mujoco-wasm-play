import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

const scanRoots = [
  path.join(repoRoot, 'dev'),
  path.join(repoRoot, 'tools'),
  path.join(repoRoot, 'src'),
  path.join(repoRoot, 'tests'),
];

const excludeDirs = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  'scripts',
  'local_temp',
  'local',
  'local_tools',
  'release_assets',
  'tmp',
  'coverage',
  '.cache',
  '.vite',
  '.parcel-cache',
]);

const includeExt = new Set(['.js', '.mjs', '.ts', '.tsx']);

const forbiddenPatterns = [
  {
    id: 'ua-sniff',
    message: 'UA sniffing is forbidden',
    regex: /\b(?:navigator|window\.navigator)\.userAgent\b/g,
  },
  {
    id: 'monkey-patch',
    message: 'Object.defineProperty is forbidden',
    regex: /\bObject\.defineProperty\b/g,
  },
  {
    id: 'monkey-patch',
    message: 'Object.defineProperties is forbidden',
    regex: /\bObject\.defineProperties\b/g,
  },
  {
    id: 'monkey-patch',
    message: '__proto__ usage is forbidden',
    regex: /\b__proto__\b/g,
  },
  {
    id: 'monkey-patch',
    message: 'Prototype monkey patching is forbidden',
    regex: /\bprototype\s*\.\s*[A-Za-z_$][\w$]*\s*=/g,
  },
];

function stripStringsAndComments(source) {
  let out = '';
  let state = 'code';
  let quote = null;
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    const next = source[i + 1];
    if (state === 'line') {
      if (ch === '\n') {
        state = 'code';
        out += '\n';
      } else {
        out += ' ';
      }
      continue;
    }
    if (state === 'block') {
      if (ch === '*' && next === '/') {
        state = 'code';
        out += '  ';
        i += 1;
      } else {
        out += (ch === '\n') ? '\n' : ' ';
      }
      continue;
    }
    if (state === 'string') {
      if (ch === '\\') {
        out += ' ';
        if (next !== undefined) {
          out += ' ';
          i += 1;
        }
        continue;
      }
      if (ch === quote) {
        state = 'code';
        out += ' ';
        continue;
      }
      out += (ch === '\n') ? '\n' : ' ';
      continue;
    }
    if (state === 'template') {
      if (ch === '\\') {
        out += ' ';
        if (next !== undefined) {
          out += ' ';
          i += 1;
        }
        continue;
      }
      if (ch === '`') {
        state = 'code';
        out += ' ';
        continue;
      }
      out += (ch === '\n') ? '\n' : ' ';
      continue;
    }
    if (ch === '/' && next === '/') {
      state = 'line';
      out += '  ';
      i += 1;
      continue;
    }
    if (ch === '/' && next === '*') {
      state = 'block';
      out += '  ';
      i += 1;
      continue;
    }
    if (ch === '"' || ch === '\'') {
      state = 'string';
      quote = ch;
      out += ' ';
      continue;
    }
    if (ch === '`') {
      state = 'template';
      out += ' ';
      continue;
    }
    out += ch;
  }
  return out;
}

function buildLineIndex(text) {
  const starts = [0];
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === '\n') starts.push(i + 1);
  }
  return starts;
}

function indexToLineCol(index, starts) {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (starts[mid] <= index) {
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  const line = Math.max(0, hi);
  const col = index - starts[line] + 1;
  return { line: line + 1, col: Math.max(1, col) };
}

async function walk(dir, out) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (excludeDirs.has(entry.name)) continue;
      await walk(full, out);
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name);
      if (includeExt.has(ext)) {
        if (entry.name.includes('.local.')) continue;
        out.push(full);
      }
    }
  }
}

function findCatchViolations(text) {
  const violations = [];
  const re = /\bcatch\s*\([^)]*\)\s*\{/g;
  let match = null;
  while ((match = re.exec(text))) {
    const blockStart = match.index + match[0].lastIndexOf('{');
    let depth = 0;
    let end = -1;
    for (let i = blockStart; i < text.length; i += 1) {
      const ch = text[i];
      if (ch === '{') depth += 1;
      if (ch === '}') {
        depth -= 1;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    if (end === -1) continue;
    const block = text.slice(blockStart + 1, end);
    const hasThrow = /\bthrow\b/.test(block);
    const hasStrictCatch = /\bstrictCatch\b/.test(block);
    if (!hasThrow && !hasStrictCatch) {
      violations.push({ index: match.index });
    }
    re.lastIndex = end + 1;
  }
  return violations;
}

const files = [];
for (const root of scanRoots) {
  try {
    // Some repos keep optional trees (e.g. `src/`, `tests/`) local-only.
    await walk(root, files);
  } catch (err) {
    if (err && typeof err === 'object' && err.code === 'ENOENT') continue;
    throw err;
  }
}

const issues = [];
for (const file of files) {
  const content = await readFile(file, 'utf8');
  const sanitized = stripStringsAndComments(content);
  const lineStarts = buildLineIndex(content);
  for (const rule of forbiddenPatterns) {
    const regex = new RegExp(rule.regex.source, rule.regex.flags);
    let match = null;
    while ((match = regex.exec(sanitized))) {
      const { line, col } = indexToLineCol(match.index, lineStarts);
      issues.push({
        file,
        line,
        col,
        message: rule.message,
      });
    }
  }
  const catchViolations = findCatchViolations(sanitized);
  for (const entry of catchViolations) {
    const { line, col } = indexToLineCol(entry.index, lineStarts);
    issues.push({
      file,
      line,
      col,
      message: 'catch without throw/strictCatch is forbidden',
    });
  }
}

if (issues.length) {
  console.error('Forbidden patterns detected:');
  for (const issue of issues) {
    console.error(`${issue.file}:${issue.line}:${issue.col} ${issue.message}`);
  }
  process.exitCode = 1;
}
