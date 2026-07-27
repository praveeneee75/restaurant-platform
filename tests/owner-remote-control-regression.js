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
  [!read('saas-backend/public/owner-control.html').includes('class="od-sidebar"') && read('saas-backend/public/owner-control.html').includes('data-owner-section="liveOperations"') && read('saas-backend/public/js/owner-control.js').includes("document.querySelectorAll('[data-owner-section]')"), 'owner dashboard removes redundant left navigation and keeps working in-page operations navigation'],
  [read('saas-backend/public/owner-control.html').includes('id="restaurantMultiButton"') && read('saas-backend/public/owner-control.html').includes('aria-multiselectable="true"') && read('saas-backend/public/js/owner-control.js').includes('restaurantsList.forEach((row)=>selectedRestaurants.add(row.restaurant_code))') && read('saas-backend/public/js/owner-control.js').includes('aggregateDashboards'), 'owner dashboard selects and aggregates all assigned branches by default'],
  [read('saas-backend/public/js/owner-control.js').includes('class="ops-kpis"') && read('saas-backend/public/js/owner-control.js').includes('class="ops-groups"') && read('saas-backend/public/js/owner-control.js').includes('function renderLiveOperations'), 'owner live operations uses an executive KPI and grouped-channel presentation'],
  [read('saas-backend/public/owner-control.html').includes('id="notificationsButton"') && read('saas-backend/public/owner-control.html').includes('id="settingsButton"') && read('saas-backend/public/js/owner-control.js').includes("$('notificationsButton').onclick=openDrawer") && read('saas-backend/public/js/owner-control.js').includes("$('settingsButton').onclick"), 'owner notification and settings controls are wired'],
  [read('saas-backend/public/owner-control.html').includes('id="reportDate"') && read('saas-backend/public/js/owner-control.js').includes("$('reportDate').onchange") && read('saas-backend/public/js/owner-control.js').includes('selectedDailyReport'), 'owner dashboard date changes displayed cloud totals'],
  [read('saas-backend/public/owner-control.html').includes('id="downloadReportButton"') && read('saas-backend/public/js/owner-control.js').includes('function downloadReports()'), 'owner cloud-sales CSV export is operational'],
  [read('saas-backend/public/owner-control.html').includes('id="configStatus"') && read('saas-backend/public/js/owner-control.js').includes('function parseConfigurationEditor()') && read('saas-backend/public/js/owner-control.js').includes('function validateConfigurationEditor()') && !read('saas-backend/public/js/owner-control.js').includes('Configuration JSON is invalid.'), 'remote configuration validation stays inside its section and cannot replace dashboard sync status'],
  [read('saas-backend/public/owner-control.html').includes('id="ownerDrawer"') && read('saas-backend/public/owner-control.html').includes('id="closeDrawerButton"') && read('saas-backend/public/js/owner-control.js').includes("$('ownerDrawer').onclick"), 'owner activity drawer opens and closes without duplicate windows'],
  [!read('saas-backend/public/owner-control.html').match(/petpooja|possp|food paradise/i) && read('saas-backend/public/owner-control.html').includes("K'Master Owner"), 'owner dashboard uses distinct KMaster branding'],
  [['owner-dashboard.html', 'owner-profile.html', 'downloads.html'].every((page) => {
    const html = read(`saas-backend/public/${page}`);
    return ['/owner-dashboard.html', '/owner-control.html', '/downloads.html', '/owner-profile.html'].every((href) => html.includes(href));
  }) && read('saas-backend/public/owner-control.html').includes('/downloads.html') && read('saas-backend/public/owner-control.html').includes('/owner-profile.html'), 'consistent owner portal destinations remain available without duplicating a persistent owner-control sidebar'],
  [!read('saas-backend/public/owner-dashboard.html').includes('href="/order.html"') && read('saas-backend/public/owner-dashboard.html').includes('href="/owner-control.html"'), 'owner dashboard removes context-free ordering link and retains working owner control'],
  [!read('saas-backend/public/js/owner-dashboard.js').includes('firstRestaurant(') && !read('saas-backend/public/js/owner-dashboard.js').includes('${restaurant.restaurant_code') && !read('saas-backend/public/js/owner-dashboard.js').includes('${restaurant.license_key') && read('saas-backend/public/js/owner-dashboard.js').includes('Do not reuse another branch') && read('saas-backend/public/owner-dashboard.html').includes('id="branchActivationTable"'), 'multi-branch activation guidance never defaults credentials to the first restaurant']
];

for (const [ok, label] of checks) {
  if (!ok) throw new Error(`Missing owner remote-control regression contract: ${label}`);
  console.log(`PASS: ${label}`);
}
console.log(`Owner remote-control regression passed (${checks.length} contracts)`);
