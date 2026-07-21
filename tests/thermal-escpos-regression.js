const assert = require('assert');
const { buildThermalEscPos, columns, wrap } = require('../pos-app/electron/thermalEscPos');
const { groupPrintableItems } = require('../pos-app/backend/services/printItemGrouping');

assert.deepStrictEqual(wrap('Butter Naan', 8), ['Butter', 'Naan']);
assert.deepStrictEqual(columns(['Item', '2'], [6, 3], ['left', 'right']), ['Item    2']);

const kot = buildThermalEscPos({
  type: 'KOT', ref_id: '14-A14-1', paper_width_mm: 58, created_at: '2026-07-21T09:05:47Z',
  payload: { printLayout: { printWidth58: 30, fontType: 'FONT_B', fontSize: 'COMPACT', lineSpacingDots: 20, leftMarginDots: 0 }, headerText: 'KMaster Demo Kitchen', kotReference: '14-A14-1', orderType: 'DINE_IN', tableName: 'Table 1', items: [{ name: 'Butter Naan', quantity: 1, notes: '--' }], footerText: 'Demo order - not for billing' }
}, groupPrintableItems);
const kotText = kot.toString('ascii');
assert(kotText.indexOf('KMaster Demo Kitchen') < kotText.indexOf('KOT'));
assert(kotText.indexOf('Table No: Table 1') < kotText.indexOf('Butter Naan'));
assert(kotText.indexOf('Butter Naan') < kotText.indexOf('Demo order - not for billing'));
assert(kot.length < 1000, 'compact one-item KOT must not contain a page-sized raster or blank feed');
assert(!kot.includes(Buffer.from([0x1d, 0x56, 0x42])), 'default KOT must let the printer/driver cut once at the end of the RAW job');
assert(kot.includes(Buffer.from([0x1b, 0x4d, 0x01])), 'compact KOT must select condensed printer font B');
assert(kot.includes(Buffer.from([0x1b, 0x33, 0x14])), 'KOT must apply configured 20-dot line spacing');
assert(kot.includes(Buffer.from([0x1d, 0x4c, 0x00, 0x00])), 'KOT must apply configured zero left inset without top feed');

const bill = buildThermalEscPos({
  type: 'BILL', paper_width_mm: 80,
  payload: { printLayout: { printWidth80: 40, fontType: 'FONT_A', fontSize: 'NORMAL', lineSpacingDots: 22 }, invoiceNo: 'DEMO-00037', orderReference: '13-A13', tableNumber: 'Table 1', settledAt: '21/07/2026 09:07', payable: 215,
    restaurantProfile: { displayName: 'KMaster White Label Demo Restaurant', legalName: 'KMaster Demo Foods', gstin: '33ABCDE1234F1Z5', fssaiLicenseNo: '12345678901234', state: 'Tamil Nadu', stateCode: '33', showTaxOnBill: true, footerText: 'THANK YOU. VISIT AGAIN.' },
    items: [{ name: 'Chapati', quantity: 1, price: 35 }, { name: 'Chicken 65', quantity: 1, price: 180 }] }
}, groupPrintableItems);
const billText = bill.toString('ascii');
for (const marker of ['TAX INVOICE', 'Chapati', 'CGST @ 2.50%', 'SGST @ 2.50%', 'GRAND TOTAL', 'THANK YOU. VISIT AGAIN.', 'Authorised Signatory']) assert(billText.includes(marker), marker);
assert(billText.indexOf('GRAND TOTAL') < billText.indexOf('THANK YOU. VISIT AGAIN.'));
assert(bill.length < 2500, 'bill must be compact continuous text rather than a paged bitmap');
assert(bill.includes(Buffer.from([0x1b, 0x33, 0x16])), 'bill must apply configured 22-dot line spacing');
assert(!bill.includes(Buffer.from([0x1d, 0x56, 0x42])), 'default bill must not add a second application-level cutter command');
const explicitCut = buildThermalEscPos({ type: 'KOT', paper_width_mm: 58, payload: { printLayout: { cutMode: 'PARTIAL' }, items: [] } }, (items) => items);
assert.deepStrictEqual([...explicitCut.subarray(-3)], [0x1d, 0x56, 0x01]);

console.log('Thermal ESC/POS regression passed (continuous 58/80 mm KOT and bill output)');
