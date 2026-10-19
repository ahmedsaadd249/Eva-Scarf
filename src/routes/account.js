import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { all, get, run } from '../db.js';
import {
  endOtherSessions, hashPassword, logIn, logOut, needsRehash, randomToken, requireUser, safeNext, sha256, verifyPassword,
} from '../auth.js';
import { sendPasswordResetEmail, sendWelcomeEmail } from '../emails.js';
import { getOrder } from '../orders.js';
import { deliverableZone, groupByCity, listZones } from '../zones.js';
import {
  emailError, isProfileComplete, normalizeEmail, passwordError, validateProfile,
} from '../../public/js/validation.js';

const router = Router();

// Note: counts are kept per server instance, so on serverless hosting this is a speed bump, not a hard limit.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: Number(process.env.AUTH_RATE_LIMIT || 20),
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  handler: (req, res) => res.status(429).page('error', {
    title: res.locals.t('errors.rate_title'), message: res.locals.t('errors.rate'),
  }),
});

const RESET_TTL_MS = 60 * 60 * 1000;
const hasErrors = (errors) => Object.keys(errors).length > 0;
const isUniqueViolation = (err) => err?.code === '23505' || /unique|duplicate/i.test(err?.message ?? '');

router.get('/account', requireUser, (req, res) => res.redirect('/account/profile'));

// ---------- Register ----------
router.get('/account/register', (req, res) => {
  if (req.user) return res.redirect('/account/profile');
  res.page('account/register', { title: res.locals.t('auth.register_title'), values: {}, errors: {}, next: req.query.next });
});

router.post('/account/register', authLimiter, async (req, res) => {
  const values = {
    full_name: String(req.body.full_name ?? '').trim().replace(/\s+/g, ' ').slice(0, 80),
    email: normalizeEmail(req.body.email),
  };
  const password = String(req.body.password ?? '');
  const errors = {};
  if (values.full_name.length < 2) errors.full_name = 'errors.name_required';
  const emailErr = emailError(values.email);
  if (emailErr) errors.email = emailErr;
  else if (await get('SELECT 1 FROM users WHERE email = ?', [values.email])) errors.email = 'errors.email_taken';
  const passErr = passwordError(password);
  if (passErr) errors.password = passErr;
  if (password !== String(req.body.password_confirm ?? '')) errors.password_confirm = 'errors.password_mismatch';

  const again = (errs) => res.status(422).page('account/register', {
    title: res.locals.t('auth.register_title'), values, errors: errs, next: req.body.next,
  });
  if (hasErrors(errors)) return again(errors);

  let user;
  try {
    user = await get('INSERT INTO users (email, password_hash, full_name, lang) VALUES (?, ?, ?, ?) RETURNING *',
      [values.email, await hashPassword(password), values.full_name, req.lang]);
  } catch (err) {
    // Two sign-ups with the same email at the same moment: the second one loses.
    if (!isUniqueViolation(err)) throw err;
    return again({ email: 'errors.email_taken' });
  }
  await logIn(req, user);
  // The welcome email goes out once the profile is completed (see POST /account/profile).
  req.flash('success', 'auth.registered', { name: user.full_name });
  const next = safeNext(req.body.next, '');
  res.redirect('/account/profile' + (next ? `?next=${encodeURIComponent(next)}` : ''));
});

// ---------- Login / logout ----------
router.get('/account/login', (req, res) => {
  if (req.user) return res.redirect(safeNext(req.query.next, '/account/profile'));
  res.page('account/login', { title: res.locals.t('auth.login_title'), values: {}, errors: {}, next: req.query.next });
});

router.post('/account/login', authLimiter, async (req, res) => {
  const email = normalizeEmail(req.body.email);
  const user = email ? await get('SELECT * FROM users WHERE email = ?', [email]) : null;
  const ok = await verifyPassword(String(req.body.password ?? ''), user?.password_hash);
  if (!user || !ok) {
    return res.status(422).page('account/login', {
      title: res.locals.t('auth.login_title'), values: { email }, errors: { form: 'errors.login_failed' }, next: req.body.next,
    });
  }
  // Passwords saved with older, weaker hash settings are upgraded now that we have the plain text.
  if (needsRehash(user.password_hash)) {
    await run('UPDATE users SET password_hash = ? WHERE id = ?', [await hashPassword(String(req.body.password)), user.id]);
  }
  await logIn(req, user);
  res.redirect(safeNext(req.body.next, user.role === 'admin' ? '/admin' : '/'));
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
    passwordErrors: {},
    next: undefined,
    incomplete: !isProfileComplete(req.user) || !(await deliverableZone(req.user.zone_id)),
    cities: groupByCity(await listZones({ deliverableOnly: true }), req.lang),
    pageAssets: { leaflet: true },
    ...locals,
  });
}

router.get('/account/profile', requireUser, (req, res) => profilePage(req, res, { next: req.query.next }));

router.post('/account/profile', requireUser, async (req, res) => {
  const { values, errors } = validateProfile(req.body);
  const zone = values.zone_id ? await deliverableZone(values.zone_id) : null;
  if (values.zone_id && !zone) errors.zone_id = 'errors.zone_unavailable';
  if (hasErrors(errors)) {
    return profilePage(req, res.status(422), { values: { ...req.user, ...values }, errors, next: req.body.next, incomplete: true });
  }
  // city/village keep the Arabic names as a readable copy; the zone is the source of truth.
  await run(`UPDATE users SET full_name = ?, zone_id = ?, city = ?, village = ?, street = ?, building_no = ?, apartment_no = ?,
               phone_primary = ?, phone_secondary = ?, location_lat = ?, location_lng = ?, location_label = ? WHERE id = ?`,
  [values.full_name, zone.id, zone.city_ar, zone.name_ar, values.street, values.building_no, values.apartment_no,
    values.phone_primary, values.phone_secondary, values.location_lat, values.location_lng, values.location_label, req.user.id]);
  // First complete save: send the welcome email (once; the update only matches if not welcomed yet).
  const welcomed = await get('UPDATE users SET welcomed_at = now() WHERE id = ? AND welcomed_at IS NULL RETURNING *', [req.user.id]);
  if (welcomed) sendWelcomeEmail(welcomed);
  req.flash('success', welcomed ? 'profile.saved_welcome' : 'profile.saved');
  res.redirect(safeNext(req.body.next, '/account/profile'));
});

router.post('/account/password', requireUser, authLimiter, async (req, res) => {
  const errors = {};
  const next = String(req.body.new_password ?? '');
  if (!(await verifyPassword(String(req.body.current_password ?? ''), req.user.password_hash))) errors.current_password = 'errors.password_current';
  const passErr = passwordError(next);
  if (passErr) errors.new_password = passErr;
  if (next !== String(req.body.new_password_confirm ?? '')) errors.new_password_confirm = 'errors.password_mismatch';
  if (hasErrors(errors)) return profilePage(req, res.status(422), { passwordErrors: errors });
  await run('UPDATE users SET password_hash = ? WHERE id = ?', [await hashPassword(next), req.user.id]);
  await endOtherSessions(req.user.id, req.sessionID);
  req.flash('success', 'profile.password_changed');
  res.redirect('/account/profile');
});

// ---------- Orders ----------
router.get('/account/orders', requireUser, async (req, res) => {
  const orders = await all(`
    SELECT o.*, (SELECT SUM(qty)::int FROM order_items WHERE order_id = o.id) AS item_count,
           (SELECT image FROM order_items WHERE order_id = o.id ORDER BY id LIMIT 1) AS image,
           (SELECT swatch FROM order_items WHERE order_id = o.id ORDER BY id LIMIT 1) AS swatch
    FROM orders o WHERE o.user_id = ? ORDER BY o.id DESC`, [req.user.id]);
  res.page('account/orders', { title: res.locals.t('orders.title'), orders });
});

router.get('/account/orders/:no', requireUser, async (req, res, next) => {
  const order = await getOrder('no', String(req.params.no));
  if (!order || (order.user_id !== req.user.id && req.user.role !== 'admin')) return next();
  res.page('account/order', { title: `${res.locals.t('orders.order')} ${order.order_no}`, order, placed: req.query.placed === '1' });
});

// ---------- Password reset ----------
router.get('/account/forgot', (req, res) => {
  res.page('account/forgot', { title: res.locals.t('auth.forgot_title'), values: {}, errors: {}, sent: false });
});

router.post('/account/forgot', authLimiter, async (req, res) => {
  const email = normalizeEmail(req.body.email);
  const emailErr = emailError(email);
  if (emailErr) {
    return res.status(422).page('account/forgot', { title: res.locals.t('auth.forgot_title'), values: { email }, errors: { email: emailErr }, sent: false });
  }
  const user = await get('SELECT * FROM users WHERE email = ?', [email]);
  if (user) {
    const token = randomToken(32);
    await run('DELETE FROM password_resets WHERE user_id = ?', [user.id]);
    await run('INSERT INTO password_resets (token_hash, user_id, expires_at) VALUES (?, ?, ?)', [sha256(token), user.id, Date.now() + RESET_TTL_MS]);
    sendPasswordResetEmail(user, token);
  }
  // Same answer whether or not the account exists.
  res.page('account/forgot', { title: res.locals.t('auth.forgot_title'), values: { email }, errors: {}, sent: true });
});

async function findReset(token) {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return null;
  return get('SELECT * FROM password_resets WHERE token_hash = ? AND used = 0 AND expires_at > ?', [sha256(token), Date.now()]);
}

router.get('/account/reset/:token', async (req, res) => {
  const reset = await findReset(req.params.token);
  res.page('account/reset', { title: res.locals.t('auth.reset_title'), valid: Boolean(reset), token: req.params.token, errors: {} });
});

router.post('/account/reset/:token', authLimiter, async (req, res) => {
  const reset = await findReset(req.params.token);
  if (!reset) return res.page('account/reset', { title: res.locals.t('auth.reset_title'), valid: false, token: '', errors: {} });
  const password = String(req.body.password ?? '');
  const errors = {};
  const passErr = passwordError(password);
  if (passErr) errors.password = passErr;
  if (password !== String(req.body.password_confirm ?? '')) errors.password_confirm = 'errors.password_mismatch';
  if (hasErrors(errors)) {
    return res.status(422).page('account/reset', { title: res.locals.t('auth.reset_title'), valid: true, token: req.params.token, errors });
  }
  await run('UPDATE users SET password_hash = ? WHERE id = ?', [await hashPassword(password), reset.user_id]);
  await run('UPDATE password_resets SET used = 1 WHERE token_hash = ?', [reset.token_hash]);
  const user = await get('SELECT * FROM users WHERE id = ?', [reset.user_id]);
  await logIn(req, user);
  await endOtherSessions(user.id, req.sessionID); // whoever had the old password is signed out
  req.flash('success', 'auth.reset_done');
  res.redirect('/account/profile');
});

export default router;
