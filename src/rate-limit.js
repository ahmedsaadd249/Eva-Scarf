// Rate limits whose counts live in the database (table rate_limits), so every running copy of the
// site shares them (Vercel runs several) and they survive restarts and deploys. A small store for
// express-rate-limit; each limit gets its own key prefix so their counts don't mix.
import { rateLimit } from 'express-rate-limit';
import { get, run } from './db.js';

class DbStore {
  localKeys = false; // a count made by one copy of the site is seen by all of them

  constructor(prefix) {
    this.prefix = prefix;
  }

  init(options) {
    this.windowMs = options.windowMs;
  }

  async get(key) {
    const row = await get('SELECT hits, reset_at FROM rate_limits WHERE key = ?', [this.prefix + key]);
    return row && Number(row.reset_at) > Date.now() ? { totalHits: row.hits, resetTime: new Date(Number(row.reset_at)) } : undefined;
  }

  /** One statement, so two requests at the same moment can't both slip under the limit. */
  async increment(key) {
    const now = Date.now();
    const row = await get(`
      INSERT INTO rate_limits (key, hits, reset_at) VALUES (?, 1, ?)
      ON CONFLICT (key) DO UPDATE SET
        hits = CASE WHEN rate_limits.reset_at <= ? THEN 1 ELSE rate_limits.hits + 1 END,
        reset_at = CASE WHEN rate_limits.reset_at <= ? THEN excluded.reset_at ELSE rate_limits.reset_at END
      RETURNING hits, reset_at`, [this.prefix + key, now + this.windowMs, now, now]);
    // Clear out finished windows now and then (there's no long-running timer on serverless).
    if (Math.random() < 0.01) run('DELETE FROM rate_limits WHERE reset_at < ?', [now]).catch(() => {});
    return { totalHits: Number(row.hits), resetTime: new Date(Number(row.reset_at)) };
  }

  async decrement(key) {
    await run('UPDATE rate_limits SET hits = GREATEST(hits - 1, 0) WHERE key = ?', [this.prefix + key]);
  }

  async resetKey(key) {
    await run('DELETE FROM rate_limits WHERE key = ?', [this.prefix + key]);
  }
}

/** express-rate-limit with counts shared through the database. `name` keeps each limit's counts apart. */
export function sharedRateLimit(name, options) {
  return rateLimit({ standardHeaders: 'draft-8', legacyHeaders: false, ...options, store: new DbStore(`${name}:`) });
}
