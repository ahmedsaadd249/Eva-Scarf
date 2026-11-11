// Security checks against a running copy of the store (no browser needed).
// Usage: npm run test:security
// Runs the app in this process on port 3201 with a throwaway in-memory database, its own outbox and
// a fake owner account, then attacks it the way a curious visitor or a script would: missing CSRF
// tokens, other people's orders, open redirects, script injection, SQL injection, guessing passwords,
// tampering with prices, reaching files outside the site. A second copy runs with production settings
// to check HTTPS-only cookies and HSTS.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SELF = fileURLToPath(import.meta.url);
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'eva-sec-'));
const ADMIN = { email: 'owner@evascarf.test', password: 'Owner#Pass2026' };
const baseEnv = {
  DATABASE_URL: '',
  SUPABASE_URL: '',
  SUPABASE_SERVICE_ROLE_KEY: '',
  SMTP_HOST: '',
  UPLOADS_DIR: path.join(TMP, 'uploads'),
  OUTBOX_DIR: path.join(TMP, 'outbox'),
  ADMIN_EMAIL: ADMIN.email,
  ADMIN_PASSWORD: ADMIN.password,
  NOMINATIM_URL: 'http://127.0.0.1:9', // never reached: every geo request in this test is refused first
};

// ---------------------------------------------------------------- production copy (child process)
if (process.argv[2] === '--prod-server') {
  Object.assign(process.env, baseEnv, {
    NODE_ENV: 'production', SESSION_SECRET: 'security-test-only-secret', PGLITE_DIR: 'memory://sec-prod', PORT: process.argv[3],
  });
  // The same Express app the Cloudflare Worker runs, in production mode. Like worker/index.js, the
  // requests below say https through X-Forwarded-Proto.
  const { app } = await import('../src/app.js');
  app.listen(Number(process.argv[3]), () => console.log('ready'));
} else {
  await main();
}

async function main() {
  const PORT = Number(process.env.SEC_PORT || 3201);
  Object.assign(process.env, baseEnv, {
    NODE_ENV: 'development', PGLITE_DIR: 'memory://sec', PORT: String(PORT), BASE_URL: `http://localhost:${PORT}`,
    AUTH_RATE_LIMIT: '100', OWNER_LOGIN_LIMIT: '30', GEO_RATE_LIMIT: '5',
  });
  const db = await import('../src/lib/db.js');
  const { seedAdmin, seedCatalog } = await import('../src/seed.js');
  const { placeOrder } = await import('../src/services/orders.js');
  const { app } = await import('../src/app.js');
  await seedAdmin();
  await seedCatalog();
  const server = app.listen(PORT);
  const BASE = `http://localhost:${PORT}`;

  let passed = 0;
  let failed = 0;
  const section = (name) => console.log(`\n${name}`);
  async function check(name, fn) {
    try {
      await fn();
      passed++;
      console.log(`  ✓ ${name}`);
    } catch (err) {
      failed++;
      console.log(`  ✗ ${name}\n      ${err.message.split('\n')[0]}`);
      process.exitCode = 1;
    }
  }

  /** A visitor with its own cookies. */
  class Visitor {
    constructor() { this.cookies = new Map(); }
    get sid() { return this.cookies.get('eva.sid'); }
    async request(url, { method = 'GET', form, headers = {}, body } = {}) {
      const h = { ...headers };
      if (this.cookies.size) h.Cookie = [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
      if (form) {
        h['Content-Type'] = 'application/x-www-form-urlencoded';
        body = new URLSearchParams(form).toString();
      }
      const res = await fetch(BASE + url, { method, headers: h, body, redirect: 'manual' });
      for (const c of res.headers.getSetCookie()) {
        const [pair] = c.split(';');
        const i = pair.indexOf('=');
        this.cookies.set(pair.slice(0, i), pair.slice(i + 1));
      }
      res.text_ = await res.text();
      return res;
    }
    /** The session's CSRF token (the same on every page). */
    async csrf(url = '/cart') {
      const res = await this.request(url);
      return /name="csrf-token" content="([^"]+)"/.exec(res.text_)?.[1];
    }
    async post(url, form) {
      return this.request(url, { method: 'POST', form: { _csrf: await this.csrf(), ...form } });
    }
    /** Ask for a sign-in code for `email` (customers have no password). */
    async sendCode(email) {
      return this.post('/account/code/send', { email, back: '/account/login' });
    }
    async verifyCode(code, extra = {}) {
      return this.post('/account/code/verify', { code, back: '/account/login', ...extra });
    }
    /** Sign in like a customer: ask for a code, read it from the email, type it. */
    async codeLogin(email, extra = {}) {
      const since = Date.now();
      await this.sendCode(email);
      return this.verifyCode(await latestCode(email, since), extra);
    }
    async ownerLogin(email, password, extra = {}) {
      return this.post('/admin/login', { email, password, ...extra });
    }
  }
  /** The newest sign-in code emailed to `email` since `since`, read from the test outbox. */
  const latestCode = async (email, since = 0, type = 'login-code') => {
    for (let i = 0; i < 50; i++) {
      const dir = baseEnv.OUTBOX_DIR;
      const file = (fs.existsSync(dir) ? fs.readdirSync(dir) : [])
        .filter((f) => f.endsWith(`-${type}-${email}.html`) && fs.statSync(path.join(dir, f)).mtimeMs >= since - 1000)
        .sort().pop();
      if (file) return /letter-spacing:10px[^>]*>(\d{6})</.exec(fs.readFileSync(path.join(dir, file), 'utf8'))[1];
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error(`no code emailed to ${email}`);
  };
  const codeEmails = (email, type = 'login-code') => (fs.existsSync(baseEnv.OUTBOX_DIR) ? fs.readdirSync(baseEnv.OUTBOX_DIR) : [])
    .filter((f) => f.endsWith(`-${type}-${email}.html`)).length;
  const register = async (v, email, name = 'Test Customer') => {
    const res = await v.codeLogin(email);
    assert.equal(res.status, 302, `sign-in of ${email} failed (${res.status})`);
    await db.run('UPDATE users SET full_name = ? WHERE email = ?', [name, email]);
    return db.get('SELECT * FROM users WHERE email = ?', [email]);
  };
  /** The cart stored in a visitor's session (the cookie is "s:<id>.<signature>"). */
  const sessionCart = async (v) => {
    const sid = decodeURIComponent(v.sid).slice(2).split('.')[0];
    const { sess } = await db.get('SELECT sess FROM sessions WHERE sid = ?', [sid]);
    return (typeof sess === 'string' ? JSON.parse(sess) : sess).cart || {};
  };
  const isLoginRedirect = (res) => res.status === 302 && /^\/(account|admin)\/login/.test(res.headers.get('location'));
  const waitForEmail = async (type, to) => {
    for (let i = 0; i < 50; i++) {
      const dir = baseEnv.OUTBOX_DIR;
      const file = fs.existsSync(dir) && fs.readdirSync(dir).find((f) => f.includes(`-${type}-${to}`) && f.endsWith('.html'));
      if (file) return fs.readFileSync(path.join(dir, file), 'utf8');
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error(`no ${type} email`);
  };

  const zone = await db.get("SELECT * FROM zones WHERE name_en = 'Mohandessin'");
  const product = await db.get("SELECT * FROM products WHERE slug = 'karkadeh'");
  const alice = new Visitor();
  const bob = new Visitor();
  const aliceUser = await register(alice, 'alice@example.com', 'Alice');
  const bobUser = await register(bob, 'bob@example.com', 'Bob');
  await db.run(`UPDATE users SET zone_id = ?, city = ?, village = ?, street = 'S', building_no = '1', apartment_no = '2',
                phone_primary = '0912345678', phone_secondary = '01012345678' WHERE id IN (?, ?)`,
  [zone.id, zone.city_ar, zone.name_ar, aliceUser.id, bobUser.id]);
  const aliceOrder = await placeOrder({ cart: { [product.id]: 1 }, user: await db.get('SELECT * FROM users WHERE id = ?', [aliceUser.id]), lang: 'ar', expectedTotal: null });

  try {
    // ------------------------------------------------------------ headers
    section('1. Security headers and cookies');
    const home = await new Visitor().request('/account/login');
    await check('Content-Security-Policy blocks framing, plugins and foreign scripts', () => {
      const csp = home.headers.get('content-security-policy');
      assert.ok(csp, 'no CSP header');
      for (const part of ["default-src 'self'", "frame-ancestors 'none'", "object-src 'none'", "form-action 'self'"]) assert.ok(csp.includes(part), `CSP missing ${part}`);
      const scripts = /script-src ([^;]+)/.exec(csp)[1];
      assert.ok(!scripts.includes("'unsafe-inline'") && !scripts.includes("'unsafe-eval'"), 'inline/eval scripts allowed');
      assert.ok(!/https:\/\/unpkg\.com(\s|$)/.test(scripts), 'all of unpkg.com allowed');
    });
    await check('nosniff, no-referrer, clickjacking protection, no X-Powered-By', () => {
      assert.equal(home.headers.get('x-content-type-options'), 'nosniff');
      assert.equal(home.headers.get('referrer-policy'), 'no-referrer');
      assert.equal(home.headers.get('x-frame-options'), 'SAMEORIGIN');
      assert.equal(home.headers.get('x-powered-by'), null);
    });
    await check('browser features locked (only location, for the map), robots.txt, sitemap, privacy policy', async () => {
      assert.equal(home.headers.get('permissions-policy'), 'camera=(), microphone=(), geolocation=(self), payment=(), usb=()');
      const robots = await new Visitor().request('/robots.txt');
      assert.equal(robots.status, 200);
      assert.match(robots.headers.get('content-type'), /text\/plain/);
      for (const p of ['/admin', '/account', '/checkout', '/api/']) assert.ok(robots.text_.includes(`Disallow: ${p}`), `robots.txt keeps search engines out of ${p}`);
      assert.match(robots.text_, /Sitemap: http:\/\/localhost:\d+\/sitemap\.xml/);
      const sitemap = await new Visitor().request('/sitemap.xml');
      assert.equal(sitemap.status, 200);
      assert.match(sitemap.text_, /<loc>http:\/\/localhost:\d+\/shop<\/loc>/);
      assert.match(sitemap.text_, /<loc>http:\/\/localhost:\d+\/product\/karkadeh<\/loc>/);
      assert.ok(!/\/admin|\/account/.test(sitemap.text_), 'no private pages in the sitemap');
      assert.equal((await new Visitor().request('/privacy-policy')).status, 200);
      for (const old of ['/privacy', '/privacy-policy.html']) {
        const r = await new Visitor().request(old);
        assert.deepEqual([r.status, r.headers.get('location')], [301, '/privacy-policy'], old);
      }
      assert.ok(home.text_.includes('href="/privacy-policy"'), 'linked from every page (footer)');
    });
    await check('private pages tell search engines never to list them (X-Robots-Tag: noindex)', async () => {
      for (const url of ['/admin/login', '/admin', '/account/login', '/cart', '/checkout']) {
        const res = await new Visitor().request(url);
        assert.match(res.headers.get('x-robots-tag') || '', /noindex/, url);
      }
      assert.equal((await new Visitor().request('/')).headers.get('x-robots-tag'), null, 'the shop itself stays findable');
    });
    await check('session cookie is HttpOnly and SameSite=Lax', () => {
      const cookie = home.headers.getSetCookie().find((c) => c.startsWith('eva.sid='));
      assert.ok(cookie, 'no session cookie');
      assert.match(cookie, /HttpOnly/i);
      assert.match(cookie, /SameSite=Lax/i);
    });
    await check('production (as on Cloudflare): Secure cookie, HSTS, upgrade-insecure-requests, safe 302 redirects', async () => {
      const port = PORT + 1;
      const child = spawn(process.execPath, [SELF, '--prod-server', String(port)], { stdio: ['ignore', 'pipe', 'pipe'] });
      try {
        await new Promise((resolve, reject) => {
          child.stdout.on('data', (d) => String(d).includes('ready') && resolve());
          child.on('exit', (code) => reject(new Error(`production copy exited (${code})`)));
          setTimeout(() => reject(new Error('production copy did not start')), 30000);
        });
        const res = await fetch(`http://localhost:${port}/account/login`, { headers: { 'X-Forwarded-Proto': 'https' }, redirect: 'manual' });
        assert.match(res.headers.get('strict-transport-security') || '', /max-age=\d+/);
        assert.match(res.headers.get('content-security-policy'), /upgrade-insecure-requests/);
        assert.match(res.headers.getSetCookie().find((c) => c.startsWith('eva.sid=')) || '', /;\s*Secure/i);
        // Redirects must be 302 (a 307 makes browsers re-send forms)
        // and must never carry raw control characters (browsers drop them: "/\t/x" → "//x").
        for (const next of ['/shop', '/\t/evil.example', '/\n/evil.example']) {
          const r = await fetch(`http://localhost:${port}/lang/ar?next=${encodeURIComponent(next)}`, { headers: { 'X-Forwarded-Proto': 'https' }, redirect: 'manual' });
          const location = r.headers.get('location') || '';
          assert.equal(r.status, 302, `redirect status for next=${JSON.stringify(next)}`);
          assert.ok(!/[\x00-\x20]/.test(location) && new URL(location, 'https://evascarf.test').origin === 'https://evascarf.test', `unsafe Location ${JSON.stringify(location)}`);
        }
      } finally {
        child.kill();
      }
    });

    // ------------------------------------------------------------ CSRF
    section('2. Forged form posts (CSRF)');
    await check('posting without a token is refused (403)', async () => {
      for (const url of ['/cart/add', '/account/profile', '/checkout', '/account/logout']) {
        const res = await alice.request(url, { method: 'POST', form: { product_id: product.id } });
        assert.equal(res.status, 403, url);
      }
    });
    await check('a wrong token, or one with non-Latin letters, is refused (403, not a crash)', async () => {
      const token = await alice.csrf('/cart');
      for (const bad of ['x'.repeat(token.length), 'ب'.repeat(token.length), token.slice(0, -1)]) {
        const res = await alice.request('/cart/add', { method: 'POST', form: { _csrf: bad, product_id: product.id } });
        assert.equal(res.status, 403);
      }
    });
    await check("one visitor's token doesn't work for another visitor", async () => {
      const bobToken = await bob.csrf('/cart');
      const res = await alice.request('/cart/add', { method: 'POST', form: { _csrf: bobToken, product_id: product.id } });
      assert.equal(res.status, 403);
    });
    await check('owner file uploads also need the token', async () => {
      const owner = new Visitor();
      await owner.ownerLogin(ADMIN.email, ADMIN.password);
      const form = new FormData();
      form.set('price', '100');
      form.set('stock', '1');
      const res = await owner.request('/admin/products', { method: 'POST', body: form });
      assert.equal(res.status, 403);
    });

    // ------------------------------------------------------------ access control
    section('3. Who can see what');
    await check('guests are sent to sign in for account and owner pages', async () => {
      const guest = new Visitor();
      for (const url of ['/account/profile', '/account/orders', `/account/orders/${aliceOrder.order_no}`, '/admin', '/admin/orders', `/admin/orders/${aliceOrder.id}`, '/admin/products',
        '/account/a-page-added-later']) { // any /account page is private unless listed as public
        assert.ok(isLoginRedirect(await guest.request(url)), url);
      }
    });
    await check("a guest can't place an order without confirming an email first", async () => {
      const guest = new Visitor();
      const token = await guest.csrf('/cart');
      await guest.request('/cart/add', { method: 'POST', form: { _csrf: token, product_id: product.id } });
      const before = (await db.get('SELECT COUNT(*)::int AS n FROM orders')).n;
      const res = await guest.post('/checkout', {
        full_name: 'Guest', zone_id: zone.id, street: 'S', building_no: '1', apartment_no: '2', phone_primary: '0912345678', phone_secondary: '01012345678',
      });
      assert.equal(res.headers.get('location'), '/checkout');
      assert.equal((await db.get('SELECT COUNT(*)::int AS n FROM orders')).n, before);
      assert.ok((await guest.request('/checkout')).text_.includes('/account/code/send'), 'checkout asks for the email');
    });
    await check("a customer can't open the owner dashboard (403)", async () => {
      for (const url of ['/admin', '/admin/orders', `/admin/orders/${aliceOrder.id}`, '/admin/products', '/admin/settings', '/admin/delivery', '/admin/offers', '/admin/offers/new']) {
        assert.equal((await bob.request(url)).status, 403, url);
      }
      const token = await bob.csrf('/cart');
      const res = await bob.request(`/admin/orders/${aliceOrder.id}/status`, { method: 'POST', form: { _csrf: token, status: 'delivered' } });
      assert.equal(res.status, 403);
      assert.equal((await db.get('SELECT status FROM orders WHERE id = ?', [aliceOrder.id])).status, 'processing');
    });
    await check("a customer can't see someone else's order (404)", async () => {
      assert.equal((await alice.request(`/account/orders/${aliceOrder.order_no}`)).status, 200);
      const res = await bob.request(`/account/orders/${aliceOrder.order_no}`);
      assert.equal(res.status, 404);
      assert.ok(!res.text_.includes('Alice'));
    });
    await check("a customer can't make themselves owner through the profile form", async () => {
      await bob.post('/account/profile', {
        full_name: 'Bob', zone_id: zone.id, street: 'S', building_no: '1', apartment_no: '2',
        phone_primary: '0912345678', phone_secondary: '01012345678', role: 'admin', id: aliceUser.id, email: 'alice@example.com',
      });
      const after = await db.get('SELECT role, email FROM users WHERE id = ?', [bobUser.id]);
      assert.deepEqual(after, { role: 'customer', email: 'bob@example.com' });
    });
    await check('rating links only work with the real token, and only after delivery', async () => {
      const guest = new Visitor();
      assert.equal((await guest.request('/rate/' + 'A'.repeat(32))).status, 404);
      assert.equal((await guest.request('/rate/../../etc/passwd')).status, 404);
      const token = 'T'.repeat(32);
      await db.run('UPDATE orders SET rating_token = ? WHERE id = ?', [token, aliceOrder.id]); // still "processing"
      assert.equal((await guest.request(`/rate/${token}`)).status, 404);
    });
    await check('address lookup: guests get 401, too many lookups get 429', async () => {
      assert.equal((await new Visitor().request('/api/geo/search?q=Dokki')).status, 401);
      const statuses = [];
      for (let i = 0; i < 7; i++) statuses.push((await alice.request('/api/geo/reverse?lat=999&lng=0')).status);
      assert.equal(statuses[0], 400);
      assert.ok(statuses.includes(429), `statuses ${statuses.join(',')}`);
    });

    // ------------------------------------------------------------ sessions & codes
    section('4. Sign-in codes, sessions and the owner password');
    await check('the session id changes at sign-in (no session fixation)', async () => {
      const v = new Visitor();
      await v.csrf();
      const before = v.sid;
      await v.codeLogin('alice@example.com');
      assert.ok(before && v.sid && v.sid !== before);
      assert.equal((await v.request('/account/profile')).status, 200);
    });
    await check('after logout the old session cookie is useless', async () => {
      const v = new Visitor();
      await v.codeLogin('alice@example.com');
      const old = v.sid;
      await v.post('/account/logout', {});
      const replay = new Visitor();
      replay.cookies.set('eva.sid', old);
      assert.ok(isLoginRedirect(await replay.request('/account/profile')));
    });
    await check('codes are stored only as hashes (the database never has the code)', async () => {
      const since = Date.now();
      await new Visitor().sendCode('hash@example.com');
      const code = await latestCode('hash@example.com', since);
      const rows = await db.all('SELECT * FROM login_codes WHERE email = ?', ['hash@example.com']);
      assert.equal(rows.length, 1);
      assert.ok(!JSON.stringify(rows).includes(code), 'raw code stored');
      assert.match(rows[0].code_hash, /^[0-9a-f]{64}$/);
    });
    await check('a wrong code is refused, and after 5 wrong tries even the right code stops working', async () => {
      const v = new Visitor();
      const since = Date.now();
      await v.sendCode('tries@example.com');
      const code = await latestCode('tries@example.com', since);
      const wrong = code === '000000' ? '111111' : '000000';
      for (let i = 0; i < 5; i++) await v.verifyCode(wrong);
      await v.verifyCode(code);
      assert.equal(await db.get('SELECT 1 FROM users WHERE email = ?', ['tries@example.com']), null, 'signed in after 5 wrong codes');
      assert.ok(isLoginRedirect(await v.request('/account/profile')));
    });
    await check('a code works once, and only until it expires (10 minutes)', async () => {
      const v = new Visitor();
      const since = Date.now();
      await v.sendCode('once@example.com');
      const code = await latestCode('once@example.com', since);
      assert.equal((await v.verifyCode(code)).status, 302);
      await v.post('/account/logout', {});
      const again = new Visitor();
      await again.sendCode('once@example.com'); // within the minute: no new code is sent…
      await again.verifyCode(code); // …and the old one is used up
      assert.ok(isLoginRedirect(await again.request('/account/profile')), 'a used code worked again');
      const late = new Visitor();
      const since2 = Date.now();
      await late.sendCode('late@example.com');
      const lateCode = await latestCode('late@example.com', since2);
      await db.run("UPDATE login_codes SET expires_at = ? WHERE email = 'late@example.com'", [Date.now() - 1]);
      await late.verifyCode(lateCode);
      assert.equal(await db.get("SELECT 1 FROM users WHERE email = 'late@example.com'"), null, 'expired code worked');
    });
    await check('a code only signs in the email it was sent to', async () => {
      const v = new Visitor();
      const since = Date.now();
      await v.sendCode('carol@example.com');
      const carolCode = await latestCode('carol@example.com', since);
      await v.sendCode('bob@example.com'); // the session now waits for bob's code
      await v.verifyCode(carolCode, { email: 'carol@example.com' }); // an email in the form is ignored
      assert.ok(isLoginRedirect(await v.request('/account/profile')), "carol's code signed in as bob");
    });
    await check("asking again and again can't flood an inbox (one code a minute per email)", async () => {
      const before = codeEmails('flood@example.com');
      for (let i = 0; i < 4; i++) await new Visitor().sendCode('flood@example.com');
      await new Promise((r) => setTimeout(r, 500));
      assert.equal(codeEmails('flood@example.com') - before, 1);
    });
    await check('new and known emails get the same answer (no account discovery)', async () => {
      const page = async (email) => {
        const v = new Visitor();
        await v.sendCode(email);
        return (await v.request('/account/login')).text_.split(email).join('EMAIL').replace(/content="[^"]+"|value="[^"]+"/g, '');
      };
      await db.run("INSERT INTO users (email, full_name) VALUES ('dave@example.com', 'Dave')"); // a customer who has ordered before
      assert.equal(await page('dave@example.com'), await page('brand-new@example.com'));
    });
    await check("the owner's email gets the usual answer but never a code (the form doesn't reveal it)", async () => {
      const v = new Visitor();
      const before = codeEmails(ADMIN.email);
      await v.sendCode(ADMIN.email);
      const ownerPage = (await v.request('/account/login')).text_.split(ADMIN.email).join('EMAIL').replace(/content="[^"]+"|value="[^"]+"/g, '');
      const other = new Visitor();
      await other.sendCode('someone-new@example.com');
      const otherPage = (await other.request('/account/login')).text_.split('someone-new@example.com').join('EMAIL').replace(/content="[^"]+"|value="[^"]+"/g, '');
      assert.equal(ownerPage, otherPage, 'different answer for the owner email');
      await new Promise((r) => setTimeout(r, 300));
      assert.equal(codeEmails(ADMIN.email), before, 'a code was emailed to the owner');
      assert.equal(await db.get('SELECT 1 FROM login_codes WHERE email = ?', [ADMIN.email]), null);
      assert.ok(isLoginRedirect(await v.request('/admin')));
    });
    /** Sign in as the owner when two-step sign-in is on: the password, then the code from the owner's inbox. */
    const ownerWithCode = async (v) => {
      const before = codeEmails('owner-inbox@example.com', 'owner-code');
      await v.ownerLogin(ADMIN.email, ADMIN.password);
      for (let i = 0; i < 50 && codeEmails('owner-inbox@example.com', 'owner-code') === before; i++) await new Promise((r) => setTimeout(r, 100));
      return v.post('/admin/login/code', { code: await latestCode('owner-inbox@example.com', 0, 'owner-code') });
    };
    await check('with two-step sign-in on, the right password alone opens nothing', async () => {
      await db.run("UPDATE users SET otp_email = 'owner-inbox@example.com' WHERE role = 'admin'");
      try {
        const v = new Visitor();
        const since = Date.now();
        const res = await v.ownerLogin(ADMIN.email, ADMIN.password);
        assert.equal(res.headers.get('location'), '/admin/login/code');
        assert.ok(isLoginRedirect(await v.request('/admin')), 'the dashboard opened with the password alone');
        const code = await latestCode('owner-inbox@example.com', since, 'owner-code');
        const stranger = new Visitor(); // the right code, typed in a browser that didn't give the password
        assert.equal((await stranger.request('/admin/login/code')).headers.get('location'), '/admin/login');
        await stranger.post('/admin/login/code', { code });
        assert.ok(isLoginRedirect(await stranger.request('/admin')), 'the code alone opened the dashboard');
        await v.post('/admin/login/code', { code: code === '000000' ? '111111' : '000000' });
        assert.ok(isLoginRedirect(await v.request('/admin')), 'a wrong code opened the dashboard');
        assert.equal((await v.post('/admin/login/code', { code })).headers.get('location'), '/admin');
        assert.equal((await v.request('/admin')).status, 200, 'password + code should open it');
      } finally {
        await db.run("UPDATE users SET otp_email = NULL WHERE role = 'admin'");
      }
    });
    await check('switching two-step sign-in off, or sending its codes elsewhere, needs the current password', async () => {
      await db.run("UPDATE users SET otp_email = 'owner-inbox@example.com' WHERE role = 'admin'");
      try {
        const owner = new Visitor();
        assert.equal((await ownerWithCode(owner)).headers.get('location'), '/admin');
        const otpEmail = async () => (await db.get("SELECT otp_email FROM users WHERE role = 'admin'")).otp_email;
        await owner.post('/admin/settings/otp/off', { off_password: 'Wrong#Pass123' });
        assert.equal(await otpEmail(), 'owner-inbox@example.com', 'switched off without the password');
        await owner.post('/admin/settings/otp', { otp_email: 'attacker@example.com', otp_password: 'Wrong#Pass123' });
        await new Promise((r) => setTimeout(r, 300));
        assert.equal(codeEmails('attacker@example.com', 'owner-setup'), 0, 'a confirmation code went to a new inbox without the password');
        await owner.post('/admin/settings/otp/off', { off_password: ADMIN.password });
        assert.equal(await otpEmail(), null);
      } finally {
        await db.run("UPDATE users SET otp_email = NULL WHERE role = 'admin'");
      }
    });
    await check('owner sign-in: a wrong password and an unknown email get the same answer', async () => {
      const a = await new Visitor().ownerLogin(ADMIN.email, 'Wrong#Pass123');
      const b = await new Visitor().ownerLogin('nobody@example.com', 'Wrong#Pass123');
      const c = await new Visitor().ownerLogin('bob@example.com', 'Wrong#Pass123'); // a customer can't use the owner page
      assert.equal(a.status, 422);
      assert.equal(b.status, a.status);
      assert.equal(c.status, a.status);
      const msg = (r) => /role="alert"[^>]*>([\s\S]*?)<\/p>/.exec(r.text_)?.[1].replace(/<[^>]+>/g, '').trim();
      assert.equal(msg(a), msg(b));
    });
    await check("customers have no password; the owner's is a salted scrypt hash", async () => {
      const rows = await db.all('SELECT role, password_hash FROM users');
      assert.ok(rows.filter((r) => r.role === 'customer').every((r) => r.password_hash === null), 'a customer has a password');
      const owner = rows.find((r) => r.role === 'admin');
      assert.match(owner.password_hash, /^scrypt\$\d+\$\d+\$\d+\$[A-Za-z0-9+/=]{20,}\$[A-Za-z0-9+/=]{80,}$/);
    });
    await check('the old password pages are gone (they lead to the sign-in page)', async () => {
      for (const url of ['/account/register', '/account/forgot', '/account/reset/abcdefghijklmnopqrstuvwxyz']) {
        const res = await new Visitor().request(url);
        assert.equal(res.status, 301, url);
        assert.equal(res.headers.get('location'), '/account/login');
      }
    });

    // ------------------------------------------------------------ injection
    section('5. Injection');
    await check('script in a name is shown as text, not run (stored XSS)', async () => {
      const v = new Visitor();
      const evil = '<script>alert(1)</script><img src=x onerror=alert(2)>';
      await register(v, 'xss@example.com', evil);
      const page = (await v.request('/account/profile')).text_;
      assert.ok(!page.includes('<script>alert(1)') && !page.includes('<img src=x'), 'raw HTML in page');
      assert.ok(page.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
    });
    await check('script in the search box is shown as text (reflected XSS)', async () => {
      const res = await new Visitor().request('/shop?q=' + encodeURIComponent('"><svg onload=alert(1)>'));
      assert.equal(res.status, 200);
      assert.ok(!res.text_.includes('<svg onload=alert(1)>'));
    });
    await check('SQL in the search box and login form does nothing', async () => {
      for (const q of ["' OR 1=1 --", "'; DROP TABLE users; --", '%', '_', '\\']) {
        const res = await new Visitor().request('/shop?q=' + encodeURIComponent(q));
        assert.equal(res.status, 200, q);
      }
      assert.equal((await new Visitor().ownerLogin("' OR '1'='1", "' OR '1'='1")).status, 422);
      await new Visitor().sendCode("' OR '1'='1");
      assert.equal(await db.get("SELECT 1 FROM login_codes WHERE email LIKE '%''%'"), null, 'a code for a non-email');
      assert.ok((await db.get('SELECT COUNT(*)::int AS n FROM users')).n >= 3, 'users table intact');
    });
    await check('odd form values are rejected cleanly (no crashes)', async () => {
      for (const form of [{ product_id: '__proto__' }, { product_id: '1e309', qty: '-5' }, { product_id: 'constructor', qty: 'NaN' }]) {
        const token = await bob.csrf('/cart');
        const res = await bob.request('/cart/add', { method: 'POST', form: { _csrf: token, ...form } });
        assert.ok(res.status < 500, `${JSON.stringify(form)} → ${res.status}`);
      }
      const token = await bob.csrf('/cart');
      await bob.request('/cart/update', { method: 'POST', form: { _csrf: token, product_id: '99999', qty: '5' } });
      const cart = await sessionCart(bob);
      assert.ok(Object.keys(cart).every((id) => Number(id) > 0 && Number(id) < 99999), `cart keys: ${Object.keys(cart)}`);
    });

    // ------------------------------------------------------------ redirects & files
    section('6. Redirects and files');
    await check('"next" links can only stay on this site (no open redirect)', async () => {
      const targets = ['//evil.example', 'https://evil.example', '/\\evil.example', '/\t/evil.example', '/\n/evil.example', '/ /evil.example', 'javascript:alert(1)'];
      for (const next of targets) {
        const lang = await new Visitor().request(`/lang/en?next=${encodeURIComponent(next)}`);
        const where = new URL(lang.headers.get('location'), BASE);
        assert.equal(where.origin, BASE, `lang next=${next}`);
        const login = await new Visitor().ownerLogin(ADMIN.email, ADMIN.password, { next });
        assert.equal(new URL(login.headers.get('location'), BASE).origin, BASE, `owner login next=${next}`);
      }
      for (const [i, next] of targets.slice(0, 2).entries()) {
        const res = await new Visitor().codeLogin(`next${i}@example.com`, { next, back: next });
        assert.equal(new URL(res.headers.get('location'), BASE).origin, BASE, `code sign-in next=${next}`);
      }
    });
    await check('source code, settings and the database are not downloadable', async () => {
      for (const url of ['/.env', '/package.json', '/src/config.js', '/src/config/index.js', '/src/schema.sql', '/uploads/../.env', '/uploads/..%2f..%2f.env', '/css/..%2f..%2f.env', '/data/pglite', '/.git/config']) {
        const res = await new Visitor().request(url);
        assert.ok(res.status === 404 || res.status === 400, `${url} → ${res.status}`);
        assert.ok(!/SESSION_SECRET|DATABASE_URL|\[core\]/.test(res.text_), `${url} leaked`);
      }
    });
    await check('error pages show no code details', async () => {
      const res = await new Visitor().request('/product/' + encodeURIComponent("'\"<>%00"));
      assert.ok(res.status === 404);
      assert.ok(!/at .*\.js:\d+|node_modules|Error:/.test(res.text_));
    });
    await check('owner uploads accept only images', async () => {
      const owner = new Visitor();
      await owner.ownerLogin(ADMIN.email, ADMIN.password);
      const token = await owner.csrf('/admin/products/new');
      const form = new FormData();
      form.set('_csrf', token);
      form.set('price', '100');
      form.set('stock', '1');
      form.set('images', new Blob(['<script>alert(1)</script>'], { type: 'text/html' }), 'evil.html');
      const before = (await db.get('SELECT COUNT(*)::int AS n FROM product_images')).n;
      await owner.request('/admin/products', { method: 'POST', body: form });
      assert.equal((await db.get('SELECT COUNT(*)::int AS n FROM product_images')).n, before, 'HTML file stored');
      // A web page renamed to .png and labelled image/png is refused too: the first bytes are checked.
      const disguised = new FormData();
      disguised.set('_csrf', token);
      disguised.set('price', '100');
      disguised.set('stock', '1');
      disguised.set('images', new Blob(['<html><script>alert(1)</script></html>'], { type: 'image/png' }), 'photo.png');
      await owner.request('/admin/products', { method: 'POST', body: disguised });
      assert.equal((await db.get('SELECT COUNT(*)::int AS n FROM product_images')).n, before, 'disguised HTML stored');
      assert.ok(!fs.existsSync(baseEnv.UPLOADS_DIR) || fs.readdirSync(baseEnv.UPLOADS_DIR).every((f) => /\.(jpe?g|png|webp)$/.test(f)));
    });
    await check('very large form posts are refused (413)', async () => {
      const token = await bob.csrf('/cart');
      const res = await bob.request('/cart/add', { method: 'POST', form: { _csrf: token, product_id: '1', pad: 'x'.repeat(400 * 1024) } });
      assert.equal(res.status, 413);
    });

    // ------------------------------------------------------------ money
    section('7. Prices and stock');
    await check('the order total is computed by the server; a changed total is refused', async () => {
      const token = await bob.csrf('/cart');
      await bob.request('/cart/add', { method: 'POST', form: { _csrf: token, product_id: product.id, qty: '1' } });
      const count = async () => (await db.get('SELECT COUNT(*)::int AS n FROM orders WHERE user_id = ?', [bobUser.id])).n;
      const before = await count();
      const res = await bob.post('/checkout', {
        expected_total: '1', full_name: 'Bob', zone_id: zone.id, street: 'S', building_no: '1', apartment_no: '2', phone_primary: '0912345678', phone_secondary: '01012345678',
      });
      assert.equal(res.headers.get('location'), '/checkout');
      assert.equal(await count(), before, 'order placed with a forged total');
    });
    await check("a customer can't order more than the stock, or a negative amount", async () => {
      await db.run('UPDATE products SET stock = 2 WHERE id = ?', [product.id]);
      for (const qty of ['-3', '500']) {
        const token = await bob.csrf('/cart');
        await bob.request('/cart/update', { method: 'POST', form: { _csrf: token, product_id: product.id, qty } });
      }
      assert.equal((await sessionCart(bob))[product.id], 2, 'quantity should be capped at the stock (2)');
      const total = Number(/data-total="(\d+)"/.exec((await bob.request('/cart')).text_)?.[1] ?? 0);
      assert.ok(total > 0, 'total should be positive');
    });

    // ------------------------------------------------------------ brute force (last: it blocks this IP)
    section('8. Guessing codes and the owner password');
    await check("guessing the owner's password is cut off per account, whatever the address (429)", async () => {
      let blockedAt = 0;
      for (let i = 1; i <= 40 && !blockedAt; i++) {
        const res = await new Visitor().ownerLogin(ADMIN.email, `Guess#${i}aaaa`);
        if (res.status === 429) blockedAt = i;
      }
      assert.ok(blockedAt, 'never blocked');
      const counted = await db.get('SELECT hits FROM rate_limits WHERE key = ?', [`owner-login:${ADMIN.email}`]);
      assert.ok(counted?.hits >= Number(process.env.OWNER_LOGIN_LIMIT), `per-account count ${counted?.hits}`);
      assert.equal((await new Visitor().ownerLogin(ADMIN.email, ADMIN.password)).status, 429, 'even the right password waits');
      console.log(`      (blocked after ${blockedAt} more attempts; ${process.env.OWNER_LOGIN_LIMIT} per hour for one email in this test, 10 by default)`);
    });
    await check('repeated sign-in attempts from one visitor are slowed down (429)', async () => {
      let blockedAt = 0;
      for (let i = 1; i <= 130 && !blockedAt; i++) {
        const res = await new Visitor().ownerLogin(`guess${i}@example.com`, `Guess#${i}aaaa`);
        if (res.status === 429) blockedAt = i;
      }
      assert.ok(blockedAt, 'never blocked');
      // The count lives in the database, so every running copy of the site shares it.
      const counted = await db.get("SELECT MAX(hits)::int AS n FROM rate_limits WHERE key LIKE 'auth:%'");
      assert.ok(counted.n >= Number(process.env.AUTH_RATE_LIMIT), `shared count ${counted.n}`);
      console.log(`      (blocked after ${blockedAt} more attempts; limit ${process.env.AUTH_RATE_LIMIT} per 15 minutes in this test, 20 by default; counted in the database)`);
    });
  } finally {
    console.log(`\n${passed} passed, ${failed} failed`);
    await new Promise((r) => server.close(r));
    await db.closeDb();
    fs.rmSync(TMP, { recursive: true, force: true });
    process.exit(process.exitCode ?? 0);
  }
}
