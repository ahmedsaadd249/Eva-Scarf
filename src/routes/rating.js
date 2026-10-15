import { Router } from 'express';
import { run } from '../db.js';
import { getOrder } from '../orders.js';

const router = Router();

// The token in the Delivered email is the customer's permission to rate; no login needed.
async function findOrder(req) {
  const token = String(req.params.token || '');
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return null;
  const order = await getOrder('token', token);
  return order && order.status === 'delivered' ? order : null;
}

router.get('/rate/:token', async (req, res, next) => {
  const order = await findOrder(req);
  if (!order) return next();
  const preset = Math.min(5, Math.max(0, Math.trunc(Number(req.query.stars) || 0)));
  res.page('shop/rate', { title: res.locals.t('rate.title'), order, preset, errors: {}, comment: '' });
});

router.post('/rate/:token', async (req, res, next) => {
  const order = await findOrder(req);
  if (!order) return next();
  if (order.rating_stars) return res.redirect(`/rate/${req.params.token}`);

  const stars = Math.trunc(Number(req.body.stars));
  const comment = String(req.body.comment ?? '').trim().slice(0, 1000);
  if (!(stars >= 1 && stars <= 5)) {
    return res.status(422).page('shop/rate', {
      title: res.locals.t('rate.title'), order, preset: 0, comment, errors: { stars: 'rate.error_stars' },
    });
  }
  await run('INSERT INTO ratings (order_id, stars, comment) VALUES (?, ?, ?) ON CONFLICT (order_id) DO NOTHING', [order.id, stars, comment || null]);
  res.redirect(`/rate/${req.params.token}`);
});

export default router;
