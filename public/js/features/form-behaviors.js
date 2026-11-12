// Small form behaviors switched on by data attributes: data-confirm asks before a destructive action,
// data-once stops a form from being sent twice (e.g. placing an order twice), data-autosubmit sends a form
// when one of its selects changes (the shop's sort order).
import { $$ } from '../lib/dom.js';

function confirmBeforeSending() {
  $$('form[data-confirm]').forEach((form) => {
    form.addEventListener('submit', (e) => {
      if (!window.confirm(form.dataset.confirm)) {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    });
  });
}

function sendOnlyOnce() {
  $$('form[data-once]').forEach((form) => {
    form.addEventListener('submit', (e) => {
      if (e.defaultPrevented) return;
      // Disable after the browser has captured the clicked button's name/value.
      setTimeout(() => $$('button', form).forEach((b) => { b.disabled = true; }), 0);
    });
  });
}

function submitWhenSelectChanges() {
  $$('form[data-autosubmit] select').forEach((sel) => sel.addEventListener('change', () => sel.form.submit()));
}

// In this order: a cancelled confirm stops the form before data-once disables its buttons.
export function initFormBehaviors() {
  confirmBeforeSending();
  sendOnlyOnce();
  submitWhenSelectChanges();
}
