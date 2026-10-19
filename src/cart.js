import { computeTotals } from './pricing.js';
import { activeOffers } from './offers.js';
import { getProductsByIds } from './products.js';
import { deliverableZone } from './zones.js';

export const MAX_QTY_PER_ITEM = 20;

/** The cart lives in the session as { [productId]: qty }. */
export function getCart(req) {
  if (!req.session.cart || typeof req.session.cart !== 'object') req.session.cart = {};
  return req.session.cart;
}

export function cartCount(req) {
  return Object.values(req.session.cart ?? {}).reduce((sum, qty) => sum + qty, 0);
}

export function setCartQty(req, productId, qty) {
  const cart = getCart(req);
  const n = Math.trunc(Number(qty) || 0);
  if (n <= 0) delete cart[productId];
  else cart[productId] = Math.min(n, MAX_QTY_PER_ITEM);
}

/**
 * Load cart lines with live product data. Products that were unpublished or sold
 * out are removed, and quantities above stock are lowered; each change is reported
 * in `notices` so the customer sees why the cart changed.
 */
export async function loadCart(req) {
  const cart = getCart(req);
  const products = await getProductsByIds(Object.keys(cart));
  const byId = new Map(products.map((p) => [String(p.id), p]));
  const lines = [];
  const notices = [];

  for (const [id, qty] of Object.entries(cart)) {
    const p = byId.get(id);
    if (!p || !p.is_active || p.is_archived) {
      delete cart[id];
      if (p) notices.push({ key: 'cart.notice_unavailable', product: p });
      continue;
    }
    if (p.stock <= 0) {
      delete cart[id];
      notices.push({ key: 'cart.notice_sold_out', product: p });
      continue;
    }
    let n = qty;
    if (n > p.stock) {
      n = p.stock;
      cart[id] = n;
      notices.push({ key: 'cart.notice_reduced', product: p, qty: n });
    }
    lines.push({
      product: p,
      qty: n,
      price: p.price,
      discount_percent: p.discount_percent,
      unit_final: p.final_price,
      line_total: p.final_price * n,
    });
  }

  const zone = await cartZone(req);
  const totals = computeTotals(lines, zone ? zone.fee : null, await activeOffers());
  return { lines, totals, notices, zone };
}

/**
 * The neighborhood delivery is priced for: the one saved on the signed-in customer's profile.
 * Null for guests and for customers who haven't saved one, so the cart shows "set by neighborhood".
 */
export async function cartZone(req) {
  return deliverableZone(req.user?.zone_id);
}
