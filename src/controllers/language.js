import { LANGS } from '../lib/i18n.js';
import { saveLanguage } from '../services/profile.js';
import { safeNext } from '../utils/safe-next.js';

/** The page to go back to: ?next, else the page the visitor came from on this site, else home. */
function backTarget(req) {
  const next = safeNext(req.query.next, '');
  if (next) return next;
  try {
    const url = new URL(req.get('referer'));
    return url.host === req.get('host') ? url.pathname + url.search : '/';
  } catch {
    return '/'; // no or foreign referer
  }
}

/** Remembered in the session and, for signed-in customers, on their account (emails use it). */
export async function switchLanguage(req, res) {
  const code = LANGS.includes(req.params.code) ? req.params.code : 'ar';
  req.session.lang = code;
  if (req.user) await saveLanguage(req.user.id, code);
  res.redirect(backTarget(req));
}
