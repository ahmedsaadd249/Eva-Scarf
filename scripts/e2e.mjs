// End-to-end check of the customer and owner workflows, in a real browser.
// Usage: npm run e2e
// Runs the store in this process on port 3101 with its own in-memory database, uploads folder and
// outbox, so the real store data is never touched. Emails are read back from that temporary outbox.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'eva-e2e-'));
const PORT = process.env.E2E_PORT || '3101';

// A stand-in for OpenStreetMap's Nominatim, so the map picker never calls the real service.
const PLACE = { lat: '30.0561', lon: '31.2003' };
const nominatimCalls = [];
const nominatim = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://mock');
  nominatimCalls.push({ path: url.pathname, ua: req.headers['user-agent'], params: Object.fromEntries(url.searchParams) });
  const place = (lat, lon) => ({
    lat, lon, display_name: 'شارع الأربعين، المهندسين، الجيزة، مصر',
    address: { road: 'شارع الأربعين', house_number: '27', suburb: 'المهندسين', city: 'الجيزة', country: 'مصر' },
  });
  res.setHeader('Content-Type', 'application/json');
  if (url.pathname === '/reverse') return res.end(JSON.stringify(place(url.searchParams.get('lat'), url.searchParams.get('lon'))));
  if (url.pathname === '/search') return res.end(JSON.stringify([place(PLACE.lat, PLACE.lon)]));
  res.statusCode = 404;
  res.end('{}');
});
await new Promise((r) => nominatim.listen(0, '127.0.0.1', r));
const NOMINATIM_URL = `http://127.0.0.1:${nominatim.address().port}`;
// Map tiles are answered locally too (a blank 1×1 PNG): no load on OpenStreetMap's tile servers.
const BLANK_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=', 'base64');
async function stubMapTiles(page) {
  await page.setRequestInterception(true);
  page.on('request', (req) => (/^https:\/\/([a-c]\.)?tile\.openstreetmap\.org\//.test(req.url())
    ? req.respond({ status: 200, contentType: 'image/png', body: BLANK_PNG })
    : req.continue()));
}
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
  NOMINATIM_URL,
  GEO_MIN_INTERVAL_MS: '0',
  // A made-up owner for the throwaway database: the test never uses the real owner's details from .env.
  ADMIN_EMAIL: 'owner@evascarf.test',
  ADMIN_PASSWORD: 'Owner#Pass2026',
});
const { config } = await import('../src/config.js');
const db = await import('../src/db.js');
const { seedAdmin, seedCatalog } = await import('../src/seed.js');
const { app } = await import('../src/app.js');
const { verifyPassword } = await import('../src/auth.js');
const { translate } = await import('../src/i18n.js');
const { formatMoney } = await import('../src/pricing.js');
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
  await stubMapTiles(page);

  // ---------------------------------------------------------------- characters
  section('Login / register characters react to the form');
  await page.goto(`${BASE}/account/register`, { waitUntil: 'networkidle0' });
  const acState = () => page.$eval('[data-auth-characters]', (el) => el.dataset.state);
  const waitState = (s) => page.waitForFunction((want) => document.querySelector('[data-auth-characters]')?.dataset.state === want, { timeout: 3000 }, s);
  assert.equal(await page.$$eval('[data-auth-characters] [data-ch]', (els) => els.length), 4, 'four characters drawn');
  assert.equal(await acState(), 'idle');
  await page.waitForFunction(() => document.querySelector('[data-auth-characters]')?.dataset.ready === '1');
  const pupil = () => page.$eval('[data-ch="dark"] .pupil', (el) => el.style.transform);
  await page.mouse.move(5, 5);
  await sleep(120);
  const lookTopLeft = await pupil();
  await page.mouse.move(420, 900);
  await sleep(120);
  assert.notEqual(await pupil(), lookTopLeft, 'eyes follow the pointer');
  ok('four characters render, and their eyes follow the pointer');
  await page.focus('#f-email');
  await waitState('typing');
  await page.focus('#f-password');
  await waitState('shy');
  await page.$eval('[data-toggle-password="f-password"]', (b) => b.click());
  await waitState('peek');
  await shot(page, 'characters-peek', false);
  await page.$eval('[data-toggle-password="f-password"]', (b) => b.click());
  await waitState('shy');
  await page.$eval('#f-password', (el) => el.blur());
  await waitState('idle');
  ok('email → look and lean, password → shy, show password → peek, blur → idle');

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
  await sleep(800);
  const welcomeFiles = () => (fs.existsSync(config.outboxDir) ? fs.readdirSync(config.outboxDir) : [])
    .filter((f) => f.includes('-welcome-') && f.endsWith('.html'));
  assert.equal(welcomeFiles().length, 0, 'no welcome email at sign-up');
  ok('no welcome email yet: it goes out once the profile is saved');

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

  // Map picker: search (Enter must not submit the profile), pick the result, confirm.
  await page.waitForSelector('[data-location-picker]:not([hidden]) .leaflet-container', { timeout: 15000 });
  assert.equal(await page.$eval('[data-location-picker] .leaflet-control-attribution', (el) => el.textContent.includes('OpenStreetMap')), true);
  await page.$eval('[name="street"]', (el) => { el.value = 'ررر'; }); // junk the map should replace
  const profileUrl = page.url();
  await page.type('[data-geo-search]', 'المهندسين');
  await page.keyboard.press('Enter');
  await page.waitForSelector('[data-geo-results] li button', { timeout: 5000 });
  assert.equal(page.url(), profileUrl, 'Enter in the map search does not submit the form');
  await page.$eval('[data-geo-results] li button', (b) => b.click());
  await page.waitForFunction(() => !document.querySelector('[data-geo-confirm]').disabled, { timeout: 8000 });
  await page.$eval('[data-geo-confirm]', (b) => b.click());
  const picked = await page.$eval('form[action="/account/profile"]', (f) => ({
    lat: f.elements.location_lat.value, lng: f.elements.location_lng.value, label: f.elements.location_label.value, street: f.elements.street.value,
    building: f.elements.building_no.value, zone: f.elements.zone_id.value, city: document.querySelector('#f-city').value,
    note: document.querySelector('[data-geo-note]').textContent,
    status: document.querySelector('[data-geo-status]').textContent,
  }));
  assert.deepEqual([Number(picked.lat), Number(picked.lng)], [Number(PLACE.lat), Number(PLACE.lon)]);
  assert.match(picked.label, /المهندسين/);
  assert.equal(picked.street, 'شارع الأربعين', 'street replaced from the map');
  assert.equal(picked.building, '27', 'building number from the map');
  assert.equal(picked.zone, String(zone.id), 'neighborhood chosen from the map (Mohandessin)');
  assert.equal(picked.city, zone.city_ar);
  assert.match(picked.note, /ملأنا .*الشارع.*من الخريطة/);
  assert.match(picked.note, /أكملي رقم الشقة/);
  assert.match(picked.status, /تم حفظ الموقع/);
  ok(`map search + "تأكيد الموقع" fill the location (${picked.lat}, ${picked.lng}), street, building 27 and the neighborhood`);
  assert.ok(nominatimCalls.some((c) => c.path === '/search' && c.params.countrycodes === 'eg' && c.params['accept-language'] === 'ar'));
  assert.ok(nominatimCalls.length && nominatimCalls.every((c) => /^EvaScarf\/1\.0 \(\+\S+\)$/.test(c.ua)), 'identifying User-Agent');
  ok(`address lookups go through the server (${nominatimCalls.length} calls, Egypt only, Arabic, User-Agent "${nominatimCalls[0].ua}")`);
  const apiStatus = (p, url) => p.evaluate((u) => fetch(u).then((r) => r.status), url);
  assert.equal(await apiStatus(page, '/api/geo/reverse?lat=200&lng=31'), 400);
  assert.equal(await apiStatus(page, '/api/geo/search?q=x'), 400);
  ok('bad coordinates and one-letter searches are refused (400)');

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
  assert.deepEqual([saved.location_lat, saved.location_lng], [Number(PLACE.lat), Number(PLACE.lon)]);
  assert.match(saved.location_label, /المهندسين/);
  ok('map location saved on the profile');
  const welcome = await waitForEmail('welcome', email, t0);
  assert.match(welcome.html, /Amna Osman/);
  assert.ok((await db.get('SELECT welcomed_at FROM users WHERE email = ?', [email])).welcomed_at);
  ok('welcome email sent after the first "Save details"');
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
  assert.deepEqual([order.location_lat, order.location_lng], [Number(PLACE.lat), Number(PLACE.lon)]);
  ok('the order keeps a copy of the map location');
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
  await fill(admin, { email: config.admin.email, password: 'Wrong#Pass123' });
  await submit(admin, 'form[action="/account/login"]');
  assert.equal(await admin.$eval('[data-auth-characters]', (el) => el.dataset.state), 'error');
  assert.ok(await admin.$('[role="alert"]'), 'wrong-details message');
  ok('wrong password: message shown and the characters look sad');
  await shot(admin, 'login-error', false);
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
  const mapsLink = await admin.$eval('a[data-maps-link]', (a) => ({ href: a.href, target: a.target, text: a.textContent.trim() }));
  assert.equal(mapsLink.href, `https://www.google.com/maps?q=${Number(PLACE.lat)},${Number(PLACE.lon)}`);
  assert.equal(mapsLink.target, '_blank');
  ok(`"${mapsLink.text}" opens ${mapsLink.href}`);
  await shot(admin, 'admin-order');

  const t2 = Date.now();
  await submit(admin, `form[action="/admin/orders/${order.id}/status"]`, 'button[value="shipped"]');
  const shipped = await waitForEmail('status-shipped', email, t2);
  const due = formatMoney(order.total, order.lang);
  assert.ok(shipped.html.includes(translate(order.lang, 'email.status.shipped.body', { name: order.customer_name, amount: due })),
    'the shipped sentence says how much cash to have ready');
  assert.ok(shipped.html.includes(translate(order.lang, 'email.status.amount_due')) && shipped.html.includes(`>${due}<`),
    'the shipped email shows the amount due on delivery');
  ok(`Shipped → status email sent, with the amount to pay the courier (${due})`);
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
  const resaved = await db.get('SELECT zone_id, location_lat FROM users WHERE email = ?', [email]);
  assert.equal(resaved.zone_id, dokki.id);
  assert.equal(resaved.location_lat, Number(PLACE.lat), 'saving again keeps the map location');
  await page.goto(`${BASE}/cart`, { waitUntil: 'networkidle0' });
  assert.ok((await summary()).includes('رسوم التوصيل') && (await summary()).includes('75.00'));
  ok('changing the profile to Dokki changes the cart fee to 75 EGP');
  assert.equal(welcomeFiles().length, 1, 'saving the profile again sends no second welcome email');
  ok('saving the profile again does not send another welcome email');
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
  assert.equal(await guest.evaluate(() => fetch('/api/geo/search?q=Dokki').then((r) => r.status)), 401);
  ok('the address lookup is for signed-in customers only (guest gets 401)');
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

  section('Owner: archive, restore and delete a product that was ordered');
  // Karkadeh is in order ${orderNo}. Archive hides it but keeps it.
  await admin.goto(`${BASE}/admin/products`, { waitUntil: 'networkidle0' });
  await submit(admin, `form[action="/admin/products/${karkadeh.id}/archive"]`);
  assert.equal((await db.get('SELECT is_archived FROM products WHERE id = ?', [karkadeh.id])).is_archived, 1);
  assert.equal((await page.goto(`${BASE}/product/karkadeh`, { waitUntil: 'networkidle0' })).status(), 404, 'archived product hidden from the store');
  await admin.goto(`${BASE}/admin/products?view=archived`, { waitUntil: 'networkidle0' });
  assert.ok(await admin.$(`form[action="/admin/products/${karkadeh.id}/delete"]`), 'Archived tab offers Delete');
  await submit(admin, `form[action="/admin/products/${karkadeh.id}/restore"]`);
  assert.equal((await db.get('SELECT is_archived FROM products WHERE id = ?', [karkadeh.id])).is_archived, 0);
  ok('archive hides it from the store; the Archived tab can restore it (or delete it)');
  await shot(admin, 'admin-product-edit-actions');

  // Delete for good: the product goes, the past order keeps its copy.
  const itemBefore = await db.get('SELECT * FROM order_items WHERE order_id = ? AND product_id = ?', [order.id, karkadeh.id]);
  await admin.goto(`${BASE}/admin/products`, { waitUntil: 'networkidle0' });
  await shot(admin, 'admin-products-actions');
  await submit(admin, `form[action="/admin/products/${karkadeh.id}/delete"]`);
  assert.equal(await db.get('SELECT 1 FROM products WHERE id = ?', [karkadeh.id]), null, 'product deleted');
  const itemAfter = await db.get('SELECT * FROM order_items WHERE id = ?', [itemBefore.id]);
  assert.equal(itemAfter.product_id, null);
  for (const col of ['name_ar', 'name_en', 'image', 'unit_price', 'final_unit_price', 'qty', 'line_total']) {
    assert.equal(itemAfter[col], itemBefore[col], `order item ${col} unchanged`);
  }
  assert.equal((await db.get('SELECT total FROM orders WHERE id = ?', [order.id])).total, order.total);
  await admin.goto(`${BASE}/admin/orders/${order.id}`, { waitUntil: 'networkidle0' });
  assert.ok((await admin.$eval('main', (m) => m.innerText)).includes(itemBefore.name_ar), 'owner order page still lists the item');
  assert.ok(await admin.$(`main img[src="${itemBefore.image}"]`), 'order still shows the item photo');
  await page.goto(`${BASE}/account/orders/${orderNo}`, { waitUntil: 'networkidle0' });
  assert.ok((await page.$eval('main', (m) => m.innerText)).includes(itemBefore.name_ar), "customer's order page still lists the item");
  ok(`deleting it keeps order ${orderNo} unchanged: name, photo, price and total`);

  section('Owner: offers (free delivery over an amount, buy 3 get the 4th free, % off)');
  const { finalUnitPrice } = await import('../src/pricing.js');
  await admin.goto(`${BASE}/admin/offers`, { waitUntil: 'networkidle0' });
  const listed = await admin.$$eval('[data-offer]', (els) => els.map((el) => ({ id: el.dataset.offer, status: el.querySelector('[data-offer-status]').textContent.trim() })));
  assert.equal(listed.length, 2, 'two starting offers');
  assert.ok(listed.every((o) => o.status === 'موقوف'), 'both switched off');
  const seededOffers = await db.all('SELECT * FROM offers ORDER BY id');
  const freeDeliveryOffer = seededOffers.find((o) => o.type === 'free_delivery');
  const buyGetOffer = seededOffers.find((o) => o.type === 'buy_get');
  assert.deepEqual([freeDeliveryOffer.min_subtotal, buyGetOffer.buy_qty, buyGetOffer.get_qty], [100000, 3, 1]);
  ok('the two starting offers are listed and switched off (free delivery over 1,000 EGP, buy 3 get 1)');
  await shot(admin, 'admin-offers');

  // Customer: 4 pieces of one tarha. While the offers are off, nothing changes.
  const cheap = await db.get('SELECT * FROM products WHERE is_active = 1 AND is_archived = 0 AND stock >= 4 ORDER BY price, id LIMIT 1');
  const unit = finalUnitPrice(cheap.price, cheap.discount_percent);
  const dokkiFee = (await db.get("SELECT fee FROM zones WHERE name_en = 'Dokki'")).fee;
  await page.goto(`${BASE}/cart`, { waitUntil: 'networkidle0' });
  await page.evaluate(async (id) => {
    const headers = { 'x-csrf-token': document.querySelector('meta[name=csrf-token]').content, Accept: 'application/json' };
    for (const line of document.querySelectorAll('input[name=product_id]')) {
      await fetch('/cart/remove', { method: 'POST', headers, body: new URLSearchParams({ product_id: line.value }) });
    }
    await fetch('/cart/add', { method: 'POST', headers, body: new URLSearchParams({ product_id: id, qty: '4' }) });
  }, String(cheap.id));
  const cartTotal = async () => {
    await page.goto(`${BASE}/cart`, { waitUntil: 'networkidle0' });
    return Number(await page.$eval('[data-total]', (el) => el.dataset.total));
  };
  assert.equal(await cartTotal(), unit * 4 + dokkiFee);
  assert.equal(await page.$('[data-offer-banner]'), null, 'no offer banner while offers are off');
  ok('offers that are off change nothing');

  // Owner switches on "buy 3, get 1 free".
  await admin.goto(`${BASE}/admin/offers`, { waitUntil: 'networkidle0' });
  await submit(admin, `form[action="/admin/offers/${buyGetOffer.id}/toggle"]`);
  assert.equal((await db.get('SELECT is_active FROM offers WHERE id = ?', [buyGetOffer.id])).is_active, 1);
  assert.equal(await cartTotal(), unit * 3 + dokkiFee, 'one of four is free');
  assert.ok(await page.$('[data-offer-line="buy_get"]'), 'offer line in the cart');
  assert.match(await page.$eval('[data-offer-banner]', (el) => el.textContent), /اشتري.*3.*واحصلي على.*1.*مجانًا/);
  ok(`"buy 3, get 1 free" on: the cart takes ${unit / 100} EGP off and the store shows a banner`);

  // And free delivery over 1,000 EGP.
  await submit(admin, `form[action="/admin/offers/${freeDeliveryOffer.id}/toggle"]`);
  const itemsAfterOffers = unit * 3;
  const freeDelivery = itemsAfterOffers >= 100000;
  assert.equal(await cartTotal(), itemsAfterOffers + (freeDelivery ? 0 : dokkiFee));
  if (freeDelivery) assert.ok(await page.$('[data-offer-line="free_delivery"]'), 'free delivery shown');
  else assert.equal(Number(await page.$eval('[data-free-delivery-gap]', (el) => el.dataset.freeDeliveryGap)), 100000 - itemsAfterOffers);
  await shot(page, 'cart-offers');
  ok(freeDelivery ? 'free delivery over 1,000 EGP applies to this cart' : 'free delivery: the cart says how much more is needed');

  // Checkout: the order keeps what each offer saved, and shows it.
  const tOffers = Date.now();
  await page.goto(`${BASE}/checkout`, { waitUntil: 'networkidle0' });
  await submit(page, 'form[action="/checkout"]');
  const offerOrderNo = /orders\/(EVA-\d+)/.exec(page.url())?.[1];
  assert.ok(offerOrderNo, 'order placed');
  const offerOrder = await db.get('SELECT * FROM orders WHERE order_no = ?', [offerOrderNo]);
  assert.equal(offerOrder.offer_discount, unit);
  assert.equal(offerOrder.delivery_fee, freeDelivery ? 0 : dokkiFee);
  assert.deepEqual(offerOrder.offers.map((o) => o.type), freeDelivery ? ['buy_get', 'free_delivery'] : ['buy_get']);
  assert.ok(await page.$('[data-offer-line="buy_get"]'), 'the customer order page shows the offer');
  const offerEmail = await waitForEmail('order-confirmation', email, tOffers);
  assert.match(offerEmail.html, /اشتري.*3.*واحصلي على.*1.*مجانًا/);
  ok(`order ${offerOrderNo} records the offers (saved ${(unit + (freeDelivery ? dokkiFee : 0)) / 100} EGP); the order page and email show them`);

  // Owner adds an offer with the form (like adding a product), then deletes it.
  await admin.goto(`${BASE}/admin/offers/new`, { waitUntil: 'networkidle0' });
  await admin.click('input[name="type"][value="order_percent"]');
  assert.equal(await admin.$eval('[data-offer-fields="buy_get"]', (el) => el.hidden), true, 'only the fields for this kind show');
  await fill(admin, { percent: '95' });
  await submit(admin, 'form[data-offer-form]');
  assert.ok((await admin.$eval('main', (m) => m.innerText)).includes('نسبة صحيحة من 1 إلى 90'), '95% refused');
  await admin.click('input[name="type"][value="order_percent"]');
  await fill(admin, { percent: '10', min_subtotal: '' });
  await shot(admin, 'admin-offer-form');
  await submit(admin, 'form[data-offer-form]');
  const added = await db.get("SELECT * FROM offers WHERE type = 'order_percent'");
  assert.ok(added && added.percent === 10 && added.min_subtotal === 0 && added.is_active === 0, 'new offer saved, switched off');
  assert.equal((await admin.$$('[data-offer]')).length, 3);
  await submit(admin, `form[action="/admin/offers/${added.id}/delete"]`);
  assert.equal(await db.get('SELECT 1 FROM offers WHERE id = ?', [added.id]), null);
  ok('the owner adds an offer with the form (10% off every order) and deletes it');

  // Back to how the store should be: both starting offers off.
  await submit(admin, `form[action="/admin/offers/${buyGetOffer.id}/toggle"]`);
  await submit(admin, `form[action="/admin/offers/${freeDeliveryOffer.id}/toggle"]`);
  assert.equal((await db.get('SELECT SUM(is_active)::int AS n FROM offers')).n, 0);
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle0' });
  assert.equal(await page.$('[data-offer-banner]'), null);
  assert.equal((await db.get('SELECT offers FROM orders WHERE order_no = ?', [offerOrderNo])).offers.length, freeDelivery ? 2 : 1, 'the past order keeps its offers');
  ok('offers switched off again: the banner goes, and the past order keeps its offers');

  section('Owner account: the dashboard only (no customer pages), password in Settings');
  for (const url of ['/account', '/account/profile', '/account/orders']) {
    await admin.goto(BASE + url, { waitUntil: 'networkidle0' });
    assert.equal(new URL(admin.url()).pathname, '/admin', `${url} leads to the dashboard`);
  }
  await admin.goto(`${BASE}/account/orders/${orderNo}`, { waitUntil: 'networkidle0' });
  assert.equal(new URL(admin.url()).pathname, `/admin/orders/${order.id}`, 'an order link opens it in the dashboard');
  await admin.goto(`${BASE}/`, { waitUntil: 'networkidle0' });
  assert.ok(await admin.$('header a[href="/admin"]'), 'header account icon goes to the dashboard');
  assert.equal(await admin.$('a[href="/account/profile"], a[href="/account/orders"]'), null, 'no "my details" / "my orders" links for the owner');
  ok('the owner\'s "account" is the dashboard: no بياناتي / طلباتي, order links open in the dashboard');
  await admin.goto(`${BASE}/checkout`, { waitUntil: 'networkidle0' });
  assert.equal(new URL(admin.url()).pathname, '/cart');
  assert.ok((await admin.$eval('body', (b) => b.innerText)).includes('حساب صاحب المتجر لا يُستخدم لإتمام الطلبات'));
  ok('the owner account doesn\'t check out (polite note in the cart)');

  await admin.goto(`${BASE}/admin/settings`, { waitUntil: 'networkidle0' });
  await fill(admin, { current_password: 'Wrong#Pass123', new_password: 'NewOwner#2026', new_password_confirm: 'NewOwner#2026' });
  await submit(admin, 'form[action="/admin/settings/password"]');
  assert.ok(await admin.$('#f-current_password-error'), 'wrong current password refused');
  await fill(admin, { current_password: config.admin.password, new_password: 'NewOwner#2026', new_password_confirm: 'NewOwner#2026' });
  await submit(admin, 'form[action="/admin/settings/password"]');
  assert.equal(new URL(admin.url()).pathname, '/admin/settings');
  const ownerHash = (await db.get("SELECT password_hash FROM users WHERE role = 'admin'")).password_hash;
  assert.ok(await verifyPassword('NewOwner#2026', ownerHash), 'new owner password saved');
  await shot(admin, 'admin-settings-password');
  // Put the original password back.
  await fill(admin, { current_password: 'NewOwner#2026', new_password: config.admin.password, new_password_confirm: config.admin.password });
  await submit(admin, 'form[action="/admin/settings/password"]');
  assert.ok(await verifyPassword(config.admin.password, (await db.get("SELECT password_hash FROM users WHERE role = 'admin'")).password_hash));
  ok('the owner changes the password in Dashboard → Settings (the current password is required)');

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
  nominatim.close();
  await db.closeDb();
  fs.rmSync(TMP, { recursive: true, force: true });
  process.exit(process.exitCode ?? 0); // the session store / pools may keep timers alive
}
