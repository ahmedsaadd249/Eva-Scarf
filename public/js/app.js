// The browser's entry point on every page (partials/scripts.ejs). The features most pages use start right away;
// the others are fetched with import() only on pages that have their element, so no page downloads code it
// doesn't use (customers never download the dashboard's).
import { $ } from './lib/dom.js';
import { initAddToCart } from './features/add-to-cart.js';
import { initCartBadge } from './features/cart-badge.js';
import { initFormBehaviors } from './features/form-behaviors.js';
import { initHeader } from './features/header.js';
import { initToasts } from './features/toasts.js';

initHeader();
initToasts();
initCartBadge();
initAddToCart();
initFormBehaviors();

/** Start a page-only feature: `start(element)` runs only when the page has an element matching `selector`. */
function whenPresent(selector, start) {
  const el = $(selector);
  if (el) start(el);
}
whenPresent('[data-stepper]', () => import('./features/quantity-stepper.js').then((m) => m.initQuantityStepper()));
whenPresent('[data-gallery]', () => import('./features/product-gallery.js').then((m) => m.initProductGallery()));
whenPresent('[data-carousel-controls]', () => import('./features/reviews-carousel.js').then((m) => m.initReviewsCarousel()));
whenPresent('[data-toggle-password], [data-password-rules]', () => import('./features/password-fields.js').then((m) => m.initPasswordFields()));
whenPresent('form[data-validate]', () => import('./features/form-validation.js').then((m) => m.initFormValidation()));
whenPresent('[data-zone-select]', () => import('./features/delivery-fields.js').then((m) => m.initDeliveryFields()));
whenPresent('[data-location-picker]', (el) => import('./location-picker.js').then((m) => m.initLocationPicker(el)));
whenPresent('[data-hero-collage]', (el) => import('./hero-slideshow.js').then((m) => m.initHeroCollage(el)));
whenPresent('[data-otp]', (el) => import('./otp.js').then((m) => m.initOtp(el)));
whenPresent('[data-auth-characters]', (el) => import('./auth-characters.js').then((m) => m.initAuthCharacters(el)));
// The dashboard's
whenPresent('form[data-offer-form]', (el) => import('./features/admin/offer-form.js').then((m) => m.initOfferForm(el)));
whenPresent('[data-bulk-form]', (el) => import('./features/admin/bulk-discount.js').then((m) => m.initBulkDiscount(el)));
whenPresent('[data-final-price]', (el) => import('./features/admin/final-price.js').then((m) => m.initFinalPrice(el)));
whenPresent('[data-image-input]', (el) => import('./features/admin/photo-upload.js').then((m) => m.initPhotoUpload(el)));
