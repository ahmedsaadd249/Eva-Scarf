// The − / + buttons beside the quantity on the product page, kept between the field's min and max.
import { $, $$ } from '../lib/dom.js';

export function initQuantityStepper() {
  $$('[data-stepper]').forEach((stepper) => {
    const input = $('input', stepper);
    $$('[data-step]', stepper).forEach((btn) =>
      btn.addEventListener('click', () => {
        const min = Number(input.min) || 1;
        const max = Number(input.max) || 99;
        input.value = String(Math.min(max, Math.max(min, (Number(input.value) || 1) + Number(btn.dataset.step))));
      }),
    );
  });
}
