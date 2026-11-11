import { all, db, get, run } from '../lib/db.js';

export const listAll = () => all('SELECT * FROM zones ORDER BY sort_order, id');

export const setFee = (id, fee, conn = db) => conn.run('UPDATE zones SET fee = ? WHERE id = ?', [fee, id]);

export const exists = async (cityAr, nameAr) => Boolean(
  await get('SELECT 1 FROM zones WHERE city_ar = ? AND name_ar = ?', [cityAr, nameAr]),
);

/** The English name already used for this city ('' if none). */
export const cityEnglishName = async (cityAr) => (
  await get("SELECT city_en FROM zones WHERE city_ar = ? AND city_en != '' LIMIT 1", [cityAr])
)?.city_en ?? '';

export const nextSortOrder = async () => ((await get('SELECT MAX(sort_order) AS m FROM zones'))?.m ?? 0) + 1;

export const insert = (z) => run(
  'INSERT INTO zones (city_ar, city_en, name_ar, name_en, fee, sort_order) VALUES (?, ?, ?, ?, ?, ?)',
  [z.city_ar, z.city_en, z.name_ar, z.name_en, z.fee, z.sort_order],
);

export const remove = (id) => run('DELETE FROM zones WHERE id = ?', [id]);
