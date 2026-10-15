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
  return { values, errors };
}

export function isProfileComplete(user) {
  return Boolean(user && user.zone_id && user.phone_primary && user.phone_secondary && ADDRESS_FIELDS.every((f) => user[f]));
}
