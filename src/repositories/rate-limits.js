import { get, run } from '../lib/db.js';

export const find = (key) => get('SELECT hits, reset_at FROM rate_limits WHERE key = ?', [key]);

/**
 * Count one hit, starting a new window when the old one is over. One statement, so two requests at the
 * same moment can't both slip under the limit. Returns { hits, reset_at }.
 */
export const increment = (key, now, windowMs) => get(`
  INSERT INTO rate_limits (key, hits, reset_at) VALUES (?, 1, ?)
  ON CONFLICT (key) DO UPDATE SET
    hits = CASE WHEN rate_limits.reset_at <= ? THEN 1 ELSE rate_limits.hits + 1 END,
    reset_at = CASE WHEN rate_limits.reset_at <= ? THEN excluded.reset_at ELSE rate_limits.reset_at END
  RETURNING hits, reset_at`, [key, now + windowMs, now, now]);

export const decrement = (key) => run('UPDATE rate_limits SET hits = GREATEST(hits - 1, 0) WHERE key = ?', [key]);
export const remove = (key) => run('DELETE FROM rate_limits WHERE key = ?', [key]);
export const removeFinished = (now) => run('DELETE FROM rate_limits WHERE reset_at < ?', [now]);
