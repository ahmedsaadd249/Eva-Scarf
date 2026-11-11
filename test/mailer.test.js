import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// Brevo's HTTP API (what the Cloudflare Worker uses), with fetch replaced: nothing leaves this computer.
Object.assign(process.env, {
  DATABASE_URL: '',
  PGLITE_DIR: 'memory://mailer-test',
  SMTP_HOST: '',
  BREVO_API_KEY: 'test-key-not-real',
  MAIL_FROM: 'Eva Scarf <shop@example.com>',
  BASE_URL: 'https://shop.example',
});
let calls = [];
let reply = () => new Response(JSON.stringify({ messageId: '<1@smtp-relay.mailin.fr>' }), { status: 201 });
globalThis.fetch = async (url, init) => {
  calls.push({ url: String(url), init, body: JSON.parse(init.body) });
  return reply();
};

const { closeDb, all } = await import('../src/lib/db.js');
const { embedsImages, parseAddress, sendMail } = await import('../src/services/mailer.js');
const { sendLoginCodeEmail } = await import('../src/services/emails.js');
after(() => closeDb());
beforeEach(() => {
  calls = [];
});

const lastLog = async () => (await all('SELECT type, status, error FROM email_log ORDER BY id DESC LIMIT 1'))[0];

test('sender addresses are split into name and email', () => {
  assert.deepEqual(parseAddress('Eva Scarf <shop@example.com>'), { name: 'Eva Scarf', email: 'shop@example.com' });
  assert.deepEqual(parseAddress('"Eva Scarf" <shop@example.com>'), { name: 'Eva Scarf', email: 'shop@example.com' });
  assert.deepEqual(parseAddress('shop@example.com'), { email: 'shop@example.com' });
});

test('with a Brevo API key, email goes to the API over HTTPS and is logged as sent', async () => {
  assert.equal(await sendMail({ to: 'a@example.com', subject: 'Hello', html: '<p>Hi <b>there</b></p>', type: 'test' }), true);
  assert.equal(calls.length, 1);
  const [{ url, init, body }] = calls;
  assert.equal(url, 'https://api.brevo.com/v3/smtp/email');
  assert.equal(init.method, 'POST');
  assert.equal(init.headers['api-key'], 'test-key-not-real');
  assert.deepEqual(body.sender, { name: 'Eva Scarf', email: 'shop@example.com' });
  assert.deepEqual(body.to, [{ email: 'a@example.com' }]);
  assert.equal(body.subject, 'Hello');
  assert.equal(body.htmlContent, '<p>Hi <b>there</b></p>');
  assert.equal(body.textContent, 'Hi there');
  assert.equal(body.attachment, undefined, 'no cid: attachments: the API cannot embed them');
  assert.deepEqual(await lastLog(), { type: 'test', status: 'sent', error: null });
});

test("Brevo's refusal is logged with its reason", async () => {
  reply = () => new Response('{"code":"unauthorized","message":"Key not found"}', { status: 401 });
  try {
    assert.equal(await sendMail({ to: 'b@example.com', subject: 'Hello', html: '<p>Hi</p>', type: 'test' }), false);
  } finally {
    reply = () => new Response('{}', { status: 201 });
  }
  const log = await lastLog();
  assert.equal(log.status, 'failed');
  assert.match(log.error, /^Brevo API 401: .*Key not found/);
});

test('emails sent through the API link the logo on the web instead of embedding it', async () => {
  assert.equal(embedsImages, false);
  await sendLoginCodeEmail('c@example.com', '123456', 'en');
  assert.equal(calls.length, 1);
  const html = calls[0].body.htmlContent;
  assert.ok(html.includes('src="https://shop.example/brand/email-monogram.png"'), 'logo linked on the store');
  assert.ok(!html.includes('cid:'), 'nothing refers to an attachment');
  assert.ok(html.includes('123456'), 'the code is in the email');
});
