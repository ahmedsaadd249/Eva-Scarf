// Dashboard → product form: what the customer pays (the price minus the discount %), updated while typing.
import { $ } from '../../lib/dom.js';

export function initFinalPrice(finalOut) {
  const priceInput = $('[data-price]');
  const discountInput = $('[data-discount]');
  if (!priceInput) return;
  const fmt = (piasters) => {
    const amount = (piasters / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return finalOut.dataset.lang === 'en' ? `EGP ${amount}` : `${amount} ج.م`;
  };
  const update = () => {
    const price = Math.round(Number(String(priceInput.value).replace(/,/g, '')) * 100);
    const d = Math.min(90, Math.max(0, Math.trunc(Number(discountInput.value) || 0)));
    finalOut.textContent = price > 0 ? fmt(Math.round((price * (100 - d)) / 100)) : '—';
  };
  priceInput.addEventListener('input', update);
  discountInput.addEventListener('input', update);
  update();
}
