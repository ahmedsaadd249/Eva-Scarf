// One page from the cart to the order. A guest first signs in with a code sent to their email (no
// password, no account to create); then the same page asks for name, address and phones (filled in
// from last time) and places the order.
import { sessionCart } from '../middlewares/session.js';
import { loadCart } from '../services/cart.js';
import { sendOrderConfirmation } from '../services/emails.js';
import { OrderError, placeOrder } from '../services/orders.js';
import { checkProfile, saveProfile } from '../services/profile.js';
import { groupByCity, listZones } from '../services/zones.js';
import { hasErrors } from '../utils/form.js';
import { codeSigninLocals } from './shared/code-signin.js';

async function checkoutPage(req, res, { values, errors = {}, zoneId } = {}) {
  const { lines, totals, notices, zone } = await loadCart(sessionCart(req), { userZoneId: req.user?.zone_id, zoneId });
  if (!lines.length) return res.redirect('/cart');
  const locals = { title: res.locals.t('checkout.title'), lines, totals, notices, zone };
  if (!req.user) return res.page('shop/checkout', { ...locals, guest: true, back: '/checkout', ...codeSigninLocals(req) });
  res.page('shop/checkout', {
    ...locals,
    guest: false,
    values: values ?? req.user,
    errors,
    cities: groupByCity(await listZones({ deliverableOnly: true }), req.lang),
    pageAssets: { leaflet: true },
  });
}

export const show = (req, res) => checkoutPage(req, res);

/** The order summary for another neighborhood, while the customer is choosing it. */
export async function summary(req, res) {
  const zoneId = Math.trunc(Number(req.query.zone_id)) || null;
  const { totals } = await loadCart(sessionCart(req), { userZoneId: req.user?.zone_id, zoneId });
  res.render('partials/totals', { ...res.locals, totals }, (err, html) => {
    if (err) return res.status(500).json({});
    res.json({ html, total: totals.total, known: totals.delivery_known !== false });
  });
}

export async function placeOrderFromCart(req, res) {
  if (!req.user) return res.redirect('/checkout');
  const { values, errors, zone } = await checkProfile(req.body);
  if (hasErrors(errors)) {
    return checkoutPage(req, res.status(422), { values: { ...req.user, ...values }, errors, zoneId: zone?.id ?? null });
  }
  await saveProfile(req.user.id, values, zone);
  const user = { ...req.user, ...values, zone_id: zone.id, city: zone.city_ar, village: zone.name_ar };
  req.user = user;
  try {
    const order = await placeOrder({ user, cart: sessionCart(req), lang: req.lang, expectedTotal: req.body.expected_total });
    req.session.cart = {};
    sendOrderConfirmation(order.id);
    res.redirect(`/account/orders/${order.order_no}?placed=1`);
  } catch (err) {
    if (!(err instanceof OrderError)) throw err;
    req.flash('error', err.key, err.vars);
    res.redirect(err.key === 'checkout.error_changed' ? '/checkout' : '/cart');
  }
}
