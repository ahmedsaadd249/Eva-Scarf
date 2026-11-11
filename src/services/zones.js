// Delivery neighborhoods ("zones"): each has its own delivery fee, or none (not delivered to yet).
// The list is small and changes rarely, so it's cached briefly and cleared when the owner edits it.
import { localized, translate } from '../lib/i18n.js';
import { tx } from '../lib/db.js';
import * as zoneRepo from '../repositories/zones.js';
import { ttlCache } from '../utils/ttl-cache.js';

const cache = ttlCache(() => zoneRepo.listAll());

export const allZones = () => cache.get();

export function invalidateZones() {
  cache.invalidate();
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

// ---------- The owner's edits (dashboard → Delivery) ----------

/** `updates`: [[fee or null, zoneId], …], saved together. */
export async function saveFees(updates) {
  await tx(async (t) => {
    for (const [fee, id] of updates) await zoneRepo.setFee(id, fee, t);
  });
  invalidateZones();
}

export const zoneExists = (cityAr, nameAr) => zoneRepo.exists(cityAr, nameAr);

/** Add a neighborhood at the end of the list. One in a city that already exists reuses that city's English name. */
export async function addZone({ city_ar, name_ar, name_en, fee }) {
  const city_en = await zoneRepo.cityEnglishName(city_ar);
  const sort_order = await zoneRepo.nextSortOrder();
  await zoneRepo.insert({ city_ar, city_en, name_ar, name_en, fee, sort_order });
  invalidateZones();
}

/** Customers who chose it are asked to pick another neighborhood; past orders keep the name. */
export async function removeZone(id) {
  await zoneRepo.remove(id);
  invalidateZones();
}
