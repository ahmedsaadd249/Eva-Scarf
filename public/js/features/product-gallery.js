// The product page's photos: a strip that scrolls sideways, with dots (phones) and thumbnails (larger screens)
// that mark the photo in view; tapping a thumbnail scrolls to its photo.
import { $, $$, isRtl } from '../lib/dom.js';

export function initProductGallery() {
  const gallery = $('[data-gallery]');
  if (!gallery) return;
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
