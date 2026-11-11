// All money is integer piasters (1 EGP = 100 piasters). This module is the only
// place prices and totals are calculated.

export function clampDiscount(percent) {
  const d = Math.trunc(Number(percent) || 0);
  return Math.min(90, Math.max(0, d));
}

export function finalUnitPrice(price, discountPercent = 0) {
  return Math.round((price * (100 - clampDiscount(discountPercent))) / 100);
}

/** A copy of an offer as it applied to a cart or order (stored on the order). */
function offerSnapshot(offer, amount) {
  const { id, type, name_ar, name_en, min_subtotal, buy_qty, get_qty, percent } = offer;
  return { id, type, name_ar, name_en, min_subtotal, buy_qty, get_qty, percent, amount };
}

/**
 * Which of the owner's offers apply to these cart lines, and what they save. In this order:
 * product discounts first; then "buy X, get Y free" (the cheapest pieces are the free ones);
 * then a percentage off the order; then free delivery if the items still cost at least its minimum.
 * When several offers of the same kind qualify, the one that saves the customer the most is used.
 * Switched-off offers are ignored.
 */
export function applyOffers(lines, offers = []) {
  const active = offers.filter((o) => o && Number(o.is_active) === 1);
  const pieces = lines
    .flatMap((l) => Array.from({ length: l.qty }, () => finalUnitPrice(l.price, l.discount_percent)))
    .sort((a, b) => a - b);
  const net = pieces.reduce((sum, p) => sum + p, 0);
  const applied = [];
  const best = (candidates) => candidates.filter((c) => c.amount > 0).sort((a, b) => b.amount - a.amount)[0];

  const buyGet = best(active.filter((o) => o.type === 'buy_get' && o.buy_qty > 0 && o.get_qty > 0).map((o) => {
    const free = Math.floor(pieces.length / (o.buy_qty + o.get_qty)) * o.get_qty;
    return { offer: o, amount: pieces.slice(0, free).reduce((sum, p) => sum + p, 0) };
  }));
  if (buyGet) applied.push(buyGet);
  let items = net - (buyGet?.amount ?? 0);

  const percentOff = best(active.filter((o) => o.type === 'order_percent' && o.percent > 0 && items >= (o.min_subtotal || 0))
    .map((o) => ({ offer: o, amount: Math.round((items * Math.min(o.percent, 90)) / 100) })));
  if (percentOff) applied.push(percentOff);
  items -= percentOff?.amount ?? 0;

  const delivery = active.filter((o) => o.type === 'free_delivery').sort((a, b) => a.min_subtotal - b.min_subtotal);
  const freeDelivery = pieces.length ? delivery.find((o) => items >= o.min_subtotal) ?? null : null;
  const nextThreshold = pieces.length && !freeDelivery ? delivery.find((o) => o.min_subtotal > items) : null;
  return { net, items, applied, freeDelivery, freeDeliveryGap: nextThreshold ? nextThreshold.min_subtotal - items : null };
}

/**
 * @param {{price:number, discount_percent:number, qty:number}[]} lines
 * @param {number|null} deliveryFee piasters, charged only when the cart has items;
 *   null while the customer's neighborhood (and so the fee) isn't known yet.
 * @param {object[]} offers the owner's offers (rows of the offers table); switched-off ones are ignored
 */
export function computeTotals(lines, deliveryFee = 0, offers = []) {
  let subtotal = 0;
  let itemCount = 0;
  for (const line of lines) {
    subtotal += line.price * line.qty;
    itemCount += line.qty;
  }
  const o = applyOffers(lines, offers);
  const applied = o.applied.map(({ offer, amount }) => offerSnapshot(offer, amount));
  // Free delivery is known to be free even before the customer's neighborhood is.
  if (o.freeDelivery) applied.push(offerSnapshot(o.freeDelivery, deliveryFee ?? 0));
  const delivery = lines.length && deliveryFee != null && !o.freeDelivery ? deliveryFee : 0;
  return {
    subtotal,
    discount_total: subtotal - o.net,
    offer_discount: o.net - o.items,
    offers: applied,
    delivery_fee: delivery,
    delivery_known: deliveryFee != null || Boolean(o.freeDelivery),
    free_delivery_gap: o.freeDeliveryGap,
    total: o.items + delivery,
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
