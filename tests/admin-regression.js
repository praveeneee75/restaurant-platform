const http = require('http');
const path = require('path');

process.env.PORT = process.env.ADMIN_REGRESSION_PORT || '3401';
process.env.POS_HEARTBEAT_DISABLED = '1';

const posRoot = path.join(__dirname, '..', 'pos-app');
const { openDatabase } = require(path.join(posRoot, 'backend/db/database'));
const { getSingleRestaurantId } = require(path.join(posRoot, 'backend/utils/restaurantScanner'));
require(path.join(posRoot, 'backend/server'));

const port = Number(process.env.PORT);
const restaurantId = process.env.POS_SMOKE_RESTAURANT_ID || getSingleRestaurantId();
const actor = { id: 1, role: 'OWNER', name: 'Admin Regression' };
const stamp = Date.now();
const names = {
  printer: `Regression Printer ${stamp}`,
  kitchen: `Regression Kitchen ${stamp}`,
  category: `Regression Category ${stamp}`,
  user: `regression_user_${stamp}`
};

function request(method, targetPath, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const req = http.request({ hostname: '127.0.0.1', port, path: targetPath, method, timeout: 10000,
      headers: payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {} }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('timeout', () => req.destroy(new Error(`${method} ${targetPath} timeout`)));
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function json(method, targetPath, body) {
  const response = await request(method, targetPath, body);
  const data = JSON.parse(response.body || '{}');
  return { response, data };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function main() {
  if (!restaurantId) throw new Error('No local restaurant database found');
  await new Promise((resolve) => setTimeout(resolve, 700));
  let printerId;
  let kitchenId;
  let categoryId;
  let userId;
  try {
    let result = await json('GET', `/admin/bootstrap?restaurantId=${encodeURIComponent(restaurantId)}&includeInactive=true`);
    assert(result.response.status === 200 && result.data.success, 'Admin bootstrap failed');
    assert(Array.isArray(result.data.printers) && Array.isArray(result.data.kitchens) && Array.isArray(result.data.categories), 'Admin bootstrap collections missing');

    result = await json('POST', '/admin/printers/save', { restaurantId, actor, name: names.printer, type: 'KITCHEN', connection: 'NETWORK', address: '127.0.0.1', active: true });
    assert(result.response.status === 200 && result.data.success, 'Printer create failed');
    printerId = result.data.id;

    result = await json('POST', '/admin/printers/save', { restaurantId, actor, name: names.printer, type: 'KITCHEN', connection: 'NETWORK', address: '127.0.0.2', active: true });
    assert(result.response.status >= 400 && /already exists/i.test(result.data.message || ''), 'Duplicate printer was accepted');

    result = await json('POST', '/admin/kitchens/save', { restaurantId, actor, name: names.kitchen, printerId, active: true });
    assert(result.response.status === 200 && result.data.success, 'Kitchen create failed');
    kitchenId = result.data.id;

    result = await json('POST', '/admin/categories/save', { restaurantId, actor, name: names.category, kitchenId, active: true });
    assert(result.response.status === 200 && result.data.success, 'Category create failed');
    categoryId = result.data.id;

    result = await json('POST', '/admin/categories/save', { restaurantId, actor, name: names.category, kitchenId, active: true });
    assert(result.response.status >= 400 && /already exists/i.test(result.data.message || ''), 'Duplicate category was accepted');

    result = await json('POST', '/admin/users/save', { restaurantId, actor, name: 'Regression User', username: names.user, pin: '654321', role: 'CASHIER', active: true });
    assert(result.response.status === 200 && result.data.success, 'User create failed');
    userId = result.data.id;
    result = await json('POST', '/admin/users/save', { restaurantId, actor, id: userId, name: 'Regression User Edited', username: names.user, pin: '', role: 'CASHIER', active: true });
    assert(result.response.status === 200 && result.data.success, 'User edit failed');

    result = await json('POST', '/admin/printers/delete', { restaurantId, actor, id: printerId });
    assert(result.response.status === 200 && result.data.success, 'Printer disable failed');
    result = await json('POST', '/admin/kitchens/delete', { restaurantId, actor, id: kitchenId });
    assert(result.response.status === 200 && result.data.success, 'Kitchen disable failed');
    result = await json('GET', `/admin/bootstrap?restaurantId=${encodeURIComponent(restaurantId)}&includeInactive=true`);
    const disabledPrinter = result.data.printers.find((row) => Number(row.id) === Number(printerId));
    const disabledKitchen = result.data.kitchens.find((row) => Number(row.id) === Number(kitchenId));
    const retainedCategory = result.data.categories.find((row) => Number(row.id) === Number(categoryId));
    assert(disabledPrinter && Number(disabledPrinter.active) === 0, 'Disabled printer missing from Admin list');
    assert(disabledKitchen && Number(disabledKitchen.active) === 0, 'Disabled kitchen missing from Admin list');
    assert(retainedCategory && Number(retainedCategory.kitchen_active) === 0, 'Category did not retain inactive kitchen status');
    console.log('Admin regression passed: tracker rows 2-12 covered');
  } finally {
    const db = openDatabase(restaurantId);
    try {
      if (categoryId) db.prepare('DELETE FROM categories WHERE id = ?').run(categoryId);
      if (kitchenId) db.prepare('DELETE FROM kitchens WHERE id = ?').run(kitchenId);
      if (printerId) db.prepare('DELETE FROM printers WHERE id = ?').run(printerId);
      if (userId) db.prepare('DELETE FROM users WHERE id = ?').run(userId);
    } finally { db.close(); }
  }
}

main().catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; });
