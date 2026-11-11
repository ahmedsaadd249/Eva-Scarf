// Toasts: the server's messages (partials/flash.ejs) close with ✕ or by themselves (errors stay until closed),
// and showToast() pops up a new one, e.g. after adding a tarha to the cart.
import { $, $$, msg } from '../lib/dom.js';

function dismiss(toast) {
  if (!toast || toast.dataset.leaving) return;
  toast.dataset.leaving = '1';
  setTimeout(() => toast.parentElement?.remove?.() ?? toast.remove(), 320);
}

export function initToasts() {
  $$('[data-toast]').forEach((toast) => {
    $('[data-toast-close]', toast)?.addEventListener('click', () => dismiss(toast));
    if (toast.getAttribute('role') !== 'alert') setTimeout(() => dismiss(toast), 6000);
  });
}

export function showToast(text, tone = 'success') {
  const region = $('#toast-region');
  if (!region) return;
  const el = document.createElement('div');
  el.className = `toast pointer-events-auto flex max-w-md items-center gap-3 rounded-2xl px-4 py-3 shadow-float ${
    tone === 'error' ? 'bg-[#8E1238] text-white' : 'bg-ink text-white'
  }`;
  el.setAttribute('role', tone === 'error' ? 'alert' : 'status');
  const p = document.createElement('p');
  p.className = 'text-[15px]';
  p.textContent = text;
  el.append(p);
  if (tone !== 'error') {
    const link = document.createElement('a');
    link.href = '/cart';
    link.className = 'ms-2 shrink-0 rounded-full bg-white/15 px-3 py-1 text-[13px] hover:bg-white/25';
    link.textContent = msg('cart.view_cart');
    el.append(link);
  }
  region.append(el);
  setTimeout(() => {
    el.dataset.leaving = '1';
    setTimeout(() => el.remove(), 320);
  }, 3800);
}
