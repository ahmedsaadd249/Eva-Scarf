import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';

// Must be set before the app modules are imported: throwaway database, fake Nominatim address,
// a short spacing between requests so the test stays fast, and a known contact address.
process.env.DATABASE_URL = '';
process.env.PGLITE_DIR = 'memory://geo-test';
process.env.NOMINATIM_URL = 'https://nominatim.test/';
process.env.GEO_MIN_INTERVAL_MS = '150';
process.env.MAIL_FROM = 'Eva Scarf <shop@example.com>';
const { closeDb } = await import('../src/db.js');
const { cleanQuery, GeoError, parseLatLng, resetGeoCache, reverseGeocode, searchPlaces } = await import('../src/geo.js');
const { nameIn } = await import('../public/js/location-picker.js');
const zones = (await import('../src/default-zones.json', { with: { type: 'json' } })).default;

const realFetch = globalThis.fetch;
let calls;
/** Replace fetch with a fake Nominatim that answers `body` (or fails). */
function mockNominatim(body, { status = 200, throws = false } = {}) {
  globalThis.fetch = async (url, options) => {
    calls.push({ url: new URL(url), at: Date.now(), headers: options.headers });
    if (throws) throw new TypeError('fetch failed');
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  };
}
const place = {
  lat: '30.0561234', lon: '31.2003456', display_name: 'شارع الأربعين، المهندسين، الجيزة، مصر',
  address: { road: 'شارع الأربعين', house_number: '14', suburb: 'المهندسين', city: 'الجيزة' },
  osm_id: 123, licence: 'ODbL', boundingbox: ['1', '2', '3', '4'],
};

beforeEach(() => {
  calls = [];
  resetGeoCache();
});
after(async () => {
  globalThis.fetch = realFetch;
  await closeDb();
});

test('coordinates must be numbers in range', () => {
  assert.deepEqual(parseLatLng('30.05', '31.2'), { lat: 30.05, lng: 31.2 });
  assert.equal(parseLatLng('', '31'), null);
  assert.equal(parseLatLng('91', '31'), null);
  assert.equal(parseLatLng('30', '-181'), null);
  assert.equal(parseLatLng('abc', '31'), null);
  assert.equal(parseLatLng(undefined, undefined), null);
});

test('search text is trimmed and must be 2-120 characters', () => {
  assert.equal(cleanQuery('  المهندسين   شارع  '), 'المهندسين شارع');
  assert.equal(cleanQuery('x'), null);
  assert.equal(cleanQuery(''), null);
  assert.equal(cleanQuery('a'.repeat(121)), null);
});

test('reverse lookup sends the right request and trims the answer', async () => {
  mockNominatim(place);
  const result = await reverseGeocode(30.0561234, 31.2003456, 'ar');
  assert.deepEqual(result, {
    name: 'شارع الأربعين 14، المهندسين',
    address: place.display_name,
    road: 'شارع الأربعين',
    house_number: '14',
    area: 'المهندسين',
    areas: ['المهندسين', 'الجيزة'],
    lat: 30.0561234,
    lng: 31.2003456,
  });
  const { url, headers } = calls[0];
  assert.equal(url.origin + url.pathname, 'https://nominatim.test/reverse');
  assert.equal(url.searchParams.get('format'), 'jsonv2');
  assert.equal(url.searchParams.get('accept-language'), 'ar');
  assert.equal(headers['User-Agent'], 'EvaScarf/1.0 (+shop@example.com)');
});

test('search is limited to Egypt and returns at most what Nominatim gives', async () => {
  mockNominatim([place, { ...place, display_name: 'الدقي، الجيزة، مصر', address: { suburb: 'الدقي' } }]);
  const results = await searchPlaces('المهندسين', 'en');
  assert.equal(results.length, 2);
  assert.equal(results[1].name, 'الدقي');
  assert.equal(calls[0].url.searchParams.get('countrycodes'), 'eg');
  assert.equal(calls[0].url.searchParams.get('limit'), '5');
  assert.equal(calls[0].url.searchParams.get('accept-language'), 'en');
});

test('the same lookup is answered from the cache', async () => {
  mockNominatim(place);
  await reverseGeocode(30.05, 31.2, 'ar');
  await reverseGeocode(30.05, 31.2, 'ar');
  assert.equal(calls.length, 1);
  await reverseGeocode(30.05, 31.2, 'en'); // other language = other answer
  assert.equal(calls.length, 2);
});

test('requests to Nominatim are spaced out', async () => {
  mockNominatim(place);
  await Promise.all([reverseGeocode(30.01, 31.2), reverseGeocode(30.02, 31.2), reverseGeocode(30.03, 31.2)]);
  assert.equal(calls.length, 3);
  const gaps = calls.slice(1).map((c, i) => c.at - calls[i].at);
  assert.ok(gaps.every((g) => g >= 140), `gaps ${gaps.join(', ')} ms`);
});

test('a failing or unreachable service becomes a friendly error', async () => {
  const geoError = (key) => (e) => e instanceof GeoError && e.key === key;
  mockNominatim({}, { status: 503 });
  await assert.rejects(reverseGeocode(30, 31), geoError('geo.error_service'));
  mockNominatim(null, { throws: true });
  await assert.rejects(searchPlaces('Dokki'), geoError('geo.error_service'));
  mockNominatim({ error: 'Unable to geocode' });
  await assert.rejects(reverseGeocode(10, 10), geoError('geo.error_not_found'));
});

test('map area names are matched to the delivery neighborhoods', () => {
  const zoneFor = (area) => zones.find((z) => nameIn(z.name_ar, area) || nameIn(z.name_en, area))?.name_en ?? null;
  assert.equal(zoneFor('المهندسين'), 'Mohandessin');
  assert.equal(zoneFor('Al Mohandesin'), 'Mohandessin');
  assert.equal(zoneFor('حي الدقي'), 'Dokki');
  assert.equal(zoneFor('الزمالك'), 'Zamalek');
  assert.equal(zoneFor('مدينة الشروق'), 'El Shorouk');
  assert.equal(zoneFor('6th of October City'), '6th of October');
  assert.equal(zoneFor('حدائق الاهرام'), 'Hadayek El Ahram');
  assert.equal(zoneFor('مصر الجديده'), 'Heliopolis');
  // Areas that are not one of the neighborhoods stay unmatched.
  assert.equal(zoneFor('منطقة أ'), null);
  assert.equal(zoneFor('الجيزة'), null);
  assert.equal(zoneFor('مصر'), null);
  assert.equal(nameIn('', 'الدقي'), false);
  assert.equal(nameIn('الدقي', 'شارع الدقي'), true);
});
