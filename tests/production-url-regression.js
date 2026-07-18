const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const productionFiles = [
  'pos-app/backend/public/js/admin-dashboard.js',
  'pos-app/backend/public/qr-menu.html',
  'pos-app/backend/public/js/qr-menu.js',
  'deploy/compose.yml',
  'deploy/.env.example',
  'saas-backend/public/qr-menu.html',
  'saas-backend/public/js/qr-public.js'
];

const forbidden = /(?:https?:\/\/)?(?:localhost|127\.0\.0\.1|0\.0\.0\.0)(?::\d+)?/i;
const failures = [];

for (const relative of productionFiles) {
  const file = path.join(root, relative);
  if (!fs.existsSync(file)) continue;
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  lines.forEach((line, index) => {
    if (relative === 'deploy/compose.yml' && line.includes('health')) return;
    if (forbidden.test(line)) failures.push(`${relative}:${index + 1}: ${line.trim()}`);
  });
}

const adminDashboard = fs.readFileSync(path.join(root, 'pos-app/backend/public/js/admin-dashboard.js'), 'utf8');
const adminHtml = fs.readFileSync(path.join(root, 'pos-app/backend/public/admin.html'), 'utf8');
const styleCss = fs.readFileSync(path.join(root, 'pos-app/backend/public/css/style.css'), 'utf8');
const caddy = fs.readFileSync(path.join(root, 'deploy/Caddyfile'), 'utf8');
const orderJs = fs.readFileSync(path.join(root, 'saas-backend/public/js/order.js'), 'utf8');
if (!adminDashboard.includes("fetchJson('/network/info')") || !adminDashboard.includes('state.network.publicQrBaseUrl')) {
  failures.push('QR links do not use the configured public QR address');
}
if (!adminDashboard.includes('https://pos.kmasterpos.com')) {
  failures.push('QR links do not have the production public hostname fallback');
}
if (!adminDashboard.includes("https://kmasterpos.com/order.html")) {
  failures.push('Online ordering link does not have the production public base URL');
}
if (adminDashboard.includes('onlineStorefrontLink.href = `/online-order.html')) {
  failures.push('Online ordering link still inherits the local POS origin');
}
if (!adminHtml.includes('class="qr-links-table"') || !styleCss.includes('.table-panel .qr-links-table td:first-child') || !styleCss.includes('table-layout: auto')) {
  failures.push('QR link table does not use content-aware column sizing');
}
if (!caddy.includes('pos.kmasterpos.com') || !fs.existsSync(path.join(root, 'saas-backend/public/qr-menu.html'))) {
  failures.push('Public POS/QR hostname is not hosted by the SaaS service');
}
if (!orderJs.includes('requestedRestaurant') || !orderJs.includes('restaurant_code')) {
  failures.push('Online order deep link does not select its requested restaurant');
}

if (failures.length) {
  console.error(JSON.stringify({ passed: false, failures }, null, 2));
  process.exit(1);
}

console.log(JSON.stringify({ passed: true, checked: productionFiles }));
