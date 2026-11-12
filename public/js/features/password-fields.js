// Password fields (partials/password-field.ejs): the show / hide button, and the list of password rules that
// tick off while a new password is typed (the server's rules, from validation.js).
import { $$, msg } from '../lib/dom.js';
import { passwordChecks } from '../validation.js';

export function initPasswordFields() {
  $$('[data-toggle-password]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const input = document.getElementById(btn.dataset.togglePassword);
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      btn.setAttribute('aria-pressed', String(show));
      btn.setAttribute('aria-label', msg(show ? 'auth.hide_password' : 'auth.show_password'));
    });
  });
  $$('[data-password-rules]').forEach((input) => {
    const list = document.getElementById(input.dataset.passwordRules);
    const update = () => {
      const checks = passwordChecks(input.value);
      $$('[data-rule]', list).forEach((li) => { li.dataset.ok = String(Boolean(checks[li.dataset.rule])); });
    };
    input.addEventListener('input', update);
    update();
  });
}
