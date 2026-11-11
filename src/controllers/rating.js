// Rating a delivered order through the link in the Delivered email (no sign-in: the link's token is the permission).
import { findRateableOrder, rateOrder } from '../services/ratings.js';
import { hasErrors } from '../utils/form.js';
import { validateRating } from '../validators/rating.js';

const MAX_PRESET_STARS = 5;

const ratePage = (res, locals) => res.page('shop/rate', { title: res.locals.t('rate.title'), errors: {}, comment: '', ...locals });

export async function show(req, res, next) {
  const order = await findRateableOrder(req.params.token);
  if (!order) return next();
  // The stars clicked in the email arrive as ?stars=N.
  const preset = Math.min(MAX_PRESET_STARS, Math.max(0, Math.trunc(Number(req.query.stars) || 0)));
  ratePage(res, { order, preset });
}

export async function submit(req, res, next) {
  const order = await findRateableOrder(req.params.token);
  if (!order) return next();
  if (order.rating_stars) return res.redirect(`/rate/${req.params.token}`);
  const { stars, comment, errors } = validateRating(req.body);
  if (hasErrors(errors)) return ratePage(res.status(422), { order, preset: 0, comment, errors });
  await rateOrder(order.id, stars, comment);
  res.redirect(`/rate/${req.params.token}`);
}
