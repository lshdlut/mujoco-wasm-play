import { strictCatch } from '../core/viewer_runtime.mjs';

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

export function setPlaySectionCollapsed(sectionEl, collapsed) {
  const el = sectionEl && typeof sectionEl.classList?.toggle === 'function' ? sectionEl : null;
  if (!el) return;
  el.classList.toggle('is-collapsed', !!collapsed);
  const toggleBtn =
    el.querySelector?.('[data-play-role="section-toggle"]')
    || el.querySelector?.('.section-toggle');
  if (toggleBtn && typeof toggleBtn.setAttribute === 'function') {
    toggleBtn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
  }
}

export function installPanelSectionDblclickDelegation(panelRoot, options = null) {
  const root = panelRoot && typeof panelRoot.addEventListener === 'function' ? panelRoot : null;
  const onToggleAll = typeof options?.onToggleAll === 'function' ? options.onToggleAll : null;
  if (!root || !onToggleAll) return () => {};
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
    onToggleAll();
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
