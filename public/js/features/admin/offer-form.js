// Dashboard → Offers → add / edit: only the fields for the chosen kind of offer show (without JavaScript, all do).
import { $, $$ } from '../../lib/dom.js';

export function initOfferForm(offerForm) {
  const showFields = () => {
    const type = $('[data-offer-type]:checked', offerForm)?.value;
    // Wrappers only (no display classes on them), so the hidden attribute works.
    $$('[data-offer-fields]', offerForm).forEach((el) => { el.hidden = Boolean(type) && !el.dataset.offerFields.split(' ').includes(type); });
    $$('[data-offer-hint]', offerForm).forEach((el) => { el.hidden = Boolean(type) && el.dataset.offerHint !== type; });
  };
  $$('[data-offer-type]', offerForm).forEach((radio) => radio.addEventListener('change', showFields));
  showFields();
}
