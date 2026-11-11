// Dashboard → Settings: the store's contact email, the owner's password, and the owner's second sign-in
// step (a code by email after the password).
import { config } from '../../config/index.js';
import { EMAIL_LOG_SHOWN } from '../../config/constants.js';
import { CODE_TTL_MS, sendSetupCode, verifySetupCode } from '../../services/login-codes.js';
import { isSmtpConfigured, recentEmails } from '../../services/mailer.js';
import {
  changePassword, isCurrentPassword, switchOffSignInCodes, switchOnSignInCodes,
} from '../../services/owner-account.js';
import { getSetting, setSetting } from '../../services/settings.js';
import { hasErrors } from '../../utils/form.js';
import { replyJsonOrRedirect } from '../../utils/http.js';
import { validateCodeEmail, validateNewPassword, validateStoreSettings } from '../../validators/settings.js';
import { adminPage } from './render.js';

const SETTINGS = '/admin/settings';
const CODES_SECTION = `${SETTINGS}#otp`;
const WRONG_PASSWORD = 'errors.password_current';

async function settingsPage(req, res, locals = {}) {
  const setup = req.session.otpSetup;
  const otpSetupError = req.session.otpSetupError;
  delete req.session.otpSetupError;
  adminPage(res, 'settings', {
    title: res.locals.t('admin.settings'),
    // The owner's second sign-in step: on (codes go to otpEmail), or an inbox waiting to be confirmed.
    otpEmail: req.user.otp_email,
    otpPending: setup && setup.until > Date.now() ? setup.email : null,
    otpSetupError,
    otpErrors: {},
    otpValues: {},
    smtpReady: isSmtpConfigured(),
    mailFrom: config.mailFrom,
    emailLog: await recentEmails(EMAIL_LOG_SHOWN),
    values: { store_email: await getSetting('store_email') },
    errors: {},
    passwordErrors: {},
    ...locals,
  });
}

const typedPassword = (value) => String(value ?? '');
const checkCurrentPassword = (req, field) => isCurrentPassword(req.user, typedPassword(req.body[field]));

export const show = (req, res) => settingsPage(req, res);

export async function saveStore(req, res) {
  const { values, errors } = validateStoreSettings(req.body);
  if (hasErrors(errors)) return settingsPage(req, res.status(422), { values, errors });
  await setSetting('store_email', values.store_email);
  req.flash('success', 'admin.settings_saved');
  res.redirect(SETTINGS);
}

/** The owner has no customer profile page, so their password is changed here. */
export async function savePassword(req, res) {
  const isCurrent = await checkCurrentPassword(req, 'current_password');
  const { password, errors } = validateNewPassword(req.body);
  if (!isCurrent) errors.current_password = WRONG_PASSWORD;
  if (hasErrors(errors)) return settingsPage(req, res.status(422), { passwordErrors: errors });
  await changePassword(req.user.id, password, req.sessionID); // signed out everywhere else
  req.flash('success', 'profile.password_changed');
  res.redirect(SETTINGS);
}

// ---------- The second sign-in step ----------
// Switching it on: the current password, then a code sent to the new inbox proves the owner can read it
// (so a typo can't lock them out). Changing the inbox works the same way; switching off needs the password.

export async function startCodes(req, res) {
  const isCurrent = await checkCurrentPassword(req, 'otp_password');
  const { email, errors } = validateCodeEmail(req.body);
  if (!isCurrent) errors.otp_password = WRONG_PASSWORD;
  if (!hasErrors(errors)) {
    const sent = await sendSetupCode(email, req.lang);
    if (sent.error) errors.otp_email = sent.error;
  }
  if (hasErrors(errors)) return settingsPage(req, res.status(422), { otpErrors: errors, otpValues: { otp_email: email } });
  req.session.otpSetup = { email, until: Date.now() + CODE_TTL_MS };
  req.flash('success', 'admin.otp_code_sent', { email });
  res.redirect(CODES_SECTION);
}

export async function confirmCodes(req, res) {
  const done = replyJsonOrRedirect(req, res);
  const setup = req.session.otpSetup;
  if (!setup || setup.until < Date.now()) {
    delete req.session.otpSetup;
    return done(false, CODES_SECTION);
  }
  const error = await verifySetupCode(setup.email, req.body.code);
  if (error) {
    if (error !== 'code.wrong') delete req.session.otpSetup; // expired or used up: send a new one
    req.session.otpSetupError = error;
    return done(false, CODES_SECTION);
  }
  await switchOnSignInCodes(req.user.id, setup.email, req.sessionID);
  delete req.session.otpSetup;
  req.flash('success', 'admin.otp_on_done');
  done(true, CODES_SECTION);
}

export function cancelCodes(req, res) {
  delete req.session.otpSetup;
  res.redirect(CODES_SECTION);
}

export async function stopCodes(req, res) {
  if (!(await checkCurrentPassword(req, 'off_password'))) {
    return settingsPage(req, res.status(422), { otpErrors: { off_password: WRONG_PASSWORD } });
  }
  await switchOffSignInCodes(req.user.id);
  req.flash('success', 'admin.otp_off_done');
  res.redirect(CODES_SECTION);
}
