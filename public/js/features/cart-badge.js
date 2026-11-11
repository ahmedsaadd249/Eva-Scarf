// The number of tarhas on the cart badges (header and bottom bar). Other scripts (the home slideshow, the cart
// panel) announce a new count with a 'cart:count' event.
import { $$ } from '../lib/dom.js';

export function setCartCount(count) {
  $$('[data-cart-count]').forEach((badge) => {
    badge.textContent = count;
    badge.classList.toggle('hidden', !count);
    badge.classList.remove('badge-bump');
    void badge.offsetWidth;
    badge.classList.add('badge-bump');
  });
}

export function initCartBadge() {
  window.addEventListener('cart:count', (e) => setCartCount(e.detail));
}
