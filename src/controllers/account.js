// Customers: signing in with a code sent by email, their profile (name, address, phones) and their orders.
import { EMAIL_MAX_LENGTH } from '../config/constants.js';
import { isOwner } from '../middlewares/auth.js';
import { logIn, logOut } from '../middlewares/session.js';
import { sendLoginCode, verifyLoginCode } from '../services/login-codes.js';
import { getOrder, listCustomerOrders } from '../services/orders.js';
import { checkProfile, saveProfile } from '../services/profile.js';
import { deliverableZone, groupByCity, listZones } from '../services/zones.js';
import { hasErrors } from '../utils/form.js';
import { replyJsonOrRedirect } from '../utils/http.js';
import { safeNext } from '../utils/safe-next.js';
import { isProfileComplete, normalizeEmail } from '../../public/js/validation.js';
import { codeSigninLocals } from './shared/code-signin.js';

/** Where "my account" leads: the dashboard for the store owner, the profile for customers. */
const accountHome = (user) => (isOwner(user) ? '/admin' : '/account/profile');

/** The page the code form was on (sign-in or checkout), to go back to. */
const backTo = (req) => safeNext(req.body.back, '/account/login');

export const home = (req, res) => res.redirect(accountHome(req.user));

// ---------- Sign in with a code sent by email ----------
export function loginPage(req, res) {
  if (req.user) return res.redirect(safeNext(req.query.next, accountHome(req.user)));
  const next = safeNext(req.query.next, '');
  res.page('account/login', {
    title: res.locals.t('auth.login_title'),
    next,
    back: '/account/login' + (next ? `?next=${encodeURIComponent(next)}` : ''),
    ...codeSigninLocals(req),
  });
}

export async function sendCode(req, res) {
  const result = await sendLoginCode(req.body.email, req.lang);
  if (result.error) {
    req.session.codeTyped = normalizeEmail(req.body.email).slice(0, EMAIL_MAX_LENGTH);
    req.session.codeError = result.error;
  } else {
    req.session.codeEmail = result.email;
    delete req.session.codeTyped;
    req.flash('success', result.wait ? 'code.wait' : 'code.sent', { email: result.email });
  }
  res.redirect(backTo(req));
}

export async function verifyCode(req, res) {
  const done = replyJsonOrRedirect(req, res);
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
}

/** Back to the email step, with the email filled in. */
export function changeEmail(req, res) {
  req.session.codeTyped = req.session.codeEmail;
  delete req.session.codeEmail;
  res.redirect(backTo(req));
}

export async function logout(req, res) {
  await logOut(req);
  res.redirect('/');
}

// ---------- Profile ----------
/** The profile page, with the neighborhoods customers can choose (only those with a delivery fee). */
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

export const profile = (req, res) => profilePage(req, res, { next: req.query.next });

export async function saveProfileForm(req, res) {
  const { values, errors, zone } = await checkProfile(req.body);
  if (hasErrors(errors)) {
    return profilePage(req, res.status(422), { values: { ...req.user, ...values }, errors, next: req.body.next, incomplete: true });
  }
  const welcomed = await saveProfile(req.user.id, values, zone);
  req.flash('success', welcomed ? 'profile.saved_welcome' : 'profile.saved');
  res.redirect(safeNext(req.body.next, '/account/profile'));
}

// ---------- Orders ----------
export async function orders(req, res) {
  res.page('account/orders', { title: res.locals.t('orders.title'), orders: await listCustomerOrders(req.user.id) });
}

export async function order(req, res, next) {
  const found = await getOrder('no', String(req.params.no));
  if (found && isOwner(req.user)) return res.redirect(`/admin/orders/${found.id}`); // the owner sees orders in the dashboard
  if (!found || found.user_id !== req.user.id) return next();
  res.page('account/order', { title: `${res.locals.t('orders.order')} ${found.order_no}`, order: found, placed: req.query.placed === '1' });
}
