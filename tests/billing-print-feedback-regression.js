const fs = require('fs');
const path = require('path');
const assert = require('assert');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const css = read('pos-app/backend/public/css/style.css');
const adminHtml = read('pos-app/backend/public/admin.html');
const adminJs = read('pos-app/backend/public/js/admin-dashboard.js');
const server = read('pos-app/backend/server.js');
const thermal = read('pos-app/electron/thermalEscPos.js');

assert.match(css, /grid-template-columns:\s*500px minmax\(0, 1fr\) 500px/, 'Billing left and right panels must have equal desktop widths');
assert.match(css, /\.billing-discount-pair\s*\{[^}]*grid-template-columns:1fr/s, 'Cash and percentage discounts must use separate rows');
assert.match(css, /\.recent-order\s*\{[^}]*font-size:\s*14px/s, 'Billing recent-order cards need readable left-panel typography');
assert.match(css, /\.billing-recent h3\s*\{\s*font-size:\s*16px/, 'Billing recent-order heading needs readable typography');
assert.match(adminJs, /invoice-number-format-options/, 'Invoice number radio controls need a dedicated layout wrapper');
assert.match(adminHtml, /id="testKotLayoutPrint"[\s\S]*id="saveKotLayoutPdf"/, 'KOT configuration needs print and PDF actions');
assert.match(adminHtml, /id="testBillLayoutPrint"[\s\S]*id="saveBillLayoutPdf"/, 'Bill configuration needs print and PDF actions');
assert.match(adminJs, /Expired<\/span>/, 'Expired promocodes must be labelled Expired');
assert.match(server, /AS effective_status/, 'Promocode API must expose effective date status');
assert.match(server, /function promoteDraftOrderIdentity/, 'Draft order promotion must be shared');
assert.match(server, /promoteDraftOrderIdentity\(db, actor, orderId\);[\s\S]*createKotJobs\(db, orderId\)/, 'Final Bill must promote a draft before creating its KOT');
assert.doesNotMatch(thermal, /detailsLayout[^\n]+currentLineWidth\s*>=\s*40/, '58mm two-column bill details must not silently fall back to stacked');

console.log('Billing and print feedback regression checks passed.');
