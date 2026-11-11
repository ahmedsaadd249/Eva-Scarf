// Dashboard → Delivery: each neighborhood's fee (empty = not delivered to), adding and removing them.
import {
  addZone, getZone, groupByCity, listZones, removeZone, saveFees, zoneExists,
} from '../../services/zones.js';
import { hasErrors, toInt } from '../../utils/form.js';
import { feeInput, validateFees, validateNewZone } from '../../validators/zone.js';
import { adminPage } from './render.js';

const DELIVERY = '/admin/delivery';

async function deliveryPage(req, res, locals = {}) {
  const zones = await listZones();
  adminPage(res, 'delivery', {
    title: res.locals.t('admin.delivery'),
    groups: groupByCity(zones, req.lang),
    cities: [...new Set(zones.map((z) => z.city_ar))],
    feeInputs: Object.fromEntries(zones.map((z) => [z.id, feeInput(z)])),
    feeErrors: {},
    addValues: {},
    addErrors: {},
    ...locals,
  });
}

export const show = (req, res) => deliveryPage(req, res);

export async function saveFeesForm(req, res) {
  const { updates, feeInputs, feeErrors } = validateFees(await listZones(), req.body);
  if (hasErrors(feeErrors)) return deliveryPage(req, res.status(422), { feeInputs, feeErrors });
  await saveFees(updates);
  req.flash('success', 'admin.zones_saved');
  res.redirect(DELIVERY);
}

export async function add(req, res) {
  const { values, fee, errors } = validateNewZone(req.body);
  if (!errors.name_ar && (await zoneExists(values.city_ar, values.name_ar))) errors.name_ar = 'admin.error_zone_exists';
  if (hasErrors(errors)) return deliveryPage(req, res.status(422), { addValues: values, addErrors: errors });
  await addZone({ city_ar: values.city_ar, name_ar: values.name_ar, name_en: values.name_en, fee });
  req.flash('success', 'admin.zone_added', { name: values.name_ar });
  res.redirect(DELIVERY);
}

export async function remove(req, res) {
  const zone = await getZone(toInt(req.params.id));
  if (zone) {
    await removeZone(zone.id);
    req.flash('success', 'admin.zone_deleted', { name: res.locals.L(zone, 'name') });
  }
  res.redirect(DELIVERY);
}
