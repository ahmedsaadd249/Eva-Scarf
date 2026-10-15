import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

// A throwaway in-memory Postgres; must be set before the app modules are imported.
process.env.DATABASE_URL = '';
process.env.PGLITE_DIR = 'memory://orders-test';
const { closeDb, get, run } = await import('../src/db.js');
const { placeOrder, setOrderStatus, getOrder, OrderError } = await import('../src/orders.js');

let user;
let productId;
let zone;

before(async () => {
  // The default neighborhoods are inserted on first start; Mohandessin is priced at 100 EGP.
  zone = await get("SELECT * FROM zones WHERE name_en = 'Mohandessin'");
  user = await get(`INSERT INTO users (email, password_hash, full_name, phone_primary, phone_secondary, zone_id, street, building_no, apartment_no)
                    VALUES ('t@example.com', 'x', 'Test Customer', '0912345678', '0101234567', ?, 'Street 15', '7', '2') RETURNING *`, [zone.id]);
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
