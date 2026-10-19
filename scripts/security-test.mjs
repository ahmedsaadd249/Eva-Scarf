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
  // Serve through the Vercel entry point, with Vercel's own response helpers added the way Vercel
  // does (its res.redirect answers 307 and doesn't encode the address), so the checks see what
  // the live site does.
  const { default: handler } = await import('../api/index.js');
  const http = await import('node:http');
  http.createServer((req, res) => {
    res.redirect = (statusOrUrl, url) => {
      const [status, location] = url === undefined ? [307, statusOrUrl] : [statusOrUrl, url];
      res.writeHead(status, { Location: location }).end();
    };
    handler(req, res);
  }).listen(Number(process.argv[3]), () => console.log('ready'));
} else {
  await main();
}

async function main() {
  const PORT = Number(process.env.SEC_PORT || 3201);
  Object.assign(process.env, baseEnv, {
    NODE_ENV: 'development', PGLITE_DIR: 'memory://sec', PORT: String(PORT), BASE_URL: `http://localhost:${PORT}`,
    AUTH_RATE_LIMIT: '60', GEO_RATE_LIMIT: '5',
  });
  const db = await import('../src/db.js');
  const { seedAdmin, seedCatalog } = await import('../src/seed.js');
  const { placeOrder } = await import('../src/orders.js');
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
    async login(email, password) {
      return this.post('/account/login', { email, password });
    }
  }
  const register = async (v, email, name = 'Test Customer') => {
    const res = await v.post('/account/register', { full_name: name, email, password: 'Tarha#2026x', password_confirm: 'Tarha#2026x' });
    assert.equal(res.status, 302, `registration of ${email} failed (${res.status})`);
    return db.get('SELECT * FROM users WHERE email = ?', [email]);
  };
  /** The cart stored in a visitor's session (the cookie is "s:<id>.<signature>"). */
  const sessionCart = async (v) => {
    const sid = decodeURIComponent(v.sid).slice(2).split('.')[0];
    const { sess } = await db.get('SELECT sess FROM sessions WHERE sid = ?', [sid]);
    return (typeof sess === 'string' ? JSON.parse(sess) : sess).cart || {};
  };
  const isLoginRedirect = (res) => res.status === 302 && res.headers.get('location').startsWith('/account/login');
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
  const aliceOrder = await placeOrder({ session: { cart: { [product.id]: 1 } }, user: await db.get('SELECT * FROM users WHERE id = ?', [aliceUser.id]), lang: 'ar' }, null);

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
    await check('session cookie is HttpOnly and SameSite=Lax', () => {
      const cookie = home.headers.getSetCookie().find((c) => c.startsWith('eva.sid='));
      assert.ok(cookie, 'no session cookie');
      assert.match(cookie, /HttpOnly/i);
      assert.match(cookie, /SameSite=Lax/i);
    });
    await check('production (as on Vercel): Secure cookie, HSTS, upgrade-insecure-requests, safe 302 redirects', async () => {
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
        // Through the Vercel entry point: redirects must be 302 (a 307 makes browsers re-send forms)
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
      await owner.login(ADMIN.email, ADMIN.password);
      const form = new FormData();
      form.set('price', '100');
      form.set('stock', '1');
      const res = await owner.request('/admin/products', { method: 'POST', body: form });
      assert.equal(res.status, 403);
    });

    // ------------------------------------------------------------ access control
    section('3. Who can see what');
    await check('guests are sent to login for account, checkout and owner pages', async () => {
      const guest = new Visitor();
      for (const url of ['/account/profile', '/account/orders', `/account/orders/${aliceOrder.order_no}`, '/checkout', '/admin', '/admin/orders', `/admin/orders/${aliceOrder.id}`, '/admin/products',
        '/account/a-page-added-later']) { // any /account page is private unless listed as public
        assert.ok(isLoginRedirect(await guest.request(url)), url);
      }
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

    // ------------------------------------------------------------ sessions & passwords
    section('4. Logins, sessions and passwords');
    await check('the session id changes at login (no session fixation)', async () => {
      const v = new Visitor();
      await v.csrf();
      const before = v.sid;
      await v.login('alice@example.com', 'Tarha#2026x');
      assert.ok(before && v.sid && v.sid !== before);
    });
    await check('after logout the old session cookie is useless', async () => {
      const v = new Visitor();
      await v.login('alice@example.com', 'Tarha#2026x');
      const old = v.sid;
      await v.post('/account/logout', {});
      const replay = new Visitor();
      replay.cookies.set('eva.sid', old);
      assert.ok(isLoginRedirect(await replay.request('/account/profile')));
    });
    await check("wrong password and unknown email get the same answer (no account discovery)", async () => {
      const a = await new Visitor().login('alice@example.com', 'Wrong#Pass123');
      const b = await new Visitor().login('nobody@example.com', 'Wrong#Pass123');
      assert.equal(a.status, 422);
      assert.equal(b.status, a.status);
      const msg = (r) => /role="alert"[^>]*>([\s\S]*?)<\/p>/.exec(r.text_)?.[1].replace(/<[^>]+>/g, '').trim();
      assert.equal(msg(a), msg(b));
    });
    await check('"forgot password" answers the same for real and unknown emails', async () => {
      const a = await new Visitor().post('/account/forgot', { email: 'alice@example.com' });
      const b = await new Visitor().post('/account/forgot', { email: 'nobody@example.com' });
      assert.equal(a.status, b.status);
      const body = (r) => r.text_.replace(/alice@example\.com|nobody@example\.com/g, 'EMAIL').replace(/content="[^"]+"|value="[^"]+"/g, '');
      assert.equal(body(a), body(b));
    });
    await check('reset emails can\'t be used to flood an inbox (one per account per 10 minutes)', async () => {
      await waitForEmail('password-reset', 'alice@example.com');
      const resetEmails = () => fs.readdirSync(baseEnv.OUTBOX_DIR).filter((f) => f.includes('-password-reset-alice@example.com') && f.endsWith('.html')).length;
      const tokenBefore = (await db.get('SELECT token_hash FROM password_resets WHERE user_id = ?', [aliceUser.id])).token_hash;
      for (let i = 0; i < 3; i++) {
        const again = await new Visitor().post('/account/forgot', { email: 'alice@example.com' });
        assert.equal(again.status, 200, 'same answer as always');
      }
      await new Promise((r) => setTimeout(r, 500));
      assert.equal(resetEmails(), 1, 'only the first request sent an email');
      assert.equal((await db.get('SELECT token_hash FROM password_resets WHERE user_id = ?', [aliceUser.id])).token_hash, tokenBefore, 'the first link still works');
    });
    await check('a reset link works once, and stored tokens are hashed', async () => {
      const html = await waitForEmail('password-reset', 'alice@example.com');
      const token = /\/account\/reset\/([A-Za-z0-9_-]+)/.exec(html)[1];
      assert.equal(await db.get('SELECT 1 FROM password_resets WHERE token_hash = ?', [token]), null, 'raw token stored');
      const v = new Visitor();
      const first = await v.post(`/account/reset/${token}`, { password: 'NewTarha#2026', password_confirm: 'NewTarha#2026' });
      assert.equal(first.status, 302);
      const again = await new Visitor().post(`/account/reset/${token}`, { password: 'Other#Pass2026', password_confirm: 'Other#Pass2026' });
      assert.notEqual(again.status, 302);
      assert.equal((await new Visitor().login('alice@example.com', 'Other#Pass2026')).status, 422);
    });
    await check('resetting the password signs out every other device', async () => {
      // Alice's original browser session was ended by the reset above.
      assert.ok(isLoginRedirect(await alice.request('/account/profile')));
      await alice.login('alice@example.com', 'NewTarha#2026');
      assert.equal((await alice.request('/account/profile')).status, 200);
    });
    await check('weak passwords are refused by the server', async () => {
      for (const pw of ['short1!', 'alllowercase1!', 'NoDigits!!', 'NoSymbol123A']) {
        const res = await new Visitor().post('/account/register', { full_name: 'Weak', email: `weak${pw.length}@example.com`, password: pw, password_confirm: pw });
        assert.equal(res.status, 422, pw);
      }
    });
    await check('passwords are stored as salted scrypt hashes, never as text', async () => {
      const rows = await db.all('SELECT password_hash FROM users');
      assert.ok(rows.every((r) => /^scrypt\$\d+\$\d+\$\d+\$[A-Za-z0-9+/=]{20,}\$[A-Za-z0-9+/=]{80,}$/.test(r.password_hash)));
      assert.equal(new Set(rows.map((r) => r.password_hash.split('$')[4])).size, rows.length, 'salts repeat');
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
      assert.equal((await new Visitor().login("' OR '1'='1", "' OR '1'='1")).status, 422);
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
        const login = await new Visitor().post('/account/login', { email: 'bob@example.com', password: 'Tarha#2026x', next });
        assert.equal(new URL(login.headers.get('location'), BASE).origin, BASE, `login next=${next}`);
      }
    });
    await check('source code, settings and the database are not downloadable', async () => {
      for (const url of ['/.env', '/package.json', '/src/config.js', '/src/schema.sql', '/uploads/../.env', '/uploads/..%2f..%2f.env', '/css/..%2f..%2f.env', '/data/pglite', '/.git/config']) {
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
      await owner.login(ADMIN.email, ADMIN.password);
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
      const res = await bob.post('/checkout', { expected_total: '1' });
      assert.equal(res.headers.get('location'), '/cart');
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
    section('8. Password guessing');
    await check('repeated login attempts are slowed down (429)', async () => {
      let blockedAt = 0;
      for (let i = 1; i <= 70 && !blockedAt; i++) {
        const res = await new Visitor().login('bob@example.com', `Guess#${i}aaaa`);
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
