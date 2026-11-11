import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Tiny limits so they are reached quickly; a throwaway in-memory database and outbox.
Object.assign(process.env, {
  DATABASE_URL: '',
  PGLITE_DIR: 'memory://code-limits-test',
  SMTP_HOST: '',
  BREVO_API_KEY: '', // never send real email from a test, whatever .env holds
  OUTBOX_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'eva-limits-')),
  NODE_ENV: 'development',
  AUTH_RATE_LIMIT: '100',
  CODE_SEND_LIMIT: '2',
  CODE_EMAILS_PER_DAY: '3',
});
const { closeDb } = await import('../src/lib/db.js');
const { sendLoginCode, sendSetupCode } = await import('../src/services/login-codes.js');
const { app } = await import('../src/app.js');

const server = app.listen(0);
const BASE = `http://127.0.0.1:${server.address().port}`;
after(async () => {
  await new Promise((r) => server.close(r));
  await closeDb();
  fs.rmSync(process.env.OUTBOX_DIR, { recursive: true, force: true });
});

test("the store-wide daily cap stops customer codes, never the owner's", async () => {
  for (const n of [1, 2, 3]) assert.deepEqual(await sendLoginCode(`cap${n}@example.com`, 'en'), { email: `cap${n}@example.com` });
  assert.deepEqual(await sendLoginCode('cap4@example.com', 'en'), { error: 'code.busy' });
  // The owner confirming an inbox for their own codes isn't counted against customers.
  assert.equal((await sendSetupCode('owner-inbox@example.com', 'en')).email, 'owner-inbox@example.com');
});

test('one visitor asking for codes again and again is cut off (429)', async () => {
  const page = await fetch(`${BASE}/account/login`);
  const cookie = page.headers.get('set-cookie').split(';')[0];
  const csrf = /<meta name="csrf-token" content="([^"]+)"/.exec(await page.text())[1];
  const send = (email) => fetch(`${BASE}/account/code/send`, {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ _csrf: csrf, email, back: '/account/login' }),
    redirect: 'manual',
  });
  assert.equal((await send('one@example.com')).status, 302);
  assert.equal((await send('two@example.com')).status, 302);
  assert.equal((await send('three@example.com')).status, 429, 'the third code in an hour from one visitor waits');
});
