// The owner's work on the catalog (dashboard → Products): adding and editing tarhas and their photos,
// quick edits from the table, discounts for many at once, archiving and deleting.
import { IMAGE_EXTENSIONS } from '../config/constants.js';
import { tx } from '../lib/db.js';
import { deleteImage, newImageName, saveImage } from '../lib/storage.js';
import * as imageRepo from '../repositories/product-images.js';
import * as productRepo from '../repositories/products.js';
import { clampDiscount, finalUnitPrice } from './pricing.js';
import { uniqueSlug } from './products.js';

export const { OWNER_VIEW_KEYS } = productRepo;

export async function listProductsForOwner(view) {
  return (await productRepo.listForOwner(view)).map((p) => ({ ...p, final_price: finalUnitPrice(p.price, p.discount_percent) }));
}

/** How many order lines name this product (shown before deleting it: past orders keep their copy). */
export const countTimesOrdered = (productId) => productRepo.countOrderLines(productId);

/** Store uploaded photos (Supabase Storage or the local folder); returns their paths. */
const storePhotos = (files) => Promise.all(
  files.map((f) => saveImage(f.buffer, newImageName(IMAGE_EXTENSIONS[f.mimetype]), f.mimetype)),
);

// Names are optional; one language's name stands in for the other's.
const productRow = (v) => ({
  ...v,
  name_ar: v.name_ar || v.name_en,
  name_en: v.name_en || v.name_ar,
});

/** Add a product with its photos. Returns the new id. */
export async function createProduct(values, photos) {
  const paths = await storePhotos(photos);
  return tx(async (t) => {
    const slug = await uniqueSlug(values.name_en || values.name_ar, 0, t);
    const id = await productRepo.insert({ ...productRow(values), slug }, t);
    for (const [i, path] of paths.entries()) await imageRepo.add(id, path, i, t);
    return id;
  });
}

/** Save the edit form; new photos go after the existing ones. */
export async function updateProduct(productId, values, photos) {
  const paths = await storePhotos(photos);
  await tx(async (t) => {
    await productRepo.update(productId, productRow(values), t);
    const start = await imageRepo.nextSortOrder(productId, t);
    for (const [i, path] of paths.entries()) await imageRepo.add(productId, path, start + i, t);
  });
}

export const quickEditProduct = (productId, values) => productRepo.quickUpdate(productId, values);
export const archiveProduct = (productId) => productRepo.archive(productId);
export const restoreProduct = (productId) => productRepo.restore(productId);

/** Delete a stored photo file unless another product or a past order still shows it. */
async function deletePhotoIfUnused(path) {
  if (!(await imageRepo.isPathInUse(path))) await deleteImage(path);
}

/**
 * Delete a product for good. Past orders don't change: each keeps its own copy of the product's name,
 * price and photo, and photos a past order still shows are kept. Returns whether it had been ordered.
 */
export async function deleteProduct(productId) {
  const wasOrdered = await productRepo.hasBeenOrdered(productId);
  const images = await imageRepo.listForProduct(productId);
  await productRepo.remove(productId);
  for (const img of images) await deletePhotoIfUnused(img.path);
  return { wasOrdered };
}

/** Returns false when the photo isn't this product's. */
export async function deleteProductPhoto(productId, imageId) {
  const image = await imageRepo.findForProduct(imageId, productId);
  if (!image) return false;
  await imageRepo.remove(image.id);
  await deletePhotoIfUnused(image.path);
  return true;
}

export const makeMainPhoto = (productId, imageId) => imageRepo.moveToFront(productId, imageId);

/** Same discount for every product (`ids` null) or the chosen ones. Returns how many changed. */
export async function applyDiscount(percent, ids) {
  if (ids && !ids.length) return 0;
  return productRepo.setDiscount(clampDiscount(percent), ids);
}
