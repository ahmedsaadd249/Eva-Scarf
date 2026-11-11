// "Add to cart" forms (product page, product cards) are sent in the background: the badge updates and a toast
// says so, without leaving the page. Without a connection for that, the form is sent the ordinary way.
import { $, $$, csrf } from '../lib/dom.js';
import { setCartCount } from './cart-badge.js';
import { showToast } from './toasts.js';

export function initAddToCart() {
  $$('form[data-add-to-cart]').forEach((form) => {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const button = $('button:not([type=button])', form) || form.querySelector('button');
      if (button?.disabled) return;
      button?.setAttribute('aria-busy', 'true');
      try {
        const res = await fetch(form.action, {
          method: 'POST',
          headers: { Accept: 'application/json', 'x-csrf-token': csrf() },
          body: new URLSearchParams(new FormData(form)),
        });
        const data = await res.json();
        if (data.ok) setCartCount(data.count);
        showToast(data.message, data.ok ? 'success' : 'error');
      } catch {
        form.submit();
      } finally {
        button?.removeAttribute('aria-busy');
      }
    });
  });
}
