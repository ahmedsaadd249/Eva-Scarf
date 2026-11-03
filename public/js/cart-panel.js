// The big cart panel: slides in from the side over a dimmed page with the cart's lines, totals and "Complete
// order". Its content comes from the server (/cart/panel, partials/cart-panel.ejs), like the cart page, so
// prices are only ever calculated there. Changing a quantity or removing a tarha inside it is sent in the
// background and the panel reloads in place. Closes with ✕, "Continue shopping", the dimmed page or Esc.
const TRANSITION_MS = 450; // .cp-panel in site.css
const csrf = () => document.querySelector('meta[name="csrf-token"]')?.content || '';
const setCount = (count) => window.dispatchEvent(new CustomEvent('cart:count', { detail: count }));
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';

let openPanel = null;

/**
 * Put the panel (empty, out of sight) over the page and dim the page; then `load()` its content and `show()`
 * it. `onClose` runs once it has gone.
 */
export function createCartPanel({ onClose } = {}) {
  openPanel?.close();
  const opener = document.activeElement;
  const layer = document.createElement('div');
  layer.className = 'cp-layer';
  const backdrop = document.createElement('div');
  backdrop.className = 'cp-backdrop';
  backdrop.dataset.cpClose = '';
  const panel = document.createElement('aside');
  panel.className = 'cp-panel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  panel.setAttribute('aria-labelledby', 'cart-panel-title');
  panel.tabIndex = -1;
  layer.append(backdrop, panel);
  document.body.append(layer);
  document.documentElement.classList.add('cp-locked'); // the page behind doesn't scroll
  requestAnimationFrame(() => layer.classList.add('cp-dim'));

  let closed = false;
  let loads = 0; // numbers each load, so an older answer arriving late never replaces a newer one
  const controller = {
    layer,
    panel,
    /** Fetch the cart's current content from the server. */
    async load() {
      const mine = ++loads;
      const res = await fetch('/cart/panel', { headers: { Accept: 'text/html' }, credentials: 'same-origin' });
      const html = await res.text();
      if (mine === loads) panel.innerHTML = html;
    },
    /** Show a message at the top of the panel (e.g. "sold out"). */
    message(text, tone = 'error') {
      const box = panel.querySelector('[data-cp-message]');
      if (!box || !text) return;
      const p = document.createElement('p');
      p.className = `mt-4 rounded-xl px-4 py-3 text-[14px] ${tone === 'error' ? 'bg-[#FBE7EA] text-[#8E1238]' : 'bg-eva-mist text-eva-deep'}`;
      p.setAttribute('role', tone === 'error' ? 'alert' : 'status');
      p.textContent = text;
      box.replaceChildren(p);
    },
    /** Slide in; resolves when it is in place. */
    show() {
      layer.classList.add('cp-open');
      panel.focus({ preventScroll: true }); // the dialog itself (screen readers read its title); Tab reaches ✕
      return new Promise((r) => setTimeout(r, TRANSITION_MS));
    },
    /** The photo of a tarha's line in the panel (scrolled into view), if it is there. */
    thumb(productId) {
      const img = panel.querySelector(`[data-cart-line="${CSS.escape(String(productId))}"] img`);
      img?.scrollIntoView({ block: 'nearest' });
      return img;
    },
    close() {
      if (closed) return;
      closed = true;
      openPanel = null;
      layer.classList.remove('cp-open', 'cp-dim');
      document.removeEventListener('keydown', onKey);
      setTimeout(() => {
        layer.remove();
        if (!document.querySelector('.cp-layer')) document.documentElement.classList.remove('cp-locked');
        if (opener?.isConnected) opener.focus({ preventScroll: true });
        onClose?.();
      }, TRANSITION_MS);
    },
  };

  // Esc closes; Tab stays inside the panel while it is open.
  function onKey(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      controller.close();
    } else if (e.key === 'Tab') {
      const items = [...panel.querySelectorAll(FOCUSABLE)].filter((el) => el.offsetParent !== null);
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  }
  document.addEventListener('keydown', onKey);
  layer.addEventListener('click', (e) => {
    if (e.target.closest('[data-cp-close]')) controller.close();
  });

  // Quantity − / + and remove: in the background, one change at a time (the panel's buttons wait meanwhile);
  // the panel shows the cart as it now is, then the cart badge follows.
  // Older browsers don't say which button sent a form (e.submitter), so remember the last one tapped.
  let lastButton = null;
  let busy = false;
  panel.addEventListener('click', (e) => { lastButton = e.target.closest('button[name]'); });
  panel.addEventListener('submit', async (e) => {
    const form = e.target;
    if (!form.matches('form[action="/cart/update"], form[action="/cart/remove"]')) return;
    e.preventDefault();
    if (busy) return;
    const body = new URLSearchParams(new FormData(form));
    const button = e.submitter || (lastButton && form.contains(lastButton) ? lastButton : null);
    if (button?.name) body.set(button.name, button.value); // which button: qty − or +
    if (form.action.endsWith('/cart/update') && !body.has('qty')) return; // never guess a quantity
    busy = true;
    panel.querySelectorAll('form button').forEach((b) => { b.disabled = true; });
    try {
      const res = await fetch(form.action, { method: 'POST', headers: { Accept: 'application/json', 'x-csrf-token': csrf() }, body });
      const data = await res.json();
      await controller.load(); // new buttons replace the paused ones
      if (data.ok) setCount(data.count);
      panel.focus({ preventScroll: true });
    } catch {
      form.submit(); // no connection to the background: the ordinary way (the cart page)
    } finally {
      busy = false;
    }
  });

  openPanel = controller;
  return controller;
}
