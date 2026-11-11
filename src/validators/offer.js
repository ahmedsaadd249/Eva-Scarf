import { MAX_DISCOUNT_PERCENT, OFFER_MAX_QTY, OFFER_NAME_MAX } from '../config/constants.js';
import { toPiasters } from '../services/pricing.js';
import { cleanText } from '../utils/form.js';

export const OFFER_TYPES = ['free_delivery', 'buy_get', 'order_percent'];

/** A whole number typed in a field, within [min, max], or null. */
function wholeNumber(value, min, max) {
  const s = String(value ?? '').trim();
  const n = Number(s);
  return /^\d+$/.test(s) && n >= min && n <= max ? n : null;
}

/** Check the offer form. Fields that don't belong to the chosen type are cleared. */
export function validateOffer(input = {}) {
  const errors = {};
  const type = OFFER_TYPES.includes(input.type) ? input.type : '';
  const values = {
    type,
    name_ar: cleanText(input.name_ar, OFFER_NAME_MAX),
    name_en: cleanText(input.name_en, OFFER_NAME_MAX),
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
    values.buy_qty = wholeNumber(input.buy_qty, 1, OFFER_MAX_QTY);
    values.get_qty = wholeNumber(input.get_qty, 1, OFFER_MAX_QTY);
    if (values.buy_qty == null) errors.buy_qty = 'errors.offer_qty';
    if (values.get_qty == null) errors.get_qty = 'errors.offer_qty';
  }
  if (type === 'order_percent') {
    values.percent = wholeNumber(input.percent, 1, MAX_DISCOUNT_PERCENT);
    if (values.percent == null) errors.percent = 'errors.offer_percent';
    if (minText) {
      const min = toPiasters(minText);
      if (min == null) errors.min_subtotal = 'errors.offer_min_invalid';
      else values.min_subtotal = min;
    }
  }
  return { values, errors };
}
