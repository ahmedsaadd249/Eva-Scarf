import { Router } from 'express';
import * as rating from '../controllers/rating.js';

const router = Router();

// The link in the Delivered email.
router.get('/rate/:token', rating.show);
router.post('/rate/:token', rating.submit);

export default router;
