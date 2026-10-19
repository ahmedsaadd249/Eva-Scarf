import { all, get, tx } from './db.js';
import { loadCart } from './cart.js';
import { randomToken } from './auth.js';
import { productLabel, productName } from './products.js';

export const STATUSES = ['processing', 'shipped', 'delivered'];

export class OrderError extends Error {
  constructor(key, vars = {}) {
    super(key);
    this.key = key;
    this.vars = vars;
  }
}

/**
 * Turn the session cart into an order. Stock is taken in the same transaction that writes
 * the order, with a conditional update ("only if enough is left"), so two customers can't
 * both buy the last piece. Prices and the delivery address are copied onto the order so later
 * edits to products or the profile don't change past orders.
 * `expectedTotal` is the total the customer saw on the checkout page.
 */
export async function placeOrder(req, expectedTotal) {
  const user = req.user;
  const { lines, totals, notices, zone } = await loadCart(req);
  if (!lines.length) throw new OrderError('checkout.error_empty');
  if (!zone) throw new OrderError('checkout.choose_zone');
  if (notices.length || (expectedTotal != null && Number(expectedTotal) !== totals.total)) {
    throw new OrderError('checkout.error_changed');
  }

  return tx(async (t) => {
    for (const line of lines) {
      const res = await t.run(`UPDATE products SET stock = stock - ?, updated_at = now()
                               WHERE id = ? AND stock >= ? AND is_active = 1 AND is_archived = 0`,
      [line.qty, line.product.id, line.qty]);
      if (res.changes !== 1) throw new OrderError('checkout.error_stock', { name: productLabel(line.product, req.lang) });
    }

    const order = await t.get(`
      INSERT INTO orders (user_id, customer_name, customer_email, phone_primary, phone_secondary,
                          zone_id, city, village, street, building_no, apartment_no,
                          location_lat, location_lng, location_label,
                          subtotal, discount_total, offer_discount, offers, delivery_fee, total, payment_method, lang)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'cod', ?) RETURNING id`, [
      user.id, user.full_name, user.email, user.phone_primary, user.phone_secondary || null,
      zone.id, zone.city_ar, zone.name_ar, user.street, user.building_no, user.apartment_no,
      user.location_lat ?? null, user.location_lng ?? null, user.location_label ?? null,
      totals.subtotal, totals.discount_total, totals.offer_discount, totals.offers.length ? JSON.stringify(totals.offers) : null,
      totals.delivery_fee, totals.total, req.lang,
    ]);
    const orderNo = `EVA-${10000 + order.id}`;
    await t.run('UPDATE orders SET order_no = ? WHERE id = ?', [orderNo, order.id]);

    for (const l of lines) {
      await t.run(`
        INSERT INTO order_items (order_id, product_id, name_ar, name_en, image, swatch,
                                 unit_price, discount_percent, final_unit_price, qty, line_total)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
        order.id, l.product.id, productName(l.product, 'ar'), productName(l.product, 'en'), // '' for unnamed tarhas
        l.product.image ?? null, l.product.swatch, l.price, l.discount_percent, l.unit_final, l.qty, l.line_total,
      ]);
    }
    await t.run("INSERT INTO order_status_history (order_id, status) VALUES (?, 'processing')", [order.id]);
    return { id: order.id, order_no: orderNo };
  });
}

export async function getOrder(where, value) {
  const column = { id: 'id', no: 'order_no', token: 'rating_token' }[where];
  if (where === 'id' && !Number.isSafeInteger(Number(value))) return null;
  const order = await get(`SELECT o.*, r.stars AS rating_stars, r.comment AS rating_comment, r.created_at AS rated_at
                           FROM orders o LEFT JOIN ratings r ON r.order_id = o.id WHERE o.${column} = ?`, [value]);
  if (!order) return null;
  order.items = await all('SELECT * FROM order_items WHERE order_id = ? ORDER BY id', [order.id]);
  order.history = await all('SELECT * FROM order_status_history WHERE order_id = ? ORDER BY id', [order.id]);
  return order;
}

/** Returns true if the status actually changed (and an email should go out). */
export async function setOrderStatus(orderId, status) {
  if (!STATUSES.includes(status)) throw new OrderError('admin.error_status');
  return tx(async (t) => {
    const order = await t.get('SELECT status, rating_token FROM orders WHERE id = ? FOR UPDATE', [orderId]);
    if (!order) throw new OrderError('errors.not_found');
    if (order.status === status) return false;
    await t.run('UPDATE orders SET status = ?, updated_at = now() WHERE id = ?', [status, orderId]);
    await t.run('INSERT INTO order_status_history (order_id, status) VALUES (?, ?)', [orderId, status]);
    if (status === 'delivered' && !order.rating_token) {
      await t.run('UPDATE orders SET rating_token = ? WHERE id = ?', [randomToken(24), orderId]);
    }
    return true;
  });
}
