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
  return Number(result.lastInsertRowid);
}
const settledOrderId = addOrder({ invoice:'INV-0001', gross:100, discountType:'PERCENT', discountValue:10, total:90, tax:4.76, payment:90 });
addOrder({ invoice:null, gross:200, discountType:'FLAT', discountValue:20, total:180, tax:9.52, payment:180 });
const legacyPaidId = Number(db.prepare(`INSERT INTO orders(order_type,status,total_amount,tax_amount,payment_status,is_invoice,created_by,created_at,updated_at,settled_at)
  VALUES('DINE_IN','PAID',0,42.86,'PAID',0,?,'2026-08-05 10:30:00','2026-08-05 10:30:00','2026-08-05 10:30:00')`).run(user?.id || 1).lastInsertRowid);
db.prepare("INSERT INTO order_items(order_id,item_id,quantity,kitchen_id,price,status,kot_id) VALUES(?,?,?,?,0,'CANCELLED',?)").run(legacyPaidId,item.id,1,kitchen.id,db.prepare("INSERT INTO kots(order_id,kitchen_id,status) VALUES(?,?,'CREATED')").run(legacyPaidId,kitchen.id).lastInsertRowid);
db.prepare("INSERT INTO payments(order_id,payment_mode,amount,created_at) VALUES(?,'CASH',900,'2026-08-05 10:30:00')").run(legacyPaidId);
db.prepare("INSERT INTO orders(order_type,status,total_amount,payment_status,created_by,created_at,updated_at,cancelled_at) VALUES('PARCEL','CANCELLED',50,'UNPAID',?,'2026-08-05 11:00:00','2026-08-05 11:00:00','2026-08-05 11:00:00')").run(user?.id || 1);
const settledItemId = db.prepare('SELECT id FROM order_items WHERE order_id=? LIMIT 1').get(settledOrderId).id;
const openOrderId = Number(db.prepare("INSERT INTO orders(order_type,status,total_amount,payment_status,created_by,created_at,updated_at) VALUES('DINE_IN','KOT_SUBMITTED',50,'UNPAID',?,'2026-08-05 12:00:00','2026-08-05 12:00:00')").run(user?.id || 1).lastInsertRowid);
const openKotId = Number(db.prepare("INSERT INTO kots(order_id,kitchen_id,status,created_at) VALUES(?,?,'CREATED','2026-08-05 12:00:00')").run(openOrderId,kitchen.id).lastInsertRowid);
db.prepare("INSERT INTO order_items(order_id,item_id,quantity,kitchen_id,price,status,kot_id) VALUES(?,?,?,?,30,'PLACED',?)").run(openOrderId,item.id,1,kitchen.id,openKotId);
db.prepare("INSERT INTO order_items(order_id,item_id,quantity,kitchen_id,price,status,kot_id) VALUES(?,?,?,?,20,'SAVED',NULL)").run(openOrderId,item.id,1,kitchen.id);
db.close();
require('../pos-app/backend/server');

function get(role) { return new Promise((resolve,reject) => {
  http.get(`http://127.0.0.1:3417/reports/dashboard?restaurantId=${restaurantId}&role=${role}&fromDate=2026-08-05&toDate=2026-08-05`, (res) => { let body=''; res.on('data',(c)=>body+=c); res.on('end',()=>resolve(JSON.parse(body))); }).on('error',reject);
}); }
function request(method, pathName, body) { return new Promise((resolve,reject) => {
  const encoded = body ? JSON.stringify(body) : '';
  const req = http.request({ hostname:'127.0.0.1', port:3417, method, path:pathName, headers:{ 'Content-Type':'application/json', 'Content-Length':Buffer.byteLength(encoded) } }, (res) => { let text=''; res.on('data',(c)=>text+=c); res.on('end',()=>resolve({ status:res.statusCode, body:JSON.parse(text) })); });
  req.on('error', reject); if (encoded) req.write(encoded); req.end();
}); }
(async () => {
  const owner = (await get('OWNER')).executiveSales;
  assert.strictEqual(owner.paid.count, 3);
  assert.strictEqual(owner.paid.sub_total, 1200);
  assert.strictEqual(owner.paid.discount, 30);
  assert.strictEqual(owner.paid.grand_total, 1170);
  assert.strictEqual(owner.paid.tax, 57.14);
  assert.strictEqual(owner.paid.net_sales, 1112.86);
  assert.strictEqual(owner.paid.invoice_from, 'INV-0001');
  assert.strictEqual(owner.paid.invoice_to, 'INV-0001');
  for (const field of ['delivery_charge','container_charge','service_charge','additional_charge','other_deduction','round_off','waived_off']) assert.strictEqual(owner.paid[field], 0, `${field} must be calculated explicitly`);
  assert.strictEqual(owner.cancelled.count, 1);
  assert.strictEqual(owner.cancelled.amount, 50);
  assert.strictEqual(owner.orderTypes[0].count, 3);
  assert.strictEqual(owner.orderTypes[0].total, 1170);
  assert.strictEqual(owner.payments[0].total, 1170);
  const itemCancel = await request('POST', '/kds/item-status', { restaurantId, actor:{role:'OWNER'}, orderItemId:settledItemId, status:'CANCELLED' });
  assert.strictEqual(itemCancel.status, 409, 'KDS must reject item cancellation after settlement');
  const orderCancel = await request('POST', '/kds/order-status', { restaurantId, actor:{role:'OWNER'}, orderId:settledOrderId, status:'CANCELLED' });
  assert.strictEqual(orderCancel.status, 409, 'KDS must reject order cancellation after settlement');
  const afterKds = (await get('OWNER')).executiveSales;
  assert.deepStrictEqual(afterKds.paid, owner.paid, 'KDS attempts must not mutate settled report values');
  const openCancel = await request('POST', '/kds/order-status', { restaurantId, actor:{role:'OWNER'}, orderId:openOrderId, status:'CANCELLED' });
  assert.strictEqual(openCancel.status, 200, 'KDS must allow cancellation of an open KOT-submitted order');
  const verifyDb = openDatabase(restaurantId);
  const openLines = verifyDb.prepare('SELECT kot_id,price,status FROM order_items WHERE order_id=? ORDER BY id').all(openOrderId);
  const openTotal = verifyDb.prepare('SELECT total_amount FROM orders WHERE id=?').get(openOrderId).total_amount;
  verifyDb.close();
  assert.strictEqual(openLines[0].price, 0, 'KDS cancellation must remove the submitted KOT line value');
  assert.strictEqual(openLines[0].status, 'CANCELLED');
  assert.strictEqual(openLines[1].price, 20, 'KDS cancellation must preserve an unsubmitted saved line');
  assert.strictEqual(openLines[1].status, 'SAVED');
  assert.strictEqual(openTotal, 20, 'Open order total must retain only the unsubmitted saved line');
  const operational = (await request('GET', `/reports/operational-summary?restaurantId=${restaurantId}&role=OWNER&type=sales&fromDate=2026-08-05&toDate=2026-08-05`)).body;
  assert.strictEqual(operational.rows.reduce((sum,row)=>sum+Number(row.discount_amount || 0),0), 30, 'Operational report percentage discounts must use gross submitted item value');
  const invalidRange = await request('GET', `/reports/dashboard?restaurantId=${restaurantId}&role=OWNER&fromDate=2026-08-09&toDate=2026-03-31`);
  assert.strictEqual(invalidRange.status, 400, 'Reports API must reject To date earlier than From date');
  const manager1 = (await get('MANAGER_1')).executiveSales;
  assert.strictEqual(manager1.paid.count, 1, 'Manager 1 must see invoiced bills only');
  assert.strictEqual(manager1.paid.sub_total, 100);
  assert.strictEqual(manager1.paid.discount, 10, 'Percentage discount must use gross, not final total');
  assert.strictEqual(manager1.paid.grand_total, 90);
  assert.strictEqual(manager1.payments[0].total, 90, 'Payment breakdown must exclude order-number-only bills');
  const manager2 = (await get('MANAGER_2')).executiveSales;
  assert.strictEqual(manager2.paid.count, 3, 'Manager 2 must see invoice and order-number-only bills, including recovered legacy settlements');
  console.log('Sales Summary calculation and invoice visibility regression passed.');
  process.exit(0);
})().catch((error) => { console.error(error); process.exit(1); });
