const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const checks = [
  ['KOT new-lines-only, item notes, native BILL/KOT printing, invoice compliance', 'tests/pos-regression.js'],
  ['Public URLs, QR column sizing, online-order routing', 'tests/production-url-regression.js'],
  ['SaaS mandatory profile and license-to-POS transfer', 'tests/saas-onboarding-profile-regression.js'],
  ['Billing settle/print controls', 'tests/billing-controls-regression.js'],
  ['Responsive owner mobile dashboard', 'tests/mobile-owner-dashboard-regression.js'],
  ['Print-only invoice item grouping', 'tests/print-item-grouping-regression.js']
];

for (const [scope, script] of checks) {
  const result = spawnSync(process.execPath, [script], { cwd: root, encoding: 'utf8' });
  if (result.status !== 0) {
    process.stderr.write(`Reported-issue regression failed: ${scope}\n${result.stdout}${result.stderr}`);
    process.exit(result.status || 1);
  }
  process.stdout.write(`PASS: ${scope}\n`);
}

const admin = read('pos-app/backend/public/js/admin-dashboard.js');
const adminHtml = read('pos-app/backend/public/admin.html');
const notifications = read('pos-app/backend/public/js/nav-notifications.js');
const online = read('saas-backend/public/js/order.js');
const qr = read('saas-backend/public/js/qr-public.js');
const requiredContracts = [
  [admin.includes('SETTINGS_KEYS_BY_SECTION') && adminHtml.includes('data-settings-section="profile"'), 'split admin settings navigation'],
  [admin.includes('fssai_license_no'), 'FSSAI settings persistence'],
  [notifications.includes('data-notification-count'), 'notification badge on every shared navigation'],
  [online.includes('requestedRestaurant'), 'online-order restaurant deep link'],
  [qr.includes("orderType: 'DINE_IN'") && qr.includes('tableId'), 'public table QR ordering'],
  [read('.github/workflows/windows-pos-release.yml').includes('reported-issues-regression.js'), 'CI reported-issue gate']
];
for (const [passed, label] of requiredContracts) if (!passed) throw new Error(`Missing regression contract: ${label}`);

console.log(`Reported issues regression gate passed (${checks.length + requiredContracts.length} scopes)`);
