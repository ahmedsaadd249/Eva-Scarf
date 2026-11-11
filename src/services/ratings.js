// Customers' ratings: given through the link in the Delivered email (no sign-in needed), shown on the
// home page when they're good and say something.
import { TESTIMONIAL_MIN_COMMENT, TESTIMONIAL_MIN_STARS, TESTIMONIALS_SHOWN } from '../config/constants.js';
import * as ratingRepo from '../repositories/ratings.js';
import { getOrder } from './orders.js';

const RATING_TOKEN = /^[A-Za-z0-9_-]{20,64}$/;

/** The delivered order this rating link belongs to, or null. The token is the customer's permission to rate. */
export async function findRateableOrder(token) {
  if (!RATING_TOKEN.test(String(token || ''))) return null;
  const order = await getOrder('token', String(token));
  return order && order.status === 'delivered' ? order : null;
}

export const rateOrder = (orderId, stars, comment) => ratingRepo.create(orderId, stars, comment || null);

export const listTestimonials = () => ratingRepo.listTestimonials({
  minStars: TESTIMONIAL_MIN_STARS, minCommentLength: TESTIMONIAL_MIN_COMMENT, limit: TESTIMONIALS_SHOWN,
});
