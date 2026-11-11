// Every page of the site. Order matters: the owner's sign-in pages (routes/account.js) come before the
// dashboard, which requires a signed-in owner for everything under /admin.
import { Router } from 'express';
import shop from './shop.js';
import cart from './cart.js';
import account from './account.js';
import rating from './rating.js';
import geo from './geo.js';
import admin from './admin.js';

const router = Router();
router.use(shop);
router.use(cart);
router.use(account);
router.use(rating);
router.use(geo);
router.use('/admin', admin);

export default router;
