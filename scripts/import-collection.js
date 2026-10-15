// npm run import-collection
// Turns photos in ./Collection into draft (hidden) products the owner can then price and publish.
//   Collection/blue-nile.jpg            -> one product "blue nile" with that photo
//   Collection/Blue Nile/1.jpg, 2.jpg   -> one product "Blue Nile" with both photos (folder = product)
// Photos go to Supabase Storage when it's configured, otherwise to the local uploads folder.
// Files already imported are skipped (remembered in the database), so it is safe to re-run.
// Locally, stop the server first: the built-in local database can only be open in one program at a time.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../src/config.js';
import { closeDb, getSetting, setSetting, tx } from '../src/db.js';
import { uniqueSlug } from '../src/products.js';
import { newImageName, saveImage } from '../src/storage.js';

const SOURCE = path.join(ROOT, 'Collection');
const IMAGE = /\.(jpe?g|png|webp)$/i;
const TYPES = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };

if (!fs.existsSync(SOURCE)) {
  console.log(`No Collection folder at ${SOURCE}`);
  process.exit(0);
}

const manifest = JSON.parse((await getSetting('imported_collection')) || '{}');
const prettyName = (s) => s.replace(IMAGE, '').replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();

// Group: one product per top-level file, or per folder.
const groups = [];
for (const entry of fs.readdirSync(SOURCE, { withFileTypes: true })) {
  if (entry.isFile() && IMAGE.test(entry.name)) {
    groups.push({ name: prettyName(entry.name), files: [path.join(SOURCE, entry.name)] });
  } else if (entry.isDirectory()) {
    const dir = path.join(SOURCE, entry.name);
    const files = fs.readdirSync(dir).filter((f) => IMAGE.test(f)).sort().map((f) => path.join(dir, f));
    if (files.length) groups.push({ name: prettyName(entry.name), files });
  }
}

let created = 0;
let skipped = 0;
for (const group of groups) {
  const key = path.relative(SOURCE, group.files[0]);
  if (manifest[key]) {
    skipped++;
    continue;
  }
  const paths = [];
  for (const file of group.files) {
    const ext = path.extname(file).toLowerCase();
    paths.push(await saveImage(fs.readFileSync(file), newImageName(ext === '.jpeg' ? '.jpg' : ext), TYPES[ext]));
  }
  const id = await tx(async (t) => {
    const product = await t.get(`INSERT INTO products (slug, name_ar, name_en, price, stock, is_active)
                                 VALUES (?, ?, ?, 0, 0, 0) RETURNING id`, [await uniqueSlug(group.name, 0, t), group.name, group.name]);
    for (const [i, p] of paths.entries()) {
      await t.run('INSERT INTO product_images (product_id, path, sort_order) VALUES (?, ?, ?)', [product.id, p, i]);
    }
    return product.id;
  });
  manifest[key] = id;
  created++;
  console.log(`+ "${group.name}" (${paths.length} photo${paths.length > 1 ? 's' : ''}) -> draft product #${id}`);
}

await setSetting('imported_collection', JSON.stringify(manifest));
await closeDb();
console.log(`\n${created} draft products created, ${skipped} already imported.`);
if (created) console.log('Open /admin/products?view=hidden to add names, prices and stock, then tick "Visible in store".');
