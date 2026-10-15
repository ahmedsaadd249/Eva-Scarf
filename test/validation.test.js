import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  emailError, isProfileComplete, normalizePhone, passwordChecks, passwordError, toLatinDigits, validateProfile,
} from '../public/js/validation.js';

test('email must be present and well-formed', () => {
  assert.equal(emailError(''), 'errors.required');
  assert.equal(emailError('no-at-sign.com'), 'errors.email_invalid');
  assert.equal(emailError('a@b'), 'errors.email_invalid');
  assert.equal(emailError('a b@c.com'), 'errors.email_invalid');
  assert.equal(emailError('amna@@mail.com'), 'errors.email_invalid');
  assert.equal(emailError('a@b.c'), 'errors.email_invalid');
  assert.equal(emailError('a@b.co'), null);
  assert.equal(emailError('amna.osman+tarha@mail.example.com'), null);
});

test('password needs length, upper, lower, digit and symbol', () => {
  assert.equal(passwordError(''), 'errors.required');
  assert.equal(passwordError('abc'), 'errors.password_weak');
  assert.equal(passwordError('password1!'), 'errors.password_weak'); // no uppercase
  assert.equal(passwordError('Password1'), 'errors.password_weak'); // no symbol
  assert.equal(passwordError('Pa1!'), 'errors.password_weak'); // too short
  assert.equal(passwordError('Tarha#2026'), null);
  assert.equal(passwordError('A1!' + 'a'.repeat(130)), 'errors.password_too_long');
  assert.deepEqual(passwordChecks('Ab1'), { length: false, upper: true, lower: true, digit: true, symbol: false });
});

test('Arabic-Indic digits are converted', () => {
  assert.equal(toLatinDigits('٠٩١٢٣٤٥٦٧٨'), '0912345678');
  assert.equal(normalizePhone('+249 (91) 234-5678'), '+249912345678');
});

const fullProfile = {
  full_name: 'Amna Osman', zone_id: '3', street: 'Al Arbaeen',
  building_no: '14', apartment_no: '3', phone_primary: '0912345678', phone_secondary: '01012345678',
};

test('profile requires a neighborhood, every address part and both phones', () => {
  assert.deepEqual(validateProfile(fullProfile).errors, {});
  assert.equal(validateProfile(fullProfile).values.zone_id, 3);
  assert.equal(validateProfile({ ...fullProfile, zone_id: '' }).errors.zone_id, 'errors.zone_required');
  assert.equal(validateProfile({ ...fullProfile, zone_id: 'abc' }).errors.zone_id, 'errors.zone_required');
  for (const field of ['street', 'building_no', 'apartment_no', 'phone_primary', 'phone_secondary']) {
    const { errors } = validateProfile({ ...fullProfile, [field]: '  ' });
    assert.equal(errors[field], 'errors.required', field);
  }
  assert.equal(validateProfile({ ...fullProfile, full_name: 'A' }).errors.full_name, 'errors.name_required');
});

test('phones are validated and the secondary must differ', () => {
  assert.equal(validateProfile({ ...fullProfile, phone_primary: '12ab' }).errors.phone_primary, 'errors.phone_invalid');
  assert.equal(validateProfile({ ...fullProfile, phone_primary: '1234567' }).errors.phone_primary, 'errors.phone_invalid');
  assert.equal(validateProfile({ ...fullProfile, phone_secondary: '091-234-5678' }).errors.phone_secondary, 'errors.phone_same');
  assert.equal(validateProfile({ ...fullProfile, phone_secondary: '12ab' }).errors.phone_secondary, 'errors.phone_invalid');
  const ok = validateProfile({ ...fullProfile, phone_secondary: '٠١٠١٢٣٤٥٦٧٨' });
  assert.deepEqual(ok.errors, {});
  assert.equal(ok.values.phone_secondary, '01012345678');
});

test('profile completeness', () => {
  assert.equal(isProfileComplete(fullProfile), true);
  assert.equal(isProfileComplete({ ...fullProfile, apartment_no: null }), false);
  assert.equal(isProfileComplete({ ...fullProfile, phone_secondary: null }), false);
  assert.equal(isProfileComplete({ ...fullProfile, zone_id: null }), false);
  assert.equal(isProfileComplete(null), false);
});
