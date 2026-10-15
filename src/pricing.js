// All money is integer piasters (1 EGP = 100 piasters). This module is the only
// place prices and totals are calculated.

export function clampDiscount(percent) {
  const d = Math.trunc(Number(percent) || 0);
  return Math.min(90, Math.max(0, d));
}

export function finalUnitPrice(price, discountPercent = 0) {
  return Math.round((price * (100 - clampDiscount(discountPercent))) / 100);
}

/**
 * @param {{price:number, discount_percent:number, qty:number}[]} lines
 * @param {number|null} deliveryFee piasters, charged only when the cart has items;
 *   null while the customer's neighborhood (and so the fee) isn't known yet.
 */
export function computeTotals(lines, deliveryFee = 0) {
  let subtotal = 0;
  let net = 0;
  let itemCount = 0;
  for (const line of lines) {
    subtotal += line.price * line.qty;
    net += finalUnitPrice(line.price, line.discount_percent) * line.qty;
    itemCount += line.qty;
  }
  const delivery = lines.length && deliveryFee != null ? deliveryFee : 0;
  return {
    subtotal,
    discount_total: subtotal - net,
    delivery_fee: delivery,
    delivery_known: deliveryFee != null,
    total: net + delivery,
    item_count: itemCount,
  };
}

/** Parse a pounds amount typed by the owner ("450", "450.5", "1,250.00") into piasters, or null. */
export function toPiasters(input) {
  const s = String(input ?? '').trim().replace(/,/g, '');
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(s)) return null;
  const [whole, frac = ''] = s.split('.');
  return Number(whole) * 100 + Number(frac.padEnd(2, '0'));
}

export function piastersToInput(piasters) {
  return (piasters / 100).toFixed(2);
}

export function formatMoney(piasters, lang = 'ar') {
  const amount = (piasters / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return lang === 'en' ? `EGP ${amount}` : `${amount} ج.م`;
}
