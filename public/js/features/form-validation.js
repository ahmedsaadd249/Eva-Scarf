// Forms marked data-validate are checked in the browser with the server's own rules (validation.js), so each
// mistake shows under its field before anything is sent. The server checks everything again.
import { $, $$, msg } from '../lib/dom.js';
import { validateProfile } from '../validation.js';

function setFieldError(form, name, key) {
  const input = form.elements[name];
  if (!input) return;
  // Errors go under the whole field (inputs may sit inside extra wrappers, e.g. for icons).
  const holder = input.closest('[data-field]') || input.parentElement;
  document.getElementById(`${input.id}-error`)?.remove(); // the server's message, now superseded
  let p = holder.querySelector(':scope > [data-client-error]');
  if (!key) {
    p?.remove();
    input.removeAttribute('aria-invalid');
    return;
  }
  if (!p) {
    p = document.createElement('p');
    p.dataset.clientError = '';
    p.className = 'mt-1.5 text-[13px] text-[#B3203A]';
    p.id = `${input.id}-client-error`;
    holder.append(p);
  }
  p.textContent = msg(key);
  input.setAttribute('aria-invalid', 'true');
  input.setAttribute('aria-describedby', p.id);
}

// Which rules apply is read when the form is sent, not when the page loads.
function validateForm(form) {
  const kind = form.dataset.validate;
  const errors = {};
  if (kind === 'profile') {
    const data = Object.fromEntries(new FormData(form));
    Object.assign(errors, validateProfile(data).errors);
    ['full_name', 'zone_id', 'street', 'building_no', 'apartment_no', 'phone_primary', 'phone_secondary']
      .forEach((n) => setFieldError(form, n, errors[n]));
  }
  return errors;
}

// An invalid form is stopped before the form's own submit listeners (data-confirm, data-once in
// form-behaviors.js) run, so it is never sent and its buttons stay usable. This file loads after those
// listeners were added, so it listens on the document while the event is on its way to the form (capture),
// which comes before any listener on the form itself.
export function initFormValidation() {
  const forms = $$('form[data-validate]');
  document.addEventListener('submit', (e) => {
    const form = e.target;
    if (!forms.includes(form)) return;
    const errors = validateForm(form);
    const first = Object.keys(errors)[0];
    const banner = $('[data-form-error]', form);
    if (banner) banner.hidden = !first;
    if (first) {
      e.preventDefault();
      e.stopImmediatePropagation();
      form.elements[first]?.focus();
    }
  }, true);
  // Re-check a field when the customer leaves it, once they've tried to submit.
  forms.forEach((form) => {
    form.addEventListener('focusout', () => {
      if (form.querySelector('[data-client-error]')) validateForm(form);
    });
  });
}
