// The store owner signs in with email + password, then (when switched on in Settings) a code sent by
// email to their confirmed inbox. Nobody is signed in until both steps are done.
import { CODE_TTL_MS, maskEmail, sendOwnerCode, verifyOwnerCode } from '../services/login-codes.js';
import { checkOwnerSignIn, findOwnerAwaitingCode } from '../services/owner-account.js';
import { isOwner } from '../middlewares/auth.js';
import { logIn } from '../middlewares/session.js';
import { replyJsonOrRedirect } from '../utils/http.js';
import { safeNext } from '../utils/safe-next.js';
import { normalizeEmail } from '../../public/js/validation.js';

const loginPage = (req, res, locals = {}) => res.page('account/owner-login', {
  title: res.locals.t('owner_login.title'), values: {}, errors: {}, next: safeNext(req.query.next, ''), ...locals,
});

export function showLogin(req, res) {
  if (isOwner(req.user)) return res.redirect(safeNext(req.query.next, '/admin'));
  loginPage(req, res);
}

export async function login(req, res) {
  const email = normalizeEmail(req.body.email);
  const next = safeNext(req.body.next, '');
  const owner = await checkOwnerSignIn(email, String(req.body.password ?? ''));
  if (!owner) return loginPage(req, res.status(422), { values: { email }, errors: { form: 'errors.login_failed' }, next });
  if (owner.otp_email) {
    // Second step: the password was right, but nobody is signed in until the code sent to the owner's
    // confirmed inbox is typed (so the password alone, or the link, opens nothing).
    const sent = await sendOwnerCode(owner, req.lang);
    if (sent.error) return loginPage(req, res.status(429), { values: { email }, errors: { form: sent.error }, next });
    req.session.ownerPending = { userId: owner.id, next, until: Date.now() + CODE_TTL_MS };
    if (sent.wait) req.flash('info', 'owner_login.code_wait');
    return res.redirect('/admin/login/code');
  }
  await logIn(req, owner);
  res.redirect(next || '/admin');
}

/** The owner waiting for their code: the password was right in this browser in the last 10 minutes. */
async function pendingOwner(req) {
  const pending = req.session.ownerPending;
  if (!pending || pending.until < Date.now()) {
    delete req.session.ownerPending;
    return null;
  }
  return findOwnerAwaitingCode(pending.userId);
}

export async function codePage(req, res) {
  const owner = await pendingOwner(req);
  if (!owner) return res.redirect('/admin/login');
  const codeError = req.session.ownerCodeError;
  delete req.session.ownerCodeError;
  res.page('account/owner-code', { title: res.locals.t('owner_login.code_title'), maskedEmail: maskEmail(owner.otp_email), codeError });
}

export async function verifyCode(req, res) {
  const done = replyJsonOrRedirect(req, res);
  const owner = await pendingOwner(req);
  if (!owner) return done(false, '/admin/login');
  const error = await verifyOwnerCode(owner, req.body.code);
  if (error === 'code.wrong') {
    req.session.ownerCodeError = error;
    return done(false, '/admin/login/code');
  }
  if (error) { // expired or used up: start again with the password
    delete req.session.ownerPending;
    req.flash('error', error);
    return done(false, '/admin/login');
  }
  const next = req.session.ownerPending.next || '/admin';
  await logIn(req, owner); // a fresh session: the waiting state is gone with the old one
  done(true, next);
}

export async function resendCode(req, res) {
  const owner = await pendingOwner(req);
  if (!owner) return res.redirect('/admin/login');
  const sent = await sendOwnerCode(owner, req.lang);
  if (sent.error) req.session.ownerCodeError = sent.error;
  else req.flash('success', sent.wait ? 'owner_login.code_wait' : 'owner_login.code_resent');
  res.redirect('/admin/login/code');
}
