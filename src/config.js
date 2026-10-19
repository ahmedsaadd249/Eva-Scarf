import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const envPath = path.join(ROOT, '.env');
if (fs.existsSync(envPath)) process.loadEnvFile(envPath);

const env = process.env;
const port = Number(env.PORT || 3000);
const isProd = env.NODE_ENV === 'production';
// On Vercel the project folder is read-only; only the temp folder can be written.
const onVercel = Boolean(env.VERCEL);
const writable = (dir, fallback) => (env[dir] ? path.resolve(ROOT, env[dir]) : onVercel ? path.join(os.tmpdir(), fallback) : path.join(ROOT, fallback));

// On Vercel the disk is read-only and wiped between requests, so the local database and uploads
// folder can't work: the store needs Supabase. Say exactly what's missing (shows in Vercel's logs).
if (onVercel) {
  const missing = ['SESSION_SECRET', 'DATABASE_URL', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'].filter((k) => !env[k]);
  if (missing.length) {
    throw new Error(`Missing environment variables on Vercel: ${missing.join(', ')}. `
      + 'Add them in Vercel → Project → Settings → Environment Variables, then redeploy.');
  }
}
if (isProd && !env.SESSION_SECRET) {
  throw new Error('SESSION_SECRET must be set in production.');
}

export const config = {
  port,
  isProd,
  onVercel,
  baseUrl: (env.BASE_URL || (env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${env.VERCEL_PROJECT_PRODUCTION_URL}` : `http://localhost:${port}`)).replace(/\/$/, ''),
  sessionSecret: env.SESSION_SECRET || 'dev-only-secret-change-me',

  // Database: Supabase/Postgres when DATABASE_URL is set, otherwise the embedded local Postgres.
  databaseUrl: env.DATABASE_URL || '',
  pgliteDir: env.PGLITE_DIR ? (env.PGLITE_DIR.startsWith('memory://') ? env.PGLITE_DIR : path.resolve(ROOT, env.PGLITE_DIR)) : path.join(ROOT, 'data', 'pglite'),
  dbPoolMax: Number(env.DB_POOL_MAX || (onVercel ? 2 : 5)),

  // Product photos: Supabase Storage when configured, otherwise the local uploads folder.
  supabase: {
    url: (env.SUPABASE_URL || '').replace(/\/$/, ''),
    serviceKey: env.SUPABASE_SERVICE_ROLE_KEY || '',
    bucket: env.SUPABASE_BUCKET || 'product-images',
  },
  uploadsDir: writable('UPLOADS_DIR', 'uploads'),
  outboxDir: writable('OUTBOX_DIR', 'outbox'),

  // Map addresses (OpenStreetMap Nominatim, called from the server). Tests point this at a mock.
  nominatimUrl: (env.NOMINATIM_URL || 'https://nominatim.openstreetmap.org').replace(/\/$/, ''),
  geoMinIntervalMs: Number(env.GEO_MIN_INTERVAL_MS || 1000), // Nominatim policy: at most 1 request/second

  smtp: {
    host: env.SMTP_HOST || '',
    port: Number(env.SMTP_PORT || 587),
    user: env.SMTP_USER || '',
    pass: env.SMTP_PASS || '',
  },
  // A bare address ("name@gmail.com") gets the store name added, so emails arrive from "Eva Scarf".
  mailFrom: ((from) => (from.includes('<') ? from : `Eva Scarf <${from}>`))((env.MAIL_FROM || 'no-reply@evascarf.local').trim()),
  social: {
    instagram: env.INSTAGRAM_URL || 'https://www.instagram.com/evasc_arf',
    tiktok: env.TIKTOK_URL || 'https://www.tiktok.com/@evascarf2',
  },
  admin: {
    email: env.ADMIN_EMAIL || '',
    password: env.ADMIN_PASSWORD || '',
    name: env.ADMIN_NAME || 'Eva Scarf',
  },
};
