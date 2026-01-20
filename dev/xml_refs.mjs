// Minimal MuJoCo XML reference helpers (direct references only).
// Keep behaviour audit-friendly; do not introduce network fetching here.

function normaliseSlashes(value) {
  return String(value ?? '').trim().replaceAll('\\', '/');
}

function trimTrailingSlash(value) {
  const v = normaliseSlashes(value);
  return v.endsWith('/') ? v.replace(/\/+$/, '') : v;
}

function normalisePosixPath(value) {
  const raw = normaliseSlashes(value);
  const isAbs = raw.startsWith('/');
  const parts = raw.split('/').filter((part) => part.length);
  const out = [];
  for (const part of parts) {
    if (part === '.') continue;
    if (part === '..') {
      if (out.length && out[out.length - 1] !== '..') {
        out.pop();
      } else {
        out.push('..');
      }
      continue;
    }
    out.push(part);
  }
  const joined = out.join('/');
  if (!joined) return isAbs ? '/' : '';
  return isAbs ? `/${joined}` : joined;
}

function parseXmlOrThrow(xmlText) {
  if (typeof DOMParser !== 'function') {
    throw new Error('DOMParser unavailable');
  }
  const parser = new DOMParser();
  const doc = parser.parseFromString(String(xmlText ?? ''), 'text/xml');
  const err = doc.getElementsByTagName('parsererror')[0];
  if (err) {
    throw new Error('Invalid XML');
  }
  return doc;
}

function readCompilerDirs(doc) {
  const compiler = doc.querySelector('compiler');
  const read = (attr) => {
    const raw = compiler?.getAttribute?.(attr);
    if (typeof raw !== 'string' || !raw.trim()) return '';
    return trimTrailingSlash(raw);
  };
  const readBool = (attr) => {
    const raw = compiler?.getAttribute?.(attr);
    if (typeof raw !== 'string' || !raw.trim()) return null;
    const token = raw.trim().toLowerCase();
    if (token === 'true' || token === '1' || token === 'yes') return true;
    if (token === 'false' || token === '0' || token === 'no') return false;
    return null;
  };
  return {
    assetdir: read('assetdir'),
    meshdir: read('meshdir'),
    texturedir: read('texturedir'),
    strippath: readBool('strippath'),
  };
}

function isInlineDataPath(value) {
  const v = String(value ?? '').trim().toLowerCase();
  return v.startsWith('data:');
}

function isRemotePath(value) {
  const v = String(value ?? '').trim().toLowerCase();
  return v.startsWith('http://') || v.startsWith('https://');
}

function shouldTreatAsAbsolutePath(value) {
  const v = normaliseSlashes(value);
  if (v.startsWith('/')) return true;
  return /^[a-zA-Z]:\//.test(v);
}

export function parseMuJoCoDirectFileRefs(xmlText) {
  const doc = parseXmlOrThrow(xmlText);
  const compiler = readCompilerDirs(doc);
  const refs = [];

  const addRef = (kind, fileValue) => {
    const raw = normaliseSlashes(fileValue);
    if (!raw) return;
    if (isInlineDataPath(raw)) {
      return;
    }
    if (isRemotePath(raw)) {
      refs.push({ kind, path: raw, remote: true });
      return;
    }
    if (shouldTreatAsAbsolutePath(raw)) {
      refs.push({ kind, path: raw, absolute: true });
      return;
    }
    const combined = normalisePosixPath(raw);
    if (!combined) return;
    refs.push({ kind, path: combined });
  };

  for (const node of doc.querySelectorAll('include[file]')) {
    addRef('include', node.getAttribute('file') || '');
  }
  for (const node of doc.querySelectorAll('model[file]')) {
    addRef('model', node.getAttribute('file') || '');
  }
  for (const node of doc.querySelectorAll('mesh[file]')) {
    addRef('mesh', node.getAttribute('file') || '');
  }
  // Flex components can reference mesh assets via `file=...` as well.
  for (const node of doc.querySelectorAll('flexcomp[file]')) {
    addRef('mesh', node.getAttribute('file') || '');
  }
  for (const node of doc.querySelectorAll('texture')) {
    addRef('texture', node.getAttribute('file') || '');
    addRef('texture', node.getAttribute('fileright') || '');
    addRef('texture', node.getAttribute('fileleft') || '');
    addRef('texture', node.getAttribute('fileup') || '');
    addRef('texture', node.getAttribute('filedown') || '');
    addRef('texture', node.getAttribute('filefront') || '');
    addRef('texture', node.getAttribute('fileback') || '');
  }
  for (const node of doc.querySelectorAll('hfield[file]')) {
    addRef('hfield', node.getAttribute('file') || '');
  }
  // Skin file paths are resolved via meshdir (like meshes).
  for (const node of doc.querySelectorAll('skin[file]')) {
    addRef('mesh', node.getAttribute('file') || '');
  }

  return { compiler, refs };
}

export function normaliseMuJoCoVirtualPath(value) {
  const v = normalisePosixPath(normaliseSlashes(value));
  if (!v || v === '.') return '';
  return v.startsWith('/') ? v.slice(1) : v;
}

export function joinMuJoCoRelativePath(baseDir, relPath) {
  const base = normaliseMuJoCoVirtualPath(baseDir);
  const rel = normaliseMuJoCoVirtualPath(relPath);
  if (!base) return rel;
  if (!rel) return base;
  return normalisePosixPath(`${base}/${rel}`);
}

function decodeTextFromArrayBuffer(buf) {
  if (!(buf instanceof ArrayBuffer)) return '';
  if (typeof TextDecoder !== 'function') {
    throw new Error('TextDecoder unavailable');
  }
  return new TextDecoder('utf-8', { fatal: false }).decode(new Uint8Array(buf));
}

function dirnamePosix(relPath) {
  const rel = normaliseMuJoCoVirtualPath(relPath);
  if (!rel) return '';
  const idx = rel.lastIndexOf('/');
  return idx >= 0 ? rel.slice(0, idx) : '';
}

function isOutsideRoot(relPath) {
  return relPath === '..' || relPath.startsWith('../');
}

export async function buildMuJoCoBundle(xmlRel, xmlText, readFileArrayBuffer) {
  const rootRel = normaliseMuJoCoVirtualPath(xmlRel);
  if (!rootRel) throw new Error('buildMuJoCoBundle: missing xmlRel');
  if (typeof readFileArrayBuffer !== 'function') {
    throw new Error('buildMuJoCoBundle: missing readFileArrayBuffer');
  }

  const visitedXml = new Set();
  const fileBuffers = new Map();
  const rootModelDir = dirnamePosix(rootRel);
  const pending = [{
    type: 'xml',
    rel: rootRel,
    text: String(xmlText ?? ''),
    compilerState: null,
    modelDir: rootModelDir,
    fromInclude: false,
  }];
  const unsupported = [];

  function basenamePosix(relPath) {
    const raw = normalisePosixPath(normaliseSlashes(relPath));
    if (!raw) return '';
    const idx = raw.lastIndexOf('/');
    return idx >= 0 ? raw.slice(idx + 1) : raw;
  }

  async function ensureFileBufferForCandidates(relPaths, context = null) {
    const list = Array.isArray(relPaths) ? relPaths : [relPaths];
    const tried = [];
    let lastErr = null;

    for (const entry of list) {
      const rel = normaliseMuJoCoVirtualPath(entry);
      if (!rel) continue;
      if (fileBuffers.has(rel)) return rel;
      tried.push(rel);
      try {
        const buf = await readFileArrayBuffer(rel);
        fileBuffers.set(rel, buf);
        return rel;
      } catch (err) {
        lastErr = err;
      }
    }

    const label = context && typeof context === 'object' ? context.label : '';
    const from = context && typeof context === 'object' ? context.from : '';
    const triedLabel = tried.length ? tried.join(', ') : '(none)';
    const detail = lastErr ? ` Last error: ${String(lastErr?.message || lastErr)}` : '';
    const suffix = from ? ` (from ${from})` : '';
    throw new Error(`${label || 'Missing file'}${suffix}. Tried: ${triedLabel}.${detail}`);
  }

  function resolveCompilerDir(baseDir, rawDir, rel, kind) {
    const raw = typeof rawDir === 'string' ? rawDir.trim() : '';
    if (!raw) return '';
    if (isInlineDataPath(raw) || isRemotePath(raw) || shouldTreatAsAbsolutePath(raw)) {
      unsupported.push({
        kind: `compiler:${kind}`,
        path: raw,
        from: rel,
        remote: isInlineDataPath(raw) || isRemotePath(raw),
        absolute: shouldTreatAsAbsolutePath(raw),
      });
      return '';
    }
    const resolved = joinMuJoCoRelativePath(baseDir, raw);
    if (!resolved) return '';
    if (isOutsideRoot(resolved)) {
      unsupported.push({ kind: `compiler:${kind}`, path: resolved, from: rel, outsideRoot: true });
      return '';
    }
    return resolved;
  }

  function resolveCompilerState(modelDir, localCompiler, inheritedState, rel) {
    const inherited = inheritedState && typeof inheritedState === 'object'
      ? inheritedState
      : {
        assetDir: '',
        meshDir: '',
        textureDir: '',
        strippath: false,
        assetBase: modelDir,
        meshBase: modelDir,
        textureBase: modelDir,
      };

    let assetDir = inherited.assetDir || '';
    let meshDir = inherited.meshDir || '';
    let textureDir = inherited.textureDir || '';
    let strippath = !!inherited.strippath;

    const rawAsset = typeof localCompiler?.assetdir === 'string' ? localCompiler.assetdir.trim() : '';
    const rawMesh = typeof localCompiler?.meshdir === 'string' ? localCompiler.meshdir.trim() : '';
    const rawTex = typeof localCompiler?.texturedir === 'string' ? localCompiler.texturedir.trim() : '';
    if (rawAsset) assetDir = rawAsset;
    if (rawMesh) meshDir = rawMesh;
    if (rawTex) textureDir = rawTex;
    if (typeof localCompiler?.strippath === 'boolean') {
      strippath = localCompiler.strippath;
    }

    const assetBase = assetDir ? (resolveCompilerDir(modelDir, assetDir, rel, 'assetdir') || modelDir) : modelDir;
    const meshBase = meshDir ? (resolveCompilerDir(modelDir, meshDir, rel, 'meshdir') || assetBase) : assetBase;
    const textureBase = textureDir ? (resolveCompilerDir(modelDir, textureDir, rel, 'texturedir') || assetBase) : assetBase;

    return { assetDir, meshDir, textureDir, strippath, assetBase, meshBase, textureBase };
  }

  function resolveRefCandidates(modelDir, baseDir, compilerState, ref, rel, { fallbackToBaseDir } = {}) {
    const rawPath = ref?.path ? String(ref.path) : '';
    if (!rawPath) return [];
    if (ref.remote || ref.absolute) {
      unsupported.push({ ...ref, from: rel });
      return [];
    }

    const candidates = [];
    const outsideRoot = [];

    if (ref.kind === 'include') {
      candidates.push(joinMuJoCoRelativePath(modelDir, rawPath));
      candidates.push(joinMuJoCoRelativePath(baseDir, rawPath));
    } else if (ref.kind === 'model') {
      candidates.push(joinMuJoCoRelativePath(modelDir, rawPath));
      if (fallbackToBaseDir) candidates.push(joinMuJoCoRelativePath(baseDir, rawPath));
    } else {
      const stripped = compilerState?.strippath ? basenamePosix(rawPath) : rawPath;
      const primaryBase = (() => {
        switch (ref.kind) {
          case 'mesh':
          case 'hfield':
            return compilerState?.meshBase ?? modelDir;
          case 'texture':
            return compilerState?.textureBase ?? modelDir;
          default:
            return modelDir;
        }
      })();
      candidates.push(joinMuJoCoRelativePath(primaryBase, stripped));
      if (fallbackToBaseDir) candidates.push(joinMuJoCoRelativePath(baseDir, stripped));
    }

    const out = [];
    const seen = new Set();
    for (const entry of candidates) {
      const resolved = normaliseMuJoCoVirtualPath(entry);
      if (!resolved) continue;
      if (isOutsideRoot(resolved)) {
        outsideRoot.push(resolved);
        continue;
      }
      if (seen.has(resolved)) continue;
      seen.add(resolved);
      out.push(resolved);
    }

    if (!out.length && outsideRoot.length) {
      unsupported.push({ ...ref, path: outsideRoot[0], from: rel, outsideRoot: true });
    }

    return out;
  }

  while (pending.length) {
    const item = pending.pop();
    const rel = item?.rel ? normaliseMuJoCoVirtualPath(item.rel) : '';
    if (!rel) continue;

    if (item.type === 'xml') {
      if (visitedXml.has(rel)) continue;
      visitedXml.add(rel);

      const parsed = parseMuJoCoDirectFileRefs(item.text);
      const baseDir = dirnamePosix(rel);
      const modelDir = typeof item?.modelDir === 'string' ? item.modelDir : rootModelDir;
      const fromInclude = !!item?.fromInclude;
      let compilerState = resolveCompilerState(modelDir, parsed.compiler, item.compilerState, rel);

      // MuJoCo `<include>` behaves like textual insertion; compiler directives inside an included file
      // (e.g. `scene.xml`) affect subsequent file path resolution in the including XML.
      // We approximate this by parsing includes first and "rolling forward" the compiler state.
      for (const ref of parsed.refs ?? []) {
        if (ref.kind !== 'include') continue;
        const candidates = resolveRefCandidates(modelDir, baseDir, compilerState, ref, rel, { fallbackToBaseDir: true });
        if (!candidates.length) continue;
        const resolvedRel = await ensureFileBufferForCandidates(candidates, { label: 'Missing include file', from: rel });
        const buf = fileBuffers.get(resolvedRel) || null;
        const includeText = decodeTextFromArrayBuffer(buf);
        if (!visitedXml.has(resolvedRel)) {
          pending.push({
            type: 'xml',
            rel: resolvedRel,
            text: includeText,
            compilerState,
            modelDir,
            fromInclude: true,
          });
        }
        const includeParsed = parseMuJoCoDirectFileRefs(includeText);
        compilerState = resolveCompilerState(modelDir, includeParsed.compiler, compilerState, resolvedRel);
      }

      for (const ref of parsed.refs ?? []) {
        if (ref.kind === 'include') continue;
        const candidates = resolveRefCandidates(modelDir, baseDir, compilerState, ref, rel, {
          fallbackToBaseDir: fromInclude,
        });
        if (!candidates.length) continue;
        const resolvedRel = await ensureFileBufferForCandidates(candidates, { label: 'Missing referenced file', from: rel });
        if (ref.kind === 'model' && !visitedXml.has(resolvedRel)) {
          const buf = fileBuffers.get(resolvedRel) || null;
          const modelText = decodeTextFromArrayBuffer(buf);
          // MuJoCo loads `<model file="...">` as a separate model asset; do not inherit compiler dirs.
          pending.push({
            type: 'xml',
            rel: resolvedRel,
            text: modelText,
            compilerState: null,
            modelDir: dirnamePosix(resolvedRel),
            fromInclude: false,
          });
        }
      }
      continue;
    }
  }

  if (unsupported.length) {
    const outsideRoot = unsupported.filter((r) => r && r.outsideRoot);

    const formatSample = (items) => {
      const sample = items.slice(0, 3).map((r) => r.path).filter(Boolean);
      const suffix = items.length > 3 ? ` (+${items.length - 3} more)` : '';
      return { sample, suffix };
    };

    if (outsideRoot.length) {
      const { sample, suffix } = formatSample(outsideRoot);
      let maxUp = 0;
      const expectedDirs = new Set();
      for (const entry of outsideRoot) {
        let token = normaliseSlashes(entry?.path);
        let up = 0;
        while (token === '..' || token.startsWith('../')) {
          up += 1;
          token = token === '..' ? '' : token.slice(3);
        }
        if (up > maxUp) maxUp = up;
        const first = token.split('/').filter(Boolean)[0];
        if (first) expectedDirs.add(first);
      }
      const levelHint = maxUp === 1 ? '1 level' : `${maxUp} levels`;
      const dirHint = expectedDirs.size
        ? ` (expected to find: ${Array.from(expectedDirs).slice(0, 3).join(', ')}${expectedDirs.size > 3 ? ` +${expectedDirs.size - 3} more` : ''})`
        : '';
      throw new Error(
        `Selected folder is too narrow.\n` +
          `Ref escapes folder: ${sample.join(', ')}${suffix}\n` +
          `Select a folder ${levelHint} higher${dirHint}.`,
      );
    }

    const { sample, suffix } = formatSample(unsupported);
    throw new Error(`Unsupported file reference(s): ${sample.join(', ')}${suffix}`);
  }

  const files = [];
  for (const [relPath, buf] of fileBuffers.entries()) {
    files.push({ path: `/mem/${relPath}`, data: buf });
  }
  return { xmlRel: rootRel, files };
}
