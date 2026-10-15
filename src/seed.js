// npm run seed              creates the owner account (from .env). Safe on the live store.
// npm run seed -- --samples  also adds the 14 demo tarhas (for a fresh local copy only).
// Safe to run again: existing categories, products and users are left alone.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config, ROOT } from './config.js';
import { closeDb, get, run, tx } from './db.js';
import { hashPassword } from './auth.js';
import { emailError, normalizeEmail, passwordError } from '../public/js/validation.js';

export async function seedAdmin() {
  const email = normalizeEmail(config.admin.email);
  const password = config.admin.password;
  if (!email || !password) {
    console.log('! ADMIN_EMAIL / ADMIN_PASSWORD not set, so no owner account was created.');
    return;
  }
  if (emailError(email)) throw new Error(`ADMIN_EMAIL "${email}" is not a valid email address.`);
  if (passwordError(password)) throw new Error('ADMIN_PASSWORD must be 8+ characters with upper and lower case, a number and a symbol.');

  const existing = await get('SELECT id, role FROM users WHERE email = ?', [email]);
  if (existing) {
    if (existing.role !== 'admin') await run("UPDATE users SET role = 'admin' WHERE id = ?", [existing.id]);
    console.log(`= Owner account ${email} already exists.`);
    return;
  }
  await run("INSERT INTO users (email, password_hash, full_name, role, lang) VALUES (?, ?, ?, 'admin', 'ar')",
    [email, await hashPassword(password), config.admin.name]);
  console.log(`+ Owner account created: ${email}`);
}

export async function seedCatalog() {
  const catalog = JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'sample-catalog.json'), 'utf8'));
  const hasSamples = fs.existsSync(path.join(ROOT, 'public', 'samples'));
  const added = await tx(async (t) => {
    for (const [i, c] of catalog.categories.entries()) {
      await t.run(`INSERT INTO categories (slug, name_ar, name_en, image, sort_order) VALUES (?, ?, ?, ?, ?)
                   ON CONFLICT (slug) DO NOTHING`, [c.slug, c.name_ar, c.name_en, hasSamples ? `/samples/category-${c.slug}.jpg` : null, i]);
    }
    let n = 0;
    for (const [i, p] of catalog.products.entries()) {
      if (await t.get('SELECT 1 FROM products WHERE slug = ?', [p.slug])) continue;
      const categoryId = (await t.get('SELECT id FROM categories WHERE slug = ?', [p.category]))?.id ?? null;
      const product = await t.get(`
        INSERT INTO products (slug, name_ar, name_en, description_ar, description_en, category_id, swatch,
                              price, discount_percent, stock, is_featured, is_active, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, now() - make_interval(mins => ?)) RETURNING id`, [
        p.slug, p.name_ar, p.name_en, p.description_ar, p.description_en, categoryId, p.swatch,
        p.price * 100, p.discount, p.stock, p.featured ? 1 : 0, catalog.products.length - i,
      ]);
      if (hasSamples) {
        for (const [sort, nImg] of [1, 2].entries()) {
          await t.run('INSERT INTO product_images (product_id, path, sort_order) VALUES (?, ?, ?)', [product.id, `/samples/${p.slug}-${nImg}.jpg`, sort]);
        }
      }
      n++;
    }
    return n;
  });
  console.log(`+ ${added} demo products added (${catalog.products.length - added} already existed).`);
}

// Run as a script (not when imported by db-setup).
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await seedAdmin();
  if (process.argv.includes('--samples')) await seedCatalog();
  else console.log('(Demo products skipped; add --samples to include them.)');
  await closeDb();
  console.log('Seed complete.');
}
