import path from 'node:path';
import { config } from '../config/index.js';
import { helpersFor, LANGS } from '../lib/i18n.js';
import {
  embedsImages, imageSource, imageUrl, LOGO_CID, LOGO_PATH, queueMail, sendMail,
} from './mailer.js';
import { getOrder } from './orders.js';
import { renderTemplate } from '../lib/templates.js';
import { allZones, formatAddress } from './zones.js';
import * as userRepo from '../repositories/users.js';

const FONTS = {
  ar: { body: "Tahoma,'Segoe UI',Arial,sans-serif", display: "'Traditional Arabic','Times New Roman',serif", displayStyle: '' },
  en: { body: "'Helvetica Neue',Arial,sans-serif", display: "Georgia,'Times New Roman',serif", displayStyle: 'font-style:italic;' },
};

async function render(template, data) {
  const lang = LANGS.includes(data.lang) ? data.lang : 'ar';
  const h = helpersFor(lang);
  const zones = await allZones();
  const locals = {
    ...h,
    ...data,
    lang,
    baseUrl: config.baseUrl,
    // Embedded with the message (cid:), or linked on the web when the sender can't embed images.
    logoSrc: embedsImages ? `cid:${LOGO_CID}` : imageUrl(LOGO_PATH),
    align: h.dir === 'rtl' ? 'right' : 'left',
    alignEnd: h.dir === 'rtl' ? 'left' : 'right',
    address: (record) => formatAddress(record, lang, zones),
    bodyFont: FONTS[lang].body,
    displayFont: FONTS[lang].display,
    displayStyle: FONTS[lang].displayStyle,
  };
  const body = renderTemplate(`emails/${template}`, locals);
  return renderTemplate('emails/_layout', { ...locals, body });
}

/**
 * Each order item's photo for the email (item.imgSrc): attached and shown inline where the sender can embed
 * images, so it shows even when the site isn't public; otherwise linked on the web. Returns the attachments.
 */
function itemImages(order) {
  const attachments = [];
  order.items.forEach((item, i) => {
    if (!embedsImages) {
      item.imgSrc = imageUrl(item.image);
      return;
    }
    const src = imageSource(item.image);
    if (!src) return;
    const cid = `item${i}@evascarf`;
    item.imgSrc = `cid:${cid}`;
    const ext = path.extname(String(item.image).split('?')[0]) || '.jpg';
    attachments.push({ filename: `tarha-${i + 1}${ext}`, path: src, cid });
  });
  return attachments;
}

/** Emails go out in the customer's current language, falling back to the language they ordered in. */
async function orderLang(order) {
  const user = order.user_id ? await userRepo.findById(order.user_id) : null;
  return user?.lang || order.lang;
}

export function sendWelcomeEmail(user) {
  return queueMail(async () => {
    const lang = user.lang;
    const subject = helpersFor(lang).t('email.welcome.subject');
    const html = await render('welcome', { lang, subject, user });
    await sendMail({ to: user.email, subject, html, type: 'welcome' });
  });
}

export function sendOrderConfirmation(orderId) {
  return queueMail(async () => {
    const order = await getOrder('id', orderId);
    const lang = await orderLang(order);
    const attachments = itemImages(order);
    const subject = helpersFor(lang).t('email.order.subject', { no: order.order_no });
    const html = await render('order-confirmation', { lang, subject, order });
    await sendMail({ to: order.customer_email, subject, html, attachments, type: 'order-confirmation' });
  });
}

export function sendStatusEmail(orderId) {
  return queueMail(async () => {
    const order = await getOrder('id', orderId);
    const lang = await orderLang(order);
    const attachments = itemImages(order);
    const subject = helpersFor(lang).t(`email.status.${order.status}.subject`, { no: order.order_no });
    const html = await render('status-update', { lang, subject, order });
    await sendMail({ to: order.customer_email, subject, html, attachments, type: `status-${order.status}` });
  });
}

/**
 * A one-time code: `kind` 'customer' (signing in to buy), 'owner' (the owner's second sign-in step) or
 * 'owner-setup' (confirming the inbox the owner's codes go to).
 */
export function sendLoginCodeEmail(email, code, lang, kind = 'customer') {
  const texts = { customer: 'email.code', owner: 'email.owner_code', 'owner-setup': 'email.owner_setup' }[kind];
  return queueMail(async () => {
    const subject = helpersFor(lang).t(`${texts}.subject`, { code });
    const html = await render('login-code', { lang, subject, code, texts });
    await sendMail({ to: email, subject, html, type: kind === 'customer' ? 'login-code' : kind === 'owner' ? 'owner-code' : 'owner-setup' });
  });
}

/** Used by `npm run test-email` to check SMTP settings with a real message. */
export async function sendTestEmail(to, lang = 'ar') {
  const subject = helpersFor(lang).t('email.welcome.subject');
  const html = await render('welcome', { lang, subject, user: { full_name: 'Eva Scarf', email: to } });
  return sendMail({ to, subject: `[TEST] ${subject}`, html, type: 'test' });
}
