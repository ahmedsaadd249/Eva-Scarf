// Vercel entry point: every request that isn't a static file in public/ is handled by the Express app.
// If the app can't start (usually a missing environment variable), every request gets a short 500
// message instead of Vercel's bare crash page, and the real reason goes to Vercel → Logs.
let app = null;
let startupError = null;
try {
  ({ default: app } = await import('../src/app.js'));
} catch (err) {
  startupError = err;
  console.error('Eva Scarf could not start:', err);
}

export default function handler(req, res) {
  if (app) {
    // Vercel puts its own res.redirect on every response. It answers 307, which makes browsers
    // send a submitted form again to the next page, and it doesn't encode the address (a tab in a
    // "next" link would become an off-site redirect). Remove it so Express's own redirect is used:
    // 302, encoded, the same as locally and in the tests.
    if (Object.getOwnPropertyDescriptor(res, 'redirect')?.configurable) delete res.redirect;
    return app(req, res);
  }
  console.error('Eva Scarf could not start:', startupError?.message);
  res.statusCode = 500;
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end('The store could not start. The owner can see why in Vercel → Project → Logs.\n'
    + 'تعذّر تشغيل المتجر. يمكن لصاحب المتجر معرفة السبب من سجلّات Vercel.');
}
