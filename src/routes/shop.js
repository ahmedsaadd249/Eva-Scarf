import { Router } from 'express';
import * as shop from '../controllers/shop.js';
import { switchLanguage } from '../controllers/language.js';

const router = Router();

router.get('/lang/:code', switchLanguage);
router.get('/', shop.home);
router.get('/shop', shop.list);
router.get('/search', shop.searchRedirect);
router.get('/product/:slug', shop.product);

// Privacy policy. Older addresses forward here.
router.get('/privacy-policy', shop.privacy);
router.get(['/privacy', '/privacy-policy.html'], (req, res) => res.redirect(301, '/privacy-policy'));

// For search engines.
router.get('/robots.txt', shop.robots);
router.get('/sitemap.xml', shop.sitemap);

export default router;
