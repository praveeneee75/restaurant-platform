const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const server = read('pos-app/backend/server.js');
const schema = read('pos-app/backend/services/schema.js');
const posCss = read('pos-app/backend/public/css/style.css');
const billing = read('pos-app/backend/public/js/billing.js');
const adminHtml = read('pos-app/backend/public/admin.html');
const adminJs = read('pos-app/backend/public/js/admin-dashboard.js');

if (!server.includes("source: 'FINAL_BILL_PRINT'") || !server.includes('submittedKotReference')) throw new Error('Final Bill & Print must submit pending KOT lines');
if (!posCss.includes('.pos-non-dine-in .customer-panel > label:has(#redeemPoints)') || !posCss.includes('.pos-non-dine-in #paymentAmount')) throw new Error('Parcel/Party billing controls are still visible');
if (!posCss.includes('minmax(300px,20%) minmax(620px,50%) minmax(440px,30%)')) throw new Error('Billing desktop layout is not the approved 20/50/30 table-first view');
if (!posCss.includes('@media (min-width:651px) and (max-width:1000px)') || !posCss.includes('.billing-detail{grid-column:1/-1')) throw new Error('Billing zoom/narrow-screen reflow protection is missing');
if (!billing.includes('billingPercentageDiscount') || !billing.includes("valueType: 'PERCENT'")) throw new Error('Percentage discount is missing');
if (!billing.includes('billing-discount-pair')) throw new Error('Cash and percentage discounts are not paired');
const printAt = billing.indexOf('id="settlePrintBilling"');
const invoiceAt = billing.indexOf('id="settleBilling"', printAt);
const settleAt = billing.indexOf('id="settleWithoutInvoice"', invoiceAt);
if (!(printAt >= 0 && printAt < invoiceAt && invoiceAt < settleAt)) throw new Error('Billing settlement buttons are in the wrong order');
for (const key of ['billing_show_promocode','billing_show_reward_points','billing_show_cash_discount','billing_show_percentage_discount','billing_show_settle_print','billing_show_settle_invoice','billing_show_settle_only']) {
  if (!schema.includes(`${key}: '1'`) || !adminJs.includes(key)) throw new Error(`Missing persisted Billing setting ${key}`);
}
for (const id of ['settingBillingShowPromocode','settingBillingShowRewardPoints','settingBillingShowCashDiscount','settingBillingShowPercentageDiscount','settingBillingShowSettlePrint','settingBillingShowSettleInvoice','settingBillingShowSettleOnly']) {
  if (!adminHtml.includes(`id="${id}"`)) throw new Error(`Missing Admin control ${id}`);
}
console.log('Billing workflow/configuration regression passed.');
