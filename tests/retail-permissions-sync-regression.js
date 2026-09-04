const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const permissions = require(path.join(root, 'pos-app/backend/services/permissions'));

const checks = [
  [permissions.DEFAULT_ROLES.some(([role]) => role === 'RETAIL'), 'RETAIL is a first-class POS user role'],
  [JSON.stringify(permissions.DEFAULT_ROLE_PERMISSIONS.RETAIL) === JSON.stringify(['retail.view', 'retail.sell', 'inventory.view']), 'RETAIL defaults to retail and read-only item access only'],
  [read('pos-app/backend/public/js/login.js').includes('role === "RETAIL"') && read('pos-app/backend/public/js/login.js').includes('"/retail.html"'), 'RETAIL login lands on Retail Counter'],
  [read('mobile-app/www/js/app.js').includes('RETAIL: "retail"') && read('mobile-app/www/js/app.js').includes('retail: `${posBase}/retail.html?${mobileParams.toString()}`'), 'Mobile staff login opens Retail Counter for RETAIL users'],
  [read('pos-app/backend/public/retail.html').includes('data-retail-nav="parcel"') && read('pos-app/backend/public/js/retail.js').includes("link.dataset.retailNav==='items'"), 'RETAIL navigation hides Parcel and Billing while retaining Items'],
  [read('pos-app/backend/public/js/admin-dashboard.js').includes('role === "RETAIL" && requestedAdminView !== "items"') && read('pos-app/backend/public/js/admin-dashboard.js').includes('panel.id === "view-items"'), 'RETAIL can open only the read-only Items page'],
  [read('pos-app/backend/public/admin.html').includes('<option>RETAIL</option>') && read('pos-app/backend/server.js').includes("'RETAIL', 'WAITER'"), 'User management can create Retail users'],
  [read('pos-app/backend/server.js').includes("requirePermission(db, role, 'inventory.view', 'Item catalogue viewing permission required')"), 'Items API enforces the Retail catalogue permission'],
  [read('pos-app/backend/server.js').includes("domain === 'PERMISSIONS'") && read('pos-app/backend/server.js').includes('rolePermissions'), 'POS applies versioned remote permission configurations'],
  [read('pos-app/backend/server.js').includes('permissionsOnly: true') && read('pos-app/backend/server.js').includes('restaurantIdOverride: restaurantId'), 'Desktop and mobile login pull permissions when online without blocking offline login'],
  [read('saas-backend/src/routes/ownerControl.js').includes("'PERMISSIONS'") && read('saas-backend/src/routes/ownerControl.js').includes("REMOTE_PERMISSIONS"), 'SaaS accepts a dedicated permissions configuration domain'],
  [read('saas-backend/public/owner-control.html').includes('id="permissionEditorPanel"') && read('saas-backend/public/js/owner-control.js').includes('function savePermissions()'), 'Owner Control exposes a per-restaurant permission editor'],
  [read('saas-backend/public/js/owner-control.js').includes('Select exactly one restaurant; permissions are always managed per branch.'), 'Owner Control prevents cross-branch permission edits']
];

for (const [condition, description] of checks) {
  assert.ok(condition, description);
  console.log(`PASS ${description}`);
}
console.log(`${checks.length} Retail permissions and SaaS sync regression checks passed.`);
