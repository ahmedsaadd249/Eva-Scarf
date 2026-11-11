// Saving a customer's name, delivery address and phones: from the profile page and from checkout.
import { get, run } from '../lib/db.js';
import { sendWelcomeEmail } from './emails.js';
import { deliverableZone } from './zones.js';
import { validateProfile } from '../../public/js/validation.js';

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
  // city/village keep the Arabic names as a readable copy; the zone is the source of truth.
  await run(`UPDATE users SET full_name = ?, zone_id = ?, city = ?, village = ?, street = ?, building_no = ?, apartment_no = ?,
               phone_primary = ?, phone_secondary = ?, location_lat = ?, location_lng = ?, location_label = ? WHERE id = ?`,
  [values.full_name, zone.id, zone.city_ar, zone.name_ar, values.street, values.building_no, values.apartment_no,
    values.phone_primary, values.phone_secondary, values.location_lat, values.location_lng, values.location_label, userId]);
  // First complete save: send the welcome email (once; the update only matches if not welcomed yet).
  const welcomed = await get('UPDATE users SET welcomed_at = now() WHERE id = ? AND welcomed_at IS NULL RETURNING *', [userId]);
  if (welcomed) sendWelcomeEmail(welcomed);
  return Boolean(welcomed);
}
