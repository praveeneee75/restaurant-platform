const fs = require('fs');

const billing = fs.readFileSync('pos-app/backend/public/js/billing.js', 'utf8');
const css = fs.readFileSync('pos-app/backend/public/css/style.css', 'utf8');
const admin = fs.readFileSync('pos-app/backend/public/js/admin-dashboard.js', 'utf8');
const server = fs.readFileSync('pos-app/backend/server.js', 'utf8');

const required = [
  ['billingPromoCode', 'Promocode'],
  ['billingCashDiscount', 'Cash discount amount'],
  ['billingRedeemPoints', 'Reward points to redeem']
];

for (const [id, label] of required) {
  if (!billing.includes(`id="${id}"`)) throw new Error(`Missing billing input: ${id}`);
  if (!billing.includes(label)) throw new Error(`Missing visible label: ${label}`);
  if (billing.includes(`id="${id}" disabled`) || billing.includes(`id="${id}" readonly`)) {
    throw new Error(`Billing input must remain editable: ${id}`);
  }
}

for (const action of ['applyBillingPromo', 'applyBillingCashDiscount', 'applyBillingRedeemPoints']) {
  if (!billing.includes(`id="${action}"`)) throw new Error(`Missing billing action: ${action}`);
}

if (!css.includes('.billing-adjustment-row')) throw new Error('Billing adjustment layout styles are missing');
if (!css.includes('.billing-adjustment-grid label')) throw new Error('Billing adjustment labels are missing');
if (!billing.includes('kotGroups') || !billing.includes('KOT ${esc(reference)}')) throw new Error('Billing items must be grouped under visible KOT references');
if (!billing.includes('item.kot_sequence || item.kot_id')) throw new Error('Billing KOT grouping needs a stable sequence fallback');
if (!css.includes('.bill-kot-group')) throw new Error('Billing KOT group styles are missing');
if (!billing.includes('Subtotal (including tax)') || !billing.includes('Discount applied') || !billing.includes('billing-total-breakdown')) throw new Error('Billing must show subtotal, applied discount and payable total');
if (!billing.includes('await showSubmittedOrder(d.order.id);')) throw new Error('Billing totals must refresh immediately after a discount is applied');
if (!server.includes("const discounts = tableExists(db, 'discounts') ? db.prepare(`")) throw new Error('Invoice detail API must return persisted discounts');
if (!admin.includes('invoiceGrossTotal') || !admin.includes('<span>Subtotal</span>') || !admin.includes('<span>Total paid</span>')) throw new Error('Invoice detail must show subtotal, discount and total paid');

console.log('Billing controls regression passed: adjustments are actionable and discount breakdowns remain visible in Billing and invoices.');
