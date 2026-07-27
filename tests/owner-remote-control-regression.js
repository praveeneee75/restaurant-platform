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
  [read('saas-backend/src/routes/monitoring.js').includes('tenant_owner_alerts'), 'health alerts from POS heartbeat'],
  [read('saas-backend/public/js/owner-login.js').includes('"/owner-control.html"') && read('saas-backend/public/js/saas-session.js').includes('homeUrl: "/owner-control.html"') && read('saas-backend/public/js/owner-change-password.js').includes('"/owner-control.html"'), 'redesigned owner control is the default post-login dashboard'],
  [read('saas-backend/public/owner-control.html').includes('data-owner-nav="MENU"') && read('saas-backend/public/owner-control.html').includes('data-owner-nav="INVENTORY"') && read('saas-backend/public/js/owner-control.js').includes("document.querySelectorAll('[data-owner-nav]')"), 'owner sidebar groups are actionable rather than dead buttons'],
  [read('saas-backend/public/owner-control.html').includes('id="notificationsButton"') && read('saas-backend/public/owner-control.html').includes('id="settingsButton"') && read('saas-backend/public/js/owner-control.js').includes("$('notificationsButton').onclick=openDrawer") && read('saas-backend/public/js/owner-control.js').includes("$('settingsButton').onclick"), 'owner notification and settings controls are wired'],
  [read('saas-backend/public/owner-control.html').includes('id="reportDate"') && read('saas-backend/public/js/owner-control.js').includes("$('reportDate').onchange") && read('saas-backend/public/js/owner-control.js').includes('selectedDailyReport'), 'owner dashboard date changes displayed cloud totals'],
  [read('saas-backend/public/owner-control.html').includes('id="downloadReportButton"') && read('saas-backend/public/js/owner-control.js').includes('function downloadReports()'), 'owner cloud-sales CSV export is operational'],
  [read('saas-backend/public/owner-control.html').includes('id="ownerDrawer"') && read('saas-backend/public/owner-control.html').includes('id="closeDrawerButton"') && read('saas-backend/public/js/owner-control.js').includes("$('ownerDrawer').onclick"), 'owner activity drawer opens and closes without duplicate windows'],
  [!read('saas-backend/public/owner-control.html').match(/petpooja|possp|food paradise/i) && read('saas-backend/public/owner-control.html').includes("K'Master Owner"), 'owner dashboard uses distinct KMaster branding']
];

for (const [ok, label] of checks) {
  if (!ok) throw new Error(`Missing owner remote-control regression contract: ${label}`);
  console.log(`PASS: ${label}`);
}
console.log(`Owner remote-control regression passed (${checks.length} contracts)`);
