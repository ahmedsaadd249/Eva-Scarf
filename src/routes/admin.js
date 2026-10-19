import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import multer from 'multer';
import { config } from '../config.js';
import { all, get, getSetting, run, setSetting, tx } from '../db.js';
import { endOtherSessions, hashPassword, requireAdmin, verifyCsrf, verifyPassword } from '../auth.js';
import { sendStatusEmail } from '../emails.js';
import { isSmtpConfigured } from '../mailer.js';
import { getOrder, OrderError, setOrderStatus, STATUSES } from '../orders.js';
import { clampDiscount, finalUnitPrice, piastersToInput, toPiasters } from '../pricing.js';
import { getProductById, getProductImages, uniqueSlug } from '../products.js';
import { getOffer, invalidateOffers, listOffers, validateOffer } from '../offers.js';
import { getZone, groupByCity, invalidateZones, listZones } from '../zones.js';
import { deleteImage, newImageName, saveImage } from '../storage.js';
import { emailError, normalizeEmail, passwordError } from '../../public/js/validation.js';

const router = Router();
router.use(requireAdmin);

const adminPage = (res, view, locals = {}) => res.page(`admin/${view}`, { layout: 'layouts/admin', ...locals });
const toInt = (v, fallback = 0) => (Number.isFinite(Number(v)) && String(v).trim() !== '' ? Math.trunc(Number(v)) : fallback);
const asArray = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);

// ---------- Image uploads ----------
// Files are kept in memory, checked, and only stored (Supabase Storage or the local uploads folder)
// once the rest of the form is valid, so a rejected form never leaves stray files behind.
const MIME_EXT = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 8 },
  fileFilter: (req, file, cb) => cb(null, Boolean(MIME_EXT[file.mimetype])),
});

/** Check the file really is an image by its first bytes, not just the name/type it claimed. */
function looksLikeImage(buf) {
  const jpeg = buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
  const png = buf.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  const webp = buf.subarray(0, 4).toString() === 'RIFF' && buf.subarray(8, 12).toString() === 'WEBP';
  return jpeg || png || webp;
}

function uploadImages(req, res, next) {
  upload.array('images', 8)(req, res, (err) => {
    if (err) req.uploadError = err.code === 'LIMIT_FILE_SIZE' ? 'admin.error_image_size' : 'admin.error_image';
    next();
  });
}

/** Valid uploaded image files, or sets req.uploadError. */
function validUploads(req) {
  const files = req.files ?? [];
  if (files.some((f) => !looksLikeImage(f.buffer))) req.uploadError = 'admin.error_image';
  return req.uploadError ? [] : files;
}

const storeUploads = (files) => Promise.all(files.map((f) => saveImage(f.buffer, newImageName(MIME_EXT[f.mimetype]), f.mimetype)));

// ---------- Overview ----------
const ORDER_LIST = `
  SELECT o.*, r.stars AS rating_stars,
         (SELECT SUM(qty)::int FROM order_items WHERE order_id = o.id) AS item_count,
         (SELECT image FROM order_items WHERE order_id = o.id ORDER BY id LIMIT 1) AS image,
         (SELECT swatch FROM order_items WHERE order_id = o.id ORDER BY id LIMIT 1) AS swatch
  FROM orders o LEFT JOIN ratings r ON r.order_id = o.id`;

async function statusCounts() {
  const counts = Object.fromEntries(STATUSES.map((st) => [st, 0]));
  for (const row of await all('SELECT status, COUNT(*)::int AS n FROM orders GROUP BY status')) counts[row.status] = row.n;
  return counts;
}

router.get('/', async (req, res) => {
  adminPage(res, 'overview', {
    title: res.locals.t('admin.overview'),
    counts: await statusCounts(),
    revenue: await get("SELECT COALESCE(SUM(total), 0)::int AS total, COUNT(*)::int AS n FROM orders WHERE status = 'delivered'"),
    pending: await get("SELECT COALESCE(SUM(total), 0)::int AS total FROM orders WHERE status != 'delivered'"),
    rating: await get('SELECT AVG(stars)::float AS avg, COUNT(*)::int AS n FROM ratings'),
    lowStock: await all(`SELECT p.*, (SELECT path FROM product_images WHERE product_id = p.id ORDER BY sort_order, id LIMIT 1) AS image
                         FROM products p WHERE p.is_archived = 0 AND p.is_active = 1 AND p.stock <= 3 ORDER BY p.stock, p.id LIMIT 12`),
    latest: await all(`${ORDER_LIST} ORDER BY o.id DESC LIMIT 8`),
  });
});

// ---------- Orders ----------
router.get('/orders', async (req, res) => {
  const status = STATUSES.includes(req.query.status) ? req.query.status : '';
  const search = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 60) : '';
  const where = [];
  const params = [];
  if (status) {
    where.push('o.status = ?');
    params.push(status);
  }
  if (search) {
    // Postgres's default LIKE escape character is the backslash.
    const like = `%${search.replace(/[\\%_]/g, (m) => '\\' + m)}%`;
    where.push('(o.order_no ILIKE ? OR o.customer_name ILIKE ? OR o.phone_primary LIKE ? OR o.customer_email ILIKE ? OR o.village LIKE ?)');
    params.push(like, like, like, like, like);
  }
  const orders = await all(`${ORDER_LIST} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY o.id DESC LIMIT 300`, params);
  adminPage(res, 'orders', { title: res.locals.t('admin.orders'), orders, status, search, counts: await statusCounts() });
});

router.get('/orders/:id', async (req, res, next) => {
  const order = await getOrder('id', toInt(req.params.id));
  if (!order) return next();
  adminPage(res, 'order', { title: `${res.locals.t('orders.order')} ${order.order_no}`, order });
});

router.post('/orders/:id/status', async (req, res) => {
  const id = toInt(req.params.id);
  try {
    if (await setOrderStatus(id, String(req.body.status))) {
      sendStatusEmail(id);
      req.flash('success', 'admin.status_changed', { status: res.locals.t(`status.${req.body.status}`) });
    }
  } catch (err) {
    if (!(err instanceof OrderError)) throw err;
    req.flash('error', err.key);
  }
  res.redirect(`/admin/orders/${id}`);
});

// ---------- Products ----------
router.get('/products', async (req, res) => {
  const view = ['active', 'hidden', 'archived'].includes(req.query.view) ? req.query.view : 'all';
  const filter = {
    all: 'p.is_archived = 0',
    active: 'p.is_archived = 0 AND p.is_active = 1',
    hidden: 'p.is_archived = 0 AND p.is_active = 0',
    archived: 'p.is_archived = 1',
  }[view];
  const products = (await all(`
    SELECT p.*,
           (SELECT path FROM product_images WHERE product_id = p.id ORDER BY sort_order, id LIMIT 1) AS image,
           (SELECT COUNT(*)::int FROM order_items WHERE product_id = p.id) AS times_ordered
    FROM products p
    WHERE ${filter} ORDER BY p.created_at DESC, p.id DESC`))
    .map((p) => ({ ...p, final_price: finalUnitPrice(p.price, p.discount_percent) }));
  adminPage(res, 'products', { title: res.locals.t('admin.products'), products, view, piastersToInput });
});

// Names are optional (some tarhas have none; the store then shows no name).
function readProductForm(body) {
  const values = {
    name_ar: String(body.name_ar ?? '').trim().slice(0, 80),
    name_en: String(body.name_en ?? '').trim().slice(0, 80),
    description_ar: String(body.description_ar ?? '').trim().slice(0, 2000),
    description_en: String(body.description_en ?? '').trim().slice(0, 2000),
    price_input: String(body.price ?? '').trim(),
    discount_percent: toInt(body.discount_percent),
    stock: toInt(body.stock, -1),
    is_featured: body.is_featured ? 1 : 0,
    is_active: body.is_active ? 1 : 0,
  };
  const errors = {};
  values.price = toPiasters(values.price_input);
  if (values.price == null || values.price <= 0) errors.price = 'admin.error_price';
  if (values.discount_percent < 0 || values.discount_percent > 90) errors.discount_percent = 'admin.error_discount';
  if (values.stock < 0 || values.stock > 100000) errors.stock = 'admin.error_stock';
  return { values, errors };
}

async function productFormPage(res, locals) {
  const { product } = locals;
  if (product && product.times_ordered === undefined) {
    // Shown in the delete confirmation: past orders keep their copy of the product.
    product.times_ordered = (await get('SELECT COUNT(*)::int AS n FROM order_items WHERE product_id = ?', [product.id])).n;
  }
  adminPage(res, 'product-form', { errors: {}, images: [], ...locals });
}

router.get('/products/new', (req, res) => {
  return productFormPage(res, {
    title: res.locals.t('admin.product_new'),
    product: null,
    values: { is_active: 1, discount_percent: 0, stock: 0, price_input: '' },
  });
});

// Registered before '/products/:id' so this path isn't taken for a product id.
router.post('/products/bulk-discount', async (req, res) => {
  const percent = toInt(req.body.percent, -1);
  if (percent < 0 || percent > 90) {
    req.flash('error', 'admin.error_discount');
    return res.redirect('/admin/products');
  }
  let changes = 0;
  if (req.body.scope === 'all') {
    ({ changes } = await run('UPDATE products SET discount_percent = ?, updated_at = now() WHERE is_archived = 0', [clampDiscount(percent)]));
  } else {
    const ids = asArray(req.body.ids).map((v) => toInt(v)).filter(Boolean);
    if (ids.length) {
      ({ changes } = await run('UPDATE products SET discount_percent = ?, updated_at = now() WHERE id = ANY(?::int[])', [clampDiscount(percent), ids]));
    }
  }
  if (!changes) req.flash('error', 'admin.bulk_none');
  else req.flash('success', percent ? 'admin.bulk_applied' : 'admin.bulk_cleared', { n: changes, percent });
  res.redirect('/admin/products');
});

router.post('/products', uploadImages, verifyCsrf, async (req, res) => {
  const { values, errors } = readProductForm(req.body);
  const files = validUploads(req);
  if (req.uploadError) errors.images = req.uploadError;
  if (Object.keys(errors).length) {
    return productFormPage(res.status(422), { title: res.locals.t('admin.product_new'), product: null, values, errors });
  }
  const paths = await storeUploads(files);
  const id = await tx(async (t) => {
    const product = await t.get(`
      INSERT INTO products (slug, name_ar, name_en, description_ar, description_en,
                            price, discount_percent, stock, is_featured, is_active)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`, [
      await uniqueSlug(values.name_en || values.name_ar, 0, t), values.name_ar || values.name_en, values.name_en || values.name_ar,
      values.description_ar, values.description_en,
      values.price, values.discount_percent, values.stock, values.is_featured, values.is_active,
    ]);
    for (const [i, p] of paths.entries()) {
      await t.run('INSERT INTO product_images (product_id, path, sort_order) VALUES (?, ?, ?)', [product.id, p, i]);
    }
    return product.id;
  });
  req.flash('success', 'admin.product_created');
  res.redirect(`/admin/products/${id}/edit`);
});

router.get('/products/:id/edit', async (req, res, next) => {
  const product = await getProductById(toInt(req.params.id));
  if (!product) return next();
  return productFormPage(res, {
    title: res.locals.alabel(product),
    product,
    images: await getProductImages(product.id),
    values: { ...product, price_input: piastersToInput(product.price) },
  });
});

router.post('/products/:id', uploadImages, verifyCsrf, async (req, res, next) => {
  const product = await getProductById(toInt(req.params.id));
  if (!product) return next();
  const { values, errors } = readProductForm(req.body);
  const files = validUploads(req);
  if (req.uploadError) errors.images = req.uploadError;
  if (Object.keys(errors).length) {
    return productFormPage(res.status(422), {
      title: res.locals.alabel(product), product, images: await getProductImages(product.id), values, errors,
    });
  }
  const paths = await storeUploads(files);
  await tx(async (t) => {
    await t.run(`UPDATE products SET name_ar = ?, name_en = ?, description_ar = ?, description_en = ?,
                   price = ?, discount_percent = ?, stock = ?, is_featured = ?, is_active = ?, updated_at = now()
                 WHERE id = ?`, [
      values.name_ar || values.name_en, values.name_en || values.name_ar, values.description_ar, values.description_en,
      values.price, values.discount_percent, values.stock, values.is_featured, values.is_active, product.id,
    ]);
    const start = ((await t.get('SELECT MAX(sort_order) AS m FROM product_images WHERE product_id = ?', [product.id]))?.m ?? -1) + 1;
    for (const [i, p] of paths.entries()) {
      await t.run('INSERT INTO product_images (product_id, path, sort_order) VALUES (?, ?, ?)', [product.id, p, start + i]);
    }
  });
  req.flash('success', 'admin.product_saved');
  res.redirect(`/admin/products/${product.id}/edit`);
});

/** Inline edit from the products table: price, discount, stock and visibility. */
router.post('/products/:id/quick', async (req, res, next) => {
  const product = await getProductById(toInt(req.params.id));
  if (!product) return next();
  const price = toPiasters(req.body.price);
  const discount = toInt(req.body.discount_percent, -1);
  const stock = toInt(req.body.stock, -1);
  if (price == null || price <= 0 || discount < 0 || discount > 90 || stock < 0 || stock > 100000) {
    req.flash('error', 'admin.error_quick', { name: res.locals.alabel(product) });
  } else {
    await run('UPDATE products SET price = ?, discount_percent = ?, stock = ?, is_active = ?, updated_at = now() WHERE id = ?',
      [price, discount, stock, req.body.is_active ? 1 : 0, product.id]);
    req.flash('success', 'admin.product_saved_named', { name: res.locals.alabel(product) });
  }
  res.redirect(String(req.body.return_to || '').startsWith('/admin/products') ? req.body.return_to : '/admin/products');
});

// Back to the product list the owner came from (keeps the All / Visible / Hidden / Archived tab).
const productListUrl = (req) => {
  const back = String(req.body.return_to || '');
  return /^\/admin\/products(\?view=[a-z]+)?$/.test(back) ? back : '/admin/products';
};

/** Archive: hide the product from the store but keep it; it can be restored from the Archived tab. */
router.post('/products/:id/archive', async (req, res, next) => {
  const product = await getProductById(toInt(req.params.id));
  if (!product) return next();
  await run('UPDATE products SET is_archived = 1, is_active = 0, is_featured = 0, updated_at = now() WHERE id = ?', [product.id]);
  req.flash('success', 'admin.product_archived', { name: res.locals.alabel(product) });
  res.redirect(productListUrl(req));
});

/**
 * Delete a product for good. Past orders don't change: each order keeps its own copy of the
 * product's name, price and photo (order_items), and photos a past order still shows are kept.
 */
router.post('/products/:id/delete', async (req, res, next) => {
  const product = await getProductById(toInt(req.params.id));
  if (!product) return next();
  const ordered = await get('SELECT 1 FROM order_items WHERE product_id = ? LIMIT 1', [product.id]);
  const images = await getProductImages(product.id);
  await run('DELETE FROM products WHERE id = ?', [product.id]); // photos rows go with it; order items keep their copy
  for (const img of images) {
    const inUse = await get('SELECT 1 FROM product_images WHERE path = ? UNION SELECT 1 FROM order_items WHERE image = ?', [img.path, img.path]);
    if (!inUse) await deleteImage(img.path);
  }
  req.flash('success', ordered ? 'admin.product_deleted_ordered' : 'admin.product_deleted', { name: res.locals.alabel(product) });
  res.redirect(productListUrl(req));
});

router.post('/products/:id/restore', async (req, res, next) => {
  const product = await getProductById(toInt(req.params.id));
  if (!product) return next();
  await run('UPDATE products SET is_archived = 0, updated_at = now() WHERE id = ?', [product.id]);
  req.flash('success', 'admin.product_restored', { name: res.locals.alabel(product) });
  res.redirect(`/admin/products/${product.id}/edit`);
});

router.post('/products/:id/images/:imageId/delete', async (req, res) => {
  const productId = toInt(req.params.id);
  const image = await get('SELECT * FROM product_images WHERE id = ? AND product_id = ?', [toInt(req.params.imageId), productId]);
  if (image) {
    await run('DELETE FROM product_images WHERE id = ?', [image.id]);
    // Keep the file if another product (or a past order) still points at it.
    const inUse = await get('SELECT 1 FROM product_images WHERE path = ? UNION SELECT 1 FROM order_items WHERE image = ?', [image.path, image.path]);
    if (!inUse) await deleteImage(image.path);
    req.flash('success', 'admin.image_deleted');
  }
  res.redirect(`/admin/products/${productId}/edit`);
});

router.post('/products/:id/images/:imageId/main', async (req, res) => {
  const productId = toInt(req.params.id);
  const min = (await get('SELECT MIN(sort_order) AS m FROM product_images WHERE product_id = ?', [productId]))?.m ?? 0;
  await run('UPDATE product_images SET sort_order = ? WHERE id = ? AND product_id = ?', [min - 1, toInt(req.params.imageId), productId]);
  req.flash('success', 'admin.image_main');
  res.redirect(`/admin/products/${productId}/edit`);
});

// ---------- Settings ----------
async function settingsLocals(res) {
  return {
    title: res.locals.t('admin.settings'),
    smtpReady: isSmtpConfigured(),
    mailFrom: config.mailFrom,
    emailLog: await all('SELECT * FROM email_log ORDER BY id DESC LIMIT 12'),
    values: { store_email: await getSetting('store_email') },
    errors: {},
    passwordErrors: {},
  };
}

router.get('/settings', async (req, res) => {
  adminPage(res, 'settings', await settingsLocals(res));
});

router.post('/settings', async (req, res) => {
  const values = { store_email: normalizeEmail(req.body.store_email) };
  const errors = {};
  if (values.store_email && emailError(values.store_email)) errors.store_email = 'errors.email_invalid';
  if (Object.keys(errors).length) return adminPage(res.status(422), 'settings', { ...(await settingsLocals(res)), values, errors });
  await setSetting('store_email', values.store_email);
  req.flash('success', 'admin.settings_saved');
  res.redirect('/admin/settings');
});

// The owner's password (the owner account has no customer profile page, so it's changed here).
// Counts are per server instance, like the sign-in limit.
const passwordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: Number(process.env.AUTH_RATE_LIMIT || 20),
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  handler: (req, res) => res.status(429).page('error', { title: res.locals.t('errors.rate_title'), message: res.locals.t('errors.rate') }),
});

router.post('/settings/password', passwordLimiter, async (req, res) => {
  const errors = {};
  const next = String(req.body.new_password ?? '');
  if (!(await verifyPassword(String(req.body.current_password ?? ''), req.user.password_hash))) errors.current_password = 'errors.password_current';
  const passErr = passwordError(next);
  if (passErr) errors.new_password = passErr;
  if (next !== String(req.body.new_password_confirm ?? '')) errors.new_password_confirm = 'errors.password_mismatch';
  if (Object.keys(errors).length) {
    return adminPage(res.status(422), 'settings', { ...(await settingsLocals(res)), passwordErrors: errors });
  }
  await run('UPDATE users SET password_hash = ? WHERE id = ?', [await hashPassword(next), req.user.id]);
  await endOtherSessions(req.user.id, req.sessionID); // signed out everywhere else
  req.flash('success', 'profile.password_changed');
  res.redirect('/admin/settings');
});

// ---------- Offers (free delivery over an amount, buy X get Y free, % off the order) ----------
const offerFormPage = (res, locals) => adminPage(res, 'offer-form', { errors: {}, ...locals });
// The form shows the minimum in pounds.
const offerFormValues = (offer) => ({ ...offer, min_subtotal_input: offer.min_subtotal ? piastersToInput(offer.min_subtotal) : '' });
const offerParams = (v) => [v.type, v.name_ar, v.name_en, v.min_subtotal, v.buy_qty, v.get_qty, v.percent, v.is_active];

router.get('/offers', async (req, res) => {
  adminPage(res, 'offers', { title: res.locals.t('admin.offers'), offers: await listOffers() });
});

router.get('/offers/new', (req, res) => {
  offerFormPage(res, { title: res.locals.t('admin.offer_new'), offer: null, values: { type: 'free_delivery', min_subtotal_input: '', is_active: 0 } });
});

router.post('/offers', async (req, res) => {
  const { values, errors } = validateOffer(req.body);
  if (Object.keys(errors).length) {
    return offerFormPage(res.status(422), {
      title: res.locals.t('admin.offer_new'), offer: null, values: { ...values, min_subtotal_input: String(req.body.min_subtotal ?? '') }, errors,
    });
  }
  await run('INSERT INTO offers (type, name_ar, name_en, min_subtotal, buy_qty, get_qty, percent, is_active) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', offerParams(values));
  invalidateOffers();
  req.flash('success', 'admin.offer_created', { name: res.locals.offerLabel(values) });
  res.redirect('/admin/offers');
});

router.get('/offers/:id/edit', async (req, res, next) => {
  const offer = await getOffer(req.params.id);
  if (!offer) return next();
  offerFormPage(res, { title: res.locals.offerLabel(offer), offer, values: offerFormValues(offer) });
});

router.post('/offers/:id', async (req, res, next) => {
  const offer = await getOffer(req.params.id);
  if (!offer) return next();
  const { values, errors } = validateOffer(req.body);
  if (Object.keys(errors).length) {
    return offerFormPage(res.status(422), {
      title: res.locals.offerLabel(offer), offer, values: { ...values, min_subtotal_input: String(req.body.min_subtotal ?? '') }, errors,
    });
  }
  await run(`UPDATE offers SET type = ?, name_ar = ?, name_en = ?, min_subtotal = ?, buy_qty = ?, get_qty = ?, percent = ?, is_active = ?,
               updated_at = now() WHERE id = ?`, [...offerParams(values), offer.id]);
  invalidateOffers();
  req.flash('success', 'admin.offer_saved', { name: res.locals.offerLabel(values) });
  res.redirect('/admin/offers');
});

router.post('/offers/:id/toggle', async (req, res, next) => {
  const offer = await getOffer(req.params.id);
  if (!offer) return next();
  const on = offer.is_active ? 0 : 1;
  await run('UPDATE offers SET is_active = ?, updated_at = now() WHERE id = ?', [on, offer.id]);
  invalidateOffers();
  req.flash('success', on ? 'admin.offer_activated' : 'admin.offer_deactivated', { name: res.locals.offerLabel(offer) });
  res.redirect('/admin/offers');
});

/** Past orders keep their own copy of the offers they used, so deleting an offer doesn't change them. */
router.post('/offers/:id/delete', async (req, res, next) => {
  const offer = await getOffer(req.params.id);
  if (!offer) return next();
  await run('DELETE FROM offers WHERE id = ?', [offer.id]);
  invalidateOffers();
  req.flash('success', 'admin.offer_deleted', { name: res.locals.offerLabel(offer) });
  res.redirect('/admin/offers');
});

// ---------- Delivery neighborhoods ----------
// Fee inputs are named fee[z<ID>]: purely numeric keys would be turned into an array by the form parser.
const feeInput = (z) => (z.fee == null ? '' : piastersToInput(z.fee));

async function deliveryPage(req, res, locals = {}) {
  const zones = await listZones();
  adminPage(res, 'delivery', {
    title: res.locals.t('admin.delivery'),
    groups: groupByCity(zones, req.lang),
    cities: [...new Set(zones.map((z) => z.city_ar))],
    feeInputs: Object.fromEntries(zones.map((z) => [z.id, feeInput(z)])),
    feeErrors: {},
    addValues: {},
    addErrors: {},
    ...locals,
  });
}

router.get('/delivery', (req, res) => deliveryPage(req, res));

router.post('/delivery', async (req, res) => {
  const sent = req.body.fee && typeof req.body.fee === 'object' ? req.body.fee : {};
  const zones = await listZones();
  const updates = [];
  const feeInputs = Object.fromEntries(zones.map((z) => [z.id, feeInput(z)]));
  const feeErrors = {};
  for (const zone of zones) {
    const raw = sent[`z${zone.id}`];
    if (raw === undefined) continue;
    const text = String(raw).trim();
    feeInputs[zone.id] = text;
    const fee = text === '' ? null : toPiasters(text);
    if (text !== '' && fee == null) feeErrors[zone.id] = true;
    else updates.push([fee, zone.id]);
  }
  if (Object.keys(feeErrors).length) return deliveryPage(req, res.status(422), { feeInputs, feeErrors });
  await tx(async (t) => {
    for (const [fee, id] of updates) await t.run('UPDATE zones SET fee = ? WHERE id = ?', [fee, id]);
  });
  invalidateZones();
  req.flash('success', 'admin.zones_saved');
  res.redirect('/admin/delivery');
});

router.post('/delivery/add', async (req, res) => {
  const clean = (v, max) => String(v ?? '').trim().replace(/\s+/g, ' ').slice(0, max);
  const values = { city_ar: clean(req.body.city_ar, 60), name_ar: clean(req.body.name_ar, 60), name_en: clean(req.body.name_en, 60), fee: clean(req.body.fee, 12) };
  const errors = {};
  if (!values.city_ar) errors.city_ar = 'errors.required';
  if (!values.name_ar) errors.name_ar = 'errors.required';
  const fee = values.fee === '' ? null : toPiasters(values.fee);
  if (values.fee !== '' && fee == null) errors.fee = 'admin.error_fee';
  if (!errors.name_ar && (await get('SELECT 1 FROM zones WHERE city_ar = ? AND name_ar = ?', [values.city_ar, values.name_ar]))) {
    errors.name_ar = 'admin.error_zone_exists';
  }
  if (Object.keys(errors).length) return deliveryPage(req, res.status(422), { addValues: values, addErrors: errors });
  // A neighborhood in a city that already exists reuses that city's English name.
  const cityEn = (await get("SELECT city_en FROM zones WHERE city_ar = ? AND city_en != '' LIMIT 1", [values.city_ar]))?.city_en ?? '';
  const sort = ((await get('SELECT MAX(sort_order) AS m FROM zones'))?.m ?? 0) + 1;
  await run('INSERT INTO zones (city_ar, city_en, name_ar, name_en, fee, sort_order) VALUES (?, ?, ?, ?, ?, ?)',
    [values.city_ar, cityEn, values.name_ar, values.name_en, fee, sort]);
  invalidateZones();
  req.flash('success', 'admin.zone_added', { name: values.name_ar });
  res.redirect('/admin/delivery');
});

router.post('/delivery/:id/delete', async (req, res) => {
  const zone = await getZone(toInt(req.params.id));
  if (zone) {
    // Customers who chose it are asked to pick another neighborhood; past orders keep the name.
    await run('DELETE FROM zones WHERE id = ?', [zone.id]);
    invalidateZones();
    req.flash('success', 'admin.zone_deleted', { name: res.locals.L(zone, 'name') });
  }
  res.redirect('/admin/delivery');
});

export default router;
