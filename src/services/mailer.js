// Sending email, three ways:
// - Brevo's HTTP API when BREVO_API_KEY is set. This is what Cloudflare must use: a Worker's SMTP
//   connection to Brevo gets closed before anything is sent ("Connection closed unexpectedly").
// - SMTP (Nodemailer) when SMTP_HOST / SMTP_USER / SMTP_PASS are set: fine from Node (local, scripts).
// - Otherwise the message is saved to ./outbox (.eml + .html preview) so every flow can be tested locally.
// Every attempt is written to the email_log table (Dashboard → Settings shows the latest).
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import nodemailer from 'nodemailer';
import { config, ROOT } from '../config/index.js';
import * as emailLogRepo from '../repositories/email-log.js';
import { keepAlive, readBinary } from '../lib/platform.js';

const ERROR_TEXT_MAX = 500; // characters of a failure kept in the email log
const BREVO_API_URL = 'https://api.brevo.com/v3/smtp/email';
const BREVO_TIMEOUT_MS = 15_000;

const brevoReady = Boolean(config.brevoApiKey);
const smtpReady = Boolean(config.smtp.host && config.smtp.user && config.smtp.pass);

const transport = !brevoReady && smtpReady
  ? nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.port === 465,
      auth: { user: config.smtp.user, pass: config.smtp.pass },
    })
  : null;

if (config.onCloudflare && !brevoReady) {
  console.warn('[mail] BREVO_API_KEY is not set: emails go over SMTP, which Cloudflare Workers cannot use. Add the key with `npx wrangler secret put BREVO_API_KEY`.');
}

// Builds the real MIME message without sending it; used for the local outbox.
const previewTransport = nodemailer.createTransport({ streamTransport: true, buffer: true, newline: 'windows' });

export const LOGO_CID = 'logo@evascarf';
export const LOGO_PATH = '/brand/email-monogram.png'; // under public/, so also at baseUrl + LOGO_PATH
let logo = null; // the logo's bytes, read once (from disk, or from the Worker's bundle)
const logoBytes = () => (logo ??= readBinary(`public${LOGO_PATH}`));

/**
 * Brevo's API can't carry images inside the message (no cid: attachments), so emails sent through it
 * link to the logo and product photos on the web instead. SMTP and the outbox embed them.
 */
export const embedsImages = !brevoReady;

/** True when emails are really sent (Brevo API or SMTP), false when they're saved to the outbox. */
export function isSmtpConfigured() {
  return brevoReady || smtpReady;
}

/** The latest emails sent or failed, newest first (Dashboard → Settings). */
export const recentEmails = (limit) => emailLogRepo.listLatest(limit);

/** Map a stored image path (/uploads/x.jpg, /samples/x.jpg, https://…) to something Nodemailer can attach. */
export function imageSource(webPath) {
  if (!webPath) return null;
  if (/^https?:\/\//.test(webPath)) return webPath;
  const disk = webPath.startsWith('/uploads/')
    ? path.join(config.uploadsDir, path.basename(webPath))
    : path.join(ROOT, 'public', path.normalize(webPath).replace(/^([/\\])+/, ''));
  return fs.existsSync(disk) ? disk : null;
}

/** The web address of a stored image, for emails that link to images instead of embedding them. */
export function imageUrl(webPath) {
  if (!webPath) return null;
  return /^https?:\/\//.test(webPath) ? webPath : `${config.baseUrl}${webPath.startsWith('/') ? '' : '/'}${webPath}`;
}

function htmlToText(html) {
  return html
    .replace(/<(style|head)[\s\S]*?<\/\1>/gi, '')
    .replace(/<a [^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, '$2 ($1)')
    .replace(/<(br|\/p|\/tr|\/h\d|\/div)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n\s*\n+/g, '\n\n')
    .trim();
}

async function writeToOutbox(message, type) {
  fs.mkdirSync(config.outboxDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const base = path.join(config.outboxDir, `${stamp}-${type}-${String(message.to).replace(/[^a-z0-9@._-]/gi, '_')}`);

  const { message: eml } = await previewTransport.sendMail(message);
  fs.writeFileSync(`${base}.eml`, eml);

  // Browser preview: point cid: images at the files on disk (or embed them when they're bytes).
  let preview = message.html;
  for (const a of message.attachments ?? []) {
    if (!a.cid) continue;
    const src = a.content ? `data:image/png;base64,${Buffer.from(a.content).toString('base64')}`
      : /^https?:/.test(a.path) ? a.path : pathToFileURL(a.path).href;
    preview = preview.split(`cid:${a.cid}`).join(src);
  }
  // The note goes after the doctype; anything before it would put browsers in quirks mode.
  const note = `<!-- To: ${message.to} | Subject: ${message.subject} -->`;
  fs.writeFileSync(`${base}.html`, preview.replace(/^\s*(<!doctype html>)/i, `$1\n${note}`));
  return `${base}.html`;
}

/** "Eva Scarf <shop@example.com>" → { name: 'Eva Scarf', email: 'shop@example.com' }. */
export function parseAddress(address) {
  const match = /^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/.exec(address);
  if (!match) return { email: address.trim() };
  return match[1] ? { name: match[1], email: match[2].trim() } : { email: match[2].trim() };
}

/** Send through Brevo's transactional email API (plain HTTPS, which works everywhere, Cloudflare included). */
async function sendWithBrevoApi(message) {
  const res = await fetch(BREVO_API_URL, {
    method: 'POST',
    headers: { 'api-key': config.brevoApiKey, 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      sender: parseAddress(message.from),
      to: [{ email: message.to }],
      subject: message.subject,
      htmlContent: message.html,
      textContent: message.text,
    }),
    signal: AbortSignal.timeout(BREVO_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Brevo API ${res.status}: ${(await res.text()).slice(0, ERROR_TEXT_MAX)}`);
}

/** The whole reason a send failed: Nodemailer's code and step, and what the mail server answered. */
function describeError(err) {
  const where = [err.code, err.command].filter(Boolean).join(' ');
  const reply = err.response ? ` (server: ${String(err.response).trim()})` : '';
  return `${where ? `[${where}] ` : ''}${err.message}${reply}`;
}

/** Send an email; returns true when it was sent (or saved to the outbox). */
export async function sendMail({ to, subject, html, attachments = [], type = 'generic' }) {
  const message = {
    from: config.mailFrom,
    to,
    subject,
    html,
    text: htmlToText(html),
    attachments: embedsImages
      ? [{ filename: 'eva-scarf.png', content: logoBytes(), contentType: 'image/png', cid: LOGO_CID }, ...attachments]
      : [],
  };
  try {
    if (brevoReady) {
      await sendWithBrevoApi(message);
    } else if (transport) {
      await transport.sendMail(message);
    } else {
      const file = await writeToOutbox(message, type);
      console.log(`[mail] Email sending not configured, saved ${type} email to ${path.relative(ROOT, file)}`);
    }
    await emailLogRepo.logSent(to, type);
    return true;
  } catch (err) {
    const reason = describeError(err).slice(0, ERROR_TEXT_MAX);
    console.error(`[mail] ${type} to ${to} failed:`, reason);
    await emailLogRepo.logFailed(to, type, reason)
      .catch((logErr) => console.error('[mail] could not log failure:', logErr.message));
    return false;
  }
}

/**
 * Send in the background: the page response never waits for the mail server.
 * On Cloudflare, keepAlive keeps the function alive until the email is sent (otherwise it
 * would be stopped as soon as the response goes out); elsewhere the promise simply runs to completion.
 */
export function queueMail(build) {
  const job = Promise.resolve()
    .then(build)
    .catch((err) => console.error('[mail] could not build email:', err));
  return keepAlive(job);
}
