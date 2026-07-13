const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const live = fs.readFileSync(path.join(root, 'pos-app/backend/public/js/pos-live.js'), 'utf8');
const liveHtml = fs.readFileSync(path.join(root, 'pos-app/backend/public/pos-live.html'), 'utf8');
const waiter = fs.readFileSync(path.join(root, 'pos-app/backend/public/js/waiter.js'), 'utf8');
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'pos-app/package.json'), 'utf8'));
const server = fs.readFileSync(path.join(root, 'pos-app/backend/server.js'), 'utf8');

assert.match(live, /activeTableId/);
assert.match(live, /const isPositiveId/);
assert.match(live, /tableSelectionRequest/);
assert.match(live, /data-item-minus/);
assert.match(live, /data-item-plus/);
assert.match(live, /data-cart-line/);
assert.doesNotMatch(liveHtml, /id="editItemBtn"/);
assert.doesNotMatch(live, /moveOrderToTable\(target\.id\)/);
assert.match(waiter, /data-cart-line/);
assert.match(packageJson.scripts['post-dist:win'], /npm rebuild better-sqlite3 bcrypt/);
assert.match(server, /kotReference/);
assert.match(server, /suborderNo/);
assert.match(server, /customerName, customerPhone/);
assert.match(live, /item\.sentToKitchen = true/);
assert.match(live, /kotStatus\.textContent/);
assert.match(live, /const settledTableId = state\.selectedTable\?\.id/);
assert.match(live, /selectTable\(settledTableId/);
assert.match(live, /selectedOpenOrder/);
assert.match(live, /restoreSelectedTableOrder/);
assert.match(live, /state\.openOrders\[0\]\?\.id/);
assert.match(live, /rememberedTableId/);

console.log(JSON.stringify({
  passed: true,
  cases: ['POS-003', 'POS-004', 'POS-005', 'POS-006', 'POS-009', 'POS-010', 'POS-011', 'POS-013', 'POS-014', 'POS-015', 'POS-016']
}, null, 2));
