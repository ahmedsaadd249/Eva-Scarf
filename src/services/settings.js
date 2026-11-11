// Store settings the owner can change (rows of the settings table), cached briefly: they change rarely
// and every page reads them.
import { SETTING_DEFAULTS } from '../config/constants.js';
import * as settingRepo from '../repositories/settings.js';
import { ttlCache } from '../utils/ttl-cache.js';

const cache = ttlCache(async () => Object.fromEntries((await settingRepo.listAll()).map((r) => [r.key, r.value])));

export async function getSetting(key) {
  return (await cache.get())[key] ?? SETTING_DEFAULTS[key];
}

export async function setSetting(key, value) {
  await settingRepo.save(key, String(value));
  cache.invalidate();
}
