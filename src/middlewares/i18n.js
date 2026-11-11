import { helpersFor, LANGS } from '../lib/i18n.js';

/** The visitor's language (chosen in this session, else the account's, else Arabic) and the text helpers for templates. */
export function language(req, res, next) {
  const lang = LANGS.includes(req.session.lang) ? req.session.lang : (req.user?.lang ?? 'ar');
  req.lang = lang;
  Object.assign(res.locals, helpersFor(lang));
  next();
}
