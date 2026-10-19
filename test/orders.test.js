import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

// A throwaway in-memory Postgres; must be set before the app modules are imported.
process.env.DATABASE_URL = '';
process.env.PGLITE_DIR = 'memory://orders-test';
const { closeDb, get, run } = await import('../src/db.js');
const { placeOrder, setOrderStatus, getOrder, OrderError } = await import('../src/orders.js');
const { invalidateOffers } = await import('../src/offers.js');

let user;
let productId;
let zone;

before(async () => {
  // The default neighborhoods are inserted on first start; Mohandessin is priced at 100 EGP.
  zone = await get("SELECT * FROM zones WHERE name_en = 'Mohandessin'");
  user = await get(`INSERT INTO users (email, password_hash, full_name, phone_primary, phone_secondary, zone_id, street, building_no, apartment_no)
                    VALUES ('t@example.com', 'x', 'Test Customer', '0912345678', '0101234567', ?, 'Street 15', '7', '2') RETURNING *`, [zone.id]);
  user = await get('UPDATE users SET location_lat = 30.0561, location_lng = 31.2003, location_label = ? WHERE id = ? RETURNING *', ['شارع الأربعين، المهندسين', user.id]);
  // No name on purpose: names are optional.
  ({ id: productId } = await get(`INSERT INTO products (slug, name_ar, name_en, price, discount_percent, stock)
                                  VALUES ('t', '', '', 50000, 10, 2) RETURNING id`));
});
after(() => closeDb());

const req = (cart) => ({ session: { cart }, user, lang: 'en' });
const stock = async () => (await get('SELECT stock FROM products WHERE id = ?', [productId])).stock;
const rejectsWith = (promise, key) => assert.rejects(promise, (e) => e instanceof OrderError && e.key === key);

test('asking for more than the stock fails and leaves stock untouched', async () => {
  const r = req({ [productId]: 3 });
  await rejectsWith(placeOrder(r), 'checkout.error_changed');
  assert.equal(await stock(), 2);
  assert.equal(r.session.cart[productId], 2, 'cart lowered to what is available');
});

test('a total that changed since the checkout page is refused', async () => {
  await rejectsWith(placeOrder(req({ [productId]: 1 }), 1), 'checkout.error_changed');
  assert.equal(await stock(), 2);
});

test('no neighborhood means no order', async () => {
  const r = { session: { cart: { [productId]: 1 } }, user: { ...user, zone_id: null }, lang: 'en' };
  await rejectsWith(placeOrder(r), 'checkout.choose_zone');
  assert.equal(await stock(), 2);
});

test('placing an order snapshots prices, neighborhood fee and address, and decrements stock', async () => {
  const order = await placeOrder(req({ [productId]: 2 }), 100000);
  assert.match(order.order_no, /^EVA-\d+$/);
  assert.equal(await stock(), 0);
  const saved = await getOrder('id', order.id);
  assert.equal(saved.delivery_fee, 10000, 'Mohandessin delivery fee');
  assert.equal(saved.total, 100000);
  assert.equal(saved.discount_total, 10000);
  assert.equal(saved.zone_id, zone.id);
  assert.equal(saved.village, 'المهندسين');
  assert.equal(saved.city, 'الجيزة');
  assert.equal(saved.apartment_no, '2');
  assert.deepEqual([saved.location_lat, saved.location_lng, saved.location_label], [30.0561, 31.2003, 'شارع الأربعين، المهندسين'], 'map location copied');
  assert.equal(saved.items[0].final_unit_price, 45000);
  assert.equal(saved.items[0].name_en, '', 'unnamed tarha stays unnamed');
  assert.equal(saved.items[0].name_ar, '');
  assert.equal(saved.status, 'processing');
  assert.ok(saved.created_at instanceof Date);

  // Later price changes don't touch the past order.
  await run('UPDATE products SET price = 99900 WHERE id = ?', [productId]);
  assert.equal((await getOrder('id', order.id)).items[0].unit_price, 50000);
});

test('a sold-out product cannot be ordered', async () => {
  await rejectsWith(placeOrder(req({ [productId]: 1 })), 'checkout.error_empty');
});

test('two customers racing for the last piece: only one gets it', async () => {
  await run('UPDATE products SET stock = 1, price = 50000 WHERE id = ?', [productId]);
  const results = await Promise.allSettled([
    placeOrder(req({ [productId]: 1 }), 55000),
    placeOrder(req({ [productId]: 1 }), 55000),
  ]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(await stock(), 0);
});

test('status changes are recorded; Delivered creates a rating token', async () => {
  const { id } = await get('SELECT id FROM orders ORDER BY id DESC LIMIT 1');
  assert.equal(await setOrderStatus(id, 'processing'), false, 'same status is a no-op');
  assert.equal(await setOrderStatus(id, 'shipped'), true);
  assert.equal(await setOrderStatus(id, 'delivered'), true);
  const order = await getOrder('id', id);
  assert.ok(order.rating_token && order.rating_token.length >= 20);
  assert.deepEqual(order.history.map((h) => h.status), ['processing', 'shipped', 'delivered']);
  await assert.rejects(setOrderStatus(id, 'cancelled'), OrderError);
});

test('switched-on offers apply at checkout and are recorded on the order', async () => {
  // The two starting offers exist but are off: free delivery over 1,000 EGP, buy 3 get the 4th free.
  const seeded = await get("SELECT COUNT(*)::int AS n, SUM(is_active)::int AS on_ FROM offers");
  assert.deepEqual([seeded.n, seeded.on_], [2, 0]);
  const { id } = await get("INSERT INTO products (slug, name_ar, name_en, price, stock) VALUES ('offer-t', 'عرض', 'Offer', 30000, 10) RETURNING id");
  await run('UPDATE offers SET is_active = 1');
  invalidateOffers();
  try {
    // 4 × 300 = 1,200 EGP; one free → 900, under 1,000, so delivery (100) is charged.
    const order = await placeOrder(req({ [id]: 4 }), 100000);
    const saved = await getOrder('id', order.id);
    assert.equal(saved.offer_discount, 30000);
    assert.equal(saved.delivery_fee, 10000);
    assert.equal(saved.total, 100000);
    assert.deepEqual(saved.offers.map((o) => [o.type, o.amount]), [['buy_get', 30000]]);
    // 5 pieces: 1,500 - 300 = 1,200 ≥ 1,000, so delivery is free too.
    const second = await getOrder('id', (await placeOrder(req({ [id]: 5 }), 120000)).id);
    assert.equal(second.delivery_fee, 0);
    assert.deepEqual(second.offers.map((o) => [o.type, o.amount]), [['buy_get', 30000], ['free_delivery', 10000]]);
  } finally {
    await run('UPDATE offers SET is_active = 0');
    invalidateOffers();
  }
});
