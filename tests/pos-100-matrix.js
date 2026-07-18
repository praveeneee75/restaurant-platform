const http = require('http');
const fs = require('fs');
const path = require('path');

const matrixDataDir = path.join(__dirname, '..', '.codex-pos-100-matrix-test');
fs.rmSync(matrixDataDir, { recursive: true, force: true });
process.env.POS_DATA_DIR = matrixDataDir;
process.env.PORT = process.env.POS_MATRIX_PORT || '3401';
process.env.POS_HEARTBEAT_DISABLED = '1';
const restaurantId = process.env.POS_SMOKE_RESTAURANT_ID || 'RESTOWHITELABEL';
const posRoot = path.join(__dirname, '..', 'pos-app');
const { openDatabase } = require(path.join(posRoot, 'backend/db/database'));
const { setupDatabase } = require(path.join(posRoot, 'backend/services/dbSetup'));
const { seedWhitelabelDemoData } = require(path.join(posRoot, 'backend/services/whitelabelDemoSeed'));
setupDatabase(restaurantId);
const matrixSeedDb = openDatabase(restaurantId);
seedWhitelabelDemoData(matrixSeedDb, { restaurantId, force: true });
matrixSeedDb.close();
require(path.join(posRoot, 'backend/server'));
const actor = { role: 'OWNER', name: '100-case matrix' };

function request(method, targetPath, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const req = http.request({ hostname: '127.0.0.1', port: 3401, path: targetPath, method,
      timeout: 15000, headers: payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {} }, res => {
      let data = ''; res.on('data', chunk => { data += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, data }));
    });
    req.on('error', reject); req.on('timeout', () => req.destroy(new Error('request timeout')));
    if (payload) req.write(payload); req.end();
  });
}
async function json(method, route, body) {
  const result = await request(method, route, body);
  const data = JSON.parse(result.data);
  if (result.status >= 400 || data.success === false) throw new Error(`${route}: ${data.message || result.status}`);
  return data;
}

async function main() {
  await new Promise(resolve => setTimeout(resolve, 1000));
  const bootstrap = await json('GET', `/pos/bootstrap?restaurantId=${restaurantId}&role=OWNER`);
  const tables = bootstrap.tables.filter(table => table.active !== 0);
  const items = bootstrap.items.filter(item => item.active !== 0);
  const combos = bootstrap.combos || [];
  if (tables.length < 2 || items.length < 3) throw new Error('Matrix needs at least 2 tables and 3 menu items');
  const db = openDatabase(restaurantId);
  const promo = db.prepare("SELECT code FROM promo_codes WHERE active = 1 LIMIT 1").get();
  if (!promo) db.prepare("INSERT INTO promo_codes (code, value, value_type, active) VALUES ('MATRIX10', 10, 'FLAT', 1)").run();
  const promoCode = promo?.code || 'MATRIX10';
  db.close();

  const created = [];
  const results = [];
  for (let index = 0; index < 100; index += 1) {
    const table = tables[index % tables.length];
    const first = items[index % items.length];
    const second = items[(index + 1) % items.length];
    const quantity = (index % 4) + 1;
    const useCombo = combos.length > 0 && index % 5 === 0;
    const firstLine = useCombo ? { comboId: combos[index % combos.length].id, quantity: 1 } : { itemId: first.id, quantity, modifiers: [] };
    const saved = await json('POST', '/orders/save', { restaurantId, actor, orderType: 'DINE_IN', tableId: table.id,
      tableName: table.table_name, items: [firstLine] });
    created.push(saved.orderId);
    const retrieved = await json('GET', `/orders/open?restaurantId=${restaurantId}&orderId=${saved.orderId}`);
    if (useCombo) {
      if (!retrieved.items.some(item => Number(item.comboId || item.combo_id) === Number(combos[index % combos.length].id))) throw new Error(`case ${index + 1}: saved combo retrieval failed`);
    } else if (!retrieved.items.some(item => Number(item.id) === Number(first.id) && Number(item.quantity) === quantity)) throw new Error(`case ${index + 1}: saved item retrieval failed`);
    await json('POST', '/orders/submit-kot', { restaurantId, actor, orderId: saved.orderId });
    const firstSubmitted = await json('GET', `/orders/open?restaurantId=${restaurantId}&orderId=${saved.orderId}`);
    const originalLine = firstSubmitted.items.find(item => useCombo
      ? Number(item.comboId || item.combo_id) === Number(combos[index % combos.length].id)
      : Number(item.id) === Number(first.id));
    if (!originalLine?.kot_id || !originalLine.order_item_id) throw new Error(`case ${index + 1}: first KOT did not preserve submitted line identity`);
    const firstKotDb = openDatabase(restaurantId);
    const firstPrintJobs = firstKotDb.prepare("SELECT id FROM print_jobs WHERE type = 'KOT' AND ref_id = ? ORDER BY id").all(saved.orderId);
    firstKotDb.close();
    if (firstPrintJobs.length === 0) throw new Error(`case ${index + 1}: first KOT print job missing`);

    const originalPayload = useCombo
      ? { orderItemId: originalLine.order_item_id, comboId: combos[index % combos.length].id, quantity: 1 }
      : { orderItemId: originalLine.order_item_id, itemId: first.id, quantity, modifiers: [] };
    await json('POST', '/orders/save', { restaurantId, actor, orderId: saved.orderId, orderType: 'DINE_IN', tableId: table.id,
      tableName: table.table_name, items: [originalPayload, { itemId: second.id, quantity: 1, modifiers: [] }] });
    const updated = await json('GET', `/orders/open?restaurantId=${restaurantId}&orderId=${saved.orderId}`);
    const draftLine = updated.items.find(item => Number(item.id) === Number(second.id) && !item.kot_id);
    if (!draftLine?.order_item_id) throw new Error(`case ${index + 1}: additional item was not retained as a saved draft`);
    const afterSaveDb = openDatabase(restaurantId);
    const afterSavePrintJobs = afterSaveDb.prepare("SELECT id FROM print_jobs WHERE type = 'KOT' AND ref_id = ? ORDER BY id").all(saved.orderId);
    afterSaveDb.close();
    if (afterSavePrintJobs.length !== firstPrintJobs.length) throw new Error(`case ${index + 1}: Save incorrectly created a KOT print job`);
    await json('POST', '/orders/submit-kot', { restaurantId, actor, orderId: saved.orderId });
    const secondKotDb = openDatabase(restaurantId);
    const secondPrintJobs = secondKotDb.prepare("SELECT id, payload FROM print_jobs WHERE type = 'KOT' AND ref_id = ? ORDER BY id").all(saved.orderId);
    secondKotDb.close();
    const secondPayloadItems = secondPrintJobs.slice(firstPrintJobs.length).flatMap(job => JSON.parse(job.payload).items || []);
    if (!secondPayloadItems.some(item => Number(item.order_item_id) === Number(draftLine.order_item_id))) throw new Error(`case ${index + 1}: second KOT omitted new draft line`);
    if (secondPayloadItems.some(item => Number(item.order_item_id) === Number(originalLine.order_item_id))) throw new Error(`case ${index + 1}: second KOT resent first submitted line`);
    const live = await json('GET', `/orders/live?restaurantId=${restaurantId}`);
    if (!live.orders.some(order => Number(order.id) === Number(saved.orderId))) throw new Error(`case ${index + 1}: live billing visibility failed`);
    const discount = index % 2 === 0
      ? await json('POST', '/orders/apply-discount', { restaurantId, actor, orderId: saved.orderId, type: 'MANUAL', value: 5, valueType: 'FLAT', appliedByRole: 'OWNER' })
      : await json('POST', '/orders/apply-discount', { restaurantId, actor, orderId: saved.orderId, type: 'PROMO', value: 1, valueType: 'FLAT', promoCode, appliedByRole: 'OWNER' });
    let settled;
    try {
      settled = await json('POST', '/orders/settle', { restaurantId, actor, orderId: saved.orderId, payments: [{ method: 'CASH', amount: Math.ceil(Number(discount.netPayable)) }] });
    } catch (error) {
      console.error(JSON.stringify({ case: index + 1, orderId: saved.orderId, discount }, null, 2));
      throw error;
    }
    if (Number(settled.payable) > Math.ceil(Number(discount.netPayable)) || Number(settled.paidAmount) < Number(settled.payable)) throw new Error(`case ${index + 1}: settlement total mismatch`);
    const invoice = await json('GET', `/orders/invoices/${saved.orderId}?restaurantId=${restaurantId}`);
    if (!invoice.invoice && !invoice.order && !invoice.success) throw new Error(`case ${index + 1}: invoice retrieval failed`);
    results.push({ case: index + 1, table: table.table_name, orderId: saved.orderId, discount: index % 2 === 0 ? 'cash' : 'promo', payable: settled.payable });
  }

  const cleanup = openDatabase(restaurantId);
  cleanup.pragma('foreign_keys=OFF');
  for (const table of ['order_item_modifiers', 'order_inventory_deductions', 'order_status_history', 'order_locks', 'payments', 'discounts', 'kots', 'print_jobs', 'delivery_orders', 'orders']) {
    try { cleanup.prepare(`DELETE FROM ${table} WHERE order_id IN (${created.map(() => '?').join(',')})`).run(...created); } catch (_) { /* optional table */ }
  }
  try { cleanup.prepare("DELETE FROM promo_codes WHERE code = 'MATRIX10'").run(); } catch (_) {}
  cleanup.pragma('foreign_keys=ON'); cleanup.close();
  console.log(JSON.stringify({ passed: true, combinations: results.length, cashDiscountCases: 50, promoCases: 50, sample: results.slice(0, 3) }, null, 2));
}
main().then(() => process.exit(0)).catch(error => { console.error(error.stack || error.message); process.exit(1); });
