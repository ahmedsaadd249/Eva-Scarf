// A customer's own details: name, delivery address and phones (from the profile page and from
// checkout), and the language emails are sent in.
import * as userRepo from '../repositories/users.js';
import { validateProfile } from '../../public/js/validation.js';
import { sendWelcomeEmail } from './emails.js';
import { deliverableZone } from './zones.js';

/**
 * Check the form and look up the neighborhood. Returns { values, errors, zone }; `errors` is empty when
 * everything is fine.
 */
export async function checkProfile(body) {
  const { values, errors } = validateProfile(body);
  const zone = values.zone_id ? await deliverableZone(values.zone_id) : null;
  if (values.zone_id && !zone) errors.zone_id = 'errors.zone_unavailable';
  return { values, errors, zone };
}

/** Save checked details on the user. Returns true when this was the first save (the welcome email goes out). */
export async function saveProfile(userId, values, zone) {
  await userRepo.saveDeliveryDetails(userId, values, zone);
  const welcomed = await userRepo.markWelcomed(userId);
  if (welcomed) sendWelcomeEmail(welcomed);
  return Boolean(welcomed);
}

export const saveLanguage = (userId, lang) => userRepo.setLang(userId, lang);
