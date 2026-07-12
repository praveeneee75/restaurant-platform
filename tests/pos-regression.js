const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const live = fs.readFileSync(path.join(root, 'pos-app/backend/public/js/pos-live.js'), 'utf8');
const liveHtml = fs.readFileSync(path.join(root, 'pos-app/backend/public/pos-live.html'), 'utf8');
const waiter = fs.readFileSync(path.join(root, 'pos-app/backend/public/js/waiter.js'), 'utf8');
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'pos-app/package.json'), 'utf8'));

assert.match(live, /activeTableId/);
assert.match(live, /tableSelectionRequest/);
assert.match(live, /data-item-minus/);
assert.match(live, /data-item-plus/);
assert.match(live, /data-cart-line/);
assert.doesNotMatch(liveHtml, /id="editItemBtn"/);
assert.doesNotMatch(live, /moveOrderToTable\(target\.id\)/);
assert.match(waiter, /data-cart-line/);
assert.match(packageJson.scripts['post-dist:win'], /npm rebuild better-sqlite3 bcrypt/);

console.log(JSON.stringify({
  passed: true,
  cases: ['POS-003', 'POS-004', 'POS-005', 'POS-006', 'POS-009', 'POS-010', 'POS-011']
}, null, 2));
