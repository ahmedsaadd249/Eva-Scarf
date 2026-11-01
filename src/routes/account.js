import { Router } from 'express';
import { all, get, run } from '../db.js';
import { sharedRateLimit } from '../rate-limit.js';
import {
  accountHome, customersOnly, hashPassword, logIn, logOut, needsRehash, requireUser, safeNext, verifyPassword,
} from '../auth.js';
import { sendLoginCode, verifyLoginCode } from '../login-codes.js';
import { getOrder } from '../orders.js';
import { checkProfile, saveProfile } from '../profile.js';
import { deliverableZone, groupByCity, listZones } from '../zones.js';
import { isProfileComplete, normalizeEmail } from '../../public/js/validation.js';

const router = Router();

// Sign-in (sending and checking codes, the owner's password): 20 tries per 15 minutes per visitor, counted in the database
// so every running copy of the site shares the count.
const authLimiter = sharedRateLimit('auth', {
  windowMs: 15 * 60 * 1000,
  limit: Number(process.env.AUTH_RATE_LIMIT || 20),
  handler: (req, res) => res.status(429).page('error', {
    title: res.locals.t('errors.rate_title'), message: res.locals.t('errors.rate'),
  }),
});

// The owner's password: also at most 10 tries an hour for one email, wherever they come from, so guesses
// spread over many addresses still add up.
const ownerLoginLimiter = sharedRateLimit('owner-login', {
  windowMs: 60 * 60 * 1000,
  limit: Number(process.env.OWNER_LOGIN_LIMIT || 10),
  keyGenerator: (req) => normalizeEmail(req.body.email).slice(0, 254) || 'none',
  handler: (req, res) => res.status(429).page('error', {
    title: res.locals.t('errors.rate_title'), message: res.locals.t('errors.rate'),
  }),
});

// Every /account page needs a signed-in user except these, so a page added later is private by default.
const PUBLIC_ACCOUNT_PAGES = /^\/(login|code\/(send|verify|change)|register|forgot|reset\/[^/]+|logout)\/?$/;
router.use('/account', (req, res, next) => (PUBLIC_ACCOUNT_PAGES.test(req.path) ? next() : requireUser(req, res, next)));

const hasErrors = (errors) => Object.keys(errors).length > 0;

router.get('/account', requireUser, (req, res) => res.redirect(accountHome(req.user)));

// ---------- Sign in with a code sent by email ----------
// Used by the sign-in page and by checkout. The forms post here and come back (with `back`) to the page
// they came from; the email the code went to, and any error, wait in the session for that page.

/** What the sign-in form shows: the email step, or the code step once a code has been sent. */
export function codeLocals(req) {
  const error = req.session.codeError;
  delete req.session.codeError;
  return { codeStep: req.session.codeEmail ? 'code' : 'email', codeEmail: req.session.codeEmail || req.session.codeTyped || '', codeError: error };
}

const backTo = (req) => safeNext(req.body.back, '/account/login');

router.get('/account/login', (req, res) => {
  if (req.user) return res.redirect(safeNext(req.query.next, accountHome(req.user)));
  const next = safeNext(req.query.next, '');
  res.page('account/login', {
    title: res.locals.t('auth.login_title'), next,
    back: '/account/login' + (next ? `?next=${encodeURIComponent(next)}` : ''), ...codeLocals(req),
  });
});

router.post('/account/code/send', authLimiter, async (req, res) => {
  const result = await sendLoginCode(req.body.email, req.lang);
  if (result.error) {
    req.session.codeTyped = normalizeEmail(req.body.email).slice(0, 254);
    req.session.codeError = result.error;
  } else {
    req.session.codeEmail = result.email;
    delete req.session.codeTyped;
    req.flash('success', result.wait ? 'code.wait' : 'code.sent', { email: result.email });
  }
  res.redirect(backTo(req));
});

// The code page's script asks for JSON (so it can show the green tick before moving on); a plain form
// post gets the redirect. Either way the outcome and any error message are the same.
router.post('/account/code/verify', authLimiter, async (req, res) => {
  const json = req.accepts(['html', 'json']) === 'json';
  const done = (ok, to) => (json ? res.json({ ok, redirect: to }) : res.redirect(to));
  const email = req.session.codeEmail;
  if (!email) return done(false, backTo(req));
  const { user, error } = await verifyLoginCode(email, req.body.code, req.lang);
  if (error) {
    if (error !== 'code.wrong') delete req.session.codeEmail; // expired or used up: back to the email step
    req.session.codeTyped = email;
    req.session.codeError = error;
    return done(false, backTo(req));
  }
  await logIn(req, user);
  done(true, safeNext(req.body.next, '') || (backTo(req).startsWith('/account/login') ? '/' : backTo(req)));
});

router.post('/account/code/change', (req, res) => {
  req.session.codeTyped = req.session.codeEmail;
  delete req.session.codeEmail;
  res.redirect(backTo(req));
});

// Pages from the time customers had passwords: old links (and emails) lead to the sign-in page.
for (const old of ['/account/register', '/account/forgot', '/account/reset/:token']) {
  router.all(old, (req, res) => res.redirect(301, '/account/login'));
}

// ---------- The store owner: email + password ----------
router.get('/admin/login', (req, res) => {
  if (req.user?.role === 'admin') return res.redirect(safeNext(req.query.next, '/admin'));
  res.page('account/owner-login', { title: res.locals.t('owner_login.title'), values: {}, errors: {}, next: safeNext(req.query.next, '') });
});

router.post('/admin/login', authLimiter, ownerLoginLimiter, async (req, res) => {
  const email = normalizeEmail(req.body.email);
  const user = email ? await get("SELECT * FROM users WHERE email = ? AND role = 'admin'", [email]) : null;
  const ok = await verifyPassword(String(req.body.password ?? ''), user?.password_hash ?? undefined);
  if (!user || !ok) {
    return res.status(422).page('account/owner-login', {
      title: res.locals.t('owner_login.title'), values: { email }, errors: { form: 'errors.login_failed' }, next: safeNext(req.body.next, ''),
    });
  }
  // Passwords saved with older, weaker hash settings are upgraded now that we have the plain text.
  if (needsRehash(user.password_hash)) {
    await run('UPDATE users SET password_hash = ? WHERE id = ?', [await hashPassword(String(req.body.password)), user.id]);
  }
  await logIn(req, user);
  res.redirect(safeNext(req.body.next, '/admin'));
});

router.post('/account/logout', async (req, res) => {
  await logOut(req);
  res.redirect('/');
});

// ---------- Profile ----------
/** Render the profile page with the neighborhoods customers can choose (only those with a delivery fee). */
async function profilePage(req, res, locals) {
  res.page('account/profile', {
    title: res.locals.t('profile.title'),
    values: req.user,
    errors: {},
    next: undefined,
    incomplete: !isProfileComplete(req.user) || !(await deliverableZone(req.user.zone_id)),
    cities: groupByCity(await listZones({ deliverableOnly: true }), req.lang),
    pageAssets: { leaflet: true },
    ...locals,
  });
}

router.get('/account/profile', requireUser, customersOnly, (req, res) => profilePage(req, res, { next: req.query.next }));

router.post('/account/profile', requireUser, customersOnly, async (req, res) => {
  const { values, errors, zone } = await checkProfile(req.body);
  if (hasErrors(errors)) {
    return profilePage(req, res.status(422), { values: { ...req.user, ...values }, errors, next: req.body.next, incomplete: true });
  }
  const welcomed = await saveProfile(req.user.id, values, zone);
  req.flash('success', welcomed ? 'profile.saved_welcome' : 'profile.saved');
  res.redirect(safeNext(req.body.next, '/account/profile'));
});

router.all('/account/password', (req, res) => res.redirect(301, '/account/profile'));

// ---------- Orders ----------
router.get('/account/orders', requireUser, customersOnly, async (req, res) => {
  const orders = await all(`
    SELECT o.*, (SELECT SUM(qty)::int FROM order_items WHERE order_id = o.id) AS item_count,
           (SELECT image FROM order_items WHERE order_id = o.id ORDER BY id LIMIT 1) AS image,
           (SELECT swatch FROM order_items WHERE order_id = o.id ORDER BY id LIMIT 1) AS swatch
    FROM orders o WHERE o.user_id = ? ORDER BY o.id DESC`, [req.user.id]);
  res.page('account/orders', { title: res.locals.t('orders.title'), orders });
});

router.get('/account/orders/:no', requireUser, async (req, res, next) => {
  const order = await getOrder('no', String(req.params.no));
  if (order && req.user.role === 'admin') return res.redirect(`/admin/orders/${order.id}`); // the owner sees orders in the dashboard
  if (!order || order.user_id !== req.user.id) return next();
  res.page('account/order', { title: `${res.locals.t('orders.order')} ${order.order_no}`, order, placed: req.query.placed === '1' });
});

export default router;
