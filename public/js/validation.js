// Validation rules shared by the server (imported by src/routes) and the browser (forms).
// Functions return an i18n error key, or null when the value is valid.

export const EMAIL_RE = /^[^\s@]+@([^\s@.]+\.)+[^\s@.]{2,}$/;
export const PHONE_RE = /^\+?\d{8,15}$/;
// Typed address parts; the city and neighborhood come from the chosen delivery zone (zone_id).
export const ADDRESS_FIELDS = ['street', 'building_no', 'apartment_no'];

/** Convert Arabic-Indic and Persian digits to 0-9 so customers can type with any keyboard. */
export function toLatinDigits(value) {
  return String(value ?? '')
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
}

export function normalizeEmail(value) {
  return String(value ?? '').trim().toLowerCase();
}

export function emailError(email) {
  if (!email) return 'errors.required';
  if (email.length > 254 || !EMAIL_RE.test(email)) return 'errors.email_invalid';
  return null;
}

export const PASSWORD_RULES = {
  length: (p) => p.length >= 8,
  upper: (p) => /[A-Z]/.test(p),
  lower: (p) => /[a-z]/.test(p),
  digit: (p) => /\d/.test(p),
  symbol: (p) => /[^A-Za-z0-9\s]/.test(p),
};

export function passwordChecks(password) {
  const p = String(password ?? '');
  return Object.fromEntries(Object.entries(PASSWORD_RULES).map(([key, test]) => [key, test(p)]));
}

export function passwordError(password) {
  const p = String(password ?? '');
  if (!p) return 'errors.required';
  if (p.length > 128) return 'errors.password_too_long';
  return Object.values(passwordChecks(p)).every(Boolean) ? null : 'errors.password_weak';
}

export function normalizePhone(value) {
  return toLatinDigits(value).replace(/[\s\-().]/g, '');
}

/** Validate the profile form. Returns cleaned values and a map of field -> error key. */
export function validateProfile(input = {}) {
  const clean = (v, max) => toLatinDigits(v).trim().replace(/\s+/g, ' ').slice(0, max);
  const values = {
    full_name: clean(input.full_name, 80),
    zone_id: Math.trunc(Number(input.zone_id)) || null,
    street: clean(input.street, 120),
    building_no: clean(input.building_no, 20),
    apartment_no: clean(input.apartment_no, 20),
    phone_primary: normalizePhone(input.phone_primary),
    phone_secondary: normalizePhone(input.phone_secondary),
  };
  const errors = {};

  if (values.full_name.length < 2) errors.full_name = 'errors.name_required';
  if (!values.zone_id) errors.zone_id = 'errors.zone_required';
  for (const field of ADDRESS_FIELDS) {
    if (!values[field]) errors[field] = 'errors.required';
  }
  // Both phone numbers are required, and they must be different numbers.
  for (const field of ['phone_primary', 'phone_secondary']) {
    if (!values[field]) errors[field] = 'errors.required';
    else if (!PHONE_RE.test(values[field])) errors[field] = 'errors.phone_invalid';
  }
  if (!errors.phone_secondary && !errors.phone_primary && values.phone_secondary === values.phone_primary) {
    errors.phone_secondary = 'errors.phone_same';
  }
  const location = validateLocation(input);
  Object.assign(values, location.values);
  if (location.error) errors.location = location.error;
  return { values, errors };
}

/**
 * Optional map location of the delivery address: both coordinates (in range) or neither.
 * Returns { values: { location_lat, location_lng, location_label }, error } with nulls when not given.
 */
export function validateLocation(input = {}) {
  const none = { location_lat: null, location_lng: null, location_label: null };
  const latText = String(input.location_lat ?? '').trim();
  const lngText = String(input.location_lng ?? '').trim();
  if (!latText && !lngText) return { values: none, error: null };
  const lat = Number(latText);
  const lng = Number(lngText);
  const valid = latText !== '' && lngText !== '' && Number.isFinite(lat) && Number.isFinite(lng)
    && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
  if (!valid) return { values: none, error: 'errors.location_invalid' };
  const label = String(input.location_label ?? '').trim().replace(/\s+/g, ' ').slice(0, 300);
  const round = (n) => Math.round(n * 1e6) / 1e6; // ~10 cm; more digits mean nothing for a doorstep
  return { values: { location_lat: round(lat), location_lng: round(lng), location_label: label || null }, error: null };
}

export function isProfileComplete(user) {
  return Boolean(user && user.zone_id && user.phone_primary && user.phone_secondary && ADDRESS_FIELDS.every((f) => user[f]));
}
