// Panel section collapse persistence + DOM helpers.
// Keep behaviour identical; do not swallow errors.

import { logWarn, strictCatch } from '../core/viewer_runtime.mjs';

const UI_STATE_VERSION = 1;
const UI_SECTION_COLLAPSED_STORAGE_KEY = `play:ui:v${UI_STATE_VERSION}:section_collapsed`;
let sectionCollapsedCache = null;
let sectionCollapsedCacheDirty = false;
let sectionCollapsedFlushQueued = false;
const enqueueSectionCollapsedFlush =
  (typeof queueMicrotask === 'function')
    ? queueMicrotask
    : (fn) => Promise.resolve().then(fn);

function sectionCollapsedMapKey(panel, sectionId) {
  const p = String(panel || '').trim();
  const sid = String(sectionId || '').trim();
  return JSON.stringify([p, sid]);
}

function getSectionCollapsedCache() {
  if (sectionCollapsedCache) return sectionCollapsedCache;
  sectionCollapsedCache = {};
  const storage = (typeof window !== 'undefined' && window?.localStorage) ? window.localStorage : null;
  if (!storage) return sectionCollapsedCache;
  try {
    const raw = storage.getItem(UI_SECTION_COLLAPSED_STORAGE_KEY);
    if (!raw) return sectionCollapsedCache;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return sectionCollapsedCache;
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === 'boolean') {
        sectionCollapsedCache[key] = value;
      }
    }
  } catch (err) {
    logWarn('[ui] section collapsed state load failed', err);
    strictCatch(err, 'main:ui_section_collapsed_load', { allow: true });
  }
  return sectionCollapsedCache;
}

function flushSectionCollapsedCache() {
  if (!sectionCollapsedCacheDirty) return;
  sectionCollapsedCacheDirty = false;
  const storage = (typeof window !== 'undefined' && window?.localStorage) ? window.localStorage : null;
  if (!storage) return;
  try {
    const payload = sectionCollapsedCache ? JSON.stringify(sectionCollapsedCache) : '{}';
    storage.setItem(UI_SECTION_COLLAPSED_STORAGE_KEY, payload);
  } catch (err) {
    logWarn('[ui] section collapsed state save failed', err);
    strictCatch(err, 'main:ui_section_collapsed_save', { allow: true });
  }
}

function queueSectionCollapsedFlush() {
  if (sectionCollapsedFlushQueued) return;
  sectionCollapsedFlushQueued = true;
  enqueueSectionCollapsedFlush(() => {
    sectionCollapsedFlushQueued = false;
    flushSectionCollapsedCache();
  });
}

export function readPersistedSectionCollapsed(panel, sectionId) {
  const p = String(panel || '').trim();
  const sid = String(sectionId || '').trim();
  if (!p || !sid) return null;
  const cache = getSectionCollapsedCache();
  const key = sectionCollapsedMapKey(p, sid);
  if (!Object.prototype.hasOwnProperty.call(cache, key)) return null;
  const value = cache[key];
  return typeof value === 'boolean' ? value : null;
}

export function writePersistedSectionCollapsed(panel, sectionId, collapsed) {
  const p = String(panel || '').trim();
  const sid = String(sectionId || '').trim();
  if (!p || !sid) return;
  const cache = getSectionCollapsedCache();
  const key = sectionCollapsedMapKey(p, sid);
  cache[key] = !!collapsed;
  sectionCollapsedCacheDirty = true;
  queueSectionCollapsedFlush();
}

export function resolvePlayPanelId(element) {
  const el = element && typeof element.closest === 'function' ? element : null;
  const panelRoot = el ? el.closest('[data-play-panel], [data-testid="panel-left"], [data-testid="panel-right"]') : null;
  const explicit = panelRoot?.getAttribute?.('data-play-panel');
  if (explicit === 'left' || explicit === 'right') return explicit;
  const testId = panelRoot?.getAttribute?.('data-testid');
  if (testId === 'panel-left') return 'left';
  if (testId === 'panel-right') return 'right';
  return null;
}

export function setPlaySectionCollapsed(sectionEl, collapsed, options = null) {
  const persistState = options?.persist !== false;
  const flush = options?.flush === true;
  const panelOverride = options?.panel;
  const el = sectionEl && typeof sectionEl.classList?.toggle === 'function' ? sectionEl : null;
  if (!el) return;
  el.classList.toggle('is-collapsed', !!collapsed);
  const toggleBtn =
    el.querySelector?.('[data-play-role="section-toggle"]')
    || el.querySelector?.('.section-toggle');
  if (toggleBtn && typeof toggleBtn.setAttribute === 'function') {
    toggleBtn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
  }
  if (persistState) {
    const panel =
      (panelOverride === 'left' || panelOverride === 'right')
        ? panelOverride
        : resolvePlayPanelId(el);
    const sectionId =
      el.getAttribute?.('data-play-section-id')
      || el.dataset?.sectionId
      || '';
    if (panel && sectionId) {
      writePersistedSectionCollapsed(panel, sectionId, !!collapsed);
      if (flush) flushSectionCollapsedCache();
    }
  }
}

export function toggleAllPlaySections(panelRoot, options = null) {
  const root = panelRoot && typeof panelRoot.querySelectorAll === 'function' ? panelRoot : null;
  const overrideCollapsed = options?.nextCollapsed;
  const forced = typeof overrideCollapsed === 'boolean' ? overrideCollapsed : null;
  if (!root) return { changed: 0, collapsed: forced };
  const selector = options?.selector || '[data-play-role="section"]';
  const sections = root.querySelectorAll(selector);
  if (sections.length === 0) return { changed: 0, collapsed: forced };
  const panel = resolvePlayPanelId(root);
  let collapseAll = forced;
  if (collapseAll == null) {
    let allCollapsed = true;
    for (let i = 0; i < sections.length; i += 1) {
      const sec = sections[i];
      if (!sec.classList.contains('is-collapsed')) {
        allCollapsed = false;
        break;
      }
    }
    collapseAll = !allCollapsed;
  }
  let changed = 0;
  for (let i = 0; i < sections.length; i += 1) {
    const sec = sections[i];
    const wasCollapsed = sec.classList.contains('is-collapsed');
    if (wasCollapsed === collapseAll) continue;
    setPlaySectionCollapsed(sec, collapseAll, { panel });
    changed += 1;
  }
  return { changed, collapsed: collapseAll };
}

export function installPanelSectionDblclickDelegation(panelRoot, options = null) {
  const root = panelRoot && typeof panelRoot.addEventListener === 'function' ? panelRoot : null;
  if (!root) return () => {};
  const selector = options?.headerSelector || '[data-play-role="section-header"]';
  const resetSelector = options?.resetSelector || '[data-play-role="section-reset"]';
  const handler = (event) => {
    const target = event?.target;
    const el = target && typeof target.closest === 'function' ? target : null;
    if (!el) return;
    const header = el.closest(selector);
    if (!header) return;
    if (resetSelector) {
      const reset = el.closest(resetSelector);
      if (reset && header.contains(reset)) return;
    }
    event.preventDefault();
    toggleAllPlaySections(root);
  };
  root.addEventListener('dblclick', handler);
  return () => {
    try {
      root.removeEventListener('dblclick', handler);
    } catch (err) {
      strictCatch(err, 'main:panel_dblclick_cleanup', { allow: true });
    }
  };
}
