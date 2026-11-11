// What every page's templates can use: the cart count, the offers bar, the store's contact details and
// helpers for names and addresses in the reader's language.
import { config } from '../config/index.js';
import { offerLabel } from '../lib/i18n.js';
import { cartCount } from '../services/cart.js';
import { activeOffers } from '../services/offers.js';
import { adminProductLabel, productLabel, productName } from '../services/products.js';
import { getSetting } from '../services/settings.js';
import { allZones, formatAddress, placeOf } from '../services/zones.js';

// Strings the browser script needs (client-side validation, toasts).
const CLIENT_KEYS = [
  'errors.required', 'errors.email_invalid', 'errors.password_weak', 'errors.password_too_long', 'errors.password_mismatch',
  'errors.name_required', 'errors.phone_invalid', 'errors.phone_same', 'auth.show_password', 'auth.hide_password', 'cart.view_cart', 'admin.upload_too_big',
];

/** JSON safe to put inside a <script> tag. */
const scriptJson = (value) => JSON.stringify(value).replace(/</g, '\\u003c');

export async function storeLocals(req, res, next) {
  const zones = await allZones(); // cached; lets templates show neighborhood names without a query
  const { lang } = req;
  Object.assign(res.locals, {
    path: req.path,
    cartCount: cartCount(req.session.cart),
    baseUrl: config.baseUrl,
    storeEmail: await getSetting('store_email'),
    social: config.social,
    // Switched-on offers, announced in a thin bar at the top of the store.
    offerBanner: (await activeOffers()).map((o) => offerLabel(o, lang)),
    pname: (p) => productName(p, lang), // '' for unnamed tarhas
    plabel: (p) => productLabel(p, lang),
    alabel: (p) => adminProductLabel(p, lang),
    place: (record) => placeOf(record, lang, zones),
    address: (record) => formatAddress(record, lang, zones),
    clientMessages: scriptJson(Object.fromEntries(CLIENT_KEYS.map((k) => [k, res.locals.t(k)]))),
  });
  next();
}
