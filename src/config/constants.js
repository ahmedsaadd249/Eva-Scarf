// Fixed rules of the store, in one place. Values that differ per environment (secrets, addresses,
// limits the tests lower) live in config/index.js instead. Money is always integer piasters (1 EGP = 100).

export const MINUTE_MS = 60 * 1000;
export const HOUR_MS = 60 * MINUTE_MS;
export const DAY_MS = 24 * HOUR_MS;

// ---------- Products ----------
export const MAX_DISCOUNT_PERCENT = 90;
export const MAX_STOCK = 100_000;
export const PRODUCT_NAME_MAX = 80;
export const PRODUCT_DESCRIPTION_MAX = 2000;
export const LOW_STOCK_THRESHOLD = 3; // the dashboard warns at this many pieces or fewer
export const LOW_STOCK_LIST_SIZE = 12;
export const STORE_PRODUCT_LIMIT = 200; // most products one store page lists
export const SITEMAP_PRODUCT_LIMIT = 1000;

// ---------- Product photos ----------
export const IMAGE_EXTENSIONS = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_IMAGES_PER_UPLOAD = 8;

// ---------- Cart and orders ----------
export const MAX_QTY_PER_ITEM = 20;
export const ORDER_STATUSES = ['processing', 'shipped', 'delivered'];
export const ORDER_NO_PREFIX = 'EVA-';
export const ORDER_NO_OFFSET = 10_000; // order id 1 is EVA-10001
export const OWNER_ORDER_LIST_LIMIT = 300;
export const LATEST_ORDERS_ON_OVERVIEW = 8;

// ---------- Ratings ----------
export const RATING_COMMENT_MAX = 1000;
export const TESTIMONIAL_MIN_STARS = 4;
export const TESTIMONIAL_MIN_COMMENT = 12;
export const TESTIMONIALS_SHOWN = 5;

// ---------- Text typed into search boxes and forms ----------
export const SEARCH_MAX_LENGTH = 60;
export const EMAIL_MAX_LENGTH = 254;
export const ZONE_NAME_MAX = 60;
export const FEE_INPUT_MAX = 12;
export const OFFER_NAME_MAX = 80;
export const OFFER_MAX_QTY = 20;

// ---------- Sessions, caches, logs ----------
export const SESSION_MAX_AGE_MS = 30 * DAY_MS;
export const SESSION_FALLBACK_AGE_MS = DAY_MS; // a session saved without a cookie expiry
export const CACHE_TTL_MS = 5_000; // settings, offers and zones: other running copies see an edit within this
export const EMAIL_LOG_SHOWN = 12;

// Settings the store starts with (rows of the settings table).
export const SETTING_DEFAULTS = { store_email: '' };
