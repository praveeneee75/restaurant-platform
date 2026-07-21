const Database = require('../pos-app/node_modules/better-sqlite3');

const db = new Database(':memory:');
db.exec(`
  CREATE TABLE orders (
    id INTEGER PRIMARY KEY,
    status TEXT,
    payment_status TEXT,
    billing_ready INTEGER DEFAULT 0
  );
  CREATE TABLE notification_logs (
    id INTEGER PRIMARY KEY,
    event_type TEXT NOT NULL,
    channel TEXT NOT NULL,
    recipient TEXT,
    payload TEXT,
    status TEXT NOT NULL DEFAULT 'QUEUED',
    resolved_at DATETIME
  );
`);

const resolveCompleted = db.prepare(`
  UPDATE notification_logs
  SET status = 'RESOLVED', resolved_at = CURRENT_TIMESTAMP
  WHERE channel = 'IN_APP' AND status = 'QUEUED' AND event_type = 'FINAL_BILL_READY'
    AND NOT EXISTS (
      SELECT 1 FROM orders o
      WHERE o.id = CAST(json_extract(notification_logs.payload, '$.orderId') AS INTEGER)
        AND COALESCE(o.billing_ready, 0) = 1
        AND COALESCE(o.payment_status, '') != 'PAID'
        AND COALESCE(o.status, '') != 'CANCELLED'
    )
`);

db.prepare("INSERT INTO orders VALUES (1, 'OPEN', 'UNPAID', 1)").run();
db.prepare("INSERT INTO notification_logs VALUES (1, 'FINAL_BILL_READY', 'IN_APP', 'CASHIER', ?, 'QUEUED', NULL)")
  .run(JSON.stringify({ orderId: 1 }));

resolveCompleted.run();
if (db.prepare('SELECT status FROM notification_logs WHERE id = 1').get().status !== 'QUEUED') {
  throw new Error('An unresolved ready-for-billing task was cleared prematurely');
}

db.prepare("UPDATE orders SET status = 'PAID', payment_status = 'PAID', billing_ready = 0 WHERE id = 1").run();
resolveCompleted.run();
const completed = db.prepare('SELECT status, resolved_at FROM notification_logs WHERE id = 1').get();
if (completed.status !== 'RESOLVED' || !completed.resolved_at) {
  throw new Error('A paid task did not clear its notification');
}

db.prepare("INSERT INTO notification_logs VALUES (2, 'FINAL_BILL_READY', 'IN_APP', 'OWNER', ?, 'QUEUED', NULL)")
  .run(JSON.stringify({ orderId: 999 }));
resolveCompleted.run();
if (db.prepare('SELECT status FROM notification_logs WHERE id = 2').get().status !== 'RESOLVED') {
  throw new Error('An orphaned task notification remained queued');
}

db.close();
console.log('Notification lifecycle functional regression passed');
