const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const schema = read('pos-app/backend/services/schema.js');
const html = read('pos-app/backend/public/admin.html');
const admin = read('pos-app/backend/public/js/admin-dashboard.js');
const server = read('pos-app/backend/server.js');
const thermal = read('pos-app/electron/thermalEscPos.js');
const keys = ['restaurant_header','address','contact','gstin','fssai','document_title','invoice_number','datetime','order_table','kot_references','customer','payment','tax_details','items','service_charge','discount','tax_breakup','grand_total','footer','signatory'];
for (const key of keys) {
  if (!schema.includes(`bill_line_${key}: '1'`) || !admin.includes(`['${key}'`)) throw new Error(`Missing bill-line option ${key}`);
}
if (!html.includes('id="billLineVisibilityRows"')) throw new Error('Bill line visibility matrix is missing');
if (!admin.includes('settingBillInvoiceNumberFull') || !admin.includes('settingBillInvoiceNumberLast4')) throw new Error('Invoice number format radios are missing');
if (!server.includes("bill_invoice_number_format', 'FULL'") || !thermal.includes("profile.invoiceNumberFormat === 'LAST4'")) throw new Error('Invoice number format is not applied to RAW printing');
if (!thermal.includes("const show = (key) => profile.lineVisibility?.[key] !== false")) throw new Error('RAW printing does not apply per-line visibility');
console.log('Bill line visibility regression passed.');
