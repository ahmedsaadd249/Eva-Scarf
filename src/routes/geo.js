// JSON endpoints for the map picker on the profile page (signed-in customers only).
import { Router } from 'express';
import { sharedRateLimit } from '../rate-limit.js';
import { cleanQuery, GeoError, parseLatLng, reverseGeocode, searchPlaces } from '../geo.js';

const router = Router();

const fail = (res, status, key) => res.status(status).json({ error: res.locals.t(key) });

router.use('/api/geo', (req, res, next) => (req.user ? next() : fail(res, 401, 'geo.error_login')));
router.use('/api/geo', sharedRateLimit('geo', {
  windowMs: 60 * 1000,
  limit: Number(process.env.GEO_RATE_LIMIT || 30),
  handler: (req, res) => fail(res, 429, 'geo.error_rate'),
}));

async function answer(res, work) {
  try {
    res.json(await work());
  } catch (err) {
    if (!(err instanceof GeoError)) throw err;
    fail(res, err.status, err.key);
  }
}

router.get('/api/geo/reverse', (req, res) => {
  const point = parseLatLng(req.query.lat, req.query.lng);
  if (!point) return fail(res, 400, 'geo.error_bad_point');
  return answer(res, () => reverseGeocode(point.lat, point.lng, req.lang));
});

router.get('/api/geo/search', (req, res) => {
  const q = cleanQuery(req.query.q);
  if (!q) return fail(res, 400, 'geo.error_bad_query');
  return answer(res, async () => ({ results: await searchPlaces(q, req.lang) }));
});

export default router;
