import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

// Loads the settings module the way the Cloudflare Worker sees it (Cloudflare's user agent, and no .env
// file is read there), in a separate process so this test's own settings don't leak in.
const CONFIG = new URL('../src/config/index.js', import.meta.url).href;
const LIVE_SETTINGS = {
  SESSION_SECRET: 'test-secret', SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'test-key',
  BASE_URL: 'https://shop.example', MAIL_FROM: 'Eva Scarf <shop@example.com>', BREVO_API_KEY: 'test-key',
};

function loadOnCloudflare(env) {
  const code = `Object.defineProperty(globalThis, 'navigator', { value: { userAgent: 'Cloudflare-Workers' }, configurable: true });
    const { config } = await import(${JSON.stringify(CONFIG)});
    console.log(JSON.stringify({ isProd: config.isProd, onCloudflare: config.onCloudflare }));`;
  const base = { PATH: process.env.PATH, SYSTEMROOT: process.env.SYSTEMROOT ?? '' };
  const run = spawnSync(process.execPath, ['--input-type=module', '-e', code], { env: { ...base, ...env }, encoding: 'utf8' });
  return { ok: run.status === 0, out: run.stdout.trim(), err: run.stderr };
}

test('on Cloudflare the store runs in production mode even without NODE_ENV', () => {
  const run = loadOnCloudflare(LIVE_SETTINGS); // no NODE_ENV at all
  assert.ok(run.ok, run.err);
  assert.deepEqual(JSON.parse(run.out), { isProd: true, onCloudflare: true });
});

test('on Cloudflare it refuses to start without its address or a way to send email, and names them', () => {
  const { BASE_URL, BREVO_API_KEY, ...rest } = LIVE_SETTINGS;
  const run = loadOnCloudflare(rest);
  assert.equal(run.ok, false);
  assert.match(run.err, /Missing settings on Cloudflare: BASE_URL, BREVO_API_KEY/);
});

test('on Cloudflare SMTP settings alone still let it start (with a warning to add the API key)', () => {
  const { BREVO_API_KEY, ...rest } = LIVE_SETTINGS;
  const run = loadOnCloudflare({ ...rest, SMTP_HOST: 'smtp.example', SMTP_USER: 'u', SMTP_PASS: 'p' });
  assert.ok(run.ok, run.err);
});
