// One-time codes sent by email.
// - Customers sign in with one: no account to create and no password. The first time an email signs in,
//   a customer is created for it; their name, phones and address are filled in at checkout.
// - The store owner signs in with a password at /admin/login, and, once switched on in Settings, also
//   with a code sent to their confirmed inbox (users.otp_email).
// Every kind of code ("purpose") gets the same protection, and a code of one kind never works for another.
import crypto from 'node:crypto';
import { config } from '../config/index.js';
import { DAY_MS, MINUTE_MS } from '../config/constants.js';
import * as codeRepo from '../repositories/login-codes.js';
import * as userRepo from '../repositories/users.js';
import { safeEqual, sha256 } from '../utils/crypto.js';
import { emailError, normalizeEmail, toLatinDigits } from '../../public/js/validation.js';
import { sendLoginCodeEmail } from './emails.js';

export const CODE_TTL_MS = 10 * MINUTE_MS;
export const RESEND_AFTER_MS = MINUTE_MS;
export const MAX_ATTEMPTS = 5;
export const MAX_CODES_PER_HOUR = 5; // with 5 tries each: at most 25 guesses an hour at one email's codes
const CODE_DIGITS = 6;
const CODE_PATTERN = /^\d{6}$/;
const CLEANUP_CHANCE = 0.05; // no long-running timer on serverless: clear old codes now and then
const KEEP_EXPIRED_FOR_MS = DAY_MS;

const hashCode = (email, code) => sha256(`${email}:${code}`);

/** Six digits, the code itself, from what was typed (Arabic digits and spaces allowed). */
export function cleanCode(input) {
  const digits = toLatinDigits(input).replace(/\s+/g, '');
  return CODE_PATTERN.test(digits) ? digits : null;
}

/**
 * Make a code for `email` and send it. Returns { email }, { email, wait: true } or { error }.
 * A code sent less than a minute ago is not replaced (`wait`), so nobody can flood an inbox, and at most
 * MAX_CODES_PER_HOUR codes of a kind go to one email in an hour, so codes can't be guessed by asking again and again.
 */
async function issueCode(email, purpose, send) {
  const sentRecently = await codeRepo.hasUnusedExpiringAfter(email, purpose, Date.now() + CODE_TTL_MS - RESEND_AFTER_MS);
  if (sentRecently) return { email, wait: true };
  if ((await codeRepo.countSentLastHour(email, purpose)) >= MAX_CODES_PER_HOUR) return { error: 'code.too_many' };

  const code = String(crypto.randomInt(0, 10 ** CODE_DIGITS)).padStart(CODE_DIGITS, '0');
  await codeRepo.retireUnused(email, purpose);
  await codeRepo.insert({ email, codeHash: hashCode(email, code), expiresAt: Date.now() + CODE_TTL_MS, purpose });
  if (Math.random() < CLEANUP_CHANCE) await codeRepo.removeExpiredBefore(Date.now() - KEEP_EXPIRED_FOR_MS);
  send(code);
  return { email };
}

/**
 * Check a code. Returns null when it's right, or a text key. After MAX_ATTEMPTS wrong tries the code
 * stops working and a new one has to be sent.
 */
async function checkCode(email, rawCode, purpose) {
  const row = await codeRepo.findLatestUnused(email, purpose, Date.now());
  if (!row || row.attempts >= MAX_ATTEMPTS) return 'code.expired';
  const code = cleanCode(rawCode);
  if (!code || !safeEqual(hashCode(email, code), row.code_hash)) {
    const attempts = await codeRepo.addAttempt(row.id);
    return attempts >= MAX_ATTEMPTS ? 'code.expired' : 'code.wrong';
  }
  return (await codeRepo.claim(row.id)) ? null : 'code.expired';
}

// ---------- Customers ----------

/** Send a customer sign-in code to `email`. */
export async function sendLoginCode(rawEmail, lang) {
  const email = normalizeEmail(rawEmail);
  const error = emailError(email);
  if (error) return { error };
  const user = await userRepo.findByEmail(email);
  // The owner signs in at /admin/login. Answer as for anyone else (so the form doesn't reveal which email
  // is the owner's), but send no code.
  if (user?.role === 'admin') return { email };
  // A store-wide daily cap, so a script asking for codes for made-up addresses can't use up the day's
  // emails (sign-in, orders, status updates). The owner's codes aren't counted: the owner can always sign in.
  if ((await codeRepo.countSentLastDay('customer')) >= config.rateLimits.codeEmailsPerDay) return { error: 'code.busy' };
  return issueCode(email, 'customer', (code) => sendLoginCodeEmail(email, code, user?.lang || lang));
}

/** Check a customer code. Returns { user } (created if this email is new) or { error } with a text key. */
export async function verifyLoginCode(rawEmail, rawCode, lang) {
  const email = normalizeEmail(rawEmail);
  if (emailError(email)) return { error: 'code.expired' };
  const error = await checkCode(email, rawCode, 'customer');
  if (error) return { error };

  const user = await userRepo.findByEmail(email);
  if (user?.role === 'admin') return { error: 'code.expired' }; // never: the owner's email gets no customer code
  return { user: user ?? await userRepo.createCustomer(email, lang === 'en' ? 'en' : 'ar') };
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
