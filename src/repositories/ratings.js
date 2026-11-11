import { all, get, run } from '../lib/db.js';

/** One rating per order; a second one for the same order is ignored. */
export const create = (orderId, stars, comment) => run(
  'INSERT INTO ratings (order_id, stars, comment) VALUES (?, ?, ?) ON CONFLICT (order_id) DO NOTHING',
  [orderId, stars, comment],
);

export const summary = () => get('SELECT AVG(stars)::float AS avg, COUNT(*)::int AS n FROM ratings');

/** Recent good ratings with a real comment, with the first item's name and photo. */
export const listTestimonials = ({ minStars, minCommentLength, limit }) => all(`
  SELECT r.stars, r.comment, o.customer_name,
         (SELECT name_ar FROM order_items WHERE order_id = o.id ORDER BY id LIMIT 1) AS name_ar,
         (SELECT name_en FROM order_items WHERE order_id = o.id ORDER BY id LIMIT 1) AS name_en,
         (SELECT image FROM order_items WHERE order_id = o.id ORDER BY id LIMIT 1) AS image
  FROM ratings r JOIN orders o ON o.id = r.order_id
  WHERE r.stars >= ? AND length(trim(coalesce(r.comment, ''))) >= ?
  ORDER BY r.created_at DESC LIMIT ?`, [minStars, minCommentLength, limit]);
