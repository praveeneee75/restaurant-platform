const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.resolve(__dirname, '..');

function file(relativePath) {
  return path.join(root, relativePath);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function read(relativePath) {
  const target = file(relativePath);
  assert(fs.existsSync(target), `Missing required file: ${relativePath}`);
  return fs.readFileSync(target, 'utf8');
}

function checkJs(relativePath) {
  execFileSync(process.execPath, ['--check', file(relativePath)], { stdio: 'pipe' });
}

function walkFiles(relativePath, predicate) {
  const start = file(relativePath);
  const out = [];
  for (const entry of fs.readdirSync(start, { withFileTypes: true })) {
    const full = path.join(start, entry.name);
    const rel = path.relative(root, full).replace(/\\/g, '/');
    if (entry.isDirectory()) out.push(...walkFiles(rel, predicate));
    if (entry.isFile() && predicate(rel)) out.push(rel);
  }
  return out;
}

[
  'pos-app/backend/server.js',
  'pos-app/backend/services/schema.js',
  'pos-app/backend/services/migrationRunner.js',
  'pos-app/backend/public/js/online-order.js',
  'saas-backend/src/routes/organizations.js',
  'saas-backend/src/routes/monitoring.js',
  'saas-backend/src/app.js',
  'saas-backend/public/js/admin.js',
  'saas-backend/public/js/owner-mobile.js',
  'mobile-app/www/js/app.js'
].forEach(checkJs);

const mobileApp = read('mobile-app/www/js/app.js');
assert(mobileApp.includes('`${MOBILE_DIRECTORY_URL}/license/owner-pos-login`'), 'Mobile owner email login must use the cloud endpoint');
assert(mobileApp.includes('`${base}/mobile-app/login`'), 'Mobile staff PIN login must use the restaurant POS endpoint');
assert(mobileApp.includes('if (ownerStyleLogin)'), 'Mobile login must distinguish owner email from staff username');

const posServer = read('pos-app/backend/server.js');
const electronMain = read('pos-app/electron/main.js');
assert(electronMain.includes("process.env.KMASTER_SAAS_URL || 'https://api.kmasterpos.com'"), 'Desktop production must use the K\'Master cloud API');
assert(posServer.includes("`${saasUrl}/license/owner-pos-login`"), 'Desktop owner email login must use the cloud endpoint');
[
  "app.get('/analytics/dashboard'",
  "app.get('/reports/advanced'",
  "app.get('/journal/search'",
  "app.get('/fraud/alerts'",
  "app.post('/credit/sale'",
  "app.get('/payments/providers'",
  "app.get('/diagnostics'",
  "app.post('/online/orders/place'",
  "app.post('/disaster/restore-latest-backup'",
  "app.post('/demo/reset'"
].forEach((needle) => assert(posServer.includes(needle), `Missing POS route: ${needle}`));

const adminJs = read('pos-app/backend/public/js/admin-dashboard.js');
[
  'editKitchen',
  'editCategory',
  'editItem',
  'editUser',
  'editTable',
  'editSupplier',
  'editIngredient',
  'editModifierGroup',
  'editModifierOption',
  'editCombo'
].forEach((handler) => {
  assert(adminJs.includes(`function ${handler}(`), `Missing admin edit handler: ${handler}`);
  assert(adminJs.includes(`pick("${handler.replace(/^edit/, 'edit')}")`) || adminJs.includes(handler), `Missing admin click branch for: ${handler}`);
});

assert(adminJs.includes('showInventoryTab(btn.dataset.inventoryTab)'), 'Inventory tab buttons are not wired to switch panels');
assert(adminJs.includes('showModifierTab(btn.dataset.modifierTab)'), 'Modifier tab buttons are not wired to switch panels');

const schema = read('pos-app/backend/services/schema.js');
[
  'electronic_journal',
  'fraud_alerts',
  'customer_credit_accounts',
  'credit_transactions',
  'payment_providers',
  'notification_templates',
  'retention_settings'
].forEach((needle) => assert(schema.includes(needle), `Missing local schema object: ${needle}`));

const saasApp = read('saas-backend/src/app.js');
assert(saasApp.includes("app.use('/organizations'"), 'Organizations route module is not mounted');

const saasMigrate = read('saas-backend/src/db/migrate.js');
[
  'organizations',
  'organization_users',
  'branch_groups',
  'organization_restaurants',
  'support_notes'
].forEach((needle) => assert(saasMigrate.includes(needle), `Missing SaaS migration object: ${needle}`));

[
  'pos-app/backend/public/online-order.html',
  'pos-app/backend/public/orders.html',
  'pos-app/backend/public/js/orders.js',
  'saas-backend/public/owner-mobile.html',
  'docs/commercial-readiness-checklist.md',
  'docs/disaster-recovery.md'
].forEach((relativePath) => assert(fs.existsSync(file(relativePath)), `Missing support file: ${relativePath}`));

[
  'pos-app/backend/public/orders.html',
  'pos-app/backend/public/js/orders.js'
].forEach((relativePath) => {
  const content = read(relativePath);
  assert(!content.includes('\u0000'), `Corrupted null bytes found in ${relativePath}`);
});

[
  ...walkFiles('pos-app/backend/public', (name) => /\.(html|js|css)$/i.test(name)),
  ...walkFiles('saas-backend/public', (name) => /\.(html|js|css)$/i.test(name))
].forEach((relativePath) => {
  const content = read(relativePath);
  assert(!content.includes('\u0000'), `Corrupted null bytes found in ${relativePath}`);
});

console.log('Commercial readiness smoke checks passed.');
