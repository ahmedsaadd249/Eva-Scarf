// Map picker for the delivery address on the profile page (Leaflet + OpenStreetMap tiles).
// The pin stays in the middle and the customer moves the map under it. Addresses come from our
// own /api/geo endpoints (the server talks to Nominatim). "Confirm location" copies the point into
// the hidden form fields; it is stored when the profile form is saved.

const CAIRO = [30.0444, 31.2357];
const OK_ICON = '<svg viewBox="0 0 24 24" class="h-4 w-4 shrink-0" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>';
const TONES = { ok: 'text-ok', warn: 'text-warn', error: 'text-[#B3203A]', info: 'text-ink-soft' };
const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const round6 = (n) => Math.round(n * 1e6) / 1e6;

// Loose comparison of place names: Arabic letter variants, "ال" / "El", doubled letters, punctuation.
const simplify = (s) => String(s || '').toLowerCase()
  .replace(/[ً-ٰٟـ]/g, '')
  .replace(/[أإآٱ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي')
  .replace(/[^\p{L}\p{N}]+/gu, ' ')
  .replace(/(^| )(al|el) /g, '$1')
  .replace(/(^| )ال/g, '$1')
  .replace(/(\p{L})\1+/gu, '$1')
  .trim();

/**
 * True when the place `name` is what `area` refers to: the same name ("Al Mohandesin" / "Mohandessin"),
 * or the name as whole words inside it ("الدقي" in "حي الدقي"). Not the other way round, so a short
 * area like "مصر" doesn't match "مصر الجديدة".
 */
export function nameIn(name, area) {
  const n = simplify(name);
  const a = simplify(area);
  if (!n || !a) return false;
  return n === a || (n.length >= 3 && ` ${a} `.includes(` ${n} `));
}

async function getJson(url) {
  let res;
  try {
    res = await fetch(url, { headers: { Accept: 'application/json' } });
  } catch {
    return { error: null }; // offline: caller shows its own message
  }
  const data = await res.json().catch(() => ({}));
  return res.ok ? data : { error: data.error || null };
}

export function initLocationPicker(root) {
  const L = window.L;
  if (!L || root.dataset.ready) return; // map library blocked or offline: the form still works without the map
  root.dataset.ready = '1';
  const $ = (sel) => root.querySelector(sel);
  const form = root.closest('form');
  let text = {};
  try { text = JSON.parse($('[data-geo-i18n]').textContent); } catch { /* keys shown as-is */ }
  const say = (key) => text[key] || key;

  const fields = { lat: form.elements.location_lat, lng: form.elements.location_lng, label: form.elements.location_label };
  const nameEl = $('[data-geo-name]');
  const addressEl = $('[data-geo-address]');
  const statusEl = $('[data-geo-status]');
  const noteEl = $('[data-geo-note]');
  const confirmBtn = $('[data-geo-confirm]');
  const searchInput = $('[data-geo-search]');
  const results = $('[data-geo-results]');

  const savedLat = parseFloat(root.dataset.lat);
  const savedLng = parseFloat(root.dataset.lng);
  const hasSaved = Number.isFinite(savedLat) && Number.isFinite(savedLng);

  function setStatus(tone, message, withIcon = false) {
    statusEl.className = `mt-2 flex items-center gap-1.5 text-[13px] ${TONES[tone]}`;
    statusEl.innerHTML = withIcon ? OK_ICON : '';
    statusEl.append(document.createTextNode(message));
    if (!message) statusEl.className = 'mt-2 hidden';
  }

  root.hidden = false;
  const map = L.map($('[data-map]'), {
    center: hasSaved ? [savedLat, savedLng] : CAIRO,
    zoom: hasSaved ? 17 : 12,
    zoomControl: false,
    // Zoom keeps the middle (where the pin is) in place.
    scrollWheelZoom: 'center',
    doubleClickZoom: 'center',
    touchZoom: 'center',
  });
  L.control.zoom({ position: 'bottomleft' }).addTo(map);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    // OpenStreetMap refuses tile requests without a Referer; the site's own policy sends none.
    referrerPolicy: 'strict-origin-when-cross-origin',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>',
  }).addTo(map);
  // Don't hijack page scrolling: wheel zoom starts working once the customer touches the map.
  map.scrollWheelZoom.disable();
  map.once('mousedown touchstart focus', () => map.scrollWheelZoom.enable());
  // The box can get its final size after the map starts (styles load late); keep the map in step.
  new ResizeObserver(() => map.invalidateSize()).observe($('[data-map]'));

  let current = null; // { lat, lng, name, address, road } for the point under the pin
  let confirmed = hasSaved ? { lat: savedLat, lng: savedLng } : null;
  let lookupNo = 0;
  let timer = 0;

  const isConfirmed = (p) => confirmed && p && Math.abs(confirmed.lat - p.lat) < 1e-6 && Math.abs(confirmed.lng - p.lng) < 1e-6;
  const centre = () => {
    const c = map.getCenter();
    return { lat: round6(c.lat), lng: round6(c.lng) };
  };

  confirmBtn.disabled = true;
  if (hasSaved) setStatus('ok', say('saved'), true);

  function show(place) {
    nameEl.textContent = place.name || say('unknown_place');
    addressEl.textContent = place.address || `${place.lat}, ${place.lng}`;
  }

  async function lookUp() {
    const point = centre();
    const no = ++lookupNo;
    const data = await getJson(`/api/geo/reverse?lat=${point.lat}&lng=${point.lng}`);
    if (no !== lookupNo) return; // the map moved again meanwhile
    current = {
      ...point, name: data.name || '', address: data.address || '', road: data.road || '',
      house_number: data.house_number || '', area: data.area || '', areas: data.areas || [],
    };
    show(current);
    if (data.error !== undefined && !data.name) setStatus('warn', data.error || say('error_service'));
    else if (isConfirmed(point)) setStatus('ok', say('saved'), true);
    else setStatus('warn', say('not_confirmed'));
    confirmBtn.disabled = isConfirmed(point);
  }

  // Only real moves (drag, zoom, search, "my location") start with movestart; a resize of the box
  // also ends in moveend, and must not count as picking a new spot.
  let moving = false;
  map.on('movestart', () => {
    moving = true;
    noteEl.hidden = true;
    root.classList.add('map-moving');
    lookupNo++;
    clearTimeout(timer);
    confirmBtn.disabled = true;
  });
  map.on('moveend', () => {
    root.classList.remove('map-moving');
    if (!moving) return;
    moving = false;
    const point = centre();
    nameEl.textContent = say('detecting');
    addressEl.textContent = '';
    setStatus('info', '');
    clearTimeout(timer);
    timer = setTimeout(lookUp, 700); // Nominatim allows 1 request/second; wait until the map settles
  });

  /* ---- Fill the address fields from the confirmed point ---- */
  /** The delivery neighborhood the map's area names point to, if it is in the list. */
  function matchZone(areas) {
    const options = [...(form.elements.zone_id?.options || [])].filter((o) => o.value && o.dataset.names);
    for (const area of areas) {
      const option = options.find((o) => o.dataset.names.split('|').some((n) => nameIn(n, area)));
      if (option) return { option, area };
    }
    return null;
  }
  const lang = document.documentElement.lang || 'ar';
  const labelOf = (input) => {
    const text = form.querySelector(`label[for="${input.id}"]`)?.textContent.trim() || input.name;
    return lang === 'en' ? text.toLowerCase() : text;
  };
  function setField(input, value) {
    if (!input || !value || input.value === value) return false;
    input.value = value;
    input.dispatchEvent(new Event(input.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
    return true;
  }

  function fillAddress(place) {
    const { street, building_no: building, apartment_no: apartment, zone_id: zone } = form.elements;
    const filled = [];
    const match = matchZone(place.areas);
    if (match && zone) {
      // The neighborhood list is filtered by city: switch the city first so the option is available.
      const city = form.querySelector('[data-zone-city]');
      if (city && match.option.dataset.city && city.value !== match.option.dataset.city) setField(city, match.option.dataset.city);
      if (zone.value === match.option.value || setField(zone, match.option.value)) filled.push(labelOf(zone));
    }
    // The street, plus the local area when it isn't the neighborhood already chosen (helps the courier).
    const local = place.area && !(match && match.area === place.area) && !nameIn(place.area, place.road) ? place.area : '';
    const streetText = [place.road, local].filter(Boolean).join('، ');
    if (place.road && (setField(street, streetText) || street.value === streetText)) filled.push(labelOf(street));
    if (place.house_number && (setField(building, place.house_number) || building.value === place.house_number)) filled.push(labelOf(building));

    const notes = [];
    if (filled.length) notes.push(say('filled').replace('{fields}', new Intl.ListFormat(lang, { type: 'conjunction' }).format(filled)));
    if (!match && zone && !zone.value) notes.push(say('zone_unknown'));
    if (apartment && !apartment.value.trim()) notes.push(say('add_apartment'));
    noteEl.textContent = notes.join(' ');
    noteEl.hidden = !notes.length;
  }

  confirmBtn.addEventListener('click', () => {
    if (!current) return;
    fields.lat.value = current.lat;
    fields.lng.value = current.lng;
    fields.label.value = (current.address || current.name || '').slice(0, 300);
    fillAddress(current);
    confirmed = { lat: current.lat, lng: current.lng };
    confirmBtn.disabled = true;
    setStatus('ok', `${say('saved')} · ${say('saved_hint')}`, true);
  });

  /* ---- Search (on Enter or the button only: Nominatim doesn't allow search-as-you-type) ---- */
  const goTo = (lat, lng) => {
    if (reducedMotion()) map.setView([lat, lng], 17);
    else map.flyTo([lat, lng], 17, { duration: 0.8 });
  };
  function closeResults() {
    results.hidden = true;
    results.replaceChildren();
  }
  function note(message) {
    const li = document.createElement('li');
    li.className = 'px-4 py-3 text-ink-soft';
    li.textContent = message;
    results.replaceChildren(li);
    results.hidden = false;
  }
  async function search() {
    const q = searchInput.value.trim();
    if (q.length < 2) return note(say('error_bad_query'));
    note(say('searching'));
    const data = await getJson(`/api/geo/search?q=${encodeURIComponent(q)}`);
    if (!data.results) return note(data.error || say('error_service'));
    if (!data.results.length) return note(say('no_results'));
    results.replaceChildren(...data.results.map((place) => {
      const li = document.createElement('li');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'block w-full px-4 py-2.5 text-start hover:bg-eva-mist focus-visible:bg-eva-mist focus-visible:outline-none';
      const strong = document.createElement('span');
      strong.className = 'block font-medium text-ink';
      strong.textContent = place.name;
      const small = document.createElement('span');
      small.className = 'block truncate text-[12px] text-ink-soft';
      small.textContent = place.address;
      btn.append(strong, small);
      btn.addEventListener('click', () => {
        closeResults();
        goTo(place.lat, place.lng);
      });
      li.append(btn);
      return li;
    }));
    results.hidden = false;
  }
  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault(); // don't submit the profile form
      search();
    } else if (e.key === 'Escape') {
      closeResults();
    }
  });
  $('[data-geo-search-btn]').addEventListener('click', search);
  map.on('click', closeResults);

  /* ---- Use my current location ---- */
  $('[data-geo-locate]').addEventListener('click', () => {
    if (!navigator.geolocation) return setStatus('error', say('unavailable'));
    setStatus('info', say('locating'));
    navigator.geolocation.getCurrentPosition(
      (pos) => goTo(pos.coords.latitude, pos.coords.longitude),
      (err) => setStatus('error', say({ 1: 'denied', 3: 'timeout' }[err.code] || 'unavailable')),
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 },
    );
  });
}
