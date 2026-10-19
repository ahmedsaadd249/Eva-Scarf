// Store-wide offers (dashboard → Offers): free delivery over an amount, "buy X, get Y free", and a
// percentage off the order. The arithmetic lives in pricing.js (applyOffers); this module reads,
// caches and validates them.
import { all, CACHE_TTL_MS, get } from './db.js';
import { toPiasters } from './pricing.js';

export const OFFER_TYPES = ['free_delivery', 'buy_get', 'order_percent'];

let cache = { at: 0, rows: null };

/** All offers, newest first (the dashboard list). */
export function listOffers() {
  return all('SELECT * FROM offers ORDER BY id DESC');
}

export async function getOffer(id) {
  const n = Number(id);
  return Number.isSafeInteger(n) ? get('SELECT * FROM offers WHERE id = ?', [n]) : null;
}

/** The switched-on offers, cached briefly (every cart and every store page reads them). */
export async function activeOffers() {
  if (!cache.rows || Date.now() - cache.at > CACHE_TTL_MS) {
    cache = { at: Date.now(), rows: await all('SELECT * FROM offers WHERE is_active = 1 ORDER BY id') };
  }
  return cache.rows;
}

export function invalidateOffers() {
  cache.rows = null;
}

const wholeNumber = (value, min, max) => {
  const s = String(value ?? '').trim();
  const n = Number(s);
  return /^\d+$/.test(s) && n >= min && n <= max ? n : null;
};

/** Check the offer form. Fields that don't belong to the chosen type are cleared. */
export function validateOffer(input = {}) {
  const errors = {};
  const type = OFFER_TYPES.includes(input.type) ? input.type : '';
  const values = {
    type,
    name_ar: String(input.name_ar ?? '').trim().replace(/\s+/g, ' ').slice(0, 80),
    name_en: String(input.name_en ?? '').trim().replace(/\s+/g, ' ').slice(0, 80),
    min_subtotal: 0,
    buy_qty: null,
    get_qty: null,
    percent: null,
    is_active: input.is_active ? 1 : 0,
  };
  if (!type) errors.type = 'errors.offer_type';
  const minText = String(input.min_subtotal ?? '').trim();
  if (type === 'free_delivery') {
    const min = toPiasters(minText);
    if (!min) errors.min_subtotal = 'errors.offer_min_required';
    else values.min_subtotal = min;
  }
  if (type === 'buy_get') {
    values.buy_qty = wholeNumber(input.buy_qty, 1, 20);
    values.get_qty = wholeNumber(input.get_qty, 1, 20);
    if (values.buy_qty == null) errors.buy_qty = 'errors.offer_qty';
    if (values.get_qty == null) errors.get_qty = 'errors.offer_qty';
  }
  if (type === 'order_percent') {
    values.percent = wholeNumber(input.percent, 1, 90);
    if (values.percent == null) errors.percent = 'errors.offer_percent';
    if (minText) {
      const min = toPiasters(minText);
      if (min == null) errors.min_subtotal = 'errors.offer_min_invalid';
      else values.min_subtotal = min;
    }
  }
  return { values, errors };
}
