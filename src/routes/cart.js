import { Router } from 'express';
import { cartCount, getCart, loadCart, MAX_QTY_PER_ITEM, setCartQty } from '../cart.js';
import { getProductById } from '../products.js';

const router = Router();

const wantsJson = (req) => req.accepts(['html', 'json']) === 'json';

router.get('/cart', async (req, res) => {
  const { lines, totals, notices, zone } = await loadCart(req);
  res.page('shop/cart', { title: res.locals.t('cart.title'), lines, totals, notices, zone });
});

router.post('/cart/add', async (req, res) => {
  const { t, plabel } = res.locals;
  const id = Math.trunc(Number(req.body.product_id));
  const qty = Math.max(1, Math.trunc(Number(req.body.qty) || 1));
  const product = await getProductById(id);

  const fail = (key, vars) => {
    if (wantsJson(req)) return res.status(409).json({ ok: false, message: t(key, vars) });
    req.flash('error', key, vars);
    res.redirect(product ? `/product/${product.slug}` : '/shop');
  };

  if (!product || !product.is_active || product.is_archived) return fail('cart.error_unavailable');
  if (product.stock <= 0) return fail('cart.error_sold_out');

  const current = getCart(req)[id] ?? 0;
  const next = Math.min(current + qty, product.stock, MAX_QTY_PER_ITEM);
  if (next === current) return fail('cart.error_max', { qty: current });
  setCartQty(req, id, next);

  const message = t('cart.added', { name: plabel(product) });
  if (wantsJson(req)) return res.json({ ok: true, count: cartCount(req), message });
  req.flash('success', 'cart.added', { name: plabel(product) });
  res.redirect(req.body.return_to === 'cart' ? '/cart' : `/product/${product.slug}`);
});

router.post('/cart/update', async (req, res) => {
  const id = Math.trunc(Number(req.body.product_id));
  const product = await getProductById(id);
  let qty = Math.trunc(Number(req.body.qty) || 0);
  if (product && qty > product.stock) {
    qty = product.stock;
    req.flash('info', 'cart.notice_reduced_simple', { qty });
  }
  setCartQty(req, id, qty);
  res.redirect('/cart');
});

router.post('/cart/remove', (req, res) => {
  setCartQty(req, Math.trunc(Number(req.body.product_id)), 0);
  res.redirect('/cart');
});

export default router;
