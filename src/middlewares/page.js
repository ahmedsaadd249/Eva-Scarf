// Helpers every controller uses to answer with a page.

/**
 * res.page(view, locals): render a view inside the store layout (or the layout named in locals.layout),
 * with the flash message waiting from the previous request.
 * req.flash(type, key, vars): a message (a text key) for the next page this visitor sees.
 */
export function pageHelpers(req, res, next) {
  res.page = (view, locals = {}) => {
    res.locals.flash = req.session.flash ?? null;
    delete req.session.flash;
    res.render(view, locals, (err, body) => {
      if (err) return next(err);
      res.render(locals.layout ?? 'layouts/store', { ...locals, body });
    });
  };
  req.flash = (type, key, vars) => {
    req.session.flash = { type, key, vars };
  };
  next();
}
