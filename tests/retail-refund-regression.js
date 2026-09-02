const http = require('http');
const path = require('path');
const root = path.resolve(__dirname, '..');
process.env.POS_DATA_DIR = path.join(root, '.codex-retail-counter-test');
process.env.PORT = process.env.RETAIL_REFUND_TEST_PORT || '3493';
process.env.POS_HEARTBEAT_DISABLED = '1';
const port = Number(process.env.PORT);
const restaurantId = 'RETAILTEST';
const { openDatabase } = require(path.join(root, 'pos-app/backend/db/database'));
require(path.join(root, 'pos-app/backend/server'));

function post(route, body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const request = http.request({ hostname:'127.0.0.1', port, path:route, method:'POST', timeout:15000,
      headers:{ 'Content-Type':'application/json', 'Content-Length':Buffer.byteLength(payload) } }, (response) => {
      let text=''; response.on('data', (chunk) => { text += chunk; });
      response.on('end', () => resolve({ status:response.statusCode, data:JSON.parse(text) }));
    });
    request.on('error', reject); request.write(payload); request.end();
  });
}

async function main() {
  await new Promise((resolve) => setTimeout(resolve, 700));
  let db = openDatabase(restaurantId);
  const order = db.prepare("SELECT id, paid_amount FROM orders WHERE order_type='RETAIL' AND payment_status='PAID' ORDER BY id DESC LIMIT 1").get();
  const line = db.prepare('SELECT item_id, SUM(quantity) quantity FROM order_items WHERE order_id=? GROUP BY item_id').get(order.id);
  const before = Number(db.prepare('SELECT retail_stock FROM items WHERE id=?').get(line.item_id).retail_stock);
  db.close();
  const refunded = await post('/orders/refund', { restaurantId, orderId:order.id, amount:order.paid_amount, refundMode:'CARD', reason:'Retail return regression', refundedByRole:'OWNER' });
  if (refunded.status >= 400 || refunded.data.success === false) throw new Error(refunded.data.message || 'refund failed');
  db = openDatabase(restaurantId);
  const after = Number(db.prepare('SELECT retail_stock FROM items WHERE id=?').get(line.item_id).retail_stock);
  const movement = db.prepare("SELECT COUNT(*) count,SUM(quantity) quantity FROM retail_stock_movements WHERE order_id=? AND movement_type='RETURN'").get(order.id);
  db.close();
  if (after !== before + Number(line.quantity) || Number(movement.count) !== 1 || Number(movement.quantity) !== Number(line.quantity)) throw new Error('full refund did not restore stock exactly once');
  console.log('Retail refund regression passed: full refund restores item stock once and records a RETURN movement.');
  process.exit(0);
}
main().catch((error) => { console.error(error); process.exit(1); });
