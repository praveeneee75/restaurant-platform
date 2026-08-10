const http = require('http');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const dataDir = path.join(root, '.codex-kds-business-day-test');
fs.rmSync(dataDir, { recursive:true, force:true });
process.env.POS_DATA_DIR = dataDir;
process.env.PORT = process.env.KDS_BUSINESS_DAY_TEST_PORT || '3423';
process.env.POS_HEARTBEAT_DISABLED = '1';
const port = Number(process.env.PORT);
const restaurantId = 'KDSBUSINESSDAYTEST';
const posRoot = path.join(root, 'pos-app');
const { openDatabase } = require(path.join(posRoot, 'backend/db/database'));
const { setupDatabase } = require(path.join(posRoot, 'backend/services/dbSetup'));
const { seedWhitelabelDemoData } = require(path.join(posRoot, 'backend/services/whitelabelDemoSeed'));
setupDatabase(restaurantId);
const seedDb = openDatabase(restaurantId);
seedWhitelabelDemoData(seedDb, { restaurantId, force:true });
seedDb.close();
require(path.join(posRoot, 'backend/server'));

const owner = { role:'OWNER', name:'KDS regression' };
const kitchen = { role:'KITCHEN', name:'Kitchen regression' };
function request(method, route, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const req = http.request({ hostname:'127.0.0.1', port, path:route, method, timeout:15000,
      headers:payload ? { 'Content-Type':'application/json', 'Content-Length':Buffer.byteLength(payload) } : {} }, (res) => {
      let text=''; res.on('data', (chunk) => { text += chunk; });
      res.on('end', () => resolve({ status:res.statusCode, data:JSON.parse(text) }));
    });
    req.on('error', reject); req.on('timeout', () => req.destroy(new Error('request timeout')));
    if (payload) req.write(payload); req.end();
  });
}
async function ok(method, route, body) {
  const result = await request(method, route, body);
  if (result.status >= 400 || result.data.success === false) throw new Error(`${route}: ${result.data.message || result.status}`);
  return result.data;
}
async function submittedOrder({ table, item, orderType }) {
  const payload = { restaurantId, actor:owner, orderType, items:[{ itemId:item.id, quantity:1, modifiers:[] }] };
  if (table) Object.assign(payload, { tableId:table.id, tableName:table.table_name });
  const saved = await ok('POST', '/orders/save', payload);
  await ok('POST', '/orders/submit-kot', { restaurantId, actor:owner, orderId:saved.orderId, fulfillmentType:orderType });
  return saved.orderId;
}
async function settle(orderId) {
  const open = await ok('GET', `/orders/open?restaurantId=${restaurantId}&orderId=${orderId}`);
  const payable = Number(open.adjustments?.netPayable ?? open.pricing?.payableSubtotal ?? open.order.total_amount);
  return ok('POST', '/orders/settle', { restaurantId, actor:owner, orderId, payments:[{ method:'CASH', amount:payable }], isInvoice:true });
}

async function main() {
  await new Promise((resolve) => setTimeout(resolve, 900));
  const boot = await ok('GET', `/pos/bootstrap?restaurantId=${restaurantId}&role=OWNER`);
  const table = boot.tables.find((row) => row.active !== 0);
  const item = boot.items.find((row) => row.active !== 0);
  let lookupDb = openDatabase(restaurantId);
  const kitchenId = item.kitchen_id || lookupDb.prepare('SELECT id FROM kitchens WHERE active = 1 ORDER BY id LIMIT 1').get().id;
  lookupDb.close();

  const parcelId = await submittedOrder({ item, orderType:'TAKEAWAY' });
  const parcelSettlement = await settle(parcelId);
  let db = openDatabase(restaurantId);
  const parcelLine = db.prepare('SELECT id FROM order_items WHERE order_id = ? LIMIT 1').get(parcelId);
  db.close();
  await ok('POST', '/kds/item-status', { restaurantId, actor:kitchen, orderItemId:parcelLine.id, status:'PREPARING' });
  await ok('POST', '/kds/item-status', { restaurantId, actor:kitchen, orderItemId:parcelLine.id, status:'READY' });
  const parcelCancel = await request('POST', '/kds/item-status', { restaurantId, actor:kitchen, orderItemId:parcelLine.id, status:'CANCELLED' });
  if (parcelCancel.status < 400) throw new Error('settled parcel cancellation was incorrectly allowed');

  const dineInId = await submittedOrder({ table, item, orderType:'DINE_IN' });
  const dineSettlement = await settle(dineInId);
  db = openDatabase(restaurantId);
  const dineLine = db.prepare('SELECT id FROM order_items WHERE order_id = ? LIMIT 1').get(dineInId);
  db.close();
  const dineStart = await request('POST', '/kds/item-status', { restaurantId, actor:kitchen, orderItemId:dineLine.id, status:'PREPARING' });
  if (dineStart.status < 400) throw new Error('settled dine-in KDS item was incorrectly reopened');

  const unsettledId = await submittedOrder({ table, item, orderType:'DINE_IN' });
  db = openDatabase(restaurantId);
  const kdsKitchenId = db.prepare('SELECT kitchen_id FROM order_items WHERE order_id = ? LIMIT 1').get(unsettledId).kitchen_id;
  db.prepare("UPDATE system_config SET value = '1' WHERE key = 'kds_clear_settled_on_new_business_day'").run();
  db.prepare("UPDATE system_config SET value = '4' WHERE key = 'kds_offline_clear_hours'").run();
  db.prepare("INSERT INTO system_config(key,value) VALUES('pos_last_login_at',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(new Date(Date.now() - 30 * 3600000).toISOString());
  db.prepare("INSERT INTO system_config(key,value) VALUES('pos_last_logout_at',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(new Date(Date.now() - 10 * 3600000).toISOString());
  const financialBefore = db.prepare("SELECT COUNT(*) invoices, COALESCE(SUM(total_amount),0) total FROM orders WHERE payment_status='PAID'").get();
  const paymentBefore = db.prepare('SELECT COUNT(*) count, COALESCE(SUM(amount),0) total FROM payments').get();
  db.close();

  const login = await ok('POST', '/login', { restaurantId, username:'admin', pin:'123456' });
  if (Number(login.kdsBusinessDay?.archivedKotCount || 0) < 2) throw new Error('new business-day login did not archive settled KOTs');
  db = openDatabase(restaurantId);
  const settledArchived = db.prepare('SELECT COUNT(*) count FROM kots WHERE order_id IN (?,?) AND archived_at IS NOT NULL').get(parcelId, dineInId).count;
  const unsettledArchived = db.prepare('SELECT COUNT(*) count FROM kots WHERE order_id = ? AND archived_at IS NOT NULL').get(unsettledId).count;
  const financialAfter = db.prepare("SELECT COUNT(*) invoices, COALESCE(SUM(total_amount),0) total FROM orders WHERE payment_status='PAID'").get();
  const paymentAfter = db.prepare('SELECT COUNT(*) count, COALESCE(SUM(amount),0) total FROM payments').get();
  const invoiceRows = db.prepare('SELECT id, invoice_no, payment_status FROM orders WHERE id IN (?,?) ORDER BY id').all(parcelId, dineInId);
  db.close();
  if (Number(settledArchived) < 2 || Number(unsettledArchived) !== 0) throw new Error('KDS cleanup did not preserve the unsettled KOT');
  if (financialBefore.invoices !== financialAfter.invoices || Number(financialBefore.total) !== Number(financialAfter.total)
      || paymentBefore.count !== paymentAfter.count || Number(paymentBefore.total) !== Number(paymentAfter.total)
      || invoiceRows.some((row) => !row.invoice_no || row.payment_status !== 'PAID')) throw new Error('KDS cleanup changed invoice, settlement, or payment data');
  const kds = await ok('GET', `/kds/orders?restaurantId=${restaurantId}&kitchenIds=${kdsKitchenId}&role=KITCHEN`);
  if (!kds.orders.some((order) => Number(order.orderId) === Number(unsettledId)) || kds.orders.some((order) => [parcelId,dineInId].includes(Number(order.orderId)))) {
    throw new Error(`KDS display did not contain only retained unsettled work after cleanup: ${JSON.stringify({ kitchenId:kdsKitchenId, parcelId, dineInId, unsettledId, visible:kds.orders.map((order)=>order.orderId) })}`);
  }
  if (!parcelSettlement.invoiceNo || !dineSettlement.invoiceNo) throw new Error('test setup did not create invoices');
  console.log('KDS business-day regression passed: settled parcel progress, settled cancellation protection, safe KDS-only archival, and invoice/payment preservation.');
}

main().then(() => process.exit(0)).catch((error) => { console.error(error.stack || error.message); process.exit(1); });
