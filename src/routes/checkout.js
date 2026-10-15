import { Router } from 'express';
import { requireUser } from '../auth.js';
import { loadCart } from '../cart.js';
import { sendOrderConfirmation } from '../emails.js';
import { OrderError, placeOrder } from '../orders.js';
import { isProfileComplete } from '../../public/js/validation.js';
import { deliverableZone } from '../zones.js';

const router = Router();

async function needsProfile(req, res) {
  if (isProfileComplete(req.user) && (await deliverableZone(req.user.zone_id))) return false;
  // The neighborhood may have been removed or unpriced by the owner since it was saved.
  req.flash('info', isProfileComplete(req.user) ? 'checkout.choose_zone' : 'checkout.complete_profile');
  res.redirect('/account/profile?next=/checkout');
  return true;
}

router.get('/checkout', requireUser, async (req, res) => {
  if (await needsProfile(req, res)) return;
  const { lines, totals, notices, zone } = await loadCart(req);
  if (!lines.length) return res.redirect('/cart');
  res.page('shop/checkout', { title: res.locals.t('checkout.title'), lines, totals, notices, zone });
});

router.post('/checkout', requireUser, async (req, res) => {
  if (await needsProfile(req, res)) return;
  try {
    const order = await placeOrder(req, req.body.expected_total);
    req.session.cart = {};
    sendOrderConfirmation(order.id);
    res.redirect(`/account/orders/${order.order_no}?placed=1`);
  } catch (err) {
    if (!(err instanceof OrderError)) throw err;
    req.flash('error', err.key, err.vars);
    res.redirect('/cart');
  }
});

export default router;
