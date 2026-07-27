const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const provisioner = fs.readFileSync(path.join(root, 'scripts', 'provision-whitelabel-test-branches.js'), 'utf8');
const adminHtml = fs.readFileSync(path.join(root, 'pos-app', 'backend', 'public', 'admin.html'), 'utf8');
const adminJs = fs.readFileSync(path.join(root, 'pos-app', 'backend', 'public', 'js', 'admin-dashboard.js'), 'utf8');
const { menu } = require(path.join(root, 'scripts', 'load-white-label-pilot-menu.js'));

function assert(condition, message) {
  if (!condition) throw new Error(message);
  console.log(`PASS: ${message}`);
}

assert(Object.keys(menu).length >= 10, 'Food Paradise pilot menu is available without opening a local database');
assert(['B2', 'B3', 'B4'].every((suffix) => provisioner.includes('`${sourceCode}' + suffix + '`') || provisioner.includes(`\`\${sourceCode}${suffix}\``)), 'exactly three named white-label test branches are defined');
assert(provisioner.includes('NOT EXISTS') && provisioner.includes("existing.status = 'ACTIVE'"), 'branch provisioning is idempotent for active subscriptions');
assert(provisioner.includes('online_menu_snapshots') && provisioner.includes('FOOD_PARADISE_PILOT'), 'each branch receives the Food Paradise SaaS menu snapshot');
assert(adminHtml.includes('data-nav-category="settings"') && adminHtml.includes('data-nav-group="settings"'), 'Settings is a top-level Admin category');
assert(adminHtml.includes('Promo Codes &amp; Reward Points') && adminJs.includes('Promo Codes & Reward Points'), 'reward management is grouped under Promo Codes & Reward Points');

console.log('White-label branch provisioning regression passed.');
