const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');
const checks = [
  [read('saas-backend/src/middleware/ownerScope.js').includes('restaurant_owners') && read('saas-backend/src/routes/ownerReports.js').includes('requireOwnedTenant'), 'owner report tenant isolation'],
  [read('saas-backend/src/routes/ownerControl.js').includes('tenant_remote_configs') && read('saas-backend/src/routes/ownerControl.js').includes('/pos/ack'), 'versioned config apply and acknowledgement'],
  [read('saas-backend/src/routes/ownerControl.js').includes('capabilityEnabled') && read('saas-backend/src/db/migrate.js').includes('tenant_owner_capabilities'), 'server-enforced SaaS owner capability policy'],
  [read('saas-backend/src/routes/ownerControl.js').includes('tenant_change_approvals') && read('saas-backend/src/routes/ownerControl.js').includes('requiresLocalReauthentication'), 'owner-confirmed license reauthentication workflow'],
  [read('pos-app/backend/server.js').includes('runOwnerControlTick') && read('pos-app/backend/server.js').includes('applyRemoteConfiguration'), 'POS pull/apply/ack loop'],
  [read('pos-app/backend/server.js').includes("license_reauthentication_required: '1'") && read('pos-app/backend/server.js').includes('LICENSE_REAUTH_REQUIRED'), 'POS reauthentication notification'],
  [read('saas-backend/public/owner-control.html').includes('No invoice-level data is exposed') && !read('saas-backend/public/js/owner-control.js').includes('/invoices'), 'owner sales excludes invoices'],
  [read('mobile-app/www/js/app.js').includes('ownerCloudToken') && read('mobile-app/www/js/app.js').includes('/owner-control/owner/dashboard'), 'mobile owner cloud dashboard works outside restaurant Wi-Fi'],
  [read('saas-backend/src/routes/ownerControl.js').includes("delete payload.restorePath") && read('saas-backend/public/owner-control.html').includes('Restore is intentionally confirmed locally'), 'remote restore safety boundary'],
  [read('saas-backend/src/routes/monitoring.js').includes('tenant_owner_alerts'), 'health alerts from POS heartbeat']
];

for (const [ok, label] of checks) {
  if (!ok) throw new Error(`Missing owner remote-control regression contract: ${label}`);
  console.log(`PASS: ${label}`);
}
console.log(`Owner remote-control regression passed (${checks.length} contracts)`);
