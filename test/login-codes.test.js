import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// A throwaway in-memory Postgres and outbox; must be set before the app modules are imported.
process.env.DATABASE_URL = '';
process.env.PGLITE_DIR = 'memory://login-codes-test';
process.env.SMTP_HOST = '';
process.env.BREVO_API_KEY = ''; // never send real email from a test, whatever .env holds
process.env.OUTBOX_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'eva-codes-'));
const { closeDb, get, run } = await import('../src/lib/db.js');
const {
  cleanCode, maskEmail, sendLoginCode, sendOwnerCode, sendSetupCode, verifyLoginCode, verifyOwnerCode, verifySetupCode, MAX_ATTEMPTS,
} = await import('../src/services/login-codes.js');
after(async () => {
  await closeDb();
  fs.rmSync(process.env.OUTBOX_DIR, { recursive: true, force: true });
});

const codeFiles = (email, type) => fs.readdirSync(process.env.OUTBOX_DIR).filter((f) => f.endsWith(`-${type}-${email}.html`)).sort();

/** The code in email number `nth` (1 = the first) of `type` to `email` (the database only has its hash). */
async function emailedCode(email, nth = 1, type = 'login-code') {
  for (let i = 0; i < 50; i++) {
    const file = codeFiles(email, type)[nth - 1];
    if (file) return /letter-spacing:10px[^>]*>(\d{6})</.exec(fs.readFileSync(path.join(process.env.OUTBOX_DIR, file), 'utf8'))[1];
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`no code emailed to ${email}`);
}

test('cleanCode: six digits, Arabic digits and spaces allowed', () => {
  assert.equal(cleanCode('123456'), '123456');
  assert.equal(cleanCode(' ١٢٣ ٤٥٦ '), '123456');
  for (const bad of ['12345', '1234567', 'abcdef', '', null, '12 34 5x']) assert.equal(cleanCode(bad), null, String(bad));
});

test('a code is emailed and stored only as a hash; the right code creates the customer, without a password', async () => {
  const sent = await sendLoginCode('  New@Example.com ', 'en');
  assert.deepEqual(sent, { email: 'new@example.com' });
  const code = await emailedCode('new@example.com');
  const row = await get('SELECT * FROM login_codes WHERE email = ?', ['new@example.com']);
  assert.notEqual(row.code_hash, code);
  assert.ok(!JSON.stringify(row).includes(code));
  const { user, error } = await verifyLoginCode('NEW@example.com', code, 'en');
  assert.equal(error, undefined);
  assert.equal(user.email, 'new@example.com');
  assert.equal(user.password_hash, null);
  assert.equal(user.role, 'customer');
  assert.equal(user.lang, 'en');
  assert.deepEqual(await verifyLoginCode('new@example.com', code, 'en'), { error: 'code.expired' }, 'a code works once');
});

test('an existing customer gets the same account back', async () => {
  const before = await get("INSERT INTO users (email, full_name, phone_primary) VALUES ('back@example.com', 'Back', '0912345678') RETURNING *");
  await sendLoginCode('back@example.com', 'ar');
  const { user } = await verifyLoginCode('back@example.com', await emailedCode('back@example.com'), 'ar');
  assert.equal(user.id, before.id);
  assert.equal(user.full_name, 'Back');
});

test(`a wrong code counts; after ${MAX_ATTEMPTS} wrong tries the right one stops working`, async () => {
  await sendLoginCode('tries@example.com', 'ar');
  const code = await emailedCode('tries@example.com');
  const wrong = code === '000000' ? '111111' : '000000';
  for (let i = 1; i < MAX_ATTEMPTS; i++) assert.deepEqual(await verifyLoginCode('tries@example.com', wrong), { error: 'code.wrong' });
  assert.deepEqual(await verifyLoginCode('tries@example.com', wrong), { error: 'code.expired' }, 'the last try kills it');
  assert.deepEqual(await verifyLoginCode('tries@example.com', code), { error: 'code.expired' });
  assert.equal(await get("SELECT 1 FROM users WHERE email = 'tries@example.com'"), null);
});

test('an expired code is refused', async () => {
  await sendLoginCode('late@example.com', 'ar');
  const code = await emailedCode('late@example.com');
  await run("UPDATE login_codes SET expires_at = ? WHERE email = 'late@example.com'", [Date.now() - 1]);
  assert.deepEqual(await verifyLoginCode('late@example.com', code), { error: 'code.expired' });
});

test('no second code within a minute; after that a new code replaces the old one', async () => {
  await sendLoginCode('again@example.com', 'ar');
  const first = await emailedCode('again@example.com');
  assert.deepEqual(await sendLoginCode('again@example.com', 'ar'), { email: 'again@example.com', wait: true });
  assert.equal((await get("SELECT COUNT(*)::int AS n FROM login_codes WHERE email = 'again@example.com'")).n, 1);
  await run("UPDATE login_codes SET expires_at = expires_at - 61000 WHERE email = 'again@example.com'"); // a minute later
  await new Promise((r) => setTimeout(r, 5)); // a later file name in the outbox
  await sendLoginCode('again@example.com', 'ar');
  const second = await emailedCode('again@example.com', 2);
  if (second !== first) assert.deepEqual(await verifyLoginCode('again@example.com', first), { error: 'code.wrong' }, 'only the newest code works');
  assert.ok((await verifyLoginCode('again@example.com', second)).user);
});

test("bad emails are refused; the owner's email gets the usual answer but no code", async () => {
  assert.deepEqual(await sendLoginCode('no-at-sign', 'ar'), { error: 'errors.email_invalid' });
  assert.deepEqual(await sendLoginCode('', 'ar'), { error: 'errors.required' });
  await run("INSERT INTO users (email, password_hash, full_name, role) VALUES ('boss@example.com', 'x', 'Boss', 'admin')");
  assert.deepEqual(await sendLoginCode('boss@example.com', 'ar'), { email: 'boss@example.com' }, 'same answer as anyone else');
  assert.equal(await get("SELECT 1 FROM login_codes WHERE email = 'boss@example.com'"), null);
});

test('at most 5 codes an hour for one email (so codes cannot be guessed by asking again and again)', async () => {
  for (let i = 0; i < 5; i++) {
    assert.deepEqual(await sendLoginCode('busy@example.com', 'ar'), { email: 'busy@example.com' });
    await run("UPDATE login_codes SET expires_at = expires_at - 61000 WHERE email = 'busy@example.com'"); // a minute passes
  }
  assert.deepEqual(await sendLoginCode('busy@example.com', 'ar'), { error: 'code.too_many' });
  await run("UPDATE login_codes SET created_at = now() - interval '61 minutes' WHERE email = 'busy@example.com'"); // an hour later
  assert.deepEqual(await sendLoginCode('busy@example.com', 'ar'), { email: 'busy@example.com' });
});

test("the owner's codes and customers' codes never mix", async () => {
  const owner = { otp_email: 'mix@example.com' };
  assert.deepEqual(await sendOwnerCode(owner, 'ar'), { email: 'mix@example.com' });
  const ownerCode = await emailedCode('mix@example.com', 1, 'owner-code');
  assert.deepEqual(await verifyLoginCode('mix@example.com', ownerCode, 'ar'), { error: 'code.expired' }, 'an owner code signs no customer in');
  assert.equal(await get("SELECT 1 FROM users WHERE email = 'mix@example.com'"), null);
  // A customer code to the same address neither replaces nor unlocks the owner's code.
  await sendLoginCode('mix@example.com', 'ar');
  const customerCode = await emailedCode('mix@example.com');
  if (customerCode !== ownerCode) assert.equal(await verifyOwnerCode(owner, customerCode), 'code.wrong');
  assert.equal(await verifyOwnerCode(owner, ownerCode), null, 'the owner code still works');
  assert.equal(await verifyOwnerCode(owner, ownerCode), 'code.expired', 'once');
  assert.ok((await verifyLoginCode('mix@example.com', customerCode, 'ar')).user, 'and the customer code is untouched');
});

test('confirming an inbox for the owner: its own code, refused for sign-in', async () => {
  assert.deepEqual(await sendSetupCode('no-at-sign', 'ar'), { error: 'errors.email_invalid' });
  assert.deepEqual(await sendSetupCode(' Box@Example.com ', 'ar'), { email: 'box@example.com' });
  const code = await emailedCode('box@example.com', 1, 'owner-setup');
  assert.equal(await verifyOwnerCode({ otp_email: 'box@example.com' }, code), 'code.expired', 'a setup code is not a sign-in code');
  assert.equal(await verifySetupCode('box@example.com', code), null);
  assert.equal(await verifySetupCode('box@example.com', code), 'code.expired', 'once');
});

test('maskEmail shows just enough to recognise the inbox', () => {
  assert.equal(maskEmail('aljaly440@gmail.com'), 'a•••0@gmail.com');
  assert.equal(maskEmail('ab@x.com'), 'a•••@x.com');
});
