import path from 'node:path';
import ejs from 'ejs';
import { config, ROOT } from './config.js';
import { get } from './db.js';
import { helpersFor, LANGS } from './i18n.js';
import { imageSource, LOGO_CID, queueMail, sendMail } from './mailer.js';
import { getOrder } from './orders.js';
import { allZones, formatAddress } from './zones.js';

const EMAIL_DIR = path.join(ROOT, 'src', 'emails');

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
    logoCid: LOGO_CID,
    align: h.dir === 'rtl' ? 'right' : 'left',
    alignEnd: h.dir === 'rtl' ? 'left' : 'right',
    address: (record) => formatAddress(record, lang, zones),
    bodyFont: FONTS[lang].body,
    displayFont: FONTS[lang].display,
    displayStyle: FONTS[lang].displayStyle,
  };
  const body = await ejs.renderFile(path.join(EMAIL_DIR, `${template}.ejs`), locals);
  return ejs.renderFile(path.join(EMAIL_DIR, '_layout.ejs'), { ...locals, body });
}

/** Attach each order item's image inline so it shows in the email even when the site isn't public. */
function itemAttachments(order) {
  const attachments = [];
  order.items.forEach((item, i) => {
    const src = imageSource(item.image);
    if (!src) return;
    item.cid = `item${i}@evascarf`;
    const ext = path.extname(String(item.image).split('?')[0]) || '.jpg';
    attachments.push({ filename: `tarha-${i + 1}${ext}`, path: src, cid: item.cid });
  });
  return attachments;
}

/** Emails go out in the customer's current language, falling back to the language they ordered in. */
async function orderLang(order) {
  const user = order.user_id ? await get('SELECT lang FROM users WHERE id = ?', [order.user_id]) : null;
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
    const attachments = itemAttachments(order);
    const subject = helpersFor(lang).t('email.order.subject', { no: order.order_no });
    const html = await render('order-confirmation', { lang, subject, order });
    await sendMail({ to: order.customer_email, subject, html, attachments, type: 'order-confirmation' });
  });
}

export function sendStatusEmail(orderId) {
  return queueMail(async () => {
    const order = await getOrder('id', orderId);
    const lang = await orderLang(order);
    const attachments = itemAttachments(order);
    const subject = helpersFor(lang).t(`email.status.${order.status}.subject`, { no: order.order_no });
    const html = await render('status-update', { lang, subject, order });
    await sendMail({ to: order.customer_email, subject, html, attachments, type: `status-${order.status}` });
  });
}

export function sendPasswordResetEmail(user, token) {
  return queueMail(async () => {
    const lang = user.lang;
    const subject = helpersFor(lang).t('email.reset.subject');
    const resetUrl = `${config.baseUrl}/account/reset/${token}`;
    const html = await render('password-reset', { lang, subject, user, resetUrl });
    await sendMail({ to: user.email, subject, html, type: 'password-reset' });
  });
}

/** Used by `npm run test-email` to check SMTP settings with a real message. */
export async function sendTestEmail(to, lang = 'ar') {
  const subject = helpersFor(lang).t('email.welcome.subject');
  const html = await render('welcome', { lang, subject, user: { full_name: 'Eva Scarf', email: to } });
  return sendMail({ to, subject: `[TEST] ${subject}`, html, type: 'test' });
}
