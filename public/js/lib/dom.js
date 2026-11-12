// Helpers every browser script shares: finding elements, the page's translated messages, its CSRF token and
// its direction. Pages are rendered by the server, so these are read from the page itself.
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

// Texts for messages made in the browser (the layouts put them in #client-i18n).
const messages = (() => {
  try { return JSON.parse($('#client-i18n')?.textContent || '{}'); } catch { return {}; }
})();
export const msg = (key) => messages[key] || key;

export const csrf = () => $('meta[name="csrf-token"]')?.content || '';
export const isRtl = document.documentElement.dir === 'rtl';
