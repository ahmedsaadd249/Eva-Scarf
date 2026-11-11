// The owner's delivery forms (dashboard → Delivery): fees for every neighborhood, and adding one.
import { FEE_INPUT_MAX, ZONE_NAME_MAX } from '../config/constants.js';
import { piastersToInput, toPiasters } from '../services/pricing.js';
import { cleanText } from '../utils/form.js';

/** A fee as the form shows it: pounds, or empty for "not delivered to". */
export const feeInput = (zone) => (zone.fee == null ? '' : piastersToInput(zone.fee));

/** Fee in piasters, null for an empty field (not delivered to), or undefined when it isn't an amount. */
function parseFee(text) {
  if (text === '') return null;
  return toPiasters(text) ?? undefined;
}

/**
 * The fees form. Inputs are named fee[z<ID>] (purely numeric keys would be turned into an array by the
 * form parser). Returns { updates: [[fee, id], …], feeInputs, feeErrors }.
 */
export function validateFees(zones, body) {
  const sent = body.fee && typeof body.fee === 'object' ? body.fee : {};
  const updates = [];
  const feeInputs = Object.fromEntries(zones.map((z) => [z.id, feeInput(z)]));
  const feeErrors = {};
  for (const zone of zones) {
    const raw = sent[`z${zone.id}`];
    if (raw === undefined) continue;
    const typed = String(raw).trim();
    feeInputs[zone.id] = typed;
    const fee = parseFee(typed);
    if (fee === undefined) feeErrors[zone.id] = true;
    else updates.push([fee, zone.id]);
  }
  return { updates, feeInputs, feeErrors };
}

/** Adding a neighborhood: { values (as typed), fee, errors }. Whether it already exists is checked by the caller. */
export function validateNewZone(body) {
  const values = {
    city_ar: cleanText(body.city_ar, ZONE_NAME_MAX),
    name_ar: cleanText(body.name_ar, ZONE_NAME_MAX),
    name_en: cleanText(body.name_en, ZONE_NAME_MAX),
    fee: cleanText(body.fee, FEE_INPUT_MAX),
  };
  const errors = {};
  if (!values.city_ar) errors.city_ar = 'errors.required';
  if (!values.name_ar) errors.name_ar = 'errors.required';
  const fee = parseFee(values.fee);
  if (fee === undefined) errors.fee = 'admin.error_fee';
  return { values, fee, errors };
}
