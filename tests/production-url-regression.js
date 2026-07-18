const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const productionFiles = [
  'pos-app/backend/public/js/admin-dashboard.js',
  'pos-app/backend/public/qr-menu.html',
  'pos-app/backend/public/js/qr-menu.js',
  'deploy/compose.yml',
  'deploy/.env.example'
];

const forbidden = /(?:https?:\/\/)?(?:localhost|127\.0\.0\.1|0\.0\.0\.0)(?::\d+)?/i;
const failures = [];

for (const relative of productionFiles) {
  const file = path.join(root, relative);
  if (!fs.existsSync(file)) continue;
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  lines.forEach((line, index) => {
    // Localhost is permitted only in the explicit local-host detection branch;
    // it must never be the generated QR URL or a production endpoint.
    if (relative.endsWith('admin-dashboard.js') && line.includes('localHost')) return;
    if (relative === 'deploy/compose.yml' && line.includes('health')) return;
    if (forbidden.test(line)) failures.push(`${relative}:${index + 1}: ${line.trim()}`);
  });
}

const adminDashboard = fs.readFileSync(path.join(root, 'pos-app/backend/public/js/admin-dashboard.js'), 'utf8');
if (!adminDashboard.includes("'https://pos.kmasterpos.com'")) {
  failures.push('QR links do not have the production public base URL');
}
if (adminDashboard.includes('`${location.origin}/qr-menu.html')) {
  failures.push('QR links still use location.origin directly');
}
if (!adminDashboard.includes('https://pos.kmasterpos.com')) {
  failures.push('QR links do not use the public POS QR host');
}
if (adminDashboard.includes('http://localhost') && adminDashboard.includes('qr-menu.html')) {
  failures.push('QR links contain a localhost URL');
}
if (!adminDashboard.includes("https://kmasterpos.com/order.html")) {
  failures.push('Online ordering link does not have the production public base URL');
}
if (adminDashboard.includes('onlineStorefrontLink.href = `/online-order.html')) {
  failures.push('Online ordering link still inherits the local POS origin');
}

if (failures.length) {
  console.error(JSON.stringify({ passed: false, failures }, null, 2));
  process.exit(1);
}

console.log(JSON.stringify({ passed: true, checked: productionFiles }));
