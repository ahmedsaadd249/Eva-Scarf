import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import nodemailer from 'nodemailer';
import { config, ROOT } from './config.js';
import { waitUntil } from '@vercel/functions';
import { run } from './db.js';

const smtpReady = Boolean(config.smtp.host && config.smtp.user && config.smtp.pass);

const transport = smtpReady
  ? nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.port === 465,
      auth: { user: config.smtp.user, pass: config.smtp.pass },
    })
  : null;

// Builds the real MIME message without sending it; used for the local outbox.
const previewTransport = nodemailer.createTransport({ streamTransport: true, buffer: true, newline: 'windows' });

export const LOGO_CID = 'logo@evascarf';
const LOGO_PATH = path.join(ROOT, 'public', 'brand', 'email-monogram.png');

export function isSmtpConfigured() {
  return smtpReady;
}

/** Map a stored image path (/uploads/x.jpg, /samples/x.jpg, https://…) to something Nodemailer can attach. */
export function imageSource(webPath) {
  if (!webPath) return null;
  if (/^https?:\/\//.test(webPath)) return webPath;
  const disk = webPath.startsWith('/uploads/')
    ? path.join(config.uploadsDir, path.basename(webPath))
    : path.join(ROOT, 'public', path.normalize(webPath).replace(/^([/\\])+/, ''));
  return fs.existsSync(disk) ? disk : null;
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

  // Browser preview: point cid: images at the files on disk.
  let preview = message.html;
  for (const a of message.attachments ?? []) {
    if (!a.cid) continue;
    const src = /^https?:/.test(a.path) ? a.path : pathToFileURL(a.path).href;
    preview = preview.split(`cid:${a.cid}`).join(src);
  }
  // The note goes after the doctype; anything before it would put browsers in quirks mode.
  const note = `<!-- To: ${message.to} | Subject: ${message.subject} -->`;
  fs.writeFileSync(`${base}.html`, preview.replace(/^\s*(<!doctype html>)/i, `$1\n${note}`));
  return `${base}.html`;
}

/**
 * Send an email. Without SMTP settings the message is written to ./outbox
 * (.eml with inline images + .html preview) so every flow can be tested locally.
 */
export async function sendMail({ to, subject, html, attachments = [], type = 'generic' }) {
  const message = {
    from: config.mailFrom,
    to,
    subject,
    html,
    text: htmlToText(html),
    attachments: [{ filename: 'eva-scarf.png', path: LOGO_PATH, cid: LOGO_CID }, ...attachments],
  };
  try {
    if (transport) {
      await transport.sendMail(message);
    } else {
      const file = await writeToOutbox(message, type);
      console.log(`[mail] SMTP not configured, saved ${type} email to ${path.relative(ROOT, file)}`);
    }
    await run("INSERT INTO email_log (to_addr, type, status) VALUES (?, ?, 'sent')", [to, type]);
    return true;
  } catch (err) {
    console.error(`[mail] ${type} to ${to} failed:`, err.message);
    await run("INSERT INTO email_log (to_addr, type, status, error) VALUES (?, ?, 'failed', ?)", [to, type, String(err.message).slice(0, 500)])
      .catch((logErr) => console.error('[mail] could not log failure:', logErr.message));
    return false;
  }
}

/**
 * Send in the background: the page response never waits for the mail server.
 * On Vercel, waitUntil keeps the function alive until the email is sent (otherwise it would be
 * frozen as soon as the response goes out); elsewhere the promise simply runs to completion.
 */
export function queueMail(build) {
  const job = Promise.resolve()
    .then(build)
    .catch((err) => console.error('[mail] could not build email:', err));
  waitUntil(job);
  return job;
}
