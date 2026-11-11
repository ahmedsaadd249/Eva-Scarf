// Dashboard → Products: the bulk discount box shows how many products are ticked when it applies to the selected ones.
import { $, $$ } from '../../lib/dom.js';

export function initBulkDiscount(bulk) {
  const scope = $('[data-bulk-scope]', bulk);
  const count = $('[data-selected-count]', bulk);
  const checks = $$('[data-bulk-check]'); // in the product list, outside the box (form="bulk")
  const refresh = () => {
    const n = checks.filter((c) => c.checked).length;
    count.textContent = scope.value === 'selected' ? `(${n})` : '';
  };
  scope.addEventListener('change', refresh);
  checks.forEach((c) => c.addEventListener('change', refresh));
  refresh();
}
