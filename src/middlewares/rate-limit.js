// Rate limits whose counts live in the database (table rate_limits), so every running copy of the
// site shares them (Cloudflare runs several) and they survive restarts and deploys. A small store for
// express-rate-limit; each limit gets its own key prefix so their counts don't mix.
import { rateLimit } from 'express-rate-limit';
import { config } from '../config/index.js';
import { EMAIL_MAX_LENGTH, HOUR_MS, MINUTE_MS } from '../config/constants.js';
import { keepAlive } from '../lib/platform.js';
import * as rateLimitRepo from '../repositories/rate-limits.js';
import { normalizeEmail } from '../../public/js/validation.js';

const CLEANUP_CHANCE = 0.01; // no long-running timer on serverless: clear finished windows now and then

class DbStore {
  localKeys = false; // a count made by one copy of the site is seen by all of them

  constructor(prefix) {
    this.prefix = prefix;
  }

  init(options) {
    this.windowMs = options.windowMs;
  }

  async get(key) {
    const row = await rateLimitRepo.find(this.prefix + key);
    return row && Number(row.reset_at) > Date.now() ? { totalHits: row.hits, resetTime: new Date(Number(row.reset_at)) } : undefined;
  }

  async increment(key) {
    const now = Date.now();
    const row = await rateLimitRepo.increment(this.prefix + key, now, this.windowMs);
    if (Math.random() < CLEANUP_CHANCE) keepAlive(rateLimitRepo.removeFinished(now).catch(() => {}));
    return { totalHits: Number(row.hits), resetTime: new Date(Number(row.reset_at)) };
  }

  async decrement(key) {
    await rateLimitRepo.decrement(this.prefix + key);
  }

  async resetKey(key) {
    await rateLimitRepo.remove(this.prefix + key);
  }
}

/** express-rate-limit with counts shared through the database. `name` keeps each limit's counts apart. */
export function sharedRateLimit(name, options) {
  return rateLimit({ standardHeaders: 'draft-8', legacyHeaders: false, ...options, store: new DbStore(`${name}:`) });
}

const tooManyPage = (req, res) => res.status(429).page('error', {
  title: res.locals.t('errors.rate_title'), message: res.locals.t('errors.rate'),
});

// ---------- The store's limits ----------

/** Sign-in (sending and checking codes, the owner's password): per visitor. */
export const authLimiter = sharedRateLimit('auth', {
  windowMs: 15 * MINUTE_MS, limit: config.rateLimits.auth, handler: tooManyPage,
});

/** The owner's password: also per email, wherever the tries come from, so guesses spread over many addresses still add up. */
export const ownerLoginLimiter = sharedRateLimit('owner-login', {
  windowMs: HOUR_MS,
  limit: config.rateLimits.ownerLogin,
  keyGenerator: (req) => normalizeEmail(req.body.email).slice(0, EMAIL_MAX_LENGTH) || 'none',
  handler: tooManyPage,
});

/** Changing the owner's password or sign-in codes in Settings (each asks for the current password). */
export const ownerPasswordLimiter = sharedRateLimit('owner-password', {
  windowMs: 15 * MINUTE_MS, limit: config.rateLimits.auth, handler: tooManyPage,
});

/** The map's address lookups (JSON answers). */
export const geoLimiter = sharedRateLimit('geo', {
  windowMs: MINUTE_MS,
  limit: config.rateLimits.geo,
  handler: (req, res) => res.status(429).json({ error: res.locals.t('geo.error_rate') }),
});
