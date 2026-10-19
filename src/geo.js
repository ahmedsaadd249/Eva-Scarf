// Address lookup for the map picker, through OpenStreetMap's Nominatim. Called from our server
// (not the browser) so we can follow Nominatim's usage policy (identify the store, at most one
// request per second, cache results) and keep the page's Content-Security-Policy tight.
import { config } from './config.js';
import { getSetting } from './db.js';

const CACHE_TTL_MS = 24 * 3600 * 1000;
const CACHE_MAX = 2000;
const cache = new Map();
let nextSlot = 0; // earliest time the next request to Nominatim may start

export class GeoError extends Error {
  constructor(status, key) {
    super(key);
    this.status = status;
    this.key = key;
  }
}

/** Numbers in range, or null. */
export function parseLatLng(lat, lng) {
  const a = String(lat ?? '').trim();
  const b = String(lng ?? '').trim();
  const la = Number(a);
  const lo = Number(b);
  if (!a || !b || !Number.isFinite(la) || !Number.isFinite(lo) || la < -90 || la > 90 || lo < -180 || lo > 180) return null;
  return { lat: la, lng: lo };
}

/** Search text of 2–120 characters, or null. */
export function cleanQuery(q) {
  const s = String(q ?? '').trim().replace(/\s+/g, ' ');
  return s.length >= 2 && s.length <= 120 ? s : null;
}

async function contact() {
  const storeEmail = await getSetting('store_email').catch(() => '');
  return storeEmail || /<([^>]+)>/.exec(config.mailFrom)?.[1] || config.mailFrom;
}

/** Space requests at least geoMinIntervalMs apart across the whole server. */
async function waitForSlot() {
  const now = Date.now();
  const start = Math.max(now, nextSlot);
  nextSlot = start + config.geoMinIntervalMs;
  if (start > now) await new Promise((r) => setTimeout(r, start - now));
}

async function nominatim(path, params) {
  const url = new URL(config.nominatimUrl + path);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  const key = url.toString();
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.data;

  await waitForSlot();
  let res;
  try {
    res = await fetch(url, {
      headers: { 'User-Agent': `EvaScarf/1.0 (+${await contact()})`, Accept: 'application/json' },
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    throw new GeoError(502, 'geo.error_service');
  }
  if (!res.ok) throw new GeoError(502, 'geo.error_service');
  const data = await res.json();
  cache.set(key, { data, expires: Date.now() + CACHE_TTL_MS });
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value); // drop the oldest
  return data;
}

// Address parts that can name a neighborhood, most local first (used to pick the delivery zone).
const AREA_KEYS = ['neighbourhood', 'suburb', 'quarter', 'residential', 'city_district', 'district', 'borough', 'hamlet', 'village', 'town', 'city'];

/**
 * From a Nominatim result: a short name (street / area), the full address line, and the parts the
 * profile form can be filled with (road, building number, local area, every area name to match zones).
 */
function describe(place) {
  const a = place.address ?? {};
  const road = a.road || a.pedestrian || a.footway || '';
  const houseNumber = String(a.house_number ?? '').trim().slice(0, 20);
  const area = a.neighbourhood || a.suburb || a.quarter || a.residential || a.city_district || '';
  const name = [road && houseNumber ? `${road} ${houseNumber}` : road, area].filter(Boolean).join('، ')
    || String(place.display_name ?? '').split(',')[0].trim();
  return {
    name,
    address: String(place.display_name ?? ''),
    road,
    house_number: houseNumber,
    area,
    areas: [...new Set(AREA_KEYS.map((k) => String(a[k] ?? '').trim()).filter(Boolean))],
    lat: Number(place.lat),
    lng: Number(place.lon),
  };
}

export async function reverseGeocode(lat, lng, lang = 'ar') {
  const data = await nominatim('/reverse', {
    format: 'jsonv2', lat: lat.toFixed(6), lon: lng.toFixed(6), zoom: 18, addressdetails: 1, 'accept-language': lang,
  });
  if (!data || data.error) throw new GeoError(404, 'geo.error_not_found');
  return describe(data);
}

export async function searchPlaces(q, lang = 'ar') {
  const data = await nominatim('/search', {
    format: 'jsonv2', q, countrycodes: 'eg', limit: 5, addressdetails: 1, 'accept-language': lang,
  });
  return Array.isArray(data) ? data.map(describe) : [];
}

/** For tests. */
export function resetGeoCache() {
  cache.clear();
  nextSlot = 0;
}
