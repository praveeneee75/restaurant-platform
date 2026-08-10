const http = require('http');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const dataDir = path.join(root, '.codex-mobile-cancel-test');
fs.rmSync(dataDir, { recursive:true, force:true });
process.env.POS_DATA_DIR = dataDir;
process.env.PORT = process.env.MOBILE_CANCEL_TEST_PORT || '3422';
process.env.POS_HEARTBEAT_DISABLED = '1';
const port = Number(process.env.PORT);
const restaurantId = 'MOBILECANCELTEST';
const posRoot = path.join(root, 'pos-app');
const { openDatabase } = require(path.join(posRoot, 'backend/db/database'));
const { setupDatabase } = require(path.join(posRoot, 'backend/services/dbSetup'));
const { seedWhitelabelDemoData } = require(path.join(posRoot, 'backend/services/whitelabelDemoSeed'));
setupDatabase(restaurantId);
const seedDb = openDatabase(restaurantId);
seedWhitelabelDemoData(seedDb, { restaurantId, force:true });
seedDb.close();
require(path.join(posRoot, 'backend/server'));

const owner = { role:'OWNER', name:'Cancellation regression' };
const captain = { role:'CAPTAIN', name:'Mobile captain' };
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
async function createSubmittedOrder(table, item) {
  const saved = await ok('POST', '/orders/save', { restaurantId, actor:captain, orderType:'DINE_IN', tableId:table.id, tableName:table.table_name,
    items:[{ itemId:item.id, quantity:1, modifiers:[] }] });
  await ok('POST', '/orders/submit-kot', { restaurantId, actor:captain, orderId:saved.orderId });
  return saved.orderId;
}

async function main() {
  await new Promise((resolve) => setTimeout(resolve, 900));
  const boot = await ok('GET', `/pos/bootstrap?restaurantId=${restaurantId}&role=OWNER`);
  const table = boot.tables.find((row) => row.active !== 0);
  let inventoryDb = openDatabase(restaurantId);
  const recipeItem = inventoryDb.prepare(`SELECT r.menu_item_id AS item_id, ri.ingredient_id FROM recipes r JOIN recipe_items ri ON ri.recipe_id = r.id WHERE r.active = 1 AND ri.active = 1 LIMIT 1`).get();
  const item = boot.items.find((row) => Number(row.id) === Number(recipeItem?.item_id)) || boot.items.find((row) => row.active !== 0);
  const stockBefore = recipeItem ? Number(inventoryDb.prepare('SELECT current_stock FROM ingredients WHERE id = ?').get(recipeItem.ingredient_id)?.current_stock || 0) : null;
  inventoryDb.close();
  const orderId = await createSubmittedOrder(table, item);
  if (recipeItem) {
    inventoryDb = openDatabase(restaurantId);
    const stockAfterKot = Number(inventoryDb.prepare('SELECT current_stock FROM ingredients WHERE id = ?').get(recipeItem.ingredient_id)?.current_stock || 0);
    inventoryDb.close();
    if (!(stockAfterKot < stockBefore)) throw new Error('test KOT did not deduct recipe inventory');
  }

  const wrongPin = await request('POST', '/orders/cancel', { restaurantId, actor:captain, orderId, pin:'999999', forcePin:true });
  if (wrongPin.status < 400 || !/approval PIN is incorrect/i.test(wrongPin.data.message || '')) throw new Error('invalid mobile cancellation PIN was not rejected');
  let db = openDatabase(restaurantId);
  if (db.prepare('SELECT status FROM orders WHERE id = ?').get(orderId).status !== 'OPEN') throw new Error('wrong PIN changed the submitted order');
  db.close();

  await ok('POST', '/orders/cancel', { restaurantId, actor:captain, orderId, pin:'123456', forcePin:true });
  db = openDatabase(restaurantId);
  const cancelled = db.prepare('SELECT status, payment_status, cancelled_at FROM orders WHERE id = ?').get(orderId);
  const tableStatus = db.prepare('SELECT status FROM tables WHERE id = ?').get(table.id).status;
  const audit = db.prepare("SELECT id FROM audit_logs WHERE entity_type = 'ORDER' AND entity_id = ? AND action = 'DELETE' ORDER BY id DESC LIMIT 1").get(orderId);
  const stockAfterCancel = recipeItem ? Number(db.prepare('SELECT current_stock FROM ingredients WHERE id = ?').get(recipeItem.ingredient_id)?.current_stock || 0) : null;
  db.close();
  if (cancelled.status !== 'CANCELLED' || cancelled.payment_status === 'PAID' || !cancelled.cancelled_at || !audit) throw new Error('valid manager PIN did not audit and cancel the submitted KOT order');
  if (tableStatus !== 'AVAILABLE') throw new Error('cancelled order did not release its table');
  if (recipeItem && Math.abs(stockAfterCancel - stockBefore) > 0.0001) throw new Error('cancelled submitted KOT did not restore recipe inventory');

  const paidOrderId = await createSubmittedOrder(table, item);
  const paidOpen = await ok('GET', `/orders/open?restaurantId=${restaurantId}&orderId=${paidOrderId}`);
  const payable = Number(paidOpen.adjustments?.netPayable ?? paidOpen.pricing?.payableSubtotal ?? paidOpen.order.total_amount);
  await ok('POST', '/orders/settle', { restaurantId, actor:owner, orderId:paidOrderId, payments:[{ method:'CASH', amount:payable }], isInvoice:true });
  const paidCancel = await request('POST', '/orders/cancel', { restaurantId, actor:captain, orderId:paidOrderId, pin:'123456', forcePin:true });
  if (paidCancel.status < 400 || !/open, unsettled order/i.test(paidCancel.data.message || '')) throw new Error('mobile cancellation changed or accepted a settled order');
  console.log('Mobile submitted-KOT cancellation regression passed: manager PIN approval, audit, inventory/table restoration, wrong-PIN rejection, and settled-order protection.');
}

main().then(() => process.exit(0)).catch((error) => { console.error(error.stack || error.message); process.exit(1); });
