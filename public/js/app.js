import { emailError, normalizeEmail, passwordChecks, passwordError, validateProfile } from './validation.js';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const messages = (() => {
  try { return JSON.parse($('#client-i18n')?.textContent || '{}'); } catch { return {}; }
})();
const msg = (key) => messages[key] || key;
const csrf = () => $('meta[name="csrf-token"]')?.content || '';
const isRtl = document.documentElement.dir === 'rtl';

/* ---------- Drawer (mobile menu) ---------- */
const drawer = $('#drawer');
const scrim = $('[data-scrim]');
let lastFocus = null;
function setDrawer(open) {
  if (!drawer) return;
  drawer.dataset.open = String(open);
  scrim.dataset.open = String(open);
  drawer.setAttribute('aria-hidden', String(!open));
  $$('[data-drawer-open]').forEach((b) => b.setAttribute('aria-expanded', String(open)));
  document.body.style.overflow = open ? 'hidden' : '';
  if (open) {
    lastFocus = document.activeElement;
    $('[data-drawer-close]', drawer)?.focus();
  } else {
    lastFocus?.focus?.();
  }
}
$$('[data-drawer-open]').forEach((b) => b.addEventListener('click', () => setDrawer(true)));
$$('[data-drawer-close]').forEach((b) => b.addEventListener('click', () => setDrawer(false)));
scrim?.addEventListener('click', () => setDrawer(false));

/* ---------- Search panel ---------- */
const searchPanel = $('#search-panel');
function setSearch(open) {
  if (!searchPanel) return;
  searchPanel.dataset.open = String(open);
  $$('[data-search-open]').forEach((b) => b.setAttribute('aria-expanded', String(open)));
  if (open) setTimeout(() => $('#search-input')?.focus(), 60);
}
$$('[data-search-open]').forEach((b) =>
  b.addEventListener('click', () => setSearch(searchPanel?.dataset.open !== 'true')),
);

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (drawer?.dataset.open === 'true') setDrawer(false);
  if (searchPanel?.dataset.open === 'true') setSearch(false);
});

/* ---------- Toasts ---------- */
function dismiss(toast) {
  if (!toast || toast.dataset.leaving) return;
  toast.dataset.leaving = '1';
  setTimeout(() => toast.parentElement?.remove?.() ?? toast.remove(), 320);
}
$$('[data-toast]').forEach((toast) => {
  $('[data-toast-close]', toast)?.addEventListener('click', () => dismiss(toast));
  if (toast.getAttribute('role') !== 'alert') setTimeout(() => dismiss(toast), 6000);
});

function showToast(text, tone = 'success') {
  const region = $('#toast-region');
  if (!region) return;
  const el = document.createElement('div');
  el.className = `toast pointer-events-auto flex max-w-md items-center gap-3 rounded-2xl px-4 py-3 shadow-float ${
    tone === 'error' ? 'bg-[#8E1238] text-white' : 'bg-ink text-white'
  }`;
  el.setAttribute('role', tone === 'error' ? 'alert' : 'status');
  const p = document.createElement('p');
  p.className = 'text-[15px]';
  p.textContent = text;
  el.append(p);
  if (tone !== 'error') {
    const link = document.createElement('a');
    link.href = '/cart';
    link.className = 'ms-2 shrink-0 rounded-full bg-white/15 px-3 py-1 text-[13px] hover:bg-white/25';
    link.textContent = msg('cart.view_cart');
    el.append(link);
  }
  region.append(el);
  setTimeout(() => {
    el.dataset.leaving = '1';
    setTimeout(() => el.remove(), 320);
  }, 3800);
}

/* ---------- Add to cart without leaving the page ---------- */
function setCartCount(count) {
  $$('[data-cart-count]').forEach((badge) => {
    badge.textContent = count;
    badge.classList.toggle('hidden', !count);
    badge.classList.remove('badge-bump');
    void badge.offsetWidth;
    badge.classList.add('badge-bump');
  });
}
$$('form[data-add-to-cart]').forEach((form) => {
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const button = $('button:not([type=button])', form) || form.querySelector('button');
    if (button?.disabled) return;
    button?.setAttribute('aria-busy', 'true');
    try {
      const res = await fetch(form.action, {
        method: 'POST',
        headers: { Accept: 'application/json', 'x-csrf-token': csrf() },
        body: new URLSearchParams(new FormData(form)),
      });
      const data = await res.json();
      if (data.ok) setCartCount(data.count);
      showToast(data.message, data.ok ? 'success' : 'error');
    } catch {
      form.submit();
    } finally {
      button?.removeAttribute('aria-busy');
    }
  });
});

/* ---------- Quantity stepper ---------- */
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

/* ---------- Product gallery ---------- */
const gallery = $('[data-gallery]');
if (gallery) {
  const slides = [...gallery.children];
  const dots = $$('[data-gallery-dots] span');
  const thumbs = $$('[data-gallery-thumb]');
  const mark = (i) => {
    dots.forEach((d, j) => {
      d.classList.toggle('scale-150', i === j);
      d.classList.toggle('!bg-white', i === j);
    });
    thumbs.forEach((t, j) => {
      t.classList.toggle('border-eva-deep', i === j);
      t.classList.toggle('border-transparent', i !== j);
    });
  };
  gallery.addEventListener('scroll', () => {
    const i = Math.round(Math.abs(gallery.scrollLeft) / gallery.clientWidth);
    mark(Math.min(slides.length - 1, i));
  }, { passive: true });
  thumbs.forEach((t) =>
    t.addEventListener('click', (e) => {
      e.preventDefault();
      const i = Number(t.dataset.galleryThumb);
      const x = gallery.clientWidth * i;
      gallery.scrollTo({ left: isRtl ? -x : x, behavior: 'smooth' });
      mark(i);
    }),
  );
}

/* ---------- Reviews carousel buttons ---------- */
$$('[data-carousel-controls]').forEach((controls) => {
  const track = $(`[data-carousel="${controls.dataset.carouselControls}"]`);
  if (!track) return;
  const step = () => (track.firstElementChild?.getBoundingClientRect().width || 300) + 16;
  const go = (dir) => track.scrollBy({ left: dir * step() * (isRtl ? -1 : 1), behavior: 'smooth' });
  $('[data-carousel-prev]', controls)?.addEventListener('click', () => go(-1));
  $('[data-carousel-next]', controls)?.addEventListener('click', () => go(1));
});

/* ---------- Password fields ---------- */
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

/* ---------- Client-side validation (same rules as the server) ---------- */
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

function validateForm(form) {
  const kind = form.dataset.validate;
  const errors = {};
  const v = (n) => form.elements[n]?.value ?? '';
  if (kind === 'register') {
    if (v('full_name').trim().length < 2) errors.full_name = 'errors.name_required';
    const ee = emailError(normalizeEmail(v('email')));
    if (ee) errors.email = ee;
    const pe = passwordError(v('password'));
    if (pe) errors.password = pe;
    if (v('password') !== v('password_confirm')) errors.password_confirm = 'errors.password_mismatch';
    ['full_name', 'email', 'password', 'password_confirm'].forEach((n) => setFieldError(form, n, errors[n]));
  }
  if (kind === 'profile') {
    const data = Object.fromEntries(new FormData(form));
    Object.assign(errors, validateProfile(data).errors);
    ['full_name', 'zone_id', 'street', 'building_no', 'apartment_no', 'phone_primary', 'phone_secondary']
      .forEach((n) => setFieldError(form, n, errors[n]));
  }
  return errors;
}

$$('form[data-validate]').forEach((form) => {
  form.addEventListener('submit', (e) => {
    const errors = validateForm(form);
    const first = Object.keys(errors)[0];
    const banner = $('[data-form-error]', form);
    if (banner) banner.hidden = !first;
    if (first) {
      e.preventDefault();
      e.stopImmediatePropagation();
      form.elements[first]?.focus();
    }
  });
  // Re-check a field when the customer leaves it, once they've tried to submit.
  form.addEventListener('focusout', () => {
    if (form.querySelector('[data-client-error]')) validateForm(form);
  });
});

/* ---------- Profile: the city picker filters the neighborhood list ---------- */
const citySelect = $('[data-zone-city]');
const zoneSelect = $('[data-zone-select]');
if (citySelect && zoneSelect) {
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

/* ---------- Confirm destructive actions ---------- */
$$('form[data-confirm]').forEach((form) => {
  form.addEventListener('submit', (e) => {
    if (!window.confirm(form.dataset.confirm)) {
      e.preventDefault();
      e.stopImmediatePropagation();
    }
  });
});

/* ---------- Prevent double submits (e.g. placing an order twice) ---------- */
$$('form[data-once]').forEach((form) => {
  form.addEventListener('submit', (e) => {
    if (e.defaultPrevented) return;
    // Disable after the browser has captured the clicked button's name/value.
    setTimeout(() => $$('button', form).forEach((b) => { b.disabled = true; }), 0);
  });
});

/* ---------- Auto-submit selects (sort) ---------- */
$$('form[data-autosubmit] select').forEach((sel) => sel.addEventListener('change', () => sel.form.submit()));

/* ---------- Admin: bulk discount ---------- */
const bulk = $('[data-bulk-form]');
if (bulk) {
  const scope = $('[data-bulk-scope]', bulk);
  const count = $('[data-selected-count]', bulk);
  const checks = $$('[data-bulk-check]');
  const refresh = () => {
    const n = checks.filter((c) => c.checked).length;
    count.textContent = scope.value === 'selected' ? `(${n})` : '';
  };
  scope.addEventListener('change', refresh);
  checks.forEach((c) => c.addEventListener('change', refresh));
  refresh();
}

/* ---------- Admin: live final price + image previews ---------- */
const priceInput = $('[data-price]');
const discountInput = $('[data-discount]');
const finalOut = $('[data-final-price]');
if (priceInput && finalOut) {
  const fmt = (piasters) => {
    const amount = (piasters / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return finalOut.dataset.lang === 'en' ? `EGP ${amount}` : `${amount} ج.م`;
  };
  const update = () => {
    const price = Math.round(Number(String(priceInput.value).replace(/,/g, '')) * 100);
    const d = Math.min(90, Math.max(0, Math.trunc(Number(discountInput.value) || 0)));
    finalOut.textContent = price > 0 ? fmt(Math.round((price * (100 - d)) / 100)) : '—';
  };
  priceInput.addEventListener('input', update);
  discountInput.addEventListener('input', update);
  update();
}
const imageInput = $('[data-image-input]');
const preview = $('[data-image-preview]');
// Phone photos are often several MB; the host accepts at most ~4.5 MB per request. Photos are resized
// in the browser (long side 1600 px, JPEG) before uploading, which also makes the store load faster.
const MAX_SIDE = 1600;
const MAX_TOTAL = 4 * 1024 * 1024;
async function shrinkImage(file) {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    if (scale === 1 && file.size < 700 * 1024) return file;
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff'; // JPEG has no transparency
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
    return blob ? new File([blob], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' }) : file;
  } catch {
    return file;
  }
}
if (imageInput && preview) {
  const submitButtons = $$('button:not([form]):not([type=button])', imageInput.form);
  imageInput.addEventListener('change', async () => {
    submitButtons.forEach((b) => { b.disabled = true; });
    const files = await Promise.all([...imageInput.files].map(shrinkImage));
    const dt = new DataTransfer();
    files.forEach((f) => dt.items.add(f));
    imageInput.files = dt.files;
    const tooBig = files.reduce((sum, f) => sum + f.size, 0) > MAX_TOTAL;
    preview.replaceChildren(...files.map((file) => {
      const img = document.createElement('img');
      img.src = URL.createObjectURL(file);
      img.alt = file.name;
      img.className = 'aspect-[3/4] w-full rounded-md object-cover ring-1 ring-line';
      return img;
    }));
    if (tooBig) {
      const note = document.createElement('p');
      note.className = 'col-span-full text-[13px] text-[#B3203A]';
      note.textContent = msg('admin.upload_too_big');
      preview.append(note);
    }
    submitButtons.forEach((b) => { b.disabled = tooBig; });
  });
}
