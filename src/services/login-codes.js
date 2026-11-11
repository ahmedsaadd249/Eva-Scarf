// One-time codes sent by email.
// - Customers sign in with one: no account to create and no password. The first time an email signs in,
//   a customer is created for it; their name, phones and address are filled in at checkout.
// - The store owner signs in with a password at /admin/login, and, once switched on in Settings, also
//   with a code sent to their confirmed inbox (users.otp_email).
// Every kind of code ("purpose") gets the same protection, and a code of one kind never works for another.
import crypto from 'node:crypto';
import { get, run } from '../lib/db.js';
import { sha256 } from './auth.js';
import { sendLoginCodeEmail } from './emails.js';
import { emailError, normalizeEmail, toLatinDigits } from '../../public/js/validation.js';

export const CODE_TTL_MS = 10 * 60 * 1000;
export const RESEND_AFTER_MS = 60 * 1000;
export const MAX_ATTEMPTS = 5;
export const MAX_CODES_PER_HOUR = 5; // with 5 tries each: at most 25 guesses an hour at one email's codes

const hashCode = (email, code) => sha256(`${email}:${code}`);
const sameHash = (a, b) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

/** Six digits, the code itself, from what was typed (Arabic digits and spaces allowed). */
export function cleanCode(input) {
  const digits = toLatinDigits(input).replace(/\s+/g, '');
  return /^\d{6}$/.test(digits) ? digits : null;
}

/**
 * Make a code for `email` and send it. Returns { email }, { email, wait: true } or { error }.
 * A code sent less than a minute ago is not replaced (`wait`), so nobody can flood an inbox, and at most
 * MAX_CODES_PER_HOUR codes of a kind go to one email in an hour, so codes can't be guessed by asking again and again.
 */
async function issueCode(email, purpose, send) {
  const recent = await get('SELECT 1 FROM login_codes WHERE email = ? AND purpose = ? AND used = 0 AND expires_at > ?',
    [email, purpose, Date.now() + CODE_TTL_MS - RESEND_AFTER_MS]);
  if (recent) return { email, wait: true };
  const lastHour = await get(`SELECT COUNT(*)::int AS n FROM login_codes
                              WHERE email = ? AND purpose = ? AND created_at > now() - interval '1 hour'`, [email, purpose]);
  if (lastHour.n >= MAX_CODES_PER_HOUR) return { error: 'code.too_many' };

  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
  await run('UPDATE login_codes SET used = 1 WHERE email = ? AND purpose = ? AND used = 0', [email, purpose]); // only the newest works
  await run('INSERT INTO login_codes (email, code_hash, expires_at, purpose) VALUES (?, ?, ?, ?)',
    [email, hashCode(email, code), Date.now() + CODE_TTL_MS, purpose]);
  if (Math.random() < 0.05) await run('DELETE FROM login_codes WHERE expires_at < ?', [Date.now() - 24 * 3600 * 1000]);
  send(code);
  return { email };
}

/**
 * Check a code. Returns null when it's right, or a text key. After 5 wrong tries the code stops working
 * and a new one has to be sent.
 */
async function checkCode(email, rawCode, purpose) {
  const row = await get('SELECT * FROM login_codes WHERE email = ? AND purpose = ? AND used = 0 AND expires_at > ? ORDER BY id DESC LIMIT 1',
    [email, purpose, Date.now()]);
  if (!row || row.attempts >= MAX_ATTEMPTS) return 'code.expired';
  const code = cleanCode(rawCode);
  if (!code || !sameHash(hashCode(email, code), row.code_hash)) {
    const left = await get('UPDATE login_codes SET attempts = attempts + 1 WHERE id = ? RETURNING attempts', [row.id]);
    return left.attempts >= MAX_ATTEMPTS ? 'code.expired' : 'code.wrong';
  }
  // Mark it used in the same statement that checks it, so the same code can't be used twice at once.
  const claimed = await get('UPDATE login_codes SET used = 1 WHERE id = ? AND used = 0 RETURNING id', [row.id]);
  return claimed ? null : 'code.expired';
}

// ---------- Customers ----------

/** Send a customer sign-in code to `email`. */
export async function sendLoginCode(rawEmail, lang) {
  const email = normalizeEmail(rawEmail);
  const error = emailError(email);
  if (error) return { error };
  const user = await get('SELECT id, role, lang FROM users WHERE email = ?', [email]);
  // The owner signs in at /admin/login. Answer as for anyone else (so the form doesn't reveal which email
  // is the owner's), but send no code.
  if (user?.role === 'admin') return { email };
  return issueCode(email, 'customer', (code) => sendLoginCodeEmail(email, code, user?.lang || lang));
}

/** Check a customer code. Returns { user } (created if this email is new) or { error } with a text key. */
export async function verifyLoginCode(rawEmail, rawCode, lang) {
  const email = normalizeEmail(rawEmail);
  if (emailError(email)) return { error: 'code.expired' };
  const error = await checkCode(email, rawCode, 'customer');
  if (error) return { error };

  let user = await get('SELECT * FROM users WHERE email = ?', [email]);
  if (user?.role === 'admin') return { error: 'code.expired' }; // never: the owner's email gets no customer code
  if (!user) {
    user = await get(`INSERT INTO users (email, password_hash, full_name, lang) VALUES (?, NULL, '', ?)
                      ON CONFLICT (email) DO UPDATE SET email = excluded.email RETURNING *`, [email, lang === 'en' ? 'en' : 'ar']);
  }
  return { user };
}

// ---------- The store owner's second step ----------

/** After the right password: a code to the owner's confirmed inbox. */
export function sendOwnerCode(owner, lang) {
  return issueCode(owner.otp_email, 'owner', (code) => sendLoginCodeEmail(owner.otp_email, code, lang, 'owner'));
}

/** Null when the owner's code is right, or a text key. */
export function verifyOwnerCode(owner, rawCode) {
  return checkCode(owner.otp_email, rawCode, 'owner');
}

/** Confirming an inbox for the owner's codes (Settings): a code to that inbox. */
export async function sendSetupCode(rawEmail, lang) {
  const email = normalizeEmail(rawEmail);
  const error = emailError(email);
  if (error) return { error };
  return issueCode(email, 'owner-setup', (code) => sendLoginCodeEmail(email, code, lang, 'owner-setup'));
}

/** Null when the confirmation code for `email` is right, or a text key. */
export function verifySetupCode(email, rawCode) {
  return checkCode(email, rawCode, 'owner-setup');
}

/** "a•••@gmail.com": enough for the owner to recognise their inbox, not enough to read it off a screen. */
export function maskEmail(email) {
  const [name, domain] = String(email).split('@');
  return `${name.slice(0, 1)}•••${name.length > 4 ? name.slice(-1) : ''}@${domain}`;
}
