// Dashboard → Offers: free delivery over an amount, buy X get Y free, % off the order.
import {
  createOffer, deleteOffer, getOffer, listOffers, toggleOffer, updateOffer,
} from '../../services/offers.js';
import { piastersToInput } from '../../services/pricing.js';
import { hasErrors } from '../../utils/form.js';
import { validateOffer } from '../../validators/offer.js';
import { adminPage } from './render.js';

const OFFERS = '/admin/offers';

const formPage = (res, locals) => adminPage(res, 'offer-form', { errors: {}, ...locals });
// The form shows the minimum in pounds; after a mistake, as it was typed.
const formValues = (offer) => ({ ...offer, min_subtotal_input: offer.min_subtotal ? piastersToInput(offer.min_subtotal) : '' });
const typedValues = (values, body) => ({ ...values, min_subtotal_input: String(body.min_subtotal ?? '') });

/** Loads the offer named in the address onto req.offer, or answers 404. */
export async function loadOffer(req, res, next) {
  req.offer = await getOffer(req.params.id);
  next(req.offer ? undefined : 'route');
}

export async function list(req, res) {
  adminPage(res, 'offers', { title: res.locals.t('admin.offers'), offers: await listOffers() });
}

export function newForm(req, res) {
  formPage(res, { title: res.locals.t('admin.offer_new'), offer: null, values: { type: 'free_delivery', min_subtotal_input: '', is_active: 0 } });
}

export async function create(req, res) {
  const { values, errors } = validateOffer(req.body);
  if (hasErrors(errors)) {
    return formPage(res.status(422), { title: res.locals.t('admin.offer_new'), offer: null, values: typedValues(values, req.body), errors });
  }
  await createOffer(values);
  req.flash('success', 'admin.offer_created', { name: res.locals.offerLabel(values) });
  res.redirect(OFFERS);
}

export function editForm(req, res) {
  formPage(res, { title: res.locals.offerLabel(req.offer), offer: req.offer, values: formValues(req.offer) });
}

export async function update(req, res) {
  const { offer } = req;
  const { values, errors } = validateOffer(req.body);
  if (hasErrors(errors)) {
    return formPage(res.status(422), { title: res.locals.offerLabel(offer), offer, values: typedValues(values, req.body), errors });
  }
  await updateOffer(offer.id, values);
  req.flash('success', 'admin.offer_saved', { name: res.locals.offerLabel(values) });
  res.redirect(OFFERS);
}

export async function toggle(req, res) {
  const isOn = await toggleOffer(req.offer);
  req.flash('success', isOn ? 'admin.offer_activated' : 'admin.offer_deactivated', { name: res.locals.offerLabel(req.offer) });
  res.redirect(OFFERS);
}

/** Past orders keep their own copy of the offers they used, so deleting an offer doesn't change them. */
export async function remove(req, res) {
  await deleteOffer(req.offer.id);
  req.flash('success', 'admin.offer_deleted', { name: res.locals.offerLabel(req.offer) });
  res.redirect(OFFERS);
}
