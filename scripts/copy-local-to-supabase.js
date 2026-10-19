// npm run db:copy-local [-- --replace]
// One-time move of the store's data from this computer's database (data/pglite) into Supabase
// (DATABASE_URL in .env): neighborhoods and fees, accounts, products and photos, orders, ratings,
// settings and the email history. Photos in uploads/ go to Supabase Storage and their links are updated.
// Stop the local site first: the local database can only be open in one program at a time.
// Refuses to run if Supabase already has products, orders or customers, unless --replace is given
// (which empties Supabase first). Sessions and password-reset links are not copied.
import fs from 'node:fs';
import path from 'node:path';
import { config, ROOT } from '../src/config.js';
import { closeDb, get, setupDatabase, tx } from '../src/db.js';
import { saveImage, usesSupabaseStorage } from '../src/storage.js';

if (!config.databaseUrl) {
  console.error('Set DATABASE_URL in .env first (the Supabase database to copy into).');
  process.exit(1);
}
if (!usesSupabaseStorage) {
  console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env first (needed for the photos).');
  process.exit(1);
}
const SOURCE_DIR = process.env.LOCAL_PGLITE_DIR || path.join(ROOT, 'data', 'pglite');
if (!SOURCE_DIR.startsWith('memory://') && !fs.existsSync(SOURCE_DIR)) {
  console.error(`No local database at ${SOURCE_DIR}`);
  process.exit(1);
}
const replace = process.argv.includes('--replace');

// Copy order matters (foreign keys).
const TABLES = ['zones', 'users', 'categories', 'products', 'product_images', 'orders', 'order_items', 'order_status_history', 'ratings', 'email_log'];
const BATCH = 100; // rows per INSERT: few round trips to a far-away database

console.log(`From: local database (${SOURCE_DIR})`);
console.log(`To:   ${new URL(config.databaseUrl).hostname} (Supabase)`);

const { PGlite } = await import('@electric-sql/pglite');
const source = new PGlite(SOURCE_DIR, { parsers: { 20: Number, 1700: Number } });
await source.waitReady;
const read = async (sql) => (await source.query(sql)).rows;

await setupDatabase();
const existing = await get(`SELECT (SELECT COUNT(*) FROM products) + (SELECT COUNT(*) FROM orders)
                                   + (SELECT COUNT(*) FROM users WHERE role <> 'admin') AS n`);
if (Number(existing.n) > 0 && !replace) {
  console.error('Supabase already has products, orders or customers. Run again with --replace to overwrite them.');
  await source.close();
  await closeDb();
  process.exit(1);
}

// Photos: upload local /uploads/… files once and remember their new addresses.
const moved = new Map();
const publicUrl = (name) => `${config.supabase.url}/storage/v1/object/public/${config.supabase.bucket}/${name}`;
async function movePhoto(p) {
  if (!p || !p.startsWith('/uploads/')) return p; // /samples/… ship with the site; URLs are already remote
  if (moved.has(p)) return moved.get(p);
  const name = path.basename(p);
  const file = path.join(config.uploadsDir, name);
  if (!fs.existsSync(file)) {
    console.warn(`  ! photo missing on this computer, link kept as is: ${p}`);
    return p;
  }
  const type = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' }[path.extname(name).toLowerCase()] ?? 'application/octet-stream';
  let stored;
  try {
    stored = await saveImage(fs.readFileSync(file), name, type);
  } catch (err) {
    if (!/Duplicate|already exists|409/i.test(err.message)) throw err;
    stored = publicUrl(name); // uploaded by an earlier run
  }
  moved.set(p, stored);
  return stored;
}

// Read everything (and upload photos) before the transaction, so it stays short.
const data = {};
const sourceTables = new Set((await read("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'")).map((r) => r.table_name));
for (const table of TABLES) {
  const rows = sourceTables.has(table) ? await read(`SELECT * FROM ${table} ORDER BY id`) : [];
  for (const row of rows) {
    if (table === 'product_images') row.path = await movePhoto(row.path);
    if (table === 'order_items' || table === 'categories') row.image = await movePhoto(row.image);
  }
  data[table] = rows;
}
const settings = await read('SELECT key, value FROM settings');
await source.close();

const columnsOf = async (t, table) => new Set((await t.all(
  'SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = ?', [table],
)).map((r) => r.column_name));

await tx(async (t) => {
  // Start clean: Supabase's starting neighborhoods and owner account are replaced by this store's own.
  await t.run(`TRUNCATE ${[...TABLES].reverse().join(', ')}, sessions, password_resets RESTART IDENTITY CASCADE`);
  for (const table of TABLES) {
    const rows = data[table];
    if (rows.length) {
      const target = await columnsOf(t, table);
      const cols = Object.keys(rows[0]).filter((c) => target.has(c));
      for (let i = 0; i < rows.length; i += BATCH) {
        const chunk = rows.slice(i, i + BATCH);
        const values = chunk.map(() => `(${cols.map(() => '?').join(', ')})`).join(', ');
        await t.run(`INSERT INTO ${table} (${cols.join(', ')}) VALUES ${values}`, chunk.flatMap((r) => cols.map((c) => r[c])));
      }
    }
    // New rows continue numbering after the copied ones (order numbers stay unique).
    await t.get(`SELECT setval(pg_get_serial_sequence('${table}', 'id'), COALESCE((SELECT MAX(id) FROM ${table}), 0) + 1, false)`);
    console.log(`  ${table}: ${rows.length}`);
  }
  for (const s of settings) {
    await t.run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value', [s.key, s.value]);
  }
  console.log(`  settings: ${settings.length}`);
});

if (moved.size) console.log(`  photos uploaded to Supabase Storage: ${moved.size}`);
await closeDb();
console.log('Copy complete.');
