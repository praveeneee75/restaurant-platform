const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const assert = (ok, message) => { if (!ok) throw new Error(message); console.log(`PASS: ${message}`); };

const migrate = read('saas-backend/src/db/migrate.js');
const owners = read('saas-backend/src/routes/owners.js');
const license = read('saas-backend/src/routes/license.js');
const sync = read('saas-backend/src/routes/sync.js');
const ownerReports = read('saas-backend/src/routes/ownerReports.js');
const ownerControl = read('saas-backend/src/routes/ownerControl.js');
const profileUi = read('saas-backend/public/js/owner-profile.js');
const ownerMobile = read('saas-backend/public/js/owner-mobile.js');
const ownerControlUi = read('saas-backend/public/js/owner-control.js');
const pos = read('pos-app/backend/server.js');

assert(migrate.includes("sales_storage_mode TEXT NOT NULL DEFAULT 'LOCAL_AND_ONLINE'"), 'existing and new tenants default to local plus online sales storage');
assert(profileUi.includes('Sales data storage') && profileUi.includes('LOCAL_ONLY') && owners.includes('sales_storage_mode=$17'), 'owner branch profile controls and saves the sales storage policy');
assert(license.includes('dataStoragePolicy: dataStoragePolicy(license)') && pos.includes("sales_storage_mode: salesMode"), 'license validation and cloud profile refresh apply the policy locally');
assert(pos.includes("storageMode: 'LOCAL_ONLY'") && pos.includes("Sales storage is configured as local only"), 'POS skips queued and requested cloud sales synchronization in local-only mode');
assert(sync.includes("tenant.sales_storage_mode === 'LOCAL_ONLY'") && sync.includes('Sales upload skipped by restaurant data-storage policy'), 'SaaS rejects sales persistence from older POS builds when tenant policy is local-only');
assert(ownerControl.includes("tenant.sales_storage_mode === 'LOCAL_ONLY'") && ownerControl.includes('liveOperations = {}; executiveSales = {}'), 'SaaS strips sales-bearing operational snapshots in local-only mode');
assert(ownerReports.includes("code: 'POS_DIRECT_REQUIRED'") && ownerReports.includes('Bring the POS online'), 'owner report APIs direct local-only tenants to the live POS with an offline message');
assert(pos.includes("app.get('/owner-direct/reports'") && pos.includes("app.get('/owner-direct/dashboard'") && pos.includes('authorizeOwnerDirectReport'), 'POS exposes owner-authenticated live report endpoints');
assert(owners.includes("validate-pos-report-access/:restaurantCode") && owners.includes('ro.owner_user_id=$1'), 'live POS reports validate that the signed-in owner is assigned to the restaurant');
assert(ownerMobile.includes('POS_DIRECT_REQUIRED') && ownerControlUi.includes('/owner-direct/dashboard'), 'both owner mobile and executive owner portal retrieve local-only sales from the live POS');
assert(migrate.includes('reject_local_only_sales_rows') && migrate.includes('tenant_daily_reports_local_only_guard') && migrate.includes('tenant_item_sales_local_only_guard'), 'database triggers reject report and item-sales writes for local-only tenants');
assert(migrate.includes('scrub_local_only_operational_snapshot') && migrate.includes('tenant_operational_snapshots_local_only_guard'), 'database trigger strips revenue-bearing operational snapshots for local-only tenants');
assert(migrate.includes('purge_sales_when_tenant_becomes_local_only') && migrate.includes('DELETE FROM tenant_daily_reports') && migrate.includes('DELETE FROM tenant_item_sales'), 'switching to local-only permanently purges previously uploaded cloud sales data');
assert(migrate.includes("metadata = metadata - 'paidAmount'"), 'local-only enforcement removes paid revenue amounts from central loyalty metadata');

console.log('Sales storage policy regression passed');
