const http = require('http');
const path = require('path');

process.env.PORT = process.env.POS_SMOKE_PORT || '3399';
process.env.POS_HEARTBEAT_DISABLED = '1';

const posRoot = path.join(__dirname, '..', 'pos-app');
const { openDatabase } = require(path.join(posRoot, 'backend/db/database'));
const { getSingleRestaurantId } = require(path.join(posRoot, 'backend/utils/restaurantScanner'));
require(path.join(posRoot, 'backend/server'));

const port = Number(process.env.PORT);
const restaurantId = process.env.POS_SMOKE_RESTAURANT_ID || getSingleRestaurantId();
if (!restaurantId) {
  throw new Error('No active local restaurant DB found for POS smoke test');
}
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
  const shortPin = await request('POST', '/admin/users/save', {
    restaurantId,
    actor,
    name: 'PIN Validation',
    username: 'pin_validation_short',
    pin: '1234',
    role: 'CASHIER',
    active: true
  });
  if (shortPin.status !== 400 || !shortPin.body.includes('exactly 6 digits')) {
    throw new Error('Four digit PIN was not rejected for a new user');
  }
  const pinUserName = `pin_validation_${Date.now()}`;
  await json('POST', '/admin/users/save', {
    restaurantId,
    actor,
    name: 'PIN Validation',
    username: pinUserName,
    pin: '654321',
    role: 'CASHIER',
    active: true
  });
  const pinDb = openDatabase(restaurantId);
  const pinUser = pinDb.prepare('SELECT pin, pin_hash FROM users WHERE username = ?').get(pinUserName);
  pinDb.prepare('DELETE FROM users WHERE username = ?').run(pinUserName);
  pinDb.close();
  if (pinUser.pin !== '' || !pinUser.pin_hash) throw new Error('Six digit PIN was not stored as a hash');
  const tableOne = await request('GET', `/orders/open?restaurantId=${restaurantId}&tableId=1`);
  const tableTwo = await request('GET', `/orders/open?restaurantId=${restaurantId}&tableId=2`);
  if (tableOne.ms > Number(process.env.POS_TABLE_SELECT_BUDGET_MS || 300)) throw new Error(`Table 1 selection too slow: ${tableOne.ms}ms`);
  if (tableTwo.ms > Number(process.env.POS_TABLE_SELECT_BUDGET_MS || 300)) throw new Error(`Table 2 selection too slow: ${tableTwo.ms}ms`);

  // Shared-table regression: three independent customer checks, a repeat KOT,
  // a linked parcel check, and a table transfer must remain separately visible.
  const sharedTable = (pos.tables || []).find((table) => table.table_name === 'Table 3') || pos.tables.find((table) => table.status === 'AVAILABLE');
  let moveTarget = null;
  for (const candidate of (pos.tables || []).filter((table) => table.id !== sharedTable?.id)) {
    const candidateOrders = await json('GET', `/orders/open-list?restaurantId=${restaurantId}&tableId=${candidate.id}`);
    if (!candidateOrders.orders.length) {
      moveTarget = candidate;
      break;
    }
  }
  const sharedItems = (pos.items || []).slice(0, 3);
  if (!sharedTable || !moveTarget || sharedItems.length < 3) throw new Error('Shared-table smoke test needs Table 3, another table, and three items');
  const customers = [];
  for (const [index, suffix] of ['one', 'two', 'three'].entries()) {
    const customer = await json('POST', '/customers/create', { restaurantId, actor, name: `Shared Table ${suffix}`, phone: `999${Date.now()}${index}` });
    customers.push(customer.customer);
  }
  async function saveShared(customerId, itemId, orderId = null, items = null, orderType = 'DINE_IN') {
    return json('POST', '/orders/save', {
      restaurantId, actor, orderId, orderType, tableId: sharedTable.id, tableName: sharedTable.table_name, customerId,
      items: items || [{ itemId, quantity: 1, modifiers: [] }]
    });
  }
  const sharedOrders = [];
  for (let i = 0; i < 3; i++) {
    const saved = await saveShared(customers[i].id, sharedItems[i].id);
    await json('POST', '/orders/submit-kot', { restaurantId, actor, orderId: saved.orderId });
    sharedOrders.push(saved);
  }
  const firstOpen = await json('GET', `/orders/open?restaurantId=${restaurantId}&orderId=${sharedOrders[0].orderId}`);
  const firstItem = firstOpen.items[0];
  const firstAdditional = await saveShared(customers[0].id, sharedItems[1].id, sharedOrders[0].orderId, [
    { orderItemId: firstItem.order_item_id, itemId: firstItem.id, quantity: firstItem.quantity, modifiers: [] },
    { itemId: sharedItems[1].id, quantity: 1, modifiers: [] }
  ]);
  await json('POST', '/orders/submit-kot', { restaurantId, actor, orderId: firstAdditional.orderId });
  const parcel = await saveShared(customers[1].id, sharedItems[2].id, null, [{ itemId: sharedItems[2].id, quantity: 1, modifiers: [] }], 'TAKEAWAY');
  await json('POST', '/orders/submit-kot', { restaurantId, actor, orderId: parcel.orderId });
  await json('POST', '/orders/transfer-table', { restaurantId, actor, orderId: sharedOrders[2].orderId, fromTableId: sharedTable.id, toTableId: moveTarget.id });
  const sharedOpen = await json('GET', `/orders/open-list?restaurantId=${restaurantId}&tableId=${sharedTable.id}`);
  const movedOpen = await json('GET', `/orders/open-list?restaurantId=${restaurantId}&tableId=${moveTarget.id}`);
  const sharedLive = await json('GET', `/orders/live?restaurantId=${restaurantId}`);
  const sharedLiveIds = new Set((sharedLive.orders || []).map((order) => Number(order.id)));
  if (!sharedOrders.slice(0, 2).every((order) => sharedLiveIds.has(Number(order.orderId))) || !sharedLiveIds.has(Number(parcel.orderId))) throw new Error('Shared-table orders are missing from billing live orders');
  if (sharedOpen.orders.length < 2 || !movedOpen.orders.some((order) => Number(order.id) === Number(sharedOrders[2].orderId))) throw new Error('Shared-table order selection or move failed');
  const kdsOrders = [];
  for (const kitchen of admin.kitchens || []) {
    const kds = await json('GET', `/kds/orders?restaurantId=${restaurantId}&kitchenId=${kitchen.id}&role=OWNER`);
    kdsOrders.push(...(kds.orders || []));
  }
  if (!kdsOrders.some((order) => [sharedOrders[0].orderId, sharedOrders[1].orderId, sharedOrders[2].orderId, parcel.orderId].includes(Number(order.orderId || order.id)))) throw new Error('Shared-table KOTs are missing from KDS');
  const parcelKdsItems = kdsOrders
    .filter((order) => Number(order.orderId || order.id) === Number(parcel.orderId))
    .flatMap((order) => order.items || []);
  if (parcelKdsItems.length !== 1 || Number(parcelKdsItems[0]?.quantity) !== 1) {
    throw new Error(`Parcel KDS duplicate or incorrect quantity: expected 1 item, found ${parcelKdsItems.length}`);
  }
  const multiCustomerResult = { table: sharedTable.table_name, openBills: sharedOpen.orders.length, movedOrderId: sharedOrders[2].orderId, parcelOrderId: parcel.orderId };

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
    multiCustomerResult,
    kdsResult
  }, null, 2));
}

main().then(() => process.exit(0)).catch((err) => {
  console.error(err.stack || err.message);
  process.exit(1);
});
