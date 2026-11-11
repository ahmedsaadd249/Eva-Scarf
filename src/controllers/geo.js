// JSON answers for the map picker on the profile and checkout pages (signed-in visitors only).
import { cleanQuery, GeoError, parseLatLng, reverseGeocode, searchPlaces } from '../services/geo.js';

const fail = (res, status, key) => res.status(status).json({ error: res.locals.t(key) });

export function requireSignedIn(req, res, next) {
  if (req.user) return next();
  fail(res, 401, 'geo.error_login');
}

async function answer(res, work) {
  try {
    res.json(await work());
  } catch (err) {
    if (!(err instanceof GeoError)) throw err;
    fail(res, err.status, err.key);
  }
}

export function reverse(req, res) {
  const point = parseLatLng(req.query.lat, req.query.lng);
  if (!point) return fail(res, 400, 'geo.error_bad_point');
  return answer(res, () => reverseGeocode(point.lat, point.lng, req.lang));
}

export function search(req, res) {
  const q = cleanQuery(req.query.q);
  if (!q) return fail(res, 400, 'geo.error_bad_query');
  return answer(res, async () => ({ results: await searchPlaces(q, req.lang) }));
}
