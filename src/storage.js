// Product photo storage: Supabase Storage in production (a public bucket), the local uploads folder otherwise.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

const { url, serviceKey, bucket } = config.supabase;
export const usesSupabaseStorage = Boolean(url && serviceKey);
const publicPrefix = `${url}/storage/v1/object/public/${bucket}/`;
// Supabase's newer secret keys ("sb_secret_…") go in the apikey header only; the older service_role
// key (a JWT) also goes in Authorization.
const authHeaders = String(serviceKey).startsWith('sb_')
  ? { apikey: serviceKey }
  : { Authorization: `Bearer ${serviceKey}`, apikey: serviceKey };

/** Origin to allow in the image Content-Security-Policy, or null. */
export const storageOrigin = usesSupabaseStorage ? new URL(url).origin : null;

export function newImageName(ext) {
  return `${Date.now().toString(36)}-${crypto.randomBytes(6).toString('base64url')}${ext}`;
}

/** Save an image and return the path/URL to store in product_images.path. */
export async function saveImage(buffer, name, contentType) {
  if (!usesSupabaseStorage) {
    fs.mkdirSync(config.uploadsDir, { recursive: true });
    fs.writeFileSync(path.join(config.uploadsDir, name), buffer);
    return `/uploads/${name}`;
  }
  const res = await fetch(`${url}/storage/v1/object/${bucket}/${name}`, {
    method: 'POST',
    headers: { ...authHeaders, 'Content-Type': contentType, 'Cache-Control': 'max-age=31536000', 'x-upsert': 'false' },
    body: buffer,
  });
  if (!res.ok) throw new Error(`Image upload failed (${res.status}): ${await res.text()}`);
  return publicPrefix + name;
}

/** Delete an image we stored (local file or Supabase object). Sample images and others are left alone. */
export async function deleteImage(stored) {
  if (!stored) return;
  if (stored.startsWith('/uploads/')) {
    fs.rmSync(path.join(config.uploadsDir, path.basename(stored)), { force: true });
  } else if (usesSupabaseStorage && stored.startsWith(publicPrefix)) {
    const name = stored.slice(publicPrefix.length);
    await fetch(`${url}/storage/v1/object/${bucket}/${name}`, { method: 'DELETE', headers: authHeaders }).catch(() => {});
  }
}

/** Create the public bucket if it doesn't exist yet (used by `npm run db:setup`). */
export async function ensureBucket() {
  if (!usesSupabaseStorage) return false;
  const res = await fetch(`${url}/storage/v1/bucket/${bucket}`, { headers: authHeaders });
  if (res.ok) return false;
  const created = await fetch(`${url}/storage/v1/bucket`, {
    method: 'POST',
    headers: { ...authHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: bucket, name: bucket, public: true, file_size_limit: 5 * 1024 * 1024, allowed_mime_types: ['image/jpeg', 'image/png', 'image/webp'] }),
  });
  if (!created.ok) throw new Error(`Could not create storage bucket "${bucket}": ${await created.text()}`);
  return true;
}
