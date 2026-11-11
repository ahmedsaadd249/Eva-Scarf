// Sessions: who is signed in, the cart, the language and short-lived form state. Stored in the
// `sessions` table (works on serverless: no in-memory state).
import session from 'express-session';
import { config } from '../config/index.js';
import { SESSION_FALLBACK_AGE_MS, SESSION_MAX_AGE_MS } from '../config/constants.js';
import * as sessionRepo from '../repositories/sessions.js';

const CLEANUP_CHANCE = 0.02; // no long-running timer on serverless: clear expired sessions now and then

class DbSessionStore extends session.Store {
  static expiry(sess) {
    return sess?.cookie?.expires ? new Date(sess.cookie.expires).getTime() : Date.now() + SESSION_FALLBACK_AGE_MS;
  }

  get(sid, cb) {
    sessionRepo.find(sid).then((row) => cb(null, row && Number(row.expires) > Date.now() ? row.sess : null), cb);
  }

  set(sid, sess, cb) {
    sessionRepo.save(sid, sess, DbSessionStore.expiry(sess)).then(async () => {
      if (Math.random() < CLEANUP_CHANCE) await sessionRepo.removeExpired(Date.now());
      cb?.(null);
    }, (err) => cb?.(err));
  }

  touch(sid, sess, cb) {
    sessionRepo.setExpiry(sid, DbSessionStore.expiry(sess)).then(() => cb?.(null), (err) => cb?.(err));
  }

  destroy(sid, cb) {
    sessionRepo.remove(sid).then(() => cb?.(null), (err) => cb?.(err));
  }
}

export const sessions = session({
  store: new DbSessionStore(),
  name: 'eva.sid',
  secret: config.sessionSecret,
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: { httpOnly: true, sameSite: 'lax', secure: config.isProd, maxAge: SESSION_MAX_AGE_MS },
});

/** The visitor's cart, { [productId]: qty }, created empty on first use. */
export function sessionCart(req) {
  if (!req.session.cart || typeof req.session.cart !== 'object') req.session.cart = {};
  return req.session.cart;
}

/** Start a fresh session for the user (a new id, so an old one can't be reused), keeping the guest's cart and language. */
export function logIn(req, user) {
  const { cart, lang } = req.session;
  return new Promise((resolve, reject) => {
    req.session.regenerate((err) => {
      if (err) return reject(err);
      req.session.userId = user.id;
      req.session.cart = cart ?? {};
      req.session.lang = lang ?? user.lang;
      req.session.save((saveErr) => (saveErr ? reject(saveErr) : resolve()));
    });
  });
}

export function logOut(req) {
  const { lang } = req.session;
  return new Promise((resolve, reject) => {
    req.session.regenerate((err) => {
      if (err) return reject(err);
      req.session.lang = lang;
      resolve();
    });
  });
}
