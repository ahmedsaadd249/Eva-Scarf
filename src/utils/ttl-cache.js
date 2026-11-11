import { CACHE_TTL_MS } from '../config/constants.js';

/**
 * A value loaded on first use and kept for `ttlMs`. The store runs as several copies at once (Cloudflare),
 * and only the copy that saved a change can clear its own cache, so keep the time short.
 */
export function ttlCache(load, ttlMs = CACHE_TTL_MS) {
  let value = null;
  let loadedAt = 0;
  return {
    async get() {
      if (value === null || Date.now() - loadedAt > ttlMs) {
        loadedAt = Date.now();
        value = await load();
      }
      return value;
    },
    invalidate() {
      value = null;
    },
  };
}
