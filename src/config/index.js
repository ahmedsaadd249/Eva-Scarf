import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Cloudflare Workers: settings come from wrangler.jsonc (vars) and `wrangler secret`, and there is no
// project folder on disk (worker/register.js supplies the files the app reads).
const onCloudflare = globalThis.navigator?.userAgent === 'Cloudflare-Workers';

function projectRoot() {
  try {
    return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..'); // src/config → project root
  } catch {
    return '/'; // bundled Worker: no file location (nothing is read from disk there)
  }
}
export const ROOT = projectRoot();

const envPath = path.join(ROOT, '.env');
if (!onCloudflare && fs.existsSync(envPath)) process.loadEnvFile(envPath);

const env = process.env;
const port = Number(env.PORT || 3000);
const isProd = env.NODE_ENV === 'production';
const folder = (dir, fallback) => (env[dir] ? path.resolve(ROOT, env[dir]) : path.join(ROOT, fallback));

// On Cloudflare there is no disk, so the local database and uploads folder can't work: the store
// needs Supabase (the database through the Hyperdrive binding). Say exactly what's missing (shows in
// Cloudflare's logs).
if (onCloudflare) {
  const missing = ['SESSION_SECRET', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'].filter((k) => !env[k]);
  if (missing.length) {
    throw new Error(`Missing settings on Cloudflare: ${missing.join(', ')}. `
      + 'Add secrets with `npx wrangler secret put NAME` and plain settings under "vars" in wrangler.jsonc, then deploy again.');
  }
}
if (isProd && !env.SESSION_SECRET) {
  throw new Error('SESSION_SECRET must be set in production.');
}

export const config = {
  port,
  isProd,
  onCloudflare,
  baseUrl: (env.BASE_URL || `http://localhost:${port}`).replace(/\/$/, ''),
  sessionSecret: env.SESSION_SECRET || 'dev-only-secret-change-me',

  // Database: Supabase/Postgres when DATABASE_URL is set, otherwise the embedded local Postgres.
  databaseUrl: env.DATABASE_URL || '',
  pgliteDir: env.PGLITE_DIR ? (env.PGLITE_DIR.startsWith('memory://') ? env.PGLITE_DIR : path.resolve(ROOT, env.PGLITE_DIR)) : path.join(ROOT, 'data', 'pglite'),
  dbPoolMax: Number(env.DB_POOL_MAX || 5),

  // Product photos: Supabase Storage when configured, otherwise the local uploads folder.
  supabase: {
    url: (env.SUPABASE_URL || '').replace(/\/$/, ''),
    serviceKey: env.SUPABASE_SERVICE_ROLE_KEY || '',
    bucket: env.SUPABASE_BUCKET || 'product-images',
  },
  uploadsDir: folder('UPLOADS_DIR', 'uploads'),
  outboxDir: folder('OUTBOX_DIR', 'outbox'),

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
