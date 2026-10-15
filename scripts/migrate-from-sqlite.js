// npm run migrate:sqlite [-- --replace]
// One-time move of the store's data from the old SQLite file (data/eva.db) into Postgres:
// the local database, or Supabase when DATABASE_URL is set. Photos in uploads/ are copied to
// Supabase Storage when it's configured, and their paths updated.
// Refuses to run if the target already has customers, products or orders, unless --replace is given
// (which empties the target first).
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { config, ROOT } from '../src/config.js';
import { closeDb, get, setupDatabase, tx } from '../src/db.js';
import { saveImage, usesSupabaseStorage } from '../src/storage.js';

const SOURCE = process.env.SQLITE_PATH ? path.resolve(ROOT, process.env.SQLITE_PATH) : path.join(ROOT, 'data', 'eva.db');
if (!fs.existsSync(SOURCE)) {
  console.error(`No SQLite database at ${SOURCE}`);
  process.exit(1);
}
const old = new DatabaseSync(SOURCE, { readOnly: true });
const replace = process.argv.includes('--replace');

// Copy order matters (foreign keys). Sessions, password resets and email logs aren't moved.
const TABLES = ['zones', 'users', 'categories', 'products', 'product_images', 'orders', 'order_items', 'order_status_history', 'ratings'];
const TIMESTAMPS = new Set(['created_at', 'updated_at']);

console.log(`From: ${SOURCE}`);
console.log(`To:   ${config.databaseUrl ? new URL(config.databaseUrl).hostname : `local database (${config.pgliteDir})`}`);
await setupDatabase();

const existing = await get(`SELECT (SELECT COUNT(*) FROM users) + (SELECT COUNT(*) FROM products) + (SELECT COUNT(*) FROM orders) AS n`);
if (existing.n > 0 && !replace) {
  console.error('The target already has customers, products or orders. Run again with --replace to overwrite it.');
  await closeDb();
  process.exit(1);
}

// Photos: upload local /uploads/… files to Supabase Storage once, and remember the new URLs.
const moved = new Map();
async function movePhoto(p) {
  if (!usesSupabaseStorage || !p || !p.startsWith('/uploads/')) return p;
  if (moved.has(p)) return moved.get(p);
  const file = path.join(ROOT, 'uploads', path.basename(p));
  if (!fs.existsSync(file)) {
    console.warn(`  ! missing photo ${p} (kept as is)`);
    return p;
  }
  const ext = path.extname(file).toLowerCase();
  const type = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' }[ext] ?? 'application/octet-stream';
  const url = await saveImage(fs.readFileSync(file), path.basename(file), type);
  moved.set(p, url);
  return url;
}

const columnsOf = async (db, table) => (await db.all(
  'SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = ?', [table],
)).map((r) => r.column_name);

// Prepare rows (including photo uploads) before the transaction, so it stays short.
const data = {};
for (const table of TABLES) {
  const exists = old.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table);
  const rows = exists ? old.prepare(`SELECT * FROM ${table} ORDER BY id`).all().map((r) => ({ ...r })) : [];
  for (const row of rows) {
    for (const col of Object.keys(row)) {
      if (TIMESTAMPS.has(col) && typeof row[col] === 'string' && !row[col].endsWith('Z')) row[col] = `${row[col].replace(' ', 'T')}Z`;
    }
    if (table === 'product_images') row.path = await movePhoto(row.path);
    if (table === 'order_items') row.image = await movePhoto(row.image);
    if (table === 'categories') row.image = await movePhoto(row.image);
  }
  data[table] = rows;
}
const settings = old.prepare("SELECT key, value FROM settings WHERE key IN ('store_email')").all();
const manifestFile = path.join(ROOT, 'uploads', '.imported.json');

await tx(async (t) => {
  // Start clean: the default neighborhoods are replaced by the store's own list (with its fees).
  await t.run(`TRUNCATE ${[...TABLES].reverse().join(', ')}, sessions, password_resets RESTART IDENTITY CASCADE`);
  for (const table of TABLES) {
    const target = new Set(await columnsOf(t, table));
    for (const row of data[table]) {
      const cols = Object.keys(row).filter((c) => target.has(c));
      await t.run(`INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`, cols.map((c) => row[c]));
    }
    // Continue numbering after the copied ids.
    await t.get(`SELECT setval(pg_get_serial_sequence('${table}', 'id'), COALESCE((SELECT MAX(id) FROM ${table}), 0) + 1, false)`);
    console.log(`  ${table}: ${data[table].length}`);
  }
  for (const s of settings) {
    await t.run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value', [s.key, s.value]);
  }
  await t.run("INSERT INTO settings (key, value) VALUES ('zones_seeded', '1') ON CONFLICT (key) DO NOTHING");
  if (fs.existsSync(manifestFile)) {
    await t.run("INSERT INTO settings (key, value) VALUES ('imported_collection', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
      [fs.readFileSync(manifestFile, 'utf8')]);
  }
});

if (moved.size) console.log(`  photos uploaded to Supabase Storage: ${moved.size}`);
old.close();
await closeDb();
console.log('Migration complete.');
