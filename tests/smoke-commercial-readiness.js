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

[
  'pos-app/backend/server.js',
  'pos-app/backend/services/schema.js',
  'pos-app/backend/services/migrationRunner.js',
  'pos-app/backend/public/js/online-order.js',
  'saas-backend/src/routes/organizations.js',
  'saas-backend/src/routes/monitoring.js',
  'saas-backend/src/app.js',
  'saas-backend/public/js/admin.js',
  'saas-backend/public/js/owner-mobile.js'
].forEach(checkJs);

const posServer = read('pos-app/backend/server.js');
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
  'saas-backend/public/owner-mobile.html',
  'docs/commercial-readiness-checklist.md',
  'docs/disaster-recovery.md'
].forEach((relativePath) => assert(fs.existsSync(file(relativePath)), `Missing support file: ${relativePath}`));

console.log('Commercial readiness smoke checks passed.');
