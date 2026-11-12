// The city and neighborhood selects (partials/delivery-fields.ejs) on the profile and checkout pages: the city
// narrows the neighborhood list, and picking a neighborhood sets its city. At checkout, the delivery fee and
// total follow the neighborhood being chosen.
import { $, $$ } from '../lib/dom.js';

function filterNeighborhoodsByCity(citySelect, zoneSelect) {
  const filterZones = () => {
    const city = citySelect.value;
    $$('option[data-city]', zoneSelect).forEach((option) => {
      const show = !city || option.dataset.city === city;
      option.hidden = !show;
      option.disabled = !show;
    });
    if (zoneSelect.selectedOptions[0]?.disabled) zoneSelect.value = '';
  };
  citySelect.addEventListener('change', filterZones);
  // Picking a neighborhood directly also sets its city.
  zoneSelect.addEventListener('change', () => {
    const city = zoneSelect.selectedOptions[0]?.dataset.city;
    if (city && citySelect.value !== city) {
      citySelect.value = city;
      filterZones();
    }
  });
  filterZones();
}

function updateCheckoutTotals(checkoutForm, zoneSelect) {
  const totalsBox = $('[data-checkout-totals]', checkoutForm);
  let asked = 0;
  zoneSelect.addEventListener('change', async () => {
    const mine = ++asked;
    try {
      const res = await fetch(`/checkout/summary?zone_id=${encodeURIComponent(zoneSelect.value)}`, { headers: { Accept: 'application/json' } });
      const data = await res.json();
      if (mine !== asked || !res.ok) return; // a later choice already answered, or the summary failed
      totalsBox.innerHTML = data.html;
      $('[data-expected-total]', checkoutForm).value = data.total;
    } catch { /* the server checks the total again when the order is sent */ }
  });
}

export function initDeliveryFields() {
  const citySelect = $('[data-zone-city]');
  const zoneSelect = $('[data-zone-select]');
  if (citySelect && zoneSelect) filterNeighborhoodsByCity(citySelect, zoneSelect);
  const checkoutForm = $('[data-checkout-form]');
  if (checkoutForm && zoneSelect) updateCheckoutTotals(checkoutForm, zoneSelect);
}
