// Store-wide offers (dashboard → Offers): free delivery over an amount, "buy X, get Y free", and a
// percentage off the order. The arithmetic lives in pricing.js (applyOffers) and the form rules in
// validators/offer.js; this module reads, caches and saves them.
import * as offerRepo from '../repositories/offers.js';
import { ttlCache } from '../utils/ttl-cache.js';

export { OFFER_TYPES } from '../validators/offer.js';

const activeCache = ttlCache(() => offerRepo.listActive());

/** All offers, newest first (the dashboard list). */
export const listOffers = () => offerRepo.listAll();

export async function getOffer(id) {
  const n = Number(id);
  return Number.isSafeInteger(n) ? offerRepo.findById(n) : null;
}

/** The switched-on offers, cached briefly (every cart and every store page reads them). */
export const activeOffers = () => activeCache.get();

export function invalidateOffers() {
  activeCache.invalidate();
}

/** Run a change, then make every page see it. */
const andRefresh = (change) => async (...args) => {
  const result = await change(...args);
  invalidateOffers();
  return result;
};

export const createOffer = andRefresh((values) => offerRepo.insert(values));
export const updateOffer = andRefresh((id, values) => offerRepo.update(id, values));
export const deleteOffer = andRefresh((id) => offerRepo.remove(id));

/** Switch on ↔ off; returns whether it's now on. */
export const toggleOffer = andRefresh(async (offer) => {
  const isOn = !offer.is_active;
  await offerRepo.setActive(offer.id, isOn ? 1 : 0);
  return isOn;
});
