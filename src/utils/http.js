/** The page's own script asked for JSON (the cart panel, the code boxes); a plain form post wants HTML. */
export const wantsJson = (req) => req.accepts(['html', 'json']) === 'json';

/**
 * How a form that can be posted both ways finishes: `{ ok, redirect }` for the script (so it can show
 * the green tick before moving on), or the redirect itself for a plain form post.
 */
export function replyJsonOrRedirect(req, res) {
  const json = wantsJson(req);
  return (ok, to) => (json ? res.json({ ok, redirect: to }) : res.redirect(to));
}
