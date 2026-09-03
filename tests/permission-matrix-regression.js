const fs = require('fs');
const path = require('path');
const assert = require('assert');

const root = path.resolve(__dirname, '..');
const posRoot = path.join(root, 'pos-app');
const dataDir = path.join(root, '.codex-permission-matrix-test');
fs.rmSync(dataDir, { recursive: true, force: true });
process.env.POS_DATA_DIR = dataDir;

const { setupDatabase } = require(path.join(posRoot, 'backend/services/dbSetup'));
const { openDatabase } = require(path.join(posRoot, 'backend/db/database'));
const { DEFAULT_PERMISSIONS, seedDefaultPermissions, hasPermission } = require(path.join(posRoot, 'backend/services/permissions'));

const expected = [
  'customers.view', 'customers.manage', 'rewards.manage', 'reservations.manage',
  'devices.manage', 'printers.manage', 'orders.split', 'orders.unlock',
  'invoices.view', 'availability.manage', 'retail.view', 'retail.sell',
  'retail.stock_adjust', 'kitchen.reprint'
];

setupDatabase('PERMISSIONTEST');
const db = openDatabase('PERMISSIONTEST');
seedDefaultPermissions(db);
const codes = new Set(DEFAULT_PERMISSIONS.map(([code]) => code));
expected.forEach((code) => assert(codes.has(code), `missing permission catalogue control ${code}`));
const stored = new Set(db.prepare('SELECT code FROM permissions WHERE active = 1').all().map((row) => row.code));
expected.forEach((code) => assert(stored.has(code), `permission was not seeded ${code}`));
assert(hasPermission(db, 'OWNER', 'retail.stock_adjust'), 'OWNER must retain every control');
assert(hasPermission(db, 'CASHIER', 'retail.sell'), 'cashier retail access migration default changed');
assert(hasPermission(db, 'CASHIER', 'reports.view_invoice_only'), 'cashier report access is missing');
assert(hasPermission(db, 'MANAGER_1', 'reports.view_invoice_only'), 'manager report access is missing');
assert(!hasPermission(db, 'CAPTAIN', 'reports.view_invoice_only'), 'captain incorrectly received report access');
assert(!hasPermission(db, 'WAITER', 'billing.refund'), 'waiter received privileged billing access');
assert(hasPermission(db, 'CASHIER', 'orders.merge') && hasPermission(db, 'CASHIER', 'orders.split') && hasPermission(db, 'CASHIER', 'orders.unlock'), 'cashier billing workflow compatibility permissions are missing');
assert(hasPermission(db, 'CAPTAIN', 'availability.manage'), 'captain availability compatibility permission is missing');
assert(hasPermission(db, 'KITCHEN', 'kitchen.reprint'), 'kitchen reprint compatibility permission is missing');
const cashierRole = db.prepare("SELECT id FROM roles WHERE name = 'CASHIER'").get();
const mergePermission = db.prepare("SELECT id FROM permissions WHERE code = 'orders.merge'").get();
db.prepare('UPDATE role_permissions SET allowed = 0 WHERE role_id = ? AND permission_id = ?').run(cashierRole.id, mergePermission.id);
const reopenedDb = openDatabase('PERMISSIONTEST');
seedDefaultPermissions(reopenedDb);
assert(!hasPermission(reopenedDb, 'CASHIER', 'orders.merge'), 'permission seeding overwrote an Owner-customized role control');
reopenedDb.close();
db.close();

const html = fs.readFileSync(path.join(posRoot, 'backend/public/admin.html'), 'utf8');
const js = fs.readFileSync(path.join(posRoot, 'backend/public/js/admin-dashboard.js'), 'utf8');
const css = fs.readFileSync(path.join(posRoot, 'backend/public/css/style.css'), 'utf8');
const server = fs.readFileSync(path.join(posRoot, 'backend/server.js'), 'utf8');
[
  'permissionSearch', 'permissionModuleFilter', 'permissionRoleFilter',
  'permissionsValidation', 'permissionsMatrix', 'permissionsDirtyStatus'
].forEach((id) => assert(html.includes(`id="${id}"`), `missing permission UI control ${id}`));
assert(js.includes('data-module-toggle'), 'module role toggles are missing');
assert(js.includes('No controls found'), 'empty search result UX is missing');
assert(js.includes('Permissions were not saved:'), 'save error UI validation is missing');
assert(css.includes('@media (max-width:1100px)'), 'narrow-window layout protection is missing');
assert(css.includes('input:focus-visible + span'), 'keyboard focus styling is missing');
assert(server.includes('OWNER access is protected and cannot be changed'), 'OWNER API protection is missing');
assert(server.includes('Every permission value must be true or false'), 'permission payload validation is missing');
assert(server.includes('Unknown permission control:'), 'unknown permission validation is missing');
[
  'billing.discount', 'billing.void', 'customers.manage', 'customers.view', 'devices.manage',
  'invoices.view', 'kitchen.reprint', 'kitchen.status.update', 'orders.merge', 'orders.reopen',
  'orders.split', 'orders.unlock', 'printers.manage', 'reservations.manage', 'retail.sell',
  'retail.stock_adjust', 'retail.view', 'rewards.manage', 'tax.export'
].forEach((code) => assert(server.includes(`'${code}'`), `API enforcement is missing for ${code}`));
assert(!/app\.get\('\/orders\/(?:live|open-list)'[\s\S]{0,350}printers\.manage/.test(server), 'printer permission leaked into an order-list route');
assert(!/app\.post\('\/kds\/reprint-kot'[\s\S]{0,450}orders\.reopen/.test(server), 'order reopen permission leaked into KDS reprint');

const topNavPages = ['admin.html', 'billing.html', 'kds.html', 'orders.html', 'pos-live.html', 'customer.html'];
topNavPages.forEach((page) => {
  const source = fs.readFileSync(path.join(posRoot, 'backend/public', page), 'utf8');
  assert(source.includes('data-pos-shortcut="F7"'), `${page} is missing the F7 Reports navigation`);
  assert(source.includes('data-role-nav="reports"'), `${page} is missing the Reports role guard`);
});
assert(js.includes('"invoices", "reports"'), 'cashier direct Reports route is not allowed');
['dine-in', 'parcel', 'party', 'billing', 'invoices', 'kds', 'reports', 'availability', 'live-orders', 'admin', 'notifications'].forEach((control) => {
  assert(html.includes(`data-role-nav="${control}"`), `Admin top navigation is missing the ${control} role marker`);
});
['sales', 'orders', 'categories', 'items', 'employees', 'captains'].forEach((report) => {
  assert(html.includes(`data-report-tab="${report}"`), `standalone Reports is missing the ${report} submenu`);
});
assert(js.includes('const cashierNavigation = new Set'), 'Cashier top navigation allowlist is missing');
assert(js.includes('panel.id === `view-${cashierView}`'), 'Cashier standalone view guard does not preserve the requested screen');
['billing.js', 'pos-live.js', 'orders.js', 'kds.js', 'customer.js'].forEach((file) => {
  const source = fs.readFileSync(path.join(posRoot, 'backend/public/js', file), 'utf8');
  assert(source.includes('data-role-nav="reports"'), `${file} does not enforce Reports navigation visibility`);
  assert(source.includes("'CASHIER'") || source.includes('"CASHIER"'), `${file} does not include Cashier report navigation`);
});

console.log(`Permission matrix regression passed: ${stored.size} controls seeded, new capability coverage, Cashier/F7 Reports navigation, role visibility, safe defaults, owner protection, payload validation, filters, bulk toggles, save errors, keyboard focus and responsive layout.`);
