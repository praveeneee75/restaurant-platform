const fs = require('fs');
const path = require('path');
const http = require('http');

process.env.POS_DATA_DIR = path.join(__dirname, '..', '.codex-pos-kot-test');
process.env.PORT = '3403';
process.env.POS_HEARTBEAT_DISABLED = '1';
require('../pos-app/backend/server');
const actor = { id: 1, role: 'OWNER' };
const restaurantId = 'RESTOWHITELABEL';

function request(method, url, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const req = http.request({ hostname: '127.0.0.1', port: 3403, path: url, method, headers: payload ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) } : {} }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, data: JSON.parse(data) }));
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function post(url, body) {
  const response = await request('POST', url, { restaurantId, actor, ...body });
  if (response.status >= 400 || response.data.success === false) throw new Error(`${url}: ${JSON.stringify(response.data)}`);
  return response.data;
}

(async () => {
  const bootstrap = await request('GET', `/pos/bootstrap?restaurantId=${restaurantId}`);
  const table = bootstrap.data.tables.find((row) => row.status === 'AVAILABLE') || bootstrap.data.tables[0];
  const menuItems = bootstrap.data.items.slice(0, 2);
  if (menuItems.length < 2) throw new Error(`Test database needs two active items; received ${JSON.stringify(bootstrap.data)}`);
  const first = await post('/orders/save', { orderType: 'DINE_IN', tableId: table.id, tableName: table.table_name, items: [{ itemId: menuItems[0].id, quantity: 1, modifiers: [] }] });
  await post('/orders/submit-kot', { orderId: first.orderId });
  const openAfterFirst = await request('GET', `/orders/open?restaurantId=${restaurantId}&orderId=${first.orderId}`);
  const original = openAfterFirst.data.items[0];
  const second = await post('/orders/save', { orderId: first.orderId, orderType: 'DINE_IN', tableId: table.id, tableName: table.table_name, items: [
    { orderItemId: original.order_item_id, itemId: original.id, quantity: original.quantity, modifiers: [] },
    { itemId: menuItems[1].id, quantity: 1, modifiers: [] }
  ] });
  await post('/orders/submit-kot', { orderId: second.orderId });
  const finalOrder = await request('GET', `/orders/open?restaurantId=${restaurantId}&orderId=${first.orderId}`);
  const submitted = finalOrder.data.items.filter((item) => item.kot_id);
  if (submitted.length !== 2) throw new Error(`Expected two submitted lines, got ${submitted.length}`);
  console.log(JSON.stringify({ success: true, orderId: first.orderId, submittedLines: submitted.length }));
  process.exit(0);
})().catch((error) => { console.error(error.stack || error.message); process.exit(1); });
