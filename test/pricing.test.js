import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeTotals, finalUnitPrice, formatMoney, toPiasters } from '../src/pricing.js';

test('discounted unit price is rounded to the piaster and capped at 90%', () => {
  assert.equal(finalUnitPrice(65000, 20), 52000);
  assert.equal(finalUnitPrice(33333, 15), 28333);
  assert.equal(finalUnitPrice(45000, 0), 45000);
  assert.equal(finalUnitPrice(10000, 95), 1000);
  assert.equal(finalUnitPrice(10000, -5), 10000);
});

test('cart totals include discount and delivery', () => {
  const lines = [
    { price: 65000, discount_percent: 20, qty: 2 },
    { price: 65000, discount_percent: 0, qty: 1 },
  ];
  assert.deepEqual(computeTotals(lines, 5000), {
    subtotal: 195000, discount_total: 26000, delivery_fee: 5000, delivery_known: true, total: 174000, item_count: 3,
  });
  assert.equal(computeTotals([], 5000).total, 0, 'no delivery fee on an empty cart');
  // Neighborhood not chosen yet: no fee added, and the cart says delivery depends on it.
  const pending = computeTotals(lines, null);
  assert.equal(pending.delivery_known, false);
  assert.equal(pending.total, 169000);
});

test('owner-typed prices are parsed exactly', () => {
  assert.equal(toPiasters('450'), 45000);
  assert.equal(toPiasters('450.5'), 45050);
  assert.equal(toPiasters('1,250.00'), 125000);
  assert.equal(toPiasters(' 0.99 '), 99);
  for (const bad of ['', 'abc', '-5', '1.234', '1e3', '12345678']) assert.equal(toPiasters(bad), null, bad);
});

test('money formatting per language', () => {
  assert.equal(formatMoney(169000, 'en'), 'EGP 1,690.00');
  assert.equal(formatMoney(169000, 'ar'), '1,690.00 ج.م');
});
