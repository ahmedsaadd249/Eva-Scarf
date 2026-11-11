// The public store: home, the list of tarhas, one tarha, and the files search engines read.
import { config } from '../config/index.js';
import { SITEMAP_PRODUCT_LIMIT } from '../config/constants.js';
import {
  getProductImages, getVisibleProductBySlug, listProducts, productName, SORT_KEYS,
} from '../services/products.js';
import { listTestimonials } from '../services/ratings.js';
import { searchText } from '../utils/form.js';
import { xmlEscape } from '../utils/xml.js';

const HERO_PHOTOS = 3;
const HERO_CANDIDATES = 12; // newest tarhas looked at to find three with a photo
const RELATED_SHOWN = 4;
const HERO_PREVIEWS = ['1', '2', '3'];

export async function home(req, res) {
  // Real customer ratings only; the section stays hidden until there are some.
  const testimonials = await listTestimonials();
  // The hero collage shows the newest tarhas that have a photo (the text hero if none has one).
  const heroProducts = (await listProducts({ sort: 'newest', limit: HERO_CANDIDATES })).filter((p) => p.image).slice(0, HERO_PHOTOS);
  // Photo hero preview: ?hero=1 (slow zoom), 2 (slideshow), 3 (moving strip).
  const hero = HERO_PREVIEWS.includes(req.query.hero) ? Number(req.query.hero) : 0;
  res.page('shop/home', { title: null, testimonials, hero, heroProducts });
}

export async function list(req, res) {
  const sort = SORT_KEYS.includes(req.query.sort) ? req.query.sort : 'featured';
  const search = searchText(req.query.q);
  const products = await listProducts({ sort, search: search || undefined });
  const title = search ? res.locals.t('shop.search_title', { q: search }) : res.locals.t('shop.title');
  res.page('shop/list', { title, products, sort, search });
}

/** Old search links lead to the list with the same search. */
export function searchRedirect(req, res) {
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  res.redirect('/shop' + (q ? '?q=' + encodeURIComponent(q) : ''));
}

export async function product(req, res, next) {
  const item = await getVisibleProductBySlug(req.params.slug);
  if (!item) return next();
  const images = await getProductImages(item.id);
  const related = (await listProducts({ limit: RELATED_SHOWN + 1 })).filter((p) => p.id !== item.id).slice(0, RELATED_SHOWN);
  res.page('shop/product', { title: productName(item, req.lang) || null, product: item, images, related });
}

/** The owner's privacy policy, in the reader's language. */
export function privacy(req, res) {
  res.page('shop/privacy', { title: res.locals.t('privacy.title') });
}

const NOT_FOR_SEARCH_ENGINES = ['/admin', '/account', '/cart', '/checkout', '/api/', '/rate/', '/lang/'];

export function robots(req, res) {
  res.type('text/plain').send([
    'User-agent: *',
    ...NOT_FOR_SEARCH_ENGINES.map((p) => `Disallow: ${p}`),
    '',
    `Sitemap: ${config.baseUrl}/sitemap.xml`,
    '',
  ].join('\n'));
}

/** The public pages, kept up to date with the products. */
export async function sitemap(req, res) {
  const products = await listProducts({ limit: SITEMAP_PRODUCT_LIMIT });
  const paths = ['/', '/shop', '/privacy-policy', ...products.map((p) => `/product/${encodeURIComponent(p.slug)}`)];
  res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${paths.map((p) => `  <url><loc>${xmlEscape(config.baseUrl + p)}</loc></url>`).join('\n')}
</urlset>
`);
}
