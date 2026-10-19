import { Router } from 'express';
import { config } from '../config.js';
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

// Privacy policy (the owner's text, in the reader's language). Older addresses forward here.
router.get('/privacy-policy', (req, res) => res.page('shop/privacy', { title: res.locals.t('privacy.title') }));
router.get(['/privacy', '/privacy-policy.html'], (req, res) => res.redirect(301, '/privacy-policy'));

// For search engines: what not to index, and the list of public pages (kept up to date with the products).
router.get('/robots.txt', (req, res) => {
  res.type('text/plain').send([
    'User-agent: *',
    ...['/admin', '/account', '/cart', '/checkout', '/api/', '/rate/', '/lang/'].map((p) => `Disallow: ${p}`),
    '',
    `Sitemap: ${config.baseUrl}/sitemap.xml`,
    '',
  ].join('\n'));
});

const xmlEscape = (s) => String(s).replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c]);
router.get('/sitemap.xml', async (req, res) => {
  const products = await listProducts({ limit: 1000 });
  const paths = ['/', '/shop', '/privacy-policy', ...products.map((p) => `/product/${encodeURIComponent(p.slug)}`)];
  res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${paths.map((p) => `  <url><loc>${xmlEscape(config.baseUrl + p)}</loc></url>`).join('\n')}
</urlset>
`);
});

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
