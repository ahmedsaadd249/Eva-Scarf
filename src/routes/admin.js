// The dashboard (mounted at /admin). Every page needs the owner; its sign-in pages are in routes/account.js.
import { Router } from 'express';
import * as overview from '../controllers/admin/overview.js';
import * as orders from '../controllers/admin/orders.js';
import * as products from '../controllers/admin/products.js';
import * as settings from '../controllers/admin/settings.js';
import * as offers from '../controllers/admin/offers.js';
import * as delivery from '../controllers/admin/delivery.js';
import { requireAdmin } from '../middlewares/auth.js';
import { verifyCsrf } from '../middlewares/csrf.js';
import { ownerPasswordLimiter } from '../middlewares/rate-limit.js';
import { uploadImages } from '../middlewares/uploads.js';

const router = Router();
router.use(requireAdmin);

// Forms with photos are multipart: their CSRF token can only be checked once the upload is read.
const withPhotos = [uploadImages, verifyCsrf];

router.get('/', overview.show);

router.get('/orders', orders.list);
router.get('/orders/:id', orders.show);
router.post('/orders/:id/status', orders.changeStatus);

router.get('/products', products.list);
router.get('/products/new', products.newForm);
router.post('/products/bulk-discount', products.bulkDiscount); // before '/products/:id', which would take it
router.post('/products', ...withPhotos, products.create);
router.get('/products/:id/edit', products.loadProduct, products.editForm);
router.post('/products/:id', ...withPhotos, products.loadProduct, products.update);
router.post('/products/:id/quick', products.loadProduct, products.quickEdit);
router.post('/products/:id/archive', products.loadProduct, products.archive);
router.post('/products/:id/delete', products.loadProduct, products.remove);
router.post('/products/:id/restore', products.loadProduct, products.restore);
router.post('/products/:id/images/:imageId/delete', products.removePhoto);
router.post('/products/:id/images/:imageId/main', products.makeMain);

router.get('/settings', settings.show);
router.post('/settings', settings.saveStore);
router.post('/settings/password', ownerPasswordLimiter, settings.savePassword);
router.post('/settings/otp', ownerPasswordLimiter, settings.startCodes);
router.post('/settings/otp/confirm', ownerPasswordLimiter, settings.confirmCodes);
router.post('/settings/otp/cancel', settings.cancelCodes);
router.post('/settings/otp/off', ownerPasswordLimiter, settings.stopCodes);

router.get('/offers', offers.list);
router.get('/offers/new', offers.newForm);
router.post('/offers', offers.create);
router.get('/offers/:id/edit', offers.loadOffer, offers.editForm);
router.post('/offers/:id', offers.loadOffer, offers.update);
router.post('/offers/:id/toggle', offers.loadOffer, offers.toggle);
router.post('/offers/:id/delete', offers.loadOffer, offers.remove);

router.get('/delivery', delivery.show);
router.post('/delivery', delivery.saveFeesForm);
router.post('/delivery/add', delivery.add);
router.post('/delivery/:id/delete', delivery.remove);

export default router;
