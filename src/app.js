// The Express app: middlewares in order, then the routes, then the 404 and error pages.
// The same app runs locally (serve.mjs), in the tests, and on Cloudflare (worker/index.js).
import path from 'node:path';
import express from 'express';
import { config, ROOT } from './config/index.js';
import { trackResponse } from './lib/platform.js';
import { TemplateView } from './lib/templates.js';
import { loadUser } from './middlewares/auth.js';
import { csrf } from './middlewares/csrf.js';
import { errorHandler, notFound } from './middlewares/errors.js';
import { language } from './middlewares/i18n.js';
import { pageHelpers } from './middlewares/page.js';
import {
  contentSecurity, noIndex, permissionsPolicy, PRIVATE_PATHS,
} from './middlewares/security-headers.js';
import { sessions } from './middlewares/session.js';
import { storeLocals } from './middlewares/store-locals.js';
import routes from './routes/index.js';

const FORM_BODY_LIMIT = '200kb';
const JSON_BODY_LIMIT = '50kb';
const STATIC_MAX_AGE = config.isProd ? '7d' : 0;

export const app = express();
app.set('view engine', 'ejs');
app.set('views', path.join(ROOT, 'src', 'views'));
app.set('view', TemplateView); // views by name, compiled once (src/lib/templates.js); works on Cloudflare too
app.disable('x-powered-by');
if (config.isProd) app.set('trust proxy', 1);
app.use(trackResponse); // Cloudflare: keep the request's database connection until the response is done

app.use(contentSecurity);
app.use(permissionsPolicy);
app.use(PRIVATE_PATHS, noIndex);

// On Cloudflare the files in public/ are served before a request ever reaches the app (wrangler.jsonc "assets").
if (!config.onCloudflare) {
  app.use(express.static(path.join(ROOT, 'public'), { maxAge: STATIC_MAX_AGE }));
  app.use('/uploads', express.static(config.uploadsDir, { maxAge: STATIC_MAX_AGE })); // local photos (production uses Supabase Storage)
}

app.use(express.urlencoded({ extended: true, limit: FORM_BODY_LIMIT }));
app.use(express.json({ limit: JSON_BODY_LIMIT }));
app.use(sessions);
app.use(pageHelpers);
app.use(loadUser);
app.use(language);
app.use(storeLocals);
app.use(csrf);

app.use(routes);

app.use(notFound);
app.use(errorHandler);
