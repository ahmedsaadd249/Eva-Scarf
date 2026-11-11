// The tarhas as the store shows them: listing, finding, names and URL slugs.
import { STORE_PRODUCT_LIMIT } from '../config/constants.js';
import { translate, localized } from '../lib/i18n.js';
import * as imageRepo from '../repositories/product-images.js';
import * as productRepo from '../repositories/products.js';
import { finalUnitPrice } from './pricing.js';

export const { SORT_KEYS } = productRepo;

/** Adds the price after the product's own discount and whether any is left. */
export function decorate(p) {
  if (!p) return p;
  p.final_price = finalUnitPrice(p.price, p.discount_percent);
  p.in_stock = p.stock > 0;
  return p;
}

const isId = (id) => Number.isSafeInteger(Number(id));

/** Storefront listing: only active, non-archived products. */
export async function listProducts({ sort = 'featured', search, featuredOnly = false, limit = STORE_PRODUCT_LIMIT } = {}) {
  return (await productRepo.listVisible({ sort, search, featuredOnly, limit })).map(decorate);
}

export async function getVisibleProductBySlug(slug) {
  return decorate(await productRepo.findVisibleBySlug(slug));
}

/** Any product (also hidden or archived), or null. */
export async function getProductById(id) {
  if (!isId(id)) return null;
  return decorate(await productRepo.findById(Number(id)));
}

/** Products by id (any state), used by the cart. */
export async function getProductsByIds(ids) {
  const nums = ids.map(Number).filter(Number.isSafeInteger);
  if (!nums.length) return [];
  return (await productRepo.findByIds(nums)).map(decorate);
}

export function getProductImages(productId) {
  return imageRepo.listForProduct(productId);
}

/** The tarha's name in the reader's language, or '' when it has none (names are optional). */
export function productName(p, lang) {
  return localized(p, 'name', lang).trim();
}

/** For sentences and screen-reader labels: the name, or "الطرحة" / "this tarha" when there is none. */
export function productLabel(p, lang) {
  return productName(p, lang) || translate(lang, 'product.this_tarha');
}

/** Dashboard only: the name, or "بدون اسم (#17)" so unnamed products can still be told apart. */
export function adminProductLabel(p, lang) {
  return productName(p, lang) || translate(lang, 'admin.unnamed', { n: p.id });
}

/** URL-safe slug; Arabic-only names fall back to "tarha". */
export function slugify(text) {
  const base = String(text || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return base || 'tarha';
}

/** A slug no other product uses: "blue-nile", then "blue-nile-2", "blue-nile-3"… */
export async function uniqueSlug(text, exceptId = 0, conn = undefined) {
  const base = slugify(text);
  let slug = base;
  for (let n = 2; await productRepo.slugTaken(slug, exceptId, conn); n++) slug = `${base}-${n}`;
  return slug;
}
