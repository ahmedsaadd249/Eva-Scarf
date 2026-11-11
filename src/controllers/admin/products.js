// Dashboard → Products: the table, the add/edit form, photos, quick edits, bulk discounts, archive and delete.
import { uploadedImages } from '../../middlewares/uploads.js';
import { piastersToInput } from '../../services/pricing.js';
import { getProductById, getProductImages } from '../../services/products.js';
import {
  applyDiscount, archiveProduct, countTimesOrdered, createProduct, deleteProduct, deleteProductPhoto,
  listProductsForOwner, makeMainPhoto, OWNER_VIEW_KEYS, quickEditProduct, restoreProduct, updateProduct,
} from '../../services/product-admin.js';
import { hasErrors, toInt } from '../../utils/form.js';
import { validateBulkDiscount, validateProduct, validateQuickEdit } from '../../validators/product.js';
import { adminPage } from './render.js';

const PRODUCTS = '/admin/products';
const editUrl = (id) => `${PRODUCTS}/${id}/edit`;

/** Back to the product list the owner came from (keeps the All / Visible / Hidden / Archived tab). */
function productListUrl(req) {
  const back = String(req.body.return_to || '');
  return /^\/admin\/products(\?view=[a-z]+)?$/.test(back) ? back : PRODUCTS;
}

/** Loads the product named in the address onto req.product, or answers 404. */
export async function loadProduct(req, res, next) {
  req.product = await getProductById(toInt(req.params.id));
  next(req.product ? undefined : 'route');
}

export async function list(req, res) {
  const view = OWNER_VIEW_KEYS.includes(req.query.view) ? req.query.view : 'all';
  const products = await listProductsForOwner(view);
  adminPage(res, 'products', { title: res.locals.t('admin.products'), products, view, piastersToInput });
}

async function formPage(res, locals) {
  const { product } = locals;
  // Shown in the delete confirmation: past orders keep their copy of the product.
  if (product && product.times_ordered === undefined) product.times_ordered = await countTimesOrdered(product.id);
  adminPage(res, 'product-form', { errors: {}, images: [], ...locals });
}

export function newForm(req, res) {
  return formPage(res, {
    title: res.locals.t('admin.product_new'),
    product: null,
    values: { is_active: 1, discount_percent: 0, stock: 0, price_input: '' },
  });
}

/** The form's fields and photos, with any upload problem added to the errors. */
function readForm(req) {
  const { values, errors } = validateProduct(req.body);
  if (req.uploadError) errors.images = req.uploadError;
  return { values, errors, photos: uploadedImages(req) };
}

export async function create(req, res) {
  const { values, errors, photos } = readForm(req);
  if (hasErrors(errors)) {
    return formPage(res.status(422), { title: res.locals.t('admin.product_new'), product: null, values, errors });
  }
  const id = await createProduct(values, photos);
  req.flash('success', 'admin.product_created');
  res.redirect(editUrl(id));
}

export async function editForm(req, res) {
  const { product } = req;
  return formPage(res, {
    title: res.locals.alabel(product),
    product,
    images: await getProductImages(product.id),
    values: { ...product, price_input: piastersToInput(product.price) },
  });
}

export async function update(req, res) {
  const { product } = req;
  const { values, errors, photos } = readForm(req);
  if (hasErrors(errors)) {
    return formPage(res.status(422), {
      title: res.locals.alabel(product), product, images: await getProductImages(product.id), values, errors,
    });
  }
  await updateProduct(product.id, values, photos);
  req.flash('success', 'admin.product_saved');
  res.redirect(editUrl(product.id));
}

/** Inline edit from the products table. */
export async function quickEdit(req, res) {
  const { product } = req;
  const name = res.locals.alabel(product);
  const values = validateQuickEdit(req.body);
  if (!values) {
    req.flash('error', 'admin.error_quick', { name });
  } else {
    await quickEditProduct(product.id, values);
    req.flash('success', 'admin.product_saved_named', { name });
  }
  res.redirect(String(req.body.return_to || '').startsWith(PRODUCTS) ? req.body.return_to : PRODUCTS);
}

export async function bulkDiscount(req, res) {
  const choice = validateBulkDiscount(req.body);
  if (!choice) {
    req.flash('error', 'admin.error_discount');
    return res.redirect(PRODUCTS);
  }
  const changed = await applyDiscount(choice.percent, choice.ids);
  if (!changed) req.flash('error', 'admin.bulk_none');
  else req.flash('success', choice.percent ? 'admin.bulk_applied' : 'admin.bulk_cleared', { n: changed, percent: choice.percent });
  res.redirect(PRODUCTS);
}

/** Archive: hide the product from the store but keep it; it can be restored from the Archived tab. */
export async function archive(req, res) {
  await archiveProduct(req.product.id);
  req.flash('success', 'admin.product_archived', { name: res.locals.alabel(req.product) });
  res.redirect(productListUrl(req));
}

export async function restore(req, res) {
  await restoreProduct(req.product.id);
  req.flash('success', 'admin.product_restored', { name: res.locals.alabel(req.product) });
  res.redirect(editUrl(req.product.id));
}

export async function remove(req, res) {
  const { wasOrdered } = await deleteProduct(req.product.id);
  req.flash('success', wasOrdered ? 'admin.product_deleted_ordered' : 'admin.product_deleted', { name: res.locals.alabel(req.product) });
  res.redirect(productListUrl(req));
}

export async function removePhoto(req, res) {
  const productId = toInt(req.params.id);
  if (await deleteProductPhoto(productId, toInt(req.params.imageId))) req.flash('success', 'admin.image_deleted');
  res.redirect(editUrl(productId));
}

export async function makeMain(req, res) {
  const productId = toInt(req.params.id);
  await makeMainPhoto(productId, toInt(req.params.imageId));
  req.flash('success', 'admin.image_main');
  res.redirect(editUrl(productId));
}
