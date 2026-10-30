const http = require('http');
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const dataDir = path.join(root, '.codex-customer-loyalty-test');
fs.rmSync(dataDir, { recursive: true, force: true });
process.env.POS_DATA_DIR = dataDir;
process.env.PORT = process.env.CUSTOMER_LOYALTY_TEST_PORT || '3495';
process.env.POS_HEARTBEAT_DISABLED = '1';
const port = Number(process.env.PORT);
const restaurantId = 'CUSTOMERLOYALTYTEST';
const { openDatabase } = require(path.join(root, 'pos-app/backend/db/database'));
const { setupDatabase } = require(path.join(root, 'pos-app/backend/services/dbSetup'));
const { seedWhitelabelDemoData } = require(path.join(root, 'pos-app/backend/services/whitelabelDemoSeed'));
setupDatabase(restaurantId);
let db = openDatabase(restaurantId);
seedWhitelabelDemoData(db, { restaurantId, force: true });
const orderId = Number(db.prepare("INSERT INTO orders(order_type, table_no, status, payment_status, total_amount) VALUES ('DINE_IN', 'Table 1', 'OPEN', 'UNPAID', 100)").run().lastInsertRowid);
db.close();
require(path.join(root, 'pos-app/backend/server'));
const owner = { id: 1, role: 'OWNER', name: 'CRM regression' };

function request(method, route, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const req = http.request({ hostname: '127.0.0.1', port, path: route, method, timeout: 15000, headers: payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {} }, (res) => {
      let text = ''; res.on('data', (chunk) => { text += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, data: JSON.parse(text) }));
    });
    req.on('error', reject); req.on('timeout', () => req.destroy(new Error('timeout')));
    if (payload) req.write(payload); req.end();
  });
}
function requestRaw(route) {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port, path: route, method: 'GET', timeout: 15000 }, (res) => {
      const chunks = []; res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject); req.on('timeout', () => req.destroy(new Error('timeout'))); req.end();
  });
}
async function ok(method, route, body) {
  const result = await request(method, route, body);
  if (result.status >= 400 || result.data.success === false) throw new Error(`${route}: ${result.data.message || result.status}`);
  return result.data;
}

async function main() {
  await new Promise((resolve) => setTimeout(resolve, 500));
  const attached = await ok('POST', '/customers/create-and-attach', { restaurantId, actor: owner, orderId, name: 'Loyalty Tea Customer', phone: '+91 98765 43210' });
  if (attached.customer.phone !== '9876543210') throw new Error('customer mobile was not normalized');
  db = openDatabase(restaurantId);
  if (Number(db.prepare('SELECT customer_id FROM orders WHERE id = ?').get(orderId).customer_id) !== Number(attached.customer.id)) throw new Error('customer was not attached to the open bill');
  db.close();
  const issued = await ok('POST', '/customers/cards/issue', { restaurantId, actor: owner, customerId: attached.customer.id });
  if (!issued.card.card_code || !issued.card.qrPayload.includes(issued.card.card_code)) throw new Error('loyalty card did not include barcode and QR payload values');
  const qr = await requestRaw(`/customers/cards/${issued.card.id}/qr.png?restaurantId=${restaurantId}`);
  if (qr.status !== 200 || qr.headers['content-type'] !== 'image/png' || qr.body.length < 500) throw new Error('printable loyalty QR code was not generated');
  const lookedUp = await ok('GET', `/customers/lookup?restaurantId=${restaurantId}&role=OWNER&query=${encodeURIComponent(issued.card.qrPayload)}`);
  if (Number(lookedUp.customer?.id) !== Number(attached.customer.id)) throw new Error('QR loyalty card scan did not find the customer');
  const managerLookup = await ok('GET', `/customers/lookup?restaurantId=${restaurantId}&role=MANAGER_1&query=${encodeURIComponent(issued.card.card_code)}`);
  if (Number(managerLookup.customer?.id) !== Number(attached.customer.id)) throw new Error('manager could not use customer and loyalty lookup');
  const cashierAttach = await request('POST', '/customers/attach-order', { restaurantId, actor: { id: 2, role: 'CASHIER' }, orderId, customerId: attached.customer.id });
  if (cashierAttach.status !== 403) throw new Error('cashier received customer-management access');
  const replaced = await ok('POST', '/customers/cards/replace-lost', { restaurantId, actor: owner, customerId: attached.customer.id, oldCardId: issued.card.id });
  const oldCardLookup = await ok('GET', `/customers/lookup?restaurantId=${restaurantId}&role=OWNER&query=${encodeURIComponent(issued.card.card_code)}`);
  if (oldCardLookup.customer) throw new Error('lost loyalty card remained scannable');
  const replacementLookup = await ok('GET', `/customers/lookup?restaurantId=${restaurantId}&role=OWNER&query=${encodeURIComponent(replaced.card.card_code)}`);
  if (Number(replacementLookup.customer?.id) !== Number(attached.customer.id)) throw new Error('replacement loyalty card did not find the customer');
  await ok('POST', '/customers/cards/deactivate', { restaurantId, actor: owner, cardId: replaced.card.id });
  const deactivatedLookup = await ok('GET', `/customers/lookup?restaurantId=${restaurantId}&role=OWNER&query=${encodeURIComponent(replaced.card.card_code)}`);
  if (deactivatedLookup.customer) throw new Error('deactivated loyalty card remained scannable');
  const duplicate = await request('POST', '/customers/create', { restaurantId, actor: owner, name: 'Duplicate', phone: '9876543210' });
  if (duplicate.status !== 409) throw new Error('unique customer mobile validation failed');
  const billing = fs.readFileSync(path.join(root, 'pos-app/backend/public/js/billing.js'), 'utf8');
  if (!billing.includes('billingCustomerManagement') || !billing.includes('openBillingCustomerManager') || !billing.includes('create-and-attach')) throw new Error('Billing customer management UI is incomplete');
  console.log('Customer loyalty card regression passed: unique mobile registration, bill attachment, QR/barcode lookup, issue, lost replacement, deactivation and Billing UI controls.');
  process.exit(0);
}
main().catch((error) => { console.error(error); process.exit(1); });
