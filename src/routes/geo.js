// Address lookups for the map picker: signed-in visitors only, rate-limited.
import { Router } from 'express';
import * as geo from '../controllers/geo.js';
import { geoLimiter } from '../middlewares/rate-limit.js';

const router = Router();

router.use('/api/geo', geo.requireSignedIn, geoLimiter);
router.get('/api/geo/reverse', geo.reverse);
router.get('/api/geo/search', geo.search);

export default router;
