// The owner's product forms: the full add/edit form, the quick edit in the table, and bulk discounts.
import {
  MAX_DISCOUNT_PERCENT, MAX_STOCK, PRODUCT_DESCRIPTION_MAX, PRODUCT_NAME_MAX,
} from '../config/constants.js';
import { toPiasters } from '../services/pricing.js';
import { asArray, toInt } from '../utils/form.js';

const text = (value, max) => String(value ?? '').trim().slice(0, max);

export const isValidPrice = (piasters) => piasters != null && piasters > 0;
export const isValidDiscount = (percent) => percent >= 0 && percent <= MAX_DISCOUNT_PERCENT;
export const isValidStock = (stock) => stock >= 0 && stock <= MAX_STOCK;

/** The add/edit form. Names are optional (some tarhas have none; the store then shows no name). */
export function validateProduct(body) {
  const values = {
    name_ar: text(body.name_ar, PRODUCT_NAME_MAX),
    name_en: text(body.name_en, PRODUCT_NAME_MAX),
    description_ar: text(body.description_ar, PRODUCT_DESCRIPTION_MAX),
    description_en: text(body.description_en, PRODUCT_DESCRIPTION_MAX),
    price_input: String(body.price ?? '').trim(),
    discount_percent: toInt(body.discount_percent),
    stock: toInt(body.stock, -1),
    is_featured: body.is_featured ? 1 : 0,
    is_active: body.is_active ? 1 : 0,
  };
  values.price = toPiasters(values.price_input);
  const errors = {};
  if (!isValidPrice(values.price)) errors.price = 'admin.error_price';
  if (!isValidDiscount(values.discount_percent)) errors.discount_percent = 'admin.error_discount';
  if (!isValidStock(values.stock)) errors.stock = 'admin.error_stock';
  return { values, errors };
}

/** The inline edit in the products table: price, discount, stock and visibility. Null when something is wrong. */
export function validateQuickEdit(body) {
  const values = {
    price: toPiasters(body.price),
    discount_percent: toInt(body.discount_percent, -1),
    stock: toInt(body.stock, -1),
    is_active: body.is_active ? 1 : 0,
  };
  const ok = isValidPrice(values.price) && isValidDiscount(values.discount_percent) && isValidStock(values.stock);
  return ok ? values : null;
}

/** One discount for all products or the ticked ones: { percent, ids } (ids null = all), or null when the percent is wrong. */
export function validateBulkDiscount(body) {
  const percent = toInt(body.percent, -1);
  if (!isValidDiscount(percent)) return null;
  const ids = body.scope === 'all' ? null : asArray(body.ids).map((v) => toInt(v)).filter(Boolean);
  return { percent, ids };
}
