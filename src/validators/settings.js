// The owner's Settings forms. Checking the current password needs the database, so the controller adds
// that error itself.
import { emailError, normalizeEmail, passwordError } from '../../public/js/validation.js';

/** The store's contact email (may be left empty). */
export function validateStoreSettings(body) {
  const values = { store_email: normalizeEmail(body.store_email) };
  const errors = {};
  if (values.store_email && emailError(values.store_email)) errors.store_email = 'errors.email_invalid';
  return { values, errors };
}

/** A new owner password: strong enough, and typed the same twice. */
export function validateNewPassword(body) {
  const password = String(body.new_password ?? '');
  const errors = {};
  const weak = passwordError(password);
  if (weak) errors.new_password = weak;
  if (password !== String(body.new_password_confirm ?? '')) errors.new_password_confirm = 'errors.password_mismatch';
  return { password, errors };
}

/** The inbox the owner's sign-in codes should go to. */
export function validateCodeEmail(body) {
  const email = normalizeEmail(body.otp_email);
  const error = emailError(email);
  return { email, errors: error ? { otp_email: error } : {} };
}
