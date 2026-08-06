const fs = require('fs');
const path = require('path');
const http = require('http');
const assert = require('assert');

const testDataDir = path.join(__dirname, '..', '.codex-sales-summary-test');
fs.rmSync(testDataDir, { recursive:true, force:true });
process.env.POS_DATA_DIR = testDataDir;
process.env.PORT = '3417';
process.env.POS_HEARTBEAT_DISABLED = '1';
const restaurantId = 'REPORTCALC';
const { setupDatabase } = require('../pos-app/backend/services/dbSetup');
const { openDatabase } = require('../pos-app/backend/db/database');
const { seedWhitelabelDemoData } = require('../pos-app/backend/services/whitelabelDemoSeed');
setupDatabase(restaurantId);
const db = openDatabase(restaurantId);
seedWhitelabelDemoData(db, { restaurantId, force:true });
const item = db.prepare('SELECT id FROM items ORDER BY id LIMIT 1').get();
const kitchen = db.prepare('SELECT id FROM kitchens ORDER BY id LIMIT 1').get();
const user = db.prepare('SELECT id FROM users ORDER BY id LIMIT 1').get();
function addOrder({ invoice, gross, discountType, discountValue, total, tax, payment }) {
  const result = db.prepare(`INSERT INTO orders(order_type,status,total_amount,tax_amount,payment_status,invoice_no,is_invoice,created_by,created_at,updated_at,settled_at)
    VALUES('DINE_IN','PAID',?,?, 'PAID',?,?,?,'2026-08-05 10:00:00','2026-08-05 10:00:00','2026-08-05 10:00:00')`).run(total,tax,invoice || null,invoice ? 1 : 0,user?.id || 1);
  db.prepare("INSERT INTO kots(order_id,kitchen_id,status,created_at) VALUES(?,?,'CREATED','2026-08-05 09:55:00')").run(result.lastInsertRowid,kitchen.id);
  const kot = db.prepare('SELECT id FROM kots WHERE order_id=?').get(result.lastInsertRowid);
  db.prepare("INSERT INTO order_items(order_id,item_id,quantity,kitchen_id,price,status,kot_id) VALUES(?,?,?,?,?,'PLACED',?)").run(result.lastInsertRowid,item.id,1,kitchen.id,gross,kot.id);
  db.prepare("INSERT INTO discounts(order_id,type,value,value_type,applied_by) VALUES(?,'MANUAL',?,?,'OWNER')").run(result.lastInsertRowid,discountValue,discountType);
  db.prepare("INSERT INTO payments(order_id,payment_mode,amount,created_at) VALUES(?,'CASH',?,'2026-08-05 10:00:00')").run(result.lastInsertRowid,payment);
}
addOrder({ invoice:'INV-0001', gross:100, discountType:'PERCENT', discountValue:10, total:90, tax:4.76, payment:90 });
addOrder({ invoice:null, gross:200, discountType:'FLAT', discountValue:20, total:180, tax:9.52, payment:180 });
db.close();
require('../pos-app/backend/server');

function get(role) { return new Promise((resolve,reject) => {
  http.get(`http://127.0.0.1:3417/reports/dashboard?restaurantId=${restaurantId}&role=${role}&fromDate=2026-08-05&toDate=2026-08-05`, (res) => { let body=''; res.on('data',(c)=>body+=c); res.on('end',()=>resolve(JSON.parse(body))); }).on('error',reject);
}); }
(async () => {
  const owner = (await get('OWNER')).executiveSales;
  assert.strictEqual(owner.paid.count, 2);
  assert.strictEqual(owner.paid.sub_total, 300);
  assert.strictEqual(owner.paid.discount, 30);
  assert.strictEqual(owner.paid.grand_total, 270);
  assert.strictEqual(owner.payments[0].total, 270);
  const manager1 = (await get('MANAGER_1')).executiveSales;
  assert.strictEqual(manager1.paid.count, 1, 'Manager 1 must see invoiced bills only');
  assert.strictEqual(manager1.paid.sub_total, 100);
  assert.strictEqual(manager1.paid.discount, 10, 'Percentage discount must use gross, not final total');
  assert.strictEqual(manager1.paid.grand_total, 90);
  assert.strictEqual(manager1.payments[0].total, 90, 'Payment breakdown must exclude order-number-only bills');
  const manager2 = (await get('MANAGER_2')).executiveSales;
  assert.strictEqual(manager2.paid.count, 2, 'Manager 2 must see invoice and order-number-only bills');
  console.log('Sales Summary calculation and invoice visibility regression passed.');
  process.exit(0);
})().catch((error) => { console.error(error); process.exit(1); });
