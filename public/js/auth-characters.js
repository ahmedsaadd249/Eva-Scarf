// The characters beside the login / register forms. Their eyes follow the pointer, and they react to
// the form: look at the field being typed in, turn shy while the password is hidden, peek when it is
// shown, cheer on submit. The looks themselves are CSS states (site.css, ".ac"); this file picks the
// state and moves the pupils. Touch screens get the focus/typing reactions only; reduced motion turns
// off eye tracking and blinking.

// Where each character looks when it isn't looking at something on the page. x > 0 is toward the form.
const AWAY = [-0.8, -0.6];
const DOWN = [-0.15, 0.95];
const UP_FORWARD = [0.7, -0.4];
const REST = [0.25, 0.15];

export function initAuthCharacters(root) {
  const form = root.closest('[data-auth-card]')?.querySelector('form');
  if (!form || root.dataset.ready) return;
  root.dataset.ready = '1';

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  const mirrored = document.documentElement.dir !== 'rtl'; // the drawing is flipped in English (see site.css)

  const eyes = [...root.querySelectorAll('.eye')].map((eye) => ({
    ch: eye.closest('[data-ch]').dataset.ch,
    anchor: eye.querySelector('.eye-anchor'),
    pupil: eye.querySelector('.pupil'),
    max: Number(eye.dataset.max) || 3,
  }));
  const passwordInputs = [...form.querySelectorAll('[data-toggle-password]')]
    .map((btn) => ({ input: document.getElementById(btn.dataset.togglePassword), btn }))
    .filter((p) => p.input);

  let hadError = root.dataset.state === 'error'; // until the customer starts typing again
  let submitted = false;
  let pointer = null;
  let frame = 0;

  const passwordFor = (el) => passwordInputs.find((p) => p.input === el || p.btn === el)?.input || null;
  const isTextField = (el) => el && form.contains(el) && el.tagName === 'INPUT' && !['hidden', 'checkbox', 'radio', 'submit'].includes(el.type);

  function currentState() {
    if (submitted) return 'happy';
    if (hadError) return 'error';
    const active = document.activeElement;
    const password = passwordFor(active);
    if (password) return password.type === 'text' ? 'peek' : 'shy';
    if (isTextField(active)) return 'typing';
    return 'idle';
  }

  /** Roughly where the text cursor is in a field: further along as more is typed. */
  function caretPoint(input) {
    const r = input.getBoundingClientRect();
    const share = Math.min(1, input.value.length / 28);
    const rtl = getComputedStyle(input).direction === 'rtl';
    const span = Math.max(0, r.width - 32) * share;
    return { x: rtl ? r.right - 16 - span : r.left + 16 + span, y: r.top + r.height / 2 };
  }

  /** A point on the screen, or a fixed direction (x toward the form), for this character's eyes. */
  function lookFor(ch, state) {
    const active = document.activeElement;
    switch (state) {
      case 'typing': return { point: caretPoint(active) };
      case 'shy': return { dir: AWAY };
      case 'peek': return ch === 'dark' || ch === 'bean' ? { point: caretPoint(passwordFor(active)) } : { dir: AWAY };
      case 'error': return { dir: DOWN };
      case 'happy': return { dir: UP_FORWARD };
      default: return pointer ? { point: pointer } : { dir: REST };
    }
  }

  function render() {
    frame = 0;
    const state = currentState();
    if (root.dataset.state !== state) root.dataset.state = state;
    for (const eye of eyes) {
      const look = lookFor(eye.ch, state);
      let [dx, dy] = look.dir || [0, 0];
      if (look.point) {
        const r = eye.anchor.getBoundingClientRect();
        const vx = look.point.x - (r.left + r.width / 2);
        const vy = look.point.y - (r.top + r.height / 2);
        const dist = Math.hypot(vx, vy) || 1;
        const reach = Math.min(1, dist / 140); // a pointer right next to the eye moves it less
        dx = (vx / dist) * reach * (mirrored ? -1 : 1);
        dy = (vy / dist) * reach;
      }
      eye.pupil.style.transform = `translate(${(dx * eye.max).toFixed(2)}px, ${(dy * eye.max).toFixed(2)}px)`;
    }
  }
  const schedule = () => { if (!frame) frame = requestAnimationFrame(render); };

  form.addEventListener('focusin', schedule);
  form.addEventListener('focusout', () => requestAnimationFrame(schedule)); // after focus has moved on
  form.addEventListener('input', () => {
    hadError = false;
    schedule();
  });
  // The show/hide button is handled in app.js first; read the new state after it.
  passwordInputs.forEach(({ btn }) => btn.addEventListener('click', () => requestAnimationFrame(schedule)));
  // Runs only when the form really goes (app.js stops invalid submits before this listener).
  form.addEventListener('submit', (e) => {
    if (e.defaultPrevented) return;
    submitted = true;
    schedule();
  });
  window.addEventListener('resize', schedule, { passive: true });
  window.addEventListener('scroll', schedule, { passive: true });

  if (!reducedMotion && finePointer) {
    window.addEventListener('pointermove', (e) => {
      pointer = { x: e.clientX, y: e.clientY };
      if (root.dataset.state === 'idle') schedule();
    }, { passive: true });
    document.documentElement.addEventListener('pointerleave', () => {
      pointer = null;
      schedule();
    });
  }

  if (!reducedMotion) {
    const blink = () => {
      setTimeout(() => {
        if (!document.hidden) {
          root.classList.add('is-blinking');
          setTimeout(() => root.classList.remove('is-blinking'), 140);
        }
        blink();
      }, 3000 + Math.random() * 3000);
    };
    blink();
  }

  render();
}
