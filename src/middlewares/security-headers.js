// Response headers that tell browsers and search engines what this site allows.
import helmet from 'helmet';
import { config } from '../config/index.js';
import { storageOrigin } from '../lib/storage.js';

// Leaflet (map on the profile page): only this exact version's folder on unpkg, loaded with SRI.
// Allowing all of unpkg would let an injected tag load any npm package.
const LEAFLET = 'https://unpkg.com/leaflet@1.9.4/dist/';

// Private pages (the dashboard and its sign-in, accounts, cart, checkout, address lookups).
export const PRIVATE_PATHS = ['/admin', '/account', '/cart', '/checkout', '/api'];

export const contentSecurity = helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", LEAFLET],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com', LEAFLET],
      fontSrc: ["'self'", 'https://fonts.gstatic.com'],
      imgSrc: ["'self'", 'data:', 'blob:', 'https://tile.openstreetmap.org', 'https://*.tile.openstreetmap.org', ...(storageOrigin ? [storageOrigin] : [])],
      connectSrc: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
      objectSrc: ["'none'"],
      upgradeInsecureRequests: config.isProd ? [] : null,
    },
  },
  strictTransportSecurity: config.isProd,
});

/** Browser features the store may use: only location (the "use my current location" map button). */
export function permissionsPolicy(req, res, next) {
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(self), payment=(), usb=()');
  next();
}

/** Search engines must never list private pages (robots.txt also asks them not to visit). */
export function noIndex(req, res, next) {
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  next();
}
