import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const shipRoot = repoRoot;

const textExts = new Set([
  '.mjs',
  '.js',
  '.ts',
  '.json',
  '.md',
  '.py',
  '.c',
  '.cc',
  '.h',
  '.html',
  '.css',
  '.txt',
]);

const shipExcludeDirs = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  'local_tools',
  'local',
  '.cache',
  '.vite',
  '.parcel-cache',
  'spec',
  'tools',
  'tests',
  'scripts',
]);

function isTextFile(filePath) {
  return textExts.has(path.extname(filePath).toLowerCase());
}

function isGeneratedFile(relPath, fullPath) {
  const normalized = relPath.replace(/\\/g, '/');
  if (normalized.includes('/generated/')) return true;
  const handle = readFileSync(fullPath, 'utf8');
  const head = handle.split(/\r?\n/, 3).join('\n');
  return /auto-generated/i.test(head);
}

function countLines(filePath) {
  const content = readFileSync(filePath, 'utf8');
  if (!content) return 0;
  return content.split(/\r?\n/).length;
}

function listTrackedFiles() {
  const out = execFileSync('git', ['ls-files'], { cwd: repoRoot });
  return out
    .toString('utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.replace(/\\/g, '/'));
}

function walkDir(rootDir, relBase = '') {
  const entries = readdirSync(rootDir, { withFileTypes: true });
  const results = [];
  for (const entry of entries) {
    const fullPath = path.join(rootDir, entry.name);
    const relPath = relBase ? path.join(relBase, entry.name) : entry.name;
    if (entry.isDirectory()) {
      const dirName = entry.name;
      if (shipExcludeDirs.has(dirName)) continue;
      results.push(...walkDir(fullPath, relPath));
    } else if (entry.isFile()) {
      results.push({ fullPath, relPath });
    }
  }
  return results;
}

function isShipPath(relPath) {
  const normalized = relPath.replace(/\\/g, '/');
  return (
    normalized === 'index.html'
    || normalized === 'favicon.ico'
    || normalized.startsWith('app/')
    || normalized.startsWith('backend/')
    || normalized.startsWith('bridge/')
    || normalized.startsWith('core/')
    || normalized.startsWith('environment/')
    || normalized.startsWith('renderer/')
    || normalized.startsWith('ui/')
    || normalized.startsWith('worker/')
  );
}

function getShipRelPath(relPath) {
  return relPath.replace(/\\/g, '/');
}

const trackedFiles = new Set(listTrackedFiles());
let repoLoc = 0;

for (const relPath of trackedFiles) {
  if (!isTextFile(relPath)) continue;
  const fullPath = path.join(repoRoot, relPath);
  if (!existsSync(fullPath)) continue;
  repoLoc += countLines(fullPath);
}

let shipHandLoc = 0;
let shipGeneratedLoc = 0;
const shipFiles = walkDir(shipRoot, '');

for (const { fullPath, relPath } of shipFiles) {
  const normalized = relPath.replace(/\\/g, '/');
  if (!isShipPath(normalized)) continue;
  const shipRel = getShipRelPath(normalized);
  if (!isTextFile(normalized)) continue;
  const generated = isGeneratedFile(normalized, fullPath);
  const tracked = trackedFiles.has(normalized);
  if (generated) {
    shipGeneratedLoc += countLines(fullPath);
  } else if (tracked) {
    shipHandLoc += countLines(fullPath);
  }
}

const shipLoc = shipHandLoc + shipGeneratedLoc;

console.log(`repo_loc=${repoLoc}`);
console.log(`ship_hand_loc=${shipHandLoc}`);
console.log(`ship_generated_loc=${shipGeneratedLoc}`);
console.log(`ship_loc=${shipLoc}`);
