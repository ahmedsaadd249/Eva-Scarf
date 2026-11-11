import { all, get, run } from '../lib/db.js';

export const listAll = () => all('SELECT * FROM offers ORDER BY id DESC');
export const listActive = () => all('SELECT * FROM offers WHERE is_active = 1 ORDER BY id');
export const findById = (id) => get('SELECT * FROM offers WHERE id = ?', [id]);

const columns = (o) => [o.type, o.name_ar, o.name_en, o.min_subtotal, o.buy_qty, o.get_qty, o.percent, o.is_active];

export const insert = (offer) => run(
  'INSERT INTO offers (type, name_ar, name_en, min_subtotal, buy_qty, get_qty, percent, is_active) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  columns(offer),
);

export const update = (id, offer) => run(`
  UPDATE offers SET type = ?, name_ar = ?, name_en = ?, min_subtotal = ?, buy_qty = ?, get_qty = ?, percent = ?, is_active = ?,
         updated_at = now()
  WHERE id = ?`, [...columns(offer), id]);

export const setActive = (id, isActive) => run('UPDATE offers SET is_active = ?, updated_at = now() WHERE id = ?', [isActive, id]);
export const remove = (id) => run('DELETE FROM offers WHERE id = ?', [id]);
