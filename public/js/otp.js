// Sign-in code (partials/code-signin.ejs): six boxes over the real input. Once all six digits are in,
// Pac-Man eats them one by one while the code is checked; if it's right a green tick bursts in, then
// the page moves on. A wrong or expired code reloads the page with the server's message.
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const BURST_COLORS = ['#2F7A55', '#5DBB8A', '#E8339A', '#F6C9DD', '#2F7A55'];

/** Latin digits only (Arabic and Persian digits are converted), at most six. */
const digitsOf = (value) => value
  .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
  .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
  .replace(/\D/g, '')
  .slice(0, 6);

export function initOtp(root) {
  const form = root.closest('form');
  const field = root.closest('[data-field]');
  const input = root.querySelector('[data-code-input]');
  const row = root.querySelector('.otp-boxes');
  const boxes = [...root.querySelectorAll('.otp-box')];
  const pac = root.querySelector('.otp-pac');
  const done = field.querySelector('[data-otp-done]');
  let busy = false;

  root.classList.add('otp-on');

  function paint() {
    const value = input.value;
    boxes.forEach((box, i) => {
      box.querySelector('.otp-digit').textContent = value[i] || '';
      box.classList.toggle('is-filled', i < value.length);
      box.classList.toggle('is-active', !busy && document.activeElement === input && i === Math.min(value.length, 5));
    });
  }

  /** Pac-Man appears on the first box and eats its way to the last one. */
  async function eat() {
    const left = row.getBoundingClientRect().left;
    const centres = boxes.map((b) => { const r = b.getBoundingClientRect(); return r.left - left + r.width / 2; });
    pac.style.setProperty('--x', `${centres[0]}px`);
    void pac.offsetWidth; // start from the first box
    pac.classList.add('is-on');
    boxes[0].classList.add('is-eaten');
    await wait(280);
    for (let i = 1; i < boxes.length; i++) {
      pac.style.setProperty('--x', `${centres[i]}px`);
      await wait(130);
      boxes[i].classList.add('is-eaten');
      await wait(40);
    }
    await wait(160);
    pac.classList.add('is-full');
    await wait(220);
  }

  /** The green tick, with a burst of little pieces around it. */
  async function celebrate() {
    field.classList.add('otp-verified');
    form.classList.add('otp-verified');
    const links = form.nextElementSibling; // "send a new code" / "change email"
    if (links && !links.matches('form')) links.style.display = 'none';
    done.hidden = false;
    const burst = done.querySelector('.otp-burst');
    for (let i = 0; i < 22; i++) {
      const piece = document.createElement('i');
      const angle = (Math.PI * 2 * i) / 22 + Math.random() * 0.4;
      const distance = 55 + Math.random() * 60;
      piece.style.cssText = `--dx:${Math.cos(angle) * distance}px;--dy:${Math.sin(angle) * distance}px;--r:${Math.round(Math.random() * 360)}deg;`
        + `--s:${4 + Math.round(Math.random() * 5)}px;--c:${BURST_COLORS[i % BURST_COLORS.length]};animation-delay:${120 + Math.random() * 120}ms`;
      burst.append(piece);
    }
    await wait(1500);
  }

  async function check() {
    if (busy) return;
    busy = true;
    input.readOnly = true;
    paint();
    const answer = fetch(form.action, {
      method: 'POST',
      body: new URLSearchParams(new FormData(form)),
      headers: { Accept: 'application/json' },
      credentials: 'same-origin',
    }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    if (!reduceMotion) await eat();
    const result = await answer;
    // No answer (offline, or too many tries): send the form the ordinary way so the server's page shows.
    if (!result) return form.submit();
    if (result.ok && !reduceMotion) await celebrate();
    go(result.redirect);
  }

  /** Open the next page. For this same page, without its #section: a #-only change would just scroll. */
  function go(to) {
    const target = new URL(to, window.location.href);
    if (target.pathname === window.location.pathname && target.search === window.location.search) target.hash = '';
    window.location.assign(target.href);
  }

  input.addEventListener('input', () => {
    const digits = digitsOf(input.value);
    if (input.value !== digits) input.value = digits;
    root.classList.remove('otp-error');
    paint();
    if (digits.length === 6) check();
  });
  input.addEventListener('focus', paint);
  input.addEventListener('blur', paint);
  // Typing always continues at the end, like real boxes.
  input.addEventListener('click', () => input.setSelectionRange(input.value.length, input.value.length));
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (digitsOf(input.value).length === 6) {
      check();
    } else {
      root.classList.remove('otp-error');
      void root.offsetWidth; // replay the shake
      root.classList.add('otp-error');
      input.focus();
    }
  });
  paint();
}
