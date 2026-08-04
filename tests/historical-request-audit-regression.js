const fs = require('fs');
const path = require('path');
const assert = require('assert');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const css = read('pos-app/backend/public/css/style.css');
const pos = read('pos-app/backend/public/js/pos-live.js');
const billing = read('pos-app/backend/public/js/billing.js');
const adminHtml = read('pos-app/backend/public/admin.html');
const admin = read('pos-app/backend/public/js/admin-dashboard.js');
const server = read('pos-app/backend/server.js');
const thermal = read('pos-app/electron/thermalEscPos.js');
const mobileHtml = read('mobile-app/www/index.html');
const mobile = read('mobile-app/www/js/app.js');
const monitoring = read('saas-backend/src/routes/monitoring.js');

assert.match(pos, /directDineLayout[\s\S]*pos-mode-direct-dine[\s\S]*categorySlot\.replaceWith\(categoryPanel\)[\s\S]*tableSlot\.replaceWith\(tableList\)/, 'Direct Dine In must swap category and table panels only in its direct layout');
assert.match(css, /\.pos-non-dine-in \.payment-panel > #paymentMode[\s\S]*\.pos-non-dine-in \.customer-panel > #payableTotal \{ display:none!important; \}/, 'Parcel and Party must hide payment, rewards, discount and payable controls');
assert.match(server, /source: 'FINAL_BILL_PRINT'/, 'Final Bill & Print must submit pending KOT lines itself');
assert.match(server, /function promoteDraftOrderIdentity/, 'Draft order numbers must be promoted when KOT is submitted');
assert.match(billing, /grossLineAmount[\s\S]*tax_mode[\s\S]*EXCLUSIVE/, 'Billing item values must display tax-inclusive amounts for mixed tax modes');
assert.match(thermal, /itemIsExclusive[\s\S]*displayExclusive/, 'Physical bill item prices must respect per-item and per-flow tax modes');
assert.match(thermal, /show\('discount'\)[\s\S]*Discount/, 'Physical bills must print configured discounts');
assert.match(adminHtml, /settingBillTaxDisplayDineIn[\s\S]*settingBillTaxDisplayParcel[\s\S]*settingBillTaxDisplayParty/, 'Bill tax mode must be configurable independently for all POS flows');
assert.match(admin, /BILL_LINE_OPTIONS[\s\S]*\['discount','Discount'\]/, 'Discount must be a configurable bill line');
assert.match(adminHtml, /testKotLayoutPrint[\s\S]*saveKotLayoutPdf[\s\S]*testBillLayoutPrint[\s\S]*saveBillLayoutPdf/, 'Bill and KOT configuration need test print and PDF actions');
assert.match(adminHtml, /operationalReportPrintHeader/, 'Operational reports need a thermal print header');
assert.match(server, /invoiceOnly[\s\S]*COALESCE\(o\.is_invoice,0\)=1/, 'Operational reports must hide non-invoiced orders for restricted roles');
assert.match(server, /orderInvoiceClause[\s\S]*aliasedInvoiceClause/, 'Dashboard summaries must apply the same invoice-only restriction');
assert.doesNotMatch(adminHtml, /class="report-type-tabs"/, 'Duplicate report tabs must not be rendered');
assert.match(mobileHtml, /restaurantSelect" hidden/, 'Mobile restaurant dropdown must be hidden');
assert.match(mobile, /findLocalStaffLogin[\s\S]*\/mobile-app\/login/, 'Mobile staff login must discover the local POS');
assert.match(mobile, /KITCHEN" \? "kitchen" : "pos"/, 'Kitchen must route to KDS and other staff to POS');
assert.match(server, /lastMobileLoginDiagnostic[\s\S]*sameWifi/, 'POS must capture mobile Wi-Fi diagnostics');
assert.match(monitoring, /mobile_login/, 'SaaS monitoring must expose mobile diagnostics');

console.log('Historical request audit regression passed.');
