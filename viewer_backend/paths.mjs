// Versioned forge artifact helpers for viewer demo

export function normalizeVer(v) {
  const s = String(v||'').trim();
  return s ? s : '3.3.7';
}

export function getForgeDistBase(ver) {
  const v = normalizeVer(ver);
  return `/dist/${v}/`;
}

export async function getVersionInfo(distBase) {
  const url = new URL('version.json', new URL(distBase, location.href));
  // cache-bust fetch for local dev
  url.searchParams.set('cb', String(Date.now()));
  try {
    const r = await fetch(url.href, { cache: 'no-store' });
    if (!r.ok) throw new Error('version.json fetch failed');
    return await r.json();
  } catch {
    return null;
  }
}

export function withCacheTag(u, vTag) {
  try {
    const url = new URL(u, location.href);
    if (vTag) url.searchParams.set('v', String(vTag));
    else url.searchParams.set('cb', String(Date.now()));
    return url.href;
  } catch {
    return u;
  }
}
