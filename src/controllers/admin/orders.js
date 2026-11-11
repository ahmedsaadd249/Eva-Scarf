import { sendStatusEmail } from '../../services/emails.js';
import {
  countOrdersByStatus, getOrder, listOrdersForOwner, OrderError, setOrderStatus, STATUSES,
} from '../../services/orders.js';
import { searchText, toInt } from '../../utils/form.js';
import { adminPage } from './render.js';

export async function list(req, res) {
  const status = STATUSES.includes(req.query.status) ? req.query.status : '';
  const search = searchText(req.query.q);
  const orders = await listOrdersForOwner({ status, search });
  adminPage(res, 'orders', { title: res.locals.t('admin.orders'), orders, status, search, counts: await countOrdersByStatus() });
}

export async function show(req, res, next) {
  const order = await getOrder('id', toInt(req.params.id));
  if (!order) return next();
  adminPage(res, 'order', { title: `${res.locals.t('orders.order')} ${order.order_no}`, order });
}

/** Processing → Shipped → Delivered; each change emails the customer. */
export async function changeStatus(req, res) {
  const id = toInt(req.params.id);
  const status = String(req.body.status);
  try {
    if (await setOrderStatus(id, status)) {
      sendStatusEmail(id);
      req.flash('success', 'admin.status_changed', { status: res.locals.t(`status.${status}`) });
    }
  } catch (err) {
    if (!(err instanceof OrderError)) throw err;
    req.flash('error', err.key);
  }
  res.redirect(`/admin/orders/${id}`);
}
