// The header's mobile menu (a drawer over a dimmed page) and search panel. Esc closes either.
import { $, $$ } from '../lib/dom.js';

export function initHeader() {
  /* ---------- Drawer (mobile menu) ---------- */
  const drawer = $('#drawer');
  const scrim = $('[data-scrim]');
  let lastFocus = null;
  function setDrawer(open) {
    if (!drawer) return;
    drawer.dataset.open = String(open);
    scrim.dataset.open = String(open);
    drawer.setAttribute('aria-hidden', String(!open));
    $$('[data-drawer-open]').forEach((b) => b.setAttribute('aria-expanded', String(open)));
    document.body.style.overflow = open ? 'hidden' : '';
    if (open) {
      lastFocus = document.activeElement;
      $('[data-drawer-close]', drawer)?.focus();
    } else {
      lastFocus?.focus?.();
    }
  }
  $$('[data-drawer-open]').forEach((b) => b.addEventListener('click', () => setDrawer(true)));
  $$('[data-drawer-close]').forEach((b) => b.addEventListener('click', () => setDrawer(false)));
  scrim?.addEventListener('click', () => setDrawer(false));

  /* ---------- Search panel ---------- */
  const searchPanel = $('#search-panel');
  function setSearch(open) {
    if (!searchPanel) return;
    searchPanel.dataset.open = String(open);
    $$('[data-search-open]').forEach((b) => b.setAttribute('aria-expanded', String(open)));
    if (open) setTimeout(() => $('#search-input')?.focus(), 60);
  }
  $$('[data-search-open]').forEach((b) =>
    b.addEventListener('click', () => setSearch(searchPanel?.dataset.open !== 'true')),
  );

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (drawer?.dataset.open === 'true') setDrawer(false);
    if (searchPanel?.dataset.open === 'true') setSearch(false);
  });
}
