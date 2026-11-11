import { get, run } from '../lib/db.js';

export const findById = (id) => get('SELECT * FROM users WHERE id = ?', [id]);
export const findByEmail = (email) => get('SELECT * FROM users WHERE email = ?', [email]);
export const findOwnerByEmail = (email) => get("SELECT * FROM users WHERE email = ? AND role = 'admin'", [email]);
export const findOwnerById = (id) => get("SELECT * FROM users WHERE id = ? AND role = 'admin'", [id]);

/** A customer for a new email (no password: customers sign in with emailed codes). Safe if two requests race. */
export const createCustomer = (email, lang) => get(`
  INSERT INTO users (email, password_hash, full_name, lang) VALUES (?, NULL, '', ?)
  ON CONFLICT (email) DO UPDATE SET email = excluded.email RETURNING *`, [email, lang]);

export const createOwner = ({ email, passwordHash, name }) => run(
  "INSERT INTO users (email, password_hash, full_name, role, lang) VALUES (?, ?, ?, 'admin', 'ar')",
  [email, passwordHash, name],
);

export const makeOwner = (id) => run("UPDATE users SET role = 'admin' WHERE id = ?", [id]);
export const setPasswordHash = (id, hash) => run('UPDATE users SET password_hash = ? WHERE id = ?', [hash, id]);
export const setLang = (id, lang) => run('UPDATE users SET lang = ? WHERE id = ?', [lang, id]);
/** The inbox the owner's sign-in codes go to; null switches the second step off. */
export const setOtpEmail = (id, email) => run('UPDATE users SET otp_email = ? WHERE id = ?', [email, id]);

/** Name, phones and delivery address. city/village keep the zone's Arabic names as a readable copy. */
export const saveDeliveryDetails = (id, values, zone) => run(`
  UPDATE users SET full_name = ?, zone_id = ?, city = ?, village = ?, street = ?, building_no = ?, apartment_no = ?,
         phone_primary = ?, phone_secondary = ?, location_lat = ?, location_lng = ?, location_label = ?
  WHERE id = ?`, [
  values.full_name, zone.id, zone.city_ar, zone.name_ar, values.street, values.building_no, values.apartment_no,
  values.phone_primary, values.phone_secondary, values.location_lat, values.location_lng, values.location_label, id,
]);

/** Marks the user welcomed and returns them, or null if they already were (so the email goes out once). */
export const markWelcomed = (id) => get('UPDATE users SET welcomed_at = now() WHERE id = ? AND welcomed_at IS NULL RETURNING *', [id]);
