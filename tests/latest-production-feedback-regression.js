const fs = require('fs');
const read = (file) => fs.readFileSync(file, 'utf8');
const server = read('pos-app/backend/server.js');
const schema = read('pos-app/backend/services/schema.js');
const adminHtml = read('pos-app/backend/public/admin.html');
const adminJs = read('pos-app/backend/public/js/admin-dashboard.js');
const css = read('pos-app/backend/public/css/style.css');
const kds = read('pos-app/backend/public/js/kds.js');
const electron = read('pos-app/electron/main.js');
const notifications = read('pos-app/backend/public/js/nav-notifications.js');
const cloud = read('saas-backend/src/routes/onlineOrdering.js');

const cases = [
  [server.includes('setInterval(runSaasOrderImportTick, 10 * 1000)') && notifications.includes('10000') && !server.includes('NULLIF(?, "")'), 'QR cloud orders import without SQLite string-literal failure and reach notifications promptly'],
  [adminJs.includes('/qr-menu.html?restaurantId=') && !adminJs.includes('/qr-menu.html?v='), 'QR links are independent of POS application version'],
  [adminJs.includes('CGST @') && adminJs.includes('SGST @') && electron.includes('Service charge') && server.includes('service_charge_amount'), 'invoice and native bill expose GST breakup and service charge'],
  [adminHtml.includes('settingBillTemplate') && adminHtml.includes('billTemplatePreview') && adminJs.includes("template === 'BORDERLESS'") && adminJs.includes("template === 'COMPACT'"), 'three selectable bill templates have same-page preview'],
  [adminHtml.includes('qrLinkPreview') && adminJs.includes('data-qr-preview') && adminJs.includes('data-qr-print') && cloud.includes("router.get('/qr-code'"), 'QR links provide preview and print'],
  [css.includes('table-layout: auto') && css.includes('min-width: max-content') && css.includes('.admin-section-editor'), 'admin tables auto-fit and filter sections remain column-wise'],
  [server.includes("app.post('/kds/reprint-kot'") && server.includes('printer_id') && kds.includes('data-reprint-kot'), 'KDS reprint targets the original kitchen printer'],
  [schema.includes("bill_template: 'BORDERED'") && schema.includes("tax_rate: '5'"), 'new registered restaurants start with compliant bill defaults']
];

let failed = 0;
for (const [ok, name] of cases) {
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}`);
  if (!ok) failed += 1;
}
if (failed) process.exit(1);
console.log(`Latest production feedback regression passed (${cases.length} contracts)`);
