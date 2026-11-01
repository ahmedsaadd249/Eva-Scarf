// Sign-in for customers with a one-time code sent by email: no account to create and no password.
// The first time an email signs in, a customer is created for it; their name, phones and address
// are filled in at checkout. The store owner never signs in this way (they use /admin/login).
import crypto from 'node:crypto';
import { get, run } from './db.js';
import { sha256 } from './auth.js';
import { sendLoginCodeEmail } from './emails.js';
import { emailError, normalizeEmail, toLatinDigits } from '../public/js/validation.js';

export const CODE_TTL_MS = 10 * 60 * 1000;
export const RESEND_AFTER_MS = 60 * 1000;
export const MAX_ATTEMPTS = 5;
export const MAX_CODES_PER_HOUR = 5; // with 5 tries each: at most 25 guesses an hour at one email's codes

const hashCode = (email, code) => sha256(`${email}:${code}`);
const sameHash = (a, b) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

/** Six digits, the code itself, from what the customer typed (Arabic digits and spaces allowed). */
export function cleanCode(input) {
  const digits = toLatinDigits(input).replace(/\s+/g, '');
  return /^\d{6}$/.test(digits) ? digits : null;
}

/**
 * Send a code to `email`. Returns { email } on success, or { error } with a text key.
 * A code sent less than a minute ago is not replaced (`wait: true`), so nobody can flood an inbox, and at
 * most MAX_CODES_PER_HOUR codes go to one email in an hour, so codes can't be guessed by asking again and again.
 */
export async function sendLoginCode(rawEmail, lang) {
  const email = normalizeEmail(rawEmail);
  const error = emailError(email);
  if (error) return { error };
  const user = await get('SELECT id, role, lang FROM users WHERE email = ?', [email]);
  // The owner signs in at /admin/login. Answer as for anyone else (so the form doesn't reveal which email
  // is the owner's), but send no code.
  if (user?.role === 'admin') return { email };

  const recent = await get('SELECT 1 FROM login_codes WHERE email = ? AND used = 0 AND expires_at > ?',
    [email, Date.now() + CODE_TTL_MS - RESEND_AFTER_MS]);
  if (recent) return { email, wait: true };
  const lastHour = await get("SELECT COUNT(*)::int AS n FROM login_codes WHERE email = ? AND created_at > now() - interval '1 hour'", [email]);
  if (lastHour.n >= MAX_CODES_PER_HOUR) return { error: 'code.too_many' };

  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
  await run('UPDATE login_codes SET used = 1 WHERE email = ? AND used = 0', [email]); // only the newest code works
  await run('INSERT INTO login_codes (email, code_hash, expires_at) VALUES (?, ?, ?)', [email, hashCode(email, code), Date.now() + CODE_TTL_MS]);
  if (Math.random() < 0.05) await run('DELETE FROM login_codes WHERE expires_at < ?', [Date.now() - 24 * 3600 * 1000]);
  sendLoginCodeEmail(email, code, user?.lang || lang);
  return { email };
}

/**
 * Check a code. Returns { user } (created if this email is new) or { error } with a text key.
 * After 5 wrong tries the code stops working and a new one has to be sent.
 */
export async function verifyLoginCode(rawEmail, rawCode, lang) {
  const email = normalizeEmail(rawEmail);
  if (emailError(email)) return { error: 'code.expired' };
  const row = await get('SELECT * FROM login_codes WHERE email = ? AND used = 0 AND expires_at > ? ORDER BY id DESC LIMIT 1', [email, Date.now()]);
  if (!row || row.attempts >= MAX_ATTEMPTS) return { error: 'code.expired' };
  const code = cleanCode(rawCode);
  if (!code || !sameHash(hashCode(email, code), row.code_hash)) {
    const left = await get('UPDATE login_codes SET attempts = attempts + 1 WHERE id = ? RETURNING attempts', [row.id]);
    return { error: left.attempts >= MAX_ATTEMPTS ? 'code.expired' : 'code.wrong' };
  }
  // Mark it used in the same statement that checks it, so the same code can't be used twice at once.
  const claimed = await get('UPDATE login_codes SET used = 1 WHERE id = ? AND used = 0 RETURNING id', [row.id]);
  if (!claimed) return { error: 'code.expired' };

  let user = await get('SELECT * FROM users WHERE email = ?', [email]);
  if (user?.role === 'admin') return { error: 'code.owner_email' };
  if (!user) {
    user = await get(`INSERT INTO users (email, password_hash, full_name, lang) VALUES (?, NULL, '', ?)
                      ON CONFLICT (email) DO UPDATE SET email = excluded.email RETURNING *`, [email, lang === 'en' ? 'en' : 'ar']);
  }
  return { user };
}
