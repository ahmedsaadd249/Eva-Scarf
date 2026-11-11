import { Router } from 'express';
import * as cart from '../controllers/cart.js';
import * as checkout from '../controllers/checkout.js';
import { noOwnerOrders } from '../middlewares/auth.js';

const router = Router();

router.get('/cart', cart.show);
router.get('/cart/panel', cart.panel);
router.post('/cart/add', cart.add);
router.post('/cart/update', cart.update);
router.post('/cart/remove', cart.remove);

router.get('/checkout', noOwnerOrders, checkout.show);
router.get('/checkout/summary', checkout.summary);
router.post('/checkout', noOwnerOrders, checkout.placeOrderFromCart);

export default router;
