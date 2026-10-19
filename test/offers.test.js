import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.DATABASE_URL = '';
process.env.PGLITE_DIR = 'memory://offers-test';
const { validateOffer } = await import('../src/offers.js');
const { offerLabel } = await import('../src/i18n.js');

test('free delivery needs a minimum in pounds', () => {
  assert.deepEqual(validateOffer({ type: 'free_delivery', min_subtotal: '1,000' }).values.min_subtotal, 100000);
  assert.equal(validateOffer({ type: 'free_delivery', min_subtotal: '' }).errors.min_subtotal, 'errors.offer_min_required');
  assert.equal(validateOffer({ type: 'free_delivery', min_subtotal: 'abc' }).errors.min_subtotal, 'errors.offer_min_required');
});

test('buy X, get Y free needs whole numbers from 1 to 20', () => {
  const ok = validateOffer({ type: 'buy_get', buy_qty: '3', get_qty: '1', min_subtotal: '500', percent: '50' });
  assert.deepEqual(ok.errors, {});
  assert.deepEqual([ok.values.buy_qty, ok.values.get_qty, ok.values.min_subtotal, ok.values.percent], [3, 1, 0, null], 'other kinds\' fields cleared');
  for (const [buy, get] of [['0', '1'], ['3', '0'], ['21', '1'], ['2.5', '1'], ['', '1'], ['-1', '1']]) {
    const { errors } = validateOffer({ type: 'buy_get', buy_qty: buy, get_qty: get });
    assert.ok(errors.buy_qty || errors.get_qty, `${buy}/${get}`);
  }
});

test('percentage off: 1–90, minimum optional', () => {
  const all = validateOffer({ type: 'order_percent', percent: '10', min_subtotal: '' });
  assert.deepEqual(all.errors, {});
  assert.equal(all.values.min_subtotal, 0);
  assert.equal(validateOffer({ type: 'order_percent', percent: '10', min_subtotal: '1500.50' }).values.min_subtotal, 150050);
  assert.equal(validateOffer({ type: 'order_percent', percent: '95' }).errors.percent, 'errors.offer_percent');
  assert.equal(validateOffer({ type: 'order_percent', percent: '10', min_subtotal: '1.234' }).errors.min_subtotal, 'errors.offer_min_invalid');
});

test('unknown kinds are refused; names are trimmed; the switch is on only when ticked', () => {
  assert.equal(validateOffer({ type: 'secret_deal' }).errors.type, 'errors.offer_type');
  const v = validateOffer({ type: 'free_delivery', min_subtotal: '1000', name_ar: '  عرض   العيد ', is_active: '1' }).values;
  assert.equal(v.name_ar, 'عرض العيد');
  assert.equal(v.is_active, 1);
  assert.equal(validateOffer({ type: 'free_delivery', min_subtotal: '1000' }).values.is_active, 0);
});

test('offers get a readable name in each language when none is written', () => {
  assert.equal(offerLabel({ type: 'buy_get', buy_qty: 3, get_qty: 1 }, 'en'), 'Buy ⁨3⁩, get ⁨1⁩ free');
  assert.match(offerLabel({ type: 'free_delivery', min_subtotal: 100000 }, 'ar'), /توصيل مجاني للطلبات فوق .*1,000\.00 ج\.م/);
  assert.match(offerLabel({ type: 'order_percent', percent: 10, min_subtotal: 0 }, 'en'), /10.*% off every order/);
  assert.equal(offerLabel({ type: 'buy_get', buy_qty: 3, get_qty: 1, name_en: 'Eid deal' }, 'en'), 'Eid deal');
});
