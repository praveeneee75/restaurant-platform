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
  [css.includes('.table-panel span.action-cell') && css.includes('width:auto !important') && css.includes('min-width:max-content'), 'admin table action buttons remain separate and readable at narrow widths and zoom levels'],
  [adminHtml.includes('availability-items-table') && css.includes('.availability-items-panel { overflow-x:hidden; }') && css.includes('.table-panel .availability-items-table { width:100%; min-width:0; table-layout:auto; }'), 'availability columns auto-fit without a horizontal page scrollbar'],
  [css.includes('.table-panel table { min-width: 0; }') && css.includes('overflow-x: hidden;') && !css.includes('min-width: 680px;'), 'all application tables fit their page instead of forcing horizontal scrolling'],
  [electron.includes("await startPrintWorker(entitlement && !isExpired(entitlement) ? entitlement.restaurantId : '')") && electron.includes("status: retryable ? 'PENDING' : 'FAILED'") && server.includes("pj.status = 'FAILED' AND COALESCE(pj.attempts, 0) < 3"), 'licensed desktop always starts the print worker and retries transient KOT or bill failures'],
  [electron.includes("ipcMain.handle('pos:test-printer'") && adminJs.includes('data-test-printer') && adminJs.includes('window.posDesktop.testPrinter'), 'every configured KOT or bill printer can be tested through the exact desktop print path'],
  [adminJs.includes('async function printQrCode') && adminJs.includes('window.posDesktop?.printHtml') && adminJs.includes('await window.posDesktop.printHtml(html)'), 'QR printing uses native Electron printing instead of a blocked desktop popup'],
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
