import { Router } from 'express';
import { all } from '../db.js';
import { getProductImages, getVisibleProductBySlug, listProducts, productName, SORT_KEYS } from '../products.js';

const router = Router();

router.get('/', async (req, res) => {
  const featured = await listProducts({ featuredOnly: true, limit: 8 });
  // Real customer ratings only; the section stays hidden until there are some.
  const testimonials = await all(`
    SELECT r.stars, r.comment, o.customer_name,
           (SELECT name_ar FROM order_items WHERE order_id = o.id ORDER BY id LIMIT 1) AS name_ar,
           (SELECT name_en FROM order_items WHERE order_id = o.id ORDER BY id LIMIT 1) AS name_en,
           (SELECT image FROM order_items WHERE order_id = o.id ORDER BY id LIMIT 1) AS image
    FROM ratings r JOIN orders o ON o.id = r.order_id
    WHERE r.stars >= 4 AND length(trim(coalesce(r.comment, ''))) >= 12
    ORDER BY r.created_at DESC LIMIT 5`);
  res.page('shop/home', { title: null, featured, testimonials });
});

router.get('/shop', async (req, res) => {
  const sort = SORT_KEYS.includes(req.query.sort) ? req.query.sort : 'featured';
  const search = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 60) : '';
  const products = await listProducts({ sort, search: search || undefined });
  const title = search ? res.locals.t('shop.search_title', { q: search }) : res.locals.t('shop.title');
  res.page('shop/list', { title, products, sort, search });
});

// Privacy policy (the owner's text, in the reader's language). The old file name forwards here.
router.get('/privacy', (req, res) => res.page('shop/privacy', { title: res.locals.t('privacy.title') }));
router.get('/privacy-policy.html', (req, res) => res.redirect(301, '/privacy'));

router.get('/search', (req, res) => {
  const qs = typeof req.query.q === 'string' && req.query.q.trim() ? '?q=' + encodeURIComponent(req.query.q.trim()) : '';
  res.redirect('/shop' + qs);
});

router.get('/product/:slug', async (req, res, next) => {
  const product = await getVisibleProductBySlug(req.params.slug);
  if (!product) return next();
  const images = await getProductImages(product.id);
  const related = (await listProducts({ limit: 5 })).filter((p) => p.id !== product.id).slice(0, 4);
  res.page('shop/product', { title: productName(product, req.lang) || null, product, images, related });
});

export default router;
