import { Router } from 'express';
import { loadCart } from '../services/cart.js';
import { sendOrderConfirmation } from '../services/emails.js';
import { OrderError, placeOrder } from '../services/orders.js';
import { checkProfile, saveProfile } from '../services/profile.js';
import { groupByCity, listZones } from '../services/zones.js';
import { codeLocals } from './account.js';

const router = Router();

// The store owner's account doesn't place orders (it has no customer profile).
function noOwnerOrders(req, res, next) {
  if (req.user?.role !== 'admin') return next();
  req.flash('info', 'checkout.owner_account');
  res.redirect('/cart');
}

/**
 * One page from the cart to the order. A guest first signs in with a code sent to their email (no
 * password, no account to create); then the same page asks for name, address and phones (filled in
 * from last time) and places the order.
 */
async function checkoutPage(req, res, { values, errors = {}, zoneId } = {}) {
  const { lines, totals, notices, zone } = await loadCart(req, { zoneId });
  if (!lines.length) return res.redirect('/cart');
  const locals = { title: res.locals.t('checkout.title'), lines, totals, notices, zone };
  if (!req.user) return res.page('shop/checkout', { ...locals, guest: true, back: '/checkout', ...codeLocals(req) });
  res.page('shop/checkout', {
    ...locals,
    guest: false,
    values: values ?? req.user,
    errors,
    cities: groupByCity(await listZones({ deliverableOnly: true }), req.lang),
    pageAssets: { leaflet: true },
  });
}

router.get('/checkout', noOwnerOrders, (req, res) => checkoutPage(req, res));

// The order summary for another neighborhood, while the customer is choosing it.
router.get('/checkout/summary', async (req, res) => {
  const zoneId = Math.trunc(Number(req.query.zone_id)) || null;
  const { totals } = await loadCart(req, { zoneId });
  res.render('partials/totals', { ...res.locals, totals }, (err, html) => {
    if (err) return res.status(500).json({});
    res.json({ html, total: totals.total, known: totals.delivery_known !== false });
  });
});

router.post('/checkout', noOwnerOrders, async (req, res) => {
  if (!req.user) return res.redirect('/checkout');
  const { values, errors, zone } = await checkProfile(req.body);
  if (Object.keys(errors).length) {
    return checkoutPage(req, res.status(422), { values: { ...req.user, ...values }, errors, zoneId: zone?.id ?? null });
  }
  await saveProfile(req.user.id, values, zone);
  req.user = { ...req.user, ...values, zone_id: zone.id, city: zone.city_ar, village: zone.name_ar };
  try {
    const order = await placeOrder(req, req.body.expected_total);
    req.session.cart = {};
    sendOrderConfirmation(order.id);
    res.redirect(`/account/orders/${order.order_no}?placed=1`);
  } catch (err) {
    if (!(err instanceof OrderError)) throw err;
    req.flash('error', err.key, err.vars);
    res.redirect(err.key === 'checkout.error_changed' ? '/checkout' : '/cart');
  }
});

export default router;
