// Prepares the app for Cloudflare before it is loaded: worker/index.js imports this file first, and
// ES modules run their imports in order, so everything here happens before src/app.js runs.
// Keep src/lib/i18n.js (and anything else that reads files while loading) out of this file's imports:
// they must load after the bundled files are registered below.
import { env, waitUntil } from 'cloudflare:workers';
import files from './files.generated.js';
import { setBackgroundRunner, useEmbeddedFiles } from '../src/lib/platform.js';
import { compileAllTemplates } from '../src/lib/templates.js';
import { usePerRequestConnections } from '../src/lib/db.js';

// Templates, translations and the email logo, bundled at build time (there's no disk to read from).
useEmbeddedFiles(files);
// Compiling a template creates code from text, which Cloudflare allows only during startup.
compileAllTemplates();
// Emails go out after the response; waitUntil keeps the Worker running until they're sent.
setBackgroundRunner(waitUntil);
// One database connection per request, through Hyperdrive (binding "HYPERDRIVE" in wrangler.jsonc).
// Its separate fields rather than its connectionString: a password with characters like @ or / doesn't
// always survive inside a URL.
usePerRequestConnections(() => {
  const h = env.HYPERDRIVE;
  if (!h) throw new Error('The HYPERDRIVE binding is missing: check "hyperdrive" in wrangler.jsonc.');
  return { host: h.host, port: Number(h.port), user: h.user, password: h.password, database: h.database };
});
