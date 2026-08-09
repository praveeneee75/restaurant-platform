const http = require('http');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const dataDir = path.join(root, '.codex-final-bill-decision-test');
fs.rmSync(dataDir, { recursive: true, force: true });
process.env.POS_DATA_DIR = dataDir;
process.env.PORT = process.env.FINAL_BILL_TEST_PORT || '3412';
process.env.POS_HEARTBEAT_DISABLED = '1';
const port = Number(process.env.PORT);
const restaurantId = 'FINALBILLTEST';
const posRoot = path.join(root, 'pos-app');
const { openDatabase } = require(path.join(posRoot, 'backend/db/database'));
const { setupDatabase } = require(path.join(posRoot, 'backend/services/dbSetup'));
const { seedWhitelabelDemoData } = require(path.join(posRoot, 'backend/services/whitelabelDemoSeed'));
setupDatabase(restaurantId);
const seedDb = openDatabase(restaurantId);
seedWhitelabelDemoData(seedDb, { restaurantId, force: true });
seedDb.close();
require(path.join(posRoot, 'backend/server'));

const actor = { role: 'OWNER', name: 'Final Bill regression' };
function request(method, route, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const req = http.request({ hostname: '127.0.0.1', port, path: route, method, timeout: 15000,
      headers: payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {} }, (res) => {
      let text = '';
      res.on('data', (chunk) => { text += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, data: JSON.parse(text) }));
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('request timeout')));
    if (payload) req.write(payload);
    req.end();
  });
}
async function ok(method, route, body) {
  const result = await request(method, route, body);
  if (result.status >= 400 || result.data.success === false) throw new Error(`${route}: ${result.data.message || result.status}`);
  return result.data;
}
async function mixedOrder(table, first, second) {
  const saved = await ok('POST', '/orders/save', { restaurantId, actor, orderType: 'DINE_IN', tableId: table.id, tableName: table.table_name,
    items: [{ itemId: first.id, quantity: 1, modifiers: [] }] });
  await ok('POST', '/orders/submit-kot', { restaurantId, actor, orderId: saved.orderId });
  const current = await ok('GET', `/orders/open?restaurantId=${restaurantId}&orderId=${saved.orderId}`);
  const submitted = current.items.find((item) => Number(item.id) === Number(first.id));
  await ok('POST', '/orders/save', { restaurantId, actor, orderId: saved.orderId, orderType: 'DINE_IN', tableId: table.id, tableName: table.table_name,
    items: [{ orderItemId: submitted.order_item_id, itemId: first.id, quantity: 1, modifiers: [] }, { itemId: second.id, quantity: 1, modifiers: [] }] });
  return saved.orderId;
}

async function main() {
  await new Promise((resolve) => setTimeout(resolve, 900));
  const bootstrap = await ok('GET', `/pos/bootstrap?restaurantId=${restaurantId}&role=OWNER`);
  const tables = bootstrap.tables.filter((row) => row.active !== 0);
  const items = bootstrap.items.filter((row) => row.active !== 0);
  if (tables.length < 2 || items.length < 2) throw new Error('seed needs two tables and two items');

  const proceedOrder = await mixedOrder(tables[0], items[0], items[1]);
  const readiness = await ok('GET', `/orders/final-bill-readiness?restaurantId=${restaurantId}&orderId=${proceedOrder}`);
  if (Number(readiness.submittedItemCount) !== 1 || Number(readiness.draftItemCount) !== 1) throw new Error('readiness did not identify the mixed submitted/draft order');
  const rejected = await request('POST', '/orders/final-bill', { restaurantId, actor, orderId: proceedOrder });
  if (rejected.status !== 409 || rejected.data.code !== 'DRAFT_ITEMS_REQUIRE_DECISION') throw new Error('server accepted a mixed order without an explicit decision');
  await ok('POST', '/orders/final-bill', { restaurantId, actor, orderId: proceedOrder, draftItemAction: 'PROCEED' });
  const proceeded = await ok('GET', `/orders/open?restaurantId=${restaurantId}&orderId=${proceedOrder}`);
  if (proceeded.items.length !== 2 || proceeded.items.some((item) => !item.kot_id) || Number(proceeded.order.billing_ready) !== 1) throw new Error('Proceed did not submit the draft and lock the complete order');

  const newParcel = await ok('POST', '/orders/save', { restaurantId, actor, orderType:'TAKEAWAY', linkedFulfillment:true,
    tableId:tables[0].id, tableName:tables[0].table_name, items:[{ itemId:items[0].id, quantity:1, modifiers:[] }] });
  if (Number(newParcel.orderId) === Number(proceedOrder)) throw new Error('new parcel customer reused the final-bill-locked check');
  await ok('POST', '/orders/submit-kot', { restaurantId, actor, orderId:newParcel.orderId, fulfillmentType:'TAKEAWAY' });
  const parcelOpen = await ok('GET', `/orders/open?restaurantId=${restaurantId}&orderId=${newParcel.orderId}`);
  if (Number(parcelOpen.order.billing_ready) !== 0 || parcelOpen.order.table_no !== tables[0].table_name || !parcelOpen.items.every((item)=>item.kot_id && item.fulfillment_type === 'TAKEAWAY')) {
    throw new Error('independent parcel check on a final-bill table was not submitted correctly');
  }

  const discardOrder = await mixedOrder(tables[1], items[0], items[1]);
  await ok('POST', '/orders/final-bill', { restaurantId, actor, orderId: discardOrder, draftItemAction: 'DISCARD' });
  const discarded = await ok('GET', `/orders/open?restaurantId=${restaurantId}&orderId=${discardOrder}`);
  if (discarded.items.length !== 1 || discarded.items.some((item) => !item.kot_id) || Number(discarded.order.billing_ready) !== 1) throw new Error('Discard did not remove only the unsent draft and lock the submitted order');

  console.log('Final Bill regression passed: readiness, Proceed, Discard, and independent table parcel KOT after final bill.');
}

main().then(() => process.exit(0)).catch((error) => { console.error(error.stack || error.message); process.exit(1); });
