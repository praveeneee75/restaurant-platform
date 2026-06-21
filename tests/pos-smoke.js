const http = require('http');
const path = require('path');

process.env.PORT = process.env.POS_SMOKE_PORT || '3399';
process.env.POS_HEARTBEAT_DISABLED = '1';

const posRoot = path.join(__dirname, '..', 'pos-app');
const { openDatabase } = require(path.join(posRoot, 'backend/db/database'));
require(path.join(posRoot, 'backend/server'));

const port = Number(process.env.PORT);
const restaurantId = process.env.POS_SMOKE_RESTAURANT_ID || 'RESTOPALMSY';
const actor = { role: 'OWNER', name: 'Smoke Test' };

function request(method, targetPath, body) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const payload = body ? JSON.stringify(body) : null;
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      path: targetPath,
      method,
      timeout: 10000,
      headers: payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body: data, ms: Date.now() - startedAt }));
    });
    req.on('timeout', () => req.destroy(new Error(`${method} ${targetPath} timeout`)));
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function json(method, targetPath, body) {
  const res = await request(method, targetPath, body);
  const data = JSON.parse(res.body);
  if (res.status >= 400 || data.success === false) throw new Error(`${targetPath}: ${data.message || res.status}`);
  return data;
}

async function main() {
  await new Promise((resolve) => setTimeout(resolve, 1500));

  const pages = ['/login.html', '/admin.html', '/pos-live.html', '/orders.html', '/kds.html', '/customer-display.html', '/waiter.html'];
  const scripts = ['/js/kds.js', '/js/orders.js', '/js/admin-dashboard.js', '/js/pos-live.js'];
  for (const page of pages) {
    const res = await request('GET', page);
    if (res.status !== 200 || !res.body.startsWith('<!DOCTYPE html>') || res.body.includes('\u0000')) {
      throw new Error(`Page failed: ${page}`);
    }
  }
  for (const script of scripts) {
    const res = await request('GET', script);
    if (res.status !== 200 || res.body.includes('\u0000')) throw new Error(`Script failed: ${script}`);
  }

  const health = await json('GET', '/health');
  const admin = await json('GET', `/admin/bootstrap?restaurantId=${restaurantId}`);
  const pos = await json('GET', `/pos/bootstrap?restaurantId=${restaurantId}&role=OWNER`);
  const liveOrders = await json('GET', `/orders/live?restaurantId=${restaurantId}`);
  const orderTypes = await json('GET', `/reports/order-types?restaurantId=${restaurantId}`);
  await json('GET', `/delivery/partners?restaurantId=${restaurantId}`);
  const tableOne = await request('GET', `/orders/open?restaurantId=${restaurantId}&tableId=1`);
  const tableTwo = await request('GET', `/orders/open?restaurantId=${restaurantId}&tableId=2`);
  if (tableOne.ms > Number(process.env.POS_TABLE_SELECT_BUDGET_MS || 300)) throw new Error(`Table 1 selection too slow: ${tableOne.ms}ms`);
  if (tableTwo.ms > Number(process.env.POS_TABLE_SELECT_BUDGET_MS || 300)) throw new Error(`Table 2 selection too slow: ${tableTwo.ms}ms`);

  let kdsResult = { skipped: true };
  for (const kitchen of admin.kitchens || []) {
    const kds = await json('GET', `/kds/orders?restaurantId=${restaurantId}&kitchenId=${kitchen.id}&role=OWNER`);
    const candidate = (kds.orders || [])
      .flatMap((order) => order.items)
      .find((item) => !['SERVED', 'CANCELLED'].includes(item.status));
    if (!candidate) continue;

    const db = openDatabase(restaurantId);
    const original = db.prepare('SELECT status, started_at, ready_at, served_at FROM order_items WHERE id = ?').get(candidate.orderItemId);
    db.close();

    await json('POST', '/kds/item-status', { restaurantId, actor, orderItemId: candidate.orderItemId, status: 'PREPARING' });

    const verifyDb = openDatabase(restaurantId);
    const updated = verifyDb.prepare('SELECT status FROM order_items WHERE id = ?').get(candidate.orderItemId);
    verifyDb.prepare('UPDATE order_items SET status = ?, started_at = ?, ready_at = ?, served_at = ? WHERE id = ?')
      .run(original.status, original.started_at, original.ready_at, original.served_at, candidate.orderItemId);
    verifyDb.close();

    if (updated.status !== 'PREPARING') throw new Error('KDS Start action did not update item status');
    kdsResult = { kitchenId: kitchen.id, orderItemId: candidate.orderItemId, updatedStatus: updated.status };
    break;
  }

  console.log(JSON.stringify({
    health: health.success,
    adminCounts: {
      kitchens: admin.kitchens.length,
      categories: admin.categories.length,
      items: admin.items.length,
      users: admin.users.length,
      tables: admin.tables.length
    },
    posCounts: {
      tables: pos.tables?.length || 0,
      categories: pos.categories?.length || 0,
      items: pos.items?.length || 0
    },
    liveOrders: liveOrders.orders.length,
    orderTypeSummary: orderTypes.orderTypeSummary.length,
    tableSelectMs: { tableOne: tableOne.ms, tableTwo: tableTwo.ms },
    kdsResult
  }, null, 2));
}

main().then(() => process.exit(0)).catch((err) => {
  console.error(err.stack || err.message);
  process.exit(1);
});
