const http = require('http');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const dataDir = path.join(root, '.codex-order-transfer-test');
fs.rmSync(dataDir, { recursive:true, force:true });
process.env.POS_DATA_DIR = dataDir;
process.env.PORT = process.env.ORDER_TRANSFER_TEST_PORT || '3424';
process.env.POS_HEARTBEAT_DISABLED = '1';
const port = Number(process.env.PORT);
const restaurantId = 'ORDERTRANSFERTEST';
const posRoot = path.join(root, 'pos-app');
const { openDatabase } = require(path.join(posRoot, 'backend/db/database'));
const { setupDatabase } = require(path.join(posRoot, 'backend/services/dbSetup'));
const { seedWhitelabelDemoData } = require(path.join(posRoot, 'backend/services/whitelabelDemoSeed'));
setupDatabase(restaurantId);
const seeded = openDatabase(restaurantId);
seedWhitelabelDemoData(seeded, { restaurantId, force:true });
seeded.close();
require(path.join(posRoot, 'backend/server'));

const owner = { role:'OWNER', name:'Transfer regression owner' };
const captain = { role:'CAPTAIN', name:'Transfer regression captain' };
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
async function submit(table, itemRows) {
  const saved = await ok('POST', '/orders/save', { restaurantId, actor:captain, orderType:'DINE_IN', tableId:table.id, tableName:table.table_name,
    items:itemRows.map(({ item, quantity = 1 }) => ({ itemId:item.id, quantity, modifiers:[] })) });
  await ok('POST', '/orders/submit-kot', { restaurantId, actor:captain, orderId:saved.orderId });
  return saved.orderId;
}
async function main() {
  await new Promise((resolve) => setTimeout(resolve, 900));
  const boot = await ok('GET', `/pos/bootstrap?restaurantId=${restaurantId}&role=OWNER`);
  const tables = boot.tables.filter((row) => row.active !== 0).slice(0, 5);
  const items = boot.items.filter((row) => row.active !== 0).slice(0, 4);
  if (tables.length < 4 || items.length < 3) throw new Error('transfer regression needs four tables and three items');

  const wholeOrder = await submit(tables[0], [{ item:items[0] }]);
  await ok('POST', '/orders/transfer-preview', { restaurantId, actor:captain, orderId:wholeOrder });
  await ok('POST', '/orders/transfer', { restaurantId, actor:captain, orderId:wholeOrder, toTableId:tables[1].id, mode:'TABLE' });
  let db = openDatabase(restaurantId);
  const whole = db.prepare('SELECT table_id, table_no FROM orders WHERE id = ?').get(wholeOrder);
  const wholeNotice = db.prepare("SELECT payload FROM print_jobs WHERE type='KOT' AND ref_id=? ORDER BY id DESC LIMIT 1").get(wholeOrder);
  db.close();
  if (Number(whole.table_id) !== Number(tables[1].id) || !wholeNotice || !JSON.parse(wholeNotice.payload).headerText.includes('Shifted From Table')) throw new Error('whole-check transfer or kitchen notice failed');

  const partialOrder = await submit(tables[2], [{ item:items[0], quantity:2 }, { item:items[1] }]);
  const partialPreview = await ok('POST', '/orders/transfer-preview', { restaurantId, actor:captain, orderId:partialOrder });
  const movedItem = partialPreview.items[0];
  const partial = await ok('POST', '/orders/transfer', { restaurantId, actor:captain, orderId:partialOrder, toTableId:tables[1].id, mode:'ITEM', itemIds:[movedItem.id] });
  db = openDatabase(restaurantId);
  const movedOwner = db.prepare('SELECT order_id, kot_id FROM order_items WHERE id = ?').get(movedItem.id);
  const sourceCount = db.prepare('SELECT COUNT(*) count FROM order_items WHERE order_id = ?').get(partialOrder).count;
  const deductionRows = db.prepare('SELECT order_id FROM order_inventory_deductions WHERE order_id IN (?, ?)').all(partialOrder, partial.targetOrderId);
  const transferAudit = db.prepare("SELECT id FROM audit_logs WHERE action='TRANSFER_ITEM' AND entity_id=?").get(partial.targetOrderId);
  db.close();
  if (Number(movedOwner.order_id) !== Number(partial.targetOrderId) || Number(sourceCount) !== 1 || !transferAudit) throw new Error('item transfer did not preserve source and destination ownership');
  if (deductionRows.length > 2) throw new Error('item transfer produced duplicate inventory deduction markers');

  const kotOrder = await submit(tables[3], [{ item:items[2] }]);
  let kotOpen = await ok('GET', `/orders/open?restaurantId=${restaurantId}&orderId=${kotOrder}`);
  await ok('POST', '/orders/save', { restaurantId, actor:captain, orderId:kotOrder, orderType:'DINE_IN', tableId:tables[3].id, tableName:tables[3].table_name,
    items:[...kotOpen.items.map((line) => ({ orderItemId:line.order_item_id, itemId:line.id, quantity:line.quantity, modifiers:[] })), { itemId:items[1].id, quantity:1, modifiers:[] }] });
  await ok('POST', '/orders/submit-kot', { restaurantId, actor:captain, orderId:kotOrder });
  const kotPreview = await ok('POST', '/orders/transfer-preview', { restaurantId, actor:captain, orderId:kotOrder });
  const kotId = kotPreview.items[0].kot_id;
  const kotTransfer = await ok('POST', '/orders/transfer', { restaurantId, actor:captain, orderId:kotOrder, toTableId:tables[0].id, mode:'KOT', kotIds:[kotId] });
  const transferredOpen = await ok('GET', `/orders/open?restaurantId=${restaurantId}&orderId=${kotTransfer.targetOrderId}`);
  const payable = Number(transferredOpen.adjustments?.netPayable ?? transferredOpen.pricing?.payableSubtotal ?? transferredOpen.order.total_amount);
  const settled = await ok('POST', '/orders/settle', { restaurantId, actor:owner, orderId:kotTransfer.targetOrderId, payments:[{ method:'CASH', amount:payable }], isInvoice:true });
  if (!settled.invoiceNo) throw new Error('transferred KOT did not settle under a valid invoice');
  const today = new Date().toISOString().slice(0, 10);
  const sales = await ok('GET', `/reports/sales?restaurantId=${restaurantId}&role=OWNER&fromDate=${today}&toDate=${today}`);
  if (!Array.isArray(sales.data) || !sales.data.some((row) => Number(row.orders) >= 1 && Number(row.revenue) > 0)) throw new Error('sales report omitted the transferred-order settlement');

  const discounted = await submit(tables[0], [{ item:items[0] }]);
  await ok('POST', '/orders/apply-discount', { restaurantId, actor:owner, orderId:discounted, type:'MANUAL', value:5, valueType:'FLAT', appliedByRole:'OWNER' });
  const rejected = await request('POST', '/orders/transfer', { restaurantId, actor:captain, orderId:discounted, toTableId:tables[2].id, mode:'ITEM', itemIds:[1] });
  if (rejected.status < 400 || !/discounts or rewards/i.test(rejected.data.message || '')) throw new Error('partial transfer did not protect applied discounts');
  console.log('Order transfer regression passed: captain preview, table/KOT/item movement, kitchen notices, inventory ownership, settlement/invoice/report continuity, and discount protection.');
}

main().then(() => process.exit(0)).catch((error) => { console.error(error.stack || error.message); process.exit(1); });
