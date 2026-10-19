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
    subtotal: 195000, discount_total: 26000, offer_discount: 0, offers: [], delivery_fee: 5000, delivery_known: true,
    free_delivery_gap: null, total: 174000, item_count: 3,
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

// Offers (dashboard → Offers). Prices in piasters: 55000 = 550 EGP.
const freeOver1000 = { id: 1, type: 'free_delivery', min_subtotal: 100000, is_active: 1 };
const buy3get1 = { id: 2, type: 'buy_get', buy_qty: 3, get_qty: 1, is_active: 1 };
const tenPercentOver1500 = { id: 3, type: 'order_percent', percent: 10, min_subtotal: 150000, is_active: 1 };

test('offers that are switched off change nothing', () => {
  const lines = [{ price: 55000, discount_percent: 0, qty: 4 }];
  const off = [freeOver1000, buy3get1, tenPercentOver1500].map((o) => ({ ...o, is_active: 0 }));
  assert.deepEqual(computeTotals(lines, 10000, off), computeTotals(lines, 10000));
});

test('buy 3, get 1 free: the cheapest pieces are free, once per group of 4', () => {
  const mixed = [
    { price: 65000, discount_percent: 0, qty: 2 },
    { price: 38000, discount_percent: 0, qty: 1 },
    { price: 45000, discount_percent: 20, qty: 1 }, // 360 EGP after its own discount
  ];
  const t = computeTotals(mixed, 10000, [buy3get1]);
  assert.equal(t.offer_discount, 36000, 'the cheapest piece (360 after discount) is the free one');
  assert.equal(t.total, 65000 * 2 + 38000 + 36000 - 36000 + 10000);
  assert.equal(t.offers.length, 1);
  assert.equal(t.offers[0].type, 'buy_get');
  assert.equal(t.offers[0].amount, 36000);
  assert.equal(computeTotals([{ price: 55000, discount_percent: 0, qty: 3 }], 10000, [buy3get1]).offer_discount, 0, '3 pieces: nothing free yet');
  assert.equal(computeTotals([{ price: 55000, discount_percent: 0, qty: 8 }], 10000, [buy3get1]).offer_discount, 110000, '8 pieces: 2 free');
  assert.equal(computeTotals([{ price: 55000, discount_percent: 0, qty: 7 }], 10000, [buy3get1]).offer_discount, 55000, '7 pieces: 1 free');
});

test('free delivery from a minimum, counted after the other discounts', () => {
  const two = [{ price: 55000, discount_percent: 0, qty: 2 }]; // 1,100 EGP
  const free = computeTotals(two, 10000, [freeOver1000]);
  assert.equal(free.delivery_fee, 0);
  assert.equal(free.total, 110000);
  assert.deepEqual(free.offers.map((o) => [o.type, o.amount]), [['free_delivery', 10000]], 'records the fee it saved');
  // 4 pieces of 300 = 1,200, minus one free = 900: under 1,000, so delivery is charged.
  const four = computeTotals([{ price: 30000, discount_percent: 0, qty: 4 }], 10000, [freeOver1000, buy3get1]);
  assert.equal(four.offer_discount, 30000);
  assert.equal(four.delivery_fee, 10000);
  assert.equal(four.free_delivery_gap, 10000, '100 EGP more for free delivery');
  // Exactly the minimum counts.
  assert.equal(computeTotals([{ price: 100000, discount_percent: 0, qty: 1 }], 10000, [freeOver1000]).delivery_fee, 0);
  // Free delivery is free even before the neighborhood (and so the fee) is known.
  const unknown = computeTotals(two, null, [freeOver1000]);
  assert.equal(unknown.delivery_known, true);
  assert.equal(unknown.delivery_fee, 0);
  assert.equal(computeTotals([], 10000, [freeOver1000]).free_delivery_gap, null, 'no hint on an empty cart');
});

test('percentage off the order, after "buy, get free", with a minimum', () => {
  const four = [{ price: 55000, discount_percent: 0, qty: 4 }]; // 2,200 - 550 free = 1,650 ≥ 1,500
  const t = computeTotals(four, 10000, [buy3get1, tenPercentOver1500]);
  assert.deepEqual(t.offers.map((o) => [o.type, o.amount]), [['buy_get', 55000], ['order_percent', 16500]]);
  assert.equal(t.offer_discount, 71500);
  assert.equal(t.total, 220000 - 71500 + 10000);
  assert.equal(computeTotals([{ price: 55000, discount_percent: 0, qty: 2 }], 10000, [tenPercentOver1500]).offer_discount, 0, 'under the minimum');
  const everyOrder = { ...tenPercentOver1500, min_subtotal: 0 };
  assert.equal(computeTotals([{ price: 33333, discount_percent: 0, qty: 1 }], 0, [everyOrder]).offer_discount, 3333, 'rounded to the piaster');
});

test('of several offers of the same kind, the best one for the customer applies', () => {
  const lines = [{ price: 50000, discount_percent: 0, qty: 6 }];
  const buy2get1 = { id: 4, type: 'buy_get', buy_qty: 2, get_qty: 1, is_active: 1 };
  const t = computeTotals(lines, 10000, [buy3get1, buy2get1]);
  assert.equal(t.offer_discount, 100000, 'buy 2 get 1 frees 2 pieces of 6; buy 3 get 1 only 1');
  assert.equal(t.offers[0].id, 4);
  const free800 = { ...freeOver1000, id: 5, min_subtotal: 80000 };
  const gap = computeTotals([{ price: 70000, discount_percent: 0, qty: 1 }], 10000, [freeOver1000, free800]);
  assert.equal(gap.free_delivery_gap, 10000, 'the hint uses the nearest minimum');
});
