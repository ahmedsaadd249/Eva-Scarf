// Orders: placing one from the cart, reading them, and moving them through their statuses.
import {
  LATEST_ORDERS_ON_OVERVIEW, ORDER_NO_OFFSET, ORDER_NO_PREFIX, ORDER_STATUSES, OWNER_ORDER_LIST_LIMIT,
} from '../config/constants.js';
import { tx } from '../lib/db.js';
import * as orderRepo from '../repositories/orders.js';
import * as productRepo from '../repositories/products.js';
import { randomToken } from '../utils/crypto.js';
import { loadCart } from './cart.js';
import { productLabel, productName } from './products.js';

export const STATUSES = ORDER_STATUSES;
const RATING_TOKEN_BYTES = 24;

/** A problem the customer or owner can fix; `key` is the message to show them. */
export class OrderError extends Error {
  constructor(key, vars = {}) {
    super(key);
    this.key = key;
    this.vars = vars;
  }
}

/** The order row: the customer's details and the totals, copied so later edits don't change it. */
const orderRow = (user, zone, totals, lang) => ({
  user_id: user.id,
  customer_name: user.full_name,
  customer_email: user.email,
  phone_primary: user.phone_primary,
  phone_secondary: user.phone_secondary || null,
  zone_id: zone.id,
  city: zone.city_ar,
  village: zone.name_ar,
  street: user.street,
  building_no: user.building_no,
  apartment_no: user.apartment_no,
  location_lat: user.location_lat ?? null,
  location_lng: user.location_lng ?? null,
  location_label: user.location_label ?? null,
  subtotal: totals.subtotal,
  discount_total: totals.discount_total,
  offer_discount: totals.offer_discount,
  offers: totals.offers.length ? JSON.stringify(totals.offers) : null,
  delivery_fee: totals.delivery_fee,
  total: totals.total,
  payment_method: 'cod',
  lang,
});

const itemRow = (line) => ({
  product_id: line.product.id,
  name_ar: productName(line.product, 'ar'), // '' for unnamed tarhas
  name_en: productName(line.product, 'en'),
  image: line.product.image ?? null,
  swatch: line.product.swatch,
  unit_price: line.price,
  discount_percent: line.discount_percent,
  final_unit_price: line.unit_final,
  qty: line.qty,
  line_total: line.line_total,
});

/**
 * Turn the cart into an order. Stock is taken in the same transaction that writes the order, with a
 * conditional update ("only if enough is left"), so two customers can't both buy the last piece.
 * Prices and the delivery address are copied onto the order so later edits to products or the profile
 * don't change past orders. `expectedTotal` is the total the customer saw on the checkout page.
 */
export async function placeOrder({ user, cart, lang, expectedTotal }) {
  const { lines, totals, notices, zone } = await loadCart(cart, { userZoneId: user.zone_id });
  if (!lines.length) throw new OrderError('checkout.error_empty');
  if (!zone) throw new OrderError('checkout.choose_zone');
  if (notices.length || (expectedTotal != null && Number(expectedTotal) !== totals.total)) {
    throw new OrderError('checkout.error_changed');
  }

  return tx(async (t) => {
    for (const line of lines) {
      if (!(await productRepo.takeStock(line.product.id, line.qty, t))) {
        throw new OrderError('checkout.error_stock', { name: productLabel(line.product, lang) });
      }
    }
    const id = await orderRepo.insert(orderRow(user, zone, totals, lang), t);
    const orderNo = `${ORDER_NO_PREFIX}${ORDER_NO_OFFSET + id}`;
    await orderRepo.setOrderNo(id, orderNo, t);
    for (const line of lines) await orderRepo.addItem(id, itemRow(line), t);
    await orderRepo.addHistory(id, 'processing', t);
    return { id, order_no: orderNo };
  });
}

/** An order with its items and history, by 'id', order 'no' or rating 'token'; null if there's none. */
export async function getOrder(by, value) {
  if (by === 'id' && !Number.isSafeInteger(Number(value))) return null;
  return orderRepo.findWithDetails(by, value);
}

export const listCustomerOrders = (userId) => orderRepo.listSummaries({ userId });

/** The dashboard's order list, filtered by status and/or a search. */
export const listOrdersForOwner = ({ status, search }) => orderRepo.listSummaries({ status, search, limit: OWNER_ORDER_LIST_LIMIT });

export const latestOrders = () => orderRepo.listSummaries({ limit: LATEST_ORDERS_ON_OVERVIEW });

/** { processing: n, shipped: n, delivered: n } */
export async function countOrdersByStatus() {
  const counts = Object.fromEntries(STATUSES.map((status) => [status, 0]));
  for (const row of await orderRepo.countByStatus()) counts[row.status] = row.n;
  return counts;
}

/** Returns true if the status actually changed (and an email should go out). */
export async function setOrderStatus(orderId, status) {
  if (!STATUSES.includes(status)) throw new OrderError('admin.error_status');
  return tx(async (t) => {
    const order = await orderRepo.lockForStatusChange(orderId, t);
    if (!order) throw new OrderError('errors.not_found');
    if (order.status === status) return false;
    await orderRepo.setStatus(orderId, status, t);
    await orderRepo.addHistory(orderId, status, t);
    // Delivered: the customer may now rate the order with the token in their email.
    if (status === 'delivered' && !order.rating_token) await orderRepo.setRatingToken(orderId, randomToken(RATING_TOKEN_BYTES), t);
    return true;
  });
}
