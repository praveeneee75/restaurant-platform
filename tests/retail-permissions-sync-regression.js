const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const permissions = require(path.join(root, 'pos-app/backend/services/permissions'));

const checks = [
  [permissions.DEFAULT_ROLES.some(([role]) => role === 'RETAIL'), 'RETAIL is a first-class POS user role'],
  [JSON.stringify(permissions.DEFAULT_ROLE_PERMISSIONS.RETAIL) === JSON.stringify(['retail.view', 'retail.sell', 'retail.stock_adjust', 'inventory.view', 'inventory.manage']), 'RETAIL defaults to a restricted counter and inventory-management workspace'],
  [read('pos-app/backend/public/js/login.js').includes('role === "RETAIL"') && read('pos-app/backend/public/js/login.js').includes('"/retail.html"'), 'RETAIL login lands on Retail Counter'],
  [read('mobile-app/www/js/app.js').includes('RETAIL: "retail"') && read('mobile-app/www/js/app.js').includes('retail: `${posBase}/retail.html?${mobileParams.toString()}`'), 'Mobile staff login opens Retail Counter for RETAIL users'],
  [read('pos-app/backend/public/retail.html').includes('data-role-nav="retail-items"') && read('pos-app/backend/public/retail.html').includes('view=inventory') && read('pos-app/backend/public/js/retail.js').includes("['retail','retail-items']") && read('pos-app/backend/public/js/retail.js').includes("link.hidden=!allowed"), 'RETAIL navigation hides Parcel and Billing while retaining Inventory'],
  [read('pos-app/backend/public/js/admin-dashboard.js').includes('role === "RETAIL" && !["inventory", "items"].includes(requestedAdminView)') && read('pos-app/backend/public/js/admin-dashboard.js').includes('panel.id === `view-${retailView}`'), 'RETAIL can open only the retail inventory workspace'],
  [read('pos-app/backend/public/admin.html').includes('<option>RETAIL</option>') && read('pos-app/backend/server.js').includes("'RETAIL', 'WAITER'"), 'User management can create Retail users'],
  [read('pos-app/backend/server.js').includes("requirePermission(db, role, 'inventory.view', 'Item catalogue viewing permission required')"), 'Items API enforces the Retail catalogue permission'],
  [read('pos-app/backend/server.js').includes("domain === 'PERMISSIONS'") && read('pos-app/backend/server.js').includes('rolePermissions'), 'POS applies versioned remote permission configurations'],
  [read('pos-app/backend/server.js').includes('permissionsOnly: true') && read('pos-app/backend/server.js').includes('restaurantIdOverride: restaurantId'), 'Desktop and mobile login pull permissions when online without blocking offline login'],
  [read('saas-backend/src/routes/ownerControl.js').includes("'PERMISSIONS'") && read('saas-backend/src/routes/ownerControl.js').includes("REMOTE_PERMISSIONS"), 'SaaS accepts a dedicated permissions configuration domain'],
  [read('saas-backend/public/owner-control.html').includes('id="permissionEditorPanel"') && read('saas-backend/public/js/owner-control.js').includes('function savePermissions()'), 'Owner Control exposes a per-restaurant permission editor'],
  [read('saas-backend/public/js/owner-control.js').includes('Select exactly one restaurant; permissions are always managed per branch.'), 'Owner Control prevents cross-branch permission edits']
  ,[read('saas-backend/src/db/migrate.js').includes("('RETAIL_COUNTER', 'Retail Counter', 365, 9999)") && read('saas-backend/src/db/migrate.js').includes("('RETAIL_COUNTER', 'INVENTORY')") && read('saas-backend/src/db/migrate.js').includes("('RETAIL_COUNTER', 'RETAIL_COUNTER')"), 'SaaS provides a separately priced Retail Counter licence with inventory entitlement']
  ,[read('pos-app/backend/server.js').includes('function requireRetailCounter(db)') && read('pos-app/backend/server.js').includes("retailCounterLicensed(db) && getBooleanConfig"), 'POS requires the Retail Counter entitlement before exposing or serving the counter']
  ,[read('saas-backend/public/website.html').includes('Retail Counter') && read('saas-backend/public/website.html').includes('₹9,999'), 'Public KMaster site presents the standalone Retail Counter offering and price']
];

for (const [condition, description] of checks) {
  assert.ok(condition, description);
  console.log(`PASS ${description}`);
}
console.log(`${checks.length} Retail permissions and SaaS sync regression checks passed.`);
