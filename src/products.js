import { all, get } from './db.js';
import { localized, translate } from './i18n.js';
import { finalUnitPrice } from './pricing.js';

const SELECT_PRODUCT = `
  SELECT p.*,
         (SELECT path FROM product_images i WHERE i.product_id = p.id ORDER BY sort_order, id LIMIT 1) AS image,
         (SELECT path FROM product_images i WHERE i.product_id = p.id ORDER BY sort_order, id LIMIT 1 OFFSET 1) AS image2,
         r.avg_stars, COALESCE(r.rating_count, 0)::int AS rating_count
  FROM products p
  LEFT JOIN (
    SELECT oi.product_id, AVG(ra.stars)::float AS avg_stars, COUNT(DISTINCT ra.id)::int AS rating_count
    FROM ratings ra JOIN order_items oi ON oi.order_id = ra.order_id
    GROUP BY oi.product_id
  ) r ON r.product_id = p.id`;

const VISIBLE = 'p.is_active = 1 AND p.is_archived = 0';

const SORTS = {
  featured: 'p.is_featured DESC, p.created_at DESC, p.id DESC',
  newest: 'p.created_at DESC, p.id DESC',
  price_asc: 'p.price * (100 - p.discount_percent) ASC, p.id',
  price_desc: 'p.price * (100 - p.discount_percent) DESC, p.id',
};
export const SORT_KEYS = Object.keys(SORTS);

export function decorate(p) {
  if (!p) return p;
  p.final_price = finalUnitPrice(p.price, p.discount_percent);
  p.in_stock = p.stock > 0;
  return p;
}

/** Storefront listing: only active, non-archived products. */
export async function listProducts({ sort = 'featured', search, featuredOnly = false, limit = 200 } = {}) {
  const where = [VISIBLE];
  const params = [];
  if (featuredOnly) where.push('p.is_featured = 1');
  if (search) {
    const like = `%${search.replace(/[\\%_]/g, (m) => '\\' + m)}%`;
    where.push("(p.name_ar LIKE ? ESCAPE '\\' OR p.name_en LIKE ? ESCAPE '\\')");
    params.push(like, like);
  }
  const order = SORTS[sort] ?? SORTS.featured;
  const rows = await all(`${SELECT_PRODUCT} WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT ?`, [...params, limit]);
  return rows.map(decorate);
}

export async function getVisibleProductBySlug(slug) {
  return decorate(await get(`${SELECT_PRODUCT} WHERE p.slug = ? AND ${VISIBLE}`, [slug]));
}

export async function getProductById(id) {
  if (!Number.isSafeInteger(Number(id))) return null;
  return decorate(await get(`${SELECT_PRODUCT} WHERE p.id = ?`, [Number(id)]));
}

/** Products by id (any state), used by the cart. */
export async function getProductsByIds(ids) {
  const nums = ids.map(Number).filter(Number.isSafeInteger);
  if (!nums.length) return [];
  return (await all(`${SELECT_PRODUCT} WHERE p.id = ANY(?::int[])`, [nums])).map(decorate);
}

export async function getProductImages(productId) {
  return all('SELECT * FROM product_images WHERE product_id = ? ORDER BY sort_order, id', [productId]);
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

/** URL-safe slug; Arabic-only names fall back to a random suffix. */
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

export async function uniqueSlug(text, exceptId = 0, db = { get }) {
  const base = slugify(text);
  let slug = base;
  for (let n = 2; await db.get('SELECT 1 FROM products WHERE slug = ? AND id != ?', [slug, exceptId]); n++) slug = `${base}-${n}`;
  return slug;
}
