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
// On Cloudflare this is always the live store, whatever NODE_ENV says: Secure cookies, HSTS, and
// trusting the visitor address the Worker passes on (rate limits depend on it).
const isProd = env.NODE_ENV === 'production' || onCloudflare;
const folder = (dir, fallback) => (env[dir] ? path.resolve(ROOT, env[dir]) : path.join(ROOT, fallback));

/** What Cloudflare is missing to run the store. There is no disk there, so the database and photos must be Supabase. */
function missingOnCloudflare() {
  const missing = ['SESSION_SECRET', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'BASE_URL', 'MAIL_FROM'].filter((k) => !env[k]);
  // Customers sign in with emailed codes, so the store can't work without a way to send email.
  const canSendEmail = env.BREVO_API_KEY || (env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASS);
  if (!canSendEmail) missing.push('BREVO_API_KEY');
  return missing;
}

// Say exactly what's missing (shows in Cloudflare's logs) instead of running half-configured.
if (onCloudflare) {
  const missing = missingOnCloudflare();
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
  // Supabase's root certificate (Dashboard → Project Settings → Database → SSL Configuration), so local
  // scripts can check they really reach Supabase. Production goes through Hyperdrive instead.
  databaseCaFile: env.DATABASE_CA_FILE ? path.resolve(ROOT, env.DATABASE_CA_FILE) : '',
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

  // Email through Brevo: its HTTP API when BREVO_API_KEY is set (what Cloudflare must use: SMTP
  // connections from a Worker get closed), otherwise SMTP, otherwise the local outbox folder.
  brevoApiKey: env.BREVO_API_KEY || '',
  smtp: {
    host: env.SMTP_HOST || '',
    port: Number(env.SMTP_PORT || 587),
    user: env.SMTP_USER || '',
    pass: env.SMTP_PASS || '',
  },
  // A bare address ("name@gmail.com") gets the store name added, so emails arrive from "Eva Scarf".
  mailFrom: ((from) => (from.includes('<') ? from : `Eva Scarf <${from}>`))((env.MAIL_FROM || 'no-reply@evascarf.local').trim()),
  // Rate limits (tests lower or raise them). Counted in the database: see middlewares/rate-limit.js.
  rateLimits: {
    auth: Number(env.AUTH_RATE_LIMIT || 20), // sign-in tries per visitor per 15 minutes
    ownerLogin: Number(env.OWNER_LOGIN_LIMIT || 10), // owner password tries per email per hour
    geo: Number(env.GEO_RATE_LIMIT || 30), // address lookups per visitor per minute
    codeSends: Number(env.CODE_SEND_LIMIT || 10), // sign-in code emails per visitor per hour
    // Customer sign-in code emails per day for the whole store, so a script can't use up the day's
    // email allowance (Brevo's free plan: 300 a day) and leave none for orders and status updates.
    codeEmailsPerDay: Number(env.CODE_EMAILS_PER_DAY || 200),
  },
  storeTimezone: env.STORE_TIMEZONE || 'Africa/Cairo',

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
