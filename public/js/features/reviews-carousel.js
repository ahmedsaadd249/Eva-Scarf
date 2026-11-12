// The previous / next buttons of the reviews strip on the home page (the strip itself also scrolls by swiping).
import { $, $$, isRtl } from '../lib/dom.js';

export function initReviewsCarousel() {
  $$('[data-carousel-controls]').forEach((controls) => {
    const track = $(`[data-carousel="${controls.dataset.carouselControls}"]`);
    if (!track) return;
    const step = () => (track.firstElementChild?.getBoundingClientRect().width || 300) + 16;
    const go = (dir) => track.scrollBy({ left: dir * step() * (isRtl ? -1 : 1), behavior: 'smooth' });
    $('[data-carousel-prev]', controls)?.addEventListener('click', () => go(-1));
    $('[data-carousel-next]', controls)?.addEventListener('click', () => go(1));
  });
}
