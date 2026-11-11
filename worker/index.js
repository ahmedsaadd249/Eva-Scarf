// Cloudflare Workers entry point: runs the same Express app as `node serve.mjs`, through Cloudflare's
// Node.js HTTP bridge. Files in public/ never reach this code: Cloudflare serves them first
// ("assets" in wrangler.jsonc).
import './register.js'; // must stay first: see the note in register.js
import { httpServerHandler } from 'cloudflare:node';
import { app } from '../src/app.js';
import { RequestScope, requestScope } from '../src/lib/platform.js';

const PORT = 3000; // only a name for the bridge; nothing listens on a real port
app.listen(PORT);
const handler = httpServerHandler({ port: PORT });

export default {
  async fetch(request, env, ctx) {
    // Express reads the visitor's address and https from these headers ("trust proxy" in src/app.js),
    // for rate limits and the secure session cookie. Set them here so a visitor can't fake them.
    const headers = new Headers(request.headers);
    headers.set('x-forwarded-for', request.headers.get('cf-connecting-ip') ?? '');
    headers.set('x-forwarded-proto', new URL(request.url).protocol.slice(0, -1));
    const forwarded = new Request(request, { headers });

    // The request's database connection lives in this scope and is closed once the response and
    // any background emails are done.
    const scope = new RequestScope();
    try {
      return await requestScope.run(scope, () => handler.fetch(forwarded, env, ctx));
    } finally {
      ctx.waitUntil(scope.finish());
    }
  },
};
