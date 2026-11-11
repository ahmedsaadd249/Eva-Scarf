import { all, run } from '../lib/db.js';

export const listAll = () => all('SELECT key, value FROM settings');

export const save = (key, value) => run(
  'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value',
  [key, value],
);
