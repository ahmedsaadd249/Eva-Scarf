// The "sign in with a code sent by email" form, shown on the sign-in page and on checkout. Its posts go
// to /account/code/… and come back to the page they came from; the email the code went to, and any
// error, wait in the session for that page.

/** What the form shows: the email step, or the code step once a code has been sent. */
export function codeSigninLocals(req) {
  const error = req.session.codeError;
  delete req.session.codeError;
  return {
    codeStep: req.session.codeEmail ? 'code' : 'email',
    codeEmail: req.session.codeEmail || req.session.codeTyped || '',
    codeError: error,
  };
}
