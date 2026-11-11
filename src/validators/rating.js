import { RATING_COMMENT_MAX } from '../config/constants.js';

/** 1 to 5 stars and an optional comment: { stars, comment, errors }. */
export function validateRating(body) {
  const stars = Math.trunc(Number(body.stars));
  const comment = String(body.comment ?? '').trim().slice(0, RATING_COMMENT_MAX);
  const errors = stars >= 1 && stars <= 5 ? {} : { stars: 'rate.error_stars' };
  return { stars, comment, errors };
}
