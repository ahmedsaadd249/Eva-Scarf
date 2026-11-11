// Home hero (partials/hero-collage.ejs): the newest tarhas build up once their photos have loaded, then take
// turns in the big middle spot by themselves every 2 seconds. Tapping a photo puts that tarha in the cart:
// the photo lifts off and grows in the middle of the screen, the big cart panel slides in (cart-panel.js),
// and the photo flies into its line in the cart. Each card's place comes from its slot class; a turn swaps
// the classes and animates every card from where it was to where it now is (transform and opacity only).
// Visitors who turn motion off get no turns and no flying photo (the panel still opens).
import { csrf } from './lib/dom.js';

const AUTO_MS = 2000;
const BUILD_MS = 2400; // the build animation in site.css ("hero collage") is over by then
const MOVE_MS = 600;
const GROW_MS = 480;
const FLY_MS = 560;
const EASE_OUT = 'cubic-bezier(.16, 1, .3, 1)'; // --ease-out in site.css
const EASE_IN_OUT = 'cubic-bezier(.65, 0, .35, 1)';
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** True for keyboard focus (not the focus a mouse click or a tap leaves on a link). */
function keyboardFocus(el) {
  try {
    return el.matches(':focus-visible');
  } catch {
    return false; // older browsers without :focus-visible
  }
}

export function initHeroCollage(root) {
  const stage = root.querySelector('[data-hc-stage]');
  const cards = [...root.querySelectorAll('[data-hc-card]')]; // newest first
  const n = cards.length;
  let centre = 0; // the tarha in the middle
  let built = false;

  // Where tarha i sits: 0 = start side (the previous one), 1 = middle, 2 = end side (the next one).
  const positionOf = (i) => {
    const k = (i - centre + n) % n;
    return k === 0 ? 1 : k === 1 ? 2 : 0;
  };

  /** The next tarha comes to the middle: in Arabic everything moves right, in English left. */
  function turn() {
    // Where every card is on screen right now, then their new places.
    const before = cards.map((card, i) => ({ box: card.getBoundingClientRect(), pos: positionOf(i) }));
    cards.forEach((card) => card.getAnimations().forEach((a) => a.cancel()));
    centre = (centre + 1) % n;
    cards.forEach((card, i) => {
      const pos = positionOf(i);
      card.classList.toggle('hc-centre', pos === 1);
      card.classList.toggle('hc-side', pos !== 1);
      card.classList.toggle('hc-side-start', pos === 0);
      card.classList.toggle('hc-side-end', pos === 2);
    });
    cards.forEach((card, i) => {
      const { box: first, pos } = before[i];
      if (Math.abs(pos - positionOf(i)) === 2) {
        // From one side to the other: fade in at the new place rather than fly across the middle.
        card.animate([{ opacity: 0 }, { opacity: 1 }], { duration: MOVE_MS, easing: 'ease-out' });
        return;
      }
      const last = card.getBoundingClientRect();
      const move = `translate(${first.left - last.left}px, ${first.bottom - last.bottom}px) scale(${first.width / last.width})`;
      card.animate(
        [{ transformOrigin: 'left bottom', transform: move }, { transformOrigin: 'left bottom', transform: 'none' }],
        { duration: MOVE_MS, easing: EASE_OUT },
      );
    });
  }

  let timer = 0;
  let zooming = false;
  const holds = new Set(); // why it is waiting right now: 'touch' (a finger on it), 'focus' (keyboard)
  function schedule() {
    clearTimeout(timer);
    if (reduceMotion || n < 2 || !built || zooming || holds.size || document.hidden) return;
    timer = setTimeout(() => {
      turn();
      schedule();
    }, AUTO_MS);
  }
  const hold = (reason, on) => {
    if (on) holds.add(reason);
    else holds.delete(reason);
    schedule();
  };
  stage.addEventListener('touchstart', () => hold('touch', true), { passive: true });
  stage.addEventListener('touchend', () => hold('touch', false));
  stage.addEventListener('touchcancel', () => hold('touch', false));
  root.addEventListener('focusin', (e) => { if (keyboardFocus(e.target)) hold('focus', true); });
  root.addEventListener('focusout', (e) => { if (!root.contains(e.relatedTarget)) hold('focus', false); });
  document.addEventListener('visibilitychange', schedule);

  // ---------- Tap a photo: into the cart, with the photo growing and flying into the cart panel ----------
  const cartPanel = import('./cart-panel.js'); // ready for the first tap

  /** A copy of the card's photo, on top of everything, that grows to a big view in the middle of the screen. */
  function liftPhoto(card) {
    const box = card.getBoundingClientRect();
    const layer = document.createElement('div');
    layer.className = 'hc-zoom';
    layer.setAttribute('aria-hidden', 'true');
    const photo = card.querySelector('img').cloneNode();
    photo.className = 'hc-zoom-photo';
    photo.removeAttribute('fetchpriority');
    Object.assign(photo.style, { left: `${box.left}px`, top: `${box.top}px`, width: `${box.width}px`, height: `${box.height}px` });
    layer.append(photo);
    document.body.append(layer);
    card.style.visibility = 'hidden';
    // Big: 70% of the screen's height (same 3:4 shape, no stretching), never wider than 86% of its width.
    const height = Math.min(window.innerHeight * 0.7, (window.innerWidth * 0.86) / (box.width / box.height));
    const scale = height / box.height;
    const big = `translate(${(window.innerWidth - box.width * scale) / 2 - box.left}px, ${(window.innerHeight - height) / 2 - box.top}px) scale(${scale})`;
    const grown = photo.animate([{ transform: 'none' }, { transform: big }], { duration: GROW_MS, easing: EASE_IN_OUT, fill: 'forwards' }).finished;
    return {
      grown,
      /** Fly into `target` (the tarha's photo in the cart panel), or fade away if it isn't there. */
      async into(target) {
        if (!target) {
          await photo.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 260, fill: 'forwards' }).finished;
          return;
        }
        const to = target.getBoundingClientRect();
        target.style.visibility = 'hidden';
        const small = `translate(${to.left - box.left}px, ${to.top - box.top}px) scale(${to.width / box.width})`;
        await photo.animate([{ transform: big }, { transform: small }], { duration: FLY_MS, easing: EASE_IN_OUT, fill: 'forwards' }).finished;
        target.style.visibility = '';
      },
      remove() {
        layer.remove();
        card.style.visibility = '';
      },
    };
  }

  async function addToCart(card) {
    zooming = true; // no turns while the cart is open
    clearTimeout(timer);
    cards.forEach((c) => c.getAnimations().forEach((a) => a.finish()));
    const productId = card.dataset.productId;
    const added = fetch('/cart/add', {
      method: 'POST',
      headers: { Accept: 'application/json', 'x-csrf-token': csrf() },
      body: new URLSearchParams({ product_id: productId, qty: '1' }),
    }).then((r) => r.json()).catch(() => ({ ok: false }));
    const lifted = reduceMotion ? null : liftPhoto(card);
    const { createCartPanel } = await cartPanel;
    const panel = createCartPanel({
      onClose: () => {
        zooming = false;
        schedule();
      },
    });
    const result = await added;
    if (result.ok) window.dispatchEvent(new CustomEvent('cart:count', { detail: result.count }));
    await Promise.all([panel.load(), lifted?.grown]);
    if (!result.ok && result.message) panel.message(result.message); // e.g. sold out: the cart shows as it is
    await panel.show();
    if (lifted) {
      await lifted.into(result.ok ? panel.thumb(productId) : null);
      lifted.remove();
    }
  }

  stage.addEventListener('click', (e) => {
    const card = e.target.closest('[data-hc-card]');
    // New tab or window (Ctrl/⌘/Shift/middle click): just follow the link to the tarha.
    if (!card || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    if (!zooming) addToCart(card);
  });

  // The build, once the photos are in (at most 2.5 s wait); the turns start when it is over.
  const loaded = cards.map((card) => card.querySelector('img')).map((img) => (img.complete ? Promise.resolve()
    : new Promise((r) => { img.addEventListener('load', r, { once: true }); img.addEventListener('error', r, { once: true }); })));
  Promise.race([Promise.all(loaded), wait(2500)]).then(async () => {
    root.classList.replace('hc-wait', 'hc-play');
    await wait(reduceMotion ? 0 : BUILD_MS);
    // End the build: its CSS animations would hold the cards in place.
    root.classList.replace('hc-play', 'hc-done');
    built = true;
    schedule();
  });
}
