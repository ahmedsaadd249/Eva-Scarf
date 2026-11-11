// Every form carries a per-session token that a page on another site can't know.
import { randomToken, safeEqual } from '../utils/crypto.js';

const TOKEN_BYTES = 24;
const SAFE_METHODS = ['GET', 'HEAD', 'OPTIONS'];

/** Gives each session a token (for the forms) and checks it on every post. Multipart forms are checked by verifyCsrf after the upload is read. */
export function csrf(req, res, next) {
  if (!req.session.csrf) req.session.csrf = randomToken(TOKEN_BYTES);
  res.locals.csrfToken = req.session.csrf;
  if (SAFE_METHODS.includes(req.method) || req.is('multipart/form-data')) return next();
  verifyCsrf(req, res, next);
}

export function verifyCsrf(req, res, next) {
  const sent = String(req.body?._csrf || req.get('x-csrf-token') || '');
  const expected = String(req.session.csrf || '');
  if (expected && safeEqual(sent, expected)) return next();
  res.status(403).page('error', { title: res.locals.t('errors.csrf_title'), message: res.locals.t('errors.csrf') });
}
