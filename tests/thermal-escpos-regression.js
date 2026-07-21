const assert = require('assert');
const { buildThermalEscPos, columns, wrap } = require('../pos-app/electron/thermalEscPos');
const { groupPrintableItems } = require('../pos-app/backend/services/printItemGrouping');

assert.deepStrictEqual(wrap('Butter Naan', 8), ['Butter', 'Naan']);
assert.deepStrictEqual(columns(['Item', '2'], [6, 3], ['left', 'right']), ['Item    2']);

const kot = buildThermalEscPos({
  type: 'KOT', ref_id: '14-A14-1', paper_width_mm: 58, created_at: '2026-07-21T09:05:47Z',
  payload: { headerText: 'KMaster Demo Kitchen', kotReference: '14-A14-1', orderType: 'DINE_IN', tableName: 'Table 1', items: [{ name: 'Butter Naan', quantity: 1, notes: '--' }], footerText: 'Demo order - not for billing' }
}, groupPrintableItems);
const kotText = kot.toString('ascii');
assert(kotText.indexOf('KMaster Demo Kitchen') < kotText.indexOf('KOT'));
assert(kotText.indexOf('Table No: Table 1') < kotText.indexOf('Butter Naan'));
assert(kotText.indexOf('Butter Naan') < kotText.indexOf('Demo order - not for billing'));
assert(kot.length < 1000, 'compact one-item KOT must not contain a page-sized raster or blank feed');
assert.deepStrictEqual([...kot.subarray(-4)], [0x1d, 0x56, 0x42, 0x00]);

const bill = buildThermalEscPos({
  type: 'BILL', paper_width_mm: 80,
  payload: { invoiceNo: 'DEMO-00037', orderReference: '13-A13', tableNumber: 'Table 1', settledAt: '21/07/2026 09:07', payable: 215,
    restaurantProfile: { displayName: 'KMaster White Label Demo Restaurant', legalName: 'KMaster Demo Foods', gstin: '33ABCDE1234F1Z5', fssaiLicenseNo: '12345678901234', state: 'Tamil Nadu', stateCode: '33', showTaxOnBill: true, footerText: 'THANK YOU. VISIT AGAIN.' },
    items: [{ name: 'Chapati', quantity: 1, price: 35 }, { name: 'Chicken 65', quantity: 1, price: 180 }] }
}, groupPrintableItems);
const billText = bill.toString('ascii');
for (const marker of ['TAX INVOICE', 'Chapati', 'CGST @ 2.50%', 'SGST @ 2.50%', 'GRAND TOTAL', 'THANK YOU. VISIT AGAIN.', 'Authorised Signatory']) assert(billText.includes(marker), marker);
assert(billText.indexOf('GRAND TOTAL') < billText.indexOf('THANK YOU. VISIT AGAIN.'));
assert(bill.length < 2500, 'bill must be compact continuous text rather than a paged bitmap');
assert.deepStrictEqual([...bill.subarray(-4)], [0x1d, 0x56, 0x42, 0x00]);

console.log('Thermal ESC/POS regression passed (continuous 58/80 mm KOT and bill output)');
