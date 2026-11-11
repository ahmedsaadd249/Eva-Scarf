import { all, db, get, run } from '../lib/db.js';
import { containsPattern } from './helpers.js';

const FIRST_IMAGE = '(SELECT path FROM product_images WHERE product_id = p.id ORDER BY sort_order, id LIMIT 1)';

const SELECT_PRODUCT = `
  SELECT p.*,
         ${FIRST_IMAGE} AS image,
         (SELECT path FROM product_images WHERE product_id = p.id ORDER BY sort_order, id LIMIT 1 OFFSET 1) AS image2,
         r.avg_stars, COALESCE(r.rating_count, 0)::int AS rating_count
  FROM products p
  LEFT JOIN (
    SELECT oi.product_id, AVG(ra.stars)::float AS avg_stars, COUNT(DISTINCT ra.id)::int AS rating_count
    FROM ratings ra JOIN order_items oi ON oi.order_id = ra.order_id
    GROUP BY oi.product_id
  ) r ON r.product_id = p.id`;

const VISIBLE = 'p.is_active = 1 AND p.is_archived = 0';

const STORE_SORTS = {
  featured: 'p.is_featured DESC, p.created_at DESC, p.id DESC',
  newest: 'p.created_at DESC, p.id DESC',
  price_asc: 'p.price * (100 - p.discount_percent) ASC, p.id',
  price_desc: 'p.price * (100 - p.discount_percent) DESC, p.id',
};
export const SORT_KEYS = Object.keys(STORE_SORTS);

// The dashboard's tabs: All (not archived), Visible, Hidden, Archived.
const OWNER_VIEWS = {
  all: 'p.is_archived = 0',
  active: 'p.is_archived = 0 AND p.is_active = 1',
  hidden: 'p.is_archived = 0 AND p.is_active = 0',
  archived: 'p.is_archived = 1',
};
export const OWNER_VIEW_KEYS = Object.keys(OWNER_VIEWS);

// ---------- The store ----------
export function listVisible({ sort, search, featuredOnly, limit }) {
  const where = [VISIBLE];
  const params = [];
  if (featuredOnly) where.push('p.is_featured = 1');
  if (search) {
    const like = containsPattern(search);
    where.push("(p.name_ar LIKE ? ESCAPE '\\' OR p.name_en LIKE ? ESCAPE '\\')");
    params.push(like, like);
  }
  const order = STORE_SORTS[sort] ?? STORE_SORTS.featured;
  return all(`${SELECT_PRODUCT} WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT ?`, [...params, limit]);
}

export const findVisibleBySlug = (slug) => get(`${SELECT_PRODUCT} WHERE p.slug = ? AND ${VISIBLE}`, [slug]);
export const findById = (id) => get(`${SELECT_PRODUCT} WHERE p.id = ?`, [id]);
export const findByIds = (ids) => all(`${SELECT_PRODUCT} WHERE p.id = ANY(?::int[])`, [ids]);

export const slugTaken = async (slug, exceptId, conn = db) => Boolean(
  await conn.get('SELECT 1 FROM products WHERE slug = ? AND id != ?', [slug, exceptId]),
);

/** Takes `qty` from the stock only if that much is left, so two customers can't both buy the last piece. */
export async function takeStock(id, qty, conn = db) {
  const { changes } = await conn.run(`
    UPDATE products SET stock = stock - ?, updated_at = now()
    WHERE id = ? AND stock >= ? AND is_active = 1 AND is_archived = 0`, [qty, id, qty]);
  return changes === 1;
}

// ---------- The dashboard ----------
export const listForOwner = (view) => all(`
  SELECT p.*, ${FIRST_IMAGE} AS image,
         (SELECT COUNT(*)::int FROM order_items WHERE product_id = p.id) AS times_ordered
  FROM products p
  WHERE ${OWNER_VIEWS[view] ?? OWNER_VIEWS.all} ORDER BY p.created_at DESC, p.id DESC`);

export const listLowStock = (threshold, limit) => all(`
  SELECT p.*, ${FIRST_IMAGE} AS image
  FROM products p WHERE ${VISIBLE} AND p.stock <= ? ORDER BY p.stock, p.id LIMIT ?`, [threshold, limit]);

export const countOrderLines = async (id) => (await get('SELECT COUNT(*)::int AS n FROM order_items WHERE product_id = ?', [id])).n;
export const hasBeenOrdered = async (id) => Boolean(await get('SELECT 1 FROM order_items WHERE product_id = ? LIMIT 1', [id]));

const columns = (p) => [p.name_ar, p.name_en, p.description_ar, p.description_en, p.price, p.discount_percent, p.stock, p.is_featured, p.is_active];

export async function insert(product, conn = db) {
  const row = await conn.get(`
    INSERT INTO products (slug, name_ar, name_en, description_ar, description_en,
                          price, discount_percent, stock, is_featured, is_active)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`, [product.slug, ...columns(product)]);
  return row.id;
}

export const update = (id, product, conn = db) => conn.run(`
  UPDATE products SET name_ar = ?, name_en = ?, description_ar = ?, description_en = ?,
         price = ?, discount_percent = ?, stock = ?, is_featured = ?, is_active = ?, updated_at = now()
  WHERE id = ?`, [...columns(product), id]);

export const quickUpdate = (id, { price, discount_percent, stock, is_active }) => run(
  'UPDATE products SET price = ?, discount_percent = ?, stock = ?, is_active = ?, updated_at = now() WHERE id = ?',
  [price, discount_percent, stock, is_active, id],
);

export const archive = (id) => run('UPDATE products SET is_archived = 1, is_active = 0, is_featured = 0, updated_at = now() WHERE id = ?', [id]);
export const restore = (id) => run('UPDATE products SET is_archived = 0, updated_at = now() WHERE id = ?', [id]);
/** Its photo rows go with it; past orders keep their own copy of the product (order_items). */
export const remove = (id) => run('DELETE FROM products WHERE id = ?', [id]);

/** Returns how many products changed. */
export async function setDiscount(percent, ids = null) {
  const { changes } = ids
    ? await run('UPDATE products SET discount_percent = ?, updated_at = now() WHERE id = ANY(?::int[])', [percent, ids])
    : await run('UPDATE products SET discount_percent = ?, updated_at = now() WHERE is_archived = 0', [percent]);
  return changes;
}
