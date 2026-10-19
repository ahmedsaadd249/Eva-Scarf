// Database access (PostgreSQL).
// - Production: Supabase, via DATABASE_URL.
// - Local development and tests: PGlite, an embedded Postgres (no install needed), stored in data/pglite.
// Queries use `?` placeholders; they're converted to Postgres's $1, $2… here.
import fs from 'node:fs';
import path from 'node:path';
import { config, ROOT } from './config.js';

const toPg = (sql) => {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
};
const clean = (params) => params.map((v) => (v === undefined ? null : v));

let driverPromise = null;

/** A small uniform interface over node-postgres (pool) and PGlite. */
function getDriver() {
  driverPromise ??= config.databaseUrl ? openPool() : openPglite();
  return driverPromise;
}

async function openPool() {
  const { default: pg } = await import('pg');
  // Return counts/sums as numbers (not strings) and money-safe numerics as numbers.
  pg.types.setTypeParser(20, Number);
  pg.types.setTypeParser(1700, Number);
  const url = new URL(config.databaseUrl);
  const local = ['localhost', '127.0.0.1'].includes(url.hostname);
  url.searchParams.delete('sslmode'); // SSL is configured below instead
  const pool = new pg.Pool({
    connectionString: url.toString(),
    max: config.dbPoolMax,
    ssl: local ? false : { rejectUnauthorized: false },
    idleTimeoutMillis: 10_000,
  });
  const wrap = (c) => ({ query: (sql, params) => c.query(sql, params) });
  return {
    query: (sql, params) => pool.query(sql, params),
    exec: (sql) => pool.query(sql),
    async transaction(fn) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await fn(wrap(client));
        await client.query('COMMIT');
        return result;
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
}

async function openPglite() {
  const { PGlite } = await import('@electric-sql/pglite');
  const dir = config.pgliteDir;
  if (!dir.startsWith('memory://')) fs.mkdirSync(dir, { recursive: true });
  const db = new PGlite(dir, { parsers: { 20: Number, 1700: Number } });
  await db.waitReady;
  const driver = {
    query: (sql, params) => db.query(sql, params),
    exec: (sql) => db.exec(sql),
    transaction: (fn) => db.transaction((t) => fn({ query: (sql, params) => t.query(sql, params) })),
    close: () => db.close(),
  };
  await setupDatabase(driver); // local databases set themselves up
  return driver;
}

const normalise = (r) => ({ rows: r.rows, changes: r.rowCount ?? r.affectedRows ?? 0 });

function api(run) {
  return {
    /** All rows. */
    all: async (sql, params = []) => (await run(toPg(sql), clean(params))).rows,
    /** First row or null. */
    get: async (sql, params = []) => (await run(toPg(sql), clean(params))).rows[0] ?? null,
    /** For INSERT/UPDATE/DELETE: { changes, rows } (rows from RETURNING). */
    run: async (sql, params = []) => normalise(await run(toPg(sql), clean(params))),
  };
}

const base = api(async (sql, params) => (await getDriver()).query(sql, params));
export const { all, get, run } = base;

/** Run fn(t) in a transaction; t has all/get/run. Inside it, use only t (not the global functions). */
export async function tx(fn) {
  const driver = await getDriver();
  return driver.transaction((client) => fn(api((sql, params) => client.query(sql, params))));
}

export async function closeDb() {
  if (!driverPromise) return;
  const driver = await driverPromise;
  driverPromise = null;
  await driver.close();
}

// ---------- Settings (cached briefly; they change rarely) ----------
// On Vercel several copies of the site run at once and only the one that saved a change clears its
// cache, so keep this short: an owner's edit shows up everywhere within a few seconds.
export const CACHE_TTL_MS = 5_000;
const SETTING_DEFAULTS = { store_email: '' };
let settingsCache = { at: 0, values: null };

export async function getSetting(key) {
  if (!settingsCache.values || Date.now() - settingsCache.at > CACHE_TTL_MS) {
    const rows = await all('SELECT key, value FROM settings');
    settingsCache = { at: Date.now(), values: Object.fromEntries(rows.map((r) => [r.key, r.value])) };
  }
  return settingsCache.values[key] ?? SETTING_DEFAULTS[key];
}

export async function setSetting(key, value) {
  await run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value', [key, String(value)]);
  settingsCache.values = null;
}

// ---------- Schema + starting data ----------
/**
 * Create the tables (IF NOT EXISTS) and insert the starting neighborhood list once.
 * Runs automatically for the local database; for Supabase run `npm run db:setup`.
 */
export async function setupDatabase(driver) {
  const d = driver ?? (await getDriver());
  await d.exec(fs.readFileSync(path.join(ROOT, 'src', 'schema.sql'), 'utf8'));
  for (const [key, value] of Object.entries(SETTING_DEFAULTS)) {
    await d.query('INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING', [key, value]);
  }
  const seeded = await d.query("SELECT 1 FROM settings WHERE key = 'zones_seeded'");
  if (!seeded.rows.length) {
    const zones = JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'default-zones.json'), 'utf8'));
    await d.transaction(async (t) => {
      for (const [i, z] of zones.entries()) {
        await t.query('INSERT INTO zones (city_ar, city_en, name_ar, name_en, fee, sort_order) VALUES ($1, $2, $3, $4, $5, $6)',
          [z.city_ar, z.city_en, z.name_ar, z.name_en, z.fee == null ? null : z.fee * 100, i]);
      }
      await t.query("INSERT INTO settings (key, value) VALUES ('zones_seeded', '1')");
    });
  }
  // Two starting offers, switched off until the owner turns them on: free delivery over 1,000 EGP,
  // and buy 3, get the 4th free.
  const offersSeeded = await d.query("SELECT 1 FROM settings WHERE key = 'offers_seeded'");
  if (!offersSeeded.rows.length) {
    await d.transaction(async (t) => {
      await t.query("INSERT INTO offers (type, min_subtotal, is_active) VALUES ('free_delivery', 100000, 0)");
      await t.query("INSERT INTO offers (type, buy_qty, get_qty, is_active) VALUES ('buy_get', 3, 1, 0)");
      await t.query("INSERT INTO settings (key, value) VALUES ('offers_seeded', '1')");
    });
  }
}
