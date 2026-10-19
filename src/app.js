import path from 'node:path';
import express from 'express';
import session from 'express-session';
import helmet from 'helmet';
import { config, ROOT } from './config.js';
import { csrf, DbSessionStore, loadUser, safeNext } from './auth.js';
import { i18n, LANGS, offerLabel } from './i18n.js';
import { cartCount } from './cart.js';
import { getSetting, run } from './db.js';
import { adminProductLabel, productLabel, productName } from './products.js';
import { allZones, formatAddress, placeOf } from './zones.js';
import { activeOffers } from './offers.js';
import { storageOrigin } from './storage.js';
import shopRoutes from './routes/shop.js';
import cartRoutes from './routes/cart.js';
import accountRoutes from './routes/account.js';
import checkoutRoutes from './routes/checkout.js';
import ratingRoutes from './routes/rating.js';
import geoRoutes from './routes/geo.js';
import adminRoutes from './routes/admin.js';

const LEAFLET = 'https://unpkg.com/leaflet@1.9.4/dist/';

export const app = express();
app.set('view engine', 'ejs');
app.set('views', path.join(ROOT, 'src', 'views'));
app.disable('x-powered-by');
if (config.isProd) app.set('trust proxy', 1);

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      // Leaflet (map on the profile page): only this exact version's folder on unpkg, loaded with SRI.
      // Allowing all of unpkg would let an injected tag load any npm package.
      scriptSrc: ["'self'", 'https://cdn.tailwindcss.com', LEAFLET],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com', LEAFLET],
      fontSrc: ["'self'", 'https://fonts.gstatic.com'],
      imgSrc: ["'self'", 'data:', 'blob:', 'https://tile.openstreetmap.org', 'https://*.tile.openstreetmap.org', ...(storageOrigin ? [storageOrigin] : [])],
      connectSrc: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
      objectSrc: ["'none'"],
      upgradeInsecureRequests: config.isProd ? [] : null,
    },
  },
  strictTransportSecurity: config.isProd,
}));

const staticOpts = { maxAge: config.isProd ? '7d' : 0 };
app.use(express.static(path.join(ROOT, 'public'), staticOpts));
app.use('/uploads', express.static(config.uploadsDir, staticOpts)); // local photos (production uses Supabase Storage)

app.use(express.urlencoded({ extended: true, limit: '200kb' }));
app.use(express.json({ limit: '50kb' }));

app.use(session({
  store: new DbSessionStore(),
  name: 'eva.sid',
  secret: config.sessionSecret,
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: { httpOnly: true, sameSite: 'lax', secure: config.isProd, maxAge: 30 * 24 * 3600 * 1000 },
}));

// res.page(view, locals): render a view inside the store layout (or the layout named in locals.layout).
app.use((req, res, next) => {
  res.page = (view, locals = {}) => {
    res.locals.flash = req.session.flash ?? null;
    delete req.session.flash;
    res.render(view, locals, (err, body) => {
      if (err) return next(err);
      res.render(locals.layout ?? 'layouts/store', { ...locals, body });
    });
  };
  req.flash = (type, key, vars) => {
    req.session.flash = { type, key, vars };
  };
  next();
});

app.use(loadUser);
app.use(i18n);
// Strings the browser script needs (client-side validation, toasts).
const CLIENT_KEYS = [
  'errors.required', 'errors.email_invalid', 'errors.password_weak', 'errors.password_too_long', 'errors.password_mismatch',
  'errors.name_required', 'errors.phone_invalid', 'errors.phone_same', 'auth.show_password', 'auth.hide_password', 'cart.view_cart', 'admin.upload_too_big',
];

app.use(async (req, res, next) => {
  const zones = await allZones(); // cached; lets templates show neighborhood names without a query
  res.locals.path = req.path;
  res.locals.cartCount = cartCount(req);
  res.locals.baseUrl = config.baseUrl;
  res.locals.storeEmail = await getSetting('store_email');
  res.locals.social = config.social;
  // Switched-on offers, announced in a thin bar at the top of the store.
  res.locals.offerBanner = (await activeOffers()).map((o) => offerLabel(o, req.lang));
  res.locals.pname = (p) => productName(p, req.lang); // '' for unnamed tarhas
  res.locals.plabel = (p) => productLabel(p, req.lang);
  res.locals.alabel = (p) => adminProductLabel(p, req.lang);
  res.locals.place = (record) => placeOf(record, req.lang, zones);
  res.locals.address = (record) => formatAddress(record, req.lang, zones);
  res.locals.clientMessages = JSON.stringify(Object.fromEntries(CLIENT_KEYS.map((k) => [k, res.locals.t(k)])))
    .replace(/</g, '\\u003c');
  next();
});
app.use(csrf);

// Language switch: remembered in the session and, for signed-in customers, on their account (emails use it).
app.get('/lang/:code', async (req, res) => {
  const code = LANGS.includes(req.params.code) ? req.params.code : 'ar';
  req.session.lang = code;
  if (req.user) await run('UPDATE users SET lang = ? WHERE id = ?', [code, req.user.id]);
  let target = safeNext(req.query.next, '');
  if (!target) {
    try {
      const url = new URL(req.get('referer'));
      target = url.host === req.get('host') ? url.pathname + url.search : '/';
    } catch {
      target = '/'; // no or foreign referer
    }
  }
  res.redirect(target);
});

app.use(shopRoutes);
app.use(cartRoutes);
app.use(accountRoutes);
app.use(checkoutRoutes);
app.use(ratingRoutes);
app.use(geoRoutes);
app.use('/admin', adminRoutes);

app.use((req, res) => {
  res.status(404).page('error', { title: res.locals.t('errors.not_found_title'), message: res.locals.t('errors.not_found') });
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (!(err.status < 500)) console.error(err); // client mistakes (too large, bad JSON…) aren't crashes
  if (res.headersSent) return;
  const status = err.status && err.status < 500 ? err.status : 500;
  const t = res.locals.t ?? ((k) => k);
  res.status(status);
  if (res.page) res.page('error', { title: t('errors.server_title'), message: t('errors.server') });
  else res.send('Server error');
});

export default app; // Vercel imports the app from api/index.js
