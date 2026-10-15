// npm run db:setup
// Prepares a (new) Supabase project: creates the tables and the starting neighborhood list,
// the public "product-images" storage bucket, and the owner account from ADMIN_EMAIL/ADMIN_PASSWORD.
// Safe to run again: nothing that already exists is changed.
import { config } from '../src/config.js';
import { closeDb, setupDatabase } from '../src/db.js';
import { seedAdmin } from '../src/seed.js';
import { ensureBucket, usesSupabaseStorage } from '../src/storage.js';

console.log(config.databaseUrl ? `Database: ${new URL(config.databaseUrl).hostname}` : `Database: local (${config.pgliteDir})`);
await setupDatabase();
console.log('✓ Tables ready');

if (usesSupabaseStorage) {
  console.log((await ensureBucket()) ? `✓ Storage bucket "${config.supabase.bucket}" created` : `✓ Storage bucket "${config.supabase.bucket}" exists`);
} else {
  console.log('- SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set: photos will be stored in the local uploads folder');
}

await seedAdmin();
await closeDb();
console.log('Done.');
