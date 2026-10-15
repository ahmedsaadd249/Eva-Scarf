// End-to-end check of the customer and owner workflows, in a real browser.
// Usage: npm run e2e
// Runs the store in this process on port 3101 with its own in-memory database, uploads folder and
// outbox, so the real store data is never touched. Emails are read back from that temporary outbox.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'eva-e2e-'));
const PORT = process.env.E2E_PORT || '3101';
// Set before loading the app: values already in the environment win over .env.
Object.assign(process.env, {
  PORT,
  BASE_URL: `http://localhost:${PORT}`,
  DATABASE_URL: '',
  PGLITE_DIR: 'memory://e2e',
  SUPABASE_URL: '',
  SUPABASE_SERVICE_ROLE_KEY: '',
  UPLOADS_DIR: path.join(TMP, 'uploads'),
  OUTBOX_DIR: path.join(TMP, 'outbox'),
  SMTP_HOST: '',
  NODE_ENV: 'development',
  AUTH_RATE_LIMIT: '100',
});
const { config } = await import('../src/config.js');
if (!config.admin.email || !config.admin.password) {
  console.error('Set ADMIN_EMAIL and ADMIN_PASSWORD in .env first (the test signs in as the owner).');
  process.exit(1);
}
const db = await import('../src/db.js');
const { seedAdmin, seedCatalog } = await import('../src/seed.js');
const { app } = await import('../src/app.js');
await seedAdmin();
await seedCatalog();
const server = app.listen(Number(PORT));
const BASE = config.baseUrl;
console.log(`Test server: ${BASE} (temporary data in ${TMP})`);

const SHOTS = path.join(ROOT, 'temporary screenshots');
const email = `e2e.${Date.now()}@example.com`;
const password = 'Tarha#2026x';
fs.mkdirSync(SHOTS, { recursive: true });

let step = 0;
const ok = (msg) => console.log(`  ✓ ${msg}`);
const section = (name) => console.log(`\n${++step}. ${name}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Wait until an outbox email of `type` to `to` appears; returns { html, eml }. */
async function waitForEmail(type, to, sinceMs) {
  const safeTo = to.replace(/[^a-z0-9@._-]/gi, '_');
  for (let i = 0; i < 50; i++) {
    const files = fs.existsSync(config.outboxDir) ? fs.readdirSync(config.outboxDir) : [];
    const match = files
      .filter((f) => f.includes(`-${type}-${safeTo}.html`))
      .map((f) => ({ f, t: fs.statSync(path.join(config.outboxDir, f)).mtimeMs }))
      .filter((x) => x.t >= sinceMs - 1000)
      .sort((a, b) => b.t - a.t)[0];
    if (match) {
      const base = path.join(config.outboxDir, match.f.replace(/\.html$/, ''));
      return { html: fs.readFileSync(`${base}.html`, 'utf8'), eml: fs.readFileSync(`${base}.eml`, 'utf8') };
    }
    await sleep(200);
  }
  throw new Error(`No ${type} email to ${to} in outbox`);
}

async function shot(page, name, fullPage = true) {
  await sleep(300);
  await page.screenshot({ path: path.join(SHOTS, `e2e-${String(step).padStart(2, '0')}-${name}.png`), fullPage });
}

// Submit via requestSubmit (fires the page's own submit handlers) rather than a mouse click,
// which can land on the fixed mobile bottom nav when the button sits underneath it.
function requestSubmit(page, formSelector, buttonSelector = 'button:not([type=button])') {
  return page.$eval(formSelector, (form, sel) => form.requestSubmit(form.querySelector(sel) || undefined), buttonSelector);
}

async function submit(page, formSelector, buttonSelector) {
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle0' }),
    requestSubmit(page, formSelector, buttonSelector),
  ]);
}

async function fill(page, values) {
  for (const [name, value] of Object.entries(values)) {
    await page.$eval(`[name="${name}"]`, (el) => { el.value = ''; });
    if (value) await page.type(`[name="${name}"]`, value);
  }
}

const launch = () => puppeteer.launch({ headless: true }).catch(() => puppeteer.launch({
  headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
}));

const browser = await launch();
const errors = [];
let active = null; // last page used, for a failure screenshot
try {
  const customer = await browser.createBrowserContext();
  const page = await customer.newPage();
  active = page;
  page.on('pageerror', (e) => errors.push(e.message));
  await page.setViewport({ width: 430, height: 932 });

  // ---------------------------------------------------------------- register
  section('Register: validation and welcome email');
  await page.goto(`${BASE}/account/register`, { waitUntil: 'networkidle0' });
  await fill(page, { full_name: 'Amna Osman', email: 'no-at-sign.com', password: 'abc', password_confirm: 'abc' });
  await requestSubmit(page, 'form[action="/account/register"]');
  await sleep(200);
  assert.equal(page.url(), `${BASE}/account/register`, 'client validation should block submit');
  const clientErrors = await page.$$eval('[data-client-error]', (els) => els.map((e) => e.textContent));
  assert.ok(clientErrors.length >= 2, 'client errors shown for email and password');
  ok(`browser blocks bad email + weak password (${clientErrors.length} messages)`);
  await shot(page, 'register-client-errors', false);

  // Same bad input with client checks removed: the server must reject it too.
  await page.$eval('form[action="/account/register"]', (f) => f.removeAttribute('data-validate'));
  await submit(page, 'form[action="/account/register"]');
  assert.ok(await page.$('#f-email-error'), 'server email error');
  assert.ok(await page.$('#f-password-error'), 'server password error');
  ok('server rejects "no-at-sign.com" and "abc" (422)');

  await page.$eval('form[action="/account/register"]', (f) => f.removeAttribute('data-validate'));
  await fill(page, { full_name: 'Amna Osman', email, password: 'weakpassword1', password_confirm: 'weakpassword1' });
  await submit(page, 'form[action="/account/register"]');
  assert.ok(await page.$('#f-password-error'), 'password without upper/symbol rejected');
  ok('server rejects a password with no uppercase or symbol');

  const t0 = Date.now();
  await fill(page, { full_name: 'Amna Osman', email, password, password_confirm: password });
  await submit(page, 'form[action="/account/register"]');
  assert.match(page.url(), /\/account\/profile/);
  ok('valid registration logs in and opens the profile');
  const welcome = await waitForEmail('welcome', email, t0);
  assert.match(welcome.html, /Amna Osman/);
  ok('welcome email written to outbox');

  // ---------------------------------------------------------------- profile
  section('Profile: neighborhood, full address and both phones required');
  const zone = (await db.get("SELECT * FROM zones WHERE name_en = 'Mohandessin'"));
  const zoneOptions = () => page.$$eval('#f-zone_id option:not([value=""])', (os) => os.map((o) => o.value));
  assert.deepEqual(await zoneOptions(), [String(zone.id)], 'only neighborhoods with a fee are offered');
  ok('customers can only pick neighborhoods that have a delivery fee (Mohandessin)');
  const profile = {
    full_name: 'Amna Osman', street: 'Al Arbaeen St',
    building_no: '14', apartment_no: '3', phone_primary: '0912345678', phone_secondary: '+249 99 123 4567',
  };
  await fill(page, { ...profile, apartment_no: '', phone_secondary: '' });
  await page.$eval('form[action="/account/profile"]', (f) => f.removeAttribute('data-validate'));
  await submit(page, 'form[action="/account/profile"]');
  assert.ok(await page.$('#f-zone_id-error'), 'neighborhood required');
  assert.equal(await page.$eval('[data-form-error]', (el) => el.hidden), false, '"not saved" message shown');
  assert.ok(await page.$('#f-apartment_no-error'), 'apartment number required');
  assert.ok(await page.$('#f-phone_secondary-error'), 'second phone required');
  ok('missing neighborhood, apartment number and second phone are rejected');
  await fill(page, profile);
  await page.select('#f-city', zone.city_ar);
  await page.select('#f-zone_id', String(zone.id));
  await submit(page, 'form[action="/account/profile"]');
  const saved = (await db.get('SELECT * FROM users WHERE email = ?', [email]));
  assert.equal(saved.zone_id, zone.id);
  assert.equal(saved.village, 'المهندسين');
  assert.equal(saved.apartment_no, '3');
  assert.equal(saved.phone_secondary, '+249991234567');
  ok('profile saved with neighborhood Mohandessin (phones normalised: +249991234567)');
  await shot(page, 'profile-saved');

  // ---------------------------------------------------------------- cart
  section('Cart: totals with a discounted item');
  const karkadeh = (await db.get("SELECT * FROM products WHERE slug = 'karkadeh'"));
  const blueNile = (await db.get("SELECT * FROM products WHERE slug = 'blue-nile'"));
  await page.goto(`${BASE}/product/karkadeh`, { waitUntil: 'networkidle0' });
  await shot(page, 'product');
  await page.$eval('#qty', (el) => { el.value = '2'; });
  await requestSubmit(page, '#add-to-cart');
  await page.waitForFunction(() => document.querySelector('[data-cart-count]')?.textContent.trim() === '2');
  ok('add to cart updates the badge without reloading');
  await page.goto(`${BASE}/product/blue-nile`, { waitUntil: 'networkidle0' });
  await requestSubmit(page, '#add-to-cart');
  await page.waitForFunction(() => document.querySelector('[data-cart-count]')?.textContent.trim() === '3');
  await page.goto(`${BASE}/cart`, { waitUntil: 'networkidle0' });
  const fee = zone.fee; // Mohandessin delivery fee
  const k = Math.round((karkadeh.price * (100 - karkadeh.discount_percent)) / 100);
  const expected = k * 2 + Math.round((blueNile.price * (100 - blueNile.discount_percent)) / 100) + fee;
  const shown = Number(await page.$eval('[data-total]', (el) => el.dataset.total));
  assert.equal(shown, expected);
  ok(`cart total ${(shown / 100).toFixed(2)} EGP matches the hand calculation`);
  await shot(page, 'cart');

  // ---------------------------------------------------------------- checkout
  section('Checkout: order, stock and confirmation email');
  await page.goto(`${BASE}/checkout`, { waitUntil: 'networkidle0' });
  await shot(page, 'checkout');
  const t1 = Date.now();
  await submit(page, 'form[action="/checkout"]');
  const orderNo = /orders\/(EVA-\d+)/.exec(page.url())?.[1];
  assert.ok(orderNo, 'redirected to the order page');
  ok(`order ${orderNo} placed`);
  await shot(page, 'order-placed');
  const order = (await db.get('SELECT * FROM orders WHERE order_no = ?', [orderNo]));
  assert.equal(order.total, expected);
  assert.equal(order.status, 'processing');
  assert.equal(order.apartment_no, '3');
  const stockAfter = (await db.get('SELECT stock FROM products WHERE id = ?', [karkadeh.id])).stock;
  assert.equal(stockAfter, karkadeh.stock - 2);
  ok(`stock decremented (Karkadeh ${karkadeh.stock} → ${stockAfter})`);
  const confirmation = await waitForEmail('order-confirmation', email, t1);
  assert.match(confirmation.eml, /Content-ID: <item0@evascarf>/);
  assert.match(confirmation.eml, /Content-ID: <item1@evascarf>/);
  assert.match(confirmation.eml, /cid:item0@evascarf/);
  ok('confirmation email embeds both product images inline (cid)');

  // ---------------------------------------------------------------- owner
  section('Owner: dashboard, status emails, rating');
  const owner = await browser.createBrowserContext();
  const admin = await owner.newPage();
  active = admin;
  admin.on('pageerror', (e) => errors.push(e.message));
  await admin.setViewport({ width: 1366, height: 900 });
  await admin.goto(`${BASE}/account/login`, { waitUntil: 'networkidle0' });
  await fill(admin, { email: config.admin.email, password: config.admin.password });
  await submit(admin, 'form[action="/account/login"]');
  assert.match(admin.url(), /\/admin$/);
  ok('owner lands on the dashboard after sign-in');
  await shot(admin, 'admin-overview');

  await admin.goto(`${BASE}/admin/orders`, { waitUntil: 'networkidle0' });
  const listText = await admin.$eval('main', (m) => m.innerText);
  assert.ok(listText.includes(orderNo) && listText.includes('Amna Osman') && listText.includes('المهندسين'));
  ok('order list shows number, customer and location');
  await shot(admin, 'admin-orders');

  await admin.goto(`${BASE}/admin/orders/${order.id}`, { waitUntil: 'networkidle0' });
  const detail = await admin.$eval('main', (m) => m.innerText);
  for (const s of ['Amna Osman', email, '0912345678', '+249991234567', 'المهندسين', 'الجيزة', 'Al Arbaeen St', '14']) {
    assert.ok(detail.includes(s), `order detail shows ${s}`);
  }
  ok('order detail shows contact info and every address field');
  await shot(admin, 'admin-order');

  const t2 = Date.now();
  await submit(admin, `form[action="/admin/orders/${order.id}/status"]`, 'button[value="shipped"]');
  await waitForEmail('status-shipped', email, t2);
  ok('Shipped → status email sent');
  const t3 = Date.now();
  await submit(admin, `form[action="/admin/orders/${order.id}/status"]`, 'button[value="delivered"]');
  const delivered = await waitForEmail('status-delivered', email, t3);
  const rateLink = /href="([^"]*\/rate\/[A-Za-z0-9_-]+)\?stars=5"/.exec(delivered.html)?.[1];
  assert.ok(rateLink, 'delivered email contains rating links');
  ok('Delivered → email with 1-5 star rating links');

  await page.goto(`${rateLink}?stars=5`, { waitUntil: 'networkidle0' });
  assert.ok(await page.$eval('#star-5', (el) => el.checked), 'the star clicked in the email is preselected');
  await shot(page, 'rate');
  await page.type('#comment', 'The Karkadeh satin is even richer in person. Fast delivery!');
  await submit(page, 'form[action^="/rate/"]');
  const rating = (await db.get('SELECT * FROM ratings WHERE order_id = ?', [order.id]));
  assert.equal(rating.stars, 5);
  ok('customer rated 5 stars with a comment');
  await admin.goto(`${BASE}/admin/orders/${order.id}`, { waitUntil: 'networkidle0' });
  assert.ok((await admin.$eval('main', (m) => m.innerText)).includes('even richer in person'));
  ok('rating appears on the owner\'s order page');
  const history = (await db.all('SELECT status FROM order_status_history WHERE order_id = ? ORDER BY id', [order.id])).map((r) => r.status);
  assert.deepEqual(history, ['processing', 'shipped', 'delivered']);

  // ---------------------------------------------------------------- products
  section('Owner: delivery fee per neighborhood');
  const dokki = (await db.get("SELECT * FROM zones WHERE name_en = 'Dokki'"));
  await admin.goto(`${BASE}/admin/delivery`, { waitUntil: 'networkidle0' });
  await admin.$eval(`input[name="fee[z${dokki.id}]"]`, (el) => { el.value = '75'; });
  await submit(admin, '#zone-fees', 'button:not([form])');
  assert.equal((await db.get('SELECT fee FROM zones WHERE id = ?', [dokki.id])).fee, 7500);
  await shot(admin, 'admin-delivery');
  await page.goto(`${BASE}/account/profile`, { waitUntil: 'networkidle0' });
  assert.ok((await zoneOptions()).includes(String(dokki.id)), 'Dokki now offered');
  ok('owner priced Dokki at 75 EGP and customers can now choose it');

  section('Cart: delivery fee comes from the neighborhood saved in the profile');
  await page.goto(`${BASE}/product/blue-nile`, { waitUntil: 'networkidle0' });
  await requestSubmit(page, '#add-to-cart');
  await page.waitForFunction(() => document.querySelector('[data-cart-count]')?.textContent.trim() === '1');
  await page.goto(`${BASE}/cart`, { waitUntil: 'networkidle0' });
  const summary = () => page.$eval('aside[aria-labelledby="summary-title"]', (a) => a.innerText);
  assert.equal(await page.$('#cart-zone'), null, 'no neighborhood picker in the cart');
  assert.ok((await summary()).includes('رسوم التوصيل') && (await summary()).includes('100.00'));
  ok('cart shows "رسوم التوصيل = 100.00" from the Mohandessin profile');
  await page.goto(`${BASE}/account/profile`, { waitUntil: 'networkidle0' });
  await page.select('#f-city', dokki.city_ar);
  await page.select('#f-zone_id', String(dokki.id));
  await submit(page, 'form[action="/account/profile"]');
  assert.equal((await db.get('SELECT zone_id FROM users WHERE email = ?', [email])).zone_id, dokki.id);
  await page.goto(`${BASE}/cart`, { waitUntil: 'networkidle0' });
  assert.ok((await summary()).includes('رسوم التوصيل') && (await summary()).includes('75.00'));
  ok('changing the profile to Dokki changes the cart fee to 75 EGP');
  await shot(page, 'cart-zone');

  const guestContext = await browser.createBrowserContext();
  const guest = await guestContext.newPage();
  guest.on('pageerror', (e) => errors.push(e.message));
  await guest.goto(`${BASE}/product/blue-nile`, { waitUntil: 'networkidle0' });
  await requestSubmit(guest, '#add-to-cart');
  await guest.waitForFunction(() => document.querySelector('[data-cart-count]')?.textContent.trim() === '1');
  await guest.goto(`${BASE}/cart`, { waitUntil: 'networkidle0' });
  const guestSummary = await guest.$eval('aside[aria-labelledby="summary-title"]', (a) => a.innerText);
  assert.ok(guestSummary.includes('حسب الحي'));
  assert.ok(await guest.$('a[href="/account/login?next=/cart"]'), 'sign-in link to get the fee');
  ok('a guest sees "حسب الحي" and a link to sign in');
  await guestContext.close();

  section('Owner: add (without a name), price, discount and stock');
  await admin.goto(`${BASE}/admin/products/new`, { waitUntil: 'networkidle0' });
  await fill(admin, { price: '400', stock: '5' }); // no name: names are optional
  const input = await admin.$('input[type=file][name=images]');
  await input.uploadFile(path.join(ROOT, 'public', 'samples', 'lilac-1.jpg'));
  // Photos are resized in the browser first; wait until the form is ready again.
  await admin.waitForFunction(() => document.querySelector('[data-image-preview] img') && !document.querySelector('form[enctype] button:not([form])').disabled);
  await submit(admin, 'form[enctype="multipart/form-data"]');
  const created = (await db.get('SELECT * FROM products ORDER BY id DESC LIMIT 1'));
  assert.ok(created && created.name_ar === '' && created.name_en === '' && created.price === 40000 && created.stock === 5);
  const img = (await db.get('SELECT path FROM product_images WHERE product_id = ?', [created.id]));
  assert.ok(img && fs.existsSync(path.join(config.uploadsDir, path.basename(img.path))));
  ok('product created without a name, with an uploaded image');
  await shot(admin, 'admin-product-form');

  await admin.goto(`${BASE}/admin/products`, { waitUntil: 'networkidle0' });
  await admin.$eval(`input[form="q-${created.id}"][name=price]`, (el) => { el.value = '420.50'; });
  await Promise.all([admin.waitForNavigation({ waitUntil: 'networkidle0' }), admin.click(`button[form="q-${created.id}"]`)]);
  assert.equal((await db.get('SELECT price FROM products WHERE id = ?', [created.id])).price, 42050);
  ok('price edited inline (420.50)');

  await admin.click(`input[data-bulk-check][value="${created.id}"]`);
  await admin.$eval('#bulk-percent', (el) => { el.value = '20'; });
  await submit(admin, 'form#bulk');
  assert.equal((await db.get('SELECT discount_percent FROM products WHERE id = ?', [created.id])).discount_percent, 20);
  ok('bulk 20% discount applied to the selected product');
  await shot(admin, 'admin-products');

  await admin.$eval(`input[form="q-${created.id}"][name=stock]`, (el) => { el.value = '0'; });
  await Promise.all([admin.waitForNavigation({ waitUntil: 'networkidle0' }), admin.click(`button[form="q-${created.id}"]`)]);
  assert.equal((await db.get('SELECT stock FROM products WHERE id = ?', [created.id])).stock, 0);
  await page.goto(`${BASE}/product/${created.slug}`, { waitUntil: 'networkidle0' });
  const unnamedPage = await page.$eval('main', (m) => ({ h1Hidden: m.querySelector('h1').classList.contains('sr-only'), text: m.innerText }));
  assert.ok(unnamedPage.h1Hidden && !unnamedPage.text.includes('طرحة رقم'), 'unnamed tarha shows no name');
  ok('an unnamed tarha is shown without a name'); 
  assert.equal(await page.$('#add-to-cart'), null, 'no add-to-cart form when sold out');
  const addRes = await page.evaluate(async (id) => {
    const res = await fetch('/cart/add', {
      method: 'POST',
      headers: { Accept: 'application/json', 'x-csrf-token': document.querySelector('meta[name=csrf-token]').content },
      body: new URLSearchParams({ product_id: id, qty: '1' }),
    });
    return res.status;
  }, String(created.id));
  assert.equal(addRes, 409);
  ok('stock 0 → storefront shows "sold out" and the server refuses to add it');

  // Clean up the test product (never ordered, so it is deleted outright).
  admin.on('dialog', (d) => d.accept());
  await admin.goto(`${BASE}/admin/products`, { waitUntil: 'networkidle0' });
  await submit(admin, `form[action="/admin/products/${created.id}/delete"]`);
  assert.equal((await db.get('SELECT 1 FROM products WHERE id = ?', [created.id])), null);
  ok('test product deleted');

  section('Browser console');
  assert.deepEqual(errors, [], `page errors: ${errors.join(' | ')}`);
  ok('no JavaScript errors on any page');

  console.log(`\nAll checks passed. Screenshots: ${path.relative(ROOT, SHOTS)}${path.sep}e2e-*.png`);
} catch (err) {
  console.error('\n✗ E2E failed:', err.message);
  if (active) {
    console.error('  at', active.url());
    await active.screenshot({ path: path.join(SHOTS, 'e2e-failure.png'), fullPage: true }).catch(() => {});
  }
  process.exitCode = 1;
} finally {
  await browser.close();
  await new Promise((r) => server.close(r));
  await db.closeDb();
  fs.rmSync(TMP, { recursive: true, force: true });
  process.exit(process.exitCode ?? 0); // the session store / pools may keep timers alive
}
