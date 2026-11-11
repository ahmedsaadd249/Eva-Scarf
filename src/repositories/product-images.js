import { all, db, get, run } from '../lib/db.js';

export const listForProduct = (productId) => all('SELECT * FROM product_images WHERE product_id = ? ORDER BY sort_order, id', [productId]);
export const findForProduct = (imageId, productId) => get('SELECT * FROM product_images WHERE id = ? AND product_id = ?', [imageId, productId]);

export const add = (productId, path, sortOrder, conn = db) => conn.run(
  'INSERT INTO product_images (product_id, path, sort_order) VALUES (?, ?, ?)',
  [productId, path, sortOrder],
);

/** The sort position after the product's last photo (0 when it has none). */
export const nextSortOrder = async (productId, conn = db) => (
  (await conn.get('SELECT MAX(sort_order) AS m FROM product_images WHERE product_id = ?', [productId]))?.m ?? -1
) + 1;

export const remove = (id) => run('DELETE FROM product_images WHERE id = ?', [id]);

/** True while another product, or a past order, still shows this file. */
export const isPathInUse = async (path) => Boolean(
  await get('SELECT 1 FROM product_images WHERE path = ? UNION SELECT 1 FROM order_items WHERE image = ?', [path, path]),
);

/** Make this photo the product's first (main) one. */
export async function moveToFront(productId, imageId) {
  const first = (await get('SELECT MIN(sort_order) AS m FROM product_images WHERE product_id = ?', [productId]))?.m ?? 0;
  await run('UPDATE product_images SET sort_order = ? WHERE id = ? AND product_id = ?', [first - 1, imageId, productId]);
}
