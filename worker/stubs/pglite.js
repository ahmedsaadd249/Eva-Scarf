// Stand-in for @electric-sql/pglite in the Cloudflare build (alias in wrangler.jsonc): the local
// database is a large WebAssembly file that a Worker never uses, since it talks to Supabase through
// Hyperdrive.
export class PGlite {
  constructor() {
    throw new Error('The local database (PGlite) is not available on Cloudflare; the Worker uses Supabase through Hyperdrive.');
  }
}
