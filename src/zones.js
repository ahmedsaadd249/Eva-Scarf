// Delivery neighborhoods ("zones"): each has its own delivery fee.
// The list is small and changes rarely, so it's cached briefly and cleared when the owner edits it
// (other running copies of the site pick up the change within CACHE_TTL_MS).
import { all, CACHE_TTL_MS } from './db.js';
import { localized, translate } from './i18n.js';

let cache = { at: 0, rows: null };

export async function allZones() {
  if (!cache.rows || Date.now() - cache.at > CACHE_TTL_MS) {
    cache = { at: Date.now(), rows: await all('SELECT * FROM zones ORDER BY sort_order, id') };
  }
  return cache.rows;
}

export function invalidateZones() {
  cache.rows = null;
}

export async function listZones({ deliverableOnly = false } = {}) {
  const rows = await allZones();
  return deliverableOnly ? rows.filter((z) => z.fee != null) : rows;
}

export async function getZone(id) {
  if (!id) return null;
  return (await allZones()).find((z) => z.id === Number(id)) ?? null;
}

/** The zone a customer can be delivered to, or null if it was removed or has no fee. */
export async function deliverableZone(id) {
  const zone = await getZone(id);
  return zone && zone.fee != null ? zone : null;
}

/** [{ key, label, zones }] grouped by city, in list order. */
export function groupByCity(zones, lang) {
  const groups = new Map();
  for (const z of zones) {
    if (!groups.has(z.city_ar)) groups.set(z.city_ar, { key: z.city_ar, label: localized(z, 'city', lang), zones: [] });
    groups.get(z.city_ar).zones.push(z);
  }
  return [...groups.values()];
}

/**
 * City and neighborhood names for a customer or an order, in the reader's language.
 * Uses the live zone when it still exists (from `zones`, already loaded), otherwise the Arabic names saved with the record.
 */
export function placeOf(record, lang, zones) {
  const zone = record?.zone_id ? zones.find((z) => z.id === Number(record.zone_id)) : null;
  if (zone) return { city: localized(zone, 'city', lang), village: localized(zone, 'name', lang) };
  return { city: record?.city ?? '', village: record?.village ?? '' };
}

export function formatAddress(record, lang, zones) {
  return translate(lang, 'address.format', { ...record, ...placeOf(record, lang, zones) });
}
