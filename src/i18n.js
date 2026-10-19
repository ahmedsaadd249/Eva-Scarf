import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './config.js';
import { formatMoney } from './pricing.js';

export const LANGS = ['ar', 'en'];
const STORE_TZ = process.env.STORE_TIMEZONE || 'Africa/Cairo';

const dicts = Object.fromEntries(
  LANGS.map((lang) => [lang, JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'locales', `${lang}.json`), 'utf8'))]),
);

const lookup = (dict, key) => key.split('.').reduce((node, part) => node?.[part], dict);

// Unicode "first strong isolate" … "pop directional isolate": keeps an inserted value
// (an email, an English street name, a price) from scrambling the punctuation of an
// Arabic sentence around it, and vice versa.
const FSI = '⁨';
const PDI = '⁩';

/** `isolate: false` gives plain text, for values stored in the database. */
export function translate(lang, key, vars, { isolate = true } = {}) {
  let s = lookup(dicts[lang] ?? dicts.ar, key) ?? lookup(dicts.ar, key) ?? key;
  if (vars && typeof s === 'string') {
    s = s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] == null ? m : isolate ? FSI + vars[k] + PDI : String(vars[k])));
  }
  return s;
}

/** Pick obj[`${field}_${lang}`], falling back to the other language. */
export function localized(obj, field, lang) {
  const other = lang === 'ar' ? 'en' : 'ar';
  return obj?.[`${field}_${lang}`] || obj?.[`${field}_${other}`] || '';
}

/** Show a database timestamp (a Date, or a UTC 'YYYY-MM-DD HH:MM:SS' string) in the store's time zone. */
export function formatDate(value, lang, withTime = true) {
  if (!value) return '';
  const d = value instanceof Date ? value : new Date(String(value).replace(' ', 'T') + (/[zZ]|[+-]\d\d:?\d\d$/.test(String(value)) ? '' : 'Z'));
  return d.toLocaleString(lang === 'ar' ? 'ar-EG-u-nu-latn' : 'en-GB', {
    timeZone: STORE_TZ,
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    ...(withTime ? { hour: 'numeric', minute: '2-digit' } : {}),
  });
}

/**
 * An offer's name in this language: the owner's own name if they wrote one, otherwise one made
 * from the offer's settings ("Free delivery on orders over EGP 1,000.00", "Buy 3, get 1 free"…).
 */
export function offerLabel(offer, lang) {
  const own = String(offer?.[`name_${lang}`] ?? '').trim();
  if (own) return own;
  const amount = formatMoney(offer?.min_subtotal || 0, lang);
  switch (offer?.type) {
    case 'free_delivery': return translate(lang, 'offers.name_free_delivery', { amount });
    case 'buy_get': return translate(lang, 'offers.name_buy_get', { buy: offer.buy_qty, get: offer.get_qty });
    case 'order_percent':
      return translate(lang, offer.min_subtotal ? 'offers.name_percent' : 'offers.name_percent_all', { percent: offer.percent, amount });
    default: return '';
  }
}

export function helpersFor(lang) {
  return {
    lang,
    dir: lang === 'ar' ? 'rtl' : 'ltr',
    t: (key, vars) => translate(lang, key, vars),
    L: (obj, field) => localized(obj, field, lang),
    money: (piasters) => formatMoney(piasters, lang),
    formatDate: (value, withTime) => formatDate(value, lang, withTime),
    offerLabel: (offer) => offerLabel(offer, lang),
  };
}

export function i18n(req, res, next) {
  const lang = LANGS.includes(req.session.lang) ? req.session.lang : (req.user?.lang ?? 'ar');
  req.lang = lang;
  Object.assign(res.locals, helpersFor(lang));
  next();
}
