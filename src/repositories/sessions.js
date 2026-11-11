import { get, run } from '../lib/db.js';

export const find = (sid) => get('SELECT sess, expires FROM sessions WHERE sid = ?', [sid]);

export const save = (sid, sess, expires) => run(`
  INSERT INTO sessions (sid, sess, expires) VALUES (?, ?, ?)
  ON CONFLICT (sid) DO UPDATE SET sess = excluded.sess, expires = excluded.expires`, [sid, JSON.stringify(sess), expires]);

export const setExpiry = (sid, expires) => run('UPDATE sessions SET expires = ? WHERE sid = ?', [expires, sid]);
export const remove = (sid) => run('DELETE FROM sessions WHERE sid = ?', [sid]);
export const removeExpired = (now) => run('DELETE FROM sessions WHERE expires < ?', [now]);

/** Every session of this user except `keepSid` (signs them out on their other devices). */
export const removeOthersOfUser = (userId, keepSid) => run(
  "DELETE FROM sessions WHERE sess->>'userId' = ? AND sid != ?",
  [String(userId), keepSid ?? ''],
);
