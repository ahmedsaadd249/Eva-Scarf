// The figures on the dashboard's overview page.
import { LOW_STOCK_LIST_SIZE, LOW_STOCK_THRESHOLD } from '../config/constants.js';
import * as orderRepo from '../repositories/orders.js';
import * as productRepo from '../repositories/products.js';
import * as ratingRepo from '../repositories/ratings.js';
import { countOrdersByStatus, latestOrders } from './orders.js';

// One query after another (not all at once): on Cloudflare a request has a single database connection.
export async function overview() {
  return {
    counts: await countOrdersByStatus(),
    revenue: await orderRepo.deliveredTotals(),
    pending: await orderRepo.openOrdersTotal(),
    rating: await ratingRepo.summary(),
    lowStock: await productRepo.listLowStock(LOW_STOCK_THRESHOLD, LOW_STOCK_LIST_SIZE),
    latest: await latestOrders(),
  };
}
