// Passwords (only the store owner has one; customers sign in with emailed codes) and who is signed in.
import crypto from 'node:crypto';
import { promisify } from 'node:util';
import * as sessionRepo from '../repositories/sessions.js';
import * as userRepo from '../repositories/users.js';

const scrypt = promisify(crypto.scrypt);
// One of OWASP's recommended scrypt settings (N = 2^15, r = 8, p = 3): as strong as N = 2^17 with
// p = 1, but 32 MB of memory per hash instead of 128 MB, which matters when several logins run at
// once on a small server. Older hashes keep their own settings and still verify.
const SCRYPT = { N: 2 ** 15, r: 8, p: 3 };
const MAXMEM = 64 * 1024 * 1024;
const KEYLEN = 64;
const SALT_BYTES = 16;
const MAX_PARALLELISM = 4;

export async function hashPassword(password) {
  const salt = crypto.randomBytes(SALT_BYTES);
  const key = await scrypt(password, salt, KEYLEN, { ...SCRYPT, maxmem: MAXMEM });
  return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('base64'), key.toString('base64')].join('$');
}

// Used when the email is unknown, so a failed login takes the same time either way: today's settings,
// so checking it costs as much as a real hash, and it matches no password. A constant rather than a
// real hash made at startup, because Cloudflare doesn't allow random values while the app loads.
const DUMMY_HASH = ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, Buffer.alloc(SALT_BYTES).toString('base64'), Buffer.alloc(KEYLEN).toString('base64')].join('$');

export async function verifyPassword(password, stored = DUMMY_HASH) {
  const [alg, N, r, p, salt, hash] = String(stored).split('$');
  if (alg !== 'scrypt' || !(128 * N * r <= MAXMEM && +p >= 1 && +p <= MAX_PARALLELISM)) return false;
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

/** The signed-in user for a session, or null if the account is gone. */
export const findSessionUser = (userId) => userRepo.findById(userId);

/** Sign the user out on every other device (after a password change, or switching on sign-in codes). */
export async function endOtherSessions(userId, keepSid) {
  await sessionRepo.removeOthersOfUser(userId, keepSid);
}
