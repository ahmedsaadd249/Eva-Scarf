// Who is signed in, and which pages they may open.
import { findSessionUser } from '../services/auth.js';

/** Puts the signed-in user (or null) on req.user and res.locals.user. */
export async function loadUser(req, res, next) {
  req.user = null;
  if (req.session.userId) {
    req.user = await findSessionUser(req.session.userId);
    if (!req.user) delete req.session.userId;
  }
  res.locals.user = req.user;
  next();
}

export const isOwner = (user) => user?.role === 'admin';

export function requireUser(req, res, next) {
  if (req.user) return next();
  res.redirect('/account/login?next=' + encodeURIComponent(req.originalUrl));
}

export function requireAdmin(req, res, next) {
  if (isOwner(req.user)) return next();
  if (!req.user) return res.redirect('/admin/login?next=' + encodeURIComponent(req.originalUrl));
  res.status(403).page('error', { title: res.locals.t('errors.forbidden_title'), message: res.locals.t('errors.forbidden') });
}

/** Customer-only pages (profile, my orders): the store owner uses the dashboard instead. */
export function customersOnly(req, res, next) {
  if (isOwner(req.user)) return res.redirect('/admin');
  next();
}

/** The store owner's account doesn't place orders (it has no customer profile). */
export function noOwnerOrders(req, res, next) {
  if (!isOwner(req.user)) return next();
  req.flash('info', 'checkout.owner_account');
  res.redirect('/cart');
}
