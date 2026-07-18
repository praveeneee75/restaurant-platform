const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'mobile-app/www/index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'mobile-app/www/css/app.css'), 'utf8');
const js = fs.readFileSync(path.join(root, 'mobile-app/www/js/app.js'), 'utf8');

const requiredIds = [
  'ownerBusinessDate', 'ownerTotalSales', 'ownerNetSales', 'ownerAverageOrder', 'ownerTaxCollected',
  'ownerSalesChart', 'ownerPaymentSummary', 'ownerTopItems', 'ownerRunningOrders', 'ownerPendingOrders',
  'ownerOrderOperations', 'ownerLeakage', 'ownerExpenses', 'ownerBottomNav', 'ownerDrawer'
];
for (const id of requiredIds) {
  if (id === 'ownerBottomNav') {
    if (!html.includes('class="owner-bottom-nav"')) throw new Error('Owner bottom navigation is missing');
  } else if (!html.includes(`id="${id}"`)) throw new Error(`Owner dashboard is missing ${id}`);
}

for (const endpoint of ['/reports/dashboard', '/reports/advanced', '/orders/live', '/qr/orders/pending']) {
  if (!js.includes(endpoint)) throw new Error(`Owner dashboard does not load ${endpoint}`);
}

for (const behavior of ['refreshOwnerDashboard', 'renderOwnerDashboard', 'showOwnerTab', 'dashboard.topSellingItems']) {
  if (!js.includes(behavior)) throw new Error(`Owner dashboard behavior is missing ${behavior}`);
}

for (const responsiveRule of ['.metric-grid', '.owner-bottom-nav', '.owner-drawer', '.bar-chart']) {
  if (!css.includes(responsiveRule)) throw new Error(`Owner dashboard styling is missing ${responsiveRule}`);
}

if (/PETPOOJA|POSS/i.test(html + css + js)) throw new Error('Reference-app branding was copied into KMaster mobile');

console.log(JSON.stringify({ passed: true, ownerDashboard: true, apiEndpoints: 4, referenceBrandingCopied: false }));
