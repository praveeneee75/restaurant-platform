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
assert(!hasPermission(db, 'WAITER', 'billing.refund'), 'waiter received privileged billing access');
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

console.log(`Permission matrix regression passed: ${stored.size} controls seeded, new capability coverage, safe defaults, owner protection, payload validation, filters, bulk toggles, save errors, keyboard focus and responsive layout.`);
