import crypto from 'node:crypto';
import { promisify } from 'node:util';
import session from 'express-session';
import { get, run } from './db.js';

const scrypt = promisify(crypto.scrypt);
// One of OWASP's recommended scrypt settings (N = 2^15, r = 8, p = 3): as strong as N = 2^17 with
// p = 1, but 32 MB of memory per hash instead of 128 MB, which matters when several logins run at
// once on a small server. Older hashes keep their own settings and still verify.
const SCRYPT = { N: 2 ** 15, r: 8, p: 3 };
const MAXMEM = 64 * 1024 * 1024;
const KEYLEN = 64;

export async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password, salt, KEYLEN, { ...SCRYPT, maxmem: MAXMEM });
  return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('base64'), key.toString('base64')].join('$');
}

// Used when the email is unknown, so a failed login takes the same time either way.
const DUMMY_HASH = await hashPassword('timing-equaliser');

export async function verifyPassword(password, stored = DUMMY_HASH) {
  const [alg, N, r, p, salt, hash] = String(stored).split('$');
  if (alg !== 'scrypt' || !(128 * N * r <= MAXMEM && +p >= 1 && +p <= 4)) return false;
  const expected = Buffer.from(hash, 'base64');
  if (!expected.length) return false;
  const key = await scrypt(String(password), Buffer.from(salt, 'base64'), expected.length, { N: +N, r: +r, p: +p, maxmem: MAXMEM });
  return crypto.timingSafeEqual(key, expected);
}

/** True for a hash made with weaker settings than today's (re-hash it at the next successful login). */
export function needsRehash(stored) {
  const [alg, N, r, p] = String(stored).split('$');
  return alg !== 'scrypt' || +N !== SCRYPT.N || +r !== SCRYPT.r || +p !== SCRYPT.p;
}

export function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

export function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

/** express-session store backed by the `sessions` table (works on serverless: no in-memory state). */
export class DbSessionStore extends session.Store {
  static expiry(sess) {
    return sess?.cookie?.expires ? new Date(sess.cookie.expires).getTime() : Date.now() + 24 * 3600 * 1000;
  }

  get(sid, cb) {
    get('SELECT sess, expires FROM sessions WHERE sid = ?', [sid])
      .then((row) => cb(null, row && Number(row.expires) > Date.now() ? row.sess : null), cb);
  }

  set(sid, sess, cb) {
    run(`INSERT INTO sessions (sid, sess, expires) VALUES (?, ?, ?)
         ON CONFLICT (sid) DO UPDATE SET sess = excluded.sess, expires = excluded.expires`,
    [sid, JSON.stringify(sess), DbSessionStore.expiry(sess)])
      .then(async () => {
        // Clear out expired sessions now and then (there's no long-running timer on serverless).
        if (Math.random() < 0.02) await run('DELETE FROM sessions WHERE expires < ?', [Date.now()]);
        cb?.(null);
      }, (err) => cb?.(err));
  }

  touch(sid, sess, cb) {
    run('UPDATE sessions SET expires = ? WHERE sid = ?', [DbSessionStore.expiry(sess), sid]).then(() => cb?.(null), (err) => cb?.(err));
  }

  destroy(sid, cb) {
    run('DELETE FROM sessions WHERE sid = ?', [sid]).then(() => cb?.(null), (err) => cb?.(err));
  }
}

export async function loadUser(req, res, next) {
  req.user = null;
  if (req.session.userId) {
    req.user = await get('SELECT * FROM users WHERE id = ?', [req.session.userId]);
    if (!req.user) delete req.session.userId;
  }
  res.locals.user = req.user;
  next();
}

/** Start a fresh session for the user, keeping the guest's cart and language. */
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

/** Sign the user out on every other device (after a password change or reset). */
export async function endOtherSessions(userId, keepSid) {
  await run("DELETE FROM sessions WHERE sess->>'userId' = ? AND sid != ?", [String(userId), keepSid ?? '']);
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

/** Only allow redirects to paths on this site. */
export function safeNext(next, fallback = '/') {
  return typeof next === 'string' && next.startsWith('/') && !next.startsWith('//') && !next.startsWith('/\\') ? next : fallback;
}

export function requireUser(req, res, next) {
  if (req.user) return next();
  res.redirect('/account/login?next=' + encodeURIComponent(req.originalUrl));
}

export function requireAdmin(req, res, next) {
  if (req.user?.role === 'admin') return next();
  if (!req.user) return res.redirect('/account/login?next=' + encodeURIComponent(req.originalUrl));
  res.status(403).page('error', { title: res.locals.t('errors.forbidden_title'), message: res.locals.t('errors.forbidden') });
}

/** Per-session CSRF token. Multipart routes call verifyCsrf themselves after multer has parsed the body. */
export function csrf(req, res, next) {
  if (!req.session.csrf) req.session.csrf = randomToken(24);
  res.locals.csrfToken = req.session.csrf;
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method) || req.is('multipart/form-data')) return next();
  verifyCsrf(req, res, next);
}

export function verifyCsrf(req, res, next) {
  // Compare bytes, not characters: a token with non-Latin letters must fail cleanly, not crash.
  const sent = Buffer.from(String(req.body?._csrf || req.get('x-csrf-token') || ''));
  const expected = Buffer.from(String(req.session.csrf || ''));
  const ok = sent.length === expected.length && expected.length > 0 && crypto.timingSafeEqual(sent, expected);
  if (ok) return next();
  res.status(403).page('error', { title: res.locals.t('errors.csrf_title'), message: res.locals.t('errors.csrf') });
}
