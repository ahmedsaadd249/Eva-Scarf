// The last two handlers: a page for addresses nothing answered, and one for anything that went wrong.

export function notFound(req, res) {
  res.status(404).page('error', { title: res.locals.t('errors.not_found_title'), message: res.locals.t('errors.not_found') });
}

// Express recognises an error handler by its four arguments, so `next` stays although it's unused.
// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  const isClientMistake = Boolean(err.status) && err.status < 500; // too large, bad JSON…: not crashes
  if (!(err.status < 500)) console.error(err);
  if (res.headersSent) return;
  const t = res.locals.t ?? ((k) => k);
  res.status(isClientMistake ? err.status : 500);
  if (res.page) res.page('error', { title: t('errors.server_title'), message: t('errors.server') });
  else res.send('Server error');
}
