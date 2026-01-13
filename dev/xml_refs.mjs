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
  return {
    assetdir: read('assetdir'),
    meshdir: read('meshdir'),
    texturedir: read('texturedir'),
    hfielddir: read('hfielddir'),
  };
}

function isProbablyRemotePath(value) {
  const v = String(value ?? '').trim().toLowerCase();
  return v.startsWith('http://') || v.startsWith('https://') || v.startsWith('data:');
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
    if (isProbablyRemotePath(raw)) {
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
  for (const node of doc.querySelectorAll('texture[file]')) {
    addRef('texture', node.getAttribute('file') || '');
  }
  for (const node of doc.querySelectorAll('hfield[file]')) {
    addRef('hfield', node.getAttribute('file') || '');
  }
  // Skins are assets too; MuJoCo uses them for skinning/meshes.
  for (const node of doc.querySelectorAll('skin[file]')) {
    addRef('skin', node.getAttribute('file') || '');
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

function parseObjMtllib(objText) {
  const out = [];
  const text = typeof objText === 'string' ? objText : '';
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const parts = line.split(/\s+/);
    if (!parts.length) continue;
    if (parts[0].toLowerCase() !== 'mtllib') continue;
    for (const token of parts.slice(1)) {
      const t = token.trim();
      if (t) out.push(t);
    }
  }
  return out;
}

function parseMtlTextureRefs(mtlText) {
  const keys = new Set([
    'map_ka',
    'map_kd',
    'map_ks',
    'map_ke',
    'map_ns',
    'map_d',
    'bump',
    'map_bump',
    'disp',
    'decal',
    'norm',
  ]);
  const out = [];
  const text = typeof mtlText === 'string' ? mtlText : '';
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const parts = line.split(/\s+/);
    if (parts.length < 2) continue;
    const key = parts[0].toLowerCase();
    if (!keys.has(key)) continue;
    const candidate = parts[parts.length - 1];
    if (candidate && !candidate.startsWith('-')) {
      out.push(candidate);
    }
  }
  return out;
}

export async function buildMuJoCoBundle(xmlRel, xmlText, readFileArrayBuffer) {
  const rootRel = normaliseMuJoCoVirtualPath(xmlRel);
  if (!rootRel) throw new Error('buildMuJoCoBundle: missing xmlRel');
  if (typeof readFileArrayBuffer !== 'function') {
    throw new Error('buildMuJoCoBundle: missing readFileArrayBuffer');
  }

  const visitedXml = new Set();
  const visitedObj = new Set();
  const visitedMtl = new Set();
  const fileBuffers = new Map();
  const pending = [{ type: 'xml', rel: rootRel, text: String(xmlText ?? ''), compilerState: null }];
  const unsupported = [];

  async function ensureFileBuffer(relPath) {
    const rel = normaliseMuJoCoVirtualPath(relPath);
    if (!rel) throw new Error('buildMuJoCoBundle: missing relPath');
    if (!fileBuffers.has(rel)) {
      const buf = await readFileArrayBuffer(rel);
      fileBuffers.set(rel, buf);
    }
    return fileBuffers.get(rel) || null;
  }

  function resolveCompilerDir(baseDir, rawDir, rel, kind) {
    const raw = typeof rawDir === 'string' ? rawDir.trim() : '';
    if (!raw) return '';
    if (isProbablyRemotePath(raw) || shouldTreatAsAbsolutePath(raw)) {
      unsupported.push({
        kind: `compiler:${kind}`,
        path: raw,
        from: rel,
        remote: isProbablyRemotePath(raw),
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

  function resolveCompilerState(baseDir, localCompiler, inheritedState, rel) {
    const inherited = inheritedState && typeof inheritedState === 'object'
      ? inheritedState
      : { assetBase: baseDir, meshBase: baseDir, textureBase: baseDir, hfieldBase: baseDir };

    const rawAsset = typeof localCompiler?.assetdir === 'string' ? localCompiler.assetdir.trim() : '';
    const rawMesh = typeof localCompiler?.meshdir === 'string' ? localCompiler.meshdir.trim() : '';
    const rawTex = typeof localCompiler?.texturedir === 'string' ? localCompiler.texturedir.trim() : '';
    const rawHfield = typeof localCompiler?.hfielddir === 'string' ? localCompiler.hfielddir.trim() : '';

    const assetBase = rawAsset ? (resolveCompilerDir(baseDir, rawAsset, rel, 'assetdir') || inherited.assetBase) : inherited.assetBase;
    const meshBase = rawMesh
      ? (resolveCompilerDir(assetBase, rawMesh, rel, 'meshdir') || inherited.meshBase)
      : (rawAsset ? assetBase : inherited.meshBase);
    const textureBase = rawTex
      ? (resolveCompilerDir(assetBase, rawTex, rel, 'texturedir') || inherited.textureBase)
      : (rawAsset ? assetBase : inherited.textureBase);
    const hfieldBase = rawHfield
      ? (resolveCompilerDir(assetBase, rawHfield, rel, 'hfielddir') || inherited.hfieldBase)
      : (rawAsset ? assetBase : inherited.hfieldBase);

    return { assetBase, meshBase, textureBase, hfieldBase };
  }

  function resolveRefPath(baseDir, compilerState, ref, rel) {
    const rawPath = ref?.path ? String(ref.path) : '';
    if (!rawPath) return '';
    if (ref.remote || ref.absolute) {
      unsupported.push({ ...ref, from: rel });
      return '';
    }
    const base = (() => {
      switch (ref.kind) {
        case 'include':
          return baseDir;
        case 'model':
          return compilerState?.assetBase ?? baseDir;
        case 'mesh':
          return compilerState?.meshBase ?? baseDir;
        case 'texture':
          return compilerState?.textureBase ?? baseDir;
        case 'hfield':
          return compilerState?.hfieldBase ?? baseDir;
        case 'skin':
          return compilerState?.assetBase ?? baseDir;
        default:
          return baseDir;
      }
    })();
    const resolved = joinMuJoCoRelativePath(base, rawPath);
    if (!resolved) return '';
    if (isOutsideRoot(resolved)) {
      unsupported.push({ ...ref, path: resolved, from: rel, outsideRoot: true });
      return '';
    }
    return resolved;
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
      let compilerState = resolveCompilerState(baseDir, parsed.compiler, item.compilerState, rel);

      // MuJoCo `<include>` behaves like textual insertion; compiler directives inside an included file
      // (e.g. `scene.xml`) affect subsequent file path resolution in the including XML.
      // We approximate this by parsing includes first and "rolling forward" the compiler state.
      for (const ref of parsed.refs ?? []) {
        if (ref.kind !== 'include') continue;
        const resolvedRel = resolveRefPath(baseDir, compilerState, ref, rel);
        if (!resolvedRel) continue;
        await ensureFileBuffer(resolvedRel);
        const buf = fileBuffers.get(resolvedRel) || null;
        const includeText = decodeTextFromArrayBuffer(buf);
        if (!visitedXml.has(resolvedRel)) {
          pending.push({ type: 'xml', rel: resolvedRel, text: includeText, compilerState });
        }
        const includeParsed = parseMuJoCoDirectFileRefs(includeText);
        const includeDir = dirnamePosix(resolvedRel);
        compilerState = resolveCompilerState(includeDir, includeParsed.compiler, compilerState, resolvedRel);
      }

      for (const ref of parsed.refs ?? []) {
        const resolvedRel = resolveRefPath(baseDir, compilerState, ref, rel);
        if (!resolvedRel) continue;
        await ensureFileBuffer(resolvedRel);

        const lower = resolvedRel.toLowerCase();
        if (ref.kind === 'include') {
          // handled above (compiler propagation + queue)
          continue;
        }
        if (ref.kind === 'model' && !visitedXml.has(resolvedRel)) {
          const buf = fileBuffers.get(resolvedRel) || null;
          const modelText = decodeTextFromArrayBuffer(buf);
          // MuJoCo loads `<model file="...">` as a separate model asset; do not inherit compiler dirs.
          pending.push({ type: 'xml', rel: resolvedRel, text: modelText, compilerState: null });
        } else if (ref.kind === 'mesh' && lower.endsWith('.obj')) {
          pending.push({ type: 'obj', rel: resolvedRel });
        }
      }
      continue;
    }

    if (item.type === 'obj') {
      if (visitedObj.has(rel)) continue;
      visitedObj.add(rel);
      const buf = await ensureFileBuffer(rel);
      if (!(buf instanceof ArrayBuffer)) continue;
      const objText = decodeTextFromArrayBuffer(buf);
      const baseDir = dirnamePosix(rel);
      for (const mtlName of parseObjMtllib(objText)) {
        const raw = String(mtlName ?? '').trim();
        if (!raw) continue;
        if (isProbablyRemotePath(raw) || shouldTreatAsAbsolutePath(raw)) {
          unsupported.push({
            kind: 'mtllib',
            path: raw,
            from: rel,
            remote: isProbablyRemotePath(raw),
            absolute: shouldTreatAsAbsolutePath(raw),
          });
          continue;
        }
        const resolvedMtl = joinMuJoCoRelativePath(baseDir, raw);
        if (!resolvedMtl) continue;
        if (isOutsideRoot(resolvedMtl)) {
          unsupported.push({ kind: 'mtllib', path: resolvedMtl, from: rel, outsideRoot: true });
          continue;
        }
        await ensureFileBuffer(resolvedMtl);
        if (resolvedMtl.toLowerCase().endsWith('.mtl')) {
          pending.push({ type: 'mtl', rel: resolvedMtl });
        }
      }
      continue;
    }

    if (item.type === 'mtl') {
      if (visitedMtl.has(rel)) continue;
      visitedMtl.add(rel);
      const buf = await ensureFileBuffer(rel);
      if (!(buf instanceof ArrayBuffer)) continue;
      const mtlText = decodeTextFromArrayBuffer(buf);
      const baseDir = dirnamePosix(rel);
      for (const texName of parseMtlTextureRefs(mtlText)) {
        const raw = String(texName ?? '').trim();
        if (!raw) continue;
        if (isProbablyRemotePath(raw) || shouldTreatAsAbsolutePath(raw)) {
          unsupported.push({
            kind: 'mtl:texture',
            path: raw,
            from: rel,
            remote: isProbablyRemotePath(raw),
            absolute: shouldTreatAsAbsolutePath(raw),
          });
          continue;
        }
        const resolvedTex = joinMuJoCoRelativePath(baseDir, raw);
        if (!resolvedTex) continue;
        if (isOutsideRoot(resolvedTex)) {
          unsupported.push({ kind: 'mtl:texture', path: resolvedTex, from: rel, outsideRoot: true });
          continue;
        }
        await ensureFileBuffer(resolvedTex);
      }
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
