const http = require('http');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const dataDir = path.join(root, '.codex-billing-merge-test');
fs.rmSync(dataDir, { recursive: true, force: true });
process.env.POS_DATA_DIR = dataDir;
process.env.PORT = process.env.BILLING_MERGE_TEST_PORT || '3421';
process.env.POS_HEARTBEAT_DISABLED = '1';
const port = Number(process.env.PORT);
const restaurantId = 'BILLMERGETEST';
const posRoot = path.join(root, 'pos-app');
const { openDatabase } = require(path.join(posRoot, 'backend/db/database'));
const { setupDatabase } = require(path.join(posRoot, 'backend/services/dbSetup'));
const { seedWhitelabelDemoData } = require(path.join(posRoot, 'backend/services/whitelabelDemoSeed'));
setupDatabase(restaurantId);
const seedDb = openDatabase(restaurantId);
seedWhitelabelDemoData(seedDb, { restaurantId, force: true });
seedDb.close();
require(path.join(posRoot, 'backend/server'));

const actor = { role: 'OWNER', name: 'Billing merge regression' };
function request(method, route, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const req = http.request({ hostname:'127.0.0.1', port, path:route, method, timeout:15000,
      headers:payload ? { 'Content-Type':'application/json', 'Content-Length':Buffer.byteLength(payload) } : {} }, (res) => {
      let text = ''; res.on('data', (chunk) => { text += chunk; });
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
async function readyOrder(table, items) {
  const saved = await ok('POST', '/orders/save', { restaurantId, actor, orderType:'DINE_IN', tableId:table.id, tableName:table.table_name,
    items:items.map((item) => ({ itemId:item.id, quantity:1, modifiers:[] })) });
  await ok('POST', '/orders/submit-kot', { restaurantId, actor, orderId:saved.orderId });
  await ok('POST', '/orders/final-bill', { restaurantId, actor, orderId:saved.orderId });
  return saved.orderId;
}

async function main() {
  await new Promise((resolve) => setTimeout(resolve, 900));
  const boot = await ok('GET', `/pos/bootstrap?restaurantId=${restaurantId}&role=OWNER`);
  const tables = boot.tables.filter((row) => row.active !== 0);
  const items = boot.items.filter((row) => row.active !== 0);
  if (tables.length < 3 || items.length < 3) throw new Error('seed needs three tables and items');

  const splitSource = await readyOrder(tables[0], [items[0], items[1]]);
  const beforeSplit = await ok('GET', `/orders/open?restaurantId=${restaurantId}&orderId=${splitSource}`);
  const split = await ok('POST', '/orders/split-check', { restaurantId, actor, orderId:splitSource, itemKeys:[beforeSplit.items[0].order_item_id] });
  const splitParent = await ok('GET', `/orders/open?restaurantId=${restaurantId}&orderId=${splitSource}`);
  const splitChild = await ok('GET', `/orders/open?restaurantId=${restaurantId}&orderId=${split.orderId}`);
  if (Number(splitParent.order.billing_ready) !== 1 || Number(splitChild.order.billing_ready) !== 1) throw new Error('split did not preserve parent readiness on both bills');

  await ok('POST', '/orders/unlock-billing', { restaurantId, actor, orderId:split.orderId });
  const unlocked = await ok('GET', `/orders/open?restaurantId=${restaurantId}&orderId=${split.orderId}`);
  if (Number(unlocked.order.billing_ready) !== 0) throw new Error('unlock did not reopen the split bill');
  await ok('POST', '/orders/save', { restaurantId, actor, orderId:split.orderId, orderType:'DINE_IN', tableId:tables[0].id, tableName:tables[0].table_name,
    items:[...unlocked.items.map((item) => ({ orderItemId:item.order_item_id, itemId:item.id, quantity:item.quantity, modifiers:[] })), { itemId:items[2].id, quantity:1, modifiers:[] }] });
  const kotAfterUnlock = await request('POST', '/orders/submit-kot', { restaurantId, actor, orderId:split.orderId });
  if (kotAfterUnlock.status >= 400) throw new Error('unlocked order still rejected POS/KOT activity');

  const second = await readyOrder(tables[1], [items[2]]);
  const discountedPrimary = await ok('POST', '/orders/apply-discount', { restaurantId, actor, orderId:splitSource, type:'MANUAL', value:10, valueType:'PERCENT', appliedByRole:'OWNER' });
  const discountedSecond = await ok('POST', '/orders/apply-discount', { restaurantId, actor, orderId:second, type:'MANUAL', value:1, valueType:'FLAT', appliedByRole:'OWNER' });
  const expectedMergedPayable = Number(discountedPrimary.netPayable) + Number(discountedSecond.netPayable);
  const merged = await ok('POST', '/orders/merge-bills', { restaurantId, actor, orderIds:[splitSource, second] });
  const preview = await ok('GET', `/orders/open?restaurantId=${restaurantId}&orderId=${merged.orderId}`);
  if (!String(preview.order.order_reference).includes(' & ') || preview.items.length !== 2 || Number(preview.order.billing_ready) !== 1) throw new Error('merged preview did not combine references, items, and readiness');
  if (Math.abs(Number(preview.adjustments.netPayable) - expectedMergedPayable) > 0.01) throw new Error('merge reapplied a source percentage discount to the combined bill');
  const live = await ok('GET', `/orders/live?restaurantId=${restaurantId}`);
  if (live.orders.some((order) => Number(order.id) === Number(second))) throw new Error('consumed source bill remained independently billable');
  const sourceDb = openDatabase(restaurantId);
  const consumed = sourceDb.prepare('SELECT status, payment_status, merge_parent_id FROM orders WHERE id = ?').get(second);
  sourceDb.close();
  if (consumed.status !== 'MERGED' || consumed.payment_status !== 'MERGED' || Number(consumed.merge_parent_id) !== Number(merged.orderId)) throw new Error('merge source relationship was not persisted');

  const payable = Number(preview.adjustments?.netPayable ?? preview.pricing?.payableSubtotal ?? preview.order.total_amount);
  const settlement = await ok('POST', '/orders/settle', { restaurantId, actor, orderId:merged.orderId, payments:[{ method:'CASH', amount:payable }], isInvoice:true });
  if (!settlement.invoiceNo) throw new Error('merged settlement did not create one invoice');
  const verifyDb = openDatabase(restaurantId);
  const invoiceCount = verifyDb.prepare('SELECT COUNT(*) count FROM orders WHERE invoice_no = ?').get(settlement.invoiceNo).count;
  const paymentCount = verifyDb.prepare('SELECT COUNT(*) count FROM payments WHERE order_id = ?').get(merged.orderId).count;
  const mergedSourceTableStatus = verifyDb.prepare('SELECT status FROM tables WHERE id = ?').get(tables[1].id)?.status;
  verifyDb.close();
  if (Number(invoiceCount) !== 1 || Number(paymentCount) !== 1) throw new Error('merged sale created duplicate invoices or payments');
  if (mergedSourceTableStatus !== 'AVAILABLE') throw new Error('settling the merged bill did not release a consumed source table');

  const noInvoiceA = await readyOrder(tables[1], [items[0]]);
  const noInvoiceB = await readyOrder(tables[2], [items[1]]);
  const noInvoiceMerge = await ok('POST', '/orders/merge-bills', { restaurantId, actor, orderIds:[noInvoiceA, noInvoiceB] });
  const noInvoicePreview = await ok('GET', `/orders/open?restaurantId=${restaurantId}&orderId=${noInvoiceMerge.orderId}`);
  const noInvoicePayable = Number(noInvoicePreview.adjustments?.netPayable ?? noInvoicePreview.pricing?.payableSubtotal ?? noInvoicePreview.order.total_amount);
  const noInvoiceSettlement = await ok('POST', '/orders/settle', { restaurantId, actor, orderId:noInvoiceMerge.orderId, payments:[{ method:'CARD', amount:noInvoicePayable }], isInvoice:false });
  if (noInvoiceSettlement.invoiceNo) throw new Error('plain Settle consumed an invoice number for a merged order');
  const noInvoiceDb = openDatabase(restaurantId);
  const plainSettlement = noInvoiceDb.prepare('SELECT order_reference, invoice_no, is_invoice, payment_status FROM orders WHERE id = ?').get(noInvoiceMerge.orderId);
  noInvoiceDb.close();
  if (!plainSettlement.order_reference.includes(' & ') || plainSettlement.invoice_no || Number(plainSettlement.is_invoice) !== 0 || plainSettlement.payment_status !== 'PAID') {
    throw new Error('plain merged settlement did not retain combined order identity without invoice');
  }
  console.log('Billing merge/split/unlock regression passed: inherited readiness, unlock/reopen, invoice and non-invoice merged settlements without duplicate payments.');
}

main().then(() => process.exit(0)).catch((error) => { console.error(error.stack || error.message); process.exit(1); });
