// The cart page, the slide-in cart panel, and changing what's in the cart. The panel's script asks for
// JSON; plain form posts get a redirect and a flash message.
import { sessionCart } from '../middlewares/session.js';
import { cartCount, loadCart, MAX_QTY_PER_ITEM, setCartQty } from '../services/cart.js';
import { getProductById } from '../services/products.js';
import { wantsJson } from '../utils/http.js';

const cartFor = (req) => loadCart(sessionCart(req), { userZoneId: req.user?.zone_id });
const productIdFrom = (req) => Math.trunc(Number(req.body.product_id));
const countReply = (req) => ({ ok: true, count: cartCount(req.session.cart) });

export async function show(req, res) {
  const { lines, totals, notices, zone } = await cartFor(req);
  res.page('shop/cart', { title: res.locals.t('cart.title'), lines, totals, notices, zone });
}

/** The big cart panel's content (public/js/cart-panel.js): the same lines and totals as the cart page. */
export async function panel(req, res) {
  const { lines, totals, notices, zone } = await cartFor(req);
  res.render('partials/cart-panel', { ...res.locals, lines, totals, notices, zone }, (err, html) => {
    if (err) return res.status(500).send('');
    res.set('Cache-Control', 'no-store').send(html);
  });
}

export async function add(req, res) {
  const { t, plabel } = res.locals;
  const id = productIdFrom(req);
  const qty = Math.max(1, Math.trunc(Number(req.body.qty) || 1));
  const product = await getProductById(id);

  const fail = (key, vars) => {
    if (wantsJson(req)) return res.status(409).json({ ok: false, message: t(key, vars) });
    req.flash('error', key, vars);
    res.redirect(product ? `/product/${product.slug}` : '/shop');
  };

  if (!product || !product.is_active || product.is_archived) return fail('cart.error_unavailable');
  if (product.stock <= 0) return fail('cart.error_sold_out');

  const cart = sessionCart(req);
  const current = cart[id] ?? 0;
  const next = Math.min(current + qty, product.stock, MAX_QTY_PER_ITEM);
  if (next === current) return fail('cart.error_max', { qty: current });
  setCartQty(cart, id, next);

  if (wantsJson(req)) return res.json({ ...countReply(req), message: t('cart.added', { name: plabel(product) }) });
  req.flash('success', 'cart.added', { name: plabel(product) });
  res.redirect(req.body.return_to === 'cart' ? '/cart' : `/product/${product.slug}`);
}

export async function update(req, res) {
  const id = productIdFrom(req);
  const product = await getProductById(id);
  if (!product) {
    setCartQty(sessionCart(req), id, 0); // unknown product: never store it in the cart
    return wantsJson(req) ? res.json(countReply(req)) : res.redirect('/cart');
  }
  let qty = Math.trunc(Number(req.body.qty) || 0);
  if (qty > product.stock) {
    qty = product.stock;
    if (!wantsJson(req)) req.flash('info', 'cart.notice_reduced_simple', { qty });
  }
  setCartQty(sessionCart(req), id, qty);
  // The cart panel sends these in the background and then reloads its content.
  if (wantsJson(req)) return res.json(countReply(req));
  res.redirect('/cart');
}

export function remove(req, res) {
  setCartQty(sessionCart(req), productIdFrom(req), 0);
  if (wantsJson(req)) return res.json(countReply(req));
  res.redirect('/cart');
}
