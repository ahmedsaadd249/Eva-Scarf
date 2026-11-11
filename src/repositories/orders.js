import { all, db, get } from '../lib/db.js';
import { containsPattern } from './helpers.js';

// One row per order for lists: its rating, number of pieces and the first item's photo.
const SELECT_SUMMARY = `
  SELECT o.*, r.stars AS rating_stars,
         (SELECT SUM(qty)::int FROM order_items WHERE order_id = o.id) AS item_count,
         (SELECT image FROM order_items WHERE order_id = o.id ORDER BY id LIMIT 1) AS image,
         (SELECT swatch FROM order_items WHERE order_id = o.id ORDER BY id LIMIT 1) AS swatch
  FROM orders o LEFT JOIN ratings r ON r.order_id = o.id`;

/** Newest first. Every filter is optional. */
export function listSummaries({ status, search, userId, limit } = {}) {
  const where = [];
  const params = [];
  if (status) {
    where.push('o.status = ?');
    params.push(status);
  }
  if (search) {
    const like = containsPattern(search);
    where.push('(o.order_no ILIKE ? OR o.customer_name ILIKE ? OR o.phone_primary LIKE ? OR o.customer_email ILIKE ? OR o.village LIKE ?)');
    params.push(like, like, like, like, like);
  }
  if (userId != null) {
    where.push('o.user_id = ?');
    params.push(userId);
  }
  const filter = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const cap = limit ? 'LIMIT ?' : '';
  return all(`${SELECT_SUMMARY} ${filter} ORDER BY o.id DESC ${cap}`, limit ? [...params, limit] : params);
}

export const countByStatus = () => all('SELECT status, COUNT(*)::int AS n FROM orders GROUP BY status');
export const deliveredTotals = () => get("SELECT COALESCE(SUM(total), 0)::int AS total, COUNT(*)::int AS n FROM orders WHERE status = 'delivered'");
export const openOrdersTotal = () => get("SELECT COALESCE(SUM(total), 0)::int AS total FROM orders WHERE status != 'delivered'");

const LOOKUP_COLUMNS = { id: 'id', no: 'order_no', token: 'rating_token' };

/** One order with its rating, items and status history, by id, order number or rating token. */
export async function findWithDetails(by, value) {
  const column = LOOKUP_COLUMNS[by];
  const order = await get(`
    SELECT o.*, r.stars AS rating_stars, r.comment AS rating_comment, r.created_at AS rated_at
    FROM orders o LEFT JOIN ratings r ON r.order_id = o.id WHERE o.${column} = ?`, [value]);
  if (!order) return null;
  order.items = await all('SELECT * FROM order_items WHERE order_id = ? ORDER BY id', [order.id]);
  order.history = await all('SELECT * FROM order_status_history WHERE order_id = ? ORDER BY id', [order.id]);
  return order;
}

// ---------- Writing (inside a transaction: pass its `conn`) ----------
export async function insert(o, conn = db) {
  const row = await conn.get(`
    INSERT INTO orders (user_id, customer_name, customer_email, phone_primary, phone_secondary,
                        zone_id, city, village, street, building_no, apartment_no,
                        location_lat, location_lng, location_label,
                        subtotal, discount_total, offer_discount, offers, delivery_fee, total, payment_method, lang)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`, [
    o.user_id, o.customer_name, o.customer_email, o.phone_primary, o.phone_secondary,
    o.zone_id, o.city, o.village, o.street, o.building_no, o.apartment_no,
    o.location_lat, o.location_lng, o.location_label,
    o.subtotal, o.discount_total, o.offer_discount, o.offers, o.delivery_fee, o.total, o.payment_method, o.lang,
  ]);
  return row.id;
}

export const setOrderNo = (id, orderNo, conn = db) => conn.run('UPDATE orders SET order_no = ? WHERE id = ?', [orderNo, id]);

export const addItem = (orderId, item, conn = db) => conn.run(`
  INSERT INTO order_items (order_id, product_id, name_ar, name_en, image, swatch,
                           unit_price, discount_percent, final_unit_price, qty, line_total)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
  orderId, item.product_id, item.name_ar, item.name_en, item.image, item.swatch,
  item.unit_price, item.discount_percent, item.final_unit_price, item.qty, item.line_total,
]);

export const addHistory = (orderId, status, conn = db) => conn.run(
  'INSERT INTO order_status_history (order_id, status) VALUES (?, ?)',
  [orderId, status],
);

/** The order's status, locked until the transaction ends (so two status changes can't interleave). */
export const lockForStatusChange = (id, conn) => conn.get('SELECT status, rating_token FROM orders WHERE id = ? FOR UPDATE', [id]);
export const setStatus = (id, status, conn = db) => conn.run('UPDATE orders SET status = ?, updated_at = now() WHERE id = ?', [status, id]);
export const setRatingToken = (id, token, conn = db) => conn.run('UPDATE orders SET rating_token = ? WHERE id = ?', [token, id]);
