// The shopping cart: { [productId]: qty }, kept in the visitor's session (the caller passes it in).
import { MAX_QTY_PER_ITEM } from '../config/constants.js';
import { activeOffers } from './offers.js';
import { computeTotals } from './pricing.js';
import { getProductsByIds } from './products.js';
import { deliverableZone } from './zones.js';

export { MAX_QTY_PER_ITEM };

export function cartCount(cart) {
  return Object.values(cart ?? {}).reduce((sum, qty) => sum + qty, 0);
}

export function setCartQty(cart, productId, qty) {
  const n = Math.trunc(Number(qty) || 0);
  if (n <= 0) delete cart[productId];
  else cart[productId] = Math.min(n, MAX_QTY_PER_ITEM);
}

/** One cart line for an available product, or why it was dropped or lowered. Updates `cart` to match. */
function checkLine(cart, id, qty, product) {
  if (!product || !product.is_active || product.is_archived) {
    delete cart[id];
    return { notice: product ? { key: 'cart.notice_unavailable', product } : null };
  }
  if (product.stock <= 0) {
    delete cart[id];
    return { notice: { key: 'cart.notice_sold_out', product } };
  }
  if (qty <= product.stock) return { qty };
  cart[id] = product.stock;
  return { qty: product.stock, notice: { key: 'cart.notice_reduced', product, qty: product.stock } };
}

/**
 * Cart lines with live product data. Products that were unpublished or sold out are removed, and
 * quantities above stock are lowered; each change is reported in `notices` so the customer sees why
 * the cart changed. Delivery is priced for `zoneId` when given (checkout, while choosing), otherwise
 * for the customer's saved neighborhood (`userZoneId`; none for guests).
 */
export async function loadCart(cart, { userZoneId, zoneId } = {}) {
  const products = await getProductsByIds(Object.keys(cart));
  const byId = new Map(products.map((p) => [String(p.id), p]));
  const lines = [];
  const notices = [];

  for (const [id, wanted] of Object.entries(cart)) {
    const product = byId.get(id);
    const { qty, notice } = checkLine(cart, id, wanted, product);
    if (notice) notices.push(notice);
    if (qty === undefined) continue;
    lines.push({
      product,
      qty,
      price: product.price,
      discount_percent: product.discount_percent,
      unit_final: product.final_price,
      line_total: product.final_price * qty,
    });
  }

  const zone = await deliverableZone(zoneId !== undefined ? zoneId : userZoneId);
  const totals = computeTotals(lines, zone ? zone.fee : null, await activeOffers());
  return { lines, totals, notices, zone };
}
