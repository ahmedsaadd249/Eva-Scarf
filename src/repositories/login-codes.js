import { get, run } from '../lib/db.js';

/** An unused code of this kind for this email that expires after `expiresAfter` (i.e. was sent recently). */
export const hasUnusedExpiringAfter = async (email, purpose, expiresAfter) => Boolean(await get(
  'SELECT 1 FROM login_codes WHERE email = ? AND purpose = ? AND used = 0 AND expires_at > ?',
  [email, purpose, expiresAfter],
));

export const countSentLastHour = async (email, purpose) => (await get(`
  SELECT COUNT(*)::int AS n FROM login_codes
  WHERE email = ? AND purpose = ? AND created_at > now() - interval '1 hour'`, [email, purpose])).n;

/** Only the newest code works: retire the ones still waiting. */
export const retireUnused = (email, purpose) => run(
  'UPDATE login_codes SET used = 1 WHERE email = ? AND purpose = ? AND used = 0',
  [email, purpose],
);

export const insert = ({ email, codeHash, expiresAt, purpose }) => run(
  'INSERT INTO login_codes (email, code_hash, expires_at, purpose) VALUES (?, ?, ?, ?)',
  [email, codeHash, expiresAt, purpose],
);

export const removeExpiredBefore = (time) => run('DELETE FROM login_codes WHERE expires_at < ?', [time]);

export const findLatestUnused = (email, purpose, now) => get(
  'SELECT * FROM login_codes WHERE email = ? AND purpose = ? AND used = 0 AND expires_at > ? ORDER BY id DESC LIMIT 1',
  [email, purpose, now],
);

/** Counts a wrong try; returns the tries so far. */
export const addAttempt = async (id) => (await get('UPDATE login_codes SET attempts = attempts + 1 WHERE id = ? RETURNING attempts', [id])).attempts;

/** Marks the code used in the same statement that checks it, so it can't be used twice at once. True if this call got it. */
export const claim = async (id) => Boolean(await get('UPDATE login_codes SET used = 1 WHERE id = ? AND used = 0 RETURNING id', [id]));
